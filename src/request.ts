import * as child_process from "child_process";
import * as request from "request";
import {GraphQLClient} from "graphql-request";
import * as Octokit from "@octokit/rest";
import {getGithubRestToken} from "./auth";

export type RequestOptions = request.Options;
export interface RequestResult {
  error: any;
  response: request.Response;
  body: any;
}

function getNpmConfig(): Promise<any> {
  return new Promise(resolve => {
    child_process.exec("npm config list --json", (err, stdout) => {
      if (err) {
        throw err;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

let npmProxyKnown = false;
let proxy: string | undefined;
async function getNpmConnectionConfig(): Promise<{proxy: string | undefined}> {
  if (!npmProxyKnown) {
    try {
      const config = await getNpmConfig();
      proxy = config["https-proxy"] || config["proxy"];
    } catch {}
    npmProxyKnown = true;
  }

  return {proxy};
}

function requestPromise(settings: RequestOptions): Promise<RequestResult> {
  return new Promise(resolve => {
    request(settings, (error, response, body) => {
      resolve({error, response, body});
    });
  });
}

async function _request(method: string, settings: RequestOptions): Promise<RequestResult> {
  const config = await getNpmConnectionConfig();
  if (config.proxy !== undefined) {
    settings.proxy = config.proxy;
  }
  settings.method = method;
  return requestPromise(settings);
}

export function get(settings: RequestOptions): Promise<RequestResult> {
  return _request("GET", settings);
}

export function post(settings: RequestOptions): Promise<RequestResult> {
  return _request("POST", settings);
}

export function del(settings: RequestOptions): Promise<RequestResult> {
  return _request("DELETE", settings);
}

export function getAtomioErrorMessage(result: RequestResult): string {
  if (result.response.statusCode === 503) {
    return "https://atom.io is temporarily unavailable, please try again later";
  }

  switch (typeof result.body) {
    case "object":
      return result.body.message || result.body.error;
    case "string":
      return result.body;
    default:
      return `${result.response.statusCode}`;
  }
}

export async function getGithubGraphql(query: string): Promise<any> {
  const token = await getGithubRestToken();
  const graphQLClient = new GraphQLClient("https://api.github.com/graphql", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  return graphQLClient.request(query);
}

const oct = new Octokit({
  auth: getGithubRestToken,
});

export async function uploadAsset(
  url: string,
  name: string,
  type: string,
  file: string | Buffer
): Promise<number> {
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
