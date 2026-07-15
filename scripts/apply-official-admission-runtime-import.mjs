#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_BASE = "/Volumes/mac_2T/gaokao_zhiyuan_site_runtime/site/data/knowledge.json";
const DEFAULT_MIRROR_ROOT = "/Volumes/mac_2T/gaokao_zhiyuan_site_runtime";

function usage() {
  return [
    "Usage:",
    "  node scripts/apply-official-admission-runtime-import.mjs --import data/admissions/foo-import.json --version-prefix local-deterministic-v3.x-foo --raw data/admissions/raw/foo --mirror",
    "",
    "Options:",
    "  --import PATH          admission import JSON, relative to project root unless absolute",
    "  --version-prefix TEXT  modelPolicy.version prefix; -<recordCount>records is appended",
    "  --raw PATH             raw provenance directory to mirror; repeatable",
    "  --copy PATH            extra file to mirror; repeatable",
    "  --manifest PATH        runtime manifest output path; default next to import JSON",
    "  --base PATH            readable base knowledge.json (default: mac_2T runtime mirror)",
    "  --mirror               also copy updated runtime/provenance to /Volumes/mac_2T",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    base: DEFAULT_BASE,
    importRel: "",
    versionPrefix: "",
    rawRels: [],
    copyRels: [],
    manifestRel: "",
    mirror: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--base") {
      args.base = argv[++i];
      continue;
    }
    if (arg === "--import") {
      args.importRel = argv[++i];
      continue;
    }
    if (arg === "--version-prefix") {
      args.versionPrefix = argv[++i];
      continue;
    }
    if (arg === "--raw") {
      args.rawRels.push(argv[++i]);
      continue;
    }
    if (arg === "--copy") {
      args.copyRels.push(argv[++i]);
      continue;
    }
    if (arg === "--manifest") {
      args.manifestRel = argv[++i];
      continue;
    }
    if (arg === "--mirror") {
      args.mirror = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.importRel) throw new Error(`Missing --import\n${usage()}`);
  if (!args.versionPrefix) throw new Error(`Missing --version-prefix\n${usage()}`);
  if (!args.manifestRel) {
    args.manifestRel = args.importRel.replace(/-import\.json$/, "-runtime-manifest.json");
  }
  return args;
}

