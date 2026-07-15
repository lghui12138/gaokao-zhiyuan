#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2022-2025-v3261-swjtu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2022-2025-v3261-swjtu";
const OFFICIAL_HOME_URL = "https://zhaosheng.swjtu.edu.cn";
const INDEX_URL = "https://cjcx.swjtu.edu.cn/admission/default.html";
const JS_URL = "https://cjcx.swjtu.edu.cn/admission/css/JavaScript.js";
const BASE_URL = "https://cjcx.swjtu.edu.cn/admission/";

const SOURCE = {
  id: "official-swjtu-national-2022-2025-school-admission",
  quality: "official-school-swjtu-2022-2025-national-static-html-score-rank",
  schoolCode: "10613",
  schoolName: "西南交通大学",
  city: "成都",
  publisher: "西南交通大学本科招生办公室",
  tags: ["四川", "成都", "西南交通大学", "交通", "211", "双一流", "公办"],
};

const YEARS = [2025, 2024, 2023, 2022];

const PROVINCES = [
  ["安徽省", "安徽", "ANHUISHENG"],
  ["北京市", "北京", "BEIJINGSHI"],
  ["福建省", "福建", "FUJIANSHENG"],
  ["甘肃省", "甘肃", "GANSUSHENG"],
  ["广东省", "广东", "ANDONGSHENG"],
  ["广西壮族自治区", "广西", "ANXIZHUANGZUZIZHIOU"],
  ["贵州省", "贵州", "GUIZHOUSHENG"],
  ["海南省", "海南", "HAINASHENG"],
  ["河北省", "河北", "HEBEISHENG"],
  ["河南省", "河南", "HENASHENG"],
  ["黑龙江省", "黑龙江", "HEILONGJIANGSHENG"],
  ["湖北省", "湖北", "HUBEISHENG"],
  ["湖南省", "湖南", "HUNASHENG"],
  ["吉林省", "吉林", "JILINSHENG"],
  ["江苏省", "江苏", "JIANGSUSHENG"],
  ["江西省", "江西", "JIANGXISHENG"],
  ["辽宁省", "辽宁", "LIAONINGSHENG"],
  ["内蒙古自治区", "内蒙古", "NEIMENGGUZIZHIOU"],
  ["宁夏回族自治区", "宁夏", "NINGXIAHUIZUZIZHIOU"],
  ["青海省", "青海", "QINGHAISHENG"],
  ["山东省", "山东", "SHANDONGSHENG"],
  ["山西省", "山西", "SHANXISHENG"],
  ["陕西省", "陕西", "SHANXISHENG2"],
  ["上海市", "上海", "SHANGHAISHI"],
  ["四川省", "四川", "SICHUANSHENG"],
  ["天津市", "天津", "TIANJINSHI"],
  ["西藏自治区", "西藏", "XICANGZIZHIOU"],
  ["新疆维吾尔自治区", "新疆", "XINJIANGWEIWUERZIZHIOU"],
  ["云南省", "云南", "YUNNASHENG"],
  ["浙江省", "浙江", "ZHEJIANGSHENG"],
  ["重庆市", "重庆", "CHONGQINGSHI"],
];

const MAINLAND_PROVINCES = new Set(PROVINCES.map(([, province]) => province));
const INTEGRATED_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const EXPECTED_HEADER = ["序号", "校区", "类别名称", "专业名称", "录取数", "省控线", "最高分", "最低分", "平均分", "省份", "最低分位次"];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2022-2025-v3261-swjtu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2022-2025-v3261-swjtu.mjs --use-cache --concurrency 4",
    "",
    "Imports 西南交通大学 2022-2025 official static historical admission-score pages.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false, concurrency: 4 };
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
    if (arg === "--concurrency") {
      args.concurrency = Number(argv[++i]);
      if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 8) {
        throw new Error("Invalid --concurrency; expected 1..8");
      }
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

function guardProjectRoot() {
  if (PROJECT_ROOT.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing to run the importer from /Volumes/mac_2T; use the internal APFS project copy.");
  }
}

function projectPath(relPath) {
  return path.resolve(PROJECT_ROOT, relPath);
}

function ensureDir(relOrAbs) {
  fs.mkdirSync(path.isAbsolute(relOrAbs) ? relOrAbs : projectPath(relOrAbs), { recursive: true });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(absPath) {
  return sha256(fs.readFileSync(absPath));
}

function stableId(parts, length = 18) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, length);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n\f\v]+/g, " ")
    .trim();
}

