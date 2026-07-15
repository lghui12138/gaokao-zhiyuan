#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2021-2025-v3245-hnust-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2021-2025-v3245-hnust";
const OFFICIAL_HOME_URL = "https://zs.hnust.edu.cn/";
const SUMMARY_PAGE_URL = "https://zs.hnust.edu.cn/zsxx/lnfs/lngslqfsx/index.htm";
const MAJOR_PAGE_URL = "https://zs.hnust.edu.cn/zsxx/lnfs/lngzylqfsx/index.htm";
const SUMMARY_JSON_URL = "https://zs.hnust.edu.cn/puslishedbkzsjson/gsfsx.json";
const MAJOR_JSON_URL = "https://zs.hnust.edu.cn/puslishedbkzsjson/zyfsx.json";

const SOURCE = {
  id: "official-hnust-national-2021-2025-school-admission",
  quality: "official-school-hnust-2021-2025-national-static-json-score-only",
  schoolCode: "10534",
  schoolName: "湖南科技大学",
  city: "湖南湘潭",
  publisher: "湖南科技大学本科招生网",
  tags: ["湖南", "湘潭", "湖南科技大学", "综合类", "工科"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2021-2025-v3245-hnust.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2021-2025-v3245-hnust.mjs --use-cache",
    "",
    "Imports 湖南科技大学本科招生网 2021-2025 历年各省/各专业录取分数 static JSON data.",
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
        method: "GET",
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "application/json,text/html,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: SUMMARY_PAGE_URL,
        },
        signal: AbortSignal.timeout(options.timeoutMs || 240_000),
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

function normalizeBatch(rawBatch) {
  const batch = normalizeText(rawBatch);
  if (/国家专项/.test(batch)) return "国家专项";
  if (/地方专项/.test(batch)) return "地方专项";
  if (/高校专项/.test(batch)) return "高校专项";
  if (/提前/.test(batch)) return "本科提前批";
  if (/本科第一批|第一批本科|本科一批|一批本科|一批|一本/.test(batch)) return "本科一批";
  if (/本科第二批|第二批本科|本科二批|二批本科|二批/.test(batch)) return "本科二批";
  if (/专科|高职/.test(batch)) return "专科批";
  if (/本科一段|一段/.test(batch)) return "本科一段";
  if (/本科批|本科普通批|普通本科批|普通类本科批|本科$|普通类$/.test(batch)) return "本科批";
  return batch || "官网未列批次";
}

function normalizeSubject(rawSubject, province) {
  const text = normalizeText(rawSubject).replace(/＋/g, "+");
  if (/体育/.test(text)) return "体育类";
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|设计/.test(text)) return "艺术类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|不分文理|改革|不限|选考/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  if (/^无$/.test(text)) return "官网未列科类";
  return text || "官网未列科类";
}

function electiveRequirement(rawSubject) {
  const text = normalizeText(rawSubject).replace(/＋/g, "+");
  if (!text || /^(文史|理工|文科|理科|历史|物理|综合改革|综合|无)$/.test(text)) return null;
  if (/选考|必须|不限|政治|地理|化学|生物|\+|\/|／|第\d+组/.test(text)) return text;
  return null;
}

function candidateCategory(row, province) {
  const text = `${row.lqpc || ""} ${row.kelei || ""}`;
  if (province === "西藏" && /（汉）|\(汉\)|汉族/.test(text)) return "汉族考生";
  if (province === "西藏" && /（少）|\(少\)|少数民族/.test(text)) return "少数民族考生";
  if (/A类考生|A 类考生/.test(text)) return "A类考生";
  if (/B类考生|B 类考生/.test(text)) return "B类考生";
  return null;
}