function resolveProjectPath(maybeRel) {
  return path.isAbsolute(maybeRel) ? maybeRel : path.join(PROJECT_ROOT, maybeRel);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function compactAdmissionRuntimeRecord(record) {
  const compact = { ...record };
  delete compact.sourceAttachmentTitle;
  delete compact.sourceAttachmentUrl;
  delete compact.attachmentTitle;
  delete compact.attachmentUrl;
  delete compact.sourceFile;
  delete compact.sourcePath;
  delete compact.rawRow;
  delete compact.rawText;
  delete compact.rawColumns;
  return compact;
}

function indentJsonArrayItems(items, spaces) {
  const prefix = " ".repeat(spaces);
  return items.map((item, index) => {
    const json = JSON.stringify(item, null, 2)
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
    return `${json}${index === items.length - 1 ? "" : ","}`;
  }).join("\n");
}

async function scanBaseSummary(basePath) {
  const stream = fs.createReadStream(basePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let inAdmission = false;
  let foundAll = false;
  const summary = {
    structuredRecords: null,
    rankConversionRecords: null,
    modelVersion: "",
  };
  try {
    for await (const line of rl) {
      if (!summary.modelVersion) {
        const versionMatch = line.match(/"version":\s*"([^"]+)"/);
        if (versionMatch) summary.modelVersion = versionMatch[1];
      }
      if (!inAdmission && line.includes('"admissionScoreLayer": {')) {
        inAdmission = true;
        continue;
      }
      if (inAdmission && summary.structuredRecords == null) {
        const match = line.match(/"structuredRecords":\s*(\d+)/);
        if (match) summary.structuredRecords = Number(match[1]);
      }
      if (inAdmission && summary.rankConversionRecords == null) {
        const match = line.match(/"rankConversionRecords":\s*(\d+)/);
        if (match) summary.rankConversionRecords = Number(match[1]);
      }
      if (summary.structuredRecords != null && summary.rankConversionRecords != null && summary.modelVersion) {
        foundAll = true;
        break;
      }
    }
  } finally {
    if (foundAll) {
      rl.close();
      stream.destroy();
    }
  }
  if (!Number.isFinite(summary.structuredRecords)) {
    throw new Error(`Could not find admissionScoreLayer.structuredRecords in ${basePath}`);
  }
  return summary;
}

function writeLine(out, line) {
  out.write(`${line}\n`);
}

async function transformKnowledge({ basePath, outPath, importPayload, importRel, versionPrefix, summary, generatedAt }) {
  const newRecords = (importPayload.records || []).map(compactAdmissionRuntimeRecord);
  const newSourceNotes = (importPayload.sourceNotes || []).map((source) => ({ ...source, file: importRel }));
  const newStructuredRecords = summary.structuredRecords + newRecords.length;
  const newVersion = `${versionPrefix}-${newStructuredRecords}records`;
  const statusLabel = `已接入${newStructuredRecords}条结构化录取/计划数据${summary.rankConversionRecords ? ` + ${summary.rankConversionRecords}条一分一段记录` : ""}`;

  ensureDir(path.dirname(outPath));
  const input = fs.createReadStream(basePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const out = fs.createWriteStream(outPath, { encoding: "utf8" });
  let inAdmission = false;
  let inRecordsArray = false;
  let inSourceNotesArray = false;
  let replacedGeneratedAt = false;
  let replacedVersion = false;
  let appendedRecords = false;
  let appendedSourceNotes = false;

  for await (let line of rl) {
    if (!replacedGeneratedAt && line.match(/^  "generatedAt":/)) {
      line = `  "generatedAt": "${generatedAt}",`;
      replacedGeneratedAt = true;
    }
    if (!replacedVersion && line.match(/^\s+"version": "local-deterministic-/)) {
      line = line.replace(/"version": "[^"]+"/, `"version": "${newVersion}"`);
      replacedVersion = true;
    }
    if (!inAdmission && line.includes('"admissionScoreLayer": {')) {
      inAdmission = true;
      writeLine(out, line);
      continue;
    }
    if (inAdmission && !inRecordsArray && !inSourceNotesArray) {
      if (line.match(/^    "structuredRecords":\s*\d+,?$/)) {
        writeLine(out, `    "structuredRecords": ${newStructuredRecords},`);
        continue;
      }
      if (line.match(/^    "statusLabel":/)) {
        writeLine(out, `    "statusLabel": "${statusLabel}",`);
        continue;
      }
      if (line.match(/^    "records": \[$/)) {
        inRecordsArray = true;
        writeLine(out, line);
        continue;
      }
      if (line.match(/^    "sourceNotes": \[$/)) {
        inSourceNotesArray = true;
        writeLine(out, line);
        continue;
      }
    }
    if (inRecordsArray && line.match(/^    \],?$/)) {
      writeLine(out, ",");
      out.write(`${indentJsonArrayItems(newRecords, 6)}\n`);
      writeLine(out, line);
      inRecordsArray = false;
      appendedRecords = true;
      continue;
    }
    if (inSourceNotesArray && line.match(/^    \],?$/)) {
      writeLine(out, ",");
      out.write(`${indentJsonArrayItems(newSourceNotes, 6)}\n`);
      writeLine(out, line);
      inSourceNotesArray = false;
      appendedSourceNotes = true;
      continue;
    }
    writeLine(out, line);
  }

  await new Promise((resolve, reject) => {
    out.end(resolve);
    out.on("error", reject);
  });
  if (!replacedGeneratedAt) throw new Error("Did not replace generatedAt");
  if (!replacedVersion) throw new Error("Did not replace modelPolicy.version");
  if (!appendedRecords) throw new Error("Did not append admissionScoreLayer.records");
  if (!appendedSourceNotes) throw new Error("Did not append admissionScoreLayer.sourceNotes");
  return { newStructuredRecords, newVersion, recordsAdded: newRecords.length, sourceNotesAdded: newSourceNotes.length };
}

function backupExisting(file, label) {
  if (!fs.existsSync(file)) return "";
  const backup = `${file}.pre-${label}-backup-${Date.now()}`;
  fs.renameSync(file, backup);
  return backup;
}

function installKnowledgeOnInternalVolume(tempKnowledge, siteKnowledge, dataKnowledge, label) {
  ensureDir(path.dirname(siteKnowledge));
  ensureDir(path.dirname(dataKnowledge));
  const siteBackup = backupExisting(siteKnowledge, label);
  fs.renameSync(tempKnowledge, siteKnowledge);
  const dataBackup = backupExisting(dataKnowledge, label);
  try {
    fs.linkSync(siteKnowledge, dataKnowledge);
  } catch {
    fs.copyFileSync(siteKnowledge, dataKnowledge);
  }
  return { siteBackup, dataBackup };
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith("._") || entry.name === ".DS_Store") continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) copyFile(from, to);
  }
}

