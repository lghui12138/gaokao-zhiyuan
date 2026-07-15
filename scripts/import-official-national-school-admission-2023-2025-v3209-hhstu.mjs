#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2023-2025-v3209-hhstu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2023-2025-v3209-hhstu";
const BASE_URL = "https://zs.hhstu.edu.cn";
const INDEX_URL = `${BASE_URL}/lntj.htm`;

const PAGES = [
  {
    key: "outside2025",
    year: 2025,
    title: "2025年黄河科技学院省外录取分数统计",
    url: `${BASE_URL}/info/1010/6835.htm`,
    raw: "2025-outside-major.html",
    parser: "outside2025",
  },
  {
    key: "henan2025",
    year: 2025,
    title: "2025年河南省普通类、艺术类分专业录取分数统计",
    url: `${BASE_URL}/info/1010/6825.htm`,
    raw: "2025-henan-major.html",
    parser: "henan2025",
  },
  {
    key: "henan2024",
    year: 2024,
    title: "2024年河南省普通类、艺术类分专业录取分数统计",
    url: `${BASE_URL}/info/1010/6694.htm`,
    raw: "2024-henan-major.html",
    parser: "henanOldDual",
  },
  {
    key: "henan2023",
    year: 2023,
    title: "2023年河南省普通类、艺术类分专业录取分数统计",
    url: `${BASE_URL}/info/1010/6675.htm`,
    raw: "2023-henan-major.html",
    parser: "henanOldDual",
  },
  {
    key: "summary2023_2024",
    title: "黄河科技学院（近两年）分省区市普通类批次最低录取分数",
    url: `${BASE_URL}/info/1010/6788.htm`,
    raw: "2023-2024-national-ordinary-summary.html",
    parser: "nationalSummary2023_2024",
  },
];

const SOURCE = {
  id: "official-hhstu-national-2023-2025-school-major-institution-admission",
  quality: "official-school-hhstu-2023-2025-national-html-score",
  schoolCode: "11834",
  schoolName: "黄河科技学院",
  city: "郑州",
  tags: ["民办本科", "河南", "郑州", "黄河科技学院"],
};

const PROVINCE_ALIASES = new Map([
  ["北京市", "北京"],
  ["天津市", "天津"],
  ["河北省", "河北"],
  ["山西省", "山西"],
  ["内蒙古自治区", "内蒙古"],
  ["内蒙古", "内蒙古"],
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
  ["广西", "广西"],
  ["海南省", "海南"],
  ["重庆市", "重庆"],
  ["四川省", "四川"],
  ["贵州省", "贵州"],
  ["云南省", "云南"],
  ["西藏自治区", "西藏"],
  ["西藏", "西藏"],
  ["陕西省", "陕西"],
  ["甘肃省", "甘肃"],
  ["青海省", "青海"],
  ["宁夏回族自治区", "宁夏"],
  ["宁夏", "宁夏"],
  ["新疆维吾尔自治区", "新疆"],
  ["新疆维吾尔族自治区", "新疆"],
  ["新疆维吾尔族", "新疆"],
  ["新疆", "新疆"],
]);

const ART_PATTERN = /艺术|美术|音乐|舞蹈|播音|编导|表演|戏剧|影视|动画|视觉传达|环境设计|服装与服饰设计|产品设计|艺术设计|书法|摄影/;
const SPORTS_PATTERN = /体育|运动训练|社会体育/;
const SPECIAL_PATTERN = /专升本|对口|专项|定向|预科|民族|南疆|哈密|单列|退役士兵|建档立卡/;
const COOP_PATTERN = /中外合作|合作办学|合作|较高收费|国际|联合办学/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2023-2025-v3209-hhstu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2023-2025-v3209-hhstu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded official HTML evidence",
    "",
    "Imports 黄河科技学院招生信息网 official 2023-2025 historical admission HTML tables.",
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

function extractFirstTableRows(html) {
  const match = String(html).match(/<table\b[\s\S]*?<\/table>/i);
  return match ? tableRows(match[0]) : [];
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
  return PROVINCE_ALIASES.get(text) || text.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
}

