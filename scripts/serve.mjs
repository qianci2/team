#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function safeResolve(rootDir, urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const normalized = decoded === "/" ? "/web/index.html" : decoded;
  const full = resolve(rootDir, "." + normalized);
  if (full !== rootDir && !full.startsWith(rootDir + sep)) return null;
  return full;
}

export function createStaticServer({ root = REPO_ROOT } = {}) {
  const rootDir = resolve(root);

  return createServer(async (req, res) => {
    try {
      const full = safeResolve(rootDir, req.url);
      if (!full) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }

      const body = await readFile(full);
      res.writeHead(200, {
        "content-type": MIME_TYPES[extname(full).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch (error) {
      const status = error && error.code === "ENOENT" ? 404 : 500;
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      res.end(status === 404 ? "Not Found" : "Internal Server Error");
    }
  });
}

export function startServer({ port = Number(process.env.PORT || 5173), root = REPO_ROOT } = {}) {
  const server = createStaticServer({ root });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Gemz dev server: http://127.0.0.1:${port}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer();
}
