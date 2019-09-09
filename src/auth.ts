import * as keytar from "keytar";

const account = "atom.io";

export enum Token {
  ATOMIO,
  GITHUB,
}

function getTokenDetails(token: Token): {env: string; key: string} {
  switch (token) {
    case Token.ATOMIO:
      return {env: "ATOM_ACCESS_TOKEN", key: "Atom.io API Token"};
    case Token.GITHUB:
      return {env: "GITHUB_AUTH_TOKEN", key: "GitHub API Token"};
  }
}

export async function getToken(token: Token): Promise<string | undefined> {
  let value: string | undefined | null;
  const details = getTokenDetails(token);

  value = process.env[details.env];
  if (typeof value === "string") {
    return value;
  }

  value = await keytar.findPassword(details.key);
  return value !== null ? value : undefined;
}

export function setToken(token: Token, value: string): Promise<void> {
  const name = getTokenDetails(token).key;
  return keytar.setPassword(name, account, value);
}
