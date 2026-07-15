#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2020-2022-v3265-ustb-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2020-2022-v3265-ustb";
const OFFICIAL_HOME_URL = "https://zhaosheng.ustb.edu.cn/";
const INDEX_PAGE_URL = "https://zhaosheng.ustb.edu.cn/zkxx/lnfs/index.htm";
const FILTER_JSON_URL = "https://zhaosheng.ustb.edu.cn/data/puslishedbkzsjson/lnfsfilter.json";
const SCORE_JSON_URL = "https://zhaosheng.ustb.edu.cn/data/puslishedbkzsjson/lnfs.json";

const SOURCE = {
  id: "official-ustb-national-2020-2022-school-major-admission",
  quality: "official-school-ustb-2020-2022-national-static-json-major-score-only",
  schoolCode: "10008",
  schoolName: "北京科技大学",
  city: "北京海淀",
  publisher: "北京科技大学本科招生办公室",
  tags: ["北京", "海淀", "北京科技大学", "双一流", "211"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2020-2022-v3265-ustb.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2020-2022-v3265-ustb.mjs --use-cache",
    "",
    "Imports 北京科技大学本科招生网 2020-2022 历年分数 static JSON data.",
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

async function requestText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "text/html,application/json,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || INDEX_PAGE_URL,
        },
        signal: AbortSignal.timeout(options.timeoutMs || 180_000),
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

async function getTextRaw(rawRoot, rawFile, url, useCache, options = {}) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs) && fs.statSync(abs).size > 0) return fs.readFileSync(abs, "utf8");
  const text = await requestText(url, options);
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
  return text;
}

function normalizeSubject(rawType) {
  const text = normalizeText(rawType);
  if (/艺术|美术|音乐|舞蹈|播音|书法|设计|戏剧/.test(text)) return "艺术类";
  if (/文史|历史/.test(text)) return "历史类";
  if (/理工|物理/.test(text)) return "物理类";
  if (/综合|改革|不分文理/.test(text)) return "综合";
  if (/专项|民族班|少数民族|预科|单列|定向|中外合作|合作办学/.test(text)) return "官网未列科类";
  return text || "官网未列科类";
}

