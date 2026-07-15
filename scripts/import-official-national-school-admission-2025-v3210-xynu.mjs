#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3210-xynu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3210-xynu";
const BASE_URL = "https://zs.xynu.edu.cn";
const INDEX_URL = `${BASE_URL}/index.htm`;

const PAGES = [
  {
    key: "henan-ordinary-2025",
    title: "信阳师范大学2025年河南省普通类专业录取分数统计表",
    url: `${BASE_URL}/info/1006/2818.htm`,
    raw: "2025-henan-ordinary.html",
    parser: "henanOrdinary",
  },
  {
    key: "henan-art-sports-2025",
    title: "信阳师范大学2025年河南省艺术体育类专业录取分数统计",
    url: `${BASE_URL}/info/1006/2817.htm`,
    raw: "2025-henan-art-sports.html",
    parser: "henanArtSports",
  },
  {
    key: "henan-local-public-teacher-2025",
    title: "信阳师范大学2025年地方公费师范生分数统计",
    url: `${BASE_URL}/info/1006/2816.htm`,
    raw: "2025-henan-local-public-teacher.html",
    parser: "henanLocalPublicTeacher",
  },
  {
    key: "outside-2025",
    title: "信阳师范大学2025年外省（区、市）录取分数统计",
    url: `${BASE_URL}/info/1006/2812.htm`,
    raw: "2025-outside.html",
    parser: "outside",
  },
];

const SOURCE = {
  id: "official-xynu-national-2025-school-major-admission",
  quality: "official-school-xynu-2025-national-html-score-rank",
  schoolCode: "10477",
  schoolName: "信阳师范大学",
  city: "信阳",
  tags: ["师范", "河南", "信阳", "信阳师范大学"],
};

const PROVINCE_ALIASES = new Map([
  ["北京市", "北京"],
  ["天津市", "天津"],
  ["河北省", "河北"],
  ["山西省", "山西"],
  ["内蒙古自治区", "内蒙古"],
  ["辽宁省", "辽宁"],
  ["吉林省", "吉林"],
  ["黑龙江省", "黑龙江"],
  ["上海市", "上海"],
  ["江苏省", "江苏"],
  ["浙江省", "浙江"],
  ["安徽省", "安徽"],
  ["福建省", "福建"],
  ["江西省", "江西"],
  ["山东省", "山东"],
  ["河南省", "河南"],
  ["湖北省", "湖北"],
  ["湖南省", "湖南"],
  ["广东省", "广东"],
  ["广西壮族自治区", "广西"],
  ["海南省", "海南"],
  ["重庆市", "重庆"],
  ["四川省", "四川"],
  ["贵州省", "贵州"],
  ["云南省", "云南"],
  ["西藏自治区", "西藏"],
  ["陕西省", "陕西"],
  ["甘肃省", "甘肃"],
  ["青海省", "青海"],
  ["宁夏回族自治区", "宁夏"],
  ["新疆维吾尔自治区", "新疆"],
  ["新疆维吾尔族自治区", "新疆"],
]);

const ART_PATTERN = /艺术|美术|音乐|舞蹈|播音|编导|表演|戏剧|影视|动画|视觉传达|环境设计|服装与服饰设计|产品设计|艺术设计|书法|摄影/;
const SPORTS_PATTERN = /体育|社会体育|运动训练/;
const SPECIAL_PATTERN = /地方公费|公费师范|优师|对口|单列|预科|定向|专项|民族|内高班|南疆|哈密/;
const COOP_PATTERN = /中外合作|合作办学|单列|较高收费|国际/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3210-xynu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3210-xynu.mjs --use-cache",
    "",
    "Imports 信阳师范大学招生信息网 official 2025 admission HTML tables.",
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

