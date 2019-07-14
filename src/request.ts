import * as https from "https";
import {GraphQLClient} from "graphql-request";

export function getJson(url: string): Promise<any> {
  return new Promise(resolve => {
    console.log(`requesting ${url}`);

    https.get(url, res => {
      let message = "";

      res.setEncoding("utf8");

      res.on("data", data => {
        message += data;
      });

      res.on("close", () => {
        resolve(JSON.parse(message));
      });
    });
  });
}

const githubGraphql = "https://api.github.com/graphql";
const graphQLClient = new GraphQLClient(githubGraphql, {
  headers: {
    authorization: `Bearer ${process.env.GITHUB_AUTH_TOKEN}`,
  },
});

export function getGithubGraphql(query: string): Promise<any> {
  if (!process.env.GITHUB_AUTH_TOKEN) {
    throw new Error(
      "GitHub personal access token required in environment variable GITHUB_AUTH_TOKEN\nSee https://help.github.com/en/articles/creating-a-personal-access-token-for-the-command-line"
    );
  }
  return graphQLClient.request(query);
}