function classifyAdmission(rawType) {
  const text = normalizeText(rawType);
  if (/艺术|美术|音乐|舞蹈|播音|书法|设计|戏剧/.test(text)) {
    return { admissionType: "艺术类", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) {
    return { admissionType: "国家专项", admissionSubtype: "国家专项", formalScoreScope: "special-path-only" };
  }
  if (/地方专项/.test(text)) {
    return { admissionType: "地方专项", admissionSubtype: "地方专项", formalScoreScope: "special-path-only" };
  }
  if (/高校专项/.test(text)) {
    return { admissionType: "高校专项", admissionSubtype: "高校专项", formalScoreScope: "special-path-only" };
  }
  if (/专项|民族班|少数民族|预科|单列|定向|中外合作|合作办学/.test(text)) {
    return { admissionType: "特殊路径", admissionSubtype: text || "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通", formalScoreScope: "school-official-only" };
}

function candidateCategory(rawType) {
  const text = normalizeText(rawType);
  if (/（汉）|\(汉\)|汉族/.test(text)) return "汉族考生";
  if (/（少）|\(少\)|少数民族/.test(text)) return "少数民族考生";
  return "";
}

function buildRecord(row, rowIndex) {
  const year = parseInteger(row.year);
  const province = normalizeText(row.province);
  const rawType = normalizeText(row.leixing);
  const majorName = normalizeText(row.discipline);
  const admissionCount = parseInteger(row.lqnum);
  const minScore = parseNumber(row.fsx);
  const maxScore = parseNumber(row.zgf);
  if (!year || !MAINLAND_PROVINCES.has(province) || !majorName || minScore == null || minScore <= 0) return null;

  const subjectType = normalizeSubject(rawType);
  const classification = classifyAdmission(rawType);
  const category = candidateCategory(rawType);
  return {
    id: `ustb-major-${stableId([year, province, rawType, majorName, minScore, maxScore, admissionCount])}`,
    year,
    province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    campus: "",
    batch: "官网未列批次",
    subjectType,
    collegeName: "",
    majorName,
    dataType: "major-admission",
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    schoolOfficialScope: true,
    candidateCategory: category,
    admissionCount,
    minScore,
    maxScore,
    avgScore: null,
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    rankUnavailable: true,
    scoreOnly: true,
    scoreMetric: "最低分/最高分，按官网原表口径",
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: INDEX_PAGE_URL,
    sourcePageUrl: INDEX_PAGE_URL,
    sourceIndexUrl: INDEX_PAGE_URL,
    sourceJsonUrl: SCORE_JSON_URL,
    sourcePageKey: `ustb-major-${year}-${province}-${rawType}`,
    sourcePageTitle: `${year}年${province}${SOURCE.schoolName}历年分数`,
    officialEvidencePath: `${RAW_DIR}/ustb-lnfs-2020-2022.json`,
    sourceProvinceRaw: province,
    sourceProvinceFullRaw: province,
    sourceCategoryRaw: rawType,
    sourceSubjectRaw: rawType,
    sourceCampusRaw: "",
    sourceBatchRaw: "",
    sourceCollegeRaw: "",
    sourceMajorRaw: majorName,
    sourceMinScoreRaw: normalizeText(row.fsx),
    sourceMaxScoreRaw: normalizeText(row.zgf),
    sourceAvgScoreRaw: "",
    sourceMinRankRaw: "",
    sourceAdmissionCountRaw: normalizeText(row.lqnum),
    sourceCreateTimeRaw: normalizeText(row.createtime),
    sourceUpdateTimeRaw: normalizeText(row.updatetime),
    sourceRowIdRaw: normalizeText(row.id),
    rawRow: { ...row },
    cautions: [
      "学校官网单校分专业分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      "源页未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。",
      "国家专项、艺术类、民族等特殊路径保持 special-path-only，不与普通批分数混用。",
    ],
  };
}

function incrementCounter(target, key, by = 1) {
  target[key] = (target[key] || 0) + by;
}

function range(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric.length) return null;
  return { min: Math.min(...numeric), max: Math.max(...numeric) };
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
    batchCounts: {},
  };
  for (const record of records) {
    incrementCounter(counters.formalScoreScopeCounts, record.formalScoreScope);
    incrementCounter(counters.subjectTypeCounts, record.subjectType);
    incrementCounter(counters.provinceCounts, record.province);
    incrementCounter(counters.yearCounts, String(record.year));
    incrementCounter(counters.admissionTypeCounts, record.admissionType);
    incrementCounter(counters.admissionSubtypeCounts, record.admissionSubtype);
    incrementCounter(counters.recordTypeCounts, record.dataType);
    incrementCounter(counters.batchCounts, record.batch);
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
      record.sourceCategoryRaw,
      record.majorName,
      record.minScore,
      record.maxScore,
      record.admissionCount,
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

function rawTextSummary(records, counters) {
  const lines = [
    "北京科技大学本科招生网历年分数",
    `records=${records.length}`,
    `years=${Object.keys(counters.yearCounts).sort().join(",")}`,
    `provinces=${Object.keys(counters.provinceCounts).sort().join(",")}`,
    `subjects=${Object.keys(counters.subjectTypeCounts).sort().join(",")}`,
    `formalScoreScope=${JSON.stringify(counters.formalScoreScopeCounts)}`,
  ];
  for (const record of records.slice(0, 120)) {
    lines.push([record.year, record.province, record.subjectType, record.sourceCategoryRaw, record.majorName, record.minScore, record.maxScore, record.admissionCount, record.formalScoreScope].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));
  ensureDir(path.join(rawRoot, "text"));

  const indexHtml = await getTextRaw(rawRoot, "ustb-lnfs-index.html", INDEX_PAGE_URL, args.useCache, { accept: "text/html,*/*;q=0.9" });
  if (!/北京科技大学|历年分数/.test(indexHtml) || !/lnfs\.json/.test(indexHtml) || !/lnfsfilter\.json/.test(indexHtml)) {
    throw new Error("Official page no longer identifies 北京科技大学历年分数 JSON context; refusing to import.");
  }

  const filterJsonText = await getTextRaw(rawRoot, "ustb-lnfsfilter-2020-2022.json", FILTER_JSON_URL, args.useCache, {
    accept: "application/json,*/*;q=0.9",
    referer: INDEX_PAGE_URL,
  });
  const scoreJsonText = await getTextRaw(rawRoot, "ustb-lnfs-2020-2022.json", SCORE_JSON_URL, args.useCache, {
    accept: "application/json,*/*;q=0.9",
    referer: INDEX_PAGE_URL,
  });
  const filterJson = JSON.parse(filterJsonText);
  const jsonRows = JSON.parse(scoreJsonText);
  if (!Array.isArray(jsonRows)) throw new Error("北京科技大学分数 JSON did not return an array.");

  const warnings = [];
  const rawRecords = [];
  let rowIndex = 0;
  for (const row of jsonRows) {
    rowIndex += 1;
    const province = normalizeText(row.province);
    if (!MAINLAND_PROVINCES.has(province)) {
      warnings.push({ issue: "skip_non_mainland_scope", rowIndex, province, row });
      continue;
    }
    const record = buildRecord(row, rowIndex);
    if (record) rawRecords.push(record);
    else warnings.push({ issue: "skipped_missing_required_fields", rowIndex, row });
  }

  const { deduped: records, duplicates } = dedupeRecords(rawRecords);
  const counters = countRecords(records);
  const textRel = `${RAW_DIR}/text/ustb-lnfs-2020-2022.txt`;
  fs.writeFileSync(projectPath(textRel), rawTextSummary(records, counters));

  const rawFiles = [
    `${RAW_DIR}/ustb-lnfs-index.html`,
    `${RAW_DIR}/ustb-lnfsfilter-2020-2022.json`,
    `${RAW_DIR}/ustb-lnfs-2020-2022.json`,
    textRel,
  ];
  const rawSha256 = Object.fromEntries(rawFiles.map((file) => [path.basename(file), sha256File(projectPath(file))]));
  const sourceNote = {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "北京科技大学本科招生网：2020-2022年历年分数",
    url: INDEX_PAGE_URL,
    indexUrl: INDEX_PAGE_URL,
    filterJsonUrl: FILTER_JSON_URL,
    jsonUrl: SCORE_JSON_URL,
    officialNavigationUrl: OFFICIAL_HOME_URL,
    quality: SOURCE.quality,
    usage:
      "抽取北京科技大学本科招生网官方历年分数静态 JSON 中2020-2022年分省、类型、专业、录取人数、最高分和最低分；普通类型作单校专业候选边界，国家专项、艺术类、民族等特殊路径隔离为 special-path-only；源页未公开最低位次。",
    rawDir: RAW_DIR,
    rawFiles,
    rawSha256,
    parsedRecords: records.length,
    sourceRows: jsonRows.length,
    filterRows: Array.isArray(filterJson) ? filterJson.length : null,
    rawRecords: rawRecords.length,
    duplicateRecordsSkipped: duplicates.length,
    skippedRows: warnings,
    provinceCount: Object.keys(counters.provinceCounts).length,
    provincesWithRecords: Object.keys(counters.provinceCounts).sort(),
    years: Object.keys(counters.yearCounts).sort(),
    byYear: counters.yearCounts,
    byProvince: counters.provinceCounts,
    bySubjectType: counters.subjectTypeCounts,
    byBatch: counters.batchCounts,
    byFormalScoreScope: counters.formalScoreScopeCounts,
    byAdmissionType: counters.admissionTypeCounts,
    byAdmissionSubtype: counters.admissionSubtypeCounts,
    byRecordType: counters.recordTypeCounts,
    scoreRange: range(records.map((record) => record.minScore)),
    maxScoreRange: range(records.map((record) => record.maxScore)),
    admissionCountRange: range(records.map((record) => record.admissionCount)),
    admissionCountTotal: records.reduce((sum, record) => sum + (record.admissionCount || 0), 0),
    recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
    recordsWithRank: records.filter((record) => record.minRank != null).length,
    lowScoreRecordsUnder200: records.filter((record) => record.minScore < 200).length,
    ordinaryOutlierRecords: records.filter((record) => record.formalScoreScope === "school-official-only" && record.minScore > 750 && record.province !== "海南").length,
    cautions: [
      "学校官网单校分专业分数线不替代省级教育考试院全量投档/录取表。",
      "源页未公开最低位次；所有记录保持 rankUnavailable=true，不生成假位次。",
      "字段为最高分、最低分、录取人数，按官网原表口径保存。",
      "国家专项、艺术类、民族等路径保持 special-path-only。",
    ],
  };

  const output = {
    dataset: "official-national-school-admission-2020-2022-v3265-ustb",
    generatedAt: new Date().toISOString(),
    scope: {
      years: sourceNote.years,
      provinceCount: sourceNote.provinceCount,
      school: SOURCE.schoolName,
      jsonRows: jsonRows.length,
    },
    notes: sourceNote.cautions,
    sourceNotes: [sourceNote],
    records,
    audit: {
      totalRecords: records.length,
      sourceRows: jsonRows.length,
      filterRows: sourceNote.filterRows,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicates.length,
      duplicateRecords: duplicates.slice(0, 50),
      skippedRows: warnings,
      ...counters,
      scoreRange: sourceNote.scoreRange,
      maxScoreRange: sourceNote.maxScoreRange,
      admissionCountRange: sourceNote.admissionCountRange,
      admissionCountTotal: sourceNote.admissionCountTotal,
      recordsRankUnavailable: sourceNote.recordsRankUnavailable,
      recordsWithRank: sourceNote.recordsWithRank,
      lowScoreRecordsUnder200: sourceNote.lowScoreRecordsUnder200,
      ordinaryOutlierRecords: sourceNote.ordinaryOutlierRecords,
    },
  };

  writeJson(args.out, output);
  console.log(
    JSON.stringify(
      {
        out: args.out,
        sourceId: SOURCE.id,
        records: records.length,
        sourceRows: jsonRows.length,
        filterRows: sourceNote.filterRows,
        rawRecords: rawRecords.length,
        duplicateRecordsSkipped: duplicates.length,
        skippedRows: warnings.length,
        rawFiles: rawFiles.length,
        years: sourceNote.years,
        provinceCount: sourceNote.provinceCount,
        formalScoreScopeCounts: counters.formalScoreScopeCounts,
        subjectTypeCounts: counters.subjectTypeCounts,
        admissionTypeCounts: counters.admissionTypeCounts,
        scoreRange: sourceNote.scoreRange,
        maxScoreRange: sourceNote.maxScoreRange,
        admissionCountRange: sourceNote.admissionCountRange,
        admissionCountTotal: sourceNote.admissionCountTotal,
        recordsWithRank: sourceNote.recordsWithRank,
        recordsRankUnavailable: sourceNote.recordsRankUnavailable,
        ordinaryOutlierRecords: sourceNote.ordinaryOutlierRecords,
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
