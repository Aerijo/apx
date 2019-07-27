import * as keytar from "keytar";

// Use same token as apm
const atomTokenName = "Atom.io API Token";
const account = "atom.io";

export async function getToken(): Promise<string> {
  if (process.env.ATOM_ACCESS_TOKEN) {
    return process.env.ATOM_ACCESS_TOKEN;
  }

  const token = await keytar.findPassword(atomTokenName);

  if (token) {
    return token;
  } else {
    throw new Error("No Atom API token in keychain");
  }
}

/**
 * @param  token Value to store
 * @return       Promise that resolves when request is completed
 */
export function setToken(token: string): Promise<void> {
  return keytar.setPassword(atomTokenName, account, token);
}

export async function getGithubRestToken(): Promise<string> {
  if (typeof process.env.GITHUB_AUTH_TOKEN === "string") {
    return process.env.GITHUB_AUTH_TOKEN;
  }
  throw new Error("GitHub API token required in environment variable GITHUB_AUTH_TOKEN");
}
