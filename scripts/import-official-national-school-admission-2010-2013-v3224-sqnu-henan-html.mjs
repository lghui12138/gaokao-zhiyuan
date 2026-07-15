#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2010-2013-v3224-sqnu-henan-html-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2010-2013-v3224-sqnu-henan-html";
const BASE_URL = "https://zhaoban.sqnu.edu.cn";
const INDEX_URLS = [`${BASE_URL}/lqfs/3.htm`, `${BASE_URL}/lqfs/2.htm`];

const PAGES = [
  {
    key: "henan-vocational-2013",
    year: 2013,
    title: "2013河南专科专业最低分",
    url: `${BASE_URL}/info/1005/1220.htm`,
    indexUrl: INDEX_URLS[0],
    rawBase: "2013-henan-vocational",
    parser: "collegeMajorMinTable",
    sourceBatchRaw: "河南专科",
    expectedRecords: 15,
  },
  {
    key: "henan-art-international-2013",
    year: 2013,
    title: "商丘师范学院2013年国际通识艺术各专业最低分",
    url: `${BASE_URL}/info/1005/1221.htm`,
    indexUrl: INDEX_URLS[0],
    rawBase: "2013-henan-art-international",
    parser: "artVolunteerTable",
    sourceBatchRaw: "国际通识艺术本科",
    expectedRecords: 11,
  },
  {
    key: "henan-art-2013",
    year: 2013,
    title: "商丘师范学院2013年河南艺术各专业最低分",
    url: `${BASE_URL}/info/1005/1222.htm`,
    indexUrl: INDEX_URLS[0],
    rawBase: "2013-henan-art",
    parser: "artVolunteerTable",
    sourceBatchRaw: "河南艺术本科",
    expectedRecords: 35,
  },
  {
    key: "henan-sports-2013",
    year: 2013,
    title: "2013年我校河南省体育类各专业录取分数线",
    url: `${BASE_URL}/info/1005/1223.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2013-henan-sports",
    parser: "sportsTwoColumnTable",
    sourceBatchRaw: "河南体育本科",
    expectedRecords: 4,
  },
  {
    key: "henan-upgrade-2013",
    year: 2013,
    title: "2013年我校专升本录取最低线",
    url: `${BASE_URL}/info/1005/1224.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2013-henan-upgrade",
    parser: "upgradeTwoColumnTable",
    sourceBatchRaw: "专升本",
    expectedRecords: 21,
  },
  {
    key: "henan-ordinary-2012",
    year: 2012,
    title: "2012普通文理最高最低分",
    url: `${BASE_URL}/info/1005/1225.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2012-henan-ordinary",
    parser: "institutionHighLowTable",
    sourceBatchRaw: "河南普通文理本科",
    expectedRecords: 2,
  },
  {
    key: "henan-vocational-2012",
    year: 2012,
    title: "2012年河南省专科各专业最低分",
    url: `${BASE_URL}/info/1005/1226.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2012-henan-vocational",
    parser: "majorHighLowTable",
    sourceBatchRaw: "河南专科",
    expectedRecords: 12,
  },
  {
    key: "henan-art-science-2012",
    year: 2012,
    title: "2012年我校河南省艺术理各专业最低分",
    url: `${BASE_URL}/info/1005/1228.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2012-henan-art-science",
    parser: "codeMajorHighLowTable",
    sourceSubjectRaw: "艺术理",
    sourceBatchRaw: "河南艺术本科",
    expectedRecords: 13,
  },
  {
    key: "henan-upgrade-2011",
    year: 2011,
    title: "2011年我校专升本各专业最低分",
    url: `${BASE_URL}/info/1005/1233.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2011-henan-upgrade",
    parser: "upgradeTwoColumnTable",
    sourceBatchRaw: "专升本",
    expectedRecords: 19,
  },
  {
    key: "henan-vocational-2010",
    year: 2010,
    title: "2010年我校专科各专业最低分",
    url: `${BASE_URL}/info/1005/1240.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2010-henan-vocational",
    parser: "simpleMajorMinTable",
    sourceBatchRaw: "河南专科",
    expectedRecords: 14,
  },
  {
    key: "henan-upgrade-2010",
    year: 2010,
    title: "2010年专升本各专业最低分",
    url: `${BASE_URL}/info/1005/1241.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2010-henan-upgrade",
    parser: "upgradeTwoColumnTable",
    sourceBatchRaw: "专升本",
    expectedRecords: 24,
  },
  {
    key: "henan-undergraduate-2010",
    year: 2010,
    title: "2010年省内本科各专业分数线",
    url: `${BASE_URL}/info/1005/1242.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2010-henan-undergraduate",
    parser: "undergraduateRemarkTable",
    sourceBatchRaw: "河南省内本科",
    expectedRecords: 21,
  },
];

const RAW_ONLY_PAGES = [
  {
    key: "henan-sports-2012-raw-only",
    year: 2012,
    title: "2012年我校体育各专业最低分",
    url: `${BASE_URL}/info/1005/1227.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2012-henan-sports-raw-only",
    reason: "official HTML body exposes only the table header token, with no parseable major/score rows",
  },
  {
    key: "henan-art-liberal-2012-raw-only",
    year: 2012,
    title: "2012年我校河南省艺术文各专业最低分",
    url: `${BASE_URL}/info/1005/1229.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2012-henan-art-liberal-raw-only",
    reason: "official HTML body exposes only the table header token, with no parseable major/score rows",
  },
  {
    key: "henan-upgrade-2012-raw-only",
    year: 2012,
    title: "2012年我校专升本各专业最低分",
    url: `${BASE_URL}/info/1005/1230.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2012-henan-upgrade-raw-only",
    reason: "official HTML body exposes only the table header token, with no parseable major/score rows",
  },
  {
    key: "henan-science-2011-raw-only",
    year: 2011,
    title: "2011年我校省内理科录取各专业最低分",
    url: `${BASE_URL}/info/1005/1231.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2011-henan-science-raw-only",
    reason: "official HTML body exposes only the table header token, with no parseable major/score rows",
  },
  {
    key: "henan-liberal-2011-raw-only",
    year: 2011,
    title: "2011年我校省内文科录取各专业最低分",
    url: `${BASE_URL}/info/1005/1232.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2011-henan-liberal-raw-only",
    reason: "official HTML body exposes only the table header token, with no parseable major/score rows",
  },
  {
    key: "henan-art-2010-raw-only",
    year: 2010,
    title: "我校2010年河南省内艺术类录取最低分数线",
    url: `${BASE_URL}/info/1005/1243.htm`,
    indexUrl: INDEX_URLS[1],
    rawBase: "2010-henan-art-raw-only",
    reason: "official HTML body exposes only the table header token, with no parseable major/score rows",
  },
];

