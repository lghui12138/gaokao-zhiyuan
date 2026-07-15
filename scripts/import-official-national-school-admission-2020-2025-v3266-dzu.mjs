#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2020-2025-v3266-dzu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2020-2025-v3266-dzu";
const OFFICIAL_HOME_URL = "https://zs.dzu.edu.cn/";
const INDEX_PAGE_URL = "https://zs.dzu.edu.cn/index/lnfs.htm";
const DATA_VAR_PATTERN = /var\s+year_listObject\d+\s*=\s*(\[[\s\S]*?\]);/;

const SOURCE = {
  id: "official-dzu-national-2020-2025-school-major-admission",
  quality: "official-school-dzu-2020-2025-national-html-embedded-js-major-score-rank",
  schoolCode: "10448",
  schoolName: "德州学院",
  city: "山东德州",
  publisher: "德州学院本科招生信息网",
  tags: ["山东", "德州", "德州学院", "公办本科"],
};

const PROVINCE_MAP = new Map([
  ["北京市", "北京"], ["北京", "北京"],
  ["天津市", "天津"], ["天津", "天津"],
  ["河北省", "河北"], ["河北", "河北"],
  ["山西省", "山西"], ["山西", "山西"],
  ["内蒙古自治区", "内蒙古"], ["内蒙古", "内蒙古"],
  ["辽宁省", "辽宁"], ["辽宁", "辽宁"],
  ["吉林省", "吉林"], ["吉林", "吉林"],
  ["黑龙江省", "黑龙江"], ["黑龙江", "黑龙江"],
  ["上海市", "上海"], ["上海", "上海"],
  ["江苏省", "江苏"], ["江苏", "江苏"],
  ["浙江省", "浙江"], ["浙江", "浙江"],
  ["安徽省", "安徽"], ["安徽", "安徽"],
  ["福建省", "福建"], ["福建", "福建"],
  ["江西省", "江西"], ["江西", "江西"],
  ["山东省", "山东"], ["山东", "山东"],
  ["河南省", "河南"], ["河南", "河南"],
  ["湖北省", "湖北"], ["湖北", "湖北"],
  ["湖南省", "湖南"], ["湖南", "湖南"],
  ["广东省", "广东"], ["广东", "广东"],
  ["广西壮族自治区", "广西"], ["广西", "广西"],
  ["海南省", "海南"], ["海南", "海南"],
  ["重庆市", "重庆"], ["重庆", "重庆"],
  ["四川省", "四川"], ["四川", "四川"],
  ["贵州省", "贵州"], ["贵州", "贵州"],
  ["云南省", "云南"], ["云南", "云南"],
  ["西藏自治区", "西藏"], ["西藏", "西藏"],
  ["陕西省", "陕西"], ["陕西", "陕西"],
  ["甘肃省", "甘肃"], ["甘肃", "甘肃"],
  ["青海省", "青海"], ["青海", "青海"],
  ["宁夏回族自治区", "宁夏"], ["宁夏", "宁夏"],
  ["新疆维吾尔自治区", "新疆"], ["新疆", "新疆"],
]);

const MAINLAND_PROVINCES = new Set(PROVINCE_MAP.values());

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2020-2025-v3266-dzu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2020-2025-v3266-dzu.mjs --use-cache",
    "",
    "Imports 德州学院本科招生信息网 2020-2025 历年分数 embedded JS table data.",
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
  if (!text || text === "/" || text === "-" || text === "—" || text === "--" || /^无$/.test(text) || /^—+$/.test(text)) return null;
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
          referer: options.referer || OFFICIAL_HOME_URL,
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

function normalizeProvince(rawProvince) {
  const province = normalizeText(rawProvince);
  return PROVINCE_MAP.get(province) || province;
}

