#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2014-2016-v3223-sqnu-henan-html-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2014-2016-v3223-sqnu-henan-html";
const BASE_URL = "https://zhaoban.sqnu.edu.cn";
const INDEX_URL = `${BASE_URL}/lqfs/4.htm`;

const PAGES = [
  {
    key: "henan-sports-2016",
    year: 2016,
    title: "2016年体育专业录取最低分",
    url: `${BASE_URL}/info/1005/1082.htm`,
    rawBase: "2016-henan-sports",
    parser: "sportsTable",
    sourceBatchRaw: "体育本科",
  },
  {
    key: "henan-upgrade-2016",
    year: 2016,
    title: "2016年专升本各专业录取最低分",
    url: `${BASE_URL}/info/1005/1083.htm`,
    rawBase: "2016-henan-upgrade",
    parser: "upgradeTable",
    sourceBatchRaw: "专升本",
  },
  {
    key: "henan-main-2015",
    year: 2015,
    title: "2015年河南省本专科各专业录取最低分",
    url: `${BASE_URL}/info/1005/1192.htm`,
    rawBase: "2015-henan-undergrad-vocational",
    parser: "twoColumnMajorTable",
    sourceBatchRaw: "河南省本专科",
  },
  {
    key: "henan-upgrade-2015",
    year: 2015,
    title: "2015年专升本各专业最低分",
    url: `${BASE_URL}/info/1005/1193.htm`,
    rawBase: "2015-henan-upgrade",
    parser: "upgradeTwoColumnTable",
    sourceBatchRaw: "专升本",
  },
  {
    key: "henan-main-2014",
    year: 2014,
    title: "2014年河南省本专科各专业录取最低分",
    url: `${BASE_URL}/info/1005/1194.htm`,
    rawBase: "2014-henan-undergrad-vocational",
    parser: "twoColumnMajorTable",
    sourceBatchRaw: "河南省本专科",
  },
];

const SOURCE = {
  id: "official-sqnu-national-2014-2016-school-henan-html-admission",
  quality: "official-school-sqnu-2014-2016-henan-html-score",
  schoolCode: "10483",
  schoolName: "商丘师范学院",
  city: "商丘",
  tags: ["师范", "河南", "商丘", "商丘师范学院"],
};

const ART_PATTERN = /艺术|美术|音乐|舞蹈|播音|编导|动画|视觉传达|环境设计|书法|摄影|绘画|雕塑|表演/;
const SPORTS_PATTERN = /体育|社会体育|武术/;
const COOP_PATTERN = /中外合作|合作办学|联合办学|联合招生|商丘职业技术学院|国际教育学院|软件学院/;

const TITLE_ROW_PATTERN = /^(本科|专科|普通专科|联合办学本科|联合办学专科|软件学院专科|与商丘职业技术学院联合招生)$/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2014-2016-v3223-sqnu-henan-html.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2014-2016-v3223-sqnu-henan-html.mjs --use-cache",
    "",
    "Imports official SQNU 2014-2016 Henan HTML score tables; control-line-only pages are intentionally not included.",
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