const SOURCE = {
  id: "official-sqnu-national-2010-2013-school-henan-html-admission",
  quality: "official-school-sqnu-2010-2013-henan-html-score",
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
    `  node scripts/import-official-national-school-admission-2010-2013-v3224-sqnu-henan-html.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2010-2013-v3224-sqnu-henan-html.mjs --use-cache",
    "",
    "Imports parseable official SQNU 2010-2013 Henan HTML score tables and preserves raw-only empty-body pages as skipped evidence.",
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

async function fetchBuffer(url, referer) {
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
  const html = (await fetchBuffer(page.url, page.indexUrl)).toString("utf8").replace(/\0/g, "");
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

function parseScoreNumber(value) {
  const exact = parseNumber(value);
  if (Number.isFinite(exact)) return exact;
  const match = clean(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
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
    .replace(/[（(]\s*(本科|专科|专升本|二专|文|理)\s*[）)]/g, "")
    .replace(/[（(]\s*(专业分|专业\+文化分|主项)\s*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim();
}

function scoreDetail(rawScore, remark = "") {
  const details = [];
  if (/主项/.test(clean(rawScore))) details.push("主项");
  if (/专业\+文化分/.test(clean(remark))) details.push("专业+文化分");
  else if (/专业分/.test(clean(remark))) details.push("专业分");
  return details.join("；");
}

function inferBatch(rawMajor, sourceBatchRaw, remark = "") {
  const text = [rawMajor, sourceBatchRaw, remark].map(clean).join(" ");
  if (/专升本/.test(text)) return "专升本批";
  if (/专科|高职|二专|河南专科/.test(text)) return "高职（专科）批";
  if (SPORTS_PATTERN.test(text)) return "体育本科批";
  if (ART_PATTERN.test(text) || /艺术/.test(text)) return "艺术本科批";
  return "本科二批";
}

function dataTypeFor(batch, explicit = "") {
  if (explicit) return explicit;
  if (/专科|高职/.test(batch)) return "vocational-admission";
  return "major-admission";
}

function classifyAdmission(sourceSubjectRaw, sourceBatchRaw, rawMajor, majorName, college = "", remark = "") {
  const text = [sourceSubjectRaw, sourceBatchRaw, rawMajor, majorName, college, remark].map(clean).join(" ");
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
  sourceSubjectRaw = "",
  sourceBatchRaw,
  rawMajor,
  minScoreRaw,
  maxScoreRaw = "",
  sourceMinScoreRawOverride = "",
  college = "",
  dataTypeOverride = "",
  sourceVolunteerRaw = "",
  sourceMajorCodeRaw = "",
  remark = "",
  rawRow,
}) {
  const minScore = parseScoreNumber(minScoreRaw);
  const maxScore = parseScoreNumber(maxScoreRaw);
  const majorName = normalizeMajorName(rawMajor);
  const batch = inferBatch(rawMajor, sourceBatchRaw, remark);
  const dataType = dataTypeFor(batch, dataTypeOverride);
  const classification = classifyAdmission(sourceSubjectRaw, sourceBatchRaw, rawMajor, majorName, college, remark);
  const subjectType = normalizeSubject(sourceSubjectRaw);
  const majorGroup = [SOURCE.schoolName, "河南", subjectType, batch, college, majorName].filter(Boolean).join("-");
  const detail = scoreDetail(minScoreRaw, remark);
  const record = {
    id: `${page.year}-sqnu-${dataType.replace(/-admission$/, "")}-${stableId([
      page.key,
      sourceSubjectRaw,
      sourceBatchRaw,
      college,
      rawMajor,
      minScoreRaw,
      maxScoreRaw,
      sourceVolunteerRaw,
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
    sourceIndexUrl: page.indexUrl,
    officialEvidencePath: rawHtmlRel,
    sourceHtmlPath: rawHtmlRel,
    sourcePageKey: page.key,
    sourcePageTitle: page.title,
    sourceMajorNameRaw: rawMajor,
    sourceMinScoreRaw: sourceMinScoreRawOverride || minScoreRaw,
    rawRow: {
      source: `sqnu-${page.year}-official-html-table-v3224`,
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
  if (college) record.college = college;
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (maxScoreRaw) record.sourceMaxScoreRaw = maxScoreRaw;
  if (sourceMinScoreRawOverride) record.sourceParsedMinScoreRaw = minScoreRaw;
  if (sourceVolunteerRaw) record.sourceVolunteerRaw = sourceVolunteerRaw;
  if (sourceMajorCodeRaw) record.sourceMajorCodeRaw = sourceMajorCodeRaw;
  if (remark) record.sourceRemarkRaw = remark;
  if (detail) record.sourceScoreDetailRaw = detail;
  if (classification.admissionSubtype === "专升本") record.candidateCategory = "专升本";
  return record;
}

function isFooterRow(row) {
  const text = row.map(clean).join("|");
  return !text || /上一条|下一条|招生办公众号|招生手机网|招生信息网|阳光招生|当前位置：/.test(text);
}

function isSubjectCell(value) {
  return /^(文科|理科|艺术文|艺术理|体育文|体育理)$/.test(clean(value));
}

function parseCollegeMajorMinTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  let college = "";
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.includes("院系") && cells.includes("专业") && cells.includes("最低分")) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length < 3) return;
    if (cells[0]) college = cells[0];
    const rawMajor = cells[1];
    const minScoreRaw = cells[2];
    if (!rawMajor || !Number.isFinite(parseScoreNumber(minScoreRaw))) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({ page, rawHtmlRel, rowIndex, sourceBatchRaw: page.sourceBatchRaw, rawMajor, minScoreRaw, college, rawRow: row }));
  });
  return { records, skippedRows };
}

function parseArtVolunteerTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  let sourceSubjectRaw = "";
  let rawMajor = "";
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.includes("科类") && cells.includes("专业") && (cells.includes("志愿") || cells.includes("最低分"))) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length < 3) return;
    let volunteer = "";
    let minScoreRaw = "";
    if (cells.length >= 4) {
      if (isSubjectCell(cells[0])) sourceSubjectRaw = cells[0];
      if (cells[1]) rawMajor = cells[1];
      volunteer = cells[2];
      minScoreRaw = cells[3];
    } else {
      if (isSubjectCell(cells[0])) {
        sourceSubjectRaw = cells[0];
        rawMajor = cells[1] || rawMajor;
        minScoreRaw = cells[2];
      } else {
        if (cells[0]) rawMajor = cells[0];
        volunteer = cells[1];
        minScoreRaw = cells[2];
      }
    }
    if (!rawMajor || !Number.isFinite(parseScoreNumber(minScoreRaw))) {
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
      sourceVolunteerRaw: volunteer,
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parseSportsTwoColumnTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.includes("专业") && cells.includes("最低分")) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length !== 2) return;
    const suffix = cells[0].match(/[（(]\s*(文|理)\s*[）)]\s*$/);
    const sourceSubjectRaw = suffix ? `${suffix[1]}科` : "";
    const rawMajor = suffix ? cells[0].replace(/[（(]\s*(文|理)\s*[）)]\s*$/, "") : cells[0];
    const minScoreRaw = cells[1];
    if (!rawMajor || !Number.isFinite(parseScoreNumber(minScoreRaw))) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({ page, rawHtmlRel, rowIndex, sourceSubjectRaw, sourceBatchRaw: page.sourceBatchRaw, rawMajor, minScoreRaw, rawRow: row }));
  });
  return { records, skippedRows };
}

function parseUpgradeTwoColumnTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.some((cell) => /专业/.test(cell)) && cells.some((cell) => /最低分/.test(cell))) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length !== 2) return;
    const rawMajor = cells[0];
    const minScoreRaw = cells[1];
    if (!/专升本/.test(rawMajor)) return;
    if (!Number.isFinite(parseScoreNumber(minScoreRaw))) {
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

function parseInstitutionHighLowTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.some((cell) => /科类/.test(cell)) && cells.includes("最高分") && cells.includes("最低分")) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length !== 3) return;
    const sourceSubjectRaw = cells[0];
    const maxScoreRaw = cells[1];
    const minScoreRaw = cells[2];
    if (!isSubjectCell(sourceSubjectRaw) || !Number.isFinite(parseScoreNumber(minScoreRaw))) {
      skippedRows.push({ reason: "missing-subject-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw,
      sourceBatchRaw: page.sourceBatchRaw,
      rawMajor: "全校普通文理汇总(本科)",
      minScoreRaw,
      maxScoreRaw,
      dataTypeOverride: "institution-admission",
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parseMajorHighLowTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.includes("专业") && cells.includes("最高分") && cells.includes("最低分")) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length !== 3) return;
    const [rawMajor, maxScoreRaw, minScoreRaw] = cells;
    if (!rawMajor || !Number.isFinite(parseScoreNumber(minScoreRaw))) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({ page, rawHtmlRel, rowIndex, sourceBatchRaw: page.sourceBatchRaw, rawMajor, minScoreRaw, maxScoreRaw, rawRow: row }));
  });
  return { records, skippedRows };
}

function parseCodeMajorHighLowTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.includes("专业代码") && cells.includes("专业名称") && cells.includes("最高分") && cells.includes("最低分")) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length !== 4) return;
    const [sourceMajorCodeRaw, rawMajor, maxScoreRaw, minScoreRaw] = cells;
    if (!rawMajor || !Number.isFinite(parseScoreNumber(minScoreRaw))) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceSubjectRaw: page.sourceSubjectRaw || "",
      sourceBatchRaw: page.sourceBatchRaw,
      rawMajor,
      minScoreRaw,
      maxScoreRaw,
      sourceMajorCodeRaw,
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function splitDualSubjectScore(raw) {
  const match = clean(raw).match(/(\d+(?:\.\d+)?)\s*[（(]\s*文\s*[）)]\s*(\d+(?:\.\d+)?)\s*[（(]\s*理\s*[）)]/);
  return match ? [{ subject: "文科", score: match[1] }, { subject: "理科", score: match[2] }] : null;
}

function parseSimpleMajorMinTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.some((cell) => /专业/.test(cell)) && cells.some((cell) => /最低分/.test(cell))) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length !== 2) return;
    const rawMajor = cells[0];
    const minScoreRaw = cells[1];
    const splitScores = splitDualSubjectScore(minScoreRaw);
    const sourceRows = splitScores || [{ subject: page.sourceSubjectRaw || "", score: minScoreRaw }];
    for (const scoreRow of sourceRows) {
      if (!rawMajor || !Number.isFinite(parseScoreNumber(scoreRow.score))) {
        skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
        continue;
      }
      records.push(makeRecord({
        page,
        rawHtmlRel,
        rowIndex,
        sourceSubjectRaw: scoreRow.subject,
        sourceBatchRaw: page.sourceBatchRaw,
        rawMajor,
        minScoreRaw: scoreRow.score,
        sourceMinScoreRawOverride: splitScores ? minScoreRaw : "",
        rawRow: row,
      }));
    }
  });
  return { records, skippedRows };
}

