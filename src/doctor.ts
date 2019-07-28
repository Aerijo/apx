import {Context, Target, displayNameForTarget} from "./context";
import {Arguments} from "yargs";
import * as fs from "fs";
import * as rimraf from "rimraf";
import * as path from "path";
import {Command} from "./command";
import {TaskManager} from "./tasks";

export class Doctor extends Command {
  constructor(context: Context) {
    super(context);
  }

  async getResourceDirForTarget(target: Target): Promise<string | undefined> {
    try {
      return this.context.calculateResourceDirectory(target, false);
    } catch {
      return undefined;
    }
  }

  async doctorApx(): Promise<Map<string, string>> {
    const properties = new Map([
      ["Atom version", this.context.getAtomVersion().version],
      ["Electron version", this.context.getElectronVersion().version],
      ["Atom directory", this.context.getAtomDirectory()],
      ["Resource path", this.context.getResourceDirectory()],
      ["apx config path", this.context.getConfigPath()],
    ]);

    const detectedAtoms = [Target.STABLE, Target.BETA, Target.NIGHTLY, Target.DEV]
      .filter(t => this.getResourceDirForTarget(t))
      .map(displayNameForTarget);
    properties.set("Detected apps", detectedAtoms.join(", "));

    return properties;
  }

  doctorNpm(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawn("npm", ["doctor", "--loglevel=warn"], {stdio: "inherit"});

      child.on("exit", (code, _signal) => {
        if (code) {
          reject(code);
          return;
        }
        resolve();
      });
    });
  }

  checkNativeBuild(): Promise<void> {
    return new Promise((resolve, reject) => {
      const nativeModulePath = path.resolve(__dirname, "..", "resources", "native_module");
      fs.accessSync(path.resolve(nativeModulePath, "package.json")); // verify the path resolved to the native_modules correctly (can remove when tests added)

      try {
        rimraf.sync(path.resolve(nativeModulePath, "build"));
      } catch (err) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }

      const child = this.spawn("npm", ["build", "."], {
        cwd: nativeModulePath,
      });

      let out = "";
      child.stdout.on("data", d => (out += d));
      child.stderr.on("data", d => (out += d));

      child.on("exit", (code, _status) => {
        if (code) {
          reject(out);
          return;
        }

        rimraf(path.resolve(nativeModulePath, "build"), () => {
          resolve();
        });
      });
    });
  }

  async doctorAtom(): Promise<number> {
    return 0; // TODO: Verify the Atom install & .atom folder is valid
  }

  async handler(_argv: Arguments) {
    const self = this;
    const tasks = new TaskManager([
      {
        title: "Detecting configuration",
        async task() {
          const results = await self.doctorApx();
          let prettyPrint = "";
          for (const [key, val] of results.entries()) {
            prettyPrint += `- ${key}: ${val}\n`;
          }

          this.title = "Detected configuration";
          return prettyPrint;
        },
      },
      {
        title: "Checking native build tools",
        async task() {
          try {
            await self.checkNativeBuild();
            this.title = "Successfully built native module";
          } catch (e) {
            this.title = "Failed to build native module; dumping output";
            throw new Error(e);
          }
        },
      },
      {
        title: "Checking npm",
        async task() {
          await self.doctorNpm();
          this.title = "Checked npm";
        },
      },
    ]);

    tasks.run();
  }
}
