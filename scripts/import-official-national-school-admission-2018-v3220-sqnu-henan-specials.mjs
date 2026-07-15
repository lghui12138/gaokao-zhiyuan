#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2018;
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2018-v3220-sqnu-henan-specials-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2018-v3220-sqnu-henan-specials";
const BASE_URL = "https://zhaoban.sqnu.edu.cn";
const INDEX_URL = `${BASE_URL}/lqfs/5.htm`;

const PAGES = [
  {
    key: "henan-ordinary-6055-2018",
    title: "2018年河南生源普通二本（6055）录取分数",
    url: `${BASE_URL}/info/1005/1743.htm`,
    rawBase: "2018-henan-ordinary-6055",
    parser: "henanMajor",
    sourceBatchRaw: "普通本科二批（6055）",
  },
  {
    key: "henan-ordinary-6057-6058-2018",
    title: "2018年河南生源普通二本（6057、6058）录取分数",
    url: `${BASE_URL}/info/1005/1745.htm`,
    rawBase: "2018-henan-ordinary-6057-6058",
    parser: "henanMajor",
    sourceBatchRaw: "普通本科二批（6057、6058）",
  },
  {
    key: "henan-upgrade-6056-2018",
    title: "2018年河南生源专升本（6056）录取分数",
    url: `${BASE_URL}/info/1005/1744.htm`,
    rawBase: "2018-henan-upgrade-6056",
    parser: "upgrade",
    sourceBatchRaw: "专升本（6056）",
  },
  {
    key: "henan-vocational-2018",
    title: "2018年专科录取分数",
    url: `${BASE_URL}/info/1005/1746.htm`,
    rawBase: "2018-henan-vocational",
    parser: "vocational",
    sourceBatchRaw: "专科",
  },
  {
    key: "henan-primary-teacher-6059-2018",
    title: "2018年小学教育全科教师（6059）各县录取分数",
    url: `${BASE_URL}/info/1005/1749.htm`,
    rawBase: "2018-henan-primary-teacher-6059",
    parser: "primaryTeacher",
    sourceBatchRaw: "小学教育全科教师（6059）",
  },
  {
    key: "henan-art-comparison-2017-2018",
    title: "2017-2018年河南艺术录取分数对比表",
    url: `${BASE_URL}/info/1005/1747.htm`,
    rawBase: "2017-2018-henan-art-comparison",
    parser: "deferredComparison",
    sourceBatchRaw: "河南艺术录取分数对比表",
  },
];

const SOURCE = {
  id: "official-sqnu-national-2018-school-henan-special-major-admission",
  quality: "official-school-sqnu-2018-henan-html-score",
  schoolCode: "10483",
  schoolName: "商丘师范学院",
  city: "商丘",
  tags: ["师范", "河南", "商丘", "商丘师范学院"],
};

