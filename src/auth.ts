import * as keytar from "keytar";

const account = "atom.io";

export enum Token {
  ATOMIO,
  GITHUB,
}

const tokenToName = new Map<Token, string>([
  [Token.ATOMIO, "Atom.io API Token"],
  [Token.GITHUB, "GitHub API Token"],
]);

function getTokenName(token: Token): string | undefined {
  return tokenToName.get(token);
}

export async function getToken(token: Token): Promise<string | undefined> {
  switch (token) {
    case Token.ATOMIO:
      if (process.env.ATOM_ACCESS_TOKEN) {
        return process.env.ATOM_ACCESS_TOKEN;
      }
      break;
    case Token.GITHUB:
      if (process.env.GITHUB_AUTH_TOKEN) {
        return process.env.GITHUB_AUTH_TOKEN;
      }
      break;
  }

  const name = getTokenName(token);
  if (!name) {
    return undefined;
  }
  const value = await keytar.findPassword(name);
  return value !== null ? value : undefined;
}

export function setToken(token: Token, value: string): Promise<void> {
  const name = getTokenName(token);
  if (name === undefined) {
    throw new Error(`Cannot set unnamed token ID ${token} ${Token[token]}`);
  }
  return keytar.setPassword(name, account, value);
}