function copyRuntimeAndProvenanceToMirror({ mirrorRoot, siteKnowledge, dataKnowledge, importRel, manifestRel, rawRels, copyRels, manifest }) {
  copyFile(siteKnowledge, path.join(mirrorRoot, "site/data/knowledge.json"));
  copyFile(dataKnowledge, path.join(mirrorRoot, "data/knowledge.json"));
  copyFile(resolveProjectPath(importRel), path.join(mirrorRoot, importRel));
  copyFile(resolveProjectPath(manifestRel), path.join(mirrorRoot, manifestRel));
  for (const rel of copyRels) {
    const src = resolveProjectPath(rel);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) copyFile(src, path.join(mirrorRoot, rel));
  }
  for (const rel of rawRels) {
    const src = resolveProjectPath(rel);
    if (fs.existsSync(src) && fs.statSync(src).isDirectory()) copyDir(src, path.join(mirrorRoot, rel));
  }
  const label = path.basename(manifestRel, ".json");
  fs.writeFileSync(path.join(mirrorRoot, `mirror-manifest-${label}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const importPayload = JSON.parse(fs.readFileSync(resolveProjectPath(args.importRel), "utf8"));
  const basePath = path.resolve(args.base);
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const summary = await scanBaseSummary(basePath);
  const label = args.versionPrefix.match(/v\d+\.\d+/)?.[0]?.replace(".", "") || "admission-import";
  const tmpDir = path.join(os.homedir(), ".codex/tmp/gaokao-runtime-import");
  ensureDir(tmpDir);
  const tempKnowledge = path.join(tmpDir, `knowledge-${label}-${Date.now()}.json`);
  const transform = await transformKnowledge({
    basePath,
    outPath: tempKnowledge,
    importPayload,
    importRel: args.importRel,
    versionPrefix: args.versionPrefix,
    summary,
    generatedAt,
  });
  const siteKnowledge = path.join(PROJECT_ROOT, "site/data/knowledge.json");
  const dataKnowledge = path.join(PROJECT_ROOT, "data/knowledge.json");
  const backups = installKnowledgeOnInternalVolume(tempKnowledge, siteKnowledge, dataKnowledge, label);
  const manifestRel = args.manifestRel;
  const manifestPath = resolveProjectPath(manifestRel);
  const manifest = {
    generatedAt,
    mode: "targeted-stream-injection",
    basePath,
    previousModelVersion: summary.modelVersion,
    modelVersion: transform.newVersion,
    structuredRecordsBefore: summary.structuredRecords,
    structuredRecordsAfter: transform.newStructuredRecords,
    recordsAdded: transform.recordsAdded,
    sourceNotesAdded: transform.sourceNotesAdded,
    importPath: args.importRel,
    rawPaths: args.rawRels,
    copiedFiles: args.copyRels,
    backups,
    siteKnowledgeSha256: sha256File(siteKnowledge),
    dataKnowledgeSha256: sha256File(dataKnowledge),
    cautions: [
      "This targeted injector appends one official admission import to the runtime records/sourceNotes arrays and updates headline count/version without running the dataless full build script.",
      "formalScoreMissingProvinces is intentionally not closed by school-official-only or special-path-only evidence.",
    ],
  };
  ensureDir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (args.mirror) {
    copyRuntimeAndProvenanceToMirror({
      mirrorRoot: DEFAULT_MIRROR_ROOT,
      siteKnowledge,
      dataKnowledge,
      importRel: args.importRel,
      manifestRel,
      rawRels: args.rawRels,
      copyRels: [...args.copyRels, "scripts/apply-official-admission-runtime-import.mjs"],
      manifest,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    modelVersion: transform.newVersion,
    previousModelVersion: summary.modelVersion,
    structuredRecordsBefore: summary.structuredRecords,
    structuredRecordsAfter: transform.newStructuredRecords,
    recordsAdded: transform.recordsAdded,
    sourceNotesAdded: transform.sourceNotesAdded,
    siteKnowledgeSha256: manifest.siteKnowledgeSha256,
    dataKnowledgeSha256: manifest.dataKnowledgeSha256,
    mirrored: args.mirror,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
