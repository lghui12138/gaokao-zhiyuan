#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2018;
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2018-v3219-sqnu-outside-ordinary-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2018-v3219-sqnu-outside-ordinary";
const BASE_URL = "https://zhaoban.sqnu.edu.cn";
const INDEX_URL = `${BASE_URL}/lqfs/5.htm`;
const SOURCE_URL = `${BASE_URL}/info/1005/1748.htm`;

const SOURCE = {
  id: "official-sqnu-national-2018-school-institution-ordinary-admission",
  quality: "official-school-sqnu-2018-national-html-ordinary-score",
  schoolCode: "10483",
  schoolName: "商丘师范学院",
  city: "商丘",
  tags: ["师范", "河南", "商丘", "商丘师范学院"],
};

const COMPREHENSIVE_PROVINCES = new Set(["上海", "浙江"]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2018-v3219-sqnu-outside-ordinary.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2018-v3219-sqnu-outside-ordinary.mjs --use-cache",
    "",
    "Imports 商丘师范学院招生信息网 official 2018 ordinary undergraduate HTML table.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--out") {
      args.out = argv[++i];
      continue;
    }
    if (arg === "--use-cache") {
      args.useCache = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

function guardProjectRoot() {
  if (PROJECT_ROOT.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing to run HTML ingestion from /Volumes/mac_2T; run this importer from the internal APFS project copy.");
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveProjectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 18);
}

async function fetchBuffer(url, referer = INDEX_URL) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "text/html,application/xhtml+xml,application/xml,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer,
        },
      });
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${buffer.toString("utf8", 0, 200)}`);
      if (buffer.length < 1000) throw new Error(`Unexpectedly short source (${buffer.length} bytes) for ${url}`);
      return buffer;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function downloadHtml(rawRoot, useCache) {
  const htmlRel = "2018-outside-ordinary-undergraduate.html";
  const htmlPath = path.join(rawRoot, htmlRel);
  if (useCache && fs.existsSync(htmlPath)) return { htmlRel, htmlPath, html: fs.readFileSync(htmlPath, "utf8") };
  const html = (await fetchBuffer(SOURCE_URL, INDEX_URL)).toString("utf8").replace(/\0/g, "");
  if (!html.includes("2018年我校在省外普通本科录取情况一览表") || !html.includes("附表七")) {
    throw new Error(`Official 2018 SQNU outside ordinary table tokens not found in ${SOURCE_URL}`);
  }
  fs.writeFileSync(htmlPath, html);
  return { htmlRel, htmlPath, html };
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function clean(value) {
  return decodeHtml(value)
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248))
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return clean(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function extractOfficialTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractPublishedAt(html) {
  const plain = stripTags(html);
  return plain.match(/(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}/)?.[1] || "";
}

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function integerNumber(value) {
  const n = parseNumber(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function htmlTables(html) {
  return [...String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function tableRows(tableHtml) {
  return [...String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((rowMatch) => [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1])))
    .filter((cells) => cells.length);
}

function pickAdmissionTable(html) {
  const tables = htmlTables(html);
  const table = tables.find((candidate) => {
    const text = stripTags(candidate);
    return text.includes("附表七") && text.includes("2018年我校在省外普通本科录取情况一览表") && text.includes("省份") && text.includes("文科") && text.includes("理科");
  });
  if (!table) throw new Error("Could not locate SQNU 2018 outside ordinary undergraduate admission table.");
  return tableRows(table);
}

function normalizeSubject(raw, province = "", row = null) {
  if (COMPREHENSIVE_PROVINCES.has(province) && row && row.slice(2, 6).join("|") === row.slice(6, 10).join("|")) {
    return "综合改革";
  }
  const text = clean(raw);
  if (/文/.test(text)) return "历史类";
  if (/理/.test(text)) return "物理类";
  return text || "官网未列科类";
}

function makeRecord({ rowIndex, row, section, rawHtmlRel }) {
  const province = clean(row[1]);
  const offset = section === "文科" ? 2 : 6;
  const admissionCountRaw = row[offset];
  const controlLineRaw = row[offset + 1];
  const minScoreRaw = row[offset + 2];
  const scoreDeltaRaw = row[offset + 3];
  const minScore = parseNumber(minScoreRaw);
  if (!province || !Number.isFinite(minScore)) return null;
  const subjectType = normalizeSubject(section, province, row);
  const sectionForId = subjectType === "综合改革" ? "综合改革" : section;
  const rankUnavailable = true;
  const record = {
    id: `${YEAR}-sqnu-ordinary-institution-${stableId([
      province,
      sectionForId,
      admissionCountRaw,
      controlLineRaw,
      minScoreRaw,
      rowIndex,
    ])}`,
    province,
    sourceProvinceRaw: province,
    year: YEAR,
    subjectType,
    sourceSubjectRaw: sectionForId === "综合改革" ? "源表文理两栏同值（综合改革）" : section,
    batch: "本科批",
    sourceBatchRaw: "普通本科",
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "institution-admission",
    majorName: "全校汇总",
    majorGroup: [SOURCE.schoolName, YEAR, province, subjectType, "普通本科"].filter(Boolean).join("-"),
    admissionType: "普通录取",
    admissionSubtype: "普通类",
    formalScoreScope: "school-official-only",
    minScore,
    scoreMetric: "高考文化分或学校官网投档成绩",
    scoreOnly: rankUnavailable,
    rankUnavailable,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-score",
    sourceUrl: SOURCE_URL,
    sourcePageUrl: SOURCE_URL,
    sourceIndexUrl: INDEX_URL,
    officialEvidencePath: rawHtmlRel,
    sourceHtmlPath: rawHtmlRel,
    sourcePageKey: "outside-ordinary-undergraduate-2018",
    sourcePageTitle: "2018年我校在省外普通本科录取情况一览表",
    sourceMinScoreRaw: minScoreRaw,
    sourceControlLineRaw: controlLineRaw,
    sourceAdmissionCountRaw: admissionCountRaw,
    sourceScoreDeltaRaw: scoreDeltaRaw,
    rawRow: {
      source: "sqnu-2018-official-html-table",
      pageKey: "outside-ordinary-undergraduate-2018",
      rowIndex,
      section,
      cells: row,
    },
    cautions: [
      "本记录来自商丘师范学院招生信息网官方 2018 年普通本科录取情况 HTML 表，是单校分省/科类学校层汇总录取边界，不是省级教育考试院全量投档/录取分数表。",
      "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "上海、浙江等新高考省份若源表文理两栏同值，运行层按综合改革单行保留，避免重复计数；仍需回到当年省级投档表和院校招生章程复核。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  const admissionCount = integerNumber(admissionCountRaw);
  const controlLine = parseNumber(controlLineRaw);
  const scoreDelta = parseNumber(scoreDeltaRaw);
  if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (Number.isFinite(scoreDelta)) record.scoreDeltaFromControl = scoreDelta;
  return record;
}

function countBy(records, key) {
  return records.reduce((acc, record) => {
    const value = record[key] ?? "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function uniqueSorted(records, key) {
  return [...new Set(records.map((record) => record[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN"));
}

function rangeOf(records, key) {
  const values = records.map((record) => record[key]).filter(Number.isFinite).sort((a, b) => a - b);
  return values.length ? { min: values[0], max: values[values.length - 1] } : null;
}

function parseRecords(html, rawHtmlRel) {
  const rows = pickAdmissionTable(html);
  const records = [];
  const skippedRows = [];
  let comprehensiveCollapsedRows = 0;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    if (row.length !== 10 || !/^\d+$/.test(clean(row[0]))) return;
    const province = clean(row[1]);
    if (COMPREHENSIVE_PROVINCES.has(province) && row.slice(2, 6).join("|") === row.slice(6, 10).join("|")) {
      const record = makeRecord({ rowIndex, row, section: "文科", rawHtmlRel });
      if (!record) skippedRows.push({ reason: "missing-min-score", rowIndex, row, section: "综合改革" });
      else records.push(record);
      comprehensiveCollapsedRows += 1;
      return;
    }
    for (const section of ["文科", "理科"]) {
      const record = makeRecord({ rowIndex, row, section, rawHtmlRel });
      if (!record) skippedRows.push({ reason: "missing-min-score", rowIndex, row, section });
      else records.push(record);
    }
  });
  return { records, skippedRows, comprehensiveCollapsedRows };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);
  const { html, htmlRel, htmlPath } = await downloadHtml(rawRoot, args.useCache);
  const rawHtmlRel = `${RAW_DIR}/${htmlRel}`;
  const { records, skippedRows, comprehensiveCollapsedRows } = parseRecords(html, rawHtmlRel);
  const duplicateIds = records.map((record) => record.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate record IDs: ${[...new Set(duplicateIds)].slice(0, 5).join(", ")}`);
  }

  const sourceNote = {
    id: SOURCE.id,
    title: "商丘师范学院招生信息网：2018年普通本科录取情况官方 HTML 表",
    publisher: "商丘师范学院招生信息网",
    publishedAt: extractPublishedAt(html) || "2018-11-21",
    url: SOURCE_URL,
    indexUrl: INDEX_URL,
    quality: SOURCE.quality,
    usage: "从商丘师范学院招生信息网官方“录取分数”栏目下载 2018 年我校在省外普通本科录取情况 HTML 表，抽取单校分省/科类学校层汇总的录取人数、省控线、最低分和最低分差。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    provincesWithRecords: uniqueSorted(records, "province"),
    pageSummaries: [{
      key: "outside-ordinary-undergraduate-2018",
      title: "2018年我校在省外普通本科录取情况一览表",
      officialTitle: extractOfficialTitle(html),
      url: SOURCE_URL,
      rawHtmlPath: rawHtmlRel,
      parsedRecords: records.length,
      skippedRows: skippedRows.length,
      comprehensiveCollapsedRows,
      sha256Html: sha256File(htmlPath),
    }],
    rawDir: RAW_DIR,
    rawFiles: [
      { path: rawHtmlRel, url: SOURCE_URL, sha256: sha256File(htmlPath) },
    ],
    recordTypeCounts: countBy(records, "dataType"),
    formalScoreScopeCounts: countBy(records, "formalScoreScope"),
    admissionTypeCounts: countBy(records, "admissionType"),
    admissionSubtypeCounts: countBy(records, "admissionSubtype"),
    subjectTypeCounts: countBy(records, "subjectType"),
    recordsWithRank: 0,
    recordsRankUnavailable: records.length,
    scoreRange: rangeOf(records, "minScore"),
    ordinarySchoolOfficialScoreRange: rangeOf(records, "minScore"),
    rankRange: null,
    boundaryNotes: [
      "商丘师范学院单校官网普通本科分数只用于该校候选边界复核，不替代省级教育考试院全量投档/录取分数表。",
      "2018 年源表是学校层分省/科类汇总边界，不是分专业录取表。",
      "源表未公开最低分位次；所有行 rankUnavailable=true，不生成假位次。",
      "上海、浙江源表文理两栏同值，按综合改革单行保留，避免重复计数。",
      "普通学校官网单校分数按 school-official-only 保存，不关闭西藏等省级正式投档/录取表缺口。",
    ],
  };

  const outPath = resolveProjectPath(args.out);
  ensureDir(path.dirname(outPath));
  const payload = {
    sourceNotes: [sourceNote],
    records,
    skippedRows,
    generatedAt: new Date().toISOString(),
    parserVersion: "v3219-sqnu-html-2018-outside-ordinary-01",
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${records.length} records -> ${args.out}`);
  console.log(`Skipped rows: ${skippedRows.length}`);
  console.log(`Provinces: ${sourceNote.provincesWithRecords.join(", ")}`);
  console.log(`Comprehensive collapsed rows: ${comprehensiveCollapsedRows}`);
  console.log(`Formal scope counts: ${JSON.stringify(sourceNote.formalScoreScopeCounts)}`);
  console.log(`Subject type counts: ${JSON.stringify(sourceNote.subjectTypeCounts)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