function normalizeSubject(raw) {
  const text = clean(raw);
  if (/艺术/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/不分文理|综合/.test(text)) return "综合改革";
  return text || "官网未列科类";
}

function oldSubject(raw) {
  const text = clean(raw);
  if (/文/.test(text)) return "文科";
  if (/理/.test(text)) return "理科";
  return normalizeSubject(text);
}

function classifyAdmission(...parts) {
  const text = parts.map(clean).join(" ");
  const sourceContext = parts.slice(0, Math.max(1, parts.length - 2)).map(clean).join(" ");
  const ordinaryContext = /普通/.test(sourceContext) && !/艺术|体育|专升本|对口|专项|定向|预科/.test(sourceContext);
  if (!ordinaryContext && ART_PATTERN.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (SPORTS_PATTERN.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (SPECIAL_PATTERN.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "专升本/对口/专项/定向/预科等", formalScoreScope: "special-path-only" };
  }
  if (COOP_PATTERN.test(text)) {
    return { admissionType: "普通录取", admissionSubtype: "中外合作/合作办学/国际等单列专业", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch(batchRaw, levelRaw, categoryRaw, classification) {
  const text = [batchRaw, levelRaw, categoryRaw].map(clean).join(" ");
  if (/专科|高职/.test(text)) return "高职（专科）批";
  if (/本科二批|本科第二批/.test(text)) return "本科二批";
  if (/本科一批|本科第一批/.test(text)) return "本科一批";
  if (/本科|本科批/.test(text)) return classification.formalScoreScope === "special-path-only" && ART_PATTERN.test(text) ? "艺术类本科批" : "本科批";
  if (classification.formalScoreScope === "special-path-only") return "特殊类型批次";
  return clean(batchRaw) || "官网未列批次";
}

function dataTypeFor(batch, level, majorName) {
  const text = [batch, level, majorName].map(clean).join(" ");
  if (/专科|高职/.test(text)) return "vocational-admission";
  return "major-admission";
}

function scoreMetric(classification, dataType) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分/专业分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类文化分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  if (dataType === "vocational-admission") return "高职专科学校官网录取分";
  return "高考文化分";
}

function makeRecord({
  page,
  rawRelPath,
  rowIndex,
  year,
  province,
  sourceProvinceRaw,
  subjectType,
  sourceSubjectRaw,
  batch,
  sourceBatchRaw,
  sourceLevelRaw,
  majorName,
  minScore,
  minScoreRaw,
  controlLine,
  controlLineRaw,
  planCount,
  admissionCount,
  note,
  dataType,
  classification,
  sourceColumns,
}) {
  const record = {
    id: `${year}-hhstu-${dataType.replace(/-admission$/, "")}-${stableId([
      page.key,
      year,
      province,
      sourceSubjectRaw,
      sourceBatchRaw,
      majorName,
      minScoreRaw,
      controlLineRaw,
      rowIndex,
    ])}`,
    province,
    sourceProvinceRaw,
    year,
    subjectType,
    sourceSubjectRaw,
    batch,
    sourceBatchRaw,
    sourceLevelRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType,
    majorName,
    majorGroup: [SOURCE.schoolName, province, subjectType, batch, majorName].filter(Boolean).join("-"),
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
    officialEvidencePath: rawRelPath,
    sourceHtmlPath: rawRelPath,
    sourcePageKey: page.key,
    sourcePageTitle: page.title,
    sourceMinScoreRaw: minScoreRaw,
    sourceControlLineRaw: controlLineRaw,
    rawRow: {
      source: "hhstu-2023-2025-official-html-table",
      pageKey: page.key,
      rowIndex,
      sourceColumns,
    },
    cautions: [
      "本记录来自黄河科技学院招生信息网官方历年统计 HTML 表，是单校分省/分专业或院校层录取边界，不是省级教育考试院全量投档/录取分数表。",
      "官网源表未公开最低位次；运行层标记 rankUnavailable=true，不生成假位次，推荐层不得仅凭本行分数输出录取概率。",
      "艺术、体育、专升本、对口、专项、定向、预科等特殊路径按 special-path-only 隔离，不与普通高考文化分混算。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (Number.isFinite(planCount)) record.planCount = planCount;
  if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
  if (note) record.sourceNoteRaw = note;
  return record;
}

function parseOutside2025(page, rows, rawRelPath) {
  const records = [];
  const skippedRows = [];
  rows.slice(1).forEach((row, index) => {
    const rowIndex = index + 1;
    const sourceProvinceRaw = clean(row[0]);
    const province = normalizeProvince(sourceProvinceRaw);
    const sourceBatchRaw = clean(row[1]);
    const sourceSubjectRaw = clean(row[2]);
    const majorName = clean(row[3]);
    const admissionCount = integerNumber(row[4]);
    const minScoreRaw = clean(row[5]);
    const controlLineRaw = clean(row[6]);
    const minScore = parseNumber(minScoreRaw);
    const controlLine = parseNumber(controlLineRaw);
    if (!province || /省市/.test(province) || !majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, row });
      return;
    }
    const classification = classifyAdmission(sourceBatchRaw, sourceSubjectRaw, majorName);
    const batch = normalizeBatch(sourceBatchRaw, "", "", classification);
    const dataType = dataTypeFor(batch, "", majorName);
    records.push(makeRecord({
      page,
      rawRelPath,
      rowIndex,
      year: 2025,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw),
      sourceSubjectRaw,
      batch,
      sourceBatchRaw,
      sourceLevelRaw: "",
      majorName,
      minScore,
      minScoreRaw,
      controlLine,
      controlLineRaw,
      admissionCount,
      dataType,
      classification,
      sourceColumns: row,
    }));
  });
  return { records, skippedRows };
}

function parseHenan2025(page, rows, rawRelPath) {
  const records = [];
  const skippedRows = [];
  rows.slice(1).forEach((row, index) => {
    const rowIndex = index + 1;
    const categoryRaw = clean(row[0]);
    const electiveRequirement = clean(row[1]);
    const majorName = clean(row[2]);
    const admissionCount = integerNumber(row[3]);
    const minScoreRaw = clean(row[4]);
    const controlLineRaw = clean(row[5]);
    const note = clean(row[7]);
    const minScore = parseNumber(minScoreRaw);
    const controlLine = parseNumber(controlLineRaw);
    if (!categoryRaw || !majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, row });
      return;
    }
    const classification = classifyAdmission(categoryRaw, electiveRequirement, majorName, note);
    const batch = normalizeBatch("", categoryRaw, categoryRaw, classification);
    const dataType = dataTypeFor(batch, categoryRaw, majorName);
    const subjectType = normalizeSubject(categoryRaw);
    records.push(makeRecord({
      page,
      rawRelPath,
      rowIndex,
      year: 2025,
      province: "河南",
      sourceProvinceRaw: "河南省",
      subjectType,
      sourceSubjectRaw: categoryRaw,
      batch,
      sourceBatchRaw: categoryRaw,
      sourceLevelRaw: categoryRaw,
      majorName,
      minScore,
      minScoreRaw,
      controlLine,
      controlLineRaw,
      admissionCount,
      note,
      dataType,
      classification,
      sourceColumns: row,
    }));
    records.at(-1).electiveRequirement = electiveRequirement;
  });
  return { records, skippedRows };
}

