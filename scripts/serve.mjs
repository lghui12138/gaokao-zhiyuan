#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SITE_ROOT = path.join(PROJECT_ROOT, "site");
const MIRROR_SITE_ROOT = path.resolve(process.env.GAOKAO_MIRROR_SITE_ROOT || "/Volumes/mac_2T/gaokao_zhiyuan_site_runtime/site");
const HOST = process.env.GAOKAO_HOST || "127.0.0.1";
const PORT = Number(process.env.GAOKAO_PORT || 4177);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function safeSitePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(SITE_ROOT, relative);
  if (resolved !== SITE_ROOT && !resolved.startsWith(`${SITE_ROOT}${path.sep}`)) return null;
  return resolved;
}

function runtimeDataFile(urlPath = "/data/knowledge.json") {
  const relative = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const mirror = path.resolve(MIRROR_SITE_ROOT, relative);
  const internal = path.resolve(SITE_ROOT, relative);
  const mirrorAllowed = mirror === MIRROR_SITE_ROOT || mirror.startsWith(`${MIRROR_SITE_ROOT}${path.sep}`);
  const internalAllowed = internal === SITE_ROOT || internal.startsWith(`${SITE_ROOT}${path.sep}`);
  if (!mirrorAllowed || !internalAllowed) return null;
  if (fs.existsSync(mirror) && fs.statSync(mirror).isFile()) {
    return { file: mirror, source: "mac_2T-mirror" };
  }
  return { file: internal, source: "internal-apfs" };
}

function sendFile(req, res, file, extraHeaders = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
    return;
  }
  const headers = {
    "content-type": MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": path.extname(file) === ".json" ? "no-store" : "no-cache",
    ...extraHeaders,
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on("error", (error) => {
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Read error: ${error.message}\n`);
  });
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  if (!req.url || !["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
    res.end("Method not allowed\n");
    return;
  }
  const requestPath = req.url.split("?")[0];
  if (/^\/data\/(?:knowledge(?:-core)?\.json|provinces\/[a-z-]+\.json)$/.test(requestPath)) {
    const data = runtimeDataFile(req.url);
    if (!data) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad path\n");
      return;
    }
    sendFile(req, res, data.file, { "x-gaokao-data-source": data.source });
    return;
  }
  const file = safeSitePath(req.url);
  if (!file) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad path\n");
    return;
  }
  sendFile(req, res, file);
});

server.listen(PORT, HOST, () => {
  const data = runtimeDataFile();
  console.log(JSON.stringify({
    ok: true,
    url: `http://${HOST}:${PORT}/`,
    siteRoot: SITE_ROOT,
    dataFile: data.file,
    dataSource: data.source,
  }, null, 2));
});

function shutdown(signal) {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
  console.error(`${signal}: closing gaokao local server`);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
