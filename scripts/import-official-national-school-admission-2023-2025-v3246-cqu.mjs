#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2023-2025-v3246-cqu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2023-2025-v3246-cqu";
const OFFICIAL_HOME_URL = "https://zhaosheng.cqu.edu.cn/";
const QUERY_PAGE_URL = "https://zhaosheng.cqu.edu.cn/pub/desktopend/queryadmitline";
const CONDITION_URL = "https://zhaosheng.cqu.edu.cn/pub/share/getQueryConditionByAdmitLine";
const DATA_URL = "https://zhaosheng.cqu.edu.cn/pub/share/getDynamicTableDataByPage1";
const GRID_JS_URL = "https://zhaosheng.cqu.edu.cn/pub/js/fromtech/gridCommon.js?v=20251124";
const QUERY_JS_URL = "https://zhaosheng.cqu.edu.cn/pagejs/pub/desktopend/querydata/listqueryitem1.js?v=20250624";
const YEARS = [2025, 2024, 2023];

const SOURCE = {
  id: "official-cqu-national-2023-2025-school-admission",
  quality: "official-school-cqu-2023-2025-national-api-score-only",
  schoolCode: "10611",
  schoolName: "重庆大学",
  city: "重庆",
  publisher: "重庆大学招生办公室",
  tags: ["重庆", "重庆大学", "985", "211", "双一流", "综合类", "工科"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2023-2025-v3246-cqu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2023-2025-v3246-cqu.mjs --use-cache",
    "",
    "Imports 重庆大学招生办公室 2023-2025 历年分数 official query API data.",
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
        method: options.method || "GET",
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "application/json,text/html,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: QUERY_PAGE_URL,
          ...(options.headers || {}),
        },
        body: options.body,
        signal: AbortSignal.timeout(options.timeoutMs || 120_000),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 240)}`);
      }
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
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

async function postFormRaw(rawRoot, rawFile, url, data, useCache) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs) && fs.statSync(abs).size > 0) {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  }
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) body.set(key, String(value ?? ""));
  const text = await requestText(url, {
    method: "POST",
    accept: "application/json,*/*;q=0.9",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://zhaosheng.cqu.edu.cn",
    },
    body,
  });
  const json = JSON.parse(text);
  fs.writeFileSync(abs, `${JSON.stringify(json, null, 2)}\n`);
  return json;
}

function displayFieldMap(conditionRaw) {
  const map = {};
  for (const field of conditionRaw?.msg?.listDisplayField || []) {
    map[normalizeText(field.comment)] = normalizeText(field.name);
  }
  return map;
}

function normalizeProvince(rawProvince) {
  const text = normalizeText(rawProvince);
  if (/^西藏/.test(text)) return "西藏";
  return text;
}

function candidateCategory(rawProvince) {
  const text = normalizeText(rawProvince);
  if (/西藏（汉）|西藏\(汉\)|汉族/.test(text)) return "汉族考生";
  if (/西藏（民）|西藏\(民\)|少数民族|民/.test(text) && /^西藏/.test(text)) return "少数民族考生";
  return null;
}

function normalizeSubject(rawSubject, province) {
  const text = normalizeText(rawSubject).replace(/＋/g, "+");
  if (/体育/.test(text)) return "体育类";
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|设计/.test(text)) return "艺术类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|不限|选考/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  return text || "官网未列科类";
}

function electiveRequirement(rawSubject) {
  const text = normalizeText(rawSubject).replace(/＋/g, "+");
  if (!text || /^(文史|理工|文科|理科|历史|物理|综合改革|综合)$/.test(text)) return null;
  if (/再选|选考|必须|不限|政治|地理|化学|生物|\+|\/|／/.test(text)) return text;
  return null;
}

function normalizeBatch(row, values) {
  const type = values.admissionCategory;
  if (/提前批/.test(type)) return "本科提前批";
  if (/国家专项/.test(type)) return "国家专项";
  if (/高校专项/.test(type)) return "高校专项";
  if (/民族班/.test(type)) return "民族班";
  if (/南疆/.test(type)) return "南疆单列";
  return "本科批";
}

function classifyAdmission(values) {
  const text = `${values.admissionCategory || ""} ${values.subjectRaw || ""} ${values.majorName || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/.test(text)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|单考单招|单独招生|单独考试|本科单招/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/中外合作|合作办学|民族班|南疆|单列|协作计划|提前批|专项|预科|定向|援疆/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(values, category) {
  const text = `${values.admissionCategory || ""} ${values.subjectRaw || ""} ${values.majorName || ""}`;
  const valuesOut = [];
  if (category === "汉族考生") valuesOut.push("西藏汉族");
  if (category === "少数民族考生") valuesOut.push("西藏少数民族");
  for (const [pattern, label] of [
    [/中外合作|合作办学/, "中外合作办学"],
    [/国家专项/, "国家专项"],
    [/高校专项/, "高校专项"],
    [/民族班/, "民族班"],
    [/南疆|单列/, "南疆单列"],
    [/协作计划/, "新疆协作计划"],
    [/提前批/, "提前批"],
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/, "艺术类"],
    [/体育|运动训练|单考单招|单独招生|单独考试|本科单招/, "体育类"],
  ]) {
    if (pattern.test(text)) valuesOut.push(label);
  }
  return [...new Set(valuesOut)].join("/") || "普通";
}

