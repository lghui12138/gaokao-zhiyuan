#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = process.env.GAOKAO_GITHUB_REPO || "lghui12138/gaokao-zhiyuan";
const tag = process.env.GAOKAO_DATA_RELEASE || "data-v3.275";
const asset = process.env.GAOKAO_KNOWLEDGE_ASSET || "knowledge-v3.275.json.gz";
const releaseVersion = tag.replace(/^data-/, "");
const manifestFile = process.env.GAOKAO_RELEASE_MANIFEST
  ? path.resolve(projectRoot, process.env.GAOKAO_RELEASE_MANIFEST)
  : path.join(projectRoot, "docs", `runtime-release-manifest-${releaseVersion}.json`);
const downloadDir = path.join(projectRoot, "tmp", "github-release", tag);
const downloaded = path.join(downloadDir, asset);
const master = path.join(projectRoot, "site", "data", "knowledge.json");
const dataMaster = path.join(projectRoot, "data", "knowledge.json");

function usage() {
  return [
    "Usage:",
    "  node scripts/restore-runtime-from-github-release.mjs",
    "  node scripts/restore-runtime-from-github-release.mjs --verify path/to/knowledge-v3.275.json.gz",
    "",
    "Downloads the canonical release asset, checks bytes/SHA-256/gzip integrity,",
    "then atomically restores the local master and rebuilds province shards.",
  ].join("\n");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: "utf8", stdio: options.stdio || "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
  return result;
}

function parseArgs(argv) {
  const args = { verifyOnly: null };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (value === "--verify") {
      const file = argv[++index];
      if (!file) throw new Error(`--verify requires a file path\n${usage()}`);
      args.verifyOnly = path.resolve(projectRoot, file);
      continue;
    }
    throw new Error(`Unknown argument: ${value}\n${usage()}`);
  }
  return args;
}

function expectedAsset() {
  if (!fs.existsSync(manifestFile)) throw new Error(`Release manifest is missing: ${manifestFile}`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const entry = (manifest.assets || []).find((item) => item.file === asset);
  if (!entry || !Number.isFinite(entry.bytes) || !/^[a-f0-9]{64}$/i.test(entry.sha256 || "")) {
    throw new Error(`Release manifest has no valid checksum entry for ${asset}`);
  }
  return { modelVersion: manifest.modelVersion, ...entry };
}

function sha256(file) {
  const result = run("shasum", ["-a", "256", file], { stdio: ["ignore", "pipe", "inherit"] });
  const hash = result.stdout.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error(`Unable to read SHA-256 for ${file}`);
  return hash;
}

function verifyAsset(file, expected) {
  if (!fs.existsSync(file)) throw new Error(`Release asset was not downloaded: ${file}`);
  const bytes = fs.statSync(file).size;
  if (bytes !== expected.bytes) {
    throw new Error(`Release asset size mismatch for ${asset}: expected ${expected.bytes}, received ${bytes}`);
  }
  const actualSha256 = sha256(file);
  if (actualSha256 !== expected.sha256) {
    throw new Error(`Release asset SHA-256 mismatch for ${asset}: expected ${expected.sha256}, received ${actualSha256}`);
  }
  run("gzip", ["-t", file]);
  return { bytes, sha256: actualSha256 };
}

function restore() {
  fs.mkdirSync(path.dirname(master), { recursive: true });
  const tempMaster = `${master}.restore-${process.pid}`;
  fs.rmSync(tempMaster, { force: true });
  const out = fs.openSync(tempMaster, "w");
  try {
    const result = spawnSync("gzip", ["-dc", downloaded], { cwd: projectRoot, stdio: ["ignore", out, "inherit"] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`gzip failed with status ${result.status}`);
    fs.renameSync(tempMaster, master);
  } finally {
    fs.closeSync(out);
    fs.rmSync(tempMaster, { force: true });
  }
  fs.rmSync(dataMaster, { force: true });
  fs.linkSync(master, dataMaster);
  run(process.execPath, ["scripts/build-browser-runtime-shards.mjs"]);
}

try {
  if (projectRoot.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing direct mac_2T processing; run from the internal APFS project copy.");
  }
  const args = parseArgs(process.argv);
  const expected = expectedAsset();
  if (args.verifyOnly) {
    const verified = verifyAsset(args.verifyOnly, expected);
    console.log(JSON.stringify({ ok: true, mode: "verify", asset, modelVersion: expected.modelVersion, ...verified }, null, 2));
  } else {
    fs.mkdirSync(downloadDir, { recursive: true });
    run("gh", ["release", "download", tag, "--repo", repo, "--pattern", asset, "--dir", downloadDir, "--clobber"]);
    const verified = verifyAsset(downloaded, expected);
    restore();
    console.log(JSON.stringify({ ok: true, repo, tag, asset, modelVersion: expected.modelVersion, master, ...verified }, null, 2));
  }
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
