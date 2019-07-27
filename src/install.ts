import * as fs from "fs";
import * as path from "path";
import {Arguments} from "yargs";
import * as semver from "semver";
import * as tmpp from "tmp-promise";
tmpp.setGracefulCleanup();
import {promisify} from "util";
import {Context} from "./context";
import {get, getGithubGraphql} from "./request";
import {getGithubOwnerRepo} from "./package";
import {Command} from "./command";
import { TaskManager } from './tasks';

export class Install extends Command {
  constructor(context: Context) {
    super(context);
  }

  createAtomDirectories() {
    this.tryMakeDir(this.context.getAtomDirectory());
    this.tryMakeDir(this.context.getAtomPackagesDirectory());
    this.tryMakeDir(this.context.getAtomNodeDirectory());
  }

  getInstallPromise(tarballUrl: string, dir: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = this.spawn(
        "npm",
        ["install", "--global-style", "--loglevel=error", tarballUrl],
        {
          cwd: dir,
          stdio: "inherit",
        }
      );

      child.on("exit", (code, status) => {
        reject({code, status});
        if (code !== 0) {
          reject({code, status});
        } else {
          resolve(code);
        }
      });
    });
  }

  async downloadFromUrl(tarball: string): Promise<tmpp.DirectoryResult> {
    const installDir = await tmpp.dir({prefix: "apx-install-", unsafeCleanup: true});
    await new Promise((resolve, reject) => {
      const child = this.spawn(
        "npm",
        ["install", "--global-style", "--loglevel=error", tarball],
        {
          cwd: installDir.path,
          stdio: "inherit",
        }
      );

      child.on("exit", (code, status) => {
        // reject(`Install failed with code ${code} and status ${status}`);
        if (code !== 0) {
          reject(`Install failed with code ${code} and status ${status}`);
        } else {
          resolve();
        }
      });
    });
    return installDir;
  }

  async movePackageAndCleanup(installDir: tmpp.DirectoryResult): Promise<void> {
    const modulesDir = path.join(installDir.path, "node_modules");
    const contents = (await promisify(fs.readdir)(modulesDir)).filter(n => n !== ".bin");
    if (contents.length !== 1) {
      throw new Error(`Expected only one directory in ${modulesDir}`);
    }
    const name = contents[0];
    const source = path.join(modulesDir, name);
    const dest = path.join(this.context.getAtomPackagesDirectory(), name);
    await promisify(fs.rename)(source, dest);
    installDir.cleanup();
  }

  installDependencies(_argv: Arguments): Promise<number> {
    return new Promise(resolve => {
      console.log("Installing dependencies");
      const child = this.spawn("npm", ["install"], {stdio: "inherit"});
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

    return githubTarball || release.dist.tarball;
  }

  getPackageNameAndVersion(uri: string): {name: string; version: string | undefined} {
    const versionIndex = uri.indexOf("@");
    if (versionIndex < 0) {
      return {name: uri, version: undefined};
    }

    const version = uri.slice(versionIndex + 1);
    const name = uri.slice(0, versionIndex);

    if (!semver.valid(version)) {
      throw new Error("Invalid version specifier");
    }

    return {name, version};
  }

  async handler(argv: Arguments) {
    const {name: packageName, version} = this.getPackageNameAndVersion(argv.uri as string);

    if (!packageName || packageName === ".") {
      this.installDependencies(argv);
      return;
    }

    const self = this;
    let tarball = "";
    let downloadTemp: tmpp.DirectoryResult;

    const tasks = new TaskManager([
      {
        title: `Checking if ${packageName} is installed`,
        task () {
          return new Promise((resolve, reject) => {
            self.createAtomDirectories();

            fs.access(path.join(self.context.getAtomPackagesDirectory(), packageName), (err) => {
              if (!err || err.code !== "ENOENT") {
                reject("Package already installed");
                return;
              }

              this.title = `No other version of ${packageName} detected`;
              resolve();
            });
          });
        }
      },
      {
        title: `Getting package URL`,
        async task () {
          tarball = await self.getPackageTarball(packageName, version);
          this.title = `Got package URL - ${tarball}`;
        }
      },
      {
        title: () => `Installing ${packageName} for Atom ${self.context.getAtomVersion.call(self.context)}`,
        async task () {
          downloadTemp = await self.downloadFromUrl(tarball);
        }
      },
      {
        title: `Moving download to packages folder`,
        async task () {
          await self.movePackageAndCleanup(downloadTemp);
        }
      },
      {
        title: `Successfully installed ${packageName}`,
        task () {}
      }
    ]);

    try {
      await tasks.run();
    } catch {}
  }
}
