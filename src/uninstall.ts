import {Context} from "./context";
import {Arguments} from "yargs";
import * as fs from "fs";
import * as path from "path";
import {getMetadata} from "./package";
import * as rimraf from "rimraf";
import * as child_process from "child_process";

export class Uninstall {
  context: Context;

  constructor(context: Context) {
    this.context = context;
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
    console.log(`uninstalling ${packageName}`);

    const packagesDir = this.context.getAtomPackagesDirectory();

    const packageNames = fs.readdirSync(packagesDir);

    if (packageNames.indexOf(packageName) < 0) {
      throw new Error(`Package ${packageName} not installed`);
    }

    const packageDir = path.join(packagesDir, packageName);
    const metadata = await getMetadata(packageDir);

    const scripts = metadata.scripts;
    if (typeof scripts !== "object") {
      rimraf.sync(packageDir);
    } else {
      await this.runScript("uninstall", scripts, packageDir); // also runs pre & post
      console.log("removing", packageDir);
      rimraf.sync(packageDir);
    }

    return 0;
  }
}