function valueByComment(row, map, comment) {
  const key = map[comment];
  return key ? row[key] : undefined;
}

function valuesFromRow(row, map, year) {
  return {
    year,
    sourceProvinceRaw: valueByComment(row, map, "省份"),
    admissionCategory: normalizeText(valueByComment(row, map, "招生类型")),
    subjectRaw: normalizeText(valueByComment(row, map, "科类")),
    majorName: normalizeText(valueByComment(row, map, "专业名称")),
    admissionCount: parseInteger(valueByComment(row, map, "录取数")),
    admissionLine: parseNumber(valueByComment(row, map, "录取线")),
    controlLine: parseNumber(valueByComment(row, map, "特控线/一本线") ?? valueByComment(row, map, "控制线")),
    minScore: parseNumber(valueByComment(row, map, "最低分")),
    maxScore: parseNumber(valueByComment(row, map, "最高分")),
    avgScore: parseNumber(valueByComment(row, map, "平均分") ?? row.s10),
    sourceAdmissionLineRaw: normalizeText(valueByComment(row, map, "录取线")),
    sourceControlLineRaw: normalizeText(valueByComment(row, map, "特控线/一本线") ?? valueByComment(row, map, "控制线")),
    sourceMinScoreRaw: normalizeText(valueByComment(row, map, "最低分")),
    sourceMaxScoreRaw: normalizeText(valueByComment(row, map, "最高分")),
    sourceAverageScoreRaw: normalizeText(valueByComment(row, map, "平均分") ?? row.s10),
    sourceAdmissionCountRaw: normalizeText(valueByComment(row, map, "录取数")),
  };
}

