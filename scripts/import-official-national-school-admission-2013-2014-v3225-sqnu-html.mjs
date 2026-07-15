#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2013-2014-v3225-sqnu-html-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2013-2014-v3225-sqnu-html";
const BASE_URL = "https://zhaoban.sqnu.edu.cn";
const INDEX_URL = `${BASE_URL}/lqfs/3.htm`;

const PAGES = [
  { key: "anhui-liberal-2014", year: 2014, province: "安徽", sourceSubjectRaw: "文科", title: "2014安徽文科录取最高、低分", url: `${BASE_URL}/info/1005/1203.htm`, rawBase: "2014-anhui-liberal", parser: "majorHighLow", sourceBatchRaw: "普通本科", expectedRecords: 12 },
  { key: "anhui-science-2014", year: 2014, province: "安徽", sourceSubjectRaw: "理科", title: "2014安徽理科录取最高、低分", url: `${BASE_URL}/info/1005/1204.htm`, rawBase: "2014-anhui-science", parser: "majorHighLow", sourceBatchRaw: "普通本科", expectedRecords: 20 },
  { key: "tianjin-liberal-2014", year: 2014, province: "天津", sourceSubjectRaw: "文科", title: "2014天津市文科录取最高、低分", url: `${BASE_URL}/info/1005/1205.htm`, rawBase: "2014-tianjin-liberal", parser: "majorHighLow", sourceBatchRaw: "普通本科", expectedRecords: 8 },
  { key: "tianjin-science-2014", year: 2014, province: "天津", sourceSubjectRaw: "理科", title: "2014天津市理工录取最高、低分", url: `${BASE_URL}/info/1005/1206.htm`, rawBase: "2014-tianjin-science", parser: "singleCellHighLow", sourceBatchRaw: "普通本科", expectedRecords: 16 },
  { key: "shanxi-liberal-2014", year: 2014, province: "山西", sourceSubjectRaw: "文科", title: "2014山西省文科录取最高、低分", url: `${BASE_URL}/info/1005/1207.htm`, rawBase: "2014-shanxi-liberal", parser: "majorHighLow", sourceBatchRaw: "普通本科", expectedRecords: 18 },
  { key: "shanxi-science-2014", year: 2014, province: "山西", sourceSubjectRaw: "理科", title: "2014山西省理科录取最高、低分", url: `${BASE_URL}/info/1005/1208.htm`, rawBase: "2014-shanxi-science", parser: "majorHighLow", sourceBatchRaw: "普通本科", expectedRecords: 31 },
  { key: "hebei-science-2014", year: 2014, province: "河北", sourceSubjectRaw: "理科", title: "2014河北省理科录取最高、低分数线", url: `${BASE_URL}/info/1005/1210.htm`, rawBase: "2014-hebei-science", parser: "majorHighLow", sourceBatchRaw: "普通本科", expectedRecords: 31 },
  { key: "hebei-liberal-2014", year: 2014, province: "河北", sourceSubjectRaw: "文科", title: "2014河北省文科录取最高、低分数线", url: `${BASE_URL}/info/1005/1211.htm`, rawBase: "2014-hebei-liberal", parser: "majorHighLow", sourceBatchRaw: "普通本科", expectedRecords: 20 },
  { key: "henan-sports-science-2014", year: 2014, province: "河南", sourceSubjectRaw: "体育理科", title: "2014年河南省体育理科录取最高分最低分", url: `${BASE_URL}/info/1005/1212.htm`, rawBase: "2014-henan-sports-science", parser: "majorHighLow", sourceBatchRaw: "河南体育本科", expectedRecords: 2 },
  { key: "henan-sports-liberal-2014", year: 2014, province: "河南", sourceSubjectRaw: "体育文科", title: "2014年河南省体育文科录取最高最低分", url: `${BASE_URL}/info/1005/1213.htm`, rawBase: "2014-henan-sports-liberal", parser: "majorHighLow", sourceBatchRaw: "河南体育本科", expectedRecords: 2 },
  { key: "shandong-liberal-2014", year: 2014, province: "山东", sourceSubjectRaw: "文科", title: "2014年山东省文科各专业最高、最低录取分", url: `${BASE_URL}/info/1005/1214.htm`, rawBase: "2014-shandong-liberal", parser: "majorHighLow", sourceBatchRaw: "普通本科", expectedRecords: 17 },
  { key: "shandong-science-2014", year: 2014, province: "山东", sourceSubjectRaw: "理科", title: "2014年山东省理科各专业录取最高最低分", url: `${BASE_URL}/info/1005/1215.htm`, rawBase: "2014-shandong-science", parser: "majorHighLow", sourceBatchRaw: "普通本科", expectedRecords: 27 },
  { key: "henan-upgrade-2014", year: 2014, province: "河南", sourceSubjectRaw: "专升本", title: "2014年专升本各专业最高最低分", url: `${BASE_URL}/info/1005/1216.htm`, rawBase: "2014-henan-upgrade", parser: "upgradeHighLow", sourceBatchRaw: "专升本", expectedRecords: 20 },
  { key: "shandong-summary-2013", year: 2013, province: "山东", sourceSubjectRaw: "", title: "2013山东录取最低分", url: `${BASE_URL}/info/1005/1218.htm`, rawBase: "2013-shandong-summary", parser: "specialSummary", sourceBatchRaw: "山东本科", expectedRecords: 11 },
  { key: "hebei-summary-2013", year: 2013, province: "河北", sourceSubjectRaw: "", title: "河北2013年各专业最低分", url: `${BASE_URL}/info/1005/1219.htm`, rawBase: "2013-hebei-summary", parser: "specialSummary", sourceBatchRaw: "河北本科", expectedRecords: 11 },
];

