import {getToken, setToken, Token} from "../src/auth";

jest.mock("keytar", () => {
  let passwords: {[key: string]: string | undefined} = {};
  return {
    findPassword: (key: string) => {
      expect(typeof key).toBe("string");
      return typeof passwords[key] === "string" ? passwords[key] : null;
    },
    setPassword: (key: string, account: string, value: string | undefined) => {
      expect(typeof key).toBe("string");
      expect(typeof account).toBe("string");
      expect(typeof value).toBe("string");
      passwords[key] = value;
    },
  };
});

describe("Handling credentials", () => {
  const old_env = process.env;

  beforeEach(() => {
    process.env = {...old_env};
    delete process.env.ATOM_ACCESS_TOKEN;
    delete process.env.GITHUB_AUTH_TOKEN;
  });

  afterEach(() => {
    process.env = old_env;
  });

  test("no tokens", async () => {
    expect(await getToken(Token.ATOMIO)).toBeUndefined();
    expect(await getToken(Token.GITHUB)).toBeUndefined();
  });

  test("keytar token", async () => {
    await setToken(Token.ATOMIO, "foo");
    expect(await getToken(Token.ATOMIO)).toBe("foo");
  });

  test("env token", async () => {
    process.env.GITHUB_AUTH_TOKEN = "bar";
    expect(await getToken(Token.GITHUB)).toBe("bar");
  });

  test("env priority over keytar", async () => {
    await setToken(Token.ATOMIO, "foo");
    process.env.ATOM_ACCESS_TOKEN = "baz";
    expect(await getToken(Token.ATOMIO)).toBe("baz");
  });
});
