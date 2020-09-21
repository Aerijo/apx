import * as fs from "fs";
import chalk, {Chalk} from "chalk";

export interface Log {
  /**
   * Indicate a new task being performed, but not one that
   * requires constructing a sub log
   */
  update(...msg: string[]): void;

  /**
   * Indicate a task is being skipped.
   */
  skip(...msg: string[]): void;

  /**
   * A message that is not useful for normal runs, but
   * may be useful to track down a bug.
   */
  silly(...msg: string[]): void;

  /**
   * A message that is not useful for normal runs, but
   * may be useful to get a deeper understanding of the
   * internals. Messages are more relevant than `silly` ones
   */
  verbose(...msg: string[]): void;

  /**
   * Messages that log information about what a task
   * has done / found.
   */
  info(...msg: string[]): void;

  /**
   * A message to indicate probable failure, but not
   * necessarily.
   */
  warn(...msg: string[]): void;

  /**
   * A message to indicate failure that prevents a task
   * from producing an expected result.
   */
  error(...msg: string[]): void;
}

enum LogPriority {
  SILLY = 0,
  VERBOSE = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  GROUP = INFO,
  UPDATE = INFO,
}

export class ConsoleLog implements Log {
  private updateColor = chalk.yellow;
  private updatePrefix = ">";

  private infoColor = chalk.blue;
  private infoPrefix = "-";

  private warnColor = chalk.yellow;
  private warnPrefix = "!";

  private errorColor = chalk.red;
  private errorPrefix = "!!!";

  private minPriority: LogPriority = LogPriority.SILLY;

  private print(prefix: string, msg: string): void {
    console.log(`${prefix} ${msg}`);
  }

  private logPrint(priority: LogPriority, color: Chalk, prefix: string, msg: string[]) {
    if (priority < this.minPriority) {
      return;
    }

    this.print(color(prefix), color(msg.join(" ")));
  }

  update(...msg: string[]) {
    this.logPrint(LogPriority.UPDATE, this.updateColor, this.updatePrefix, msg);
  }

  skip(...msg: string[]) {
    this.logPrint(LogPriority.GROUP, chalk.grey, "^", msg);
  }

  silly(...msg: string[]) {
    this.info(...msg);
  }

  verbose(...msg: string[]) {
    this.info(...msg);
  }

  info(...msg: string[]) {
    this.logPrint(LogPriority.INFO, this.infoColor, this.infoPrefix, msg);
  }

  warn(...msg: string[]) {
    this.logPrint(LogPriority.WARN, this.warnColor, this.warnPrefix, msg);
  }

  error(...msg: string[]) {
    this.logPrint(LogPriority.ERROR, this.errorColor, this.errorPrefix, msg);
  }
}

export class NullLog implements Log {
  error(..._msg: string[]): void {}
  warn(..._msg: string[]): void {}
  info(..._msg: string[]): void {}
  verbose(..._msg: string[]): void {}
  silly(..._msg: string[]): void {}
  skip(..._msg: string[]): void {}
  update(..._msg: string[]): void {}
}

export class FileLog implements Log {
  private logPath: string;
  private handle: number;

  private updatePrefix = ">";
  private infoPrefix = "-";
  private warnPrefix = "!";
  private errorPrefix = "!!!";

  private minPriority: LogPriority = LogPriority.SILLY;

  constructor(logPath: string) {
    this.logPath = logPath;
    this.handle = fs.openSync(this.logPath, "as");

    this.write(LogPriority.GROUP, ">>>", "Starting new log");
  }

  private write(priority: LogPriority, prefix: string, ...msg: string[]): void {
    if (priority < this.minPriority) {
      return;
    }

    fs.writeSync(this.handle, `${Date.now()}: ${prefix} ${msg.join(" ")}\n`);
  }

  error(...msg: string[]): void {
    this.write(LogPriority.ERROR, this.errorPrefix, ...msg);
  }

  warn(...msg: string[]): void {
    this.write(LogPriority.WARN, this.warnPrefix, ...msg);
  }
  info(...msg: string[]): void {
    this.write(LogPriority.INFO, this.infoPrefix, ...msg);
  }
  verbose(...msg: string[]): void {
    this.write(LogPriority.VERBOSE, this.infoPrefix, ...msg);
  }
  silly(...msg: string[]): void {
    this.write(LogPriority.SILLY, this.infoPrefix, ...msg);
  }
  skip(...msg: string[]): void {
    this.write(LogPriority.GROUP, "^", ...msg);
  }
  update(...msg: string[]): void {
    this.write(LogPriority.UPDATE, this.updatePrefix, ...msg);
  }
}
