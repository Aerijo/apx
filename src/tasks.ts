// Lightweight task checklist / viewer
import chalk from "chalk";
import * as logUpdate from "log-update";
import {EventEmitter} from "events";

export interface TaskContext {
  [key: string]: any;
}

/**
 * Represent the shell of a task. When run, it will be provided a reference
 * to the constructed task with full disable, skip, and title control.
 */
export interface TaskParams {
  /**
   * A label that will be used to display the task. This can be
   * changed while a task is running via the `task` object passed
   * to the `task` method.
   */
  title: (ctx: TaskContext) => string;

  /**
   * Called when the TaskManager is about to run this task. If it returns
   * false, then the task is skipped and not shown in the console; it is as
   * if the task were not in the list in the first place.
   */
  enabled?: (ctx: TaskContext) => boolean;

  /**
   * Called after the task is enable checked. A falsey value (or Promise that resolves
   * to a falsey value) will let the task run. A truthy value will skip the task,
   * and if it is a string value, will be printed as the reason. The task can also be
   * skipped at any point using the passed `task` object.
   */
  skip?: (ctx: TaskContext) => boolean | string | Promise<boolean | string>;

  /**
   * Called if the task is enabled and not skipped. It is passed a context, which has been
   * passed to all previous tasks. It is also passed a reference to the task,
   * allowing actions such as changing the title, skipping, etc.
   */
  task: (ctx: TaskContext, task: Task) => void; // | TaskManager (TODO)
}

export class Task {
  ctx: TaskContext;
  title: string;
  task: (ctx: TaskContext, task: Task) => void;
  enabled: (ctx: TaskContext) => boolean;
  skip: (ctx: TaskContext) => boolean | string | Promise<boolean | string>;
  events: EventEmitter;

  /**
   * Represents if the task is being executed and monitored by a TaskManager (TODO)
   */
  active: boolean;

  constructor(params: TaskParams, ctx: TaskContext) {
    this.active = false;
    this.ctx = ctx;
    this.title = params.title(this.ctx);
    this.task = params.task;
    this.enabled = params.enabled || (() => true);
    this.skip = params.skip || (() => false);
    this.events = new EventEmitter();
  }

  /**
   * Flags the task as resolved. The TaskManager will unsubscribe,
   * and all further event will be ignored. Pass a string to display
   * it as a persistent message.
   */
  complete(message?: string) {
    this.events.emit("complete", message);
  }

  /**
   * Flags the task as fatally errored, all further events will be
   * ignored, and the TaskManager will not run any more tasks. Alternatively,
   * the task can raise an exception, and the error message will be used.
   */
  error(message: string) {
    this.events.emit("error", message);
  }

  /**
   * FLags the task as meeting an exception, but one that still allows the
   * remaining tasks to run.
   */
  nonFatalError(message: string) {
    this.events.emit("nonFatalError", message);
  }

  /**
   * A message to represent the current step being executed in a task. It
   * must be a single line, and will be overwritten upon the next update.
   * It will be hidden when the task completes. Pass undefined to clear
   * any active message.
   */
  update(update?: string) {
    this.events.emit("update", update);
  }

  /**
   * Updates the displayed title of the task.
   */
  setTitle(title: string) {
    this.title = title;
    this.events.emit("title", title);
  }

  /**
   * Disables the task during execution.
   */
  disable() {
    this.events.emit("disable");
  }

  /**
   * Data to be written when the task resolves
   */
  postWrite(data: string) {
    this.events.emit("postWrite", data);
  }

  requestInput(_query: string): Promise<string> {
    throw new Error("Requesting input not currently supported");
  }
}

export interface TaskManagerOptions {
  concurrent?: boolean;
}

class SymbolProvider {
  wait() {
    return chalk.yellow("›");
  }

  skip() {
    return chalk.yellow("↓");
  }

  update() {
    return chalk.grey("→");
  }

  complete() {
    return chalk.green("✔");
  }

  error() {
    return chalk.red("✘");
  }

  nonFatalError() {
    return chalk.yellow("✘");
  }

  spinner(frame: number) {
    return chalk.yellow(["⠏", "⠹", "⠼", "⠧"][frame % 4]);
  }
}

export class TaskManager {
  tasks: TaskParams[];
  syms = new SymbolProvider();

  constructor(taskParams: TaskParams[], options: TaskManagerOptions = {}) {
    this.tasks = taskParams;

    if (options.concurrent) {
      throw new Error("Concurrent tasks not currently supported");
    }
  }

  async run(ctx: TaskContext = {}): Promise<void> {
    for (const params of this.tasks) {
      await this.executeTask(params, ctx);
    }
  }

  async executeTask(params: TaskParams, ctx: TaskContext): Promise<void> {
    logUpdate.done();

    const task = new Task(params, ctx);

    if (!task.enabled(ctx)) {
      return;
    }

    const skip = await getResolved(task.skip(task.ctx));
    if (skip !== false) {
      console.log(` ${this.syms.skip()} ${task.title} ${chalk.grey("[skipped]")}`);
      if (typeof skip === "string") {
        console.log(chalk.grey(`   ${this.syms.update()} ${skip}`));
      }
      return;
    }

    await new Promise<string | undefined>((resolve, reject) => {
      let updateText: string | undefined;
      let postText: string = "";

      const nextFrame = (sym?: string, msg?: string) => {
        let content = ` ${sym || this.syms.wait()} ${task.title}`;
        if (updateText) {
          content += `\n   ${this.syms.update()} ${msg || updateText}`;
        }
        logUpdate(content);
      };

      logUpdate(` ${this.syms.wait()} ${task.title}`);

      task.events.on("complete", (completionUpdate?: string) => {
        updateText = completionUpdate;
        nextFrame(this.syms.complete());
        logUpdate.done();
        resolve(postText);
      });

      task.events.on("error", (message: string) => {
        logUpdate(` ${this.syms.error()} ${task.title}\n${chalk.red(message)}`);
        logUpdate.done();
        reject(message);
      });

      task.events.on("nonFatalError", (message: string) => {
        nextFrame(this.syms.nonFatalError(), message);
        resolve(postText);
      });

      task.events.on("update", (message?: string) => {
        updateText = message;
        nextFrame();
      });

      task.events.on("title", (title: string) => {
        task.title = title;
        nextFrame();
      });

      task.events.on("disable", () => {
        logUpdate.clear();
        resolve();
      });

      task.events.on("postWrite", (data: string) => {
        postText += data;
      });

      try {
        task.task(ctx, task);
      } catch (e) {
        logUpdate(` ${this.syms.error()} ${task.title}\n${chalk.red(e.message)}`);
        logUpdate.done();
        reject(e.message);
      }
    }).then(postText => {
      if (postText) {
        process.stdout.write(
          postText
            .split("\n")
            .map(l => `   ${l}`)
            .join("\n")
        );
      }
    });

    return;
  }
}

async function getResolved<T>(val: T | Promise<T>): Promise<T> {
  return Promise.resolve().then(() => val);
}
