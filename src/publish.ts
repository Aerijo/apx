import * as child_process from "child_process";
import {Context} from "./context";
import {Arguments} from "yargs";
import * as fs from "fs";
import {getGithubOwnerRepo} from "./package";
import {post} from "./request";
import {getToken} from "./auth";

export class Publish {
  context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  getMetadata(): Promise<any> {
    return new Promise(resolve => {
      fs.readFile("package.json", {encoding: "utf8"}, (err, data) => {
        if (err) {
          throw err;
        }
        resolve(JSON.parse(data));
      });
    });
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
    return result.response.statusCode;
  }

  async validatePackage(_packageJson: any): Promise<boolean> {
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
      const child = child_process.spawn("npm", [
        "version",
        version,
        "-m",
        "Prepare v%s release",
        "--tag-version-prefix",
        tagPrefix,
      ]);
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
        resolve(this.getMetadata().then(m => `${tagPrefix}${m.version}`));
      });
    });
  }

  async handler(argv: Arguments) {
    const metadata = await this.getMetadata();

    const results = await Promise.all([
      this.validatePackage(metadata),
      this.registerPackage(metadata),
    ]);
    console.log(results);

    const version = argv.newversion;
    if (version && typeof version === "string") {
      const newversion = await this.updateVersion(version);
      console.log("NEW:", newversion);
    }
  }
}
