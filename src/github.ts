import * as Octokit from "@octokit/rest";
import {GraphQLClient} from "graphql-request";
import {getToken, Token} from "./auth";

/**
 * We need to
 * - Upload asset to repo (authorised)
 * - Download asset from repo (no auth required, but added if possible)
 */

export interface PackDetails {
  owner: string;
  repo: string;
  name: string;
  version: string;
  authtoken?: string;
}

function assetNameFromDetails({name, version}: PackDetails): string {
  return `apx-bundled-${name}-${version}.tgz`;
}

function tagNameFromDetails({version}: PackDetails): string {
  return `v${version}`;
}

export async function getGithubRelease(details: PackDetails): Promise<string | undefined> {
  if (details.authtoken === undefined) {
    details.authtoken = await getToken(Token.GITHUB);
  }

  if (details.authtoken) {
    return getGraphqlReleaseAssetUrl(details, details.authtoken);
  } else {
    return getRestReleaseAssetUrl(details);
  }
}

async function getGraphqlReleaseAssetUrl(
  details: PackDetails,
  token: string
): Promise<string | undefined> {
  const {owner, repo} = details;
  const query = `{
    repository(owner:"${owner}", name:"${repo}") {
      release(tagName:"${tagNameFromDetails(details)}") {
        releaseAssets(name:"${assetNameFromDetails(details)}" first:1) {
          nodes {
            downloadUrl
          }
        }
      }
    }
  }`;

  try {
    const data = await queryGraphql(query, token);
    const assets = data.repository.release.releaseAssets.nodes;
    return assets.length === 1 ? assets[0].downloadUrl : undefined;
  } catch (e) {
    return undefined;
  }
}

function getOctokit(authtoken?: string): Octokit {
  const params: Octokit.Options = {
    baseUrl: "https://api.github.com",
  };
  if (authtoken) {
    params.auth = authtoken;
  }
  return new Octokit(params);
}

async function getRestReleaseAssetUrl(details: PackDetails): Promise<string | undefined> {
  const {owner, repo, authtoken} = details;
  const assetName = assetNameFromDetails(details);
  const tag = tagNameFromDetails(details);

  const oct = getOctokit(authtoken);
  const releases = await oct.repos.listReleases({owner, repo});
  const release = releases.data.find(e => e.tag_name === tag);

  if (release === undefined) {
    return undefined;
  }

  for (const asset of release.assets) {
    if (asset.name === assetName) {
      return asset.browser_download_url;
    }
  }

  return undefined;
}

export async function uploadAsset(
  url: string,
  name: string,
  type: string,
  file: string | Buffer
): Promise<number> {
  const authtoken = await getToken(Token.GITHUB);
  const oct = getOctokit(authtoken);
  const r = await oct.repos.uploadReleaseAsset({
    url,
    headers: {
      "content-type": type,
      "content-length": file.length,
    },
    name,
    file,
  });
  return r.status;
}

export function getOwnerRepo(repoUrl: any): {owner: string; repo: string} {
  if (typeof repoUrl !== "string") {
    const metadata = repoUrl;
    repoUrl = metadata.repository;
    if (repoUrl && metadata.repository.url) {
      repoUrl = metadata.repository.url;
    }
  }

  if (typeof repoUrl !== "string") {
    throw new Error("Expected repository URL");
  }

  const githubRegex = /^https:\/\/github\.com\/([a-zA-Z0-9\-]+?)\/([a-zA-Z0-9\-\._]+?)(\/|\.git)?$/;
  const match = githubRegex.exec(repoUrl);

  if (!match) {
    throw new Error("Could not retrieve GitHub owner and repo");
  }

  const [, owner, repo] = match;
  return {owner, repo};
}

export async function queryGraphql(query: string, token: string): Promise<any> {
  const graphQLClient = new GraphQLClient("https://api.github.com/graphql", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  return graphQLClient.request(query);
}