const RAW_ONLY_PAGES = [
  { key: "henan-vocational-2014-raw-only", year: 2014, title: "2014年河南专科各专业最低分", url: `${BASE_URL}/info/1005/1209.htm`, rawBase: "2014-henan-vocational-raw-only", reason: "official HTML body exposes only a page/table title, with no parseable major/score rows" },
  { key: "henan-art-2014-raw-only", year: 2014, title: "2014年艺术本科最低分", url: `${BASE_URL}/info/1005/1217.htm`, rawBase: "2014-henan-art-raw-only", reason: "official HTML body exposes only a table header token, with no parseable major/score rows" },
];

const SOURCE = {
  id: "official-sqnu-national-2013-2014-school-html-admission",
  quality: "official-school-sqnu-2013-2014-html-score",
  schoolCode: "10483",
  schoolName: "商丘师范学院",
  city: "商丘",
  tags: ["师范", "河南", "商丘", "商丘师范学院"],
};

const ART_PATTERN = /艺术|美术|音乐|舞蹈|播音|编导|动画|视觉传达|环境设计|书法|摄影|绘画|雕塑|表演|设计/;
const SPORTS_PATTERN = /体育|社会体育|运动训练|武术/;
const COOP_PATTERN = /中外合作|合作办学|联合办学|国际通识|国际教育学院|软件学院/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2013-2014-v3225-sqnu-html.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2013-2014-v3225-sqnu-html.mjs --use-cache",
    "",
    "Imports parseable official SQNU 2013-2014 HTML score tables and preserves raw-only pages as skipped evidence.",
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