function buildRecord(row, map, year, rawRel) {
  const values = valuesFromRow(row, map, year);
  const province = normalizeProvince(values.sourceProvinceRaw);
  if (!MAINLAND_PROVINCES.has(province)) return { record: null, warning: { issue: "skip_non_mainland_scope", year, province: values.sourceProvinceRaw, row } };
  if (!values.majorName || values.minScore == null || values.minScore <= 0) {
    return { record: null, warning: { issue: "skipped_missing_required_fields", year, province: values.sourceProvinceRaw, row } };
  }

  const subjectType = normalizeSubject(values.subjectRaw, province);
  const category = candidateCategory(values.sourceProvinceRaw);
  const classification = classifyAdmission(values);
  const subtype = admissionSubtype(values, category);
  const batch = normalizeBatch(row, values);
  const elective = electiveRequirement(values.subjectRaw);
  const record = {
    id: `cqu-${stableId([year, province, values.sourceProvinceRaw, values.admissionCategory, values.subjectRaw, values.majorName, values.minScore, values.maxScore, row.id])}`,
    year,
    province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    campus: "",
    batch,
    subjectType,
    majorName: values.majorName,
    dataType: "major-admission",
    admissionType: classification.admissionType,
    admissionSubtype: subtype,
    formalScoreScope: classification.formalScoreScope,
    schoolOfficialScope: true,
    minScore: values.minScore,
    maxScore: values.maxScore,
    avgScore: values.avgScore,
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    rankUnavailable: true,
    scoreOnly: true,
    scoreMetric: classification.admissionType === "艺术类" || classification.admissionType === "体育类"
      ? "综合/专业或文化分，按官网原表口径"
      : "高考文化分，按官网原表口径",
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: QUERY_PAGE_URL,
    sourcePageUrl: QUERY_PAGE_URL,
    sourceIndexUrl: OFFICIAL_HOME_URL,
    sourcePageKey: `cqu-${year}-${values.sourceProvinceRaw}-${values.admissionCategory}-${values.subjectRaw}`,
    sourcePageTitle: `${year}年${values.sourceProvinceRaw}${SOURCE.schoolName}历年录取分数`,
    officialEvidencePath: `${RAW_DIR}/${rawRel}`,
    sourceProvinceRaw: normalizeText(values.sourceProvinceRaw),
    sourceCategoryRaw: values.admissionCategory,
    sourceSubjectRaw: values.subjectRaw,
    sourceCampusRaw: "",
    sourceBatchRaw: values.admissionCategory,
    sourceMajorRaw: values.majorName,
    sourceAdmissionCountRaw: values.sourceAdmissionCountRaw,
    sourceAdmissionLineRaw: values.sourceAdmissionLineRaw,
    sourceControlLineRaw: values.sourceControlLineRaw,
    sourceMinScoreRaw: values.sourceMinScoreRaw,
    sourceMaxScoreRaw: values.sourceMaxScoreRaw,
    sourceAverageScoreRaw: values.sourceAverageScoreRaw,
    rawRow: row,
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      "源行未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。",
      "源表同时含录取线和专业最低分；运行层使用最低分字段作为 minScore，并保留录取线原值供审计。",
    ],
  };
  if (values.admissionCount != null) record.admissionCount = values.admissionCount;
  if (values.admissionLine != null) record.sourceAdmissionLine = values.admissionLine;
  if (values.controlLine != null) record.sourceControlLine = values.controlLine;
  if (category) record.candidateCategory = category;
  if (elective) record.electiveRequirement = elective;
  if (/中外合作|合作办学/.test(values.admissionCategory)) {
    record.cautions.push("中外合作办学方向需结合学费、校区和培养模式复核。");
  }
  if (province === "西藏") {
    record.cautions.push(`西藏行仅为${SOURCE.schoolName}官网单校分数；汉族/少数民族候选类别保留，不参与自治区省级全量闭合。`);
  }
  return { record, warning: null };
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
  };
  for (const record of records) {
    incrementCounter(counters.formalScoreScopeCounts, record.formalScoreScope);
    incrementCounter(counters.subjectTypeCounts, record.subjectType);
    incrementCounter(counters.provinceCounts, record.province);
    incrementCounter(counters.yearCounts, String(record.year));
    incrementCounter(counters.admissionTypeCounts, record.admissionType);
    incrementCounter(counters.admissionSubtypeCounts, record.admissionSubtype);
    incrementCounter(counters.recordTypeCounts, record.dataType);
  }
  return counters;
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];
  const duplicates = [];
  for (const record of records) {
    const key = [
      record.year,
      record.province,
      record.sourceProvinceRaw,
      record.sourceCategoryRaw,
      record.sourceSubjectRaw,
      record.majorName,
      record.minScore,
      record.maxScore,
      record.sourceAdmissionLineRaw,
      record.formalScoreScope,
    ].join("\t");
    if (seen.has(key)) {
      duplicates.push(record);
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return { deduped, duplicates };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));

  const homeHtml = await getTextRaw(rawRoot, "cqu-official-home.html", OFFICIAL_HOME_URL, args.useCache, "text/html,*/*;q=0.9");
  const queryHtml = await getTextRaw(rawRoot, "cqu-queryadmitline.html", QUERY_PAGE_URL, args.useCache, "text/html,*/*;q=0.9");
  await getTextRaw(rawRoot, "cqu-gridCommon.js", GRID_JS_URL, args.useCache, "application/javascript,text/plain,*/*;q=0.9");
  await getTextRaw(rawRoot, "cqu-listqueryitem1.js", QUERY_JS_URL, args.useCache, "application/javascript,text/plain,*/*;q=0.9");
  if (!/重庆大学|招生/.test(homeHtml) || !/历年分数/.test(queryHtml) || !/getQueryConditionByAdmitLine/.test(queryHtml)) {
    throw new Error("Official pages no longer identify 重庆大学历年分数 query context; refusing to import without that evidence.");
  }

  const rawRecords = [];
  const pageSummaries = [];
  const warnings = [];
  for (const year of YEARS) {
    const condRel = `cqu-condition-${year}.json`;
    const dataRel = `cqu-admitline-${year}-all.json`;
    const condition = await postFormRaw(rawRoot, condRel, CONDITION_URL, { year }, args.useCache);
    if (condition.code !== 0 || !condition.msg?.queryDataId) {
      warnings.push({ issue: "condition_query_failed", year, rawFile: `${RAW_DIR}/${condRel}`, condition });
      continue;
    }
    const map = displayFieldMap(condition);
    for (const required of ["省份", "招生类型", "科类", "专业名称", "最低分", "最高分"]) {
      if (!map[required]) throw new Error(`Missing display field ${required} for ${year}.`);
    }
    const data = await postFormRaw(rawRoot, dataRel, DATA_URL, {
      queryDataType: condition.msg.queryDataType,
      queryDataId: condition.msg.queryDataId,
      pageSize: 5000,
      pageIndex: 1,
      sort: "id",
      direct: "asc",
      where: "",
    }, args.useCache);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (Number(data.total) !== rows.length) {
      warnings.push({ issue: "row_count_mismatch", year, total: data.total, rows: rows.length, rawFile: `${RAW_DIR}/${dataRel}` });
    }
    for (const row of rows) {
      const { record, warning } = buildRecord(row, map, year, dataRel);
      if (record) rawRecords.push(record);
      if (warning) warnings.push({ ...warning, rawFile: `${RAW_DIR}/${dataRel}` });
    }
    pageSummaries.push({
      year,
      conditionRawFile: `${RAW_DIR}/${condRel}`,
      dataRawFile: `${RAW_DIR}/${dataRel}`,
      conditionSha256: sha256File(projectPath(`${RAW_DIR}/${condRel}`)),
      dataSha256: sha256File(projectPath(`${RAW_DIR}/${dataRel}`)),
      queryDataId: condition.msg.queryDataId,
      queryDataType: condition.msg.queryDataType,
      queryRemark: condition.msg.queryRemark,
      displayFields: condition.msg.listDisplayField,
      queryConditions: condition.msg.listQueryCondition,
      rawRows: rows.length,
    });
  }

  const { deduped: records, duplicates: duplicateRecords } = dedupeRecords(rawRecords);
  const counters = countRecords(records);
  const rawFiles = [
    `${RAW_DIR}/cqu-official-home.html`,
    `${RAW_DIR}/cqu-queryadmitline.html`,
    `${RAW_DIR}/cqu-gridCommon.js`,
    `${RAW_DIR}/cqu-listqueryitem1.js`,
    ...pageSummaries.flatMap((summary) => [summary.conditionRawFile, summary.dataRawFile]),
  ];
  const rawSha256 = Object.fromEntries(rawFiles.map((file) => [path.basename(file), sha256File(projectPath(file))]));
  const sourceNotes = [
    {
      id: SOURCE.id,
      publisher: SOURCE.publisher,
      title: "重庆大学招生办公室历年分数查询接口（2023-2025）",
      url: QUERY_PAGE_URL,
      officialNavigationUrl: OFFICIAL_HOME_URL,
      conditionUrl: CONDITION_URL,
      dataUrl: DATA_URL,
      quality: SOURCE.quality,
      usage:
        "学校官网单校分专业录取最低分边界，源表未公开最低位次；可用于重庆大学候选边界复核、985/工科/重庆方向分数段趋势和全国单校分数加厚，不替代任何省级教育考试院全量投档/录取表。",
      rawDir: RAW_DIR,
      rawFiles,
      rawSha256,
      parsedRecords: records.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      skippedRows: warnings,
      pageSummaries,
      provincesWithRecords: Object.keys(counters.provinceCounts).sort(),
      provinceCount: Object.keys(counters.provinceCounts).length,
      years: Object.keys(counters.yearCounts).sort(),
      yearCounts: counters.yearCounts,
      subjectTypeCounts: counters.subjectTypeCounts,
      formalScoreScopeCounts: counters.formalScoreScopeCounts,
      admissionTypeCounts: counters.admissionTypeCounts,
      admissionSubtypeCounts: counters.admissionSubtypeCounts,
      recordTypeCounts: counters.recordTypeCounts,
      scoreRange: range(records.map((record) => record.minScore)),
      recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
      recordsWithRank: records.filter((record) => record.minRank != null).length,
      xizangRecords: records.filter((record) => record.province === "西藏").length,
      xinjiangRecords: records.filter((record) => record.province === "新疆").length,
      lowScoreRecordsUnder200: records.filter((record) => record.minScore < 200).length,
      boundaryNotes: [
        "源表未公开最低位次；全部新增行保持 rankUnavailable=true，不生成假位次。",
        "school-official-only 只作单校候选边界复核，不参与 formalScoreMissingProvinces 省级全量闭合。",
        "国家专项、高校专项、民族班、南疆单列、新疆协作计划、中外合作、艺术类、提前批等特殊路径按 special-path-only 隔离。",
        "西藏（汉）/西藏（民）统一归一为西藏省级口径，并用 candidateCategory 保留汉族/少数民族口径；不当作自治区考试院全量正式表。",
        "源表同时含录取线和最低分；运行层使用最低分字段作为 minScore，录取线只作 sourceAdmissionLine 审计字段。",
      ],
    },
  ];

  const output = {
    dataset: "official-national-school-admission-2023-2025-v3246-cqu",
    generatedAt: new Date().toISOString(),
    scope: {
      years: Object.keys(counters.yearCounts).sort(),
      provinceCount: Object.keys(counters.provinceCounts).length,
      school: SOURCE.schoolName,
      pageCount: pageSummaries.length,
    },
    notes: sourceNotes[0].boundaryNotes,
    sourceNotes,
    records,
    audit: {
      totalRecords: records.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      duplicateRecords: duplicateRecords.slice(0, 50),
      skippedRows: warnings,
      pageSummaries,
      ...counters,
      scoreRange: sourceNotes[0].scoreRange,
      recordsRankUnavailable: sourceNotes[0].recordsRankUnavailable,
      recordsWithRank: sourceNotes[0].recordsWithRank,
      xizangRecords: sourceNotes[0].xizangRecords,
      xinjiangRecords: sourceNotes[0].xinjiangRecords,
      lowScoreRecordsUnder200: sourceNotes[0].lowScoreRecordsUnder200,
    },
  };

  writeJson(args.out, output);
  console.log(
    JSON.stringify(
      {
        out: args.out,
        records: records.length,
        rawRecords: rawRecords.length,
        duplicateRecordsSkipped: duplicateRecords.length,
        skippedRows: warnings.length,
        formalScoreScopeCounts: counters.formalScoreScopeCounts,
        subjectTypeCounts: counters.subjectTypeCounts,
        recordTypeCounts: counters.recordTypeCounts,
        provinceCount: Object.keys(counters.provinceCounts).length,
        yearCounts: counters.yearCounts,
        scoreRange: sourceNotes[0].scoreRange,
        recordsWithRank: sourceNotes[0].recordsWithRank,
        recordsRankUnavailable: sourceNotes[0].recordsRankUnavailable,
        lowScoreRecordsUnder200: sourceNotes[0].lowScoreRecordsUnder200,
        xizangRecords: sourceNotes[0].xizangRecords,
        xinjiangRecords: sourceNotes[0].xinjiangRecords,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
