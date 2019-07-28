import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as semver from "semver";
import {SemVer} from "semver";
import * as asar from "asar";

export enum Target {
  STABLE,
  BETA,
  NIGHTLY,
  DEV,
}

export function displayNameForTarget(target: Target): string {
  switch (target) {
    case Target.STABLE:
      return "Atom";
    case Target.BETA:
      return "Atom Beta";
    case Target.NIGHTLY:
      return "Atom Nightly";
    case Target.DEV:
      return "Atom Dev";
  }
}

export class Context {
  private atomDirectory: string | undefined;
  private resourceDirectory: string | undefined;
  private reposDirectory: string | undefined;
  private atomVersion: SemVer | undefined;
  private electronVersion: SemVer | undefined;
  private config: {[key: string]: any};
  private target: Target;

  constructor() {
    this.config = this.loadConfig();
    this.target =
      (typeof this.config.target === "string" && getTargetFromString(this.config.target)) ||
      Target.STABLE;
  }

  setTarget(target: Target) {
    if (target === this.target) return;
    this.target = target;
    this.resourceDirectory = undefined;
    this.atomVersion = undefined;
    this.electronVersion = undefined;
  }

  getConfigPath(): string {
    return process.env.APX_CONFIG_PATH || path.join(this.getAtomDirectory(), ".apxrc");
  }

  loadConfig(): {[key: string]: any} {
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

  getAtomDirectory(): string {
    if (!this.atomDirectory) {
      this.atomDirectory = process.env.ATOM_HOME || path.join(os.homedir(), ".atom");
    }
    return this.atomDirectory;
  }

  appNameForTarget(target: Target): string {
    const isMac = process.platform === "darwin";
    switch (target) {
      case Target.STABLE:
        return isMac ? "Atom.app" : "atom";
      case Target.BETA:
        return isMac ? "Atom Beta.app" : "atom-beta";
      case Target.NIGHTLY:
        return isMac ? "Atom Nightly.app" : "atom-nightly";
      default:
        return "atom";
    }
  }

  calculateResourceDirectory(target: Target, useEnv: boolean = true): string {
    if (process.env.ATOM_RESOURCE_PATH && useEnv) {
      return process.env.ATOM_RESOURCE_PATH;
    }

    if (target === Target.DEV) {
      const location = path.join(this.getReposDirectory(), "atom");
      if (fs.existsSync(location)) {
        return location;
      }
      throw new Error("Could not find Atom dev repo");
    }

    let appLocations: string[] = [];
    const appName = this.appNameForTarget(target);

    if (process.platform === "win32") {
      const baseDir = `${os.homedir()}\\AppData\\Local\\${appName}`;
      try {
        appLocations = fs
          .readdirSync(baseDir)
          .filter(f => f.startsWith("app"))
          .map(f => `${baseDir}\\${f}\\resources\\app.asar`);
      } catch {}
    } else if (process.platform === "darwin") {
      const apps = child_process
        .execSync("mdfind \"kMDItemCFBundleIdentifier == 'com.github.atom'\"", {
          encoding: "utf8",
          timeout: 1000,
        })
        .split("\n");

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

  getResourceDirectory(target?: Target): string {
    if (target !== undefined && target !== this.target) {
      return this.calculateResourceDirectory(target);
    }

    if (!this.resourceDirectory) {
      this.resourceDirectory = this.calculateResourceDirectory(this.target);
    }
    return this.resourceDirectory;
  }

  getReposDirectory(): string {
    if (!this.reposDirectory) {
      this.reposDirectory =
        process.env.ATOM_REPOS_HOME !== undefined
          ? process.env.ATOM_REPOS_HOME
          : path.join(os.homedir(), "github");
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
    const resourceDir = this.getResourceDirectory();
    const metadata =
      path.extname(resourceDir) === ".asar"
        ? JSON.parse(asar.extractFile(resourceDir, "package.json").toString())
        : require(path.join(this.getResourceDirectory(), "package.json"));

    let {version: atomVersion, electronVersion} = metadata;

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

  unsetDefault(name: string) {
    this.config[name] = undefined;
    this.config = JSON.parse(JSON.stringify(this.config));
    this.storeConfig();
    console.log("New config:", this.config);
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

export function getTargetFromString(input: string): Target | undefined {
  switch (input) {
    case "stable":
      return Target.STABLE;
    case "beta":
      return Target.BETA;
    case "nightly":
      return Target.NIGHTLY;
    case "dev":
      return Target.DEV;
  }
  return undefined;
}
