import {Context, Target, displayNameForTarget} from "./context";
import {Arguments} from "yargs";
import * as fs from "fs";
import * as rimraf from "rimraf";
import * as path from "path";
import {Command} from "./command";
import {TaskManager, Task} from "./tasks";

export class Doctor extends Command {
  constructor(context: Context) {
    super(context);
  }

  getResourceDirForTarget(target: Target): string | undefined {
    try {
      return this.context.calculateResourceDirectory(target, false);
    } catch {
      return undefined;
    }
  }

  async doctorApx(): Promise<Map<string, () => string>> {
    const properties = new Map([
      ["Atom version", () => this.context.getAtomVersion().version],
      ["Electron version", () => this.context.getElectronVersion().version],
      ["Atom directory", () => this.context.getAtomDirectory()],
      ["Resource path", () => this.context.getResourceDirectory()],
      ["Executable path", () => this.context.getAtomExecutable()],
      ["apx config path", () => this.context.getConfigPath()],
    ]);

    properties.set("Detected apps", () => {
      const targets = [Target.STABLE, Target.BETA, Target.NIGHTLY, Target.DEV];
      const detectedAtoms = [];
      for (const target of targets) {
        if (this.getResourceDirForTarget(target) !== undefined) {
          detectedAtoms.push(displayNameForTarget(target));
        }
      }
      return detectedAtoms.join(", ");
    });

    properties.set(`Electron executable versions`, () => {
      const trueVersions = this.context.getTrueElectronVersions();
      const versions = [...trueVersions.entries()].map(([n, v]) => `  - ${n}: ${v}`).join("\n");
      return "\n" + versions;
    });

    return properties;
  }

  doctorNpm(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.spawn("npm", ["doctor", "--loglevel=warn"], {stdio: "inherit"}, {reject}).on(
        "exit",
        (code, _signal) => {
          if (code) {
            reject(code);
            return;
          }
          resolve();
        }
      );
    });
  }

  checkNativeBuild(task: Task): Promise<void> {
    return new Promise((resolve, reject) => {
      const nativeModulePath = path.resolve(__dirname, "..", "resources", "native_module");
      fs.accessSync(path.resolve(nativeModulePath, "package.json")); // verify the path resolved to the native_modules correctly (can remove when tests added)

      task.update("Clearing old build files");
      try {
        rimraf.sync(path.resolve(nativeModulePath, "build"));
      } catch (err) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }

      task.update("Building native module");
      const child = this.spawn(
        "npm",
        ["build", "."],
        {
          cwd: nativeModulePath,
        },
        {reject}
      );

      let out = "";
      child.stdout.on("data", d => (out += d));
      child.stderr.on("data", d => (out += d));

      child.on("exit", (code, _status) => {
        if (code) {
          out = out.trim() + "\n";
          task.postWrite(out);
          task.nonFatalError("Failed to build native module. Dumping output.");
          reject();
          return;
        }

        task.update("Clearing build files");
        rimraf(path.resolve(nativeModulePath, "build"), () => {
          resolve();
        });
      });
    });
  }

  async doctorAtom(): Promise<number> {
    return 0; // TODO: Verify the Atom install & .atom folder is valid
  }

  handler(_argv: Arguments) {
    const tasks = new TaskManager([
      {
        title: () => "Detecting configuration",
        task: async task => {
          const results = await this.doctorApx();
          let prettyPrint = "";
          let errored = false;
          for (const [key, val] of results.entries()) {
            try {
              prettyPrint += `- ${key}: ${val()}\n`;
            } catch (e) {
              prettyPrint += `! Failed to calculate ${key}: ${e}\n`;
              errored = true;
            }
          }
          task.postWrite(prettyPrint);
          errored ? task.nonFatalError("Error in some checks") : task.complete();
        },
      },
      {
        title: () => "Checking native build tools",
        task: async task => {
          await this.checkNativeBuild(task);
          task.complete("Successfully built native module");
        },
      },
      {
        title: () => "Checking npm",
        staticWait: () => true,
        task: async task => {
          await this.doctorNpm();
          task.complete();
        },
      },
    ]);

    tasks.run();
  }
}
