#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2018-2025-v3242-fzu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2018-2025-v3242-fzu";
const OFFICIAL_NAV_URL = "https://zsks.fzu.edu.cn/";
const SEARCH_URL = "https://zsks2.fzu.edu.cn/linianluqu/?zssf-0,zxkl-0=,p-1,o-1";
const PAGE_URL = (page) => `https://zsks2.fzu.edu.cn/linianluqu/?zssf-0,zxkl-0=,p-${page},o-1`;

const SOURCE = {
  id: "official-fzu-national-2018-2025-school-admission",
  quality: "official-school-fzu-2018-2025-national-html-score-only",
  schoolCode: "10386",
  schoolName: "福州大学",
  city: "福建福州",
  publisher: "福州大学招生考试中心",
  tags: ["福建", "福州", "福州大学", "211", "双一流", "省属重点", "工科"],
};

const PROVINCES = [
  "北京", "天津", "上海", "重庆", "河北", "山西", "黑龙江", "吉林", "辽宁", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "内蒙古", "广西", "西藏", "宁夏", "新疆",
];

const PROVINCE_ALIASES = new Map([
  ["北京市", "北京"],
  ["天津市", "天津"],
  ["上海市", "上海"],
  ["重庆市", "重庆"],
  ["内蒙古自治区", "内蒙古"],
  ["广西壮族自治区", "广西"],
  ["西藏自治区", "西藏"],
  ["宁夏回族自治区", "宁夏"],
  ["新疆维吾尔自治区", "新疆"],
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2018-2025-v3242-fzu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2018-2025-v3242-fzu.mjs --use-cache --concurrency 4",
    "",
    "Imports 福州大学招生考试中心 2018-2025 历年录取 HTML table data.",
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

function writeJson(relPath, value) {
  fs.writeFileSync(projectPath(relPath), `${JSON.stringify(value, null, 2)}\n`);
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

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function normalizeText(value) {
  return decodeHtml(String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\uFEFF/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProvinceName(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (PROVINCE_ALIASES.has(text)) return PROVINCE_ALIASES.get(text);
  const match = PROVINCES.find((province) => text === province || text.startsWith(province));
  return match || text.replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区)$/g, "");
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

async function requestText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || OFFICIAL_NAV_URL,
        },
        signal: AbortSignal.timeout(options.timeoutMs || 90_000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 240)}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

async function getTextRaw(rawRoot, rawFile, url, useCache, referer) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs) && fs.statSync(abs).size > 0) return fs.readFileSync(abs, "utf8");
  const text = await requestText(url, { referer });
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
  return text;
}

function pageRawRel(page) {
  return `fzu-linianluqu-p${String(page).padStart(3, "0")}.html`;
}

function extractPageCount(html) {
  const pages = [...String(html).matchAll(/p-(\d+),o-1/g)].map((match) => Number(match[1]));
  const maxPage = Math.max(1, ...pages.filter(Number.isFinite));
  if (maxPage < 2) throw new Error("Could not detect FZU admission page count");
  return maxPage;
}

