import * as yargs from "yargs";
yargs.wrap(Math.min(120, yargs.terminalWidth()));

import {Context} from "./context";
import {Install} from "./install";

// Allow 'require' on ASAR archived files
require("asar-require");


function getArguments (context: Context) {
  return yargs
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
      describe: "Installs a package or it's dependencies.",
      builder () {
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
      handler (argv) {
        const install = new Install(context);
        install.handler(argv);
      },
    })
    .parse();
}


export function main (): number {
  const context = new Context();

  const argv = getArguments(context);
  const command = argv._[0];

  if (!command) {
    yargs.showHelp();
  }

  return 0;
}


if (require.main === module) {
  main();
}
