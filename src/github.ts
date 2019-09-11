import * as Octokit from "@octokit/rest";
import {GraphQLClient} from "graphql-request";
import {getToken, Token, unsafeGetToken} from "./auth";
import * as fs from "fs";
import * as util from "util";

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

  if (details.authtoken !== undefined) {
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
    userAgent: "apx",
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

export type ReleaseDetails = Octokit.ReposCreateReleaseResponse &
  Octokit.ReposGetReleaseResponse & {created: boolean};

export async function getOrCreateRelease(
  owner: string,
  repo: string,
  tag: string
): Promise<ReleaseDetails> {
  const authtoken = await unsafeGetToken(Token.GITHUB);
  const oct = getOctokit(authtoken);

  try {
    const newRelease = await oct.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
    });
    return {
      created: true,
      ...newRelease.data,
    };
  } catch (e) {
    if (e.name !== "HttpError" || e.status !== 422) {
      throw e;
    }

    const errors = e.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (first.field === "tag_name" && first.code === "already_exists") {
        const existingRelease = await oct.repos.getReleaseByTag({owner, repo, tag});
        return {
          created: false,
          ...existingRelease.data,
        };
      }
    }

    throw e;
  }
}

export async function verifyTagExists(
  owner: string,
  repo: string,
  tag: string,
  retry: (i: number) => boolean
): Promise<void> {
  const authtoken = await unsafeGetToken(Token.GITHUB);
  const query = `{
    repository(owner:"${owner}" name:"${repo}") {
      ref(qualifiedName:"refs/tags/${tag}") {
        name
      }
    }
  }`;

  let i = 0;
  while (true) {
    const response = await queryGraphql(query, authtoken);
    if (response.repository.ref !== null) {
      return;
    }

    if (!retry(++i)) {
      throw new Error(`Could not detect tag "${tag}" on GitHub ${owner}/${repo}`);
    }
  }
}

export async function uploadReleaseAsset(
  releaseDetails: ReleaseDetails,
  filepath: string,
  uploadName: string
): Promise<void> {
  const authtoken = await unsafeGetToken(Token.GITHUB);
  const oct = getOctokit(authtoken);

  const uploadUrl = releaseDetails.upload_url;
  const file = await util.promisify(fs.readFile)(filepath);

  const result = await oct.repos.uploadReleaseAsset({
    url: uploadUrl,
    headers: {
      "content-type": "application/zip",
      "content-length": file.length,
    },
    name: uploadName,
    file,
  });

  if (result.status !== 201) {
    throw new Error(`Error publishing package asset: status ${status}`);
  }
}