function parseUndergraduateRemarkTable(page, rows, rawHtmlRel) {
  const records = [];
  const skippedRows = [];
  let inTable = false;
  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const cells = row.map(clean);
    if (cells.includes("专业名称") && cells.includes("最低分") && cells.includes("备注")) {
      inTable = true;
      return;
    }
    if (!inTable || isFooterRow(cells) || cells.length < 2) return;
    const rawMajor = cells[0];
    const minScoreRaw = cells[1];
    const remark = cells[2] || "";
    if (!rawMajor || !Number.isFinite(parseScoreNumber(minScoreRaw))) {
      skippedRows.push({ reason: "missing-major-or-score", page: page.key, rowIndex, row });
      return;
    }
    records.push(makeRecord({
      page,
      rawHtmlRel,
      rowIndex,
      sourceBatchRaw: page.sourceBatchRaw,
      rawMajor,
      minScoreRaw,
      remark,
      rawRow: row,
    }));
  });
  return { records, skippedRows };
}

function parsePage(page, rows, rawHtmlRel) {
  if (page.parser === "collegeMajorMinTable") return parseCollegeMajorMinTable(page, rows, rawHtmlRel);
  if (page.parser === "artVolunteerTable") return parseArtVolunteerTable(page, rows, rawHtmlRel);
  if (page.parser === "sportsTwoColumnTable") return parseSportsTwoColumnTable(page, rows, rawHtmlRel);
  if (page.parser === "upgradeTwoColumnTable") return parseUpgradeTwoColumnTable(page, rows, rawHtmlRel);
  if (page.parser === "institutionHighLowTable") return parseInstitutionHighLowTable(page, rows, rawHtmlRel);
  if (page.parser === "majorHighLowTable") return parseMajorHighLowTable(page, rows, rawHtmlRel);
  if (page.parser === "codeMajorHighLowTable") return parseCodeMajorHighLowTable(page, rows, rawHtmlRel);
  if (page.parser === "simpleMajorMinTable") return parseSimpleMajorMinTable(page, rows, rawHtmlRel);
  if (page.parser === "undergraduateRemarkTable") return parseUndergraduateRemarkTable(page, rows, rawHtmlRel);
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

  const sourceNote = {
    id: SOURCE.id,
    title: "商丘师范学院招生信息网：2010-2013年河南普通、专科、艺体和专升本官方 HTML 分数表",
    publisher: "商丘师范学院招生信息网",
    publishedAt: "2014-06-26",
    url: INDEX_URLS[1],
    urls: INDEX_URLS,
    quality: SOURCE.quality,
    usage: "从商丘师范学院招生信息网官方“录取分数”栏目下载 2010-2013 年河南普通文理、专科、艺术、体育、专升本和本科专业分数 HTML 页面，抽取有明确专业/科类与最低分的单校录取边界；只露出空表头或无可解析分数行的旧页保存 raw 证据但不入运行层。",
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
    recordsWithRank: 0,
    recordsRankUnavailable: records.length,
    scoreRange: rangeOf(records, "minScore"),
    ordinarySchoolOfficialScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "school-official-only"), "minScore"),
    specialPathScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "special-path-only"), "minScore"),
    rankRange: null,
    boundaryNotes: [
      "商丘师范学院单校官网分数只用于该校候选边界复核，不替代省级教育考试院全量投档/录取分数表。",
      "本轮只导入有明确专业或学校层汇总、明确最低分的 HTML 表行；计划页、控制线页、空表头页和无正文分数行旧页不作为录取边界。",
      "2010 年省内本科页、2010/2012/2013 部分专科页未逐行公开文理科类；运行层用 subjectType=官网未列科类 保存，不推断文/理。",
      "2012 普通文理最高最低分页作为 institution-admission 学校层汇总保留，不当作分专业边界。",
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
    parserVersion: "v3224-sqnu-html-2010-2013-henan-01",
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${records.length} records -> ${args.out}`);
  console.log(`Skipped rows: ${skippedRows.length}`);
  console.log(`Raw-only pages: ${rawOnlyPageSummaries.length}`);
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
