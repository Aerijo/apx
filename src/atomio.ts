import {Token, unsafeGetToken} from "./auth";
import {post, getAtomioErrorMessage} from "./request";

export const enum PublishStatus {
  SUCCESS = 201,
  EXISTING = 409,
}

export const enum VersionStatus {
  SUCCESS = 201,
  EXISTING = 409,
}

export const enum DeleteStatus {
  SUCCESS = 204,
  NOACCESS = 400,
  UNAUTH = 401,
}

export const enum DeleteVersionStatus {
  SUCCESS = 204,
}

export async function registerPackage(
  apiurl: string,
  owner: string,
  repo: string
): Promise<PublishStatus> {
  const repository = `${owner}/${repo}`;
  const token = await unsafeGetToken(Token.ATOMIO);

  const result = await post({
    url: `${apiurl}/packages`,
    json: true,
    body: {repository},
    headers: {authorization: token},
  });

  const status = result.response.statusCode;
  if (status === PublishStatus.SUCCESS || status === PublishStatus.EXISTING) {
    return status;
  } else {
    throw new Error(`Error registering package: ${getAtomioErrorMessage(result)}`);
  }
}

export async function publishVersion(
  apiurl: string,
  name: string,
  tag: string
): Promise<VersionStatus> {
  const token = await unsafeGetToken(Token.ATOMIO);

  const result = await post({
    url: `${apiurl}/packages/${name}/versions`,
    json: true,
    body: {
      tag,
      rename: false,
    },
    headers: {
      authorization: token,
    },
  });

  const status = result.response.statusCode;

  if (status === VersionStatus.SUCCESS || status === VersionStatus.EXISTING) {
    return status;
  } else {
    throw new Error(`Error publishing version: ${getAtomioErrorMessage(result)}`);
  }
}
