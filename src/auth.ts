import * as keytar from "keytar";

export enum Token {
  ATOMIO,
  GITHUB,
}

function getTokenDetails(token: Token): {env: string; key: string; account: string} {
  switch (token) {
    case Token.ATOMIO:
      return {env: "ATOM_ACCESS_TOKEN", key: "Atom.io API Token", account: "atom.io"};
    case Token.GITHUB:
      return {env: "GITHUB_AUTH_TOKEN", key: "GitHub API Token", account: "apx"};
  }
}

export function tokenInEnv(token: Token): boolean {
  const {env} = getTokenDetails(token);
  return typeof process.env[env] === "string";
}

export async function getToken(token: Token, env: boolean = true): Promise<string | undefined> {
  let value: string | undefined | null;
  const details = getTokenDetails(token);

  value = process.env[details.env];
  if (env && typeof value === "string") {
    return value;
  }

  value = await keytar.getPassword(details.key, details.account);
  return value !== null ? value : undefined;
}

export function setToken(token: Token, value: string): Promise<void> {
  const {key, account} = getTokenDetails(token);
  return keytar.setPassword(key, account, value);
}

export function deleteToken(token: Token): Promise<boolean> {
  const {key, account} = getTokenDetails(token);
  return keytar.deletePassword(key, account);
}
