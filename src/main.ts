import * as yargs from "yargs";
yargs.wrap(Math.min(140, yargs.terminalWidth()));

import {Context, getTargetFromString} from "./context";
import {Install} from "./install";
import {Uninstall} from "./uninstall";
import {Publish} from "./publish";
import {Doctor} from "./doctor";

// Allow 'require' on ASAR archived files
// import "asar-require";
import {Arguments} from "yargs";

function getArguments(context: Context) {
  return yargs
    .scriptName("apx")
    .demandCommand(1)
    .strict()
    .option("version", {
      alias: "v",
      describe: "Print the apx version",
    })
    .option("help", {
      alias: "h",
      describe: "Print this usage message",
    })
    .option("target", {
      describe:
        "The version of Atom to customise operations for. `dev` makes it use your local atom source repo",
      alias: "t",
      choices: ["stable", "beta", "nightly", "dev"],
      requiresArg: true,
      group: "Target:",
    })
    .option("stable", {
      describe: "Equivalent to --target=stable",
      type: "boolean",
      group: "Target:",
    })
    .option("beta", {
      describe: "Equivalent to --target=beta",
      type: "boolean",
      group: "Target:",
    })
    .option("nightly", {
      describe: "Equivalent to --target=nightly",
      type: "boolean",
      group: "Target:",
    })
    .option("tdev", {
      describe: "Equivalent to --target=dev",
      type: "boolean",
      group: "Target:",
    })
    .command({
      command: "install [uri]",
      describe: "Installs a package or it's dependencies",
      builder() {
        return yargs
          .positional("uri", {
            describe:
              "An identifier of the package to install. Use `.` or omit to install dependencies for the current package",
            type: "string",
            default: ".",
          })
          .option("dev", {
            alias: "d",
            describe: "Install to the dev folder",
            type: "boolean",
          });
      },
      handler(argv) {
        const install = new Install(context);
        return install.handler(argv);
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
        return yargs
          .positional("newversion", {
            describe:
              "Optionally specify version bump, from patch, minor, major, or explicit of form x.y.z",
            type: "string",
            default: "",
          })
          .option("assets", {
            describe:
              "Build and upload the package to the GitHub release. Pass --no-assets to disable",
            type: "boolean",
            default: true, // TODO: Make configurable in config
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
    .command({
      command: "default <name> <value>",
      describe: "Configure apx defaults",
      builder() {
        return yargs
          .positional("name", {
            describe:
              "The name of the default. `unset` is special cased; if used, then <value> is unset. Otherwise, only `target` is currently recognised, with arguments matching the flag.",
            type: "string",
            default: "",
          })
          .positional("value", {
            describe: "The new value of the default",
            type: "string",
            default: "",
          });
      },
      handler(argv) {
        // TODO: Fix jank
        if (argv.name === "unset") {
          context.unsetDefault(argv.value as string);
        } else {
          context.setDefault(argv.name as string, argv.value as string);
        }
      },
    })
    .middleware([
      a => {
        setTargetFromArgs(a, context);
      },
    ])
    .parse();
}

function setTargetFromArgs(argv: Arguments, context: Context) {
  let targetCount = 0;
  if (typeof argv.target === "string") {
    targetCount += 1;
    const target = getTargetFromString(argv.target);
    if (target === undefined) {
      throw new Error(`Unrecognised target ${argv.target}`);
    }
    context.setTarget(target);
  }

  for (const target of ["stable", "beta", "nightly", "dev"]) {
    if (argv[target]) {
      targetCount += 1;
      context.setTarget(getTargetFromString(target)!);
    }
  }

  if (targetCount > 1) {
    throw new Error("Multiple target flags specified; try again with only one");
  }
}

export function main(): number {
  const context = new Context();
  getArguments(context);
  return 0;
}

if (require.main === module) {
  main();
}