async function fetchBuffer(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "text/html,application/xhtml+xml,application/xml,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: INDEX_URL,
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
  const html = (await fetchBuffer(page.url)).toString("utf8").replace(/\0/g, "");
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

function normalizeMajorName(rawMajor) {
  return clean(rawMajor)
    .replace(/[（(]\s*(本科|专科|专升本|文|理)\s*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim();
}

function inferBatch(rawMajor, sourceBatchRaw) {
  const text = [rawMajor, sourceBatchRaw].map(clean).join(" ");
  if (/专升本/.test(text)) return "专升本批";
  if (/专科|高职|二专/.test(text)) return "高职（专科）批";
  if (SPORTS_PATTERN.test(text)) return "体育本科批";
  if (ART_PATTERN.test(text)) return "艺术本科批";
  return "本科二批";
}

function dataTypeFor(batch, explicit = "") {
  if (explicit) return explicit;
  if (/专科|高职/.test(batch)) return "vocational-admission";
  return "major-admission";
}

function classifyAdmission(sourceSubjectRaw, sourceBatchRaw, rawMajor, majorName, college = "", scoreDetailRaw = "") {
  const text = [sourceSubjectRaw, sourceBatchRaw, rawMajor, majorName, college, scoreDetailRaw].map(clean).join(" ");
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
  province = page.province,
  sourceSubjectRaw = page.sourceSubjectRaw || "",
  sourceBatchRaw = page.sourceBatchRaw,
  rawMajor,
  minScoreRaw,
  maxScoreRaw = "",
  college = "",
  dataTypeOverride = "",
  scoreDetailRaw = "",
  rawRow,
}) {
  const minScore = parseNumber(minScoreRaw);
  const maxScore = parseNumber(maxScoreRaw);
  const majorName = normalizeMajorName(rawMajor);
  const batch = inferBatch(rawMajor, sourceBatchRaw);
  const dataType = dataTypeFor(batch, dataTypeOverride);
  const classification = classifyAdmission(sourceSubjectRaw, sourceBatchRaw, rawMajor, majorName, college, scoreDetailRaw);
  const subjectType = normalizeSubject(sourceSubjectRaw);
  const majorGroup = [SOURCE.schoolName, province, subjectType, batch, college, majorName].filter(Boolean).join("-");
  const record = {
    id: `${page.year}-sqnu-${dataType.replace(/-admission$/, "")}-${stableId([
      page.key,
      province,
      sourceSubjectRaw,
      sourceBatchRaw,
      college,
      rawMajor,
      minScoreRaw,
      maxScoreRaw,
      rowIndex,
    ])}`,
    province,
    sourceProvinceRaw: province,
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
      source: `sqnu-${page.year}-official-html-table-v3225`,
      pageKey: page.key,
      rowIndex,
      cells: rawRow,
    },
    cautions: [
      `本记录来自商丘师范学院招生信息网官方 ${page.year} 年录取分数 HTML 表，是单校分省/分专业/路径录取边界，不是省级教育考试院全量投档/录取分数表。`,
      "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺术、体育、专升本等特殊路径，运行层按 special-path-only 隔离，不与普通批文化分边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  if (college) record.college = college;
  if (maxScoreRaw) record.sourceMaxScoreRaw = maxScoreRaw;
  if (Number.isFinite(maxScore) && (!Number.isFinite(minScore) || maxScore >= minScore)) {
    record.maxScore = maxScore;
  } else if (Number.isFinite(maxScore)) {
    record.sourceScoreAnomalyRaw = `official maxScore ${maxScoreRaw} is lower than minScore ${minScoreRaw}; maxScore is preserved as raw only`;
  }
  if (scoreDetailRaw) record.sourceScoreDetailRaw = scoreDetailRaw;
  if (classification.admissionSubtype === "专升本") record.candidateCategory = "专升本";
  return record;
}

function isFooterRow(row) {
  const text = row.map(clean).join("|");
  return !text || /上一条|下一条|招生办公众号|招生手机网|招生信息网|阳光招生|当前位置：/.test(text);
}

function isHighLowHeader(cells) {
  const text = cells.join("|");
  return /专业/.test(text) && /最高分|录取最高分/.test(text) && /最低分|录取最低分/.test(text);
}

function parseMajorHighLow(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (isHighLowHeader(cells)) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length !== 3) return;
    const [rawMajor, maxScoreRaw, minScoreRaw] = cells;
    if (!rawMajor || !Number.isFinite(parseNumber(minScoreRaw))) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({ page, rawHtmlRel, rowIndex, rawMajor, minScoreRaw, maxScoreRaw, rawRow: row }));
  });
  return { records, skippedRows };
}

function parseSingleCellHighLow(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  const rowIndex = rows.findIndex((row) => row.length === 1 && /专业名称\s+最高分\s+最低分/.test(row[0])) + 1;
  const blob = rowIndex ? clean(rows[rowIndex - 1][0]) : "";
  if (!blob) return { records, skippedRows: [{ reason: "missing-single-cell-table", page: page.key, rowIndex: 0, row: [] }] };
  const tokens = blob.replace(/^专业名称\s+最高分\s+最低分\s*/, "").split(/\s+/).filter(Boolean);
  if (tokens.length % 3 !== 0) {
    skippedRows.push({ reason: "single-cell-token-count-not-multiple-of-3", page: page.key, rowIndex, row: [blob], tokenCount: tokens.length });
  }
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const rawMajor = tokens[i];
    const maxScoreRaw = tokens[i + 1];
    const minScoreRaw = tokens[i + 2];
    if (!rawMajor || !Number.isFinite(parseNumber(minScoreRaw))) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row: [rawMajor, maxScoreRaw, minScoreRaw] });
      continue;
    }
    records.push(makeRecord({ page, rawHtmlRel, rowIndex: rowIndex + i / 3, rawMajor, minScoreRaw, maxScoreRaw, rawRow: [rawMajor, maxScoreRaw, minScoreRaw] }));
  }
  return { records, skippedRows };
}

