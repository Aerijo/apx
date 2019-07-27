// Lightweight task checklist / viewer

import * as logUpdate from "log-update";
import * as Observable from "zen-observable";

interface Task {
  title: string | (() => string);
  task(): void | Promise<void> | Observable<string>;
}

function getTaskTitle(task: Task): string {
  return typeof task.title === "string" ? task.title : task.title();
}

export class TaskManager {
  tasks: Task[];

  constructor(tasks: Task[]) {
    this.tasks = tasks;
  }

  async run() {
    for (const task of this.tasks) {
      try {
        const spawned = task.task();

        const title = getTaskTitle(task);

        if (spawned === undefined) {
          logUpdate(`✔ ${title}`);
          logUpdate.done();
          continue;
        }

        logUpdate(`> ${title}`);

        if (spawned instanceof Promise) {
          await spawned;
          logUpdate(`✔ ${getTaskTitle(task)}`);
          logUpdate.done();
          continue;
        }

        spawned.subscribe({
          next(val) {
            logUpdate(`> ${getTaskTitle(task)} - ${val}`);
          },
          error(exception) {
            throw exception;
          },
          complete() {
            logUpdate(`✔ ${getTaskTitle(task)}`);
            logUpdate.done();
          },
        });
      } catch (e) {
        logUpdate(`✘ ${getTaskTitle(task)} - ${e}`);
        throw new Error("aborting");
      }
    }
  }
}
