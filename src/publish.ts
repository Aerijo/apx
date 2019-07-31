import {promisify} from "util";
import {Arguments} from "yargs";
import * as fs from "fs";
import * as path from "path";
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
      this.spawn("git", ["push", "--follow-tags"], {}, {reject}).on("exit", code => {
        if (code) {
          reject(new Error(`Failed to push version and tag: code ${code}`));
        } else {
          resolve();
        }
      });
    });
  }

  async awaitGitHubTag(
    tag: string,
    attempts: number,
    attemptCounter: (attempt: number) => void
  ): Promise<boolean> {
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
    for (let i = 0; i < attempts; i++) {
      attemptCounter(i);
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

  runPrepublishAndPack(stdio: string = "inherit"): Promise<void> {
    return new Promise(resolve => {
      this.spawn("npm", ["run", "prepublishOnly"], {stdio}).on("exit", code => {
        if (code) {
          throw new Error(`Prepublish script failed with code ${code}`);
        }
        this.spawn("npm", ["pack"], {stdio}).on("exit", code2 => {
          if (code2) {
            throw new Error(`npm pack failed with code ${code2}`);
          }
          resolve();
        });
      });
    });
  }

  async generateReleaseAssets(stdio?: string): Promise<string> {
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

    await this.runPrepublishAndPack(stdio);

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
    const tasks = new TaskManager([
      {
        title: () => "Inspecting repo state",
        task: async task => {
          // TODO: Verify commits pushed, on master branch
          const dirContents = await promisify(fs.readdir)(this.cwd);
          for (const item of dirContents) {
            if (path.extname(item) === ".tgz") {
              // TODO: Either find a way to have npm place them elsewhere, or more fine tuned criteria
              throw new Error(`Repository contains old build artifact ${item}`);
            }
          }
          task.complete();
        },
      },
      {
        title: () => "Bumping package version",
        staticWait: () => true,
        task: async (task, ctx) => {
          if (!ctx.versionBump) {
            task.error("Missing version not currently supported");
            return;
          }
          ctx.tag = await this.updateVersion(ctx.versionBump);
          task.complete(`Bumped package version to ${ctx.tag}`);
        },
      },
      {
        title: ctx => `Publishing version ${ctx.tag} to GitHub`,
        task: async (task, ctx) => {
          task.update("Pushing to GitHub");
          await this.pushVersionAndTag(ctx.tag);
          task.update("Verifying tag is visible");
          const attempts = 5;
          await this.awaitGitHubTag(ctx.tag, attempts, i => {
            if (i > 0) {
              task.update(`Verifying tag is visible (attempt ${i + 1} of ${attempts})`);
            }
          });
          task.complete();
        },
      },
      {
        title: ctx => `Registering version ${ctx.tag} to atom.io`,
        task: async (task, ctx) => {
          task.update("Registering package name");
          try {
            const metadata = await getMetadata(this.cwd);
            await this.registerPackage(metadata);
          } catch (e) {
            task.error(e.message);
          }
          task.update("Publishing version");
          await this.publishVersion(ctx.tag);
          task.complete();
        },
      },
      {
        title: () => "Publishing package assets",
        enabled: ctx => ctx.bundleRelease,
        task: async (task, ctx) => {
          task.update("Building assets");
          ctx.tarname = await this.generateReleaseAssets("ignore");

          task.update("Creating GitHub release");
          ctx.releaseResult = await this.createRelease(ctx.tag);
          const code = ctx.releaseResult.response.statusCode;
          if (code !== 201) {
            throw new Error(`Could not create release: response code ${code}`);
          }

          task.update("Uploading assets to release");
          await this.uploadAssets(ctx.releaseResult.body, ctx.tarname);
          task.complete();
        },
      },
    ]);

    tasks.run({
      bundleRelease: argv.assets,
      versionBump: argv.newversion,
    });
  }
}
