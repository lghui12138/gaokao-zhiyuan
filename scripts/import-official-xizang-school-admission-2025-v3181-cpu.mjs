#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-school-admission-2025-v3181-cpu-import.json";
const RAW_DIR = "data/admissions/raw/official-xizang-school-admission-2025-v3181-cpu";
const API_URL = "https://zb.cpu.edu.cn/_wp3services/generalQuery?queryObj=articles";
const PAGE_URL = "https://zb.cpu.edu.cn/fs/listm.htm";
const SCRIPT_URL = "https://zb.cpu.edu.cn/_upload/tpl/03/37/823/template823/search_lqfs.js";
const PROVINCE = "西藏";

const SOURCE = {
  id: "official-cpu-xizang-2025-school-admission",
  quality: "official-school-cpu-2025-xizang-dynamic-query-score-only",
  schoolCode: "10316",
  schoolName: "中国药科大学",
  city: "南京",
  tags: ["医药", "211", "双一流"],
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-school-admission-2025-v3181-cpu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-school-admission-2025-v3181-cpu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/JS/API JSON",
    "",
    "Imports China Pharmaceutical University official Xizang 2025 major admission score query rows.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${item}\n${usage()}`);
  }
  return args;
}

function hash(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function numericRange(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

async function download(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        body: options.body,
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-xizang-cpu-v3181-importer/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: PAGE_URL,
          ...(options.headers || {}),
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }
  const curlArgs = [
    "-L",
    "--compressed",
    "--fail",
    "--silent",
    "--show-error",
    "--max-time",
    "90",
    "-A",
    "Mozilla/5.0 gaokao-xizang-cpu-v3181-importer/1.0",
    "-e",
    PAGE_URL,
  ];
  if (options.method === "POST") {
    curlArgs.push("-H", "Content-Type: application/x-www-form-urlencoded; charset=UTF-8", "--data-binary", options.body.toString());
  }
  curlArgs.push(url);
  const curl = spawnSync("curl", curlArgs, {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!curl.error && curl.status === 0 && curl.stdout?.length > 0) return Buffer.from(curl.stdout);
  throw new Error([
    `fetch and curl failed for ${url}`,
    String(lastError),
    curl.error ? String(curl.error) : "",
    curl.stderr?.toString("utf8").trim(),
  ].filter(Boolean).join("\n"));
}

async function writeIfNeeded(file, loader, useCache) {
  if (!useCache || !fs.existsSync(file)) fs.writeFileSync(file, await loader());
  return file;
}

function apiBody() {
  const conditions = JSON.stringify([
    { orConditions: [{ field: "f8", value: PROVINCE, judge: "=" }] },
    { orConditions: [{ field: "f7", value: "2025", judge: "=" }] },
  ]);
  const returnInfos = JSON.stringify([
    { name: "f1" },
    { name: "f2" },
    { name: "f3" },
    { name: "f4" },
    { name: "f5" },
    { name: "f6" },
    { name: "f7" },
    { name: "f10" },
    { name: "f9" },
  ]);
  return new URLSearchParams({
    siteId: "225",
    columnId: "10209",
    pageIndex: "1",
    rows: "200",
    orders: JSON.stringify([]),
    returnInfos,
    conditions,
  });
}

async function ensureRaw(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const pageFile = path.join(rawDir, "cpu-score-query-page.html");
  const scriptFile = path.join(rawDir, "cpu-search-lqfs.js");
  const apiFile = path.join(rawDir, "cpu-api-xizang-2025.json");
  await writeIfNeeded(pageFile, () => download(PAGE_URL), useCache);
  await writeIfNeeded(scriptFile, () => download(SCRIPT_URL, { accept: "application/javascript,*/*;q=0.8" }), useCache);
  await writeIfNeeded(apiFile, () => download(API_URL, {
    method: "POST",
    body: apiBody(),
    accept: "application/json,text/javascript,*/*;q=0.8",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
  }), useCache);
  return { pageFile, scriptFile, apiFile };
}

function numberField(value, label) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`Invalid ${label}: ${text}`);
  return Number(text);
}

function subjectType(raw) {
  if (raw === "理工" || raw === "物理类") return "物理类";
  if (raw === "文史" || raw === "历史类") return "历史类";
  throw new Error(`Unsupported subject: ${raw}`);
}

function batchFor(admissionMode) {
  if (admissionMode === "普通录取") return "本科批";
  if (admissionMode === "国家专项") return "国家专项本科";
  if (admissionMode === "高校专项") return "高校专项";
  if (admissionMode === "预科一年") return "少数民族预科";
  if (admissionMode === "西藏内高班") return "西藏内高班";
  return admissionMode || "本科批";
}

function formalScoreScope(admissionMode) {
  return admissionMode === "普通录取" ? "school-official-only" : "special-path-only";
}

function cautionsFor(admissionMode) {
  const scope = formalScoreScope(admissionMode);
  const cautions = [
    "本记录来自中国药科大学本科生招生网官方历年录取分数查询系统，是单校分省专业录取分数边界，不是西藏自治区教育考试院全量投档/录取分数表。",
    "源系统未公开最低位次；不得生成假位次或单独输出录取概率。",
  ];
  if (scope === "school-official-only") {
    cautions.push("普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得清除西藏省级全量正式分数表缺口。");
  } else {
    cautions.push(`${admissionMode}按 formalScoreScope=special-path-only 隔离，只用于对应资格入口复核，不替代普通本科文化分边界。`);
  }
  return cautions;
}

