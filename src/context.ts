import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import * as os from "os";
import {SemVer} from "semver";

export class Context {
  private atomDirectory: string | undefined;
  private resourceDirectory: string | undefined;
  private reposDirectory: string | undefined;
  private atomVersion: SemVer | undefined;
  private electronVersion: SemVer | undefined;
  private readonly config: {[key: string]: any};
  private target: string | undefined;

  constructor() {
    this.config = this.loadConfig();
  }

  getConfigPath(): string {
    return process.env.APX_CONFIG_PATH || path.join(this.getAtomDirectory(), ".apxrc");
  }

  loadConfig(): Object {
    const configPath = this.getConfigPath();
    try {
      return JSON.parse(fs.readFileSync(configPath, {encoding: "utf8"}));
    } catch {
      return {};
    }
  }

  storeConfig() {
    const configPath = this.getConfigPath();
    const configContents = JSON.stringify(this.config, undefined, 2);
    fs.writeFileSync(configPath, configContents, {encoding: "utf8"});
    return;
  }

  isWindows(): boolean {
    return process.platform === "win32";
  }

  getHomeDirectory(): string {
    // NOTE: This method allows for env variable to be created in the future
    return os.homedir();
  }

  getAtomDirectory(): string {
    if (!this.atomDirectory) {
      this.atomDirectory = process.env.ATOM_HOME || path.join(this.getHomeDirectory(), ".atom");
    }
    return this.atomDirectory;
  }

  calculateResourceDirectory(target: string): string {
    if (process.env.ATOM_RESOURCE_PATH) {
      return process.env.ATOM_RESOURCE_PATH;
    }

    if (target !== "stable" && target !== "beta" && target !== "nightly" && target !== "dev") {
      throw new Error(`Invalid Atom target "${target}"`);
    }

    if (target === "dev") {
      return path.join(this.getReposDirectory(), "atom");
    }

    // TODO: Support Windows
    const appLocations: string[] = [];
    if (process.platform === "darwin") {
      const apps = child_process
        .execSync("mdfind \"kMDItemCFBundleIdentifier == 'com.github.atom'\"", {
          encoding: "utf8",
          timeout: 1000,
        })
        .split("\n");

      const appName = new Map([
        ["stable", "Atom.app"],
        ["beta", "Atom Beta.app"],
        ["nightly", "Atom Nightly.app"],
        ["dev", "Atom Dev.app"],
      ]).get(target);

      if (apps.length > 0) {
        for (const dir of apps) {
          if (path.basename(dir) === appName) {
            appLocations.push(`${dir}/Contents/Resources/app.asar`);
            break;
          }
        }
      }
      appLocations.push(`/Applications/${appName}/Contents/Resources/app.asar`);
    } else if (process.platform === "linux") {
      const appName = new Map([
        ["stable", "atom"],
        ["beta", "atom-beta"],
        ["nightly", "atom-nightly"],
        ["dev", "atom-dev"],
      ]).get(target);
      appLocations.push(
        `/usr/local/share/${appName}/resources/app.asar`,
        `/usr/share/${appName}/resources/app.asar`
      );
    } else {
      throw new Error(`Platform ${process.platform} not supported`);
    }

    for (const location of appLocations) {
      if (fs.existsSync(location)) {
        return location;
      }
    }

    throw new Error("Could not locate Atom resources path");
  }

  getResourceDirectory(target?: string): string {
    if (!this.resourceDirectory || target !== this.target) {
      if (!target && typeof this.config["target"] === "string") {
        target = this.config["target"];
      }
      this.resourceDirectory = this.calculateResourceDirectory(target || "stable");
      this.target = target;
    }
    return this.resourceDirectory;
  }

  getReposDirectory(): string {
    if (!this.reposDirectory) {
      this.reposDirectory =
        process.env.ATOM_REPOS_HOME !== undefined
          ? process.env.ATOM_REPOS_HOME
          : path.join(this.getHomeDirectory(), "github");
    }
    return this.reposDirectory;
  }

  getAtomApiUrl(): string {
    return process.env.ATOM_API_URL || "https://atom.io/api";
  }

  getAtomPackagesUrl(): string {
    return process.env.ATOM_PACKAGES_URL || `${this.getAtomApiUrl()}/packages`;
  }

  getElectronUrl(): string {
    return process.env.ATOM_ELECTRON_URL || "https://atom.io/download/electron";
  }

  getGithubApiUrl(): string {
    return process.env.ATOM_GITHUB_URL || "https://api.github.com";
  }

  getGithubRepoUrl(owner: string, repo: string): string {
    return `${this.getGithubApiUrl()}/repos/${owner}/${repo}`;
  }

  getAtomPackagesDirectory(dev: boolean = false): string {
    return dev
      ? path.join(this.getAtomDirectory(), "dev", "packages")
      : path.join(this.getAtomDirectory(), "packages");
  }

  getAtomNodeDirectory(): string {
    return path.join(this.getAtomDirectory(), ".node-gyp");
  }

  calculateAtomElectronVersions() {
    let {version: atomVersion, electronVersion} = require(path.join(
      this.getResourceDirectory(),
      "package.json"
    ));

    atomVersion = semver.parse(atomVersion);
    electronVersion = semver.parse(electronVersion);

    if (!atomVersion) {
      throw new Error("Could not determine Atom version");
    }

    if (!electronVersion) {
      throw new Error("Could not determine Electron version");
    }

    this.atomVersion = atomVersion;
    this.electronVersion = electronVersion;
  }

  getAtomVersion(): SemVer {
    if (!this.atomVersion) {
      this.calculateAtomElectronVersions();
    }
    return this.atomVersion!;
  }

  getElectronVersion(): SemVer {
    if (!this.electronVersion) {
      this.calculateAtomElectronVersions();
    }
    return this.electronVersion!;
  }

  getElectronArch(): string {
    return process.env.ATOM_ARCH || process.arch;
  }

  // See https://electronjs.org/docs/tutorial/using-native-node-modules#using-npm
  getElectronEnv(includeDefault: boolean = true): {[key: string]: string} {
    const electronVars = {
      // USERPROFILE: path.resolve(os.homedir(), ".electron-gyp"), // Cannot blanket set, as home dir is needed by things like git
      // HOME: path.resolve(os.homedir(), ".electron-gyp"),
      npm_config_runtime: "electron",
      npm_config_target: this.getElectronVersion().version,
      npm_config_disturl: this.getElectronUrl(),
      npm_config_arch: this.getElectronArch(),
      npm_config_target_arch: this.getElectronArch(), // for node-pre-gyp
      npm_config_python: "python2", // TODO: does this work?
    };

    return includeDefault ? {...process.env, ...electronVars} : electronVars;
  }

  getDefault(name: string): string | undefined {
    return this.config[name];
  }

  setDefault(name: string, value: string) {
    this.config[name] = value;
    this.storeConfig();
    console.log("New config:", this.config);
  }

  getConfig(): {[key: string]: any} {
    return this.config;
  }
}
