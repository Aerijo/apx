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

  async getSymlinksForDir(searchDir: string): Promise<fs.Dirent[]> {
    const items = await promisify(fs.readdir)(searchDir, {withFileTypes: true});
    return items.filter(item => item.isSymbolicLink());
  }

  async unlinkAll(searchDir: string): Promise<string[]> {
    const symlinks = await this.getSymlinksForDir(searchDir);
    return Promise.all(
      symlinks.map(async link => {
        const source = path.join(searchDir, link.name);
        await promisify(fs.unlink)(source);
        return source;
      })
    );
  }

  async unlinkByName(searchDir: string, name: string): Promise<string | undefined> {
    try {
      const symlinkPath = path.join(searchDir, name);
      await promisify(fs.unlink)(symlinkPath);
      return symlinkPath;
    } catch {
      return undefined;
    }
  }

  async unlinkByTarget(searchDir: string, target: string): Promise<string[]> {
    const symlinks = await this.getSymlinksForDir(searchDir);
    const removedLinks = (await Promise.all(
      symlinks.map(async link => {
        const source = path.join(searchDir, link.name);
        if ((await promisify(fs.readlink)(source)) !== target) {
          return undefined;
        }
        await promisify(fs.unlink)(source);
        return source;
      })
    )).filter(source => source) as string[];

    return removedLinks;
  }

  unlink(argv: Arguments) {
    const taskParams: TaskParams[] = [];
    const context: TaskContext = {
      dev: argv.dev as boolean,
      all: argv.all as boolean,
      hard: argv.hard as boolean,
    };

    if (context.all) {
      taskParams.push({
        title: ctx =>
          ctx.hard
            ? "Unlinking all symlinks"
            : `Unlinking all symlinks in ${this.getShortPath(
                this.context.getAtomPackagesDirectory(ctx.dev)
              )}`,
        task: async (task, ctx) => {
          const searchDirs = [this.context.getAtomPackagesDirectory(ctx.dev)];
          if (ctx.hard) {
            searchDirs.push(this.context.getAtomPackagesDirectory(!ctx.dev));
          }
          const removed = (await Promise.all(searchDirs.map(dir => this.unlinkAll(dir)))).reduce(
            (a, v) => a.concat(v)
          );
          task.complete(
            `Removed ${
              removed.length === 1 ? this.getShortPath(removed[0]) : `${removed.length} symlinks`
            }`
          );
        },
      });
    } else if (argv.name) {
      context.name = argv.name;
      taskParams.push({
        title: ctx =>
          `Unlinking ${ctx.name} from ${this.context.getAtomPackagesDirectory(ctx.dev)}${
            ctx.hard ? ` and ${this.context.getAtomPackagesDirectory(!ctx.dev)}` : ""
          }`,
        task: async (task, ctx) => {
          const searchDirs = [this.context.getAtomPackagesDirectory(ctx.dev)];
          if (ctx.hard) {
            searchDirs.push(this.context.getAtomPackagesDirectory(!ctx.dev));
          }
          await Promise.all(searchDirs.map(dir => this.unlinkByName(dir, ctx.name)));
          task.complete();
        },
      });
    } else {
      context.target = process.cwd();
      taskParams.push({
        title: ctx => {
          const shortTarget = this.getShortPath(ctx.target);
          return ctx.hard
            ? `Unlinking all references to ${shortTarget}`
            : `Unlinking references to ${shortTarget} from ${this.getShortPath(
                this.context.getAtomPackagesDirectory(ctx.dev)
              )}`;
        },
        task: async (task, ctx) => {
          const searchDirs: string[] = [this.context.getAtomPackagesDirectory(ctx.dev)];
          if (ctx.hard) {
            searchDirs.push(this.context.getAtomPackagesDirectory(!ctx.dev));
          }

          const results = await Promise.all(
            searchDirs.map(searchDir => this.unlinkByTarget(searchDir, ctx.target))
          );
          const removedLinks = results.reduce((a, v) => a.concat(v));
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
