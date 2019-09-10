import {Command} from "./command";
import {Arguments} from "yargs";
import {TaskManager} from "./tasks";
import {Token, setToken, deleteToken, getToken} from "./auth";

function serviceToToken(service: string): Token {
  service = service.toLowerCase();
  switch (service) {
    case "atom":
    case "atom.io":
      return Token.ATOMIO;
    case "github":
      return Token.GITHUB;
    default:
      throw new Error("Unexpected service name");
  }
}

function tokenToService(token: Token): string {
  switch (token) {
    case Token.ATOMIO:
      return "Atom";
    case Token.GITHUB:
      return "GitHub";
  }
}

export class Login extends Command {
  handler(argv: Arguments) {
    const tasks = new TaskManager();
    let other = false;

    if (argv.delete) {
      other = true;
      tasks.addTask({
        title: ctx => `Deleting stored token for ${ctx.service}`,
        task: async (task, ctx) => {
          if (ctx.value !== "") {
            throw new Error("Unexpected provided token when deleting");
          }
          const token = serviceToToken(ctx.service);
          const found = await deleteToken(token);
          if (found) {
            task.complete(`Deleted token for ${tokenToService(token)}`);
          } else {
            task.nonFatalError(`Could not find stored token for ${tokenToService(token)}`);
          }
        },
      });
    }

    if (argv.show) {
      other = true;
      tasks.addTask({
        title: ctx => `Printing stored token for ${ctx.service}`,
        task: async (task, ctx) => {
          if (ctx.value !== "") {
            throw new Error("Unexpected provided token when showing current value");
          }
          const token = serviceToToken(ctx.service);
          const value = await getToken(token, false);
          if (typeof value === "string") {
            task.complete(`Token: ${value}`);
          } else {
            task.error("No token stored");
          }
        },
      });
    }

    if (argv.verify) {
      other = true;
      tasks.addTask({
        title: ctx => `Verifying token for ${ctx.service}`,
        task: async (task, ctx) => {
          const token = serviceToToken(ctx.service);
          let value = ctx.value;
          if (value === "") {
            value = await getToken(token, false);
          }

          if (value === undefined) {
            throw new Error("No token to verify");
          }

          task.complete("Probably works :)");
        },
      });
    }

    if (!other) {
      tasks.addTask({
        title: ctx => `Logging in to ${ctx.service}`,
        staticWait: () => true,
        task: async (task, ctx) => {
          const service: string = ctx.service;
          const token = serviceToToken(service);
          let value: string = ctx.value;

          if (value === "") {
            value = await task.requestInput(`Please enter token for ${service}: `);
          }

          setToken(token, value);
          task.complete(`Set token for ${service}`);
        },
      });
    }

    let service = argv.service;
    if (typeof service !== "string") {
      throw new Error("Expected service name");
    }

    let value = argv.token;

    tasks.run({
      service,
      value,
      show: argv.show,
      delete: argv.delete,
    });
  }
}
