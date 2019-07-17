import * as child_process from "child_process";
import { Context } from './context';
import { Arguments } from 'yargs';

export class Doctor {
  context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  doctorNpm(): Promise<number> {
    return new Promise(resolve => {
      const child = child_process.spawn("npm", ["doctor"], {env: this.context.getElectronEnv()});
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", data => {console.log(data)});
      child.stderr.on("data", data => {console.error(data)});

      child.on("exit", (code, _signal) => {
        resolve(code || 0);
      });
    });
  }

  async checkNativeBuild(): Promise<number> {
    return 0;
  }

  async handler(_argv: Arguments): Promise<number> {
    await this.doctorNpm();
    await this.checkNativeBuild();
    return 0;
  }
}
