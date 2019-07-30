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

  handler(argv: Arguments) {
    const packageName = argv.package as string;

    let runUninstallScript = false;
    let scripts: any;
    let packageDir: string;

    const tasks = new TaskManager([
      {
        title: () => `Uninstalling ${packageName}`,
        task: async (task, ctx) => {
          const packagesDir = this.context.getAtomPackagesDirectory();
          const packageNames = await promisify(fs.readdir)(packagesDir);

          if (packageNames.indexOf(packageName) < 0) {
            task.setTitle(`Package ${packageName} not installed`);
            throw new Error();
          }

          packageDir = path.join(packagesDir, packageName);
          const metadata = await getMetadata(packageDir);
          scripts = metadata.scripts;
          if (typeof scripts === "object" && hasUninstallScript(scripts)) {
            runUninstallScript = true;
          }

          task.complete();
        },
      },
      {
        title: () => "Running uninstall scripts",
        skip: () => {
          return !runUninstallScript ? "No uninstall scripts" : false;
        },
        task: async (task, ctx) => {
          await this.runScript("uninstall", scripts, packageDir); // also runs pre & post
          task.complete();
        },
      },
      {
        title: () => `Deleting ${packageDir}`,
        task: (task, ctx) => {
          rimraf.sync(packageDir);
          task.complete();
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
