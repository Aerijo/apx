import {Command} from "./command";
import {Arguments} from "yargs";
import {TaskManager} from "./tasks";
import {Token, setToken} from "./auth";

function serviceToToken(service: string): Token {
  service = service.toLowerCase();
  switch (service) {
    case "atom":
      return Token.ATOMIO;
    case "github":
      return Token.GITHUB;
    default:
      throw new Error("Unexpected service name");
  }
}

export class Login extends Command {
  handler(argv: Arguments) {
    const tasks = new TaskManager([
      {
        title: (ctx) => `Logging in to ${ctx.service}`,
        staticWait: () => true,
        task: async (task, ctx) => {
          const service: string = ctx.service;
          const token = serviceToToken(service);
          let value: string = ctx.value;

          if (value === "") {
            value  = await task.requestInput(`Please enter token for service ${service}: `);
          }

          setToken(token, value);
          task.complete(`Set token for ${service}`);
        },
      },
    ]);

    let service = argv.service;
    if (typeof service !== "string") {
      throw new Error("Expected service name");
    }

    let value = argv.token;

    tasks.run({
      service,
      value,
    });
  }
}
