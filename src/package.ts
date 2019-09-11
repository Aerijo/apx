import * as fs from "fs";
import * as path from "path";
import {getOwnerRepo} from "./github";

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

interface PackageDetails {
  owner: string;
  repo: string;
  name: string;
  version: string;
  author?: string;
  scripts?: {[key: string]: string};
}

export async function getPackageDetails(packageDir: string): Promise<PackageDetails> {
  const metadata = await getMetadata(packageDir);

  const name = metadata.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Repository name must exist and be nonempty");
  }

  const version = metadata.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("Repository version must exist and be nonempty");
  }

  const author = typeof metadata.author === "string" ? metadata.author : undefined;

  const scripts = typeof metadata.scripts === "object" ? metadata.scripts : undefined;
  if (scripts) {
    if (Array.isArray(scripts)) {
      throw new Error("Unexpected array of scripts");
    }

    for (const script of Object.keys(scripts)) {
      if (typeof script !== "string" || typeof scripts[script] !== "string") {
        throw new Error(`Unexpected non-string script "${script}"`);
      }
    }
  }

  const {owner, repo} = getOwnerRepo(metadata);

  return {
    name,
    version,
    author,
    scripts,
    owner,
    repo,
  };
}

export function getAssetName(packageName: string, version: string): string {
  return `apx-bundled-${packageName}-${version}.tgz`;
}
