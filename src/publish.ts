import {promisify as pf} from "util";
import * as child_process from "child_process";
import {Arguments} from "yargs";
import * as fs from "fs";
import {Context} from "./context";
import {getGithubOwnerRepo, getMetadata} from "./package";
import {post, getAtomioErrorMessage, getGithubGraphql, RequestResult, uploadAsset} from "./request";
import {getToken, getGithubRestToken} from "./auth";

export class Publish {
  context: Context;
  cwd: string;

  constructor(context: Context) {
    this.context = context;
    this.cwd = process.cwd();
  }

  async registerPackage(metadata: any): Promise<number> {
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
      console.log(`Registered new package ${metadata.name}`);
    } else if (status === 409) {
      console.log(`Package already registered`);
    } else {
      throw new Error(getAtomioErrorMessage(result));
    }

    return status;
  }

  async validatePackage(_metadata: any): Promise<boolean> {
    return true; // TODO: Validate the entries
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
      const child = child_process.spawn(
        "npm",
        ["version", version, "-m", "Prepare v%s release", "--tag-version-prefix", tagPrefix],
        {
          env: this.context.getElectronEnv(),
        }
      );
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", data => {
        console.log(data);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", data => {
        console.error(data);
      });
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
  pushVersionAndTag(tag: string): Promise<boolean> {
    return new Promise(resolve => {
      console.log(`Pushing tag ${tag}`);
      child_process.exec("git push --follow-tags", {env: this.context.getElectronEnv()}, err => {
        if (err) {
          throw err;
        }
        resolve(this.awaitGitHubTag(tag));
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

    console.log(`Looking for tag ${tag} on GitHub ${owner}/${repo}`);

    // TODO: Actually might not be latest tag. Should check all of them.
    for (let i = 0; i < 5; i++) {
      const data = await getGithubGraphql(query);
      try {
        const latestTag = data.repository.refs.nodes[0].name;
        if (latestTag === tag) {
          console.log(`Detected tag ${tag} on GitHub ${owner}/${repo}`);
          return true;
        }
      } catch {}

      console.log("Did not find tag. Retrying in 1 second");
      await new Promise(r => setTimeout(r, 1000));
    }

    throw new Error(`Could not detect tag on GitHub ${owner}/${repo}`);
  }

  async publishVersion(tag: string): Promise<number> {
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
      console.log(`Successfully published version ${tag}`);
    } else {
      throw new Error(`Status ${status}: ${getAtomioErrorMessage(result)}`);
    }

    return status;
  }

  async createRelease(tag: string): Promise<RequestResult> {
    const [metadata, token] = await Promise.all([getMetadata(this.cwd), getGithubRestToken()]);
    const {owner, repo} = getGithubOwnerRepo(metadata);

    console.log(`Creating GitHub ${owner}/${repo} release for tag ${tag}`);
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

    const tarName = `${name}-${version}.tgz`;

    let exists = true;
    try {
      await pf(fs.access)(`./${tarName}`);
    } catch (error) {
      if (error.code === "ENOENT") {
        exists = false;
      }
    }

    if (exists) {
      throw new Error(`File ${tarName} cannot exist when publishing`);
    }

    const prepOut = child_process.execSync("npm run prepublishOnly", {
      encoding: "utf8",
      env: this.context.getElectronEnv(),
    });
    console.log(prepOut);

    console.log(
      child_process.execSync("npm pack", {encoding: "utf8", env: this.context.getElectronEnv()})
    );

    return tarName;
  }

  async uploadAssets(releaseData: any, tarname: string): Promise<number> {
    const status = await uploadAsset(
      releaseData["upload_url"],
      `apx-bundled-${tarname}`,
      "text/plain",
      fs.readFileSync(tarname)
    );
    fs.unlinkSync(tarname);
    if (status === 201) {
      console.log("Successfully published package asset");
    } else {
      console.log(`Error publishing package asset: status ${status}`);
    }
    return status;
  }

  async handler(argv: Arguments) {
    const version = argv.newversion;
    if (typeof version !== "string") {
      console.log("Missing version not currently supported");
      return;
    }
    const metadata = await getMetadata(this.cwd);

    const results = await Promise.all([
      this.validatePackage(metadata),
      this.registerPackage(metadata),
    ]);

    if (!results[0]) {
      throw new Error("Package validation failed");
    }

    const tag = await this.updateVersion(version);
    console.log(`Updated version to ${tag}`);

    await this.pushVersionAndTag(tag);
    await this.publishVersion(tag);

    const releaseResult = await this.createRelease(tag);
    if (releaseResult.response.statusCode !== 201) {
      console.log("Could not create release");
      return;
    }

    const tarName = await this.generateReleaseAssets();

    await this.uploadAssets(releaseResult.body, tarName);
  }
}
