import * as yargs from "yargs";
yargs.wrap(Math.min(120, yargs.terminalWidth()));

import {Context} from "./context";
import {Install} from "./install";
import {Publish} from "./publish";
import {Doctor} from "./doctor";

// Allow 'require' on ASAR archived files
import "asar-require";
import {Uninstall} from "./uninstall";

function getArguments(context: Context) {
  return yargs
    .demandCommand(1)
    .option("version", {
      alias: "v",
      describe: "Print the apx version",
    })
    .option("help", {
      alias: "h",
      describe: "Print this usage message",
    })
    .command({
      command: "install [uri]",
      describe: "Installs a package or it's dependencies",
      builder() {
        return yargs
          .positional("uri", {
            describe: "An identifier of the package to install",
            type: "string",
            default: ".",
          })
          .option("dev", {
            alias: "d",
            describe: "Install to the dev folder",
            type: "boolean",
          })
          .option("check", {
            describe: "Check that native modules can be built",
            type: "boolean",
          });
      },
      handler(argv) {
        const install = new Install(context);
        install.handler(argv);
      },
    })
    .command({
      command: "uninstall <package>",
      describe: "Uninstall a package",
      builder() {
        return yargs.positional("package", {
          describe: "The name of the package to uninstall. A path is not permitted.",
          type: "string",
        });
      },
      handler(argv) {
        const uninstall = new Uninstall(context);
        return uninstall.handler(argv);
      },
    })
    .command({
      command: "publish [newversion]",
      describe: "Publish the package",
      builder() {
        return yargs.positional("newversion", {
          describe:
            "Optionally specify version bump, from patch, minor, major, or explicit of form x.y.z",
          type: "string",
          default: "",
        });
      },
      handler(argv) {
        const publish = new Publish(context);
        publish.handler(argv);
      },
    })
    .command({
      command: "doctor",
      describe: "Verify that your installation is working correctly",
      handler(argv) {
        const doctor = new Doctor(context);
        return doctor.handler(argv);
      },
    })
    .parse();
}

export function main(): number {
  const context = new Context();
  getArguments(context);
  return 0;
}

if (require.main === module) {
  main();
}
