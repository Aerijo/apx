import * as fs from "fs";
import * as path from "path";

export function getMetadata(packageDir: string): Promise<any> {
  return new Promise((resolve, reject) => {
    fs.readFile(path.join(packageDir, "package.json"), {encoding: "utf8"}, (err, data) => {
      if (err) {
        reject(new Error(`Could not read file ${path.join(packageDir, "package.json")}`));
        return;
      }
      resolve(JSON.parse(data));
    });
  });
}
