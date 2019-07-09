import * as yargs from "yargs";

function getArguments() {
  return yargs
    .wrap(Math.min(100, yargs.terminalWidth() || 100))
    .option("version", {
      alias: "v",
      describe: "Print the apx version",
    })
    .option("help", {
      alias: "h",
      describe: "Print this usage message",
    })
    .parse();
}

console.log(getArguments());