function parseNumber(value) {
  const text = normalizeText(value).replace(/[,，]/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--" || /^无$/.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseInteger(value) {
  const number = parseNumber(value);
  return number == null ? null : Math.trunc(number);
}

function htmlDecode(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cellText(value) {
  return normalizeText(htmlDecode(value));
}

async function requestText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || INDEX_URL,
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(options.timeoutMs || 120_000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 240)}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      if (attempt < 5) await sleep(800 * attempt);
    }
  }
  throw lastError;
}

async function getTextRaw(rawRoot, rawFile, url, useCache, options = {}) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs) && fs.statSync(abs).size > 0) return fs.readFileSync(abs, "utf8");
  const text = await requestText(url, options);
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
  return text;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function pageRawFile(year, pinyin) {
  return `swjtu-admission-${year}-${pinyin}.html`;
}

function pageUrl(year, pinyin) {
  return `${BASE_URL}admission_${year}_${pinyin}.html`;
}

function extractRows(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
}

function extractCells(rowHtml) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => cellText(match[1]));
}

function isArtRow(row) {
  const category = normalizeText(row.categoryName);
  const major = normalizeText(row.majorName);
  return /艺术|美术|绘画|音乐|舞蹈|播音|书法|表演|戏剧/.test(category)
    || /设计学类|视觉传达设计|环境设计|产品设计|服装与服饰设计|数字媒体艺术|动画|音乐表演|绘画/.test(major);
}

function normalizeSubject(categoryName, province) {
  const text = normalizeText(categoryName);
  if (/体育/.test(text)) return "体育类";
  if (/艺术|美术|绘画|音乐|舞蹈|播音|书法|表演|戏剧/.test(text)) return "艺术类";
  if (/历史|文史|文科|内地班文|新疆内地班文|国家专项计划文|预科文/.test(text)) return "历史类";
  if (/物理|理工|理科|内地班理|新疆内地班理|国家专项计划理|高校专项理|预科理|中外合作办学理/.test(text)) return "物理类";
  if (/综合|不分文理|改革|专业组/.test(text) || INTEGRATED_PROVINCES.has(province)) return "综合";
  return "官网未列科类";
}

function normalizeBatch(categoryName) {
  const text = normalizeText(categoryName);
  if (/国家专项/.test(text)) return "国家专项";
  if (/高校专项/.test(text)) return "高校专项";
  if (/艺术/.test(text)) return "艺术类本科";
  if (/体育/.test(text)) return "体育类本科";
  if (/西藏内地班|内地班/.test(text)) return "内地班";
  return "本科批";
}

function candidateCategory(row) {
  const text = `${row.categoryName} ${row.majorName}`;
  if (row.province === "西藏" && /（A）|\(A\)|A类|A 类/.test(text)) return "A类考生";
  if (row.province === "西藏" && /（B）|\(B\)|B类|B 类/.test(text)) return "B类考生";
  if (row.province === "西藏" && /西藏内地班|内地班/.test(text)) return "西藏内地班";
  return null;
}

