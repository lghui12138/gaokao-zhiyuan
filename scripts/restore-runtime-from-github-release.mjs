#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = process.env.GAOKAO_GITHUB_REPO || "lghui12138/gaokao-zhiyuan";
const tag = process.env.GAOKAO_DATA_RELEASE || "data-v3.275";
const asset = process.env.GAOKAO_KNOWLEDGE_ASSET || "knowledge-v3.275.json.gz";
const downloadDir = path.join(projectRoot, "tmp", "github-release", tag);
const downloaded = path.join(downloadDir, asset);
const master = path.join(projectRoot, "site", "data", "knowledge.json");
const dataMaster = path.join(projectRoot, "data", "knowledge.json");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}

function main() {
  fs.mkdirSync(downloadDir, { recursive: true });
  run("gh", ["release", "download", tag, "--repo", repo, "--pattern", asset, "--dir", downloadDir, "--clobber"]);
  if (!fs.existsSync(downloaded)) throw new Error(`Release asset was not downloaded: ${downloaded}`);
  fs.rmSync(master, { force: true });
  run("gzip", ["-dc", downloaded]);
}

// gzip writes to stdout, so use a file descriptor instead of buffering the
// 1GB-plus JSON payload in Node memory.
function restore() {
  fs.mkdirSync(path.dirname(master), { recursive: true });
  fs.rmSync(master, { force: true });
  const out = fs.openSync(master, "w");
  try {
    const result = spawnSync("gzip", ["-dc", downloaded], { cwd: projectRoot, stdio: ["ignore", out, "inherit"] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`gzip failed with status ${result.status}`);
  } finally {
    fs.closeSync(out);
  }
  fs.rmSync(dataMaster, { force: true });
  fs.linkSync(master, dataMaster);
  run(process.execPath, ["scripts/build-browser-runtime-shards.mjs"]);
}

try {
  fs.mkdirSync(downloadDir, { recursive: true });
  run("gh", ["release", "download", tag, "--repo", repo, "--pattern", asset, "--dir", downloadDir, "--clobber"]);
  if (!fs.existsSync(downloaded)) throw new Error(`Release asset was not downloaded: ${downloaded}`);
  restore();
  console.log(JSON.stringify({ ok: true, repo, tag, asset, master }, null, 2));
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
