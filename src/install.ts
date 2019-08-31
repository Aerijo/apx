import * as fs from "fs";
import * as path from "path";
import {Arguments} from "yargs";
import * as semver from "semver";
import * as rimraf from "rimraf";
import * as tmp from "tmp-promise";
tmp.setGracefulCleanup();
import {promisify} from "util";
import {Context} from "./context";
import {get, getAtomioErrorMessage} from "./request";
import {getMetadata} from "./package";
import {Command} from "./command";
import {TaskManager, TaskContext} from "./tasks";
import {SemVer} from "semver";
import {getOwnerRepo, getGithubRelease} from "./github";

interface PackageLoc {
  version: string;
  tarball: string;
  repository: string;
}

export class Install extends Command {
  constructor(context: Context) {
    super(context);
  }

  async createAtomDirectories(): Promise<void> {
    await Promise.all([
      this.createDir(this.context.getAtomDirectory()),
      this.createDir(this.context.getAtomPackagesDirectory()),
      this.createDir(this.context.getAtomNodeDirectory()),
    ]);
  }

  async downloadFromUrl(tarball: string): Promise<tmp.DirectoryResult> {
    const installDir = await tmp.dir({prefix: "apx-install-", unsafeCleanup: true});
    await new Promise((resolve, reject) => {
      const child = this.spawn("npm", ["install", "--global-style", "--loglevel=error", tarball], {
        cwd: installDir.path,
        stdio: "inherit",
      });

      child.on("exit", (code, status) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm install failed with code ${code} and status ${status}`));
        }
      });
    });
    return installDir;
  }

  async movePackageAndCleanup(
    installDir: tmp.DirectoryResult,
    replaceExisting: boolean
  ): Promise<void> {
    const modulesDir = path.join(installDir.path, "node_modules");
    const contents = (await promisify(fs.readdir)(modulesDir)).filter(n => n !== ".bin");
    if (contents.length !== 1) {
      throw new Error(`Expected only one directory in ${modulesDir}`);
    }
    const name = contents[0];
    const source = path.join(modulesDir, name);
    const dest = path.join(this.context.getAtomPackagesDirectory(), name);
    if (replaceExisting) {
      await promisify(rimraf)(dest);
    }
    await promisify(fs.rename)(source, dest);
    installDir.cleanup();
  }

  installDependencies(_argv: Arguments): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawn("npm", ["install"], {stdio: "inherit"});
      child.on("exit", (code, status) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(`Installing dependencies failed with code ${code} and status ${status}`)
          );
        }
      });
    });
  }

  async getTarballForSpecificPackageVersion(name: string, version: SemVer): Promise<PackageLoc> {
    const requestUrl = `${this.context.getAtomPackagesUrl()}/${name}/versions/${version.format()}`;
    const message = await get({url: requestUrl, json: true});
    if (message.response.statusCode !== 200) {
      throw new Error(
        `Could not retrieve package data for ${name}@${version}: ${getAtomioErrorMessage(message)}`
      );
    }

    return {
      version: version.format(),
      tarball: message.body.dist.tarball,
      repository: getMetadataRepository(message.body),
    };
  }

  async getLatestCompatiblePackage(name: string): Promise<PackageLoc> {
    const requestUrl = `${this.context.getAtomPackagesUrl()}/${name}`;
    const message = (await get({url: requestUrl, json: true})).body;

    if (!message) {
      throw new Error(`Could not retrieve package data for ${name}`);
    }

    if (!message.versions || Object.entries(message.versions).length === 0) {
      throw new Error("No releases for package");
    }

    if (!message.releases || !message.releases.latest) {
      throw new Error("Could not detect latest package version");
    }

    const atomVersion = this.context.getAtomVersion();
    const latest = message.releases.latest as string;
    const latestMeta = message.versions[latest];

    if (versionsMatch(latestMeta, atomVersion)) {
      return {
        version: latest,
        tarball: latestMeta.dist.tarball,
        repository: getMetadataRepository(latestMeta),
      };
    }

    const sortedVersions = Object.entries(message.versions)
      .map(([key, metadata]: [string, any]) => {
        const version = semver.parse(key);
        if (!version || !versionsMatch(metadata, atomVersion)) {
          return undefined;
        }
        return {
          version,
          tarball: metadata.dist.tarball,
          repository: getMetadataRepository(latestMeta),
        };
      })
      .filter((v): v is any => !!v)
      .sort((a, b) => semver.rcompare(a.version, b.version));

    if (sortedVersions.length === 0) {
      throw new Error("No compatible versions detected");
    }

    return sortedVersions[0];
  }

  async getPackageTarball(
    name: string,
    targetVersion: SemVer | undefined,
    github: boolean = true
  ): Promise<string> {
    const {version, tarball, repository} = targetVersion
      ? await this.getTarballForSpecificPackageVersion(name, targetVersion)
      : await this.getLatestCompatiblePackage(name);

    if (github) {
      const {owner, repo} = getOwnerRepo(repository);
      const githubTarball = await getGithubRelease({owner, repo, name, version});
      if (githubTarball) {
        return githubTarball;
      }
    }

    return tarball;
  }

  getPackageNameAndVersion(uri: string): {name: string; version: SemVer | undefined} {
    const versionIndex = uri.indexOf("@");
    if (versionIndex < 0) {
      return {name: uri, version: undefined};
    }
    const versionString = uri.slice(versionIndex + 1);
    const version = semver.parse(versionString);
    const name = uri.slice(0, versionIndex);

    if (!version) {
      throw new Error(`Invalid version '${versionString}'`);
    }

    return {name, version};
  }

  packageExists(packagesPath: string, name: string): Promise<boolean> {
    name = name.toLowerCase();
    return new Promise((resolve, reject) => {
      fs.readdir(packagesPath, (err, files) => {
        if (err) {
          reject(err);
        } else {
          resolve(files.some(f => f.toLowerCase() === name));
        }
      });
    });
  }

  handler(argv: Arguments) {
    const details = this.getPackageNameAndVersion(argv.uri as string);
    const context: TaskContext = {
      packageName: details.name,
      version: details.version,
    };

    const tasks = new TaskManager([
      {
        title: () => "Installing dependencies",
        enabled: ctx => !ctx.packageName || ctx.packageName === ".",
        staticWait: () => true,
        task: async task => {
          await this.installDependencies(argv);
          task.finalComplete();
        },
      },
      {
        title: ctx => `Checking if ${ctx.packageName} is installed`,
        task: async (task, ctx) => {
          await this.createAtomDirectories();
          const packagesDir = this.context.getAtomPackagesDirectory();
          const packageDir = path.join(packagesDir, ctx.packageName);

          if (!(await this.packageExists(packagesDir, ctx.packageName))) {
            task.complete();
            return;
          }

          const noInstall = `Package ${ctx.packageName} already installed`;
          if (!ctx.version) {
            throw new Error(noInstall);
          }

          const metadata = await getMetadata(packageDir);
          const existingVersion = metadata.version && semver.parse(metadata.version);
          if (!existingVersion) {
            throw new Error("Could not detect installed version");
          }

          if (semver.neq(existingVersion, ctx.version)) {
            ctx.replaceExisting = true;
            task.complete(
              `Version ${existingVersion} will be ${
                semver.lt(existingVersion, ctx.version) ? "up" : "down"
              }graded to ${ctx.version}`
            );
          } else {
            throw new Error(`Version ${existingVersion} is already installed`);
          }
        },
      },
      {
        title: () => "Getting package URL",
        skip: ctx => {
          if (ctx.packageName.startsWith("github:")) {
            ctx.tarball = ctx.packageName.slice("github:".length);
            return "GitHub repo specified";
          }
          return false;
        },
        task: async (task, ctx) => {
          try {
            ctx.tarball = await this.getPackageTarball(ctx.packageName, ctx.version);
            task.complete(ctx.tarball);
          } catch (e) {
            task.error(e.message);
          }
        },
      },
      {
        title: ctx => `Installing ${ctx.packageName} for Atom ${this.context.getAtomVersion()}`,
        staticWait: () => true,
        task: async (task, ctx) => {
          task.update("Downloading package");
          const downloadTemp = await this.downloadFromUrl(ctx.tarball);
          task.update("Moving download to packages folder");
          await this.movePackageAndCleanup(downloadTemp, ctx.replaceExisting);
          task.complete();
        },
      },
    ]);

    tasks.run(context);
  }
}

function versionsMatch(metadata: any, atomVersion: string | SemVer): boolean {
  return (
    !metadata.engines ||
    !metadata.engines.atom ||
    semver.satisfies(atomVersion, metadata.engines.atom, {includePrerelease: true})
  );
}

function getMetadataRepository(metadata: any): string {
  let repoUrl = metadata.repository;
  if (repoUrl && metadata.repository.url) {
    repoUrl = metadata.repository.url;
  }

  if (typeof repoUrl !== "string") {
    throw new Error("Expected repository URL");
  }

  return repoUrl;
}
