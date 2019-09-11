import {Arguments} from "yargs";
import * as path from "path";
import {Context} from "./context";
import {getMetadata, getPackageDetails, getAssetName} from "./package";
import {Token, unsafeGetToken} from "./auth";
import {Command} from "./command";
import {TaskManager} from "./tasks";
import {getOrCreateRelease, verifyTagExists, ReleaseDetails, uploadReleaseAsset} from "./github";
import {DirectoryResult} from "tmp-promise";
import {registerPackage, publishVersion, PublishStatus, VersionStatus} from "./atomio";

export class Publish extends Command {
  cwd: string;

  constructor(context: Context) {
    super(context);
    this.cwd = process.cwd();
  }

  getTagPrefix(): string {
    return "v";
  }

  getTagFromVersion(version: string): string {
    return `${this.getTagPrefix()}${version}`;
  }

  updateVersion(version: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = this.spawn(
        "npm",
        [
          "version",
          version,
          "-m",
          "Prepare v%s release",
          "--tag-version-prefix",
          this.getTagPrefix(),
        ],
        {stdio: "inherit"},
        {reject}
      );
      child.on("exit", code => {
        if (code) {
          throw new Error(`Version change exited with code ${code}`);
        }
        resolve(getMetadata(this.cwd).then(m => this.getTagFromVersion(m.version)));
      });
    });
  }

  pushCommitsAndTags(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.spawn("git", ["push", "--follow-tags"], {}, {reject}).on("exit", code => {
        if (code) {
          reject(new Error(`Failed to push: code ${code}`));
        } else {
          resolve();
        }
      });
    });
  }

  async getTarname(metadata: any): Promise<string> {
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

    return `${name}-${version}.tgz`;
  }

  async generateReleaseAssets(stdio?: string): Promise<{tarname: string; dir: DirectoryResult}> {
    const metadata = await getMetadata(this.cwd);
    const tarname = await this.getTarname(metadata);
    const tmpDir = await this.getTempDir({prefix: "apx-pack-", unsafeCleanup: true});

    await new Promise(async (resolve, reject) => {
      await this.runScript("prepublishOnly", metadata.scripts, this.cwd);
      this.spawn("npm", ["pack", this.cwd], {stdio, cwd: tmpDir.path}).on("exit", code => {
        if (code) {
          reject(new Error(`npm pack failed with code ${code}`));
        }
        resolve();
      });
    });

    return {tarname, dir: tmpDir};
  }

  handler(argv: Arguments) {
    const tasks = new TaskManager([
      {
        title: () => "Checking preconditions",
        task: async task => {
          // Verify the package.json is well formed (at least before starting)
          // No point storing, as scripts can change values
          await getPackageDetails(this.cwd);

          // Verify the required tokens will exist
          await unsafeGetToken(Token.ATOMIO);
          await unsafeGetToken(Token.GITHUB);

          task.complete();
        },
      },
      {
        title: () => "Bumping package version",
        skip: async ctx => {
          if (ctx.versionBump) {
            return false;
          }

          ctx.assetsOnly = true;
          const {version} = await getPackageDetails(this.cwd);
          ctx.tag = this.getTagFromVersion(version);
          return "Version change not specified, skipping increment";
        },
        staticWait: () => true,
        task: async (task, ctx) => {
          task.update("Updating package version");
          ctx.tag = await this.updateVersion(ctx.versionBump);

          task.update("Pushing commits and tags to GitHub");
          await this.pushCommitsAndTags();

          task.complete(`Bumped package version to ${ctx.tag}`);
        },
      },
      {
        title: () => `Creating GitHub release`,
        task: async (task, ctx) => {
          const tag = ctx.tag;
          if (typeof tag !== "string") {
            throw new Error("Unexpected missing tag");
          }

          task.update("Verifying tag is visible");
          const {owner, repo} = await getPackageDetails(this.cwd);
          const attempts = 5;
          const retry = (alreadyTried: number): boolean => {
            if (alreadyTried < attempts) {
              task.update(`Verifying tag is visible (attempt ${alreadyTried + 1} of ${attempts})`);
              return true;
            }
            return false;
          };
          await verifyTagExists(owner, repo, tag, retry);

          task.update(`Getting or creating release`);
          const releaseDetails = await getOrCreateRelease(owner, repo, tag);
          ctx.releaseDetails = releaseDetails;

          const releaseMsg = releaseDetails.created
            ? `Created new release`
            : `Found existing release`;

          task.complete(`${releaseMsg}: ${releaseDetails.html_url}`);
        },
      },
      {
        title: ctx => `Registering version ${ctx.tag} to atom.io`,
        task: async (task, ctx) => {
          task.update("Registering package");
          const {owner, repo, name} = await getPackageDetails(this.cwd);
          const apiurl = this.context.getAtomApiUrl();
          const publishResult = await registerPackage(apiurl, owner, repo);

          task.update("Publishing version");
          const versionResult = await publishVersion(apiurl, name, ctx.tag);

          const msg =
            publishResult === PublishStatus.SUCCESS
              ? versionResult === VersionStatus.SUCCESS
                ? "Registered new package and published new version"
                : "Registered new package, version already published. Please report this as a bug."
              : versionResult === VersionStatus.SUCCESS
              ? "Published new version"
              : "Version already published";

          task.complete(msg);
        },
      },
      {
        title: () => "Publishing package assets",
        enabled: ctx => ctx.bundleRelease,
        staticWait: () => true,
        task: async (task, ctx) => {
          if (ctx.releaseDetails === undefined) {
            throw new Error("No details of release. Please report this as a bug.");
          }
          const releaseDetails: ReleaseDetails = ctx.releaseDetails;

          task.update("Building release asset");
          const {dir, tarname} = await this.generateReleaseAssets("ignore");

          task.update("Uploading asset");
          const filepath = path.join(dir.path, tarname);
          const {name, version} = await getPackageDetails(this.cwd);
          const uploadName = getAssetName(name, version);
          await uploadReleaseAsset(releaseDetails, filepath, uploadName);

          await dir.cleanup();
          task.complete();
        },
      },
    ]);

    tasks.run({
      bundleRelease: argv.assets,
      versionBump: argv.newversion,
    });
  }
}
