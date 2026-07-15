#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { once } from "node:events";

const SOURCE_ID = "official-beijing-rank-2025-v3271";
const SOURCE_QUALITY = "official-beijing-2025-rank-conversion-pdf-text-validated";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") args.input = argv[++index];
    else if (argv[index] === "--out") args.out = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.input || !args.out) throw new Error("Usage: repair-official-beijing-rank-quality-v3271.mjs --input <knowledge.json> --out <knowledge.json>");
  return { input: path.resolve(args.input), out: path.resolve(args.out) };
}

async function writeWithBackpressure(stream, text) {
  if (!stream.write(text)) await once(stream, "drain");
}

function formatNestedObject(record, trailingComma) {
  const lines = JSON.stringify(record, null, 2).split("\n").map((line) => `      ${line}`);
  if (trailingComma) lines[lines.length - 1] += ",";
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.input.startsWith("/Volumes/mac_2T/") || args.out.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing direct mac_2T processing; use internal APFS staging.");
  }
  if (args.input === args.out) throw new Error("Input and output must differ.");

  const input = fs.createReadStream(args.input, { encoding: "utf8" });
  const output = fs.createWriteStream(args.out, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let inRankConversions = false;
  let collecting = false;
  let objectLines = [];
  let updated = 0;

  for await (const line of lines) {
    if (!inRankConversions && /^    "rankConversions": \[$/.test(line)) {
      inRankConversions = true;
      await writeWithBackpressure(output, `${line}\n`);
      continue;
    }
    if (inRankConversions && !collecting && /^    \],?$/.test(line)) {
      inRankConversions = false;
      await writeWithBackpressure(output, `${line}\n`);
      continue;
    }
    if (inRankConversions && !collecting && /^      \{$/.test(line)) {
      collecting = true;
      objectLines = [line];
      continue;
    }
    if (collecting) {
      objectLines.push(line);
      if (/^      \},?$/.test(line)) {
        const trailingComma = /,$/.test(line);
        const record = JSON.parse(objectLines.join("\n").replace(/,\s*$/, ""));
        if (record.sourceId === SOURCE_ID) {
          record.dataType = "rank-conversion";
          record.sourceQuality = SOURCE_QUALITY;
          updated += 1;
          await writeWithBackpressure(output, formatNestedObject(record, trailingComma));
        } else {
          await writeWithBackpressure(output, `${objectLines.join("\n")}\n`);
        }
        collecting = false;
        objectLines = [];
      }
      continue;
    }
    await writeWithBackpressure(output, `${line}\n`);
  }

  if (collecting || inRankConversions) throw new Error("Incomplete multi-line rank conversion parse");
  output.end();
  await once(output, "finish");
  if (updated !== 347) {
    fs.rmSync(args.out, { force: true });
    throw new Error(`Expected 347 Beijing v3.271 records, updated ${updated}`);
  }
  console.log(JSON.stringify({ ok: true, input: args.input, out: args.out, updated }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