async function downloadHtml(page, rawRoot, useCache) {
  const htmlRel = `${page.rawBase}.html`;
  const htmlPath = path.join(rawRoot, htmlRel);
  if (useCache && fs.existsSync(htmlPath)) return { htmlRel, htmlPath, html: fs.readFileSync(htmlPath, "utf8") };
  const html = (await fetchBuffer(page.url, INDEX_URL)).toString("utf8").replace(/\0/g, "");
  if (!html.includes(page.title)) {
    throw new Error(`Official page title token not found for ${page.url}: ${page.title}`);
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
  const text = clean(value).replace(/,/g, "").replace(/\s+/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function tableRows(html) {
  return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((rowMatch) => [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1])))
    .filter((cells) => cells.length);
}

function normalizeSubject(raw) {
  const text = clean(raw);
  if (/专升本/.test(text)) return "专升本";
  if (/文/.test(text)) return "历史类";
  if (/理|理工/.test(text)) return "物理类";
  return text || "官网未列科类";
}

function extractScoreDetail(rawMajor) {
  const text = clean(rawMajor);
  const details = [];
  if (/文\s*\+\s*专|文\+专/.test(text)) details.push("文+专");
  if (/专业分|专业 分/.test(text)) details.push("专业分");
  return details.join("；");
}

function normalizeMajorName(rawMajor) {
  return clean(rawMajor)
    .replace(/[（(]\s*(本科|专科|专升本)\s*[）)]/g, "")
    .replace(/[（(]\s*(文\s*\+\s*专|文\+专|专业分)\s*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim();
}

function inferBatch(rawMajor, sourceBatchRaw) {
  const text = [rawMajor, sourceBatchRaw].map(clean).join(" ");
  if (/专升本/.test(text)) return "专升本批";
  if (/[（(]\s*专科\s*[）)]/.test(clean(rawMajor)) || isVocationalSection(sourceBatchRaw)) return "高职（专科）批";
  if (/体育/.test(text) && !/专科/.test(text)) return "体育本科批";
  return "本科二批";
}

function isVocationalSection(value) {
  const text = clean(value);
  return /(^|[-（(])(专科|高职)(\b|$)|联合办学专科|软件学院专科|普通专科/.test(text);
}

function dataTypeFor(batch) {
  if (/专科|高职/.test(batch)) return "vocational-admission";
  return "major-admission";
}

function classifyAdmission(sourceSubjectRaw, sourceBatchRaw, rawMajor, majorName, college = "") {
  const text = [sourceSubjectRaw, sourceBatchRaw, rawMajor, majorName, college].map(clean).join(" ");
  if (/专升本/.test(text)) return { admissionType: "特殊类型录取", admissionSubtype: "专升本", formalScoreScope: "special-path-only" };
  if (SPORTS_PATTERN.test(text)) return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  if (ART_PATTERN.test(text)) return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  if (COOP_PATTERN.test(text)) return { admissionType: "普通录取", admissionSubtype: "中外合作/联办", formalScoreScope: "school-official-only" };
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function scoreMetric(classification, dataType) {
  if (classification.admissionSubtype === "专升本") return "特殊路径学校源表计分";
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (dataType === "vocational-admission") return "高职专科学校官网录取分";
  return "高考文化分或学校官网投档成绩";
}

function makeRecord({
  page,
  rawHtmlRel,
  rowIndex,
  sourceSubjectRaw,
  sourceBatchRaw,
  rawMajor,
  minScoreRaw,
  controlLineRaw = "",
  scoreDeltaRaw = "",
  college = "",
  rawRow,
}) {
  const minScore = parseNumber(minScoreRaw);
  const majorName = normalizeMajorName(rawMajor);
  const batch = inferBatch(rawMajor, sourceBatchRaw);
  const dataType = dataTypeFor(batch);
  const classification = classifyAdmission(sourceSubjectRaw, sourceBatchRaw, rawMajor, majorName, college);
  const subjectType = normalizeSubject(sourceSubjectRaw);
  const majorGroup = [SOURCE.schoolName, "河南", subjectType, batch, college, majorName].filter(Boolean).join("-");
  const record = {
    id: `${page.year}-sqnu-${dataType.replace(/-admission$/, "")}-${stableId([
      page.key,
      sourceSubjectRaw,
      sourceBatchRaw,
      college,
      rawMajor,
      minScoreRaw,
      rowIndex,
    ])}`,
    province: "河南",
    sourceProvinceRaw: "河南",
    year: page.year,
    subjectType,
    sourceSubjectRaw: sourceSubjectRaw || "官网未列科类",
    batch,
    sourceBatchRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType,
    majorName,
    majorGroup,
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    minScore,
    scoreMetric: scoreMetric(classification, dataType),
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-score",
    sourceUrl: page.url,
    sourcePageUrl: page.url,
    sourceIndexUrl: INDEX_URL,
    officialEvidencePath: rawHtmlRel,
    sourceHtmlPath: rawHtmlRel,
    sourcePageKey: page.key,
    sourcePageTitle: page.title,
    sourceMajorNameRaw: rawMajor,
    sourceMinScoreRaw: minScoreRaw,
    rawRow: {
      source: `sqnu-${page.year}-official-html-table-v3223`,
      pageKey: page.key,
      rowIndex,
      cells: rawRow,
    },
    cautions: [
      `本记录来自商丘师范学院招生信息网官方 ${page.year} 年河南录取分数 HTML 表，是单校分专业/路径录取边界，不是省级教育考试院全量投档/录取分数表。`,
      "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺术、体育、专升本等特殊路径，运行层按 special-path-only 隔离，不与普通批文化分边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  const controlLine = parseNumber(controlLineRaw);
  const scoreDelta = parseNumber(scoreDeltaRaw);
  const scoreDetailRaw = extractScoreDetail(rawMajor);
  if (college) record.college = college;
  if (classification.admissionSubtype === "专升本") record.candidateCategory = "专升本";
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (Number.isFinite(scoreDelta)) record.scoreDeltaFromControl = scoreDelta;
  if (controlLineRaw) record.sourceControlLineRaw = controlLineRaw;
  if (scoreDeltaRaw) record.sourceScoreDeltaRaw = scoreDeltaRaw;
  if (scoreDetailRaw) record.sourceScoreDetailRaw = scoreDetailRaw;
  return record;
}

function isFooterRow(row) {
  const text = row.map(clean).join("|");
  return !text || /上一条|下一条|招生办公众号|招生手机网|招生信息网|阳光招生/.test(text);
}

function isCollegeHeader(text) {
  const value = clean(text);
  return /学院$/.test(value) && !/[（(]/.test(value);
}

function parseSportsTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  let sourceSubjectRaw = "";
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.includes("科类") && cells.includes("专业") && cells.includes("最低分")) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells)) return;
    if (cells.length < 5) return;
    if (cells[0]) sourceSubjectRaw = cells[0];
    const rawMajor = cells[1];
    const minScoreRaw = cells[2];
    const minScore = parseNumber(minScoreRaw);
    if (!rawMajor || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw,
      sourceBatchRaw: page.sourceBatchRaw,
      rawMajor,
      minScoreRaw,
      controlLineRaw: cells[3] || "",
      scoreDeltaRaw: cells[4] || "",
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parseUpgradeTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if ((cells.includes("序号") || cells[0] === "序号") && cells.includes("专业") && cells.includes("最低分")) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells)) return;
    if (cells.length < 3) return;
    const rawMajor = cells[1];
    const minScoreRaw = cells[2];
    const minScore = parseNumber(minScoreRaw);
    if (!rawMajor || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw: "专升本",
      sourceBatchRaw: page.sourceBatchRaw,
      rawMajor: `${rawMajor}(专升本)`,
      minScoreRaw,
      controlLineRaw: cells[3] || "",
      scoreDeltaRaw: cells[4] || "",
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parseUpgradeTwoColumnTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (isFooterRow(cells) || cells.length !== 2) return;
    const [rawMajor, minScoreRaw] = cells;
    const minScore = parseNumber(minScoreRaw);
    if (!/[（(]\s*专升本\s*[）)]/.test(rawMajor)) return;
    if (!Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw: "专升本",
      sourceBatchRaw: page.sourceBatchRaw,
      rawMajor,
      minScoreRaw,
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parseTwoColumnMajorTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let college = "";
  let section = page.sourceBatchRaw;
  let limitedSectionRemaining = 0;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (isFooterRow(cells) || cells.length !== 2) return;
    const [rawMajor, minScoreRaw] = cells;
    const minScore = parseNumber(minScoreRaw);
    if (TITLE_ROW_PATTERN.test(rawMajor)) {
      section = rawMajor === "本科" || rawMajor === "专科" ? `${page.sourceBatchRaw}-${rawMajor}` : rawMajor;
      college = "";
      limitedSectionRemaining = rawMajor === "与商丘职业技术学院联合招生" ? 2 : 0;
      return;
    }
    if (isCollegeHeader(rawMajor)) {
      college = rawMajor;
      section = isVocationalSection(section) ? `${page.sourceBatchRaw}-专科` : `${page.sourceBatchRaw}-本科`;
      return;
    }
    if (!/[（(]\s*(本科|专科)\s*[）)]/.test(rawMajor)) return;
    if (!Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-score", page: page.key, rowIndex, row });
      return;
    }
    const sourceBatchRaw = limitedSectionRemaining > 0 ? "与商丘职业技术学院联合招生" : section;
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw: "",
      sourceBatchRaw,
      rawMajor,
      minScoreRaw,
      college,
      rawRow: row,
    }));
    if (limitedSectionRemaining > 0) {
      limitedSectionRemaining -= 1;
      if (limitedSectionRemaining === 0) section = `${page.sourceBatchRaw}-本科`;
    }
  });
  return { records, skippedRows };
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

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const records = [];
  const skippedRows = [];
  const pageSummaries = [];
  const rawFiles = [];

  for (const page of PAGES) {
    const { html, htmlRel, htmlPath } = await downloadHtml(page, rawRoot, args.useCache);
    const rows = tableRows(html);
    const rawHtmlRel = `${RAW_DIR}/${htmlRel}`;
    let parsed;
    if (page.parser === "sportsTable") parsed = parseSportsTable(page, rows, rawHtmlRel);
    else if (page.parser === "upgradeTable") parsed = parseUpgradeTable(page, rows, rawHtmlRel);
    else if (page.parser === "upgradeTwoColumnTable") parsed = parseUpgradeTwoColumnTable(page, rows, rawHtmlRel);
    else if (page.parser === "twoColumnMajorTable") parsed = parseTwoColumnMajorTable(page, rows, rawHtmlRel);
    else throw new Error(`Unknown parser: ${page.parser}`);
    records.push(...parsed.records);
    skippedRows.push(...parsed.skippedRows);
    const sha256Html = sha256File(htmlPath);
    pageSummaries.push({
      key: page.key,
      title: page.title,
      officialTitle: extractOfficialTitle(html),
      publishedAt: extractPublishedAt(html),
      url: page.url,
      rawHtmlPath: rawHtmlRel,
      parsedRecords: parsed.records.length,
      skippedRows: parsed.skippedRows.length,
      sha256Html,
    });
    rawFiles.push({ path: rawHtmlRel, url: page.url, sha256: sha256Html });
  }

  const duplicateIds = records.map((record) => record.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate record IDs: ${[...new Set(duplicateIds)].slice(0, 5).join(", ")}`);
  }

  const expected = {
    "henan-sports-2016": 4,
    "henan-upgrade-2016": 40,
    "henan-main-2015": 93,
    "henan-upgrade-2015": 44,
    "henan-main-2014": 94,
  };
  for (const summary of pageSummaries) {
    if (summary.parsedRecords !== expected[summary.key]) {
      throw new Error(`Unexpected parsedRecords for ${summary.key}: ${summary.parsedRecords}, expected ${expected[summary.key]}`);
    }
  }

  const sourceNote = {
    id: SOURCE.id,
    title: "商丘师范学院招生信息网：2014-2016年河南本专科、体育和专升本官方 HTML 分数表",
    publisher: "商丘师范学院招生信息网",
    publishedAt: "2016-07-11",
    url: INDEX_URL,
    quality: SOURCE.quality,
    usage: "从商丘师范学院招生信息网官方“录取分数”栏目下载 2014 年河南省本专科、2015 年河南省本专科、2015 年专升本、2016 年体育专业、2016 年专升本 HTML 页面，抽取有明确专业与最低分的单校录取边界。学院标题、批次标题、控制线/合格线页面不作为录取边界导入。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    provincesWithRecords: uniqueSorted(records, "province"),
    pageSummaries,
    rawDir: RAW_DIR,
    rawFiles,
    recordTypeCounts: countBy(records, "dataType"),
    formalScoreScopeCounts: countBy(records, "formalScoreScope"),
    admissionTypeCounts: countBy(records, "admissionType"),
    admissionSubtypeCounts: countBy(records, "admissionSubtype"),
    subjectTypeCounts: countBy(records, "subjectType"),
    recordsWithRank: 0,
    recordsRankUnavailable: records.length,
    scoreRange: rangeOf(records, "minScore"),
    ordinarySchoolOfficialScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "school-official-only"), "minScore"),
    specialPathScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "special-path-only"), "minScore"),
    rankRange: null,
    boundaryNotes: [
      "商丘师范学院单校官网分数只用于该校候选边界复核，不替代省级教育考试院全量投档/录取分数表。",
      "本轮只导入有明确专业与最低分的 HTML 表行；学院名、批次名、控制线、合格线和计划说明不作为录取边界。",
      "2014、2015 年本专科页没有逐行公开文理科类；运行层用 subjectType=官网未列科类 保存，不推断文/理。",
      "源表未公开最低分位次；所有行 rankUnavailable=true，不生成假位次。",
      "艺术、体育、专升本等按 special-path-only 隔离，不与普通高考文化分概率混算。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };

  const outPath = resolveProjectPath(args.out);
  ensureDir(path.dirname(outPath));
  const payload = {
    sourceNotes: [sourceNote],
    records,
    skippedRows,
    generatedAt: new Date().toISOString(),
    parserVersion: "v3223-sqnu-html-2014-2016-henan-01",
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${records.length} records -> ${args.out}`);
  console.log(`Skipped rows: ${skippedRows.length}`);
  console.log(`Page records: ${pageSummaries.map((page) => `${page.key}:${page.parsedRecords}`).join(", ")}`);
  console.log(`Formal scope counts: ${JSON.stringify(sourceNote.formalScoreScopeCounts)}`);
  console.log(`Record type counts: ${JSON.stringify(sourceNote.recordTypeCounts)}`);
  console.log(`Subject type counts: ${JSON.stringify(sourceNote.subjectTypeCounts)}`);
  console.log(`Score range: ${JSON.stringify(sourceNote.scoreRange)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