const ART_PATTERN = /艺术|美术|音乐|舞蹈|播音|编导|动画|视觉传达|环境设计|书法|摄影|绘画|雕塑/;
const SPORTS_PATTERN = /体育|社会体育/;
const SPECIAL_PATTERN = /专升本|全科|公费|定向/;
const COOP_PATTERN = /中外合作|合作办学|联合培养|商丘职业技术学院|国际教育学院|院校代码6057|院校代码6058/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2018-v3220-sqnu-henan-specials.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2018-v3220-sqnu-henan-specials.mjs --use-cache",
    "",
    "Imports 商丘师范学院招生信息网 official 2018 Henan undergraduate/vocational/upgrade/primary-teacher HTML tables.",
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
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const compact = text.replace(/\s+/g, "");
  const match = compact.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function integerNumber(value) {
  const n = parseNumber(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
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
  if (/理/.test(text)) return "物理类";
  return text || "官网未列科类";
}

function normalizeBatch(raw, dataType = "") {
  const text = clean(raw);
  if (/专升本/.test(text)) return "专升本批";
  if (/专科|高职/.test(text) || dataType === "vocational-admission") return "高职（专科）批";
  if (/全科/.test(text)) return "小学教育全科教师";
  if (/二本|二批/.test(text)) return "本科二批";
  if (/本科/.test(text)) return "本科批";
  return text || "官网未列批次";
}

function classifyAdmission(sourceSubjectRaw, sourceBatchRaw, majorName, college = "", remark = "") {
  const text = [sourceSubjectRaw, sourceBatchRaw, majorName, college, remark].map(clean).join(" ");
  if (/专升本/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "专升本", formalScoreScope: "special-path-only" };
  }
  if (/全科|公费|定向/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "小学全科教师/公费师范等", formalScoreScope: "special-path-only" };
  }
  if (SPORTS_PATTERN.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (ART_PATTERN.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (SPECIAL_PATTERN.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "专升本/小学全科教师等", formalScoreScope: "special-path-only" };
  }
  if (COOP_PATTERN.test(text)) {
    return { admissionType: "普通录取", admissionSubtype: "中外合作/联办", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function dataTypeFor(batch, majorName, explicit = "") {
  if (explicit) return explicit;
  const text = [batch, majorName].map(clean).join(" ");
  if (/专科|高职/.test(text)) return "vocational-admission";
  if (/^二本[文理]科/.test(clean(majorName)) || /全校汇总/.test(text)) return "institution-admission";
  return "major-admission";
}

function scoreMetric(classification, dataType) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  if (dataType === "vocational-admission") return "高职专科学校官网录取分";
  return "高考文化分或学校官网投档成绩";
}

function makeRecord({
  page,
  rawHtmlRel,
  rowIndex,
  province = "河南",
  sourceProvinceRaw = "河南",
  sourceSubjectRaw,
  sourceBatchRaw,
  batch,
  college,
  majorName,
  candidateCounty,
  candidateCategory,
  minScore,
  minScoreRaw,
  maxScore,
  maxScoreRaw,
  avgScore,
  avgScoreRaw,
  controlLine,
  controlLineRaw,
  scoreDelta,
  scoreDeltaRaw,
  admissionCount,
  admissionCountRaw,
  planCount,
  planCountRaw,
  preAdmissionCountRaw,
  remark,
  dataType: dataTypeOverride = "",
  rawRow,
  extra = {},
}) {
  const classification = classifyAdmission(sourceSubjectRaw, sourceBatchRaw, majorName, college, remark);
  const subjectType = normalizeSubject(sourceSubjectRaw);
  const finalBatch = batch || normalizeBatch(sourceBatchRaw, dataTypeOverride);
  const dataType = dataTypeFor(finalBatch, majorName, dataTypeOverride);
  const rankUnavailable = true;
  const majorGroup = [SOURCE.schoolName, province, subjectType, finalBatch, college, majorName, candidateCounty].filter(Boolean).join("-");
  const record = {
    id: `${YEAR}-sqnu-${dataType.replace(/-admission$/, "")}-${stableId([
      page.key,
      province,
      sourceSubjectRaw,
      sourceBatchRaw,
      college,
      majorName,
      candidateCounty,
      minScoreRaw,
      rowIndex,
    ])}`,
    province,
    sourceProvinceRaw,
    year: YEAR,
    subjectType,
    sourceSubjectRaw,
    batch: finalBatch,
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
    scoreOnly: rankUnavailable,
    rankUnavailable,
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
    sourceMinScoreRaw: minScoreRaw,
    rawRow: {
      source: `sqnu-${YEAR}-official-html-table-v3220`,
      pageKey: page.key,
      rowIndex,
      cells: rawRow,
    },
    cautions: [
      `本记录来自商丘师范学院招生信息网官方 ${YEAR} 年河南生源录取分数 HTML 表，是单校分专业/路径录取边界，不是省级教育考试院全量投档/录取分数表。`,
      "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺术、体育、专升本、小学全科教师等特殊路径，运行层按 special-path-only 隔离，不与普通批文化分边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区、调剂规则和特殊路径协议要求复核。",
    ],
    ...extra,
  };
  if (college) record.college = college;
  if (candidateCounty) record.candidateCounty = candidateCounty;
  if (candidateCategory) record.candidateCategory = candidateCategory;
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(avgScore)) record.avgScore = avgScore;
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (Number.isFinite(scoreDelta)) record.scoreDeltaFromControl = scoreDelta;
  if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
  if (Number.isFinite(planCount)) record.planCount = planCount;
  if (maxScoreRaw) record.sourceMaxScoreRaw = maxScoreRaw;
  if (avgScoreRaw) record.sourceAverageScoreRaw = avgScoreRaw;
  if (controlLineRaw) record.sourceControlLineRaw = controlLineRaw;
  if (scoreDeltaRaw) record.sourceScoreDeltaRaw = scoreDeltaRaw;
  if (admissionCountRaw) record.sourceAdmissionCountRaw = admissionCountRaw;
  if (planCountRaw) record.sourcePlanCountRaw = planCountRaw;
  if (preAdmissionCountRaw) record.sourcePreAdmissionCountRaw = preAdmissionCountRaw;
  if (remark) record.sourceRemark = remark;
  return record;
}

function isBlankRow(row) {
  return row.every((cell) => !clean(cell));
}

function parseCarryRow(row, state, mode) {
  const cells = row.map(clean);
  if (mode === "vocational") {
    if (cells.length >= 6) {
      state.college = cells[0];
      state.subject = cells[1];
      return { college: state.college, sourceSubjectRaw: state.subject, majorName: cells[2], minScoreRaw: cells[3], controlLineRaw: cells[4], scoreDeltaRaw: cells[5], remark: cells[6] || "" };
    }
    if (cells.length === 5) {
      state.college = cells[0];
      return { college: state.college, sourceSubjectRaw: state.subject, majorName: cells[1], minScoreRaw: cells[2], controlLineRaw: cells[3], scoreDeltaRaw: cells[4], remark: "" };
    }
    if (cells.length === 4) {
      return { college: state.college, sourceSubjectRaw: state.subject, majorName: cells[0], minScoreRaw: cells[1], controlLineRaw: cells[2], scoreDeltaRaw: cells[3], remark: "" };
    }
    return null;
  }

  if (cells.length >= 7) {
    state.college = cells[0];
    state.subject = cells[1];
    return { college: state.college, sourceSubjectRaw: state.subject, majorName: cells[2], minScoreRaw: cells[3], controlLineRaw: cells[4], scoreDeltaRaw: cells[5], remark: cells[6] || "" };
  }
  if (cells.length === 6) {
    state.college = cells[0];
    return { college: state.college, sourceSubjectRaw: state.subject, majorName: cells[1], minScoreRaw: cells[2], controlLineRaw: cells[3], scoreDeltaRaw: cells[4], remark: cells[5] || "" };
  }
  if (cells.length === 5) {
    return { college: state.college, sourceSubjectRaw: state.subject, majorName: cells[0], minScoreRaw: cells[1], controlLineRaw: cells[2], scoreDeltaRaw: cells[3], remark: cells[4] || "" };
  }
  return null;
}

function parseHenanMajor(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  const state = { college: "", subject: "" };
  let inTable = false;
  let sawRecord = false;

  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const rowText = row.map(clean).join("|");
    if (row.includes("学院") && row.includes("科类") && row.includes("专业名称")) {
      inTable = true;
      return;
    }
    if (!inTable) return;
    if (sawRecord && (isBlankRow(row) || rowText.includes("上一条"))) {
      inTable = false;
      return;
    }
    const parsed = parseCarryRow(row, state, "major");
    if (!parsed) return;
    const minScore = parseNumber(parsed.minScoreRaw);
    if (!parsed.majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, row });
      return;
    }
    sawRecord = true;
    if (page.key === "henan-ordinary-6055-2018" && /^二本[文理]科（?6055）?/.test(parsed.majorName)) {
      skippedRows.push({
        reason: "duplicate-existing-v3219-henan-institution-aggregate",
        page: page.key,
        rowIndex,
        row,
        duplicateOf: "official-national-school-admission-2018-v3219-sqnu-outside-ordinary-import.json 河南普通本科汇总行",
      });
      return;
    }
    const sourceBatchRaw = parsed.college.includes("联合培养")
      ? "普通本科二批（6058 联合培养）"
      : parsed.college.includes("院校代码6057")
        ? "普通本科二批（6057 中外合作/国际教育）"
        : page.sourceBatchRaw;
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw: parsed.sourceSubjectRaw,
      sourceBatchRaw,
      batch: "本科二批",
      college: parsed.college,
      majorName: parsed.majorName,
      minScore,
      minScoreRaw: parsed.minScoreRaw,
      controlLine: parseNumber(parsed.controlLineRaw),
      controlLineRaw: parsed.controlLineRaw,
      scoreDelta: parseNumber(parsed.scoreDeltaRaw),
      scoreDeltaRaw: parsed.scoreDeltaRaw,
      remark: parsed.remark,
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parseVocational(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  const state = { college: "", subject: "" };
  let inTable = false;
  let sawRecord = false;

  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const rowText = row.map(clean).join("|");
    if (row.includes("学院") && row.includes("科类") && row.includes("专业")) {
      inTable = true;
      return;
    }
    if (!inTable) return;
    if (sawRecord && (isBlankRow(row) || rowText.includes("上一条"))) {
      inTable = false;
      return;
    }
    const parsed = parseCarryRow(row, state, "vocational");
    if (!parsed) return;
    const minScore = parseNumber(parsed.minScoreRaw);
    if (!parsed.majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, row });
      return;
    }
    sawRecord = true;
    const sourceBatchRaw = parsed.college.includes("院校代码6057")
      ? "专科（6057 中外合作/国际教育）"
      : page.sourceBatchRaw;
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw: parsed.sourceSubjectRaw,
      sourceBatchRaw,
      batch: "高职（专科）批",
      college: parsed.college,
      majorName: parsed.majorName,
      minScore,
      minScoreRaw: parsed.minScoreRaw,
      controlLine: parseNumber(parsed.controlLineRaw),
      controlLineRaw: parsed.controlLineRaw,
      scoreDelta: parseNumber(parsed.scoreDeltaRaw),
      scoreDeltaRaw: parsed.scoreDeltaRaw,
      dataType: "vocational-admission",
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parseUpgrade(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;

  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    if (row.includes("序号") && row.includes("专业")) {
      inTable = true;
      return;
    }
    if (!inTable) return;
    if (isBlankRow(row) || row.map(clean).join("|").includes("上一条")) {
      inTable = false;
      return;
    }
    const cells = row.map(clean);
    if (cells.length !== 3 || !/^\d+$/.test(cells[0])) return;
    const minScore = parseNumber(cells[2]);
    if (!cells[1] || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, row });
      return;
    }
    const extra = {};
    if (clean(cells[2]).replace(/\s+/g, "") !== clean(cells[2])) {
      extra.sourceMinScoreWhitespaceNormalized = true;
    }
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw: "专升本",
      sourceBatchRaw: page.sourceBatchRaw,
      batch: "专升本批",
      majorName: cells[1],
      minScore,
      minScoreRaw: cells[2],
      dataType: "major-admission",
      rawRow: row,
      candidateCategory: "专升本",
      extra: {
        sourceScoreDetailRaw: "小数点后为英语、综合分",
        ...extra,
      },
    }));
  });
  return { records, skippedRows };
}

