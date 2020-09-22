import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as semver from "semver";
import {SemVer} from "semver";
import * as asar from "asar";
import {forEachToken} from "./auth";
import {NullLog, Log} from "./log";

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
  log: Log = new NullLog();

  constructor() {
    this.config = this.loadConfig();
    this.target =
      (typeof this.config.target === "string" && getTargetFromString(this.config.target)) ||
      Target.STABLE;
  }

  getTarget(): Target {
    return this.target;
  }

  setTarget(target: Target) {
    this.log.silly(`Attempting to set target to ${target}`);
    if (target === this.target) {
      this.log.silly(`Target already ${target}`);
    }
    this.log.verbose(`Setting target to ${target}`);
    this.target = target;
    this.resourceDirectory = undefined;
    this.atomVersion = undefined;
    this.electronVersion = undefined;
  }

  getConfigPath(): string {
    this.log.silly("Getting config path");

    let configPath: string;
    if (typeof process.env.APX_CONFIG_PATH === "string") {
      this.log.verbose(`Config path set via APX_CONFIG_PATH`);
      configPath = process.env.APX_CONFIG_PATH;
    } else {
      configPath = path.join(this.getAtomDirectory(), ".apxrc");
    }

    this.log.verbose(`Config path is '${configPath}'`);
    return configPath;
  }

  loadConfig(): {[key: string]: any} {
    this.log.silly("Loading config file");
    const configPath = this.getConfigPath();
    try {
      this.log.silly("Reading config file");
      const contents = fs.readFileSync(configPath, {encoding: "utf8"});
      this.log.silly("Parsing config file");
      const parsed = JSON.parse(contents);
      this.log.silly("Parsed config file");
      return parsed;
    } catch (e) {
      this.log.silly(`Error loading config: ${e}`);
      return {};
    }
  }

  storeConfig() {
    this.log.silly("Storing config to file");
    const configPath = this.getConfigPath();
    const configContents = JSON.stringify(this.config, undefined, 2);
    fs.writeFileSync(configPath, configContents, {encoding: "utf8"});
    this.log.silly("Stored config to file");
    return;
  }

  getAtomDirectory(): string {
    if (!this.atomDirectory) {
      this.log.silly("Calculating atom directory");

      if (typeof process.env.ATOM_HOME === "string") {
        this.log.verbose(`Atom directory set via ATOM_HOME`);
        this.atomDirectory = process.env.ATOM_HOME;
      } else {
        this.atomDirectory = path.join(os.homedir(), ".atom");
      }

      this.log.verbose(`Atom home is ${this.atomDirectory}`);
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
      case Target.DEV:
        return "atom";
    }
  }

  getAtomDevRepo(): string {
    this.log.silly("Getting Atom dev repo");
    return path.join(this.getReposDirectory(), "atom");
  }

  private getDirectoriesWithNameStart(dir: string, start: string): string[] {
    const nodes = fs.readdirSync(dir, {withFileTypes: true});
    return nodes.filter(n => n.isDirectory() && n.name.startsWith(start)).map(n => n.name);
  }

  getAtomDevAppDirectory(outDirectory: string): string {
    this.log.silly("Getting Atom Dev app directory");

    switch (process.platform) {
      case "linux":
        const dirs = this.getDirectoriesWithNameStart(outDirectory, "atom-dev-");
        if (dirs.length > 0) {
          return path.join(outDirectory, dirs[0]);
        }
        break;
      case "darwin":
        return path.join(outDirectory, this.appNameForTarget(Target.DEV));
      default:
        this.log.error(`Platform ${process.platform} not supported`);
        throw new Error(`Platform ${process.platform} not supported`);
    }

    throw new Error("Did not find Atom dev app directory");
  }

  /**
   * Finds the path to the application executable. This is the one that
   * is the electron process, and can be run as a node process by setting
   * ELECTRON_RUN_AS_NODE in the environment.
   */
  getAtomExecutable(target: Target = this.target, useEnv: boolean = true): string {
    this.log.silly("Getting Atom executable location");

    if (process.env.ATOM_EXECUTABLE_PATH && useEnv) {
      this.log.verbose(`Atom executable location set via ATOM_EXECUTABLE_PATH`);
      return process.env.ATOM_EXECUTABLE_PATH;
    }

    if (target === Target.DEV) {
      const base = path.join(this.getAtomDevRepo(), "out");
      const appPath = this.getAtomDevAppDirectory(base);
      return this.getAtomExecutableFromBase(target, appPath);
    }

    let locations: string[];
    switch (process.platform) {
      case "linux":
        locations = this.getLinuxAppCandidates(target).map(p =>
          this.getAtomExecutableFromBase(target, p)
        );
        break;
      case "darwin":
        locations = this.getMacAppCandidates(target).map(p =>
          this.getAtomExecutableFromBase(target, p)
        );
        break;
      case "win32":
        locations = this.getWindowsAppCandidates(target).map(p =>
          this.getAtomExecutableFromBase(target, p)
        );
        break;
      default:
        throw new Error(`Platform ${process.platform} not supported yet`);
    }

    this.log.silly(`Candidate executable paths: ${locations}`);

    for (const location of locations) {
      if (fs.existsSync(location)) {
        this.log.silly(`Location ${location} found to exist, using it`);
        return location;
      }
    }

    throw new Error("Could not find executable path");
  }

  getAtomExecutableFromBase(target: Target = this.target, base: string): string {
    switch (process.platform) {
      case "linux":
        return path.join(base, this.appNameForTarget(target));
      case "darwin":
        return path.join(base, "Contents", "MacOS", displayNameForTarget(target));
      case "win32":
        return path.join(base, `${this.appNameForTarget(target)}.exe`);
    }

    throw new Error("Unknown platform");
  }

  getMacAppCandidates(target: Target = this.target): string[] {
    const appName = this.appNameForTarget(target);

    let locations = [`/Applications/${appName}`, `${process.env.HOME}/Applications/${appName}`];

    try {
      locations = locations.concat(
        child_process
          .execSync("mdfind \"kMDItemCFBundleIdentifier == 'com.github.atom'\"", {
            encoding: "utf8",
            timeout: 1000,
          })
          .split("\n")
          .filter(p => path.basename(p) === appName)
      );
    } catch {}

    return locations;
  }

  getLinuxAppCandidates(target: Target = this.target): string[] {
    const appName = this.appNameForTarget(target);
    return [`/usr/share/${appName}`, `/usr/local/share/${appName}`];
  }

  getWindowsAppCandidates(target: Target = this.target): string[] {
    const baseDir = path.join(os.homedir(), "AppData", "Local", this.appNameForTarget(target));
    return this.getDirectoriesWithNameStart(baseDir, "app-").map(n => path.join(baseDir, n));
  }

  getAtomInstallLocation(target: Target = this.target): string {
    let locations: string[];
    switch (process.platform) {
      case "darwin":
        locations = this.getMacAppCandidates(target);
        break;
      case "linux":
        locations = this.getLinuxAppCandidates(target);
        break;
      case "win32":
        locations = this.getWindowsAppCandidates(target).map(p => path.dirname(p));
        break;
      default:
        throw new Error(`Unsupported platform ${process.platform}`);
    }

    for (const location of locations) {
      if (fs.existsSync(location)) {
        return location;
      }
    }

    throw new Error("Did not find any install locations");
  }

  getWindowsResourceDirectoryCandidates(target: Target): string[] {
    return this.getWindowsAppCandidates(target).map(n => path.join(n, "resources", "app.asar"));
  }

  calculateResourceDirectory(target: Target, useEnv: boolean = true): string {
    this.log.silly("Calculating resource directory");

    if (process.env.ATOM_RESOURCE_PATH && useEnv) {
      this.log.verbose(
        `Resource directory set via ATOM_RESOURCE_PATH to ${process.env.ATOM_RESOURCE_PATH}`
      );
      return process.env.ATOM_RESOURCE_PATH;
    }

    if (target === Target.DEV) {
      const location = path.join(this.getReposDirectory(), "atom");
      if (fs.existsSync(location)) {
        this.log.silly(`Resource directory for target DEV: ${location}`);
        return location;
      }
      this.log.error("Could not find resource directory for taget DEV");
      throw new Error("Could not find Atom dev repo");
    }

    let appLocations: string[];

    if (process.platform === "win32") {
      appLocations = this.getWindowsResourceDirectoryCandidates(target);
    } else if (process.platform === "darwin") {
      appLocations = this.getMacAppCandidates(target).map(p =>
        path.join(p, "Contents", "Resources", "app.asar")
      );
    } else if (process.platform === "linux") {
      appLocations = this.getLinuxAppCandidates(target).map(p =>
        path.join(p, "resources", "app.asar")
      );
    } else {
      throw new Error(`Platform ${process.platform} not supported`);
    }

    this.log.silly(`Considering app locations: ${appLocations}`);

    for (const location of appLocations) {
      if (fs.existsSync(location)) {
        this.log.silly(`Location ${location} found to exist, using it`);
        return location;
      }
    }

    throw new Error("Could not locate Atom resources path");
  }

  getResourceDirectory(target: Target = this.target): string {
    this.log.silly("Getting resource directory");

    if (target !== this.target) {
      this.log.silly("Requested target not default target; calculating location");
      return this.calculateResourceDirectory(target);
    }

    if (!this.resourceDirectory) {
      this.resourceDirectory = this.calculateResourceDirectory(this.target);
    }

    this.log.silly(`Resource directory is ${this.resourceDirectory}`);
    return this.resourceDirectory;
  }

  /**
   * The path to a directory that contains the `atom` repo as an
   * immediate child.
   */
  getReposDirectory(): string {
    this.log.silly("Getting repos directory");

    if (!this.reposDirectory) {
      if (typeof process.env.ATOM_REPOS_HOME === "string") {
        this.log.verbose(`Repos directory set via ATOM_REPOS_HOME`);
        this.reposDirectory = process.env.ATOM_REPOS_HOME;
      } else {
        this.reposDirectory = path.join(os.homedir(), "github");
      }
    }

    this.log.silly(`Repos directory is ${this.reposDirectory}`);
    return this.reposDirectory;
  }

  getAtomApiUrl(): string {
    this.log.silly("Getting Atom repos URL");

    if (typeof process.env.ATOM_API_URL === "string") {
      this.log.verbose(`Atom repos URL set via ATOM_API_URL to ${process.env.ATOM_API_URL}`);
      return process.env.ATOM_API_URL;
    }

    return "https://atom.io/api";
  }

  getAtomPackagesUrl(): string {
    this.log.silly("Getting Atom packages URL");

    if (typeof process.env.ATOM_PACKAGES_URL === "string") {
      this.log.verbose(
        `Atom packages URL set via ATOM_PACKAGES_URL to ${process.env.ATOM_PACKAGES_URL}`
      );
      return process.env.ATOM_PACKAGES_URL;
    }

    return `${this.getAtomApiUrl()}/packages`;
  }

  getElectronUrl(): string {
    this.log.silly("Getting Electron URL");

    if (typeof process.env.ATOM_ELECTRON_URL === "string") {
      this.log.verbose(
        `Electorn URL set via ATOM_ELECTRON_URL to ${process.env.ATOM_ELECTRON_URL}`
      );
      return process.env.ATOM_ELECTRON_URL;
    }

    return "https://atom.io/download/electron";
  }

  getGithubApiUrl(): string {
    this.log.silly("Getting GitHub API URL");

    if (typeof process.env.ATOM_GITHUB_URL === "string") {
      this.log.verbose(`GitHub API URL set via ATOM_GITHUB_URL to ${process.env.ATOM_GITHUB_URL}`);
      return process.env.ATOM_GITHUB_URL;
    }

    return "https://api.github.com";
  }

  getGithubRepoUrl(owner: string, repo: string): string {
    this.log.silly(`Getting GitHub repo URL (owner=${owner}, repo=${repo})`);
    return `${this.getGithubApiUrl()}/repos/${owner}/${repo}`;
  }

  getAtomPackagesDirectory(dev: boolean = false): string {
    this.log.silly(`Getting Atom packages directory (dev=${dev})`);

    return dev
      ? path.join(this.getAtomDirectory(), "dev", "packages")
      : path.join(this.getAtomDirectory(), "packages");
  }

  getAtomNodeDirectory(): string {
    this.log.silly("Getting Atom node-gyp directory");
    return path.join(this.getAtomDirectory(), ".node-gyp");
  }

  calculateAtomElectronVersions() {
    this.log.silly("Calculating Atom and Electron versions");

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
    this.log.silly("Getting Atom version");
    if (!this.atomVersion) {
      this.calculateAtomElectronVersions();
    }
    this.log.silly(`Atom version is ${this.atomVersion}`);
    return this.atomVersion!;
  }

  getTrueElectronVersions(target: Target = this.target): Map<string, string> {
    const executable = this.getAtomExecutable(target);

    const out = child_process.spawnSync(
      executable,
      ["-e", "console.log(JSON.stringify(process.versions))"],
      {
        encoding: "utf8",
        env: {...process.env, ELECTRON_RUN_AS_NODE: "1"},
      }
    );

    return new Map(Object.entries(JSON.parse(out.stdout)));
  }

  getElectronVersion(): SemVer {
    this.log.silly("Getting Electron version");
    if (!this.electronVersion) {
      this.calculateAtomElectronVersions();
    }
    this.log.silly(`Electron version is ${this.electronVersion}`);
    return this.electronVersion!;
  }

  getElectronArch(): string {
    this.log.silly("Getting Electron arch");

    if (typeof process.env.ATOM_ARCH === "string") {
      this.log.verbose(`Electron arch set via ATOM_ARCH to ${process.env.ATOM_ARCH}`);
      return process.env.ATOM_ARCH;
    }

    this.log.silly(`Electron arch is ${process.arch}`);
    return process.arch;
  }

  // See https://electronjs.org/docs/tutorial/using-native-node-modules#using-npm
  getElectronEnv(includeDefault: boolean = true): {[key: string]: string} {
    this.log.silly("Getting Electron environment");

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

    const env: {[key: string]: string} = includeDefault
      ? {...process.env, ...electronVars}
      : electronVars;

    // Prevent spawned processes seeing auth tokens.
    forEachToken(details => {
      delete env[details.env];
    });

    this.log.silly(`Electron environment: ${require("util").inspect(env)}`);

    return env;
  }

  getDefault(name: string): string | undefined {
    this.log.silly(`Getting default valude for ${name}`);
    return this.config[name];
  }

  unsetDefault(name: string) {
    this.log.verbose(`Unsetting default value for ${name}`);
    this.config[name] = undefined;
    this.config = JSON.parse(JSON.stringify(this.config));
    this.storeConfig();
  }

  setDefault(name: string, value: string) {
    this.log.verbose(`Setting default value for ${name} to ${value}`);
    this.config[name] = value;
    this.storeConfig();
  }

  getConfig(): {[key: string]: any} {
    this.log.silly("Getting config");
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
    case "tdev":
      return Target.DEV;
  }
  return undefined;
}
