import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import {SemVer} from 'semver';


export class Context {
  private homeDirectory: string | undefined;
  private atomDirectory: string | undefined;
  private resourceDirectory: string | undefined;
  private reposDirectory: string | undefined;
  private atomVersion: SemVer | undefined;
  private electronVersion: SemVer | undefined;

  isWindows (): boolean {
    return process.platform === "win32";
  }

  getHomeDirectory (): string {
    if (!this.homeDirectory) {
      this.homeDirectory = this.isWindows()
        ? process.env.USERPROFILE
        : process.env.HOME;
      if (!this.homeDirectory) {
        throw new Error("Could not locate home directory");
      }
    }
    return this.homeDirectory;
  }

  getAtomDirectory (): string {
    if (!this.atomDirectory) {
      this.atomDirectory = process.env.ATOM_HOME || path.join(this.getHomeDirectory(), '.atom');
    }
    return this.atomDirectory;
  }

  calculateResourceDirectory (): string {
    if (process.env.ATOM_RESOURCE_PATH) {
      return process.env.ATOM_RESOURCE_PATH;
    }

    // TODO: Support Windows
    let appLocation;
    if (process.platform === "darwin") {
      const apps = child_process.execSync("mdfind \"kMDItemCFBundleIdentifier == 'com.github.atom'\"", {
        encoding: "utf8",
        timeout: 1000,
        windowsHide: true,
      }).split("\n");

      if (apps.length > 0) {
        appLocation = `${apps[0]}/Contents/Resources/app.asar`; // TODO: Configurable by flag?
      } else {
        appLocation = "/Applications/Atom.app/Contents/Resources/app.asar";
      }
    } else if (process.platform === "linux") {
      appLocation = "/usr/local/share/atom/resources/app.asar";
      if (!fs.existsSync(appLocation)) {
        appLocation = "/usr/share/atom/resources/app.asar";
      }
    } else {
      throw new Error(`Platform ${process.platform} not supported`);
    }

    if (!fs.existsSync(appLocation)) {
      throw new Error("Could not locate Atom resources path");
    }

    return appLocation;
  }

  getResourceDirectory (): string {
    if (!this.resourceDirectory) {
      this.resourceDirectory = this.calculateResourceDirectory();
    }
    return this.resourceDirectory;
  }

  getReposDirectory (): string {
    if (!this.reposDirectory) {
      this.reposDirectory = process.env.ATOM_REPOS_HOME !== undefined
        ? process.env.ATOM_REPOS_HOME
        : path.join(this.getHomeDirectory(), "github");
    }
    return this.reposDirectory;
  }

  getAtomApiUrl (): string {
    return process.env.ATOM_API_URL || "https://atom.io/api"
  }

  getAtomPackagesUrl (): string {
    return process.env.ATOM_PACKAGES_URL || `${this.getAtomApiUrl()}/packages`;
  }

  getElectronUrl (): string {
    return process.env.ATOM_ELECTRON_URL || "https://atom.io/download/electron";
  }

  getGithubApiUrl (): string {
    return process.env.ATOM_GITHUB_URL || "https://api.github.com";
  }

  getGithubRepoUrl (owner: string, repo: string): string {
    return `${this.getGithubApiUrl()}/repos/${owner}/${repo}`;
  }

  getAtomPackagesDirectory (dev: boolean=false): string {
    return dev
      ? path.join(this.getAtomDirectory(), "dev", "packages")
      : path.join(this.getAtomDirectory(), "packages");
  }

  getAtomNodeDirectory (): string {
    return path.join(this.getAtomDirectory(), ".node-gyp");
  }

  calculateAtomElectronVersions () {
    let {version: atomVersion, electronVersion} = require(path.join(this.getResourceDirectory(), "package.json"));

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

  getAtomVersion (): SemVer {
    if (!this.atomVersion) {
      this.calculateAtomElectronVersions();
    }
    return this.atomVersion!;
  }

  getElectronVersion (): SemVer {
    if (!this.electronVersion) {
      this.calculateAtomElectronVersions();
    }
    return this.electronVersion!;
  }

  getElectronArch (): string {
    return process.env.ATOM_ARCH || process.arch;
  }
}
