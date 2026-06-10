const http = require("node:http");
const handler = require("../api/github-card");

const START_PORT = Number(process.env.PORT || 3000);
const MAX_PORT = START_PORT + 20;
const HOST = process.env.HOST || "127.0.0.1";

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/github-card") {
      req.query = Object.fromEntries(url.searchParams.entries());

      try {
        await handler(req, res);
      } catch (error) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(error.stack || error.message);
      }

      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub pulse preview</title>
    <style>
      html { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #080b10;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      img {
        width: min(900px, calc(100vw - 32px));
        height: auto;
      }
    </style>
  </head>
  <body>
    <img src="/api/github-card?username=kevingamez" alt="GitHub pulse preview" />
  </body>
</html>`);
  });
}

function listen(port) {
  const server = createServer();

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && port < MAX_PORT) {
      listen(port + 1);
      return;
    }

    throw error;
  });

  server.listen(port, HOST, () => {
    console.log(`GitHub pulse preview: http://${HOST}:${port}`);
    console.log(`SVG endpoint: http://${HOST}:${port}/api/github-card?username=kevingamez`);
  });
}

listen(START_PORT);
