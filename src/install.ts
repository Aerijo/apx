import * as fs from "fs";
import * as path from "path";

import { Context } from "./main";

export class Install {
  context: Context;

  constructor (context: Context) {
    this.context = context;
  }

  createAtomDirectories () {
    const tryMakeDir = (dir: string) => {
      try {
        fs.mkdirSync(dir, {recursive: true});
      } catch (e) {
        if (e.code !== "EEXIST") {
          console.error(`Could not create required directory ${dir}!`);
          throw e;
        }
      }
    };

    tryMakeDir(this.context.getAtomDirectory());
    tryMakeDir(this.context.getAtomPackagesDirectory());
    tryMakeDir(this.context.getAtomNodeDirectory());
  }

  run () {
    this.createAtomDirectories();
  }
}
