#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const SOURCE_ID = "official-xizang-vacancy-plans-2025-v3272";
const SCHEDULE_SOURCE_ID = "official-xizang-admission-schedule-2026-v3272";
const EXPECTED_TOTAL_RECORDS = 843963;
const EXPECTED_REPLACEMENTS = 2187;
const FINDING = "西藏2025年12次官方征集志愿公告及23个附件已解析为2187条专业级剩余计划快照，其中普通路径2157条、特殊路径30条（含3条边境专项）；926条普通高职专科征集记录可用于识别历史补录信号。征集资格线不是录取分，多轮剩余计划不得相加；2026年录取按考试院日程分批进行，西藏普通类一分一段、全量投档/录取表和专业最低位次仍未闭合。";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") args.input = argv[++index];
    else if (argv[index] === "--import") args.import = argv[++index];
    else if (argv[index] === "--out") args.out = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.input || !args.import || !args.out) {
    throw new Error("Usage: refresh-xizang-vacancy-records-v3272.mjs --input <knowledge.json> --import <import.json> --out <knowledge.json>");
  }
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, path.resolve(value)]));
}

function canonicalPath(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
}

function validatePaths(args) {
  const canonical = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, canonicalPath(value)]));
  for (const [key, file] of Object.entries(canonical)) {
    if (file === "/Volumes/mac_2T" || file.startsWith("/Volumes/mac_2T/")) {
      throw new Error(`Refusing direct mac_2T processing for --${key}; use internal APFS staging.`);
    }
  }
  for (const [left, right] of [["input", "import"], ["input", "out"], ["import", "out"]]) {
    if (canonical[left] === canonical[right]) throw new Error(`--${left} and --${right} must differ.`);
  }
}

async function writeWithBackpressure(stream, text) {
  if (!stream.write(text)) await once(stream, "drain");
}

function formatNestedObject(record, trailingComma) {
  const lines = JSON.stringify(record, null, 2).split("\n").map((line) => `      ${line}`);
  if (trailingComma) lines[lines.length - 1] += ",";
  return `${lines.join("\n")}\n`;
}

export async function refreshKnowledge(args, expectations = {}) {
  const expectedTotalRecords = expectations.totalRecords ?? EXPECTED_TOTAL_RECORDS;
  const expectedReplacements = expectations.replacements ?? EXPECTED_REPLACEMENTS;
  validatePaths(args);

  const payload = JSON.parse(fs.readFileSync(args.import, "utf8"));
  if (payload.dataset !== "official-xizang-vacancy-plans-2025-v3272") throw new Error("Unexpected import dataset");
  if (payload.records.length !== expectedReplacements || payload.sourceNotes.length !== 2) throw new Error("Unexpected import cardinality");
  if (
    !payload.audit
    || !Number.isInteger(payload.audit.ordinaryRecordCount)
    || !Number.isInteger(payload.audit.specialPathRecordCount)
  ) {
    throw new Error("Unexpected import audit");
  }
  const replacementRecords = new Map(payload.records.map((record) => [record.id, record]));
  const replacementNotes = new Map(payload.sourceNotes.map((note) => [note.id, note]));
  if (replacementRecords.size !== expectedReplacements) throw new Error("Duplicate replacement record IDs");
  if (!replacementNotes.has(SOURCE_ID) || !replacementNotes.has(SCHEDULE_SOURCE_ID)) throw new Error("Missing replacement source notes");

  const tempOut = path.join(
    path.dirname(args.out),
    `.${path.basename(args.out)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const input = fs.createReadStream(args.input, { encoding: "utf8" });
  const output = fs.createWriteStream(tempOut, { encoding: "utf8", flags: "wx" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let inAdmission = false;
  let section = "";
  let collecting = false;
  let objectLines = [];
  let totalRecords = 0;
  let replacedRecords = 0;
  let replacedSourceNotes = 0;
  let replacedFinding = false;
  const seenReplacementIds = new Set();
  let committed = false;

  try {
    for await (let line of lines) {
      if (!inAdmission && line.includes('"admissionScoreLayer": {')) inAdmission = true;
      if (inAdmission && !section && /^  },?$/.test(line)) inAdmission = false;
      if (inAdmission && !section && /^    "currentFinding":/.test(line)) {
        line = `    "currentFinding": ${JSON.stringify(FINDING)},`;
        replacedFinding = true;
      }
      if (inAdmission && !section && /^    "records": \[$/.test(line)) {
        section = "records";
        await writeWithBackpressure(output, `${line}\n`);
        continue;
      }
      if (inAdmission && !section && /^    "sourceNotes": \[$/.test(line)) {
        section = "sourceNotes";
        await writeWithBackpressure(output, `${line}\n`);
        continue;
      }
      if (section && !collecting && /^    \],?$/.test(line)) {
        section = "";
        await writeWithBackpressure(output, `${line}\n`);
        continue;
      }
      if (section && !collecting && /^      \{$/.test(line)) {
        collecting = true;
        objectLines = [line];
        continue;
      }
      if (collecting) {
        objectLines.push(line);
        if (/^      \},?$/.test(line)) {
          const trailingComma = /,$/.test(line);
          const parsed = JSON.parse(objectLines.join("\n").replace(/,\s*$/, ""));
          let replacement = null;
          if (section === "records") {
            totalRecords += 1;
            if (parsed.sourceId === SOURCE_ID) {
              replacement = replacementRecords.get(parsed.id);
              if (!replacement) throw new Error(`Current master has unknown v3.272 record ID ${parsed.id}`);
              seenReplacementIds.add(parsed.id);
              replacedRecords += 1;
            }
          } else if (section === "sourceNotes" && replacementNotes.has(parsed.id)) {
            replacement = replacementNotes.get(parsed.id);
            replacedSourceNotes += 1;
          }
          await writeWithBackpressure(
            output,
            replacement ? formatNestedObject(replacement, trailingComma) : `${objectLines.join("\n")}\n`,
          );
          collecting = false;
          objectLines = [];
        }
        continue;
      }
      await writeWithBackpressure(output, `${line}\n`);
    }
    output.end();
    await once(output, "finish");

    if (collecting || section) throw new Error(`Incomplete stream parse: section=${section}, collecting=${collecting}`);
    if (inAdmission) throw new Error("Incomplete admissionScoreLayer parse");
    if (!replacedFinding) throw new Error("Did not replace currentFinding");
    if (totalRecords !== expectedTotalRecords) throw new Error(`Expected ${expectedTotalRecords} total records, got ${totalRecords}`);
    if (replacedRecords !== expectedReplacements || seenReplacementIds.size !== replacementRecords.size) {
      throw new Error(`Expected ${expectedReplacements} replacement records, got ${replacedRecords}/${seenReplacementIds.size}`);
    }
    if (replacedSourceNotes !== 2) throw new Error(`Expected two replacement source notes, got ${replacedSourceNotes}`);

    const result = {
      ok: true,
      input: args.input,
      out: args.out,
      totalRecords,
      replacedRecords,
      replacedSourceNotes,
      ordinaryRecords: payload.audit.ordinaryRecordCount,
      specialPathRecords: payload.audit.specialPathRecordCount,
    };
    const tempFd = fs.openSync(tempOut, "r");
    try {
      fs.fsyncSync(tempFd);
    } finally {
      fs.closeSync(tempFd);
    }
    fs.renameSync(tempOut, args.out);
    committed = true;
    return result;
  } catch (error) {
    output.destroy();
    input.destroy();
    throw error;
  } finally {
    if (!committed) fs.rmSync(tempOut, { force: true });
  }
}

async function main() {
  const result = await refreshKnowledge(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