function normalizeCategoryLevel(a, b) {
  let category = clean(a);
  let level = clean(b);
  if (/本科|专科/.test(category) && /(艺术|体育|普通|专升本|对口)/.test(level)) {
    [category, level] = [level, category];
  }
  return { category, level };
}

function parseHenanOldDual(page, rows, rawRelPath) {
  const records = [];
  const skippedRows = [];
  const dataRows = rows.filter((row) => row.length >= 9 && !/类别|专业|20\d{2}年/.test(clean(row[0])) && clean(row[2]));
  dataRows.forEach((row, index) => {
    const rowIndex = rows.indexOf(row);
    const { category, level } = normalizeCategoryLevel(row[0], row[1]);
    const majorName = clean(row[2]);
    const note = clean(page.year === 2024 ? row[11] : row[9]);
    const branches = page.year === 2024
      ? [
          { sourceSubjectRaw: "文史类", plan: row[3], min: row[4], control: row[5] },
          { sourceSubjectRaw: "理工类", plan: row[7], min: row[8], control: row[9] },
        ]
      : [
          { sourceSubjectRaw: "文史类", plan: "", min: row[3], control: row[4] },
          { sourceSubjectRaw: "理工类", plan: "", min: row[6], control: row[7] },
        ];
    for (const branch of branches) {
      const minScoreRaw = clean(branch.min);
      const controlLineRaw = clean(branch.control);
      const minScore = parseNumber(minScoreRaw);
      const controlLine = parseNumber(controlLineRaw);
      const planCount = integerNumber(branch.plan);
      if (!category || !level || !majorName || !Number.isFinite(minScore)) {
        skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, subject: branch.sourceSubjectRaw, row });
        continue;
      }
      const classification = classifyAdmission(category, level, majorName, note);
      const batch = normalizeBatch("", level, category, classification);
      const dataType = dataTypeFor(batch, level, majorName);
      records.push(makeRecord({
        page,
        rawRelPath,
        rowIndex,
        year: page.year,
        province: "河南",
        sourceProvinceRaw: "河南省",
        subjectType: oldSubject(branch.sourceSubjectRaw),
        sourceSubjectRaw: branch.sourceSubjectRaw,
        batch,
        sourceBatchRaw: [category, level].filter(Boolean).join(" "),
        sourceLevelRaw: level,
        majorName,
        minScore,
        minScoreRaw,
        controlLine,
        controlLineRaw,
        planCount,
        note,
        dataType,
        classification,
        sourceColumns: row,
      }));
    }
  });
  return { records, skippedRows };
}

