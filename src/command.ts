import * as fs from "fs";
import * as path from "path";
import {Context} from "./context";
import {spawn, ChildProcessWithoutNullStreams} from "child_process";

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
    const child = spawn(command, args, {...options, env: {...process.env, ...options.env}});

    if (logOptions) {
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
}
