import {Command} from "./command";
import {Context} from "./context";
import {Arguments} from "yargs";
import {TaskManager, TaskParams, TaskContext} from "./tasks";
import * as fs from "fs";
import * as path from "path";
import {getMetadata} from "./package";
import {promisify} from "util";

export class Link extends Command {
  constructor(context: Context) {
    super(context);
  }

  async link(argv: Arguments) {
    const tasks = new TaskManager([
      {
        title: ctx => `Linking ${ctx.name} to ${this.context.getAtomPackagesDirectory(ctx.dev)}`,
        task: async (task, ctx) => {
          if (!fs.existsSync(ctx.source)) {
            throw new Error(`Package not found at ${ctx.source}`);
          }

          const targetDir = path.join(this.context.getAtomPackagesDirectory(ctx.dev), linkName);
          try {
            const stat = await promisify(fs.lstat)(targetDir);
            if (stat.isSymbolicLink()) {
              await promisify(fs.unlink)(targetDir);
            }
          } catch (e) {
            if (e.code !== "ENOENT") {
              throw e;
            }
          }

          try {
            await this.createDir(path.dirname(targetDir));
            await promisify(fs.symlink)(ctx.source, targetDir, "junction");
            task.complete(`${this.getShortPath(targetDir)} -> ${this.getShortPath(ctx.source)}`);
          } catch (e) {
            if (e.code === "EEXIST") {
              throw new Error(
                `Package ${this.getShortPath(targetDir)} already exists and is not a symlink`
              );
            }
            throw e;
          }
        },
      },
    ]);

    const sourceDir = path.resolve(process.cwd(), argv.path as string);
    const linkName = (argv.name as string) || (await getMetadata(sourceDir)).name;
    if (!linkName) {
      throw new Error("Could not detect package name");
    }
    tasks.run({
      name: linkName,
      source: sourceDir,
      dev: argv.dev as boolean,
    });
  }

  unlink(argv: Arguments) {
    if (argv.hard) {
      throw new Error("Not yet implemented");
    }

    const taskParams: TaskParams[] = [];
    const context: TaskContext = {
      dev: argv.dev as boolean,
      all: argv.all as boolean,
    };

    if (context.all) {
      taskParams.push({
        title: () => `Unlinking all symlinks`,
        task: task => {
          task.error("Not yet implemented");
        },
      });
    } else if (argv.name) {
      context.name = argv.name;
      taskParams.push({
        title: ctx =>
          `Unlinking ${ctx.name} from ${this.context.getAtomPackagesDirectory(ctx.dev)}`,
        task: async (task, ctx) => {
          const symlinkPath = path.join(this.context.getAtomPackagesDirectory(ctx.dev), ctx.name);
          await promisify(fs.unlink)(symlinkPath);
          task.complete();
        },
      });
    } else {
      context.target = process.cwd();
      taskParams.push({
        title: ctx =>
          `Unlinking references to ${this.getShortPath(ctx.target)} from ${this.getShortPath(
            this.context.getAtomPackagesDirectory(ctx.dev)
          )}`,
        task: async (task, ctx) => {
          const searchDir = this.context.getAtomPackagesDirectory(ctx.dev);
          const symlinks = (await promisify(fs.readdir)(searchDir, {withFileTypes: true})).filter(
            item => item.isSymbolicLink()
          );

          const removedLinks = (await Promise.all(
            symlinks.map(async link => {
              const source = path.join(searchDir, link.name);
              const target = await promisify(fs.readlink)(source);
              if (target !== ctx.target) {
                return undefined;
              }
              await promisify(fs.unlink)(source);
              return source;
            })
          )).filter(source => source);

          if (removedLinks.length === 0) {
            task.nonFatalError("No symlinks detected");
          } else {
            task.complete(
              `Unlinked ${
                removedLinks.length === 1 ? removedLinks[0] : `${removedLinks.length} symlinks`
              }`
            );
          }
        },
      });
    }

    const tasks = new TaskManager(taskParams);

    tasks.run(context);
  }
}
