#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2021-2025-v3241-zjut-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2021-2025-v3241-zjut";
const OFFICIAL_NAV_URL = "https://zs.zjut.edu.cn/";
const SEARCH_URL = "https://zs.zjut.edu.cn/jsp/lnzssearch.jsp";
const API_URL = "https://zs.zjut.edu.cn/lncjList.action";

const SOURCE = {
  id: "official-zjut-national-2021-2025-school-admission",
  quality: "official-school-zjut-2021-2025-national-jsp-score-only",
  schoolCode: "10337",
  schoolName: "浙江工业大学",
  city: "浙江杭州",
  publisher: "浙江工业大学招生办公室",
  tags: ["浙江", "杭州", "浙江工业大学", "省属重点", "工科"],
};

const PROVINCES = [
  "北京", "天津", "上海", "重庆", "河北", "山西", "黑龙江", "吉林", "辽宁", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "内蒙古", "广西", "西藏", "宁夏", "新疆",
];
const YEARS = ["2021", "2022", "2023", "2024", "2025"];
const CATEGORIES = ["普通类", "国家专项", "三位一体", "艺术类", "新疆班"];
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
  ["新疆普通类", "新疆"],
  ["新疆内地班", "新疆"],
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2021-2025-v3241-zjut.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2021-2025-v3241-zjut.mjs --use-cache --concurrency 4",
    "",
    "Imports 浙江工业大学本科招生网 2021-2025 历年录取查询系统 official score-only data.",
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
      if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 10) {
        throw new Error("Invalid --concurrency; expected 1..10");
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

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProvinceName(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (PROVINCE_ALIASES.has(text)) return PROVINCE_ALIASES.get(text);
  const match = PROVINCES.find((province) => text === province || text.startsWith(province));
  return match || text;
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

function slugify(value) {
  const text = normalizeText(value) || "blank";
  const ascii = text.replace(/[()（）/\\\s]+/g, "-").replace(/[^A-Za-z0-9_-]/g, "");
  return (ascii || sha256(text).slice(0, 10)).slice(0, 34);
}

async function requestText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "application/json,text/html,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: SEARCH_URL,
          "x-requested-with": "XMLHttpRequest",
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(options.timeoutMs || 90_000),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 240)}`);
      }
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

async function getTextRaw(rawRoot, rawFile, url, useCache, accept) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs) && fs.statSync(abs).size > 0) return fs.readFileSync(abs, "utf8");
  const text = await requestText(url, { accept });
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
  return text;
}

function queryUrl(query, page, limit) {
  const url = new URL(API_URL);
  url.searchParams.set("sf", query.province);
  url.searchParams.set("year", query.year);
  url.searchParams.set("lb", query.category);
  url.searchParams.set("sort", "zb");
  url.searchParams.set("order", "desc");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

function queryRawRel(query, page) {
  const hash = stableId([query.province, query.year, query.category, page]);
  return `zjut-${query.year}-${slugify(query.province)}-${slugify(query.category)}-p${page}-${hash}.json`;
}

async function fetchQueryRaw(rawRoot, query, page, limit, useCache) {
  const rawRel = queryRawRel(query, page);
  const abs = path.join(rawRoot, rawRel);
  if (useCache && fs.existsSync(abs) && fs.statSync(abs).size > 0) {
    return { rawRel, raw: JSON.parse(fs.readFileSync(abs, "utf8")) };
  }
  const url = queryUrl(query, page, limit);
  const text = await requestText(url, { accept: "application/json,*/*;q=0.9" });
  const json = JSON.parse(text);
  const raw = { requestUrl: url, query: { ...query, page, limit }, response: json };
  fs.writeFileSync(abs, `${JSON.stringify(raw, null, 2)}\n`);
  return { rawRel, raw };
}

function normalizeBatch(row) {
  const batch = normalizeText(row.pc);
  if (/提前/.test(batch)) return "提前批";
  if (/本科一批/.test(batch)) return "本科一批";
  if (/本科二批|二本/.test(batch)) return "本科二批";
  if (/专科|高职/.test(batch)) return "专科批";
  if (/本科/.test(batch)) return "本科批";
  if (row.lb === "国家专项") return "国家专项";
  if (row.lb === "三位一体") return "三位一体";
  if (row.lb === "艺术类") return "艺术类";
  return batch || normalizeText(row.type) || "官网未列批次";
}

function normalizeSubject(row) {
  const text = normalizeText(row.kl);
  if (/体育/.test(text)) return "体育类";
  if (/艺术|美术|音乐|舞蹈|播音|设计/.test(text)) return "艺术类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|不分文理|改革/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(row.sf)) return "综合";
  return text || "官网未列科类";
}

function candidateCategory(row) {
  const text = `${row.kl || ""} ${row.pc || ""} ${row.lb || ""}`;
  if (normalizeProvinceName(row.sf) === "西藏" && /（汉）|\(汉\)|汉族/.test(text)) return "汉族考生";
  if (normalizeProvinceName(row.sf) === "西藏" && /（少）|\(少\)|少数民族|民/.test(text)) return "少数民族考生";
  return null;
}

function isArtAdmission(row) {
  const pathwayText = `${row.lb || ""} ${row.type || ""} ${row.pc || ""} ${row.kl || ""}`;
  return /艺术|美术|音乐|舞蹈|播音/.test(pathwayText);
}

function classifyAdmission(row) {
  const text = `${row.lb || ""} ${row.type || ""} ${row.pc || ""} ${row.kl || ""} ${row.zymc || ""}`;
  if (isArtAdmission(row)) return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  if (/体育|运动训练/.test(text)) return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  if (/三位一体/.test(text)) return { admissionType: "三位一体", formalScoreScope: "special-path-only" };
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/新疆班|内高班|西藏班|预科|民族班|定向|专项/.test(text)) return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  if (/中外合作|合作办学/.test(text)) return { admissionType: "中外合作办学", formalScoreScope: "special-path-only" };
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(row, category) {
  const text = `${row.lb || ""} ${row.type || ""} ${row.pc || ""} ${row.kl || ""} ${row.zymc || ""}`;
  const values = [];
  if (category === "汉族考生") values.push("西藏汉族");
  if (category === "少数民族考生") values.push("西藏少数民族");
  for (const [pattern, label] of [
    [/中外合作|合作办学/, "中外合作办学"],
    [/三位一体/, "三位一体"],
    [/国家专项/, "国家专项"],
    [/新疆班|内高班/, "内高班/新疆班"],
    [/西藏班/, "内高班/西藏班"],
    [/预科/, "预科"],
    [/定向/, "定向"],
    [/体育|运动训练/, "体育类"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  if (isArtAdmission(row)) values.push("艺术类");
  return [...new Set(values)].join("/") || "普通";
}

function selectScore(row, classification) {
  const fields = classification.admissionType === "三位一体"
    ? [["zhf", "综合分"], ["gkcj", "高考成绩"], ["zdf", "最低分"]]
    : classification.admissionType === "艺术类" || classification.admissionType === "体育类"
      ? [["zhf", "综合分"], ["zdf", "最低分"], ["whf", "文化分"], ["zyf", "专业分"]]
      : [["zdf", "最低分"], ["zhf", "综合分"], ["gkcj", "高考成绩"]];
  for (const [field, label] of fields) {
    const value = parseNumber(row[field]);
    if (value != null && value > 0) return { score: value, field, label };
  }
  return { score: null, field: null, label: null };
}

function buildRecord(row, rawRel, query, pageIndex, rowIndex) {
  const year = parseInteger(row.year);
  const province = normalizeProvinceName(row.sf);
  const majorName = normalizeText(row.zymc);
  const classification = classifyAdmission(row);
  const selected = selectScore(row, classification);
  if (!year || !province || !majorName || selected.score == null) return null;
  const category = candidateCategory(row);
  const subtype = admissionSubtype(row, category);
  const subjectType = normalizeSubject(row);
  const record = {
    id: `zjut-${stableId([year, province, row.lb, row.type, row.pc, row.kl, row.zb, majorName, selected.field, selected.score, row.id])}`,
    year,
    province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    batch: normalizeBatch(row),
    subjectType,
    majorName,
    dataType: "major-admission",
    admissionType: classification.admissionType,
    admissionSubtype: subtype,
    formalScoreScope: classification.formalScoreScope,
    schoolOfficialScope: true,
    minScore: selected.score,
    maxScore: parseNumber(row.zgf),
    avgScore: parseNumber(row.pjf),
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    rankUnavailable: true,
    scoreOnly: true,
    scoreMetric: classification.formalScoreScope === "special-path-only"
      ? `${selected.label}，按官网原表特殊类别口径`
      : "高考文化分，按官网原表口径",
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: SEARCH_URL,
    sourcePageUrl: SEARCH_URL,
    sourceIndexUrl: OFFICIAL_NAV_URL,
    sourcePageKey: `zjut-${query.year}-${query.province}-${query.category}`,
    sourcePageTitle: `${year}年${province}${SOURCE.schoolName}历年录取分数`,
    officialEvidencePath: `${RAW_DIR}/${rawRel}`,
    sourceProvinceRaw: normalizeText(row.sf),
    sourceCategoryRaw: normalizeText(row.lb),
    sourceSubjectRaw: normalizeText(row.kl),
    sourceBatchRaw: normalizeText(row.pc),
    sourceTypeRaw: normalizeText(row.type),
    sourceGroupRaw: normalizeText(row.zb),
    sourceMajorRaw: normalizeText(row.zymc),
    sourceAdmissionCountRaw: normalizeText(row.lqs),
    sourcePlanCountRaw: normalizeText(row.jhs),
    sourceMaxScoreRaw: normalizeText(row.zgf),
    sourceMinScoreRaw: normalizeText(row.zdf),
    sourceAverageScoreRaw: normalizeText(row.pjf),
    sourceCompositeScoreRaw: normalizeText(row.zhf),
    sourceProfessionalScoreRaw: normalizeText(row.zyf),
    sourceCultureScoreRaw: normalizeText(row.whf),
    sourceGaokaoScoreRaw: normalizeText(row.gkcj),
    sourceInterviewScoreRaw: normalizeText(row.mscj),
    sourceAcademicTestScoreRaw: normalizeText(row.hkcj),
    sourceScoreColumnUsed: selected.field,
    sourceScoreColumnLabel: selected.label,
    rawRow: row,
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      "源系统未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。",
    ],
  };
  if (category) record.candidateCategory = category;
  if (classification.formalScoreScope === "special-path-only") {
    record.cautions.push("特殊路径或特殊计分口径需单独按官网、招生章程和省考试院规则复核。");
  }
  if (province === "西藏") {
    record.cautions.push(`${SOURCE.schoolName}官网西藏单校行不参与西藏自治区省级全量闭合。`);
  }
  return record;
}

function parseQuery(raw, rawRel, query, pageIndex) {
  const payload = raw.response || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const records = [];
  const warnings = [];
  let rowIndex = 0;
  for (const row of rows) {
    rowIndex += 1;
    const record = buildRecord(row, rawRel, query, pageIndex, rowIndex);
    if (record) records.push(record);
    else warnings.push({ issue: "skipped_missing_required_fields", rowIndex, row });
  }
  return {
    records,
    summary: {
      pageKey: `zjut-${query.year}-${query.province}-${query.category}-p${pageIndex}`,
      year: parseInteger(query.year),
      province: query.province,
      category: query.category,
      rawFile: `${RAW_DIR}/${rawRel}`,
      sha256: sha256File(projectPath(`${RAW_DIR}/${rawRel}`)),
      total: parseInteger(payload.total),
      rows: rows.length,
      parsedRecords: records.length,
      warnings,
      pageIndex,
    },
  };
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

  const navHtml = await getTextRaw(rawRoot, "zjut-official-admission-site.html", OFFICIAL_NAV_URL, args.useCache, "text/html,*/*;q=0.9");
  const searchHtml = await getTextRaw(rawRoot, "zjut-lnzssearch.html", SEARCH_URL, args.useCache, "text/html,*/*;q=0.9");
  if (!/浙江工业大学本科招生网/.test(navHtml) || !/历年录取查询系统/.test(searchHtml) || !/lncjList\.action/.test(searchHtml)) {
    throw new Error("Official ZJUT admission pages did not contain expected title/query-system evidence.");
  }

  const queries = [];
  for (const province of PROVINCES) {
    for (const year of YEARS) {
      for (const category of CATEGORIES) queries.push({ province, year, category });
    }
  }

  const limit = 500;
  const pageResults = await mapLimit(queries, args.concurrency, async (query, index) => {
    const pages = [];
    try {
      const first = await fetchQueryRaw(rawRoot, query, 1, limit, args.useCache);
      pages.push(first);
      const total = parseInteger(first.raw?.response?.total) || 0;
      const pageCount = Math.max(1, Math.ceil(total / limit));
      for (let page = 2; page <= pageCount; page += 1) {
        pages.push(await fetchQueryRaw(rawRoot, query, page, limit, args.useCache));
      }
      return { query, queryIndex: index + 1, pages };
    } catch (error) {
      return {
        query,
        queryIndex: index + 1,
        skipped: {
          query,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  const rawRecords = [];
  const pageSummaries = [];
  const skippedPages = [];
  for (const result of pageResults) {
    if (result?.skipped) {
      skippedPages.push(result.skipped);
      continue;
    }
    for (const page of result.pages) {
      const parsed = parseQuery(page.raw, page.rawRel, result.query, pageSummaries.length + 1);
      rawRecords.push(...parsed.records);
      pageSummaries.push(parsed.summary);
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
      record.subjectType,
      record.sourceGroupRaw,
      record.majorName,
      record.minScore,
      record.formalScoreScope,
      record.sourceScoreColumnUsed,
    ].join("\t");
    if (seen.has(key)) {
      duplicateRecords.push(record);
      continue;
    }
    seen.add(key);
    records.push(record);
  }

  const rawFiles = [
    `${RAW_DIR}/zjut-official-admission-site.html`,
    `${RAW_DIR}/zjut-lnzssearch.html`,
    ...pageSummaries.map((summary) => summary.rawFile),
  ];
  const counters = countRecords(records);
  const configSha256 = {};
  for (const rawFile of rawFiles.filter((file) => /zjut-(official-admission-site|lnzssearch)/.test(file))) {
    configSha256[path.basename(rawFile)] = sha256File(projectPath(rawFile));
  }

  const sourceNote = {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "浙江工业大学本科招生网历年录取查询系统（2021-2025）",
    url: SEARCH_URL,
    officialNavigationUrl: OFFICIAL_NAV_URL,
    quality: SOURCE.quality,
    usage:
      "学校官网单校分专业录取分数边界；可用于浙江工业大学候选边界复核、工科方向分数段趋势和全国单校分数加厚，不替代任何省级教育考试院全量投档/录取表。",
    rawDir: RAW_DIR,
    rawFiles,
    parsedRecords: records.length,
    rawRecords: rawRecords.length,
    queryCount: queries.length,
    skippedPages,
    duplicateRecordsSkipped: duplicateRecords.length,
    pageCount: pageSummaries.length,
    pageSummaries,
    configSha256,
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
      "普通类单校分数按 school-official-only 保存；国家专项、三位一体、艺术类、新疆班、中外合作等按 special-path-only 隔离。",
      "艺术类和三位一体行使用官网展示的综合分列，保留 sourceScoreColumnUsed，不与普通文化分混算。",
      "西藏行作为学校官网单校候选边界保留，不当作自治区省级正式全量表。",
    ],
  };

  const output = {
    dataset: "official-national-school-admission-2021-2025-v3241-zjut",
    generatedAt: new Date().toISOString(),
    scope: {
      years: sourceNote.years,
      provinceCount: sourceNote.provinceCount,
      school: SOURCE.schoolName,
      queryCount: queries.length,
    },
    notes: sourceNote.boundaryNotes,
    sourceNotes: [sourceNote],
    records,
    audit: {
      totalRecords: records.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      duplicateRecords: duplicateRecords.slice(0, 50),
      queryCount: queries.length,
      skippedPages,
      pageCount: pageSummaries.length,
      ...counters,
      scoreRange: sourceNote.scoreRange,
      rankRange: sourceNote.rankRange,
      recordsRankUnavailable: sourceNote.recordsRankUnavailable,
      recordsWithRank: sourceNote.recordsWithRank,
      xizangRecords: sourceNote.xizangRecords,
      xinjiangRecords: sourceNote.xinjiangRecords,
      pageWarnings: pageSummaries.flatMap((summary) => summary.warnings || []),
    },
  };

  writeJson(args.out, output);
  console.log(JSON.stringify({
    out: args.out,
    records: records.length,
    rawRecords: rawRecords.length,
    queryCount: queries.length,
    pageCount: pageSummaries.length,
    skippedPages: skippedPages.length,
    duplicateRecordsSkipped: duplicateRecords.length,
    formalScoreScopeCounts: counters.formalScoreScopeCounts,
    subjectTypeCounts: counters.subjectTypeCounts,
    recordTypeCounts: counters.recordTypeCounts,
    provinceCount: sourceNote.provinceCount,
    yearCounts: counters.yearCounts,
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
