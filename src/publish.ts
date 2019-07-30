import {promisify} from "util";
import * as child_process from "child_process";
import {Arguments} from "yargs";
import * as fs from "fs";
import {Context} from "./context";
import {getGithubOwnerRepo, getMetadata} from "./package";
import {post, getAtomioErrorMessage, getGithubGraphql, RequestResult, uploadAsset} from "./request";
import {getToken, getGithubRestToken} from "./auth";
import {Command} from "./command";
import {TaskManager} from "./tasks";

export class Publish extends Command {
  cwd: string;

  constructor(context: Context) {
    super(context);
    this.cwd = process.cwd();
  }

  async registerPackage(metadata: any): Promise<string> {
    const {owner, repo} = getGithubOwnerRepo(metadata);
    const repository = `${owner}/${repo}`;
    const token = await getToken();
    const result = await post({
      url: this.context.getAtomPackagesUrl(),
      json: true,
      body: {repository},
      headers: {authorization: token},
    });

    const status = result.response.statusCode;
    if (status === 201) {
      return `Registered new package ${metadata.name}`;
    } else if (status === 409) {
      return `Package ${metadata.name} already registered`;
    } else {
      throw new Error(getAtomioErrorMessage(result));
    }
  }

  /**
   * Changes or bumps the version via `npm version`
   * and resolves to the tag name.
   * @param  version Increment or version number
   * @return         The name of the created tag
   */
  updateVersion(version: string): Promise<string> {
    const tagPrefix = "v";
    return new Promise(resolve => {
      const child = this.spawn(
        "npm",
        ["version", version, "-m", "Prepare v%s release", "--tag-version-prefix", tagPrefix],
        {stdio: "inherit"}
      );
      child.on("exit", code => {
        if (code) {
          throw new Error(`Version change exited with code ${code}`);
        }
        resolve(getMetadata(this.cwd).then(m => `${tagPrefix}${m.version}`));
      });
    });
  }