function classifyAdmission(row) {
  const text = `${row.lqpc || ""} ${row.kelei || ""} ${row.zymc || ""} ${row.xymc || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/.test(text)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|单考单招|单独招生|单独考试|本科单招/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/地方专项/.test(text)) return { admissionType: "地方专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/中外合作|合作办学|专项|预科|内高班|西藏班|单列|南疆|定向|援疆|民族班|优师|公费师范|港澳台|提前批/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(row, category) {
  const text = `${row.lqpc || ""} ${row.kelei || ""} ${row.zymc || ""} ${row.xymc || ""}`;
  const values = [];
  if (category === "汉族考生") values.push("西藏汉族");
  if (category === "少数民族考生") values.push("西藏少数民族");
  for (const [pattern, label] of [
    [/中外合作|合作办学/, "中外合作办学"],
    [/国家专项/, "国家专项"],
    [/地方专项/, "地方专项"],
    [/高校专项/, "高校专项"],
    [/预科/, "预科"],
    [/内高班|西藏班/, "内高班/西藏班"],
    [/定向|援疆/, "定向/援疆"],
    [/单列|南疆/, "单列/南疆"],
    [/公费师范|优师/, "公费师范/优师"],
    [/提前批/, "提前批"],
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/, "艺术类"],
    [/体育|运动训练|单考单招|单独招生|单独考试|本科单招/, "体育类"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  return [...new Set(values)].join("/") || "普通";
}

function sourceMetric(row, classification) {
  if (classification.admissionType === "艺术类" || classification.admissionType === "体育类") {
    return "综合/专业或文化分，按官网原表口径";
  }
  if (/综合分|专业分/.test(`${row.kelei || ""} ${row.lqpc || ""}`)) {
    return "官网原表分数口径";
  }
  return "高考文化分，按官网原表口径";
}

function buildRecord(row, context, rawRel, rowIndex) {
  const year = parseInteger(context.year);
  const province = normalizeText(context.province ?? row.provice);
  const minScore = parseNumber(row.zdf);
  const maxScore = parseNumber(row.zgf);
  const avgScore = parseNumber(row.pjf);
  if (!year || !province || minScore == null || minScore <= 0) return null;

  const batch = normalizeBatch(row.lqpc);
  const rawSubject = normalizeText(row.kelei);
  const subjectType = normalizeSubject(rawSubject, province);
  const category = candidateCategory(row, province);
  const classification = classifyAdmission(row);
  const subtype = admissionSubtype(row, category);
  const dataType = context.kind === "summary" ? "institution-admission" : "major-admission";
  const majorName = dataType === "institution-admission"
    ? `${SOURCE.schoolName}${batch}${rawSubject || subjectType}录取概况`
    : normalizeText(row.zymc);
  if (!majorName) return null;

  const idPrefix = dataType === "institution-admission" ? "hnust-summary" : "hnust";
  const sourcePageTitle = dataType === "institution-admission"
    ? `${year}年${province}${SOURCE.schoolName}历年各省录取分数线`
    : `${year}年${province}${SOURCE.schoolName}历年各专业录取分数线`;
  const record = {
    id: `${idPrefix}-${stableId([dataType, year, province, row.lqpc, rawSubject, row.xymc, majorName, minScore, maxScore, avgScore, rowIndex])}`,
    year,
    province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    campus: "",
    batch,
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
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    rankUnavailable: true,
    scoreOnly: true,
    scoreMetric: sourceMetric(row, classification),
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: dataType === "institution-admission" ? SUMMARY_PAGE_URL : MAJOR_PAGE_URL,
    sourcePageUrl: dataType === "institution-admission" ? SUMMARY_PAGE_URL : MAJOR_PAGE_URL,
    sourceIndexUrl: OFFICIAL_HOME_URL,
    sourcePageKey: `hnust-${context.kind}-${year}-${province}`,
    sourcePageTitle,
    officialEvidencePath: `${RAW_DIR}/${rawRel}`,
    sourceProvinceRaw: province,
    sourceCategoryRaw: "",
    sourceSubjectRaw: rawSubject,
    sourceCampusRaw: "",
    sourceBatchRaw: normalizeText(row.lqpc),
    sourceCollegeRaw: normalizeText(row.xymc),
    sourceMajorRaw: normalizeText(row.zymc),
    sourceControlLineRaw: normalizeText(row.kzx),
    sourceMaxScoreRaw: normalizeText(row.zgf),
    sourceMinScoreRaw: normalizeText(row.zdf),
    sourceAverageScoreRaw: normalizeText(row.pjf),
    sourceMinRankRaw: "",
    rawRow: { ...row, year, provice: province },
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      "源行未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。",
    ],
  };
  const controlLine = parseNumber(row.kzx);
  if (controlLine != null && controlLine > 0) record.sourceControlLine = controlLine;
  const elective = electiveRequirement(rawSubject);
  if (elective) record.electiveRequirement = elective;
  if (category) record.candidateCategory = category;
  if (normalizeText(row.xymc)) record.collegeName = normalizeText(row.xymc);
  if (/中外合作|合作办学/.test(`${row.lqpc || ""} ${row.zymc || ""}`)) {
    record.cautions.push("中外合作办学方向需结合学费、校区和培养模式复核。");
  }
  if (province === "西藏") {
    record.cautions.push(`西藏行仅为${SOURCE.schoolName}官网单校分数；不参与自治区省级全量闭合。`);
  }
  return record;
}

function flattenSummary(data, rawRel) {
  const records = [];
  const warnings = [];
  for (const yearBlock of data) {
    const year = parseInteger(yearBlock.year);
    let rowIndex = 0;
    for (const row of yearBlock.data || []) {
      rowIndex += 1;
      const province = normalizeText(row.provice);
      if (!MAINLAND_PROVINCES.has(province)) {
        warnings.push({ kind: "summary", issue: "skip_non_mainland_scope", year, province, rowIndex, row });
        continue;
      }
      const record = buildRecord(row, { kind: "summary", year, province }, rawRel, rowIndex);
      if (record) records.push(record);
      else warnings.push({ kind: "summary", issue: "skipped_missing_required_fields", year, province, rowIndex, row });
    }
  }
  return { records, warnings };
}

function flattenMajor(data, rawRel) {
  const records = [];
  const warnings = [];
  for (const yearBlock of data) {
    const year = parseInteger(yearBlock.year);
    for (const provinceBlock of yearBlock.data || []) {
      const province = normalizeText(provinceBlock.provice);
      if (!MAINLAND_PROVINCES.has(province)) {
        warnings.push({ kind: "major", issue: "skip_non_mainland_scope", year, province, rowCount: (provinceBlock.data || []).length });
        continue;
      }
      let rowIndex = 0;
      for (const row of provinceBlock.data || []) {
        rowIndex += 1;
        const record = buildRecord(row, { kind: "major", year, province }, rawRel, rowIndex);
        if (record) records.push(record);
        else warnings.push({ kind: "major", issue: "skipped_missing_required_fields", year, province, rowIndex, row });
      }
    }
  }
  return { records, warnings };
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
      record.dataType,
      record.year,
      record.province,
      record.sourceBatchRaw,
      record.sourceSubjectRaw,
      record.sourceCollegeRaw,
      record.majorName,
      record.minScore,
      record.maxScore,
      record.avgScore,
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

  const homeHtml = await getTextRaw(rawRoot, "hnust-official-home.html", OFFICIAL_HOME_URL, args.useCache, "text/html,*/*;q=0.9");
  const summaryPageHtml = await getTextRaw(rawRoot, "hnust-summary-page.html", SUMMARY_PAGE_URL, args.useCache, "text/html,*/*;q=0.9");
  const majorPageHtml = await getTextRaw(rawRoot, "hnust-major-page.html", MAJOR_PAGE_URL, args.useCache, "text/html,*/*;q=0.9");
  if (!/湖南科技大学|本科招生/.test(homeHtml) || !/历年各省录取分数线/.test(summaryPageHtml) || !/历年各专业录取分数线/.test(majorPageHtml)) {
    throw new Error("Official pages no longer identify 湖南科技大学本科招生网 score context; refusing to import without that evidence.");
  }

  const summaryJsonText = await getTextRaw(rawRoot, "hnust-gsfsx.json", SUMMARY_JSON_URL, args.useCache, "application/json,*/*;q=0.9");
  const majorJsonText = await getTextRaw(rawRoot, "hnust-zyfsx.json", MAJOR_JSON_URL, args.useCache, "application/json,*/*;q=0.9");
  const summaryJson = JSON.parse(summaryJsonText);
  const majorJson = JSON.parse(majorJsonText);

  const summary = flattenSummary(summaryJson, "hnust-gsfsx.json");
  const major = flattenMajor(majorJson, "hnust-zyfsx.json");
  const rawRecords = [...summary.records, ...major.records];
  const { deduped: records, duplicates: duplicateRecords } = dedupeRecords(rawRecords);
  const counters = countRecords(records);
  const warnings = [...summary.warnings, ...major.warnings];

  const rawFiles = [
    `${RAW_DIR}/hnust-official-home.html`,
    `${RAW_DIR}/hnust-summary-page.html`,
    `${RAW_DIR}/hnust-major-page.html`,
    `${RAW_DIR}/hnust-gsfsx.json`,
    `${RAW_DIR}/hnust-zyfsx.json`,
  ];
  const rawSha256 = Object.fromEntries(rawFiles.map((file) => [path.basename(file), sha256File(projectPath(file))]));
  const sourceNotes = [
    {
      id: SOURCE.id,
      publisher: SOURCE.publisher,
      title: "湖南科技大学本科招生网历年各省/各专业录取分数线静态 JSON（2021-2025）",
      url: SUMMARY_PAGE_URL,
      majorUrl: MAJOR_PAGE_URL,
      officialNavigationUrl: OFFICIAL_HOME_URL,
      summaryJsonUrl: SUMMARY_JSON_URL,
      majorJsonUrl: MAJOR_JSON_URL,
      quality: SOURCE.quality,
      usage:
        "学校官网单校各省/分专业录取最低分边界，源表未公开最低位次；可用于湖南科技大学候选边界复核、湖南/工科/综合类方向分数段趋势和全国单校分数加厚，不替代任何省级教育考试院全量投档/录取表。",
      rawDir: RAW_DIR,
      rawFiles,
      rawSha256,
      parsedRecords: records.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      skippedRows: warnings,
      summaryRawRows: summary.records.length + summary.warnings.filter((item) => item.kind === "summary").length,
      majorRawRows: major.records.length + major.warnings.filter((item) => item.kind === "major").reduce((total, item) => total + (item.rowCount || 1), 0),
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
        "艺术体育、专项、预科、内高班、西藏班、单列、南疆、定向/援疆、提前批等特殊路径按 special-path-only 隔离。",
        "香港、台湾、港澳台联招不进入 31 省普通高考运行层，只在 skippedRows 审计中保留。",
        "西藏行仅为湖南科技大学官网单校分数，不当作自治区考试院全量正式表。",
      ],
    },
  ];

  const output = {
    dataset: "official-national-school-admission-2021-2025-v3245-hnust",
    generatedAt: new Date().toISOString(),
    scope: {
      years: Object.keys(counters.yearCounts).sort(),
      provinceCount: Object.keys(counters.provinceCounts).length,
      school: SOURCE.schoolName,
      summaryJsonRows: summary.records.length,
      majorJsonRows: major.records.length,
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
