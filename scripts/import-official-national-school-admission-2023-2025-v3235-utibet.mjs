#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2023-2025-v3235-utibet-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2023-2025-v3235-utibet";
const PAGE_URL = "https://zjc.utibet.edu.cn/bkzsxxw/lnfs.htm";
const API_ROOT = "https://www.xzu.edu.cn/api/zjc/zsxx/";

const SOURCE = {
  id: "official-utibet-national-2023-2025-school-admission",
  quality: "official-school-utibet-2023-2025-national-api-major-score",
  schoolCode: "10694",
  schoolName: "西藏大学",
  city: "西藏拉萨",
  publisher: "西藏大学招生就业处",
  tags: ["西藏", "拉萨", "西藏大学", "双一流", "综合类", "民族地区"],
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2023-2025-v3235-utibet.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2023-2025-v3235-utibet.mjs --use-cache",
    "",
    "Imports 西藏大学招生就业处历年分数公开 API 2023-2025 分省分专业录取最低分.",
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

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    timeout: options.timeout ?? 180_000,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stderr?.toString()?.trim(),
      result.stdout?.toString()?.slice(0, 1200)?.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function stableId(parts, length = 18) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, length);
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function numberOrNull(value) {
  const text = compact(value).replace(/[,，]/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function downloadToFile(url, outFile, useCache, extra = []) {
  if (useCache && fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return;
  run("curl", [
    "-L",
    "--fail",
    "--max-time",
    "120",
    "--user-agent",
    "Mozilla/5.0 gaokao-utibet-admission-importer/1.0",
    "--referer",
    PAGE_URL,
    ...extra,
    url,
    "-o",
    outFile,
  ]);
}

function postApiToFile(endpoint, data, outFile, useCache) {
  if (useCache && fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return;
  const postBody = new URLSearchParams(data).toString();
  run("curl", [
    "-L",
    "--fail",
    "--max-time",
    "120",
    "--user-agent",
    "Mozilla/5.0 gaokao-utibet-admission-importer/1.0",
    "--header",
    "Origin: https://zjc.utibet.edu.cn",
    "--header",
    "Referer: https://zjc.utibet.edu.cn/bkzsxxw/lnfs.htm",
    "--header",
    "X-Requested-With: XMLHttpRequest",
    "--header",
    "Content-Type: application/x-www-form-urlencoded; charset=UTF-8",
    "--data",
    postBody,
    `${API_ROOT}${endpoint}`,
    "-o",
    outFile,
  ]);
  if (fs.statSync(outFile).size === 0) {
    throw new Error(`API response was empty: ${endpoint} ${postBody}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function extractYear(value) {
  const match = normalizeText(value).match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function extractBatch(yearNodeName, rowBatch) {
  const explicit = normalizeText(rowBatch);
  if (explicit) return explicit;
  const text = normalizeText(yearNodeName);
  const afterYear = text.replace(/^20\d{2}/, "").trim();
  if (afterYear) return afterYear.replace(/^年/, "").trim();
  return "官网未列批次";
}

function normalizeSubject(value) {
  const text = compact(value);
  if (!text) return "官网未列科类";
  if (/综合/.test(text)) return "综合";
  if (/艺术/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  return normalizeText(value);
}

function classify(row) {
  const text = `${row.batch} ${row.subjectType} ${row.majorName}`;
  if (/艺术/.test(text)) return { admissionType: "艺术类", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  if (/体育/.test(text)) return { admissionType: "体育类", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  if (/国家专项/.test(text)) return { admissionType: "国家专项", admissionSubtype: "国家专项", formalScoreScope: "special-path-only" };
  if (/地方专项/.test(text)) return { admissionType: "地方专项", admissionSubtype: "地方专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", admissionSubtype: "高校专项", formalScoreScope: "special-path-only" };
  if (/专项|部队|边境|优师|西藏班|定向|预科|单列|民族/.test(text)) {
    return { admissionType: "特殊路径", admissionSubtype: "专项/特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通", formalScoreScope: "school-official-only" };
}

function formatCategory(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childCount = new Map();
  for (const item of items) childCount.set(item.parent, (childCount.get(item.parent) ?? 0) + 1);
  const leaves = items.filter((item) => item.parent !== 0 && !childCount.has(item.id));
  return leaves.map((subjectNode) => {
    const yearNode = byId.get(subjectNode.parent);
    const provinceNode = yearNode ? byId.get(yearNode.parent) : null;
    if (!yearNode || !provinceNode || provinceNode.parent !== 0) return null;
    return {
      cid: subjectNode.id,
      subjectNode,
      yearNode,
      provinceNode,
      year: extractYear(yearNode.name),
      province: normalizeText(provinceNode.name),
      subjectRaw: normalizeText(subjectNode.name),
      subjectType: normalizeSubject(subjectNode.name),
      categoryPath: [provinceNode.name, yearNode.name, subjectNode.name].map(normalizeText).join(" / "),
    };
  }).filter((item) => item && item.year);
}

function buildRecord(ctx, apiRow, rowIndex, relInfoFile) {
  const majorNameRaw = normalizeText(apiRow.spec);
  const minScore = numberOrNull(apiRow.score);
  if (!majorNameRaw || minScore == null) return null;
  const admissionCount = numberOrNull(apiRow.num);
  const batch = extractBatch(ctx.yearNode.name, apiRow.batch);
  const subjectType = ctx.subjectType;
  const row = {
    batch,
    subjectType,
    majorName: majorNameRaw,
  };
  const cls = classify(row);
  const id = `utibet-score-${stableId([
    SOURCE.id,
    ctx.cid,
    apiRow.id,
    ctx.year,
    ctx.province,
    subjectType,
    batch,
    majorNameRaw,
    minScore,
    admissionCount,
  ])}`;
  const cautions = [
    "学校官网单校分专业分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
    "源接口未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。",
  ];
  if (batch === "官网未列批次") cautions.push("源接口该分类未列批次，运行层按官网未列批次保留。");

  return {
    id,
    year: ctx.year,
    province: ctx.province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    batch,
    subjectType,
    sourceSubjectRaw: ctx.subjectRaw,
    majorName: majorNameRaw,
    majorGroup: [SOURCE.schoolName, ctx.province, ctx.year, batch, ctx.subjectRaw, majorNameRaw].join("|"),
    dataType: "major-admission",
    admissionType: cls.admissionType,
    admissionSubtype: cls.admissionSubtype,
    formalScoreScope: cls.formalScoreScope,
    schoolOfficialScope: true,
    minScore,
    maxScore: null,
    avgScore: null,
    admissionCount,
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    rankUnavailable: true,
    scoreOnly: true,
    scoreMetric: "高考文化分，按西藏大学招生就业处公开 API 原表口径",
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: `${API_ROOT}info/list`,
    sourcePageUrl: PAGE_URL,
    sourceIndexUrl: PAGE_URL,
    sourcePageTitle: "西藏大学历年分数",
    sourcePageKey: `utibet-${ctx.year}-${ctx.province}-${ctx.cid}-admission`,
    sourceAttachmentUrl: null,
    sourceAttachmentPath: relInfoFile,
    officialEvidencePath: relInfoFile,
    sourceProvinceRaw: ctx.provinceNode.name,
    sourceBatchRaw: normalizeText(apiRow.batch) || null,
    sourceCategoryPathRaw: ctx.categoryPath,
    sourceCidRaw: ctx.cid,
    sourceApiRowIdRaw: apiRow.id ?? null,
    sourceMajorRaw: majorNameRaw,
    sourceAdmissionCountRaw: apiRow.num == null ? null : String(apiRow.num),
    sourceMinScoreRaw: apiRow.score == null ? null : String(apiRow.score),
    rowNumber: rowIndex + 1,
    rawRow: apiRow,
    cautions,
  };
}

function summarize(records, categoryItems, rawFiles, fetchedSummaries) {
  const countBy = (field) => records.reduce((acc, record) => {
    const key = record[field] ?? "null";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const scoreRange = records.reduce((acc, record) => {
    if (typeof record.minScore !== "number") return acc;
    if (!acc) return [record.minScore, record.minScore];
    acc[0] = Math.min(acc[0], record.minScore);
    acc[1] = Math.max(acc[1], record.minScore);
    return acc;
  }, null);
  const provinceCount = new Set(records.map((record) => record.province)).size;
  const years = [...new Set(records.map((record) => record.year))].sort((a, b) => b - a);
  return {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "西藏大学招生就业处历年分数 2023-2025 年全国分省分专业录取最低分",
    url: PAGE_URL,
    quality: SOURCE.quality,
    usage: "学校官网单校 2023-2025 分省分专业最低分；可用于西藏大学候选边界、西藏本地高校普通/专项/边境等分层参考和全国学校官方样本加厚，不替代任何省级考试院全量投档/录取表。",
    rawDir: RAW_DIR,
    rawFiles,
    parsedRecords: records.length,
    duplicateRecordsSkipped: 0,
    categoryItems: categoryItems.length,
    fetchedCategoryLeaves: fetchedSummaries.length,
    fetchedSummaries,
    provincesWithRecords: [...new Set(records.map((record) => record.province))].sort(),
    provinceCount,
    years,
    yearCounts: countBy("year"),
    subjectTypeCounts: countBy("subjectType"),
    formalScoreScopeCounts: countBy("formalScoreScope"),
    admissionTypeCounts: countBy("admissionType"),
    admissionSubtypeCounts: countBy("admissionSubtype"),
    recordTypeCounts: countBy("dataType"),
    scoreRange,
    recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
    recordsWithMinRank: records.filter((record) => record.minRank != null).length,
    xizangRecords: records.filter((record) => record.province === "西藏").length,
    xizangSchoolOfficialOnlyRecords: records.filter((record) => record.province === "西藏" && record.formalScoreScope === "school-official-only").length,
    boundaryNotes: [
      "西藏大学官网公开 API 按省份/年份/科类分类返回专业、最低分、录取人数；未公开最低位次。",
      "西藏本省分类节点将本科一批、本科二批、国家专项、地方专项、部队专项、边境专项、西藏班、提前批艺术类本科分开；专项/特殊路径按 special-path-only 隔离。",
      "非西藏省份部分分类未在接口中列批次，运行层保留 batch=官网未列批次，不推断为省级批次。",
      "该源为学校官方单校分数，不替代西藏自治区教育考试院全量投档/录取表；省级正式投档/录取全量缺口仍单独标注。",
    ],
  };
}

function main() {
  const args = parseArgs(process.argv);
  guardProjectRoot();
  const rawDir = projectPath(RAW_DIR);
  ensureDir(rawDir);

  const pageFile = path.join(rawDir, "utibet-lnfs.html");
  const libFile = path.join(rawDir, "utibet-lib.js");
  const categoryJsFile = path.join(rawDir, "utibet-category.js");
  const lnfsJsFile = path.join(rawDir, "utibet-lnfs.js");
  const categoryFile = path.join(rawDir, "utibet-category-type2.json");

  downloadToFile(PAGE_URL, pageFile, args.useCache);
  downloadToFile("https://zjc.utibet.edu.cn/bkzsxxw/js/lib.js", libFile, args.useCache);
  downloadToFile("https://zjc.utibet.edu.cn/bkzsxxw/js/category.js", categoryJsFile, args.useCache);
  downloadToFile("https://zjc.utibet.edu.cn/bkzsxxw/js/lnfs.js", lnfsJsFile, args.useCache);
  postApiToFile("category/list", { type: "2" }, categoryFile, args.useCache);

  const categoryItems = readJson(categoryFile);
  const contexts = formatCategory(categoryItems);
  const rawFiles = [pageFile, libFile, categoryJsFile, lnfsJsFile, categoryFile].map(rel);
  const records = [];
  const fetchedSummaries = [];
  const seen = new Set();

  for (const ctx of contexts) {
    const infoFile = path.join(rawDir, `utibet-info-cid-${ctx.cid}.json`);
    postApiToFile("info/list", { cid: String(ctx.cid) }, infoFile, args.useCache);
    const rows = readJson(infoFile);
    const infoRel = rel(infoFile);
    rawFiles.push(infoRel);
    let parsedRows = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const record = buildRecord(ctx, rows[index], index, infoRel);
      if (!record) continue;
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
      parsedRows += 1;
    }
    fetchedSummaries.push({
      cid: ctx.cid,
      province: ctx.province,
      year: ctx.year,
      yearNode: ctx.yearNode.name,
      subject: ctx.subjectRaw,
      rows: rows.length,
      parsedRows,
      file: infoRel,
      sha256: sha256File(infoFile),
    });
  }

  records.sort((a, b) => (
    b.year - a.year ||
    a.province.localeCompare(b.province, "zh-Hans-CN") ||
    a.batch.localeCompare(b.batch, "zh-Hans-CN") ||
    a.subjectType.localeCompare(b.subjectType, "zh-Hans-CN") ||
    a.majorName.localeCompare(b.majorName, "zh-Hans-CN")
  ));

  const sourceNote = summarize(records, categoryItems, [...new Set(rawFiles)].sort(), fetchedSummaries);
  sourceNote.rawFileDetails = sourceNote.rawFiles.map((file) => ({
    file,
    bytes: fs.statSync(projectPath(file)).size,
    sha256: sha256File(projectPath(file)),
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    sourceNotes: [sourceNote],
    records,
    stats: {
      records: records.length,
      sourceNotes: 1,
      provinces: sourceNote.provinceCount,
      years: sourceNote.years,
      xizangRecords: sourceNote.xizangRecords,
      xizangSchoolOfficialOnlyRecords: sourceNote.xizangSchoolOfficialOnlyRecords,
    },
  };

  const outPath = projectPath(args.out);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload.stats, null, 2));
  console.log(args.out);
}

main();