function parseNationalSummary2023_2024(page, rows, rawRelPath) {
  const records = [];
  const skippedRows = [];
  rows.slice(2).forEach((row, index) => {
    const rowIndex = index + 2;
    const provinceCode = clean(row[0]);
    const sourceProvinceRaw = clean(row[1]);
    const province = normalizeProvince(sourceProvinceRaw);
    const sourceBatchRaw = clean(row[2]);
    const sourceSubjectRaw = clean(row[3]);
    const planCount = integerNumber(row[4]);
    const admissionCount = integerNumber(row[5]);
    const yearly = [
      { year: 2024, min: row[6], control: row[7], above: row[8] },
      { year: 2023, min: row[9], control: row[10], above: row[11] },
    ];
    for (const item of yearly) {
      const minScoreRaw = clean(item.min);
      const controlLineRaw = clean(item.control);
      const minScore = parseNumber(minScoreRaw);
      const controlLine = parseNumber(controlLineRaw);
      if (!province || !sourceBatchRaw || !sourceSubjectRaw || !Number.isFinite(minScore)) {
        skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, year: item.year, row });
        continue;
      }
      const classification = classifyAdmission(sourceBatchRaw, sourceSubjectRaw);
      const batch = normalizeBatch(sourceBatchRaw, "", "", classification);
      records.push(makeRecord({
        page,
        rawRelPath,
        rowIndex,
        year: item.year,
        province,
        sourceProvinceRaw,
        subjectType: normalizeSubject(sourceSubjectRaw),
        sourceSubjectRaw,
        batch,
        sourceBatchRaw,
        sourceLevelRaw: "",
        majorName: "院校普通类批次最低录取分数",
        minScore,
        minScoreRaw,
        controlLine,
        controlLineRaw,
        planCount,
        admissionCount,
        note: `省市代号=${provinceCode}; 超省控线=${clean(item.above)}`,
        dataType: "institution-admission",
        classification,
        sourceColumns: row,
      }));
    }
  });
  return { records, skippedRows };
}

