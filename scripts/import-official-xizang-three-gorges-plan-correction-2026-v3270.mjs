#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_URL = "http://zsks.edu.xizang.gov.cn/71/74/7894.html";
const DEFAULT_OUT = "data/admissions/official-xizang-three-gorges-plan-correction-2026-v3270-import.json";
const RAW_DIR = path.join(PROJECT_ROOT, "data/admissions/raw/official-xizang-three-gorges-plan-correction-2026-v3270");
const SOURCE_ID = "official-xizang-three-gorges-plan-correction-2026-v3270";
const TARGET_ID = "2026-xizang-plan-0a1d8e04b447e164ed";
const RESTRICTION = "录取后不得调换专业，该专业教学外语为英语。";

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--url") args.url = argv[++i];
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-three-gorges-plan-correction-2026-v3270.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-three-gorges-plan-correction-2026-v3270.mjs --use-cache",
    "",
    "Imports the official 2026 Xizang correction for the CTGU cooperative admission-plan row.",
    "The correction replaces one existing row in place; it never appends a second plan row.",
  ].join("\n");
}

function assertOfficialUrl(value) {
  const parsed = new URL(value);
  if (parsed.hostname !== "zsks.edu.xizang.gov.cn") {
    throw new Error(`Official page must use zsks.edu.xizang.gov.cn: ${value}`);
  }
  return parsed.href;
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'");
}

function cleanHtmlText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

async function download(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-xizang-plan-correction-importer/1.0",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function assertTable(tableText, expectedSchoolCode, expectedSchoolName, label) {
  const required = [
    `${expectedSchoolCode} ${expectedSchoolName}`,
    "04 电气工程及其自动化(中外合作办学)",
    "四年",
    "2",
    "50000",
    RESTRICTION,
  ];
  for (const token of required) {
    if (!tableText.includes(token)) throw new Error(`${label} table is missing: ${token}`);
  }
  return {
    schoolCode: expectedSchoolCode,
    schoolName: expectedSchoolName,
    majorCode: "04",
    majorName: "电气工程及其自动化(中外合作办学)",
    duration: "四年",
    planCount: 2,
    tuition: "50000",
    remark: RESTRICTION,
  };
}

function parsePage(html, pageUrl) {
  const title = cleanHtmlText(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] || "");
  const publishedAt = cleanHtmlText(/<span class="date">([^<]+)<\/span>/i.exec(html)?.[1] || "");
  const publisher = cleanHtmlText(/<span class="from">来源：([^<]+)<\/span>/i.exec(html)?.[1] || "");
  if (title !== "关于更正三峡大学招生计划的公告") throw new Error(`Unexpected title: ${title}`);
  if (publishedAt !== "2026-06-27 21:55") throw new Error(`Unexpected publication time: ${publishedAt}`);
  if (publisher !== "西藏自治区教育考试院") throw new Error(`Unexpected publisher: ${publisher}`);

  const tables = [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => cleanHtmlText(match[0]));
  if (tables.length !== 2) throw new Error(`Expected exactly two correction tables, got ${tables.length}`);
  const before = assertTable(tables[0], "0329", "三峡大学", "before");
  const after = assertTable(tables[1], "1466", "三峡大学(中外合作办学)", "after");
  for (const field of ["majorCode", "majorName", "duration", "planCount", "tuition", "remark"]) {
    if (before[field] !== after[field]) throw new Error(`Official correction unexpectedly changed ${field}`);
  }
  return { title, publishedAt, publisher, pageUrl, before, after };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  args.url = assertOfficialUrl(args.url);
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const pageFile = path.join(RAW_DIR, "page-7894.html");
  if (!args.useCache || !fs.existsSync(pageFile)) fs.writeFileSync(pageFile, await download(args.url));

  const pageBuffer = fs.readFileSync(pageFile);
  const meta = parsePage(pageBuffer.toString("utf8"), args.url);
  const pageSha = sha256(pageBuffer);
  const outFile = path.resolve(PROJECT_ROOT, args.out);
  let generatedAt = new Date().toISOString();
  if (args.useCache && fs.existsSync(outFile)) {
    const existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
    if (existing.dataset === "official-xizang-three-gorges-plan-correction-2026-v3270" && existing.generatedAt) {
      generatedAt = existing.generatedAt;
    }
  }
  const planCorrectionNote = "西藏教育考试院2026-06-27公告：院校代码/名称由0329 三峡大学更正为1466 三峡大学(中外合作办学)，专业、学制、计划数和学费不变。";
  const sourceNote = {
    id: SOURCE_ID,
    title: meta.title,
    publisher: meta.publisher,
    url: args.url,
    publishedAt: meta.publishedAt,
    quality: "official-xizang-2026-admission-plan-correction-html",
    usage: "对既有西藏2026招生计划中的唯一目标记录执行1对1原位更正，不增加计划记录数。",
    parsedRecords: 0,
    correctedRecords: 1,
    targetIds: [TARGET_ID],
    rawFiles: [{ path: rel(pageFile), bytes: pageBuffer.length, sha256: pageSha }],
    cautions: [
      "公告只更正院校代码和院校名称；专业代码、专业名称、学制、计划数、学费与备注保持不变。",
      "该记录仍是招生计划层，不含投档最低分、录取最低分或最低位次，不能单独计算录取概率。",
      "录取后不得调换专业，教学外语为英语；50000元学费和中外合作属性必须进入家庭红线筛选。",
    ],
  };
  const payload = {
    dataset: "official-xizang-three-gorges-plan-correction-2026-v3270",
    generatedAt,
    scope: "one-to-one-admission-plan-correction",
    officialPage: { title: meta.title, publisher: meta.publisher, url: args.url, publishedAt: meta.publishedAt },
    sourceNotes: [sourceNote],
    corrections: [{
      targetId: TARGET_ID,
      before: meta.before,
      after: meta.after,
      changedFields: ["schoolCode", "schoolName"],
      preservedFields: ["id", "majorCode", "majorName", "duration", "planCount", "tuition", "remark"],
      planCorrectionNote,
      planRestrictionText: RESTRICTION,
    }],
    records: [],
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: rel(outFile),
    sourceId: SOURCE_ID,
    targetId: TARGET_ID,
    before: `${meta.before.schoolCode} ${meta.before.schoolName}`,
    after: `${meta.after.schoolCode} ${meta.after.schoolName}`,
    pageSha256: pageSha,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