function parsePrimaryTeacher(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let sourceSubjectRaw = "";

  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.length === 1 && /小教全科[文理]科/.test(cells[0])) {
      sourceSubjectRaw = cells[0].includes("文科") ? "文科" : "理科";
      return;
    }
    if (!sourceSubjectRaw || cells.includes("专业名称") || isBlankRow(row)) return;
    if (cells.length !== 6) return;
    const [county, planCountRaw, preAdmissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw] = cells;
    const minScore = parseNumber(minScoreRaw);
    if (!county || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw,
      sourceBatchRaw: page.sourceBatchRaw,
      batch: "小学教育全科教师",
      majorName: "小学教育（师范）（全科教师）",
      candidateCounty: county,
      candidateCategory: "小学全科公费师范生",
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      admissionCount: integerNumber(preAdmissionCountRaw),
      admissionCountRaw: preAdmissionCountRaw,
      planCount: integerNumber(planCountRaw),
      planCountRaw,
      preAdmissionCountRaw,
      dataType: "major-admission",
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parseDeferredComparison(page, rows) {
  return {
    records: [],
    skippedRows: [{
      reason: "deferred-mixed-year-duplicate-comparison-page",
      page: page.key,
      rowIndex: 1,
      rows: rows.length,
      note: "2017-2018 艺术对比页同时含 2017/2018 列；2018 艺体行与 6055/6057 单年页重复，本轮只保存 raw 证据不入运行层。",
    }],
  };
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

function sumOf(records, key) {
  return records.reduce((sum, record) => sum + (Number.isFinite(record[key]) ? record[key] : 0), 0);
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
    if (page.parser === "henanMajor") parsed = parseHenanMajor(page, rows, rawHtmlRel);
    else if (page.parser === "upgrade") parsed = parseUpgrade(page, rows, rawHtmlRel);
    else if (page.parser === "vocational") parsed = parseVocational(page, rows, rawHtmlRel);
    else if (page.parser === "primaryTeacher") parsed = parsePrimaryTeacher(page, rows, rawHtmlRel);
    else if (page.parser === "deferredComparison") parsed = parseDeferredComparison(page, rows);
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

  const sourceNote = {
    id: SOURCE.id,
    title: "商丘师范学院招生信息网：2018年河南生源普通二本、专升本、专科和小学全科教师官方 HTML 表",
    publisher: "商丘师范学院招生信息网",
    publishedAt: "2018-11-21",
    url: INDEX_URL,
    quality: SOURCE.quality,
    usage: "从商丘师范学院招生信息网官方“录取分数”栏目下载 2018 年河南生源普通二本（6055/6057/6058）、专升本（6056）、专科、小学教育全科教师（6059）和 2017-2018 河南艺术对比 HTML 页面，抽取单校分专业/路径最低分、省控线、最低分差、计划数、预录数、最高分和平均分。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
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
    recordsWithPlanCount: records.filter((record) => Number.isFinite(record.planCount)).length,
    planCount: sumOf(records, "planCount"),
    admissionCount: sumOf(records, "admissionCount"),
    scoreRange: rangeOf(records, "minScore"),
    ordinarySchoolOfficialScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "school-official-only"), "minScore"),
    specialPathScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "special-path-only"), "minScore"),
    rankRange: null,
    boundaryNotes: [
      "商丘师范学院单校官网分数只用于该校候选边界复核，不替代省级教育考试院全量投档/录取分数表。",
      "2018 年河南 6055 普通二本汇总文/理两行已由 v3.219 的 2018 普通本科 HTML 表进入运行层，本轮按 duplicate-existing-v3219 跳过以避免重复计数。",
      "2017-2018 河南艺术录取分数对比页已保存 raw 证据，但 2018 艺体行与 6055/6057 单年页重复且页面混有 2017 列，本轮不入运行层。",
      "2018 年本轮源表未公开最低分位次；所有行 rankUnavailable=true，不生成假位次。",
      "艺术、体育、专升本、小学全科教师等按 special-path-only 隔离，不与普通高考文化分概率混算。",
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
    parserVersion: "v3220-sqnu-html-2018-henan-specials-01",
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${records.length} records -> ${args.out}`);
  console.log(`Skipped rows: ${skippedRows.length}`);
  console.log(`Page records: ${pageSummaries.map((page) => `${page.key}:${page.parsedRecords}`).join(", ")}`);
  console.log(`Formal scope counts: ${JSON.stringify(sourceNote.formalScoreScopeCounts)}`);
  console.log(`Admission type counts: ${JSON.stringify(sourceNote.admissionTypeCounts)}`);
  console.log(`Subject type counts: ${JSON.stringify(sourceNote.subjectTypeCounts)}`);
  console.log(`Score range: ${JSON.stringify(sourceNote.scoreRange)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
