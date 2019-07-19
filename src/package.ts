import * as fs from "fs";
import * as path from "path";

export function getMetadata(packageDir: string): Promise<any> {
  return new Promise(resolve => {
    fs.readFile(path.join(packageDir, "package.json"), {encoding: "utf8"}, (err, data) => {
      if (err) {
        throw err;
      }
      resolve(JSON.parse(data));
    });
  });
}

export function getGithubOwnerRepo(metadata: any): {owner: string; repo: string} {
  let repoUrl = metadata.repository;
  if (repoUrl && metadata.repository.url) {
    repoUrl = metadata.repository.url;
  }

  if (typeof repoUrl !== "string") {
    throw new Error("Expected repository URL");
  }

  const githubRegex = /^https:\/\/github\.com\/([a-zA-A0-9\-]+?)\/([a-zA-Z0-9\-\._]+?)(\/|\.git)?$/;
  const match = githubRegex.exec(repoUrl);

  if (!match) {
    throw new Error("Could not retrieve GitHub owner and repo");
  }

  const [, owner, repo] = match;
  return {owner, repo};
}