function buildRecords(apiPayload) {
  const rows = apiPayload.data || [];
  if (Number(apiPayload.total) !== rows.length) {
    throw new Error(`Expected all CPU rows on one page, got ${rows.length}/${apiPayload.total}`);
  }
  if (rows.length !== 14) {
    throw new Error(`Expected 14 CPU Xizang 2025 rows, got ${rows.length}`);
  }
  return rows.map((row) => {
    const year = numberField(row.f7, "year");
    if (year !== 2025) throw new Error(`Unexpected year: ${row.f7}`);
    const sourceSubjectRaw = String(row.f2 || "").trim();
    const admissionMode = String(row.f9 || "").trim();
    const minScore = numberField(row.f4, "minScore");
    const maxScore = numberField(row.f3, "maxScore");
    const avgScore = numberField(row.f5, "avgScore");
    if (minScore > maxScore) throw new Error(`minScore > maxScore for ${row.f1}`);
    const idBase = [year, SOURCE.schoolCode, PROVINCE, sourceSubjectRaw, admissionMode, row.f1, minScore, maxScore, row.id].join("|");
    return {
      id: `2025-cpu-xizang-major-${hash(idBase, 16)}`,
      province: PROVINCE,
      year,
      subjectType: subjectType(sourceSubjectRaw),
      sourceSubjectRaw,
      batch: batchFor(admissionMode),
      sourceBatchRaw: admissionMode,
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      city: SOURCE.city,
      schoolTags: SOURCE.tags,
      dataType: "major-admission",
      majorName: String(row.f1 || "").trim(),
      admissionType: admissionMode,
      formalScoreScope: formalScoreScope(admissionMode),
      minScore,
      maxScore,
      avgScore,
      scoreOnly: true,
      rankUnavailable: true,
      sourceId: SOURCE.id,
      sourceQuality: SOURCE.quality,
      schoolOfficialScope: "single-school-admission-score",
      sourceUrl: PAGE_URL,
      sourceApiUrl: API_URL,
      sourceArticleUrl: row.url || "",
      sourceArticleId: row.id || null,
      sourcePublishTime: row.publishTime || "",
      sourceMinScoreRaw: String(row.f4 || ""),
      sourceMaxScoreRaw: String(row.f3 || ""),
      sourceAvgScoreRaw: String(row.f5 || ""),
      rawRow: row,
      cautions: cautionsFor(admissionMode),
    };
  });
}

function buildSourceNote(records, rawFiles, apiPayload) {
  const ordinary = records.filter((record) => record.formalScoreScope === "school-official-only");
  const special = records.filter((record) => record.formalScoreScope === "special-path-only");
  return {
    id: SOURCE.id,
    title: "中国药科大学本科生招生网：2025年西藏专业录取分数",
    publisher: SOURCE.schoolName,
    url: PAGE_URL,
    apiUrl: API_URL,
    query: {
      year: 2025,
      province: PROVINCE,
      siteId: 225,
      columnId: 10209,
    },
    quality: SOURCE.quality,
    usage: "抽取中国药科大学官方历年录取分数查询系统中西藏2025专业最高分、最低分、平均分；普通录取作单校候选边界，专项、预科和西藏内高班隔离为特殊路径。",
    parsedRecords: records.length,
    ordinarySchoolOfficialRecords: ordinary.length,
    specialPathRecords: special.length,
    apiTotal: apiPayload.total,
    byAdmissionType: countBy(records, (record) => record.admissionType),
    bySubjectType: countBy(records, (record) => record.subjectType),
    scoreRange: numericRange(records.map((record) => record.minScore)),
    rawPaths: rawFiles.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: rawFiles.map((file) => ({
      path: path.relative(PROJECT_ROOT, file),
      sha256: sha256File(file),
    })),
    transcriptionMethod: "official-dynamic-query-api-json",
    cautions: [
      "本源为高校官方单校录取数据，不是西藏自治区教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "国家专项、高校专项、少数民族预科和西藏内高班记录按 formalScoreScope=special-path-only 隔离。",
      "源系统未公开最低位次，不生成假位次或录取概率。",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const rawDir = path.join(PROJECT_ROOT, RAW_DIR);
  const raw = await ensureRaw(rawDir, args.useCache);
  const apiPayload = JSON.parse(fs.readFileSync(raw.apiFile, "utf8"));
  const records = buildRecords(apiPayload);
  const sourceNotes = [buildSourceNote(records, [raw.pageFile, raw.scriptFile, raw.apiFile], apiPayload)];
  const outPath = path.join(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes, records }, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    out: args.out,
    records: records.length,
    ordinarySchoolOfficialRecords: sourceNotes[0].ordinarySchoolOfficialRecords,
    specialPathRecords: sourceNotes[0].specialPathRecords,
    scoreRange: sourceNotes[0].scoreRange,
    sha256: sha256File(outPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
