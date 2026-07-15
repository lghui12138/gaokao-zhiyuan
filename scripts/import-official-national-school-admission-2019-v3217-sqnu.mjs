#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2019;
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2019-v3217-sqnu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2019-v3217-sqnu";
const BASE_URL = "https://zhaoban.sqnu.edu.cn";
const INDEX_URL = `${BASE_URL}/lqfs/5.htm`;
const SOURCE_URL = `${BASE_URL}/info/1005/2034.htm`;

const SOURCE = {
  id: "official-sqnu-national-2019-school-institution-admission",
  quality: "official-school-sqnu-2019-national-html-score-rank",
  schoolCode: "10483",
  schoolName: "商丘师范学院",
  city: "商丘",
  tags: ["师范", "河南", "商丘", "商丘师范学院"],
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2019-v3217-sqnu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2019-v3217-sqnu.mjs --use-cache",
    "",
    "Imports 商丘师范学院招生信息网 official 2019 HTML admission score/rank table.",
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
  const htmlRel = "2019-outside-batches.html";
  const htmlPath = path.join(rawRoot, htmlRel);
  if (useCache && fs.existsSync(htmlPath)) return { htmlRel, htmlPath, html: fs.readFileSync(htmlPath, "utf8") };
  const html = (await fetchBuffer(SOURCE_URL, INDEX_URL)).toString("utf8").replace(/\0/g, "");
  if (!html.includes("2019年外省各批次录取分数") || !html.includes("最低分位次")) {
    throw new Error(`Official 2019 SQNU HTML table tokens not found in ${SOURCE_URL}`);
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
    return text.includes("省份") && text.includes("最低分位次") && text.includes("2019年外省各批次录取分数");
  });
  if (!table) throw new Error("Could not locate SQNU 2019 outside-batches admission table.");
  return tableRows(table);
}

