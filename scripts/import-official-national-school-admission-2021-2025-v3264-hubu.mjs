#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2021-2025-v3264-hubu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2021-2025-v3264-hubu";
const OFFICIAL_HOME_URL = "https://zsxx.hubu.edu.cn/";
const INDEX_PAGE_URL = "https://zsxx.hubu.edu.cn/zsxx/lnfs.htm";
const MAJOR_PAGE_URL = "https://zsxx.hubu.edu.cn/fzylqfs.htm";
const MAJOR_JSON_URL = "https://zsxx.hubu.edu.cn/json_2025121915717.json";

const SOURCE = {
  id: "official-hubu-national-2021-2025-school-major-admission",
  quality: "official-school-hubu-2021-2025-national-static-json-major-filing-score-only",
  schoolCode: "10512",
  schoolName: "湖北大学",
  city: "湖北武汉",
  publisher: "湖北大学本科招生信息网",
  tags: ["湖北", "武汉", "湖北大学", "综合类", "省属重点"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2021-2025-v3264-hubu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2021-2025-v3264-hubu.mjs --use-cache",
    "",
    "Imports 湖北大学本科招生信息网 2021-2025 分省分专业录取分数 static JSON data.",
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

function stripTags(value) {
  return normalizeText(
    String(value ?? "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
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

function normalizeBatch(rawBatch) {
  const batch = normalizeText(rawBatch);
  if (/国家专项/.test(batch)) return "国家专项";
  if (/地方专项/.test(batch)) return "地方专项";
  if (/高校专项/.test(batch)) return "高校专项";
  if (/普通本科批一批|本科一批|第一批|一批|一本/.test(batch)) return "本科一批";
  if (/普通本科批|本科批/.test(batch)) return "本科批";
  return batch || "官网未列批次";
}

function normalizeSubject(rawSubject, province) {
  const text = normalizeText(rawSubject);
  if (/文史|历史/.test(text)) return "历史类";
  if (/理工|物理/.test(text)) return "物理类";
  if (/综合|改革|不分文理/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  return text || "官网未列科类";
}

function classifyAdmission(row) {
  const text = `${row.pc || ""} ${row.kl || ""} ${row.xsh || ""} ${row.zyh || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|设计|戏剧/.test(text)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|单考|单招/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/地方专项/.test(text)) return { admissionType: "地方专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/中外合作|合作办学|预科|内高班|西藏班|民族班|单列|南疆|定向|援疆|提前批|专项/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(row) {
  const text = `${row.pc || ""} ${row.kl || ""} ${row.xsh || ""} ${row.zyh || ""}`;
  const values = [];
  for (const [pattern, label] of [
    [/国家专项/, "国家专项"],
    [/地方专项/, "地方专项"],
    [/高校专项/, "高校专项"],
    [/中外合作|合作办学/, "中外合作办学"],
    [/预科/, "预科"],
    [/内高班|西藏班/, "内高班/西藏班"],
    [/单列|南疆/, "单列/南疆"],
    [/定向|援疆/, "定向/援疆"],
    [/提前批/, "提前批"],
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|设计|戏剧/, "艺术类"],
    [/体育|运动训练|单考|单招/, "体育类"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  return [...new Set(values)].join("/") || "普通";
}

function buildRecord(row, rowIndex) {
  const year = parseInteger(row.zsnd);
  const province = normalizeText(row.sy);
  const minScore = parseNumber(row.zdf);
  if (!year || !MAINLAND_PROVINCES.has(province) || minScore == null || minScore <= 0) return null;

  const rawSubject = normalizeText(row.kl);
  const subjectType = normalizeSubject(rawSubject, province);
  const batch = normalizeBatch(row.pc);
  const collegeName = normalizeText(row.xsh);
  const majorName = normalizeText(row.zyh);
  if (!majorName) return null;

  const classification = classifyAdmission(row);
  const subtype = admissionSubtype(row);
  return {
    id: `hubu-major-${stableId([year, province, rawSubject, row.pc, collegeName, majorName, minScore, rowIndex])}`,
    year,
    province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    campus: "",
    batch,
    subjectType,
    collegeName,
    majorName,
    dataType: "major-admission",
    admissionType: classification.admissionType,
    admissionSubtype: subtype,
    formalScoreScope: classification.formalScoreScope,
    schoolOfficialScope: true,
    minScore,
    maxScore: null,
    avgScore: null,
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    rankUnavailable: true,
    scoreOnly: true,
    scoreMetric: "最低投档成绩，按官网原表口径",
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: MAJOR_PAGE_URL,
    sourcePageUrl: MAJOR_PAGE_URL,
    sourceIndexUrl: INDEX_PAGE_URL,
    sourcePageKey: `hubu-major-${year}-${province}-${rawSubject}`,
    sourcePageTitle: `${year}年${province}${SOURCE.schoolName}分省分专业录取分数`,
    officialEvidencePath: `${RAW_DIR}/hubu-major-score-2021-2025.json`,
    sourceProvinceRaw: province,
    sourceProvinceFullRaw: normalizeText(row.sy1),
    sourceCategoryRaw: "",
    sourceSubjectRaw: rawSubject,
    sourceCampusRaw: "",
    sourceBatchRaw: normalizeText(row.pc),
    sourceCollegeRaw: collegeName,
    sourceMajorRaw: majorName,
    sourceMinScoreRaw: normalizeText(row.zdf),
    sourceMinRankRaw: "",
    rawRow: { ...row },
    cautions: [
      "学校官网单校分专业分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      "源行未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。",
      "该表字段为最低投档成绩，按湖北大学官网原始口径保存。",
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
      record.sourceSubjectRaw,
      record.sourceBatchRaw,
      record.sourceCollegeRaw,
      record.majorName,
      record.minScore,
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

function rawTextSummary(records, counters) {
  const lines = [
    "湖北大学本科招生信息网分省分专业录取分数",
    `records=${records.length}`,
    `years=${Object.keys(counters.yearCounts).sort().join(",")}`,
    `provinces=${Object.keys(counters.provinceCounts).sort().join(",")}`,
    `subjects=${Object.keys(counters.subjectTypeCounts).sort().join(",")}`,
    `formalScoreScope=${JSON.stringify(counters.formalScoreScopeCounts)}`,
  ];
  for (const record of records.slice(0, 120)) {
    lines.push([record.year, record.province, record.subjectType, record.batch, record.collegeName, record.majorName, record.minScore, record.formalScoreScope].join("\t"));
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

  const indexHtml = await getTextRaw(rawRoot, "hubu-lnfs-index.html", INDEX_PAGE_URL, args.useCache, { accept: "text/html,*/*;q=0.9" });
  const majorHtml = await getTextRaw(rawRoot, "hubu-major-score-page.html", MAJOR_PAGE_URL, args.useCache, { accept: "text/html,*/*;q=0.9" });
  if (!/湖北大学本科招生信息网/.test(indexHtml) || !/分专业录取分数/.test(majorHtml) || !/json_2025121915717\.json/.test(majorHtml)) {
    throw new Error("Official pages no longer identify 湖北大学分专业录取分数 JSON context; refusing to import.");
  }

  const majorJsonText = await getTextRaw(rawRoot, "hubu-major-score-2021-2025.json", MAJOR_JSON_URL, args.useCache, {
    accept: "application/json,*/*;q=0.9",
    referer: MAJOR_PAGE_URL,
  });
  const jsonRows = JSON.parse(majorJsonText);
  if (!Array.isArray(jsonRows)) throw new Error("湖北大学 JSON did not return an array.");

  const warnings = [];
  const rawRecords = [];
  let rowIndex = 0;
  for (const row of jsonRows) {
    rowIndex += 1;
    const province = normalizeText(row.sy);
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
  const textRel = `${RAW_DIR}/text/hubu-major-score-2021-2025.txt`;
  fs.writeFileSync(projectPath(textRel), rawTextSummary(records, counters));

  const rawFiles = [
    `${RAW_DIR}/hubu-lnfs-index.html`,
    `${RAW_DIR}/hubu-major-score-page.html`,
    `${RAW_DIR}/hubu-major-score-2021-2025.json`,
    textRel,
  ];
  const rawSha256 = Object.fromEntries(rawFiles.map((file) => [path.basename(file), sha256File(projectPath(file))]));
  const sourceNote = {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "湖北大学本科招生信息网：2021-2025年分省分专业录取分数",
    url: MAJOR_PAGE_URL,
    indexUrl: INDEX_PAGE_URL,
    jsonUrl: MAJOR_JSON_URL,
    officialNavigationUrl: OFFICIAL_HOME_URL,
    quality: SOURCE.quality,
    usage:
      "抽取湖北大学本科招生信息网官方分省分专业录取分数静态 JSON 中2021-2025年分省、科类、学院、专业和最低投档成绩；普通专业作单校专业候选边界，国家专项等特殊路径隔离为 special-path-only；源页未公开最低位次。",
    rawDir: RAW_DIR,
    rawFiles,
    rawSha256,
    parsedRecords: records.length,
    sourceRows: jsonRows.length,
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
    recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
    recordsWithRank: records.filter((record) => record.minRank != null).length,
    lowScoreRecordsUnder200: records.filter((record) => record.minScore < 200).length,
    ordinaryOutlierRecords: records.filter((record) => record.formalScoreScope === "school-official-only" && record.minScore > 750 && record.province !== "海南").length,
    cautions: [
      "学校官网单校分专业分数线不替代省级教育考试院全量投档/录取表。",
      "源页未公开最低位次；所有记录保持 rankUnavailable=true，不生成假位次。",
      "字段为最低投档成绩，按官网原表口径保存。",
      "国家专项、地方专项、高校专项等路径保持 special-path-only。",
      "该源覆盖27个省级口径；缺失省份不补假记录。",
    ],
  };

  const output = {
    dataset: "official-national-school-admission-2021-2025-v3264-hubu",
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
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicates.length,
      duplicateRecords: duplicates.slice(0, 50),
      skippedRows: warnings,
      ...counters,
      scoreRange: sourceNote.scoreRange,
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
        rawRecords: rawRecords.length,
        duplicateRecordsSkipped: duplicates.length,
        skippedRows: warnings.length,
        rawFiles: rawFiles.length,
        years: sourceNote.years,
        provinceCount: sourceNote.provinceCount,
        formalScoreScopeCounts: counters.formalScoreScopeCounts,
        subjectTypeCounts: counters.subjectTypeCounts,
        batchCounts: counters.batchCounts,
        scoreRange: sourceNote.scoreRange,
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
