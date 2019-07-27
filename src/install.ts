import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import {Arguments} from "yargs";
import * as semver from "semver";
import * as tmp from "tmp";
tmp.setGracefulCleanup();
import {Context} from "./context";
import {get, getGithubGraphql} from "./request";
import {getGithubOwnerRepo} from "./package";
import { Command } from './command';

export class Install extends Command {
  constructor(context: Context) {
    super(context);
  }

  createAtomDirectories() {
    this.tryMakeDir(this.context.getAtomDirectory());
    this.tryMakeDir(this.context.getAtomPackagesDirectory());
    this.tryMakeDir(this.context.getAtomNodeDirectory());
  }

  getInstallPromise(tarballUrl: string, dir: string, packageName?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = this.spawn("npm", ["install", "--global-style", tarballUrl], {
        cwd: dir,
        log: true,
      }, {
        logfile: path.join(this.getOrCreateLogPath(), `apx-install${packageName ? "-" + packageName : ""}.txt`),
      });

      child.on("exit", (code, status) => {
        reject({code, status});
        // if (code !== 0) {
        //   reject({code, status});
        // } else {
        //   resolve(code);
        // }
      });
    });
  }

  async installFromUrl(tarballUrl: string, packageName?: string): Promise<void> {
    const installDir = tmp.dirSync({prefix: "apx-install-", unsafeCleanup: true});
    const modulesDir = path.join(installDir.name, "node_modules");
    fs.mkdirSync(modulesDir);

    try {
      await this.getInstallPromise(tarballUrl, installDir.name, packageName);
    } catch (e) {
      console.log(`Install failed with`, e);
      return;
    }

    const packDir = fs.readdirSync(modulesDir).filter(n => n !== ".bin");
    if (packDir.length !== 1) {
      throw new Error(`Expected only one directory in ${packDir}`);
    }

    const packName = packDir[0];
    const source = path.join(modulesDir, packName);
    const dest = path.join(this.context.getAtomPackagesDirectory(), packName);

    try {
      fs.renameSync(source, dest);
    } catch (e) {
      throw e;
    }
    console.log("Finished install");
    installDir.removeCallback();

    return;
  }

  installDependencies(_argv: Arguments): Promise<number> {
    return new Promise(resolve => {
      console.log("Installing dependencies");
      const child = child_process.spawn("npm", ["install"], {env: this.context.getElectronEnv()});
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", data => {
        console.log(data);
      });
      child.stderr.on("data", data => {
        console.error(data);
      });

      child.on("exit", (code, _signal) => {
        resolve(code || 0);
      });
    });
  }

  // TODO: Support for builds split by OS & Electron version
  async getGithubRelease(
    owner: string,
    repo: string,
    name: string,
    version: string
  ): Promise<string | undefined> {
    const query = `{
      repository(owner:"${owner}", name:"${repo}") {
        release(tagName:"v${version}") {
          releaseAssets(name:"apx-bundled-${name}-${version}.tgz" first:1) {
            nodes {
              downloadUrl
            }
          }
        }
      }
    }`;

    try {
      const data = await getGithubGraphql(query);
      const assets = data.repository.release.releaseAssets.nodes;
      return assets.length === 1 ? assets[0].downloadUrl : undefined;
    } catch (e) {
      return undefined;
    }
  }

  async getPackageTarball(name: string, version: string | undefined): Promise<string> {
    const requestUrl = `${this.context.getAtomPackagesUrl()}/${name}`;
    const message = (await get({url: requestUrl, json: true})).body;

    if (!message) {
      throw new Error(`Could not retrieve package data for ${name}`);
    }

    if (!version) {
      version = message.releases.latest as string;
      if (!version) {
        throw new Error("Could not detect version");
      }
    }

    const release = message.versions[version];

    if (!release) {
      throw new Error(`Could not retrieve version ${version} of package ${name}`);
    }

    const {owner, repo} = getGithubOwnerRepo(release);

    const githubTarball = await this.getGithubRelease(owner, repo, "apx-test", version);

    if (githubTarball) {
      console.log(githubTarball);
      return githubTarball;
    }

    return release.dist.tarball;
  }

  async handler(argv: Arguments) {
    let packageName = argv.uri as string;
    let version;

    if (!packageName || packageName === ".") {
      this.installDependencies(argv);
      return;
    }

    if (fs.existsSync(path.join(this.context.getAtomPackagesDirectory(), packageName))) {
      throw new Error("Package already installed"); // TODO: Allow overwrite new version
    }

    const versionIndex = packageName.indexOf("@");
    if (versionIndex > 0) {
      version = packageName.slice(versionIndex + 1);
      packageName = packageName.slice(0, versionIndex);

      if (!semver.valid(version)) {
        throw new Error("Invalid version specifier");
      }
    }

    this.createAtomDirectories();

    const tarball = await this.getPackageTarball(packageName, version);

    console.log("Installing", tarball);

    this.installFromUrl(tarball, packageName);
  }
}
