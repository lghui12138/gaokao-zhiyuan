#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3258-nwnu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3258-nwnu";
const OFFICIAL_HOME_URL = "https://zsdata.nwnu.edu.cn/zsdata/lqxx/";
const INDEX_URL = "https://zsdata.nwnu.edu.cn/zsdata/lqxx/";
const SPA_URL = "https://zsdata.nwnu.edu.cn/zsdata/lqxx/#/lnfs";
const BASE_API_URL = "https://zsdata.nwnu.edu.cn/lqxx/s";
const GET_TYPE_URL = `${BASE_API_URL}/api/front/lqxx/getType`;
const GET_LIST_URL = `${BASE_API_URL}/api/front/lqxx/getList`;
const THEME_CFG_URL = `${BASE_API_URL}/api/front/infoconfig/getTheme`;
const DISPLAY_CFG_URL = `${BASE_API_URL}/api/front/infoconfig/getlqxsgz`;
const CAMPUS_CFG_URL = `${BASE_API_URL}/api/front/infoconfig/xqlxXsCfg`;

const SOURCE = {
  id: "official-nwnu-national-2025-school-admission",
  quality: "official-school-nwnu-2025-national-api-score-rank",
  schoolCode: "10736",
  schoolName: "西北师范大学",
  city: "兰州",
  publisher: "西北师范大学本科招生网",
  tags: ["甘肃", "兰州", "西北师范大学", "师范"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3258-nwnu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3258-nwnu.mjs --use-cache --concurrency 4",
    "",
    "Imports 西北师范大学 2025 历年分数 official API data.",
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

function slugify(value) {
  const text = normalizeText(value) || "blank";
  const ascii = text
    .replace(/[()（）/\\\s]+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "");
  return (ascii || sha256(text).slice(0, 10)).slice(0, 34);
}

async function requestText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "application/json,text/html,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || INDEX_URL,
          ...(options.headers || {}),
        },
        body: options.body,
        signal: AbortSignal.timeout(options.timeoutMs || 120_000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 240)}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      if (attempt < 5) await sleep(900 * attempt);
    }
  }
  throw lastError;
}

async function getTextRaw(rawRoot, rawFile, url, useCache, accept, requestOptions = {}) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs) && fs.statSync(abs).size > 0) return fs.readFileSync(abs, "utf8");
  const text = await requestText(url, { accept, ...requestOptions });
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
  return text;
}

async function postJsonRaw(rawRoot, rawFile, url, body, useCache) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs) && fs.statSync(abs).size > 0) {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  }
  const text = await requestText(url, {
    method: "POST",
    accept: "application/json,*/*;q=0.9",
    headers: {
      "content-type": "application/json;charset=utf-8",
      origin: new URL(BASE_API_URL).origin,
    },
    body: JSON.stringify(body),
  });
  const json = JSON.parse(text);
  const raw = { requestUrl: url, requestBody: body, response: json };
  fs.writeFileSync(abs, `${JSON.stringify(raw, null, 2)}\n`);
  await sleep(60);
  return raw;
}

function bodyFromRaw(raw) {
  return raw.response || raw;
}