function parseUpgradeHighLow(page, rows, rawHtmlRel) {
  const parsed = parseMajorHighLow(page, rows, rawHtmlRel);
  parsed.records = parsed.records.map((record) => {
    if (record.candidateCategory === "专升本") return record;
    return { ...record, candidateCategory: "专升本" };
  });
  return parsed;
}

function parseSpecialSummary(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  let college = "";
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.some((cell) => /科类|BZK/.test(cell)) && cells.some((cell) => /汇总/.test(cell))) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length < 4) return;
    const second = cells[1] || "";
    const third = cells[2] || "";
    const scoreRaw = cells[3] || "";
    const detailRaw = cells[4] || "";
    if (/文科|理科/.test(second) && !third) {
      const sourceSubjectRaw = /文科/.test(second) ? "文科" : "理科";
      const rawMajor = `全校${second.replace(/各专业最低分?|各专业最低/, "") || sourceSubjectRaw}汇总(本科)`;
      if (!Number.isFinite(parseNumber(scoreRaw))) {
        skippedRows.push({ reason: "missing-summary-score", page: page.key, rowIndex, row });
        return;
      }
      records.push(makeRecord({
        page,
        rawHtmlRel,
        rowIndex,
        sourceSubjectRaw,
        sourceBatchRaw: page.sourceBatchRaw,
        rawMajor,
        minScoreRaw: scoreRaw,
        dataTypeOverride: "institution-admission",
        rawRow: row,
      }));
      return;
    }
    if (second) college = second;
    const rawMajor = third;
    if (!rawMajor || !Number.isFinite(parseNumber(scoreRaw))) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw: "",
      sourceBatchRaw: page.sourceBatchRaw,
      rawMajor,
      minScoreRaw: scoreRaw,
      college,
      scoreDetailRaw: detailRaw,
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parsePage(page, rows, rawHtmlRel) {
  if (page.parser === "majorHighLow") return parseMajorHighLow(page, rows, rawHtmlRel);
  if (page.parser === "singleCellHighLow") return parseSingleCellHighLow(page, rows, rawHtmlRel);
  if (page.parser === "upgradeHighLow") return parseUpgradeHighLow(page, rows, rawHtmlRel);
  if (page.parser === "specialSummary") return parseSpecialSummary(page, rows, rawHtmlRel);
  throw new Error(`Unknown parser: ${page.parser}`);
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
  const rawOnlyPageSummaries = [];
  const rawFiles = [];

  for (const page of PAGES) {
    const { html, htmlRel, htmlPath } = await downloadHtml(page, rawRoot, args.useCache);
    const rows = tableRows(html);
    const rawHtmlRel = `${RAW_DIR}/${htmlRel}`;
    const parsed = parsePage(page, rows, rawHtmlRel);
    records.push(...parsed.records);
    skippedRows.push(...parsed.skippedRows);
    const sha256Html = sha256File(htmlPath);
    const summary = {
      key: page.key,
      title: page.title,
      officialTitle: extractOfficialTitle(html),
      publishedAt: extractPublishedAt(html),
      url: page.url,
      rawHtmlPath: rawHtmlRel,
      parsedRecords: parsed.records.length,
      skippedRows: parsed.skippedRows.length,
      sha256Html,
    };
    if (summary.parsedRecords !== page.expectedRecords) {
      throw new Error(`Unexpected parsedRecords for ${page.key}: ${summary.parsedRecords}, expected ${page.expectedRecords}`);
    }
    pageSummaries.push(summary);
    rawFiles.push({ path: rawHtmlRel, url: page.url, sha256: sha256Html });
  }

  for (const page of RAW_ONLY_PAGES) {
    const { html, htmlRel, htmlPath } = await downloadHtml(page, rawRoot, args.useCache);
    const rawHtmlRel = `${RAW_DIR}/${htmlRel}`;
    const sha256Html = sha256File(htmlPath);
    rawOnlyPageSummaries.push({
      key: page.key,
      year: page.year,
      title: page.title,
      officialTitle: extractOfficialTitle(html),
      publishedAt: extractPublishedAt(html),
      url: page.url,
      rawHtmlPath: rawHtmlRel,
      parsedRecords: 0,
      reason: page.reason,
      tableRows: tableRows(html).length,
      sha256Html,
    });
    rawFiles.push({ path: rawHtmlRel, url: page.url, sha256: sha256Html });
  }

  const duplicateIds = records.map((record) => record.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate record IDs: ${[...new Set(duplicateIds)].slice(0, 5).join(", ")}`);
  }
  const expectedTotal = PAGES.reduce((sum, page) => sum + page.expectedRecords, 0);
  if (records.length !== expectedTotal) {
    throw new Error(`Unexpected total record count: ${records.length}, expected ${expectedTotal}`);
  }

  const anomalyRows = records.filter((record) => record.sourceScoreAnomalyRaw);
  const sourceNote = {
    id: SOURCE.id,
    title: "商丘师范学院招生信息网：2013-2014年省外普通、河南体育/专升本和外省艺体官方 HTML 分数表",
    publisher: "商丘师范学院招生信息网",
    publishedAt: "2015-05-08",
    url: INDEX_URL,
    quality: SOURCE.quality,
    usage: "从商丘师范学院招生信息网官方“录取分数”栏目下载 2013-2014 年省外普通本科、河南体育、河南专升本以及山东/河北 2013 汇总 HTML 页面，抽取有明确专业或学校层汇总与最低分的单校录取边界；只露出空表头或无可解析分数行的旧页保存 raw 证据但不入运行层。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    skippedOfficialPages: rawOnlyPageSummaries.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    provincesWithRecords: uniqueSorted(records, "province"),
    pageSummaries,
    rawOnlyPageSummaries,
    rawDir: RAW_DIR,
    rawFiles,
    recordTypeCounts: countBy(records, "dataType"),
    formalScoreScopeCounts: countBy(records, "formalScoreScope"),
    admissionTypeCounts: countBy(records, "admissionType"),
    admissionSubtypeCounts: countBy(records, "admissionSubtype"),
    subjectTypeCounts: countBy(records, "subjectType"),
    recordsWithMaxScore: records.filter((record) => Number.isFinite(record.maxScore)).length,
    recordsWithRawMaxScore: records.filter((record) => record.sourceMaxScoreRaw).length,
    scoreAnomalyRows: anomalyRows.map((record) => ({ id: record.id, province: record.province, year: record.year, majorName: record.majorName, sourceMaxScoreRaw: record.sourceMaxScoreRaw, sourceMinScoreRaw: record.sourceMinScoreRaw })),
    recordsWithRank: 0,
    recordsRankUnavailable: records.length,
    scoreRange: rangeOf(records, "minScore"),
    ordinarySchoolOfficialScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "school-official-only"), "minScore"),
    specialPathScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "special-path-only"), "minScore"),
    rankRange: null,
    boundaryNotes: [
      "商丘师范学院单校官网分数只用于该校候选边界复核，不替代省级教育考试院全量投档/录取分数表。",
      "本轮只导入有明确专业或学校层汇总、明确最低分的 HTML 表行；空表头页和无正文分数行旧页不作为录取边界。",
      "2013 河北/山东艺体汇总页没有逐行公开文理科类；运行层用 subjectType=官网未列科类 保存，不推断文/理。",
      "河北 2014 文科经济学（企业财务会计反向）行官网最高分小于最低分，运行层仅保留 sourceMaxScoreRaw 并标记异常，不生成可用 maxScore。",
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
    parserVersion: "v3225-sqnu-html-2013-2014-01",
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${records.length} records -> ${args.out}`);
  console.log(`Skipped rows: ${skippedRows.length}`);
  console.log(`Raw-only pages: ${rawOnlyPageSummaries.length}`);
  console.log(`Page records: ${pageSummaries.map((page) => `${page.key}:${page.parsedRecords}`).join(", ")}`);
  console.log(`Formal scope counts: ${JSON.stringify(sourceNote.formalScoreScopeCounts)}`);
  console.log(`Record type counts: ${JSON.stringify(sourceNote.recordTypeCounts)}`);
  console.log(`Subject type counts: ${JSON.stringify(sourceNote.subjectTypeCounts)}`);
  console.log(`Score anomaly rows: ${anomalyRows.length}`);
  console.log(`Score range: ${JSON.stringify(sourceNote.scoreRange)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