function extractAdmissionTable(html) {
  const tableMatch = String(html).match(/<table\b[^>]*class=["'][^"']*\bsub_tab\b[^"']*["'][^>]*>[\s\S]*?<\/table>/i);
  if (!tableMatch) throw new Error("Could not find FZU admission result table");
  return tableMatch[0];
}

function parseCells(rowHtml) {
  return [...String(rowHtml).matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => normalizeText(match[1]));
}

function parsePage(html, rawRel, pageIndex) {
  const table = extractAdmissionTable(html);
  const title = normalizeText(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const headerCells = parseCells(String(table).match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i)?.[1] || "");
  const isAdmissionTable = headerCells.includes("最高分") && headerCells.includes("最低分") && headerCells.includes("平均分");
  if (!isAdmissionTable || !/历年录取/.test(title)) {
    return {
      rows: [],
      warnings: [{
        issue: "skipped_non_admission_table",
        pageIndex,
        title,
        headers: headerCells,
        rawFile: `${RAW_DIR}/${rawRel}`,
      }],
    };
  }
  const rows = [];
  const warnings = [];
  let rowIndex = 0;
  for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = parseCells(rowMatch[1]);
    if (!cells.length || cells[0] === "年份") continue;
    rowIndex += 1;
    if (cells.length !== 11) {
      warnings.push({ issue: "unexpected_cell_count", pageIndex, rowIndex, cells });
      continue;
    }
    rows.push({
      yearRaw: cells[0],
      provinceRaw: cells[1],
      categoryRaw: cells[2],
      subjectRaw: cells[3],
      electiveRaw: cells[4],
      majorRaw: cells[5],
      admissionCountRaw: cells[6],
      maxScoreRaw: cells[7],
      minScoreRaw: cells[8],
      avgScoreRaw: cells[9],
      remarkRaw: cells[10],
      rawFile: `${RAW_DIR}/${rawRel}`,
      pageIndex,
      rowIndex,
      cells,
    });
  }
  return { rows, warnings };
}

function normalizeSubject(row) {
  const text = `${row.subjectRaw} ${row.categoryRaw} ${row.remarkRaw}`;
  if (/体育/.test(text)) return "体育类";
  if (/艺术|美术|音乐|舞蹈|播音/.test(text)) return "艺术类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|不分文理|改革/.test(text)) return "综合";
  return normalizeText(row.subjectRaw) || "官网未列科类";
}

function classifyAdmission(row) {
  const text = `${row.categoryRaw} ${row.subjectRaw} ${row.majorRaw} ${row.remarkRaw}`;
  if (/艺术|美术|音乐|舞蹈|播音/.test(text)) return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  if (/体育|运动训练/.test(text)) return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/地方专项/.test(text)) return { admissionType: "地方专项", formalScoreScope: "special-path-only" };
  if (/中外|合作办学|梅努斯/.test(text)) return { admissionType: "中外合作办学", formalScoreScope: "special-path-only" };
  if (/闽台|地矿|预科|民族|少数民族|内高班|西藏班|定向|专项/.test(text)) return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  if (normalizeText(row.categoryRaw) && normalizeText(row.categoryRaw) !== "普通类") {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(row, classification, candidateCategoryValue) {
  const text = `${row.categoryRaw} ${row.subjectRaw} ${row.majorRaw} ${row.remarkRaw}`;
  const values = [];
  const category = normalizeText(row.categoryRaw);
  if (candidateCategoryValue) values.push(candidateCategoryValue.replace("考生", ""));
  if (category && category !== "普通类") values.push(category);
  for (const [pattern, label] of [
    [/中外|合作办学|梅努斯/, "中外合作办学"],
    [/国家专项/, "国家专项"],
    [/高校专项/, "高校专项"],
    [/地方专项/, "地方专项"],
    [/闽台/, "闽台合作"],
    [/地矿/, "地矿类"],
    [/预科/, "预科"],
    [/民族|少数民族/, "民族/少数民族"],
    [/内高班|新疆班/, "内高班/新疆班"],
    [/西藏班/, "内高班/西藏班"],
    [/定向/, "定向"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  if (classification.admissionType === "艺术类") values.push("艺术类");
  if (classification.admissionType === "体育类") values.push("体育类");
  return [...new Set(values)].join("/") || "普通";
}

function normalizeBatch(row, classification) {
  const category = normalizeText(row.categoryRaw);
  if (classification.admissionType === "国家专项") return "国家专项";
  if (classification.admissionType === "高校专项") return "高校专项";
  if (classification.admissionType === "地方专项") return "地方专项";
  if (classification.admissionType === "艺术类") return "艺术类";
  if (/专科|高职/.test(category)) return "专科批";
  return "本科批";
}

function candidateCategory(row, province) {
  const text = `${row.categoryRaw} ${row.subjectRaw} ${row.majorRaw} ${row.remarkRaw}`;
  if (province === "西藏" && /（汉）|\(汉\)|汉族/.test(text)) return "汉族考生";
  if (province === "西藏" && /（少）|\(少\)|少数民族|藏族/.test(text)) return "少数民族考生";
  return null;
}

function buildRecord(row) {
  const year = parseInteger(row.yearRaw);
  const province = normalizeProvinceName(row.provinceRaw);
  const majorName = normalizeText(row.majorRaw);
  const minScore = parseNumber(row.minScoreRaw);
  if (!year || !province || !majorName || minScore == null) return null;
  if (!PROVINCES.includes(province)) return null;
  const classification = classifyAdmission(row);
  const candidateCategoryValue = candidateCategory(row, province);
  const subjectType = normalizeSubject(row);
  const subtype = admissionSubtype(row, classification, candidateCategoryValue);
  const record = {
    id: `fzu-${stableId([year, province, row.categoryRaw, row.subjectRaw, row.electiveRaw, majorName, minScore, row.maxScoreRaw, row.avgScoreRaw, row.admissionCountRaw, row.pageIndex, row.rowIndex])}`,
    year,
    province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    batch: normalizeBatch(row, classification),
    subjectType,
    selectionRequirement: normalizeText(row.electiveRaw) || null,
    majorName,
    dataType: "major-admission",
    admissionType: classification.admissionType,
    admissionSubtype: subtype,
    formalScoreScope: classification.formalScoreScope,
    schoolOfficialScope: true,
    minScore,
    maxScore: parseNumber(row.maxScoreRaw),
    avgScore: parseNumber(row.avgScoreRaw),
    admissionCount: parseInteger(row.admissionCountRaw),
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    rankUnavailable: true,
    scoreOnly: true,
    scoreMetric: classification.formalScoreScope === "special-path-only"
      ? "最低分，按官网原表特殊类别或综合分口径"
      : "高考文化分，按官网原表口径",
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: SEARCH_URL,
    sourcePageUrl: SEARCH_URL,
    sourceIndexUrl: OFFICIAL_NAV_URL,
    sourcePageKey: `fzu-page-${String(row.pageIndex).padStart(3, "0")}`,
    sourcePageTitle: `${year}年${province}${SOURCE.schoolName}历年录取分数`,
    officialEvidencePath: row.rawFile,
    sourceProvinceRaw: normalizeText(row.provinceRaw),
    sourceCategoryRaw: normalizeText(row.categoryRaw),
    sourceSubjectRaw: normalizeText(row.subjectRaw),
    sourceElectiveRaw: normalizeText(row.electiveRaw),
    sourceMajorRaw: normalizeText(row.majorRaw),
    sourceAdmissionCountRaw: normalizeText(row.admissionCountRaw),
    sourceMaxScoreRaw: normalizeText(row.maxScoreRaw),
    sourceMinScoreRaw: normalizeText(row.minScoreRaw),
    sourceAverageScoreRaw: normalizeText(row.avgScoreRaw),
    sourceRemarkRaw: normalizeText(row.remarkRaw),
    sourceScoreColumnUsed: "minScoreHtml",
    sourceScoreColumnLabel: "最低分",
    rawRow: row,
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      "源系统未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。",
    ],
  };
  if (candidateCategoryValue) record.candidateCategory = candidateCategoryValue;
  if (classification.formalScoreScope === "special-path-only") {
    record.cautions.push("特殊路径或特殊计分口径需单独按官网、招生章程和省考试院规则复核。");
  }
  if (province === "西藏") {
    record.cautions.push(`${SOURCE.schoolName}官网西藏单校行不参与西藏自治区省级全量闭合。`);
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

function countRecords(records) {
  const counters = {
    formalScoreScopeCounts: {},
    subjectTypeCounts: {},
    provinceCounts: {},
    yearCounts: {},
    admissionTypeCounts: {},
    admissionSubtypeCounts: {},
    recordTypeCounts: {},
    scoreColumnCounts: {},
  };
  for (const record of records) {
    incrementCounter(counters.formalScoreScopeCounts, record.formalScoreScope);
    incrementCounter(counters.subjectTypeCounts, record.subjectType);
    incrementCounter(counters.provinceCounts, record.province);
    incrementCounter(counters.yearCounts, String(record.year));
    incrementCounter(counters.admissionTypeCounts, record.admissionType);
    incrementCounter(counters.admissionSubtypeCounts, record.admissionSubtype);
    incrementCounter(counters.recordTypeCounts, record.dataType);
    incrementCounter(counters.scoreColumnCounts, record.sourceScoreColumnUsed || "unknown");
  }
  return counters;
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));

  const navHtml = await getTextRaw(rawRoot, "fzu-official-admission-site.html", OFFICIAL_NAV_URL, args.useCache, OFFICIAL_NAV_URL);
  const firstHtml = await getTextRaw(rawRoot, pageRawRel(1), PAGE_URL(1), args.useCache, OFFICIAL_NAV_URL);
  if (!/福州大学招生考试中心/.test(navHtml) || !/历年录取-福州大学招生考试中心/.test(firstHtml) || !/专业名称/.test(firstHtml)) {
    throw new Error("Official FZU admission pages did not contain expected title/table evidence.");
  }

  const pageCount = extractPageCount(firstHtml);
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1);
  const pageResults = await mapLimit(pageNumbers, args.concurrency, async (page) => {
    const rawRel = pageRawRel(page);
    const html = page === 1 ? firstHtml : await getTextRaw(rawRoot, rawRel, PAGE_URL(page), args.useCache, SEARCH_URL);
    const parsed = parsePage(html, rawRel, page);
    return {
      page,
      rawRel,
      rawFile: `${RAW_DIR}/${rawRel}`,
      sha256: sha256File(path.join(rawRoot, rawRel)),
      rows: parsed.rows,
      warnings: parsed.warnings,
    };
  });

  const rawRows = pageResults.flatMap((page) => page.rows);
  const skippedRows = [];
  const rawRecords = [];
  for (const row of rawRows) {
    const province = normalizeProvinceName(row.provinceRaw);
    const record = buildRecord(row);
    if (record) {
      rawRecords.push(record);
    } else {
      skippedRows.push({
        issue: PROVINCES.includes(province) ? "skipped_missing_required_fields_or_score" : "skipped_non_mainland_gaokao_region",
        provinceRaw: row.provinceRaw,
        normalizedProvince: province,
        row,
      });
    }
  }

  const duplicateRecords = [];
  const records = [];
  const seen = new Set();
  for (const record of rawRecords) {
    const key = [
      record.year,
      record.province,
      record.sourceCategoryRaw,
      record.sourceSubjectRaw,
      record.sourceElectiveRaw,
      record.majorName,
      record.minScore,
      record.maxScore,
      record.avgScore,
      record.admissionCount,
      record.formalScoreScope,
    ].join("\t");
    if (seen.has(key)) {
      duplicateRecords.push(record);
      continue;
    }
    seen.add(key);
    records.push(record);
  }

  const rawFiles = [
    `${RAW_DIR}/fzu-official-admission-site.html`,
    ...pageResults.map((page) => page.rawFile),
  ];
  const counters = countRecords(records);
  const pageSummaries = pageResults.map((page) => ({
    page: page.page,
    rawFile: page.rawFile,
    sha256: page.sha256,
    rawRows: page.rows.length,
    parsedRecords: page.rows.map((row) => buildRecord(row)).filter(Boolean).length,
    warnings: page.warnings,
  }));
  const sourceNote = {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "福州大学招生考试中心历年录取（2018-2025）",
    url: SEARCH_URL,
    officialNavigationUrl: OFFICIAL_NAV_URL,
    quality: SOURCE.quality,
    usage:
      "学校官网单校分专业录取分数边界；可用于福州大学候选边界复核、福建/工科/211方向跨年趋势和全国单校分数加厚，不替代任何省级教育考试院全量投档/录取表。",
    rawDir: RAW_DIR,
    rawFiles,
    parsedRecords: records.length,
    rawRows: rawRows.length,
    pageCount,
    skippedRows: skippedRows.length,
    duplicateRecordsSkipped: duplicateRecords.length,
    pageSummaries,
    configSha256: {
      "fzu-official-admission-site.html": sha256File(path.join(rawRoot, "fzu-official-admission-site.html")),
      [pageRawRel(1)]: sha256File(path.join(rawRoot, pageRawRel(1))),
    },
    provincesWithRecords: Object.keys(counters.provinceCounts).sort(),
    provinceCount: Object.keys(counters.provinceCounts).length,
    years: Object.keys(counters.yearCounts).sort(),
    yearCounts: counters.yearCounts,
    subjectTypeCounts: counters.subjectTypeCounts,
    formalScoreScopeCounts: counters.formalScoreScopeCounts,
    admissionTypeCounts: counters.admissionTypeCounts,
    admissionSubtypeCounts: counters.admissionSubtypeCounts,
    recordTypeCounts: counters.recordTypeCounts,
    scoreColumnCounts: counters.scoreColumnCounts,
    scoreRange: range(records.map((record) => record.minScore)),
    rankRange: null,
    recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
    recordsWithRank: records.filter((record) => record.minRank != null).length,
    xizangRecords: records.filter((record) => record.province === "西藏").length,
    xinjiangRecords: records.filter((record) => record.province === "新疆").length,
    boundaryNotes: [
      "源系统未公开最低位次，所有新增行均保持 rankUnavailable=true。",
      "rankUnavailable=true 的行不生成假位次。",
      "港澳台侨行只保留在 skipped audit，不进入 31 省普通高考运行层。",
      "官网分页存在跨页重复行，导入时按年份、省份、科类、类别、专业、分数和原始招生人数稳定去重。",
      "普通类单校分数按 school-official-only 保存；艺术类、专项、闽台合作、中外合作、地矿类等按 special-path-only 隔离。",
      "艺术类行使用官网展示的最低分列并按特殊类别口径保留，不与普通文化分混算。",
      "西藏行作为学校官网单校候选边界保留，不当作自治区省级正式全量表。",
    ],
  };

  const output = {
    dataset: "official-national-school-admission-2018-2025-v3242-fzu",
    generatedAt: new Date().toISOString(),
    scope: {
      years: sourceNote.years,
      provinceCount: sourceNote.provinceCount,
      school: SOURCE.schoolName,
      pageCount,
    },
    notes: sourceNote.boundaryNotes,
    sourceNotes: [sourceNote],
    records,
    audit: {
      totalRecords: records.length,
      rawRows: rawRows.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      duplicateRecords: duplicateRecords.slice(0, 50),
      skippedRows,
      pageCount,
      pageWarnings: pageSummaries.flatMap((summary) => summary.warnings || []),
      ...counters,
      scoreRange: sourceNote.scoreRange,
      rankRange: sourceNote.rankRange,
      recordsRankUnavailable: sourceNote.recordsRankUnavailable,
      recordsWithRank: sourceNote.recordsWithRank,
      xizangRecords: sourceNote.xizangRecords,
      xinjiangRecords: sourceNote.xinjiangRecords,
    },
  };

  writeJson(args.out, output);
  console.log(JSON.stringify({
    out: args.out,
    records: records.length,
    rawRows: rawRows.length,
    rawRecords: rawRecords.length,
    pageCount,
    skippedRows: skippedRows.length,
    duplicateRecordsSkipped: duplicateRecords.length,
    formalScoreScopeCounts: counters.formalScoreScopeCounts,
    subjectTypeCounts: counters.subjectTypeCounts,
    recordTypeCounts: counters.recordTypeCounts,
    provinceCount: sourceNote.provinceCount,
    yearCounts: counters.yearCounts,
    admissionTypeCounts: counters.admissionTypeCounts,
    scoreColumnCounts: counters.scoreColumnCounts,
    scoreRange: sourceNote.scoreRange,
    recordsWithRank: sourceNote.recordsWithRank,
    recordsRankUnavailable: sourceNote.recordsRankUnavailable,
    xizangRecords: sourceNote.xizangRecords,
    xinjiangRecords: sourceNote.xinjiangRecords,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