function classifyAdmission(row) {
  const text = `${row.categoryName} ${row.majorName} ${row.campus}`;
  if (isArtRow(row)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|单考单招|单独招生|单独考试|高水平运动/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/中外合作|合作办学|利兹|生物工程中外|安全工程中外/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  if (/西藏内地班|内地班|预科|民族班|定向|援疆|南疆|单列/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(row, category) {
  const text = `${row.categoryName} ${row.majorName} ${row.campus}`;
  const values = [];
  if (category) values.push(category);
  for (const [pattern, label] of [
    [/中外合作|合作办学|利兹/, "中外合作办学"],
    [/国家专项/, "国家专项"],
    [/高校专项/, "高校专项"],
    [/西藏内地班|内地班/, "内地班"],
    [/预科/, "预科"],
    [/民族班/, "民族班"],
    [/定向|援疆/, "定向/援疆"],
    [/艺术|美术|绘画|音乐|舞蹈|播音|书法|表演|戏剧|设计学类|视觉传达设计|环境设计|产品设计|服装与服饰设计|数字媒体艺术|动画/, "艺术类"],
    [/体育|运动训练|单考单招|单独招生|单独考试|高水平运动/, "体育类"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  return [...new Set(values)].join("/") || "普通";
}

function scoreMetric(row, classification) {
  const text = `${row.categoryName} ${row.majorName}`;
  if (/文化成绩/.test(text)) return "艺术/体育文化成绩，按官网原表口径";
  if (/专业成绩/.test(text)) return "艺术/体育专业成绩，按官网原表口径";
  if (classification.admissionType === "艺术类" || classification.admissionType === "体育类") {
    return "综合/专业或文化分，按官网原表口径";
  }
  return "高考文化分，按官网原表口径";
}

function parsePage(html, pageMeta, rawRel) {
  const rows = extractRows(html);
  const header = extractCells(rows[0] || "");
  const warnings = [];
  if (JSON.stringify(header) !== JSON.stringify(EXPECTED_HEADER)) {
    warnings.push({ issue: "unexpected_header", header });
  }
  const sourceRows = [];
  let badCellRows = 0;
  for (const rowHtml of rows.slice(1)) {
    const cells = extractCells(rowHtml);
    if (cells.length !== EXPECTED_HEADER.length) {
      badCellRows += 1;
      warnings.push({ issue: "unexpected_cell_count", cells });
      continue;
    }
    const rawProvince = cells[9];
    sourceRows.push({
      serial: parseInteger(cells[0]),
      campus: cells[1],
      categoryName: cells[2],
      majorName: cells[3],
      admittedCountRaw: cells[4],
      controlLineRaw: cells[5],
      maxScoreRaw: cells[6],
      minScoreRaw: cells[7],
      avgScoreRaw: cells[8],
      provinceRaw: rawProvince,
      minRankRaw: cells[10],
      year: pageMeta.year,
      province: pageMeta.province,
      provincePageRaw: pageMeta.rawProvince,
      pinyin: pageMeta.pinyin,
    });
    if (normalizeText(rawProvince) !== pageMeta.rawProvince) {
      warnings.push({ issue: "province_cell_mismatch", expected: pageMeta.rawProvince, actual: rawProvince });
    }
  }
  return { sourceRows, pageSummary: { ...pageMeta, rawFile: rawRel, sha256: sha256File(projectPath(rawRel)), rows: sourceRows.length, badCellRows, warnings } };
}

function buildRecord(row, rawRel, rowIndex) {
  const minScore = parseNumber(row.minScoreRaw);
  const maxScore = parseNumber(row.maxScoreRaw);
  const avgScore = parseNumber(row.avgScoreRaw);
  const minRank = parseInteger(row.minRankRaw);
  const controlLine = parseNumber(row.controlLineRaw);
  const admittedCount = parseInteger(row.admittedCountRaw);
  if (!row.year || !MAINLAND_PROVINCES.has(row.province) || !row.majorName || minScore == null || minScore <= 0) return null;

  const subjectType = normalizeSubject(row.categoryName, row.province);
  const classification = classifyAdmission(row);
  const category = candidateCategory(row);
  const subtype = admissionSubtype(row, category);
  const rankUnavailable = !(minRank != null && minRank > 0);
  const page = pageUrl(row.year, row.pinyin);
  const record = {
    id: `swjtu-${stableId([row.year, row.province, row.campus, row.categoryName, row.majorName, minScore, minRank, admittedCount, row.serial, rowIndex])}`,
    year: row.year,
    province: row.province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    campus: row.campus || "官网未列校区",
    batch: normalizeBatch(row.categoryName),
    subjectType,
    majorName: row.majorName,
    dataType: "major-admission",
    admissionType: classification.admissionType,
    admissionSubtype: subtype,
    formalScoreScope: classification.formalScoreScope,
    schoolOfficialScope: true,
    minScore,
    maxScore,
    avgScore,
    minRank: rankUnavailable ? null : minRank,
    minRankStart: rankUnavailable ? null : minRank,
    minRankEnd: rankUnavailable ? null : minRank,
    rankUnavailable,
    scoreOnly: rankUnavailable,
    scoreMetric: scoreMetric(row, classification),
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: page,
    sourcePageUrl: page,
    sourceIndexUrl: INDEX_URL,
    sourcePageKey: `swjtu-${row.year}-${row.province}`,
    sourcePageTitle: `${row.year}年${row.province}${SOURCE.schoolName}历年录取分数`,
    officialEvidencePath: rawRel,
    sourceProvinceRaw: row.provinceRaw,
    sourceCategoryRaw: row.categoryName,
    sourceSubjectRaw: row.categoryName,
    sourceCampusRaw: row.campus,
    sourceBatchRaw: row.categoryName,
    sourceMajorRaw: row.majorName,
    sourceControlLineRaw: row.controlLineRaw,
    sourceMaxScoreRaw: row.maxScoreRaw,
    sourceMinScoreRaw: row.minScoreRaw,
    sourceAverageScoreRaw: row.avgScoreRaw,
    sourceMinRankRaw: row.minRankRaw,
    sourceAdmittedCountRaw: row.admittedCountRaw,
    rawRow: row,
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级教育考试院全量投档/录取表。",
      rankUnavailable ? "源行缺失最低位次；运行层不生成假位次或仅凭单校行输出录取概率。" : "源行公开最低分位次，但仍为单校专业边界，不能替代省级全量投档线。",
    ],
  };
  if (admittedCount != null && admittedCount > 0) record.admittedCount = admittedCount;
  if (controlLine != null && controlLine > 0) record.sourceControlLine = controlLine;
  if (category) record.candidateCategory = category;
  if (/中外合作|合作办学|利兹/.test(`${row.categoryName} ${row.majorName}`)) {
    record.cautions.push("中外合作办学方向需结合学费、校区和培养模式复核。");
  }
  if (row.province === "西藏") {
    record.cautions.push("西藏行仅为西南交通大学官网单校分数；A/B类和内地班候选类别保留，不参与省级全量闭合。");
  }
  return record;
}

function incrementCounter(target, key, by = 1) {
  target[key] = (target[key] || 0) + by;
}

function range(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric.length) return null;
  return [Math.min(...numeric), Math.max(...numeric)];
}

function countRecords(records) {
  const counters = {
    formalScoreScopeCounts: {},
    subjectTypeCounts: {},
    provinceCounts: {},
    yearCounts: {},
    admissionTypeCounts: {},
    admissionSubtypeCounts: {},
    recordTypeCounts: {},
    campusCounts: {},
  };
  for (const record of records) {
    incrementCounter(counters.formalScoreScopeCounts, record.formalScoreScope);
    incrementCounter(counters.subjectTypeCounts, record.subjectType);
    incrementCounter(counters.provinceCounts, record.province);
    incrementCounter(counters.yearCounts, String(record.year));
    incrementCounter(counters.admissionTypeCounts, record.admissionType);
    incrementCounter(counters.admissionSubtypeCounts, record.admissionSubtype);
    incrementCounter(counters.recordTypeCounts, record.dataType);
    incrementCounter(counters.campusCounts, record.campus || "官网未列校区");
  }
  return counters;
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));

  const rawFiles = [];
  async function capture(rawFile, url, options) {
    await getTextRaw(rawRoot, rawFile, url, args.useCache, options);
    rawFiles.push(`${RAW_DIR}/${rawFile}`);
  }

  try {
    await capture("swjtu-official-home.html", OFFICIAL_HOME_URL, { timeoutMs: 25_000, referer: INDEX_URL });
  } catch (error) {
    const warningRaw = "swjtu-official-home-fetch-warning.json";
    fs.writeFileSync(path.join(rawRoot, warningRaw), `${JSON.stringify({
      url: OFFICIAL_HOME_URL,
      fetchedAt: new Date().toISOString(),
      issue: "official_home_unavailable_in_current_network",
      error: error instanceof Error ? error.message : String(error),
      fallbackEvidenceUrl: INDEX_URL,
      boundary: "Records are not inferred from this unavailable shell; they are sourced from official cjcx.swjtu.edu.cn static score pages.",
    }, null, 2)}\n`);
    rawFiles.push(`${RAW_DIR}/${warningRaw}`);
  }
  await capture("swjtu-admission-index.html", INDEX_URL, { timeoutMs: 45_000 });
  await capture("swjtu-JavaScript.js", JS_URL, { accept: "application/javascript,text/plain,*/*;q=0.9", timeoutMs: 45_000 });

  const pages = [];
  for (const year of YEARS) {
    for (const [rawProvince, province, pinyin] of PROVINCES) {
      pages.push({ year, rawProvince, province, pinyin });
    }
  }

  const parsedPages = await mapLimit(pages, args.concurrency, async (page, index) => {
    const rawFile = pageRawFile(page.year, page.pinyin);
    const rawRel = `${RAW_DIR}/${rawFile}`;
    const html = await getTextRaw(rawRoot, rawFile, pageUrl(page.year, page.pinyin), args.useCache, {
      timeoutMs: 90_000,
      referer: INDEX_URL,
    });
    rawFiles.push(rawRel);
    return parsePage(html, { ...page, pageIndex: index + 1, url: pageUrl(page.year, page.pinyin) }, rawRel);
  });

  const sourceRows = [];
  const pageSummaries = [];
  for (const page of parsedPages) {
    sourceRows.push(...page.sourceRows.map((row) => ({ row, rawRel: page.pageSummary.rawFile })));
    pageSummaries.push(page.pageSummary);
  }

  const records = [];
  const skippedRows = [];
  let rowIndex = 0;
  for (const item of sourceRows) {
    rowIndex += 1;
    const record = buildRecord(item.row, item.rawRel, rowIndex);
    if (record) records.push(record);
    else skippedRows.push({ rowIndex, rawFile: item.rawRel, row: item.row, issue: "missing_required_fields" });
  }

  const seenIds = new Map();
  const duplicateIds = [];
  for (const record of records) {
    if (seenIds.has(record.id)) duplicateIds.push({ id: record.id, first: seenIds.get(record.id), duplicate: record });
    else seenIds.set(record.id, record);
  }
  if (duplicateIds.length) throw new Error(`Duplicate generated record ids: ${duplicateIds.slice(0, 3).map((item) => item.id).join(", ")}`);

  const semanticSeen = new Set();
  const semanticDuplicates = [];
  const dedupedRecords = [];
  for (const record of records) {
    const key = [
      record.year,
      record.province,
      record.campus,
      record.sourceCategoryRaw,
      record.majorName,
      record.minScore,
      record.minRank,
      record.sourceAdmittedCountRaw,
      record.sourcePageUrl,
    ].join("\t");
    if (semanticSeen.has(key)) {
      semanticDuplicates.push({ id: record.id, key, rawFile: record.officialEvidencePath });
      continue;
    }
    semanticSeen.add(key);
    dedupedRecords.push(record);
  }

  const counters = countRecords(dedupedRecords);
  const badScores = dedupedRecords.filter((record) => !(record.minScore > 0 && record.minScore <= 900));
  const ordinaryWeirdScores = dedupedRecords.filter((record) => (
    record.formalScoreScope === "school-official-only"
    && record.admissionType === "普通录取"
    && (record.minScore < 150 || record.minScore > 750)
  ));
  const badRankFlags = dedupedRecords.filter((record) => (
    (record.rankUnavailable && record.minRank != null)
    || (!record.rankUnavailable && !(record.minRank > 0))
  ));
  const nonMainland = dedupedRecords.filter((record) => !MAINLAND_PROVINCES.has(record.province));
  const pageWarnings = pageSummaries.flatMap((page) => (page.warnings || []).map((warning) => ({ ...warning, page: page.url })));

  const sourceNote = {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "西南交通大学本科招生计划和录取查询历年数据（2022-2025）",
    url: INDEX_URL,
    officialHomeUrl: OFFICIAL_HOME_URL,
    quality: SOURCE.quality,
    usage: "学校官网单校分专业录取人数、省控线、最高分、最低分、平均分和最低分位次边界；可用于西南交通大学候选边界复核、四川/交通类院校方向分数段趋势和全国单校分数加厚，不替代任何省级教育考试院全量投档/录取表。源表公开最低位次的行保留最低位次；缺失位次的行保持 rankUnavailable=true 且不生成假位次。",
    rawDir: RAW_DIR,
    rawFiles: [...new Set(rawFiles)].sort(),
    parsedRecords: dedupedRecords.length,
    sourceRows: sourceRows.length,
    skippedRows: skippedRows.length,
    skippedSemanticDuplicates: semanticDuplicates.length,
    recordsWithRank: dedupedRecords.filter((record) => !record.rankUnavailable).length,
    recordsRankUnavailable: dedupedRecords.filter((record) => record.rankUnavailable).length,
    provinceCount: Object.keys(counters.provinceCounts).length,
    yearCount: Object.keys(counters.yearCounts).length,
    scoreRange: range(dedupedRecords.map((record) => record.minScore)),
    rankRange: range(dedupedRecords.map((record) => record.minRank).filter((value) => value != null)),
    formalScoreScopeCounts: counters.formalScoreScopeCounts,
    subjectTypeCounts: counters.subjectTypeCounts,
    provinceCounts: counters.provinceCounts,
    yearCounts: counters.yearCounts,
    admissionTypeCounts: counters.admissionTypeCounts,
    admissionSubtypeCounts: counters.admissionSubtypeCounts,
    recordTypeCounts: counters.recordTypeCounts,
    campusCounts: counters.campusCounts,
    pages: pageSummaries,
    sourceTableSchema: EXPECTED_HEADER,
    caveats: [
      "网页 JS 中省份拼音存在原站拼写（如 ANDONGSHENG、XICANGZIZHIOU），导入器按官网 JavaScript 原值构造证据 URL，不修正为另一路径。",
      "西藏、专项、中外合作、艺术体育、内地班等路径按 special-path-only 或候选类别保留，不参与普通批次闭合判断。",
    ],
  };

  const audit = {
    duplicateIds: duplicateIds.length,
    semanticDuplicatesSkipped: semanticDuplicates.length,
    badScores: badScores.length,
    badRankFlags: badRankFlags.length,
    nonMainlandRecords: nonMainland.length,
    pageWarnings: pageWarnings.length,
    skippedRows: skippedRows.length,
    ordinaryWeirdScoreRecords: ordinaryWeirdScores.length,
    recordsBelow150OrAbove750: dedupedRecords.filter((record) => record.minScore < 150 || record.minScore > 750).length,
    rankUnavailableRecords: sourceNote.recordsRankUnavailable,
    xizangRecords: counters.provinceCounts["西藏"] || 0,
    examples: {
      badScores: badScores.slice(0, 5),
      badRankFlags: badRankFlags.slice(0, 5),
      pageWarnings: pageWarnings.slice(0, 10),
      skippedRows: skippedRows.slice(0, 10),
      semanticDuplicates: semanticDuplicates.slice(0, 10),
      ordinaryWeirdScores: ordinaryWeirdScores.slice(0, 10),
    },
  };

  if (badScores.length) throw new Error(`Bad score rows detected: ${JSON.stringify(badScores.slice(0, 3), null, 2)}`);
  if (badRankFlags.length) throw new Error(`Bad rank flags detected: ${JSON.stringify(badRankFlags.slice(0, 3), null, 2)}`);
  if (nonMainland.length) throw new Error(`Non-mainland records detected: ${JSON.stringify(nonMainland.slice(0, 3), null, 2)}`);
  if (pageWarnings.length) throw new Error(`Page parse warnings detected: ${JSON.stringify(pageWarnings.slice(0, 5), null, 2)}`);
  if (ordinaryWeirdScores.length) {
    throw new Error(`Ordinary weird score rows detected: ${JSON.stringify(ordinaryWeirdScores.slice(0, 5), null, 2)}`);
  }

  const payload = {
    dataset: "gaokao-zhiyuan-site-admission-score-layer",
    scope: "official-school-national-admission-major-score-rank",
    generatedAt: new Date().toISOString(),
    sourceNotes: [sourceNote],
    records: dedupedRecords,
    audit,
    notes: [
      "Records are parsed from 西南交通大学 official static historical score pages, one page per year/province.",
      "No score rows are fabricated; missing rank cells remain rankUnavailable=true.",
      "school-official-only and special-path-only remain separate evidence layers.",
    ],
  };

  fs.writeFileSync(projectPath(args.out), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    out: args.out,
    records: dedupedRecords.length,
    pages: pageSummaries.length,
    rawFiles: sourceNote.rawFiles.length,
    recordsWithRank: sourceNote.recordsWithRank,
    recordsRankUnavailable: sourceNote.recordsRankUnavailable,
    provinceCount: sourceNote.provinceCount,
    xizangRecords: audit.xizangRecords,
    formalScoreScopeCounts: counters.formalScoreScopeCounts,
    subjectTypeCounts: counters.subjectTypeCounts,
    admissionTypeCounts: counters.admissionTypeCounts,
    scoreRange: sourceNote.scoreRange,
    rankRange: sourceNote.rankRange,
    audit: {
      duplicateIds: audit.duplicateIds,
      semanticDuplicatesSkipped: audit.semanticDuplicatesSkipped,
      badScores: audit.badScores,
      badRankFlags: audit.badRankFlags,
      nonMainlandRecords: audit.nonMainlandRecords,
      pageWarnings: audit.pageWarnings,
      skippedRows: audit.skippedRows,
      ordinaryWeirdScoreRecords: audit.ordinaryWeirdScoreRecords,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