function normalizeSubject(raw, context = "", province = "") {
  const text = [raw, context].map(clean).join(" ");
  if (/艺术|美术|音乐|舞蹈|播音|编导|书法|摄影/.test(text)) return "艺术类";
  if (/体育|社会体育/.test(text)) return "体育类";
  if (/文理综合/.test(text)) return "官网未列科类";
  if (/文史|文科/.test(text)) return "历史类";
  if (/理工|理科/.test(text)) return "物理类";
  if (/综合/.test(text) && ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合改革";
  if (/综合/.test(text)) return "官网未列科类";
  return clean(raw) || "官网未列科类";
}

function normalizeBatch(raw) {
  const text = clean(raw);
  if (/体育/.test(text)) return "体育类本科批";
  if (/提前/.test(text)) return "本科提前批";
  if (/本二|本科二批|二本/.test(text)) return "本科二批";
  if (/本一|本科一批|一本/.test(text)) return "本科一批";
  if (/本科/.test(text)) return "本科批";
  return text || "官网未列批次";
}

function classifyAdmission(sourceSubjectRaw, sourceBatchRaw) {
  const text = [sourceSubjectRaw, sourceBatchRaw].map(clean).join(" ");
  if (/体育/.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/艺术|美术|音乐|舞蹈|播音|编导|书法|摄影/.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function scoreMetric(classification) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  return "高考文化分或学校官网投档成绩";
}

function makeRecord({
  rowIndex,
  row,
  rawHtmlRel,
}) {
  const [
    sourceProvinceRaw,
    sourceSubjectRaw,
    sourceBatchRaw,
    sourceLevelRaw,
    planCountRaw,
    admissionCountRaw,
    controlLineRaw,
    maxScoreRaw,
    minScoreRaw,
    avgScoreRaw,
    maxRankRaw,
    minRankRaw,
    avgRankRaw,
  ] = row;
  const minScore = parseNumber(minScoreRaw);
  if (!Number.isFinite(minScore)) return null;
  const province = clean(sourceProvinceRaw);
  const classification = classifyAdmission(sourceSubjectRaw, sourceBatchRaw);
  const subjectType = normalizeSubject(sourceSubjectRaw, sourceBatchRaw, province);
  const batch = normalizeBatch(sourceBatchRaw);
  const minRank = integerNumber(minRankRaw);
  const rankUnavailable = !Number.isFinite(minRank);
  const record = {
    id: `${YEAR}-sqnu-institution-${stableId([
      sourceProvinceRaw,
      sourceSubjectRaw,
      sourceBatchRaw,
      sourceLevelRaw,
      minScoreRaw,
      minRankRaw,
      rowIndex,
    ])}`,
    province,
    sourceProvinceRaw,
    year: YEAR,
    subjectType,
    sourceSubjectRaw,
    batch,
    sourceBatchRaw,
    sourceLevelRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "institution-admission",
    majorName: "全校汇总",
    majorGroup: [SOURCE.schoolName, YEAR, province, sourceSubjectRaw, sourceBatchRaw, sourceLevelRaw].map(clean).filter(Boolean).join("-"),
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    minScore,
    scoreMetric: scoreMetric(classification),
    scoreOnly: rankUnavailable,
    rankUnavailable,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: rankUnavailable ? "single-school-score" : "single-school-score-rank",
    sourceUrl: SOURCE_URL,
    sourcePageUrl: SOURCE_URL,
    sourceIndexUrl: INDEX_URL,
    officialEvidencePath: rawHtmlRel,
    sourceHtmlPath: rawHtmlRel,
    sourcePageKey: "outside-batches-2019",
    sourcePageTitle: "2019年外省各批次录取分数",
    sourceMinScoreRaw: minScoreRaw,
    sourceMaxScoreRaw: maxScoreRaw,
    sourceAverageScoreRaw: avgScoreRaw,
    sourceControlLineRaw: controlLineRaw,
    sourcePlanCountRaw: planCountRaw,
    sourceAdmissionCountRaw: admissionCountRaw,
    sourceMaxRankRaw: maxRankRaw,
    sourceAverageRankRaw: avgRankRaw,
    rawRow: {
      source: "sqnu-2019-official-html-table",
      pageKey: "outside-batches-2019",
      rowIndex,
      cells: row,
    },
    cautions: [
      "本记录来自商丘师范学院招生信息网官方 2019 年外省各批次录取分数 HTML 表，是单校分省/科类/批次汇总录取边界，不是省级教育考试院全量投档/录取分数表。",
      rankUnavailable
        ? "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
        : "本行含学校官网公布的最低分位次，但仍是单校来源；推荐层只能用于商丘师范学院候选边界复核。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺术或体育特殊路径，运行层按 special-path-only 隔离，不与普通批文化分边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "2019 年源表仍含旧文理/综合改革/艺体口径；正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  const maxScore = parseNumber(maxScoreRaw);
  const avgScore = parseNumber(avgScoreRaw);
  const controlLine = parseNumber(controlLineRaw);
  const planCount = integerNumber(planCountRaw);
  const admissionCount = integerNumber(admissionCountRaw);
  const maxRank = integerNumber(maxRankRaw);
  const avgRank = integerNumber(avgRankRaw);
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(avgScore)) record.avgScore = avgScore;
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (Number.isFinite(planCount)) record.planCount = planCount;
  if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
  if (Number.isFinite(maxRank)) record.maxRank = maxRank;
  if (Number.isFinite(avgRank)) record.avgRank = avgRank;
  if (Number.isFinite(minRank)) {
    record.minRank = minRank;
    record.minRankStart = minRank;
    record.minRankEnd = minRank;
    record.rankRangeText = String(minRank);
    record.sourceRankRaw = minRankRaw;
  }
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
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    if (row.length === 1 || row[0] === "省份" || row.join("").includes("2019年外省各批次录取分数") || row.join("").includes("2020-03-17")) return;
    if (row.length !== 13) {
      skippedRows.push({ reason: "unexpected-column-count", rowIndex, row });
      return;
    }
    const record = makeRecord({ rowIndex, row, rawHtmlRel });
    if (!record) {
      skippedRows.push({ reason: "missing-min-score", rowIndex, row });
      return;
    }
    records.push(record);
  });
  return { records, skippedRows };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);
  const { html, htmlRel, htmlPath } = await downloadHtml(rawRoot, args.useCache);
  const rawHtmlRel = `${RAW_DIR}/${htmlRel}`;
  const { records, skippedRows } = parseRecords(html, rawHtmlRel);
  const duplicateIds = records.map((record) => record.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate record IDs: ${[...new Set(duplicateIds)].slice(0, 5).join(", ")}`);
  }

  const sourceNote = {
    id: SOURCE.id,
    title: "商丘师范学院招生信息网：2019年外省各批次录取分数官方 HTML 表",
    publisher: "商丘师范学院招生信息网",
    publishedAt: extractPublishedAt(html) || "2020-03-17",
    url: SOURCE_URL,
    indexUrl: INDEX_URL,
    quality: SOURCE.quality,
    usage: "从商丘师范学院招生信息网官方“录取分数”栏目下载 2019 年外省各批次录取分数 HTML 表，抽取单校分省/科类/批次汇总的计划数、录取数、省控线、最高分、最低分、平均分、最高/最低/平均位次。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    provincesWithRecords: uniqueSorted(records, "province"),
    pageSummaries: [{
      key: "outside-batches-2019",
      title: "2019年外省各批次录取分数",
      officialTitle: extractOfficialTitle(html),
      url: SOURCE_URL,
      rawHtmlPath: rawHtmlRel,
      parsedRecords: records.length,
      skippedRows: skippedRows.length,
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
    recordsWithRank: records.filter((record) => !record.rankUnavailable).length,
    recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
    scoreRange: rangeOf(records, "minScore"),
    ordinarySchoolOfficialScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "school-official-only"), "minScore"),
    specialPathScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "special-path-only"), "minScore"),
    rankRange: rangeOf(records, "minRank"),
    boundaryNotes: [
      "商丘师范学院单校官网分数/位次只用于该校候选边界复核，不替代省级教育考试院全量投档/录取分数表。",
      "2019 年外省各批次表是分省/科类/批次汇总边界，不是分专业录取表。",
      "2019 年省外艺术、体育类专业最低分 PDF 未作为本轮源，因源表跨行省份/科类版式需要单独解析，避免误配专业与分数。",
      "艺术、体育等按 special-path-only 隔离，不与普通高考文化分概率混算。",
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
    parserVersion: "v3217-sqnu-html-2019-outside-batches-01",
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${records.length} records -> ${args.out}`);
  console.log(`Skipped rows: ${skippedRows.length}`);
  console.log(`Provinces: ${sourceNote.provincesWithRecords.join(", ")}`);
  console.log(`Records with rank: ${sourceNote.recordsWithRank}; rank unavailable: ${sourceNote.recordsRankUnavailable}`);
  console.log(`Formal scope counts: ${JSON.stringify(sourceNote.formalScoreScopeCounts)}`);
  console.log(`Admission type counts: ${JSON.stringify(sourceNote.admissionTypeCounts)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
