// Lightweight task checklist / viewer
import chalk from "chalk";
import * as logUpdate from "log-update";
import * as Observable from "zen-observable";

export interface Task {
  title: string | (() => string);
  task(): void | string | Promise<void | string> | Observable<string>;
  final?: boolean | (() => boolean);
  skip?: boolean | (() => boolean);
}

function getTaskTitle(task: Task): string {
  return typeof task.title === "string" ? task.title : task.title();
}

export class TaskManager {
  tasks: Task[];

  constructor(tasks: Task[]) {
    this.tasks = tasks;
  }

  getSuccess(): string {
    return chalk.green("✔");
  }

  getFailure(): string {
    return chalk.red("✘");
  }

  getSkip(): string {
    return chalk.yellow("↓");
  }

  getWait(): string {
    return chalk.yellow(">");
  }

  async run() {
    let lastTask: Task | undefined;
    for (const task of this.tasks) {
      if (getSkip(task)) {
        console.log(`${this.getSkip()} ${getTaskTitle(task)}`);
        if (getFinal(task)) {
          break;
        }
        continue;
      }

      if (lastTask && getFinal(lastTask)) {
        break;
      }

      lastTask = task;
      try {
        const spawned = task.task();

        const title = getTaskTitle(task);

        if (spawned === undefined) {
          if (title) {
            logUpdate(`${this.getSuccess()} ${title}`);
          }
          logUpdate.done();
          continue;
        }

        if (typeof spawned === "string") {
          if (title) {
            logUpdate(`${this.getSuccess()} ${title}`);
          }
          logUpdate.done();
          console.log(spawned);
          continue;
        }

        logUpdate(`${this.getWait()} ${title}`);

        if (spawned instanceof Promise) {
          const result = await spawned;
          logUpdate(`${this.getSuccess()} ${getTaskTitle(task)}`);
          logUpdate.done();
          if (result) {
            console.log(result);
          }
          continue;
        }

        const self = this;
        spawned.subscribe({
          next(val) {
            logUpdate(`${self.getWait()} ${getTaskTitle(task)} - ${val}`);
          },
          error(exception) {
            throw exception;
          },
          complete() {
            logUpdate(`${self.getSuccess()} ${getTaskTitle(task)}`);
            logUpdate.done();
          },
        });
      } catch (e) {
        logUpdate(`${this.getFailure()} ${getTaskTitle(task)}`);
        if (e.message) {
          console.error(e.message);
        }
        break;
      }
    }
  }
}

function getSkip(task: Task): boolean {
  if (!task.skip) {
    return false;
  }
  return typeof task.skip === "function" ? task.skip.call(task) : task.skip;
}

function getFinal(task: Task): boolean {
  if (!task.final) {
    return false;
  }
  return typeof task.final === "function" ? task.final.call(task) : task.final;
}
