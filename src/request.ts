import * as https from "https";


export function getJson (url: string): Promise<any> {
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
  })
}