function normalizeSubject(rawSubject) {
  const text = normalizeText(rawSubject);
  if (/艺术|美术|音乐|舞蹈|播音|书法|设计|戏剧|服装/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/春季/.test(text)) return "春季高考";
  if (/文史|历史|文科/.test(text)) return "历史类";
  if (/理工|物理|理科/.test(text)) return "物理类";
  if (/综合|改革|不分文理|不分科类|不分科目/.test(text)) return "综合";
  return text || "官网未列科类";
}

function normalizeBatch(rawLevel) {
  const text = normalizeText(rawLevel);
  if (/专科|高职/.test(text)) return "专科批";
  if (/本科/.test(text)) return "本科批";
  return text || "官网未列批次";
}

function classifyAdmission(rawType, rawSubject, majorName) {
  const text = `${normalizeText(rawType)} ${normalizeText(rawSubject)} ${normalizeText(majorName)}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|设计|戏剧|服装/.test(text)) {
    return { admissionType: "艺术类", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育/.test(text)) {
    return { admissionType: "体育类", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/春季高考/.test(text)) {
    return { admissionType: "春季高考", admissionSubtype: "春季高考", formalScoreScope: "special-path-only" };
  }
  if (/公费师范|定向|喀什/.test(text)) {
    return { admissionType: "定向/公费师范", admissionSubtype: normalizeText(rawType) || "定向/公费师范", formalScoreScope: "special-path-only" };
  }
  if (/中外合作/.test(text)) {
    return { admissionType: "中外合作办学", admissionSubtype: "中外合作办学", formalScoreScope: "special-path-only" };
  }
  if (/校企合作/.test(text)) {
    return { admissionType: "校企合作", admissionSubtype: "校企合作", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: normalizeText(rawType) || "普通", formalScoreScope: "school-official-only" };
}

function candidateCategory(rawType) {
  const text = normalizeText(rawType);
  if (/定向喀什/.test(text)) return "喀什定向";
  if (/公费师范/.test(text)) return "公费师范生";
  return "";
}

function extractMainRows(html) {
  const match = html.match(DATA_VAR_PATTERN);
  if (!match) throw new Error("Could not find 德州学院 year_listObject embedded data.");
  const rows = JSON.parse(match[1]);
  if (!Array.isArray(rows)) throw new Error("德州学院 embedded data is not an array.");
  return rows;
}

function buildRecord(row, rowIndex) {
  const year = parseInteger(row.nf);
  const province = normalizeProvince(row.ss);
  const rawSubject = normalizeText(row.kl);
  const rawType = normalizeText(row.lx);
  const majorName = normalizeText(row.zy);
  const minScore = parseNumber(row.zdf);
  const maxScore = parseNumber(row.zgf);
  const avgScore = parseNumber(row.pjf);
  const minRankRaw = parseInteger(row.lqzdwc);
  const minRankAlt = parseInteger(row.zdfpm);
  const minRank = minRankRaw != null && minRankRaw > 0 ? minRankRaw : (minRankAlt != null && minRankAlt > 0 ? minRankAlt : null);
  const admissionCount = parseInteger(row.lqrs);
  const controlLine = parseNumber(row.kzx);
  if (!year || !MAINLAND_PROVINCES.has(province) || !majorName || minScore == null || minScore <= 0) return null;

  const subjectType = normalizeSubject(rawSubject);
  const classification = classifyAdmission(rawType, rawSubject, majorName);
  const category = candidateCategory(rawType);
  const rankUnavailable = !(minRank != null && minRank > 0);
  const record = {
    id: `dzu-major-${stableId([row._id, year, province, rawSubject, rawType, row.cc, majorName, minScore, maxScore, minRank, admissionCount])}`,
    year,
    province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    campus: "",
    batch: normalizeBatch(row.cc),
    subjectType,
    collegeName: "",
    majorName,
    dataType: "major-admission",
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
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
    scoreMetric: classification.formalScoreScope === "special-path-only"
      ? "综合/专业或文化分，按官网原表口径"
      : "高考文化分，按官网原表口径",
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: INDEX_PAGE_URL,
    sourcePageUrl: INDEX_PAGE_URL,
    sourceIndexUrl: INDEX_PAGE_URL,
    sourcePageKey: `dzu-${year}-${province}-${rawSubject}-${rawType}-${normalizeText(row.cc)}`,
    sourcePageTitle: `${year}年${province}${SOURCE.schoolName}历年分数`,
    officialEvidencePath: `${RAW_DIR}/dzu-lnfs-2020-2025.html`,
    sourceProvinceRaw: normalizeText(row.ss),
    sourceProvinceNormalized: province,
    sourceCategoryRaw: rawType,
    sourceSubjectRaw: rawSubject,
    sourceCampusRaw: "",
    sourceBatchRaw: "",
    sourceLevelRaw: normalizeText(row.cc),
    sourceMajorRaw: majorName,
    sourceMinScoreRaw: normalizeText(row.zdf),
    sourceMaxScoreRaw: normalizeText(row.zgf),
    sourceAverageScoreRaw: normalizeText(row.pjf),
    sourceMinRankRaw: normalizeText(row.lqzdwc || row.zdfpm),
    sourceAdmissionCountRaw: normalizeText(row.lqrs),
    sourceControlLineRaw: normalizeText(row.kzx),
    sourceRemarkRaw: normalizeText(row.bz),
    sourceRowIdRaw: normalizeText(row._id),
    rawRow: { ...row },
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      rankUnavailable ? "源行缺失最低位次；运行层不生成假位次或仅凭单校行输出录取概率。" : "源行公开最低分位次，但仍为单校专业边界，不能替代省级全量投档/录取表。",
    ],
  };
  if (admissionCount != null && admissionCount > 0) record.admissionCount = admissionCount;
  if (controlLine != null && controlLine > 0) record.sourceControlLine = controlLine;
  if (category) record.candidateCategory = category;
  return record;
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
      record.sourceCategoryRaw,
      record.sourceLevelRaw,
      record.majorName,
      record.minScore,
      record.maxScore,
      record.minRank,
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
    "德州学院本科招生信息网历年分数",
    `records=${records.length}`,
    `years=${Object.keys(counters.yearCounts).sort().join(",")}`,
    `provinces=${Object.keys(counters.provinceCounts).sort().join(",")}`,
    `subjects=${Object.keys(counters.subjectTypeCounts).sort().join(",")}`,
    `formalScoreScope=${JSON.stringify(counters.formalScoreScopeCounts)}`,
  ];
  for (const record of records.slice(0, 140)) {
    lines.push([record.year, record.province, record.subjectType, record.sourceCategoryRaw, record.batch, record.majorName, record.minScore, record.minRank ?? "", record.admissionCount ?? "", record.formalScoreScope].join("\t"));
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

  const indexHtml = await getTextRaw(rawRoot, "dzu-lnfs-2020-2025.html", INDEX_PAGE_URL, args.useCache, {
    accept: "text/html,*/*;q=0.9",
  });
  if (!/德州学院本科招生信息网/.test(indexHtml) || !/历年分数/.test(indexHtml) || !/year_listObject\d+/.test(indexHtml)) {
    throw new Error("Official page no longer identifies 德州学院历年分数 embedded data; refusing to import.");
  }
  const jsonRows = extractMainRows(indexHtml);
  const dataJsonRel = `${RAW_DIR}/dzu-lnfs-2020-2025-embedded-data.json`;
  writeJson(dataJsonRel, jsonRows);

  const warnings = [];
  const rawRecords = [];
  let rowIndex = 0;
  for (const row of jsonRows) {
    rowIndex += 1;
    const province = normalizeProvince(row.ss);
    if (!MAINLAND_PROVINCES.has(province)) {
      warnings.push({ issue: "skip_non_mainland_scope", rowIndex, province, row });
      continue;
    }
    const record = buildRecord(row, rowIndex);
    if (record) rawRecords.push(record);
    else warnings.push({ issue: "skipped_missing_required_fields_or_score", rowIndex, row });
  }

  const { deduped: records, duplicates } = dedupeRecords(rawRecords);
  const counters = countRecords(records);
  const textRel = `${RAW_DIR}/text/dzu-lnfs-2020-2025.txt`;
  fs.writeFileSync(projectPath(textRel), rawTextSummary(records, counters));

  const rawFiles = [
    `${RAW_DIR}/dzu-lnfs-2020-2025.html`,
    dataJsonRel,
    textRel,
  ];
  const rawSha256 = Object.fromEntries(rawFiles.map((file) => [path.basename(file), sha256File(projectPath(file))]));
  const sourceNote = {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "德州学院本科招生信息网：2020-2025年历年分数",
    url: INDEX_PAGE_URL,
    indexUrl: INDEX_PAGE_URL,
    officialNavigationUrl: OFFICIAL_HOME_URL,
    quality: SOURCE.quality,
    usage:
      "抽取德州学院本科招生信息网官方历年分数页面嵌入的前端数据表，字段包括年份、省市、科类、类型、专业、录取人数、最低分、录取最低位次、平均分、最高分和控制线；普通类作为 school-official-only 单校专业候选边界，公费师范、校企合作、中外合作、定向、艺体和春季高考等隔离为 special-path-only。",
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
    maxScoreRange: range(records.map((record) => record.maxScore)),
    avgScoreRange: range(records.map((record) => record.avgScore)),
    minRankRange: range(records.map((record) => record.minRank)),
    admissionCountRange: range(records.map((record) => record.admissionCount)),
    admissionCountTotal: records.reduce((sum, record) => sum + (record.admissionCount || 0), 0),
    recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
    recordsWithRank: records.filter((record) => record.minRank != null).length,
    lowScoreRecordsUnder150: records.filter((record) => record.minScore < 150).length,
    lowScoreRecordsUnder200: records.filter((record) => record.minScore < 200).length,
    ordinaryOutlierRecords: records.filter((record) => record.formalScoreScope === "school-official-only" && record.minScore > 750 && record.province !== "海南").length,
    cautions: [
      "学校官网单校分专业分数线不替代省级教育考试院全量投档/录取表。",
      "部分源行公开最低位次，仍只作为单校专业边界；缺位次行不生成假位次。",
      "公费师范、校企合作、中外合作、定向、艺术、体育和春季高考路径保持 special-path-only。",
      "源表中无可用最低分的行只进入 skippedRows 审计，不补造分数。",
    ],
  };

  const output = {
    dataset: "official-national-school-admission-2020-2025-v3266-dzu",
    generatedAt: new Date().toISOString(),
    scope: {
      years: sourceNote.years,
      provinceCount: sourceNote.provinceCount,
      school: SOURCE.schoolName,
      sourceRows: jsonRows.length,
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
      maxScoreRange: sourceNote.maxScoreRange,
      avgScoreRange: sourceNote.avgScoreRange,
      minRankRange: sourceNote.minRankRange,
      admissionCountRange: sourceNote.admissionCountRange,
      admissionCountTotal: sourceNote.admissionCountTotal,
      recordsRankUnavailable: sourceNote.recordsRankUnavailable,
      recordsWithRank: sourceNote.recordsWithRank,
      lowScoreRecordsUnder150: sourceNote.lowScoreRecordsUnder150,
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
        admissionTypeCounts: counters.admissionTypeCounts,
        scoreRange: sourceNote.scoreRange,
        maxScoreRange: sourceNote.maxScoreRange,
        minRankRange: sourceNote.minRankRange,
        admissionCountRange: sourceNote.admissionCountRange,
        admissionCountTotal: sourceNote.admissionCountTotal,
        recordsWithRank: sourceNote.recordsWithRank,
        recordsRankUnavailable: sourceNote.recordsRankUnavailable,
        lowScoreRecordsUnder150: sourceNote.lowScoreRecordsUnder150,
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
