import * as keytar from "keytar";

// Use same token as apm
const tokenName = "Atom.io API Token";
const account = "atom.io";

export async function getToken(): Promise<string> {
  if (process.env.ATOM_ACCESS_TOKEN) {
    return process.env.ATOM_ACCESS_TOKEN;
  }

  const token = await keytar.findPassword(tokenName);

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
  return keytar.setPassword(tokenName, account, token);
}
