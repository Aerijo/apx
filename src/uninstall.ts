import {Context} from "./context";
import {Arguments} from "yargs";
import * as fs from "fs";

export class Uninstall {
  context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  async handler(argv: Arguments) {
    const packageName = argv.package as string;
    console.log(`uninstalling ${packageName}`);

    const packagesDir = this.context.getAtomPackagesDirectory();

    fs.stat;

    return 0;
  }
}