function parsePage(page, html, rawRelPath) {
  const rows = extractFirstTableRows(html);
  if (!rows.length) return { records: [], skippedRows: [{ reason: "no-table", page: page.key, rawRelPath }], rows };
  if (page.parser === "outside2025") return { ...parseOutside2025(page, rows, rawRelPath), rows };
  if (page.parser === "henan2025") return { ...parseHenan2025(page, rows, rawRelPath), rows };
  if (page.parser === "henanOldDual") return { ...parseHenanOldDual(page, rows, rawRelPath), rows };
  if (page.parser === "nationalSummary2023_2024") return { ...parseNationalSummary2023_2024(page, rows, rawRelPath), rows };
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

  await downloadText(rawRoot, "index-lntj.html", INDEX_URL, args.useCache);
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
      tableRows: parsed.rows.length,
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
  const rankRows = records.filter((record) => record.rankUnavailable === false || record.minRankEnd != null);
  if (rankRows.length) throw new Error(`HHSTU source should not expose rank rows; got ${rankRows.length}`);

  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const yearsWithRecords = [...new Set(records.map((record) => record.year))].sort((a, b) => a - b);
  const sourceNote = {
    id: SOURCE.id,
    title: "黄河科技学院招生信息网：2023-2025年历年统计官方 HTML 表",
    publisher: "黄河科技学院招生信息网",
    url: INDEX_URL,
    quality: SOURCE.quality,
    usage: "从黄河科技学院招生信息网官方“历年统计”栏目下载 2025 年省外分专业表、2025 年河南分专业表、2024/2023 年河南分专业表和近两年分省区市普通类批次最低录取分数 HTML 表，抽取单校分省分专业或院校层最低录取分、控制线和录取/计划数。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: provincesWithRecords.length,
    provincesWithRecords,
    years: yearsWithRecords,
    pageSummaries,
    rawDir: RAW_DIR,
    rawFiles: [
      { path: `${RAW_DIR}/index-lntj.html`, url: INDEX_URL, sha256: sha256File(path.join(rawRoot, "index-lntj.html")) },
      ...PAGES.map((page) => ({
        path: `${RAW_DIR}/${page.raw}`,
        url: page.url,
        sha256: sha256File(path.join(rawRoot, page.raw)),
      })),
    ],
    recordTypeCounts: countBy(records, (record) => record.dataType),
    formalScoreScopeCounts: countBy(records, (record) => record.formalScoreScope),
    admissionTypeCounts: countBy(records, (record) => record.admissionType),
    admissionSubtypeCounts: countBy(records, (record) => record.admissionSubtype),
    subjectTypeCounts: countBy(records, (record) => record.subjectType),
    recordsByYear: countBy(records, (record) => String(record.year)),
    recordsByProvince: countBy(records, (record) => record.province),
    scoreRange: scoreRange(records),
    ordinarySchoolOfficialScoreRange: scoreRange(records.filter((record) => record.formalScoreScope === "school-official-only")),
    specialPathScoreRange: scoreRange(records.filter((record) => record.formalScoreScope === "special-path-only")),
    rankUnavailableRecords: records.filter((record) => record.rankUnavailable).length,
    cautions: [
      "黄河科技学院官网单校分数只用于该校候选边界复核，不替代各省教育考试院全量投档/录取分数表。",
      "官网源表未公开最低位次；本包所有记录均标记 rankUnavailable=true，不生成假位次。",
      "艺术、体育、专升本、对口、专项、定向、预科等特殊路径按 special-path-only 隔离。",
      "近两年分省区市普通类批次最低录取分数页是院校层汇总边界，不等同于分专业录取结果。",
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
    years: yearsWithRecords,
    provincesWithRecords: provincesWithRecords.length,
    pageSummaries,
    recordTypeCounts: sourceNote.recordTypeCounts,
    formalScoreScopeCounts: sourceNote.formalScoreScopeCounts,
    admissionTypeCounts: sourceNote.admissionTypeCounts,
    admissionSubtypeCounts: sourceNote.admissionSubtypeCounts,
    subjectTypeCounts: sourceNote.subjectTypeCounts,
    scoreRange: sourceNote.scoreRange,
    ordinarySchoolOfficialScoreRange: sourceNote.ordinarySchoolOfficialScoreRange,
    specialPathScoreRange: sourceNote.specialPathScoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
