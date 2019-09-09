import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {spawn, ChildProcessWithoutNullStreams} from "child_process";
import * as tmp from "tmp-promise";
import {DirectoryResult} from "tmp-promise";
import {DirOptions} from "tmp";
tmp.setGracefulCleanup();
import {Context} from "./context";

export class Command {
  context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  spawn(
    command: string,
    args: string[],
    options: {[key: string]: any} = {},
    logOptions?: {[key: string]: any}
  ): ChildProcessWithoutNullStreams {
    options.env = {...this.context.getElectronEnv(), ...options.env};

    if (process.platform === "win32") {
      options.shell = true;
    }

    const child = spawn(command, args, {...options, env: {...process.env, ...options.env}});

    if (logOptions) {
      if (logOptions.reject) {
        child.on("error", (err: any) => {
          if (err.code === "ENOENT") {
            logOptions.reject(new Error(`Could not find '${command}' command`));
            return;
          } else {
            throw err;
          }
        });
      }

      let outstream: fs.WriteStream;
      let errstream: fs.WriteStream;

      if (logOptions.logfile) {
        if (typeof logOptions.logfile === "string") {
          outstream = fs.createWriteStream(logOptions.logfile, {flags: "a"});
          errstream = outstream;
          child.on("exit", () => {
            outstream.write("\n");
            outstream.end();
          });

          outstream.write(`$$$ ${new Date().toString()} LOG BEGIN`);
        } else if (typeof logOptions.logfile === "object") {
          outstream = fs.createWriteStream(logOptions.logfile.out, {flags: "a"});
          errstream = fs.createWriteStream(logOptions.logfile.err, {flags: "a"});
          child.on("exit", () => {
            outstream.write("\n");
            outstream.end();
          });
          child.on("exit", () => {
            outstream.write("\n");
            errstream.end();
          });
          outstream.write(`$$$ ${new Date().toString()} LOG BEGIN`);
          errstream.write(`$$$ ${new Date().toString()} LOG BEGIN`);
        }
      }

      if (options && options.stdio === "pipe") {
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", data => {
          if (logOptions.consoleout) {
            process.stdout.write(data);
          }

          if (outstream) {
            outstream.write(data);
          }
        });

        child.stderr.on("data", data => {
          if (logOptions.consoleout) {
            process.stdout.write(data);
          }

          if (errstream) {
            errstream.write(data);
          }
        });
      }
    }

    if (options && options.stdio === "inherit") {
      child.on("exit", () => {
        // offsets line gobbled by line replacement util. Only one, because
        // printing to console probably doesn't have status updates.
        console.log();
      });
    }

    return child;
  }

  getOrCreateLogPath(): string {
    const logPath = process.env.APX_LOG_PATH || path.join(this.context.getAtomDirectory(), "log");
    this.tryMakeDir(logPath);
    return logPath;
  }

  tryMakeDir(dir: string) {
    try {
      fs.mkdirSync(dir, {recursive: true});
    } catch (e) {
      if (e.code !== "EEXIST") {
        console.error(`Could not create required directory ${dir}`);
        throw e;
      }
    }
  }

  createDir(dir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.mkdir(dir, {recursive: true}, err => {
        if (err && err.code !== "EEXIST") {
          reject(new Error(`Could not create required directory ${dir}: ${err}`));
        } else {
          resolve();
        }
      });
    });
  }

  getShortPath(dir: string): string {
    return dir.startsWith(os.homedir()) ? `~` + dir.slice(os.homedir().length) : dir;
  }

  getTempDir(options?: DirOptions): Promise<DirectoryResult> {
    return tmp.dir(options);
  }

  runScript(name: string, scripts: any, cwd: string): Promise<void> {
    if (typeof scripts === "object" && typeof scripts[name] === "string") {
      return new Promise((resolve, reject) => {
        const child = this.spawn(
          "npm",
          ["run", name],
          {
            cwd,
            stdio: "inherit",
          },
          {reject}
        );
        child.on("exit", err => {
          if (err) {
            reject(new Error(`Process exited with code ${err}`));
          } else {
            resolve();
          }
        });
      });
    } else {
      return Promise.resolve();
    }
  }
}
