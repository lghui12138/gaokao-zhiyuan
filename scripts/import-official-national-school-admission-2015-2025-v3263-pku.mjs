#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2015-2025-v3263-pku-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2015-2025-v3263-pku";
const INDEX_URL = "https://bkzs.pku.edu.cn/xxgk/lqfsx/index.htm";
const PAGE_URL = "https://bkzs.pku.edu.cn/xxgk/lqfsx/2f23dc2f47ae4f46a90d39efd06c7b1a.htm";

const SOURCE = {
  id: "official-pku-national-2015-2025-school-admission",
  quality: "official-school-pku-2015-2025-national-html-score-only",
  schoolCode: "10001",
  schoolName: "北京大学",
  city: "北京",
  publisher: "北京大学招生办公室",
  tags: ["综合", "985", "211", "双一流", "强基", "北京"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);
const INTEGRATED_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const EXPECTED_HEADER = ["省份", "类别", "文科分数线", "理科分数线", "其它分数线"];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2015-2025-v3263-pku.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2015-2025-v3263-pku.mjs --use-cache",
    "",
    "Imports 北京大学本科招生网 2015-2025 official historical admission-score tables.",
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
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function htmlDecode(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&ensp;|&emsp;/gi, " ")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&mdash;/gi, "-")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function textFromHtml(value) {
  return normalizeText(htmlDecode(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|tr|table|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")));
}

async function requestText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || "https://bkzs.pku.edu.cn/",
        },
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 160)}`);
      }
      return body;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function getRaw(rawRoot, rawFile, url, useCache, options = {}) {
  const absPath = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(absPath)) return fs.readFileSync(absPath, "utf8");
  const text = await requestText(url, options);
  fs.writeFileSync(absPath, text);
  return text;
}

function extractYears(html) {
  return [...html.matchAll(/<div[^>]+class=["'][^"']*tab-term[^"']*["'][^>]*>\s*(20\d{2})年\s*<\/div>/g)]
    .map((match) => Number(match[1]));
}

function extractTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((tableMatch) => {
    const rows = [];
    for (const rowMatch of tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => normalizeText(htmlDecode(cell[1].replace(/<[^>]+>/g, " "))));
      if (cells.length) rows.push(cells);
    }
    return rows;
  });
}

function normalizeProvince(value) {
  const text = normalizeText(value).replace(/\s+/g, "");
  if (text === "内蒙") return "内蒙古";
  return text;
}

function parseScore(value) {
  const text = normalizeText(value).replace(/[,，]/g, "");
  if (!text || text === "-" || text === "/" || text === "—") return null;
  return /^\d{2,3}(?:\.\d+)?$/.test(text) ? Number(text) : null;
}

function subjectFromOtherCategory(category, province) {
  const text = normalizeText(category);
  if (/历史|文科|文史/.test(text)) return "历史类";
  if (/理科|物理|物化|化学|医学|临床|数学|计算机/.test(text)) return "物理类";
  if (/不限|通用|综合|工商管理|一批/.test(text)) return "综合";
  if (INTEGRATED_PROVINCES.has(province)) return "综合";
  return "官网未列科类";
}

function sourceSubjectFor(columnKey, category) {
  if (columnKey === "liberal") return "文科分数线";
  if (columnKey === "science") return "理科分数线";
  return normalizeText(category) || "其它分数线";
}

function subjectTypeFor(columnKey, category, province) {
  if (columnKey === "liberal") return "历史类";
  if (columnKey === "science") return "物理类";
  return subjectFromOtherCategory(category, province);
}

function normalizeBatch(category) {
  const text = normalizeText(category);
  if (/提前/.test(text)) return "提前批";
  if (/专项/.test(text)) return "专项计划";
  if (/一批|^$/.test(text)) return "本科一批/普通批";
  if (/组|试验班|实验班|学科|类/.test(text)) return "本科批/普通批";
  return text || "本科一批/普通批";
}

function classifyAdmission(category) {
  const text = normalizeText(category);
  if (/提前|俄语|朝鲜语|阿拉伯语|日语|西班牙语|德语|法语|葡萄牙语|印度尼西亚语|泰语|印地语|菲律宾语|乌尔都语|少数民族|汉族|藏族|汉语言|专项|国防|定向/.test(text)) {
    return {
      admissionType: /少数民族|藏族|汉族|汉语言/.test(text) ? "民族/特殊批次" : "提前批/特殊语种",
      admissionSubtype: text || "特殊路径",
      formalScoreScope: "special-path-only",
    };
  }
  return {
    admissionType: "普通录取",
    admissionSubtype: text || "普通录取",
    formalScoreScope: "school-official-only",
  };
}

function scoreMetric(record) {
  if (record.province === "海南") return "海南高考转换分/标准分，按官网原文口径";
  if (record.province === "江苏" && record.year <= 2020) return "江苏旧高考总分口径，按官网原文口径";
  if (record.minScore > 750) return "高考省份特殊总分/转换分口径，按官网原文口径";
  return "高考文化分，按官网原文口径";
}

function cautionsFor(record) {
  const cautions = [
    "本记录来自北京大学本科招生网官方录取分数线 HTML 表，是单校分省分批次/类别最低分边界，不是省级教育考试院全量投档/录取分数表。",
    "源页未公开最低位次；推荐层不得生成假位次或仅凭本行分数单独输出录取概率。",
    "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，可用于北京大学候选边界复核，不替代同省省级正式投档表。",
  ];
  if (record.formalScoreScope === "special-path-only") {
    cautions.push("提前批、特殊语种、民族/藏汉等路径已隔离为 special-path-only，填报前必须核对当年省级批次、资格和招生章程。");
  }
  if (record.province === "海南" || record.minScore > 750) {
    cautions.push("高于750分的行保留海南等特殊总分/转换分口径，不与750满分省份直接横向比较。");
  }
  if (record.province === "江苏" && record.year <= 2020) {
    cautions.push("江苏2020及以前为旧高考总分口径，不能直接同750满分省份比较。");
  }
  if (record.sourceCategoryRaw === "官网未列类别") {
    cautions.push("源行类别为空，运行层按原始分数列保存，不推断专业组。");
  }
  return cautions;
}

function buildRecord({ year, row, rowIndex, columnKey, score, rawRel, textRel }) {
  const province = normalizeProvince(row[0]);
  const categoryRaw = normalizeText(row[1]) || "官网未列类别";
  const sourceSubjectRaw = sourceSubjectFor(columnKey, categoryRaw);
  const subjectType = subjectTypeFor(columnKey, categoryRaw, province);
  const batch = normalizeBatch(categoryRaw);
  const classification = classifyAdmission(categoryRaw);
  const record = {
    id: `pku-${stableId([year, province, categoryRaw, columnKey, score, rowIndex])}`,
    province,
    sourceProvinceRaw: row[0],
    year,
    subjectType,
    sourceSubjectRaw,
    batch,
    sourceBatchRaw: categoryRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "institution-admission",
    majorName: `${SOURCE.schoolName}${batch}录取分数（${sourceSubjectRaw}）`,
    majorGroup: `${SOURCE.schoolName}${year}${province}${batch}|${categoryRaw}|${sourceSubjectRaw}`,
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    minScore: score,
    scoreOnly: true,
    rankUnavailable: true,
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: PAGE_URL,
    sourcePageUrl: PAGE_URL,
    sourceIndexUrl: INDEX_URL,
    sourcePageTitle: "北京大学本科招生网录取分数线",
    sourcePageKey: `pku-admission-lines-${year}`,
    officialEvidencePath: rawRel,
    officialTextEvidencePath: textRel,
    sourceMinScoreRaw: String(score),
    rawTableSection: `${year}年录取分数线`,
    rawRow: {
      year,
      rowIndex,
      sourceProvinceRaw: row[0],
      sourceCategoryRaw: categoryRaw,
      sourceSubjectRaw,
      sourceScoreRaw: String(score),
      sourceCells: row,
      sourceColumnKey: columnKey,
    },
  };
  record.scoreMetric = scoreMetric(record);
  record.cautions = cautionsFor(record);
  return record;
}

function incrementCounter(target, key, by = 1) {
  target[key] = (target[key] || 0) + by;
}

function countRecords(records) {
  const counters = {
    byYear: {},
    byProvince: {},
    bySubjectType: {},
    byAdmissionType: {},
    byFormalScoreScope: {},
    byBatch: {},
  };
  for (const record of records) {
    incrementCounter(counters.byYear, String(record.year));
    incrementCounter(counters.byProvince, record.province);
    incrementCounter(counters.bySubjectType, record.subjectType);
    incrementCounter(counters.byAdmissionType, record.admissionType);
    incrementCounter(counters.byFormalScoreScope, record.formalScoreScope);
    incrementCounter(counters.byBatch, record.batch);
  }
  return counters;
}

function range(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric.length) return null;
  return { min: Math.min(...numeric), max: Math.max(...numeric) };
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];
  const skipped = [];
  for (const record of records) {
    const key = [
      record.year,
      record.province,
      record.sourceBatchRaw,
      record.sourceSubjectRaw,
      record.minScore,
    ].join("|");
    if (seen.has(key)) {
      skipped.push({ id: record.id, key, rawRow: record.rawRow });
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return { deduped, skipped };
}

function validate(records) {
  const ids = new Set();
  const duplicateIds = [];
  const badScores = [];
  const badRankFlags = [];
  const ordinaryOutliers = [];
  for (const record of records) {
    if (ids.has(record.id)) duplicateIds.push(record.id);
    ids.add(record.id);
    if (!MAINLAND_PROVINCES.has(record.province) || !(record.minScore > 0 && record.minScore <= 1000)) {
      badScores.push(record);
    }
    if (!(record.rankUnavailable === true && record.minRank == null && record.scoreOnly === true)) {
      badRankFlags.push(record);
    }
    if (record.formalScoreScope === "school-official-only" && record.minScore > 750 && record.province !== "海南") {
      ordinaryOutliers.push(record);
    }
  }
  return { duplicateIds, badScores, badRankFlags, ordinaryOutliers };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.join(rawRoot, "text"));
  ensureDir(path.dirname(projectPath(args.out)));

  const rawFiles = [];
  const indexHtml = await getRaw(rawRoot, "pku-admission-lines-index.html", INDEX_URL, args.useCache);
  rawFiles.push(`${RAW_DIR}/pku-admission-lines-index.html`);
  const html = await getRaw(rawRoot, "pku-admission-lines-2015-2025.html", PAGE_URL, args.useCache, { referer: INDEX_URL });
  rawFiles.push(`${RAW_DIR}/pku-admission-lines-2015-2025.html`);
  const textFile = "text/pku-admission-lines-2015-2025.txt";
  fs.writeFileSync(path.join(rawRoot, textFile), `${textFromHtml(html)}\n`);
  const textRel = `${RAW_DIR}/${textFile}`;
  rawFiles.push(textRel);

  const years = extractYears(html);
  const tables = extractTables(html);
  if (years.length !== tables.length || years.length !== 11) {
    throw new Error(`Expected 11 year tabs and tables, got years=${years.length}, tables=${tables.length}`);
  }

  const records = [];
  const skippedRows = [];
  const tableSummaries = [];
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
    const year = years[tableIndex];
    const rows = tables[tableIndex];
    const header = rows[0] || [];
    if (JSON.stringify(header) !== JSON.stringify(EXPECTED_HEADER)) {
      throw new Error(`Unexpected header for ${year}: ${JSON.stringify(header)}`);
    }
    let yearRecordCount = 0;
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const province = normalizeProvince(row[0]);
      if (!MAINLAND_PROVINCES.has(province)) {
        skippedRows.push({ year, rowIndex, reason: "non-mainland-admission-route", row });
        continue;
      }
      for (const [columnKey, cellIndex] of [["liberal", 2], ["science", 3], ["other", 4]]) {
        const score = parseScore(row[cellIndex]);
        if (score == null) continue;
        records.push(buildRecord({ year, row, rowIndex, columnKey, score, rawRel: `${RAW_DIR}/pku-admission-lines-2015-2025.html`, textRel }));
        yearRecordCount += 1;
      }
    }
    tableSummaries.push({
      year,
      rows: rows.length - 1,
      records: yearRecordCount,
      header,
    });
  }

  const { deduped, skipped } = dedupeRecords(records);
  const validation = validate(deduped);
  if (validation.duplicateIds.length || validation.badScores.length || validation.badRankFlags.length || validation.ordinaryOutliers.length) {
    throw new Error(`Validation failed: ${JSON.stringify({
      duplicateIds: validation.duplicateIds.slice(0, 5),
      badScores: validation.badScores.slice(0, 5),
      badRankFlags: validation.badRankFlags.slice(0, 5),
      ordinaryOutliers: validation.ordinaryOutliers.slice(0, 5),
    }, null, 2)}`);
  }

  const counters = countRecords(deduped);
  const sourceNote = {
    id: SOURCE.id,
    title: "北京大学本科招生网：2015-2025年录取分数线",
    publisher: SOURCE.publisher,
    url: PAGE_URL,
    indexUrl: INDEX_URL,
    quality: SOURCE.quality,
    usage: "抽取北京大学本科招生网官方录取分数线 HTML 表中2015-2025年分省分类别文科、理科和其它分数线；普通批作单校候选边界，提前批、特殊语种、民族/藏汉等路径隔离为 special-path-only；源页未公开最低位次。",
    rawDir: RAW_DIR,
    rawFiles,
    parsedRecords: deduped.length,
    sourceRows: records.length,
    skippedSemanticDuplicates: skipped.length,
    skippedRows: skippedRows.length,
    provinceCount: Object.keys(counters.byProvince).length,
    ordinarySchoolOfficialRecords: counters.byFormalScoreScope["school-official-only"] || 0,
    specialPathRecords: counters.byFormalScoreScope["special-path-only"] || 0,
    rankUnavailableRecords: deduped.length,
    scoreRange: range(deduped.map((record) => record.minScore)),
    pageSha256: sha256File(path.join(rawRoot, "pku-admission-lines-2015-2025.html")),
    indexSha256: sha256File(path.join(rawRoot, "pku-admission-lines-index.html")),
    textSha256: sha256File(path.join(rawRoot, textFile)),
    tableSummaries,
    skippedRowsDetail: skippedRows.slice(0, 20),
    skippedSemanticDuplicatesDetail: skipped.slice(0, 20),
    ...counters,
    cautions: [
      "学校官网单校分数线不替代省级教育考试院全量投档/录取表。",
      "源页未公开最低位次；所有记录保持 rankUnavailable=true，不生成假位次。",
      "海南等特殊总分/转换分口径按官网原文保留，不与750满分省份直接比较。",
      "提前批、特殊语种、民族/藏汉等路径保持 special-path-only。",
      "港澳台侨联招行不混入内地31省普通高考模型。",
    ],
  };

  const payload = {
    dataset: "gaokao-zhiyuan-site-admission-score-layer",
    generatedAt: new Date().toISOString(),
    records: deduped,
    sourceNotes: [sourceNote],
    qa: {
      duplicateIds: validation.duplicateIds.length,
      badScores: validation.badScores.length,
      badRankFlags: validation.badRankFlags.length,
      ordinaryOutliers: validation.ordinaryOutliers.length,
      skippedSemanticDuplicates: skipped.length,
      skippedRows: skippedRows.length,
      notes: [
        "All records are score-only school-official historical admission lines.",
        "No rank values are fabricated; rankUnavailable=true for every record.",
        "Non-mainland 港澳台侨联招 rows are skipped rather than mixed into mainland province predictions.",
      ],
    },
  };

  fs.writeFileSync(projectPath(args.out), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    out: args.out,
    sourceId: SOURCE.id,
    records: deduped.length,
    sourceRows: records.length,
    skippedSemanticDuplicates: skipped.length,
    skippedRows: skippedRows.length,
    rawFiles: rawFiles.length,
    years,
    provinces: Object.keys(counters.byProvince).length,
    formalScoreScope: counters.byFormalScoreScope,
    subjectTypes: counters.bySubjectType,
    admissionTypes: counters.byAdmissionType,
    scoreRange: sourceNote.scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
