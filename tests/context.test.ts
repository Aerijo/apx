import {Context, Target} from "../src/context";

import * as fs from "fs";

const APXRC_FILEPATH = "/apx/.apxrc";
const BROKEN_APXRC_FILEPATH = "/apx/.apxrc-broken";

const fileMap = new Map<string, string>([
  [APXRC_FILEPATH, `{"target": "beta"}`],
  [BROKEN_APXRC_FILEPATH, `{`],
]);

jest.mock("fs", () => {
  class FsMock {
    readFile(filepath: string, options: any, cb: any) {
      if (typeof options === "function") {
        cb = options;
        options = undefined;
      }
      try {
        const contents = this.readFileSync(filepath, options);
        cb(undefined, contents);
      } catch (e) {
        cb(e);
      }
    }

    readFileSync(filepath: string, options: any) {
      if (fileMap.has(filepath)) {
        return fileMap.get(filepath);
      }
      return fs.readFileSync(filepath, options);
    }

    writeFile(filepath: string, contents: any, options: any, cb: any) {
      if (typeof options === "function") {
        cb = options;
        options = undefined;
      }
      try {
        this.writeFileSync(filepath, contents, options);
        cb(undefined, contents);
      } catch (e) {
        cb(e);
      }
    }

    writeFileSync(filepath: string, contents: any, _options: any) {
      fileMap.set(filepath, contents);
    }
  }
  return new FsMock();
});

describe("Configuring the environment", () => {
  test("locates the config file", async () => {
    process.env.APX_CONFIG_PATH = "/apx/.apxrc";
    const context = new Context();
    expect(context.getConfigPath()).toBe("/apx/.apxrc");
  });

  test("respects the default target in config", () => {
    process.env.APX_CONFIG_PATH = APXRC_FILEPATH;
    const context = new Context();
    expect(context.getTarget()).toBe(Target.BETA);
  });

  test("gracefully ignores invalid config", () => {
    process.env.APX_CONFIG_PATH = BROKEN_APXRC_FILEPATH;
    const context = new Context();
    expect(context.getTarget()).toBe(Target.STABLE);
  });

  test("can change default values", () => {
    const oldConfig = fileMap.get(APXRC_FILEPATH)!;
    process.env.APX_CONFIG_PATH = APXRC_FILEPATH;

    const context = new Context();
    context.setDefault("foo", "bar");

    const alteredConfig = fileMap.get(APXRC_FILEPATH)!;
    expect(typeof alteredConfig).toBe("string");
    const configObj = JSON.parse(alteredConfig);

    expect(configObj.foo).toBe("bar");
    expect(context.getDefault("foo")).toBe("bar");

    fileMap.set(APXRC_FILEPATH, oldConfig);
  });
});