async function fetchText(url) {
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
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      if (text.length < 1000) throw new Error(`Unexpectedly short source (${text.length} chars) for ${url}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function downloadText(rawRoot, relPath, url, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const text = await fetchText(url);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text);
  return text;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
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

function extractTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function attrNumber(attrs, name, fallback = 1) {
  const match = String(attrs ?? "").match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Number(match[1]) : fallback;
}

function tableRows(tableHtml) {
  const rows = [];
  const spans = [];
  for (const rowMatch of String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = [];
    for (let col = 0; col < spans.length; col += 1) {
      if (spans[col]) {
        row[col] = spans[col].text;
        spans[col].remaining -= 1;
        if (spans[col].remaining <= 0) spans[col] = null;
      }
    }
    let col = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      while (row[col] != null) col += 1;
      const attrs = cellMatch[1] || "";
      const text = stripTags(cellMatch[2]);
      const rowspan = attrNumber(attrs, "rowspan", 1);
      const colspan = attrNumber(attrs, "colspan", 1);
      for (let offset = 0; offset < colspan; offset += 1) {
        row[col + offset] = text;
        if (rowspan > 1) spans[col + offset] = { text, remaining: rowspan - 1 };
      }
      col += colspan;
    }
    const cleaned = row.map((cell) => clean(cell));
    if (cleaned.some(Boolean)) rows.push(cleaned);
  }
  return rows;
}

function extractTables(html) {
  return [...String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match, index) => ({
    tableIndex: index,
    rows: tableRows(match[0]),
  })).filter((table) => table.rows.length);
}

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function firstNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function integerNumber(value) {
  const n = firstNumber(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeProvince(raw) {
  const text = clean(raw).replace(/\s+/g, "");
  const withoutCategory = text.replace(/[（(].*?[）)]/g, "");
  return PROVINCE_ALIASES.get(text)
    || PROVINCE_ALIASES.get(withoutCategory)
    || withoutCategory.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
}

function normalizeSubject(raw, context = "", province = "") {
  const text = [raw, context].map(clean).join(" ");
  if (ART_PATTERN.test(text)) return "艺术类";
  if (SPORTS_PATTERN.test(text)) return "体育类";
  if (/物料/.test(text)) return "物理类";
  if (/历史|文史|文科|历史科目组合/.test(text)) return "历史类";
  if (/物理|理工|理科|物理科目组合/.test(text)) return "物理类";
  if (/普通类|默认/.test(text) && ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合改革";
  if (/普通类|默认/.test(text)) return "官网未列科类";
  if (/综合/.test(text)) return "综合改革";
  return clean(raw).replace(/^[0-9A-Z]/, "") || "官网未列科类";
}

function normalizeBatch(raw) {
  const text = clean(raw).replace(/^[0-9A-Z]/, "");
  if (/专科|高职/.test(text)) return "高职（专科）批";
  if (/提前批/.test(text)) return text;
  if (/本科第二批|本科二批/.test(text)) return "本科二批";
  if (/本科第一批|本科一批/.test(text)) return "本科一批";
  if (/本科/.test(text)) return "本科批";
  return text || "官网未列批次";
}

function classifyAdmission(...parts) {
  const text = parts.map(clean).join(" ");
  if (SPORTS_PATTERN.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (ART_PATTERN.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (SPECIAL_PATTERN.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "地方公费/对口/单列/预科/定向等", formalScoreScope: "special-path-only" };
  }
  if (COOP_PATTERN.test(text)) {
    return { admissionType: "普通录取", admissionSubtype: "中外合作/单列专业", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function dataTypeFor(batch, majorName) {
  const text = [batch, majorName].map(clean).join(" ");
  if (/专科|高职/.test(text)) return "vocational-admission";
  return "major-admission";
}

function scoreMetric(classification, pageKey, dataType) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  if (pageKey === "outside-2025") return "学校官网投档成绩";
  if (dataType === "vocational-admission") return "高职专科学校官网录取分";
  return "高考文化分";
}

function makeRecord({
  page,
  rawRelPath,
  rowIndex,
  tableIndex = 0,
  province,
  sourceProvinceRaw,
  subjectType,
  sourceSubjectRaw,
  batch,
  sourceBatchRaw,
  majorName,
  majorGroup,
  minScore,
  minScoreRaw,
  maxScore,
  maxScoreRaw,
  minRank,
  minRankRaw,
  maxRank,
  maxRankRaw,
  controlLine,
  planCount,
  admissionCount,
  note,
  dataType,
  classification,
  sourceColumns,
  extra = {},
}) {
  const rankUnavailable = !Number.isFinite(minRank);
  const record = {
    id: `2025-xynu-${dataType.replace(/-admission$/, "")}-${stableId([
      page.key,
      province,
      sourceProvinceRaw,
      sourceSubjectRaw,
      sourceBatchRaw,
      majorName,
      minScoreRaw,
      minRankRaw,
      tableIndex,
      rowIndex,
    ])}`,
    province,
    sourceProvinceRaw,
    year: 2025,
    subjectType,
    sourceSubjectRaw,
    batch,
    sourceBatchRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType,
    majorName,
    majorGroup: majorGroup || [SOURCE.schoolName, province, subjectType, batch, majorName].filter(Boolean).join("-"),
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    minScore,
    scoreMetric: scoreMetric(classification, page.key, dataType),
    scoreOnly: rankUnavailable,
    rankUnavailable,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: rankUnavailable ? "single-school-score" : "single-school-score-rank",
    sourceUrl: page.url,
    sourcePageUrl: page.url,
    sourceIndexUrl: INDEX_URL,
    officialEvidencePath: rawRelPath,
    sourceHtmlPath: rawRelPath,
    sourcePageKey: page.key,
    sourcePageTitle: page.title,
    sourceMinScoreRaw: minScoreRaw,
    sourceMaxScoreRaw: maxScoreRaw,
    sourceRankRaw: minRankRaw,
    rawRow: {
      source: "xynu-2025-official-html-table",
      pageKey: page.key,
      tableIndex,
      rowIndex,
      sourceColumns,
    },
    cautions: [
      "本记录来自信阳师范大学招生信息网官方 2025 年录取分数 HTML 表，是单校分省/分专业录取边界，不是省级教育考试院全量投档/录取分数表。",
      rankUnavailable
        ? "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
        : "本行含学校官网公布的最低分位次，但仍是单校来源；推荐层只能用于信阳师范大学候选边界复核。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺体、地方公费师范生、对口、单列、预科、定向等特殊路径，运行层按 special-path-only 隔离，不与普通批文化分边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区、调剂规则和公费师范生协议要求复核。",
    ],
    ...extra,
  };
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(minRank)) {
    record.minRank = minRank;
    record.minRankStart = minRank;
    record.minRankEnd = minRank;
    record.rankRangeText = String(minRank);
  }
  if (Number.isFinite(maxRank)) record.maxRank = maxRank;
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (Number.isFinite(planCount)) record.planCount = planCount;
  if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
  if (note) record.sourceNoteRaw = note;
  if (maxRankRaw) record.sourceMaxRankRaw = maxRankRaw;
  return record;
}

function parseHenanOrdinary(page, tables, rawRelPath) {
  const rows = tables[0]?.rows || [];
  const records = [];
  const skippedRows = [];
  rows.slice(1).forEach((row, index) => {
    const rowIndex = index + 1;
    const majorName = clean(row[0]);
    const sourceSubjectRaw = clean(row[1]);
    const majorGroup = clean(row[2]);
    const maxScoreRaw = clean(row[3]);
    const maxRankRaw = clean(row[4]);
    const minScoreRaw = clean(row[5]);
    const minRankRaw = clean(row[6]);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !sourceSubjectRaw || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, row });
      return;
    }
    const classification = classifyAdmission(majorName, sourceSubjectRaw, majorGroup);
    const batch = classification.formalScoreScope === "special-path-only" ? "特殊类型批次" : "本科批";
    records.push(makeRecord({
      page,
      rawRelPath,
      rowIndex,
      province: "河南",
      sourceProvinceRaw: "河南省",
      subjectType: normalizeSubject(sourceSubjectRaw, majorName, "河南"),
      sourceSubjectRaw,
      batch,
      sourceBatchRaw: [majorGroup, sourceSubjectRaw].filter(Boolean).join(" "),
      majorName,
      majorGroup,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      minRank: integerNumber(minRankRaw),
      minRankRaw,
      maxRank: integerNumber(maxRankRaw),
      maxRankRaw,
      dataType: "major-admission",
      classification,
      sourceColumns: row,
    }));
  });
  return { records, skippedRows };
}

function parseHenanArtSports(page, tables, rawRelPath) {
  const rows = tables[0]?.rows || [];
  const records = [];
  const skippedRows = [];
  rows.slice(2).forEach((row, index) => {
    const rowIndex = index + 2;
    const majorName = clean(row[0]);
    const sourceSubjectRaw = clean(row[1]);
    const cultureMaxRaw = clean(row[2]);
    const cultureMinRaw = clean(row[3]);
    const professionalMaxRaw = clean(row[4]);
    const professionalMinRaw = clean(row[5]);
    const maxScoreRaw = clean(row[6]);
    const minScoreRaw = clean(row[7]);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !sourceSubjectRaw || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, row });
      return;
    }
    const classification = classifyAdmission(majorName, sourceSubjectRaw, page.title);
    records.push(makeRecord({
      page,
      rawRelPath,
      rowIndex,
      province: "河南",
      sourceProvinceRaw: "河南省",
      subjectType: normalizeSubject(sourceSubjectRaw, majorName, "河南"),
      sourceSubjectRaw,
      batch: classification.admissionType === "体育类录取" ? "体育类本科批" : "艺术类本科批",
      sourceBatchRaw: page.title,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      minRank: null,
      minRankRaw: "",
      dataType: "major-admission",
      classification,
      sourceColumns: row,
      extra: {
        cultureMinScore: parseNumber(cultureMinRaw),
        cultureMaxScore: parseNumber(cultureMaxRaw),
        professionalMinScore: parseNumber(professionalMinRaw),
        professionalMaxScore: parseNumber(professionalMaxRaw),
        sourceCultureMinRaw: cultureMinRaw,
        sourceProfessionalMinRaw: professionalMinRaw,
      },
    }));
  });
  return { records, skippedRows };
}

function parseHenanLocalPublicTeacher(page, tables, rawRelPath) {
  const records = [];
  const skippedRows = [];
  const rankRows = tables[0]?.rows || [];
  rankRows.slice(1).forEach((row, index) => {
    const rowIndex = index + 1;
    const majorName = clean(row[0]);
    const categoryRaw = clean(row[1]);
    const sourceSubjectRaw = clean(row[2]);
    const maxScoreRaw = clean(row[3]);
    const maxRankRaw = clean(row[4]);
    const minScoreRaw = clean(row[5]);
    const minRankRaw = clean(row[6]);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !categoryRaw || !sourceSubjectRaw || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, tableIndex: 0, rowIndex, row });
      return;
    }
    const classification = classifyAdmission(majorName, categoryRaw, sourceSubjectRaw);
    records.push(makeRecord({
      page,
      rawRelPath,
      tableIndex: 0,
      rowIndex,
      province: "河南",
      sourceProvinceRaw: "河南省",
      subjectType: normalizeSubject(sourceSubjectRaw, majorName, "河南"),
      sourceSubjectRaw,
      batch: "地方公费师范生",
      sourceBatchRaw: categoryRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      minRank: integerNumber(minRankRaw),
      minRankRaw,
      maxRank: integerNumber(maxRankRaw),
      maxRankRaw,
      dataType: "major-admission",
      classification,
      sourceColumns: row,
      extra: { candidateCategory: categoryRaw },
    }));
  });

  const artRows = tables[1]?.rows || [];
  artRows.slice(3).forEach((row, index) => {
    const rowIndex = index + 3;
    const majorName = clean(row[0]);
    const categoryRaw = clean(row[1]);
    const sourceSubjectRaw = clean(row[2]);
    const cultureMaxRaw = clean(row[3]);
    const cultureMinRaw = clean(row[4]);
    const professionalMaxRaw = clean(row[5]);
    const professionalMinRaw = clean(row[6]);
    const maxScoreRaw = clean(row[7]);
    const minScoreRaw = clean(row[8]);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !categoryRaw || !sourceSubjectRaw || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, tableIndex: 1, rowIndex, row });
      return;
    }
    const classification = classifyAdmission(majorName, categoryRaw, sourceSubjectRaw, "艺术类公费师范生");
    records.push(makeRecord({
      page,
      rawRelPath,
      tableIndex: 1,
      rowIndex,
      province: "河南",
      sourceProvinceRaw: "河南省",
      subjectType: normalizeSubject(sourceSubjectRaw, [majorName, categoryRaw].join(" "), "河南"),
      sourceSubjectRaw,
      batch: "艺术类地方公费师范生",
      sourceBatchRaw: categoryRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      minRank: null,
      minRankRaw: "",
      dataType: "major-admission",
      classification,
      sourceColumns: row,
      extra: {
        candidateCategory: categoryRaw,
        cultureMinScore: parseNumber(cultureMinRaw),
        cultureMaxScore: parseNumber(cultureMaxRaw),
        professionalMinScore: parseNumber(professionalMinRaw),
        professionalMaxScore: parseNumber(professionalMaxRaw),
      },
    }));
  });
  return { records, skippedRows };
}

function parseOutside(page, tables, rawRelPath) {
  const rows = tables[0]?.rows || [];
  const records = [];
  const skippedRows = [];
  rows.slice(2).forEach((row, index) => {
    const rowIndex = index + 2;
    const sourceProvinceRaw = clean(row[0]);
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(row[1]);
    const sourceBatchRaw = clean(row[2]);
    const sourceSubjectRaw = clean(row[3]).replace(/^[0-9A-Z]/, "");
    const cultureMaxRaw = clean(row[4]);
    const cultureMinRaw = clean(row[5]);
    const professionalMaxRaw = clean(row[6]);
    const professionalMinRaw = clean(row[7]);
    const maxScoreRaw = clean(row[8]);
    const minScoreRaw = clean(row[9]);
    const minScore = parseNumber(minScoreRaw);
    if (!province || !majorName || !sourceBatchRaw || !sourceSubjectRaw || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, row });
      return;
    }
    const classification = classifyAdmission(sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw, majorName);
    const batch = normalizeBatch(sourceBatchRaw);
    const dataType = dataTypeFor(batch, majorName);
    records.push(makeRecord({
      page,
      rawRelPath,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, [sourceBatchRaw, majorName].join(" "), province),
      sourceSubjectRaw,
      batch,
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      minRank: null,
      minRankRaw: "",
      dataType,
      classification,
      sourceColumns: row,
      extra: {
        cultureMinScore: parseNumber(cultureMinRaw),
        cultureMaxScore: parseNumber(cultureMaxRaw),
        professionalMinScore: parseNumber(professionalMinRaw),
        professionalMaxScore: parseNumber(professionalMaxRaw),
      },
    }));
  });
  return { records, skippedRows };
}

function parsePage(page, html, rawRelPath) {
  const tables = extractTables(html);
  if (!tables.length) return { records: [], skippedRows: [{ reason: "no-table", page: page.key, rawRelPath }], tables };
  if (page.parser === "henanOrdinary") return { ...parseHenanOrdinary(page, tables, rawRelPath), tables };
  if (page.parser === "henanArtSports") return { ...parseHenanArtSports(page, tables, rawRelPath), tables };
  if (page.parser === "henanLocalPublicTeacher") return { ...parseHenanLocalPublicTeacher(page, tables, rawRelPath), tables };
  if (page.parser === "outside") return { ...parseOutside(page, tables, rawRelPath), tables };
  throw new Error(`Unknown parser: ${page.parser}`);
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || "";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

function scoreRange(records) {
  const scores = records.map((record) => record.minScore).filter(Number.isFinite);
  return scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : { min: null, max: null };
}

function rankRange(records) {
  const ranks = records.map((record) => record.minRankEnd).filter(Number.isFinite);
  return ranks.length ? { min: Math.min(...ranks), max: Math.max(...ranks) } : { min: null, max: null };
}

function duplicateIds(records) {
  const seen = new Set();
  const dupes = [];
  for (const record of records) {
    if (seen.has(record.id)) dupes.push(record.id);
    seen.add(record.id);
  }
  return dupes;
}

async function main() {
  const args = parseArgs(process.argv);
  guardProjectRoot();
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const records = [];
  const skippedRows = [];
  const pageSummaries = [];
  for (const page of PAGES) {
    const html = await downloadText(rawRoot, page.raw, page.url, args.useCache);
    const rawRelPath = `${RAW_DIR}/${page.raw}`;
    const parsed = parsePage(page, html, rawRelPath);
    records.push(...parsed.records);
    skippedRows.push(...parsed.skippedRows.map((row) => ({ ...row, rawPath: rawRelPath })));
    pageSummaries.push({
      key: page.key,
      title: page.title,
      officialTitle: extractTitle(html),
      url: page.url,
      rawPath: rawRelPath,
      tableCount: parsed.tables.length,
      tableRows: parsed.tables.map((table) => table.rows.length),
      parsedRecords: parsed.records.length,
      skippedRows: parsed.skippedRows.length,
      sha256: sha256File(path.join(rawRoot, page.raw)),
    });
  }

  const dupes = duplicateIds(records);
  if (dupes.length) throw new Error(`Duplicate record ids: ${dupes.slice(0, 5).join(", ")}`);
  const badScores = records.filter((record) => !Number.isFinite(record.minScore) || record.minScore <= 0 || record.minScore > 750);
  if (badScores.length) throw new Error(`Bad minScore rows: ${badScores.slice(0, 5).map((record) => `${record.id}:${record.minScore}`).join(", ")}`);
  const badOrdinary = records.filter((record) => record.formalScoreScope === "school-official-only" && record.minScore < 100);
  if (badOrdinary.length) throw new Error(`Implausible ordinary scores: ${badOrdinary.slice(0, 5).map((record) => `${record.id}:${record.minScore}`).join(", ")}`);
  const badRanks = records.filter((record) => record.rankUnavailable === false && (!Number.isInteger(record.minRankEnd) || record.minRankEnd <= 0));
  if (badRanks.length) throw new Error(`Bad rank rows: ${badRanks.slice(0, 5).map((record) => `${record.id}:${record.minRankEnd}`).join(", ")}`);

  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const recordsWithRank = records.filter((record) => !record.rankUnavailable).length;
  const sourceNote = {
    id: SOURCE.id,
    title: "信阳师范大学招生信息网：2025年录取分数官方 HTML 表",
    publisher: "信阳师范大学招生信息网",
    url: INDEX_URL,
    quality: SOURCE.quality,
    usage: "从信阳师范大学招生信息网官方页面下载 2025 年河南普通类、河南艺术体育类、地方公费师范生和外省（区、市）录取分数 HTML 表，抽取单校分省分专业最低录取/投档成绩、最高分、最低位次和艺体综合分等字段。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: provincesWithRecords.length,
    provincesWithRecords,
    pageSummaries,
    rawDir: RAW_DIR,
    rawFiles: PAGES.map((page) => ({
      path: `${RAW_DIR}/${page.raw}`,
      url: page.url,
      sha256: sha256File(path.join(rawRoot, page.raw)),
    })),
    recordTypeCounts: countBy(records, (record) => record.dataType),
    formalScoreScopeCounts: countBy(records, (record) => record.formalScoreScope),
    admissionTypeCounts: countBy(records, (record) => record.admissionType),
    admissionSubtypeCounts: countBy(records, (record) => record.admissionSubtype),
    subjectTypeCounts: countBy(records, (record) => record.subjectType),
    recordsByProvince: countBy(records, (record) => record.province),
    recordsWithRank,
    recordsWithoutRank: records.length - recordsWithRank,
    scoreRange: scoreRange(records),
    ordinarySchoolOfficialScoreRange: scoreRange(records.filter((record) => record.formalScoreScope === "school-official-only")),
    specialPathScoreRange: scoreRange(records.filter((record) => record.formalScoreScope === "special-path-only")),
    rankRange: rankRange(records),
    cautions: [
      "信阳师范大学官网单校分数/位次只用于该校候选边界复核，不替代各省教育考试院全量投档/录取分数表。",
      "源表仅部分河南普通类和地方公费师范生记录公开最低位次；外省和艺体记录未公开最低位次，运行层不生成假位次。",
      "艺术、体育、地方公费师范生、对口、单列、预科、定向等特殊路径按 special-path-only 隔离。",
      "正式填报前必须回省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区、调剂范围和公费师范生协议要求复核。",
    ],
  };

  const payload = {
    sourceNotes: [sourceNote],
    skippedRows,
    pageSummaries,
    records,
  };
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    out: args.out,
    rawDir: RAW_DIR,
    records: records.length,
    skippedRows: skippedRows.length,
    provincesWithRecords: provincesWithRecords.length,
    recordsWithRank,
    pageSummaries,
    recordTypeCounts: sourceNote.recordTypeCounts,
    formalScoreScopeCounts: sourceNote.formalScoreScopeCounts,
    admissionTypeCounts: sourceNote.admissionTypeCounts,
    admissionSubtypeCounts: sourceNote.admissionSubtypeCounts,
    subjectTypeCounts: sourceNote.subjectTypeCounts,
    scoreRange: sourceNote.scoreRange,
    ordinarySchoolOfficialScoreRange: sourceNote.ordinarySchoolOfficialScoreRange,
    specialPathScoreRange: sourceNote.specialPathScoreRange,
    rankRange: sourceNote.rankRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
