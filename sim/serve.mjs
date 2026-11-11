#!/usr/bin/env node
/**
 * Server locale per il report di simulazione.
 *
 *   node sim/serve.mjs          -> http://127.0.0.1:8765/report.html
 *   node sim/serve.mjs 3000     -> http://127.0.0.1:3000/report.html
 *
 * Serve solo i file dentro sim/out. Nessuna dipendenza esterna.
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./out/", import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8765);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/report.html";

  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const stat = statSync(file);
    if (!stat.isFile()) throw new Error("not a file");

    response.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(
      "Report non trovato.\nGeneralo prima con: node sim/run.mjs\n",
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Foundry War - report: http://127.0.0.1:${port}/report.html`);
});