  /**
   * Push the commit and tag created by `npm version`. Returns
   * a promise that resolves when the tag is visible on GitHub,
   * or is rejected after too many checks.
   * @param  tag The name of the tag to be pushed
   * @return     Promise that resolves when visible on GitHub
   */
  pushVersionAndTag(_tag: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.spawn("git", ["push", "--follow-tags"]).on("exit", (code, _signal) => {
        if (code) {
          reject(code);
        } else {
          resolve();
        }
      });
    });
  }

  async awaitGitHubTag(tag: string): Promise<boolean> {
    const metadata = await getMetadata(this.cwd);
    const {owner, repo} = getGithubOwnerRepo(metadata);
    const query = `{
      repository(owner:"${owner}" name:"${repo}") {
        refs(refPrefix:"refs/tags/", first:1, orderBy:{field: TAG_COMMIT_DATE, direction: DESC}) {
          nodes {
            name
          }
        }
      }
    }`;

    // TODO: Actually might not be latest tag. Should check all of them.
    for (let i = 0; i < 5; i++) {
      const data = await getGithubGraphql(query);
      try {
        const latestTag = data.repository.refs.nodes[0].name;
        if (latestTag === tag) {
          return true;
        }
      } catch {}

      await new Promise(r => setTimeout(r, 1000));
    }

    throw new Error(`Could not detect tag on GitHub ${owner}/${repo}`);
  }

  async publishVersion(tag: string): Promise<void> {
    const metadata = await getMetadata(this.cwd);
    const name = metadata.name;
    const token = await getToken();
    const result = await post({
      url: `${this.context.getAtomPackagesUrl()}/${name}/versions`,
      json: true,
      body: {
        tag,
        rename: false,
      },
      headers: {
        authorization: token,
      },
    });

    const status = result.response.statusCode;

    if (status === 201) {
      return;
    } else {
      throw new Error(`Status ${status}: ${getAtomioErrorMessage(result)}`);
    }
  }

  async createRelease(tag: string): Promise<RequestResult> {
    const [metadata, token] = await Promise.all([getMetadata(this.cwd), getGithubRestToken()]);
    const {owner, repo} = getGithubOwnerRepo(metadata);

    const result = await post({
      url: `${this.context.getGithubApiUrl()}/repos/${owner}/${repo}/releases`,
      json: true,
      body: {
        tag_name: tag,
      },
      auth: {
        user: owner,
        pass: token,
      },
      headers: {
        "User-Agent": "atom-apx",
      },
    });

    return result;
  }

  runPrepublishAndPack(): Promise<void> {
    return new Promise(resolve => {
      this.spawn("npm", ["run", "prepublishOnly"], {stdio: "inherit"}).on("exit", code => {
        if (code) {
          throw new Error(`Prepublish script failed with code ${code}`);
        }
        this.spawn("npm", ["pack"], {stdio: "inherit"}).on("exit", code2 => {
          if (code2) {
            throw new Error(`npm pack failed with code ${code2}`);
          }
          resolve();
        });
      });
    });
  }

  async generateReleaseAssets(): Promise<string> {
    const metadata = await getMetadata(this.cwd);

    if (typeof metadata.name !== "string") {
      throw new Error("Could not detect package name");
    }
    if (typeof metadata.version !== "string") {
      throw new Error("Could not detect package version");
    }

    const name: string = metadata.name.startsWith("@")
      ? metadata.name.slice(1).replace(/\//g, "-")
      : metadata.name;

    const version: string = metadata.version;

    const tarname = `${name}-${version}.tgz`;

    let exists = true;
    try {
      await promisify(fs.access)(`./${tarname}`);
    } catch (error) {
      if (error.code === "ENOENT") {
        exists = false;
      }
    }

    if (exists) {
      throw new Error(`File ${tarname} cannot exist when publishing`);
    }

    await this.runPrepublishAndPack();

    return tarname;
  }

  async uploadAssets(releaseData: any, tarname: string): Promise<void> {
    const status = await uploadAsset(
      releaseData["upload_url"],
      `apx-bundled-${tarname}`,
      "text/plain",
      fs.readFileSync(tarname)
    );
    fs.unlinkSync(tarname);
    if (status === 201) {
      return;
    } else {
      throw new Error(`Error publishing package asset: status ${status}`);
    }
  }

  handler(argv: Arguments) {
    const version = argv.newversion as string;
    let tag: string;
    let tarname: string;
    let releaseResult: RequestResult;

    const tasks = new TaskManager([
      {
        title: () => "Registering package",
        task: async (ctx, task) => {
          if (typeof version !== "string") {
            task.setTitle("Missing version not currently supported");
            throw new Error();
          }
          const metadata = await getMetadata(this.cwd);
          try {
            const results = await this.registerPackage(metadata);
            task.setTitle(results);
          } catch (e) {
            task.setTitle(e.message);
            throw new Error();
          }
        },
      },
      {
        title: () => "Bumping package version",
        task: async (ctx, task) => {
          tag = await this.updateVersion(version);
          task.setTitle(`Bumped package version to ${tag}`);
        },
      },
      {
        title: () => "Pushing new version",
        task: async (ctx, task) => {
          await this.pushVersionAndTag(tag);
          await this.awaitGitHubTag(tag);
          task.setTitle(`Pushed version ${tag} to GitHub`);
        },
      },
      {
        title: () => "Publishing new version to atom.io",
        task: async (ctx, task) => {
          await this.publishVersion(tag);
          task.setTitle(`Successfully published ${tag} to atom.io`);
        },
      },
      {
        title: () => "Building package assets",
        skip: ctx => {
          const skip = !argv.assets;
          return skip ? "Asset upload disabled" : false;
        },
        task: async () => {
          tarname = await this.generateReleaseAssets();
        },
      },
      {
        title: () => `Creating GitHub release for ${tag}`,
        task: async (ctx, task) => {
          releaseResult = await this.createRelease(tag);
          const code = releaseResult.response.statusCode;
          if (code !== 201) {
            task.setTitle(`Could not create release: error ${code}`);
            throw new Error();
          }
          task.setTitle(`Created GitHub release for ${tag}`);
        },
      },
      {
        title: () => "Uploading assets to release",
        task: async (ctx, task) => {
          await this.uploadAssets(releaseResult.body, tarname);
          task.setTitle("Uploaded assets");
        },
      },
    ]);

    tasks.run();
  }
}
