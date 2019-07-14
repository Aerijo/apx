import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";

import {Arguments} from "yargs";
import * as semver from "semver";
import * as tmp from "tmp";
tmp.setGracefulCleanup();

import {Context} from "./context";
import {getJson, getGithubGraphql} from "./request";

export class Install {
  context: Context;

  constructor (context: Context) {
    this.context = context;
  }

  createAtomDirectories () {
    tryMakeDir(this.context.getAtomDirectory());
    tryMakeDir(this.context.getAtomPackagesDirectory());
    tryMakeDir(this.context.getAtomNodeDirectory());
  }

  getElectronBuildFlags (): string[] {
    return [
      `--target=${this.context.getElectronVersion().version}`,
      `--disturl=${this.context.getElectronUrl()}`,
      `--arch=${this.context.getElectronArch()}`,
    ];
  }

  installFromUrl (tarballUrl: string) {
    const installDir = tmp.dirSync({prefix: "apx-install-", unsafeCleanup: true});
    const modulesDir = path.join(installDir.name, "node_modules");
    fs.mkdirSync(modulesDir);

    const result = child_process.spawnSync(
      "npm",
      [
        "install",
        "--global-style",
        tarballUrl,
        ...this.getElectronBuildFlags(),
      ],
      {
        cwd: installDir.name,
        encoding: "utf8",
      },
    );

    console.log(result.stdout);

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`npm install exited with non-zero status ${result.status}`);
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
  }

  installDependencies (_argv: Arguments) {
    console.log("installing dependencies... (TODO)");
  }

  getGithubOwnerRepo (release: any): {owner: string; repo: string} {
    let repoUrl = release.repository;
    if (repoUrl && release.repository.url) {
      repoUrl = release.repository.url;
    }

    if (typeof repoUrl !== "string") {
      throw new Error("Expected repository URL");
    }

    const githubRegex = /^https:\/\/github\.com\/([a-zA-A0-9\-]+?)\/([a-zA-Z0-9\-\._]+?)(\/|\.git)?$/;
    const match = githubRegex.exec(repoUrl);

    if (!match) {
      throw new Error("Could not retrieve GitHub owner and repo");
    }

    const [, owner, repo] = match;
    return {owner, repo};
  }

  // TODO: Support for builds split by OS & Electron version
  async getGithubRelease (owner: string, repo: string, name: string, version: string): Promise<string|undefined> {
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
      return assets.length === 1
        ? assets[0].downloadUrl
        : undefined;
    } catch (e) {
      throw e;
    }
  }

  async getPackageTarball (name: string, version: string | undefined): Promise<string> {
    const requestUrl = `${this.context.getAtomPackagesUrl()}/${name}`;
    const message = await getJson(requestUrl);

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

    const {owner, repo} = this.getGithubOwnerRepo(release);

    const githubTarball = await this.getGithubRelease(owner, repo, "apx-test", version);

    if (githubTarball) {
      console.log(githubTarball);
      return githubTarball;
    }

    return release.dist.tarball;
  }

  async handler (argv: Arguments) {
    let packageName = argv.uri as string;
    let version;

    if (packageName === ".") {
      this.installDependencies(argv);
      return;
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

    this.installFromUrl(tarball);
  }
}


function tryMakeDir (dir: string) {
  try {
    fs.mkdirSync(dir, {recursive: true});
  } catch (e) {
    if (e.code !== "EEXIST") {
      console.error(`Could not create required directory ${dir}`);
      throw e;
    }
  }
}
