import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import * as tmp from "tmp";
tmp.setGracefulCleanup();

import {Context} from "./context";
import {Arguments} from "yargs";

export class Install {
  context: Context;

  constructor (context: Context) {
    this.context = context;
  }

  createAtomDirectories () {
    tryMakeDir(this.context.getAtomDirectory());
    tryMakeDir(this.context.getAtomPackagesDirectory());
    tryMakeDir(this.context.getAtomNodeDirectory());
  }

  getElectronBuildFlags (): string[] {
    return [
      `--target=${this.context.getElectronVersion().version}`,
      `--disturl=${this.context.getElectronUrl()}`,
      `--arch=${this.context.getElectronArch()}`,
    ]
  }

  installModule (tarballUrl: string) {
    const installDir = tmp.dirSync({prefix: "apx-install-", unsafeCleanup: true});
    const modulesDir = path.join(installDir.name, "node_modules");
    fs.mkdirSync(modulesDir);

    const result = child_process.spawnSync(
      "npm",
      [
        "install",
        "--global-style",
        tarballUrl,
        ...this.getElectronBuildFlags(),
      ],
      {
        cwd: installDir.name,
        encoding: "utf8",
      }
    )

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`npm install exited with non-zero status ${result.status}`);
    }

    const packDir = fs.readdirSync(modulesDir).filter(n => n !== ".bin");
    if (packDir.length !== 1) {
      throw new Error(`Expected only one directory in ${packDir}`);
    }

    const packName = packDir[0];
    const source = path.join(modulesDir, packName);
    const dest = path.join(this.context.getAtomPackagesDirectory(), packName);

    console.log(`renaming ${source} to ${dest}`);
    try {
      fs.renameSync(source, dest);
    } catch (e) {
      throw e;
    }

    console.log("vvvvv");
    console.log(result.stdout.toString());
    console.log("^^^^^");

    installDir.removeCallback();
  }

  installDependencies (argv: Arguments) {
    console.log("installing dependencies...");
  }

  async handler (argv: Arguments) {
    let packageName = argv.uri as string;
    let version;

    if (packageName === ".") {
      this.installDependencies(argv);
      return;
    }

    const versionIndex = packageName.indexOf("@");
    if (versionIndex > 0) {
      version = packageName.slice(versionIndex + 1);
      packageName = packageName.slice(0, versionIndex);
    }

    this.createAtomDirectories();

    this.installModule(packageName, version);
  }
}


function tryMakeDir (dir: string) {
  try {
    fs.mkdirSync(dir, {recursive: true});
  } catch (e) {
    if (e.code !== "EEXIST") {
      console.error(`Could not create required directory ${dir}`);
      throw e;
    }
  }
}