function extractJsAssets(indexHtml) {
  const values = new Set();
  const pattern = /(?:src|href)=["']?(\/(?:(?:zscx|zsdata)\/)?lqxx\/js\/[^"' >]+\.js)/g;
  for (const match of indexHtml.matchAll(pattern)) values.add(new URL(match[1], INDEX_URL).toString());
  return [...values].sort();
}

function rawAssetFile(url) {
  return `nwnu-${path.basename(new URL(url).pathname)}`;
}

function parseTypeMapKey(key) {
  const parts = String(key).split("_");
  return {
    sf: parts[0] || "",
    nf: parts[1] || "",
    klmc: parts[2] || "",
    xqmc: parts.slice(3).join("_") || "",
  };
}

function normalizeBatch(row) {
  const batch = normalizeText(row.pcmc);
  if (/本科一批/.test(batch)) return "本科一批";
  if (/本科二批/.test(batch)) return "本科二批";
  if (/专科|高职/.test(batch)) return "专科批";
  if (/本科批/.test(batch)) return "本科批";
  if (/国家专项/.test(batch)) return "国家专项";
  if (/高校专项/.test(batch)) return "高校专项";
  if (/本科/.test(normalizeText(row.cclx))) return "本科批";
  return batch || normalizeText(row.cclx) || "本科批";
}

function normalizeSubject(rawSubject, province) {
  const text = normalizeText(rawSubject);
  if (/体育/.test(text)) return "体育类";
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|设计/.test(text)) return "艺术类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物化|物理|理工|理科/.test(text)) return "物理类";
  if (/综合|不分文理|改革/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  return text || "官网未列科类";
}

function candidateCategory(row) {
  const province = normalizeText(row.sf);
  const text = `${row.zslb || ""} ${row.pcmc || ""} ${row.klmc || ""}`;
  if (province === "西藏" && /汉/.test(text)) return "汉族考生";
  if (province === "西藏" && /少|藏族|民族/.test(text)) return "少数民族考生";
  if (/A类考生|A 类考生/.test(text)) return "A类考生";
  if (/B类考生|B 类考生/.test(text)) return "B类考生";
  return null;
}

function classifyAdmission(row) {
  const text = `${row.zslb || ""} ${row.pcmc || ""} ${row.klmc || ""} ${row.zymc || ""} ${row.xqlx || ""}`;
  const artContext = `${row.zslb || ""} ${row.pcmc || ""} ${row.klmc || ""}`;
  if (
    /艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧/.test(artContext)
    || /视觉传达设计|环境设计|产品设计|服装与服饰设计|数字媒体艺术|动画/.test(row.zymc || "")
  ) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|单考单招|单独招生|单独考试|本科单招/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/地方专项/.test(text)) return { admissionType: "地方专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/协作计划/.test(text)) return { admissionType: "协作计划", formalScoreScope: "special-path-only" };
  if (/中职|对口|旅游服务类/.test(text)) return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  if (/中外合作|合作办学|专项|预科|八协|内高班|西藏班|西藏区内|内地西藏|内地新疆|藏线|单列|南疆|新疆协作|定向|援疆|民族班|新疆班|优师|运动队|综合评价|提前批|公费师范/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(row, category) {
  const text = `${row.zslb || ""} ${row.pcmc || ""} ${row.klmc || ""} ${row.zymc || ""}`;
  const values = [];
  if (category === "汉族考生") values.push("西藏汉族");
  if (category === "少数民族考生") values.push("西藏少数民族");
  for (const [pattern, label] of [
    [/中外合作|合作办学/, "中外合作办学"],
    [/综合评价/, "综合评价录取"],
    [/公费师范/, "公费师范"],
    [/提前批/, "提前批"],
    [/国家专项/, "国家专项"],
    [/地方专项/, "地方专项"],
    [/高校专项/, "高校专项"],
    [/协作计划/, "协作计划"],
    [/中职|对口|旅游服务类/, "中职/对口"],
    [/民族班/, "民族班"],
    [/预科/, "预科"],
    [/八协/, "八协计划"],
    [/内高班|西藏班|西藏区内|内地西藏|内地新疆|新疆班|新疆协作|藏线/, "内高班/西藏班/新疆班/藏线"],
    [/定向|援疆|新疆协作/, "定向/援疆/新疆协作"],
    [/单列|南疆/, "单列/南疆"],
    [/运动队/, "运动队"],
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|视觉传达设计|环境设计|产品设计|服装与服饰设计|数字媒体艺术|动画/, "艺术类"],
    [/体育|运动训练|单考单招|单独招生|单独考试|本科单招/, "体育类"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  return [...new Set(values)].join("/") || "普通";
}

function queryRawRel(query, index) {
  const hash = stableId([query.sf, query.nf, query.klmc, query.xqmc, query.zslb]);
  return `nwnu-${query.nf}-${slugify(query.sf)}-${slugify(query.klmc)}-${slugify(query.xqmc)}-${slugify(query.zslb)}-${index}-${hash}.json`;
}

function buildQueries(typeMap) {
  const keys = Object.keys(typeMap || {});
  const hasSpecificSubject = new Set();
  for (const key of keys) {
    const { sf, nf, klmc, xqmc } = parseTypeMapKey(key);
    if (klmc && klmc !== "全部") hasSpecificSubject.add([sf, nf, xqmc].join("\t"));
  }

  const queries = [];
  const skippedAllQueries = [];
  for (const key of keys) {
    const { sf, nf, klmc, xqmc } = parseTypeMapKey(key);
    if (!sf || !nf || !klmc) {
      skippedAllQueries.push({ key, issue: "bad_typeMap_key" });
      continue;
    }
    if (!MAINLAND_PROVINCES.has(sf)) {
      skippedAllQueries.push({ key, issue: "skip_non_mainland_scope" });
      continue;
    }
    if (klmc === "全部" && hasSpecificSubject.has([sf, nf, xqmc].join("\t"))) {
      skippedAllQueries.push({ key, issue: "skip_all_subject_duplicate" });
      continue;
    }
    const categories = typeMap[key] || [];
    const concreteCategories = categories.filter((value) => value && value !== "全部");
    const selectedCategories = concreteCategories.length ? concreteCategories : categories;
    for (const zslb of selectedCategories) queries.push({ type: "lnfs", sf, nf, zslb, klmc, xqmc });
  }
  return { queries, skippedAllQueries };
}

function buildRecord(row, rawRel, query, pageIndex, rowIndex, dataType) {
  const year = parseInteger(row.nf);
  const province = normalizeText(row.sf);
  const subjectType = normalizeSubject(row.klmc, province);
  const minScore = parseNumber(row.zdf);
  const maxScore = parseNumber(row.zgf);
  const avgScore = parseNumber(row.pjf);
  const minRank = parseInteger(row.zdfwc);
  const maxRank = parseInteger(row.zgfwc);
  const admittedCount = parseInteger(row.lqrs);
  const majorName = dataType === "institution-admission"
    ? `${SOURCE.schoolName}${normalizeBatch(row)}录取概况`
    : normalizeText(row.zymc);
  if (!year || !province || !majorName || minScore == null || minScore <= 0) return null;

  const category = candidateCategory(row);
  const classification = classifyAdmission(row);
  const subtype = admissionSubtype(row, category);
  const rankUnavailable = !(minRank != null && minRank > 0);
  const idPrefix = dataType === "institution-admission" ? "nwnu-summary" : "nwnu";
  const record = {
    id: `${idPrefix}-${stableId([dataType, year, province, row.xqlx, row.zslb, row.pcmc, row.klmc, row.zygroup, majorName, minScore, minRank, rowIndex])}`,
    year,
    province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    campus: normalizeText(row.xqlx),
    batch: normalizeBatch(row),
    subjectType,
    majorName,
    dataType,
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
    scoreMetric: classification.admissionType === "艺术类" || classification.admissionType === "体育类"
      ? "综合/专业或文化分，按官网原表口径"
      : "高考文化分，按官网原表口径",
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: SPA_URL,
    sourcePageUrl: SPA_URL,
    sourceIndexUrl: INDEX_URL,
    sourcePageKey: `nwnu-${query.nf}-${query.sf}-${query.klmc}-${query.xqmc}-${query.zslb}`,
    sourcePageTitle: `${year}年${province}${SOURCE.schoolName}历年录取分数`,
    officialEvidencePath: `${RAW_DIR}/${rawRel}`,
    sourceProvinceRaw: normalizeText(row.sf),
    sourceCategoryRaw: normalizeText(row.zslb),
    sourceSubjectRaw: normalizeText(row.klmc),
    sourceCampusRaw: normalizeText(row.xqlx),
    sourceBatchRaw: normalizeText(row.pcmc),
    sourceLevelRaw: normalizeText(row.cclx),
    sourceMajorRaw: normalizeText(row.zymc),
    sourceMajorCodeRaw: normalizeText(row.zydm),
    sourceMajorGroupRaw: normalizeText(row.zygroup),
    sourceElectiveRequirementRaw: normalizeText(row.xkkm || row.xkyq),
    sourceControlLineRaw: normalizeText(row.fskzx),
    sourceMaxScoreRaw: normalizeText(row.zgf),
    sourceMinScoreRaw: normalizeText(row.zdf),
    sourceAverageScoreRaw: normalizeText(row.pjf),
    sourceMaxRankRaw: normalizeText(row.zgfwc),
    sourceMinRankRaw: normalizeText(row.zdfwc),
    sourceAdmittedCountRaw: normalizeText(row.lqrs),
    rawRow: row,
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      rankUnavailable ? "源行缺失最低位次；运行层不生成假位次或仅凭单校行输出录取概率。" : "源行公开最低分位次，但仍为单校专业边界，不能替代省级全量投档线。",
    ],
  };
  if (admittedCount != null && admittedCount > 0) record.admittedCount = admittedCount;
  if (category) record.candidateCategory = category;
  if (maxRank != null && maxRank > 0) record.sourceMaxRank = maxRank;
  const controlLine = parseNumber(row.fskzx);
  if (controlLine != null && controlLine > 0) record.sourceControlLine = controlLine;
  const elective = normalizeText(row.xkkm || row.xkyq);
  if (elective && elective !== "/") record.electiveRequirement = elective;
  if (normalizeText(row.zygroup)) record.majorGroup = normalizeText(row.zygroup);
  if (normalizeText(row.zydm)) record.majorCode = normalizeText(row.zydm);
  if (/中外合作|合作办学/.test(`${row.zslb || ""} ${row.zymc || ""}`)) {
    record.cautions.push("中外合作办学方向需结合学费、校区和培养模式复核。");
  }
  if (province === "西藏") {
    record.cautions.push(`西藏行仅为${SOURCE.schoolName}官网单校分数；汉族/少数民族候选类别保留，不参与省级全量闭合。`);
  }
  return record;
}

function parseQuery(raw, rawRel, query, pageIndex) {
  const payload = bodyFromRaw(raw);
  const list = Array.isArray(payload.list) ? payload.list : [];
  const sumList = Array.isArray(payload.sumList) ? payload.sumList : (Array.isArray(payload.sumLists) ? payload.sumLists : []);
  const records = [];
  const warnings = [];
  if (payload.code !== 200 && payload.code !== "200") {
    return {
      records,
      summary: {
        pageKey: `nwnu-${query.nf}-${query.sf}-${query.klmc}-${query.xqmc}-${query.zslb}`,
        rawFile: `${RAW_DIR}/${rawRel}`,
        query,
        responseCode: payload.code,
        dataRows: 0,
        sumRows: 0,
        parsedRecords: 0,
        warnings: [{ issue: "query_failed", msg: payload.msg || null }],
        pageIndex,
      },
    };
  }

  let rowIndex = 0;
  for (const row of list) {
    rowIndex += 1;
    const record = buildRecord(row, rawRel, query, pageIndex, rowIndex, "major-admission");
    if (record) records.push(record);
    else warnings.push({ issue: "skipped_missing_required_major_fields", rowIndex, row });
  }
  let summaryIndex = 0;
  for (const row of sumList) {
    summaryIndex += 1;
    const record = buildRecord(row, rawRel, query, pageIndex, summaryIndex, "institution-admission");
    if (record) records.push(record);
    else warnings.push({ issue: "skipped_missing_required_summary_fields", rowIndex: summaryIndex, row });
  }

  return {
    records,
    summary: {
      pageKey: `nwnu-${query.nf}-${query.sf}-${query.klmc}-${query.xqmc}-${query.zslb}`,
      year: parseInteger(query.nf),
      province: query.sf,
      subject: query.klmc,
      category: query.zslb,
      campus: query.xqmc,
      rawFile: `${RAW_DIR}/${rawRel}`,
      sha256: sha256File(projectPath(`${RAW_DIR}/${rawRel}`)),
      responseCode: payload.code,
      dataRows: list.length,
      sumRows: sumList.length,
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

  const officialHomeRawFile = "nwnu-lqxx-spa-page.html";
  let officialHomeEvidenceRaw = `${RAW_DIR}/${officialHomeRawFile}`;
  try {
    await getTextRaw(rawRoot, officialHomeRawFile, OFFICIAL_HOME_URL, args.useCache, "text/html,*/*;q=0.9", {
      referer: SPA_URL,
      timeoutMs: 18_000,
    });
  } catch (error) {
    const warningRawFile = "nwnu-lqxx-spa-fetch-warning.json";
    officialHomeEvidenceRaw = `${RAW_DIR}/${warningRawFile}`;
    fs.writeFileSync(path.join(rawRoot, warningRawFile), `${JSON.stringify({
      url: OFFICIAL_HOME_URL,
      fetchedAt: new Date().toISOString(),
      issue: "official_score_spa_unavailable_in_current_network",
      error: error instanceof Error ? error.message : String(error),
      fallbackEvidenceUrl: SPA_URL,
      boundary: "The importer does not infer data from this unavailable shell page; records are sourced from the official zsdata.nwnu.edu.cn SPA/API responses below.",
    }, null, 2)}\n`);
  }
  const officialHomeHtml = fs.existsSync(path.join(rawRoot, officialHomeRawFile))
    ? fs.readFileSync(path.join(rawRoot, officialHomeRawFile), "utf8")
    : "";
  const indexHtml = await getTextRaw(rawRoot, "nwnu-lqxx-index.html", INDEX_URL, args.useCache, "text/html,*/*;q=0.9");
  const jsFiles = [];
  for (const assetUrl of extractJsAssets(indexHtml)) {
    const rawFile = rawAssetFile(assetUrl);
    await getTextRaw(rawRoot, rawFile, assetUrl, args.useCache, "application/javascript,text/plain,*/*;q=0.9");
    jsFiles.push(`${RAW_DIR}/${rawFile}`);
  }
  if (officialHomeHtml && !/lqxx|lqcx|历年|分数|录取|招生/.test(officialHomeHtml)) {
    throw new Error("NWNU historical-score SPA shell no longer matches the expected admission-query surface; refusing to import without that evidence.");
  }

  const getTypeRaw = await postJsonRaw(rawRoot, "nwnu-getType-lnfs.json", GET_TYPE_URL, { type: "lnfs" }, args.useCache);
  const themeCfgRaw = await postJsonRaw(rawRoot, "nwnu-getTheme.json", THEME_CFG_URL, {}, args.useCache);
  const displayCfgRaw = await postJsonRaw(rawRoot, "nwnu-getlqxsgz-lnfs.json", DISPLAY_CFG_URL, { type: "lnfs" }, args.useCache);
  const campusCfgRaw = await postJsonRaw(rawRoot, "nwnu-xqlxXsCfg.json", CAMPUS_CFG_URL, {}, args.useCache);
  const typeMap = bodyFromRaw(getTypeRaw).typeMap || {};
  const { queries, skippedAllQueries } = buildQueries(typeMap);

  const rawRecords = [];
  const pageSummaries = [];
  const skippedPages = [];
  const pageResults = await mapLimit(queries, args.concurrency, async (query, index) => {
    const rawRel = queryRawRel(query, index + 1);
    try {
      const raw = await postJsonRaw(rawRoot, rawRel, GET_LIST_URL, query, args.useCache);
      return { parsed: parseQuery(raw, rawRel, query, index + 1) };
    } catch (error) {
      return {
        skipped: {
          pageIndex: index + 1,
          query,
          rawFile: `${RAW_DIR}/${rawRel}`,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
  for (let resultIndex = 0; resultIndex < pageResults.length; resultIndex += 1) {
    const result = pageResults[resultIndex];
    if (result?.parsed) {
      rawRecords.push(...result.parsed.records);
      pageSummaries.push(result.parsed.summary);
    } else if (result?.skipped) {
      skippedPages.push(result.skipped);
    } else {
      skippedPages.push({
        issue: "missing_page_result",
        query: queries[resultIndex] || null,
        rawFile: null,
        error: "Importer worker returned no result.",
      });
    }
  }

  const duplicateRecords = [];
  const records = [];
  const seenRecordKeys = new Set();
  for (const record of rawRecords) {
    const key = [
      record.dataType,
      record.year,
      record.province,
      record.campus,
      record.sourceCategoryRaw,
      record.sourceBatchRaw,
      record.subjectType,
      record.candidateCategory || "",
      record.majorGroup || "",
      record.majorName,
      record.minScore,
      record.minRank,
      record.formalScoreScope,
    ].join("\t");
    if (seenRecordKeys.has(key)) {
      duplicateRecords.push(record);
      continue;
    }
    seenRecordKeys.add(key);
    records.push(record);
  }

  const counters = countRecords(records);
  const rawFiles = [
    officialHomeEvidenceRaw,
    `${RAW_DIR}/nwnu-lqxx-index.html`,
    ...jsFiles,
    `${RAW_DIR}/nwnu-getType-lnfs.json`,
    `${RAW_DIR}/nwnu-getTheme.json`,
    `${RAW_DIR}/nwnu-getlqxsgz-lnfs.json`,
    `${RAW_DIR}/nwnu-xqlxXsCfg.json`,
    ...pageSummaries.map((summary) => summary.rawFile),
  ];

  const configSha256 = {};
  for (const rawFile of rawFiles.filter((file) => /nwnu-(lqxx-spa-page|lqxx-spa-fetch-warning|lqxx-index|getType|getTheme|getlqxsgz|xqlxXsCfg|.*\.js)/.test(file))) {
    configSha256[path.basename(rawFile)] = sha256File(projectPath(rawFile));
  }

  const sourceNotes = [
    {
      id: SOURCE.id,
      publisher: SOURCE.publisher,
      title: "西北师范大学历年分数 API（2025）",
      url: SPA_URL,
      officialHomeUrl: OFFICIAL_HOME_URL,
      quality: SOURCE.quality,
      usage:
        "学校官网单校分专业录取最高分/平均分/最低分/最低位次边界；可用于西北师范大学候选边界复核、甘肃/师范院校方向分数段趋势和全国单校分数加厚，不替代任何省级教育考试院全量投档/录取表。源表公开最低位次的行保留最低位次；缺失位次的行保持 rankUnavailable=true 且不生成假位次。",
      rawDir: RAW_DIR,
      rawFiles,
      parsedRecords: records.length,
      rawRecords: rawRecords.length,
      queryCount: queries.length,
      skippedAllQueries,
      skippedPages,
      duplicateRecordsSkipped: duplicateRecords.length,
      pageCount: pageSummaries.length,
      pageSummaries,
      configSha256,
      themeCfg: {
        homeTheme: bodyFromRaw(themeCfgRaw).homeTheme || null,
        lqcxTheme: bodyFromRaw(themeCfgRaw).lqcxTheme || null,
      },
      displayFields: bodyFromRaw(displayCfgRaw).lqxsgz || [],
      campusDisplayCfg: bodyFromRaw(campusCfgRaw).xqlxXsCfg || null,
      provincesWithRecords: Object.keys(counters.provinceCounts).sort(),
      provinceCount: Object.keys(counters.provinceCounts).length,
      years: Object.keys(counters.yearCounts).sort(),
      yearCounts: counters.yearCounts,
      subjectTypeCounts: counters.subjectTypeCounts,
      formalScoreScopeCounts: counters.formalScoreScopeCounts,
      admissionTypeCounts: counters.admissionTypeCounts,
      admissionSubtypeCounts: counters.admissionSubtypeCounts,
      recordTypeCounts: counters.recordTypeCounts,
      campusCounts: counters.campusCounts,
      scoreRange: range(records.map((record) => record.minScore)),
      rankRange: range(records.map((record) => record.minRank)),
      recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
      recordsWithRank: records.filter((record) => record.minRank != null).length,
      xizangRecords: records.filter((record) => record.province === "西藏").length,
      xinjiangRecords: records.filter((record) => record.province === "新疆").length,
      boundaryNotes: [
        "源表公开最低位次的行保留最低位次；缺失最低位次的行统一标记 rankUnavailable=true。",
        "rankUnavailable=true 的行不生成假位次；有最低位次的行仍只作单校边界复核。",
        "school-official-only 只作单校候选边界复核，不参与 formalScoreMissingProvinces 省级全量闭合。",
        "艺术体育、专项、协作计划、中外合作、预科、八协计划、内高班、西藏班、新疆班、藏线、内地西藏/新疆、单列、南疆、定向/援疆/新疆协作、运动队等特殊路径按 special-path-only 隔离。",
        "西藏/新疆特殊路径行作为学校官网单校候选边界保留，不当作省级正式全量表。",
      ],
    },
  ];

  const output = {
    dataset: "official-national-school-admission-2025-v3258-nwnu",
    generatedAt: new Date().toISOString(),
    scope: {
      years: Object.keys(counters.yearCounts).sort(),
      provinceCount: Object.keys(counters.provinceCounts).length,
      school: SOURCE.schoolName,
      queryCount: queries.length,
      sourceType: "school-official-api-score-rank",
      sourceUrl: SPA_URL,
    },
    notes: sourceNotes[0].boundaryNotes,
    sourceNotes,
    records,
    audit: {
      totalRecords: records.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      duplicateRecords: duplicateRecords.slice(0, 50),
      queryCount: queries.length,
      skippedAllQueries,
      skippedPages,
      pageCount: pageSummaries.length,
      ...counters,
      scoreRange: sourceNotes[0].scoreRange,
      rankRange: sourceNotes[0].rankRange,
      recordsRankUnavailable: sourceNotes[0].recordsRankUnavailable,
      recordsWithRank: sourceNotes[0].recordsWithRank,
      xizangRecords: sourceNotes[0].xizangRecords,
      xinjiangRecords: sourceNotes[0].xinjiangRecords,
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
    provinceCount: Object.keys(counters.provinceCounts).length,
    yearCounts: counters.yearCounts,
    scoreRange: sourceNotes[0].scoreRange,
    rankRange: sourceNotes[0].rankRange,
    recordsWithRank: sourceNotes[0].recordsWithRank,
    recordsRankUnavailable: sourceNotes[0].recordsRankUnavailable,
    xizangRecords: sourceNotes[0].xizangRecords,
    xinjiangRecords: sourceNotes[0].xinjiangRecords,
    sha256: sha256File(projectPath(args.out)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
