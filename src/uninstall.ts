import {Context} from "./context";
import {Arguments} from "yargs";
import * as fs from "fs";
import * as path from "path";
import {getMetadata} from "./package";
import * as rimraf from "rimraf";
import {Command} from "./command";
import {TaskManager} from "./tasks";
import {promisify} from "util";

export class Uninstall extends Command {
  constructor(context: Context) {
    super(context);
  }

  runScript(name: string, scripts: any, cwd: string): Promise<void> {
    if (typeof scripts[name] === "string") {
      return new Promise((resolve, reject) => {
        const child = this.spawn(
          "npm",
          ["run", name],
          {
            cwd,
            stdio: "inherit",
          },
          {reject}
        );
        child.on("exit", err => {
          if (err) {
            reject(new Error(`Process exited with code ${err}`));
          } else {
            resolve();
          }
        });
      });
    } else {
      return Promise.resolve();
    }
  }

  handler(argv: Arguments) {
    const packageName = argv.package as string;

    let runUninstallScript = false;

    const tasks = new TaskManager([
      {
        title: () => `Uninstalling ${packageName}`,
        task: async (task, ctx) => {
          const packagesDir = this.context.getAtomPackagesDirectory();
          const packageNames = await promisify(fs.readdir)(packagesDir);

          if (packageNames.indexOf(packageName) < 0) {
            let message = `Package "${packageName}" not installed`;
            const closestMatch = await getClosestMatch(packageName, packageNames);
            if (closestMatch !== undefined) {
              message = `${message}. Did you mean "${closestMatch}"?`;
            }
            throw new Error(message);
          }

          ctx.packageDir = path.join(packagesDir, packageName);
          const metadata = await getMetadata(ctx.packageDir);
          ctx.scripts = metadata.scripts;
          if (typeof ctx.scripts === "object" && hasUninstallScript(ctx.scripts)) {
            runUninstallScript = true;
          }

          task.complete();
        },
      },
      {
        title: () => "Running uninstall scripts",
        skip: () => (runUninstallScript ? false : "No uninstall scripts"),
        staticWait: () => true,
        task: async (task, ctx) => {
          await this.runScript("uninstall", ctx.scripts, ctx.packageDir); // also runs pre & post
          task.complete();
        },
      },
      {
        title: ctx => `Deleting ${ctx.packageDir}`,
        task: (task, ctx) => {
          rimraf.sync(ctx.packageDir);
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

async function getClosestMatch(name: string, installed: string[]): Promise<string | undefined> {
  name = name.toLowerCase();
  const editDist = await import("js-levenshtein");

  let bestName: string | undefined = undefined;
  let bestScore = Infinity;

  for (const packName of installed) {
    const dist = editDist(name, packName.toLowerCase());
    if (dist < bestScore) {
      bestName = packName;
      bestScore = dist;
    }
  }

  return bestScore < 3 ? bestName : undefined;
}
