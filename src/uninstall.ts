import {Context} from "./context";
import {Arguments} from "yargs";
import * as fs from "fs";
import * as path from "path";
import {getMetadata} from "./package";
import * as rimraf from "rimraf";
import * as child_process from "child_process";
import {Command} from "./command";
import {TaskManager} from "./tasks";
import {promisify} from "util";

export class Uninstall extends Command {
  constructor(context: Context) {
    super(context);
  }

  runScript(name: string, scripts: any, cwd: string): Promise<void> {
    if (typeof scripts[name] === "string") {
      console.log(
        child_process.spawnSync("npm", ["run", name], {
          encoding: "utf8",
          env: this.context.getElectronEnv(),
          cwd,
        }).stdout
      );
    }
    return Promise.resolve();
  }

  async handler(argv: Arguments) {
    const packageName = argv.package as string;
    const self = this;

    let runUninstallScript = false;
    let scripts: any;
    let packageDir: string;

    const tasks = new TaskManager([
      {
        title: () => `Uninstalling ${packageName}`,
        async task() {
          const packagesDir = self.context.getAtomPackagesDirectory();
          const packageNames = await promisify(fs.readdir)(packagesDir);

          if (packageNames.indexOf(packageName) < 0) {
            this.title = `Package ${packageName} not installed`;
            throw new Error();
          }

          packageDir = path.join(packagesDir, packageName);
          const metadata = await getMetadata(packageDir);
          scripts = metadata.scripts;
          if (typeof scripts === "object" && hasUninstallScript(scripts)) {
            runUninstallScript = true;
          }
        },
      },
      {
        title: "Running uninstall scripts",
        skip() {
          if (!runUninstallScript) {
            this.title = "No uninstall scripts - skipping";
          }
          return !runUninstallScript;
        },
        async task() {
          await self.runScript("uninstall", scripts, packageDir); // also runs pre & post
        },
      },
      {
        title: () => `Deleting ${packageDir}`,
        task() {
          rimraf.sync(packageDir);
        },
      },
    ]);

    tasks.run();
  }
}

function hasUninstallScript(scripts: any): boolean {
  return (
    typeof scripts === "object" &&
    (scripts.preuninstall || scripts.uninstall || scripts.postuninstall)
  );
}
