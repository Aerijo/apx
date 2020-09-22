import * as keytar from "keytar";

// Linux TODO: Handle when gnome-keyring not installed (gets error The name org.freedesktop.secrets was not provided by any .service files)

export enum Token {
  ATOMIO,
  GITHUB,
}

interface TokenDetails {
  env: string;
  key: string;
  account: string;
  service: string;
  cached?: string;
}

const tokenMap: Map<Token, TokenDetails> = new Map([
  [
    Token.ATOMIO,
    {
      env: "ATOM_ACCESS_TOKEN",
      key: "Atom.io API Token",
      account: "atom.io",
      service: "atom.io",
    },
  ],
  [
    Token.GITHUB,
    {
      env: "GITHUB_AUTH_TOKEN",
      key: "GitHub API Token",
      account: "apx",
      service: "GitHub",
    },
  ],
]);

export function forEachToken(cb: (details: TokenDetails, token?: Token) => void) {
  tokenMap.forEach(cb);
}

function getTokenDetails(token: Token): TokenDetails {
  const details = tokenMap.get(token);
  if (details === undefined) {
    throw new Error(`Missing details for token ${token}`);
  }
  return details;
}

export function tokenInEnv(token: Token): boolean {
  const {env} = getTokenDetails(token);
  return typeof process.env[env] === "string";
}

export async function getToken(token: Token): Promise<string | undefined> {
  let value: string | undefined | null;
  const details = getTokenDetails(token);

  value = process.env[details.env];
  if (typeof value === "string") {
    return value;
  }

  if (details.cached) {
    return details.cached;
  }

  value = await keytar.getPassword(details.key, details.account);
  if (value === null) {
    return undefined;
  }

  details.cached = value;
  return value;
}

export async function unsafeGetToken(token: Token): Promise<string> {
  const authtoken = await getToken(token);
  if (authtoken !== undefined) {
    return authtoken;
  }

  const {service, env} = getTokenDetails(token);
  throw new Error(
    `Token for ${service} is unexpectedly missing. Please run "apx login ${service}" to provide the token, or set it in the environment variable ${env}`
  );
}

export function setToken(token: Token, value: string): Promise<void> {
  const details = getTokenDetails(token);
  const {key, account} = details;
  details.cached = value;
  return keytar.setPassword(key, account, value);
}

export function deleteToken(token: Token): Promise<boolean> {
  const details = getTokenDetails(token);
  const {key, account} = details;
  details.cached = undefined;
  return keytar.deletePassword(key, account);
}
