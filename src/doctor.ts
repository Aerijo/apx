import * as child_process from "child_process";
import {Context} from "./context";
import {Arguments} from "yargs";
import * as fs from "fs";
import * as rimraf from "rimraf";
import * as path from "path";

export class Doctor {
  context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  doctorNpm(): Promise<number> {
    return new Promise(resolve => {
      const child = child_process.spawn("npm", ["doctor"], {env: this.context.getElectronEnv()});
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", data => {
        console.log(data);
      });
      child.stderr.on("data", data => {
        console.error(data);
      });

      child.on("exit", (code, _signal) => {
        resolve(code || 0);
      });
    });
  }

  checkNativeBuild(): Promise<number> {
    return new Promise(resolve => {
      console.log("Checking native build");
      const nativeModulePath = path.resolve(__dirname, "..", "resources", "native_module");
      fs.accessSync(path.resolve(nativeModulePath, "package.json")); // verify the path resolved to the native_modules correctly (can remove when tests added)

      try {
        rimraf.sync(path.resolve(nativeModulePath, "build"));
      } catch (err) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }

      const child = child_process.spawn("npm", ["build", "."], {
        cwd: nativeModulePath,
        env: this.context.getElectronEnv(),
      });

      let out = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", d => out += d);
      child.stderr.on("data", d => out += d);

      child.on("exit", (code, _status) => {
        if (code) {
          console.error("✘ Build returned with non-zero code, dumping output");
          console.error(out);
        } else {
          console.log("✔ Native module successfully built");
        }

        rimraf(path.resolve(nativeModulePath, "build"), () => {
          resolve(code || 0);
        });
      });
    });
  }

  async handler(_argv: Arguments): Promise<number> {
    await this.checkNativeBuild();
    await this.doctorNpm();
    return 0;
  }
}
