#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2023-2025-v3191-xmu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2023-2025-v3191-xmu";
const API_BASE = "https://zsdata.xmu.edu.cn/lqxx/s";
const PAGE_URL = "https://zsdata.xmu.edu.cn/public/zsdata/lqxx/";
const LIST_PAGE_URL = "https://zs.xmu.edu.cn/bks/wnlq.htm";
const SOURCE = {
  id: "official-xmu-national-2023-2025-school-admission",
  quality: "official-school-xmu-2023-2025-national-dynamic-query-score-rank",
  schoolCode: "10384",
  schoolName: "厦门大学",
  city: "厦门",
  tags: ["综合", "985", "211", "双一流"],
};

const PROVINCE_SLUGS = new Map([
  ["北京", "beijing"],
  ["天津", "tianjin"],
  ["河北", "hebei"],
  ["山西", "shanxi"],
  ["内蒙古", "neimenggu"],
  ["辽宁", "liaoning"],
  ["吉林", "jilin"],
  ["黑龙江", "heilongjiang"],
  ["上海", "shanghai"],
  ["江苏", "jiangsu"],
  ["浙江", "zhejiang"],
  ["安徽", "anhui"],
  ["福建", "fujian"],
  ["江西", "jiangxi"],
  ["山东", "shandong"],
  ["河南", "henan"],
  ["湖北", "hubei"],
  ["湖南", "hunan"],
  ["广东", "guangdong"],
  ["广西", "guangxi"],
  ["海南", "hainan"],
  ["重庆", "chongqing"],
  ["四川", "sichuan"],
  ["贵州", "guizhou"],
  ["云南", "yunnan"],
  ["西藏", "xizang"],
  ["陕西", "shaanxi"],
  ["甘肃", "gansu"],
  ["青海", "qinghai"],
  ["宁夏", "ningxia"],
  ["新疆", "xinjiang"],
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2023-2025-v3191-xmu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2023-2025-v3191-xmu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/API JSON",
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
    if (arg === "--use-cache") {
      args.useCache = true;
      continue;
    }
    if (arg === "--out") {
      args.out = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 16);
}

function resolveProjectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "content-type": "application/json;charset=utf-8",
      ...(options.headers || {}),
    },
    body: options.body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  try {
    return { json: JSON.parse(text), text };
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${error.message}\n${text.slice(0, 240)}`);
  }
}

async function downloadText(rawRoot, relPath, url, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const text = await fetchText(url);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text);
  return text;
}

async function downloadJson(rawRoot, relPath, url, payload, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const { json, text } = await fetchJson(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  fs.writeFileSync(`${file}.raw.txt`, text);
  return json;
}

function apiUrl(endpoint) {
  return `${API_BASE}${endpoint}`;
}

function cleanText(value) {
  if (value == null) return "";
  return String(value)
    .replace(/<br\s*\/?>/gi, "；")
    .replace(/<\/br>/gi, "；")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—") return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parsePositiveInt(value) {
  const number = parseNumber(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.trunc(number);
}

function normalizeProvince(raw) {
  const text = cleanText(raw);
  if (text === "内蒙") return "内蒙古";
  return text.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
}

function normalizeSubject(raw) {
  const text = cleanText(raw);
  if (!text || text === "-") return "";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/综合/.test(text)) return "综合";
  if (/艺术/.test(text)) return "艺术类";
  return text;
}

function admissionType(categoryRaw, majorRaw, subjectRaw) {
  const text = [categoryRaw, majorRaw, subjectRaw].map(cleanText).join(" ");
  const types = [];
  if (/国家专项/.test(text)) types.push("国家专项");
  if (/高校专项/.test(text)) types.push("高校专项");
  if (/艺术|美术|音乐|舞蹈|绘画|设计/.test(text)) types.push("艺术/体育类");
  if (/预科|民族|少数民族/.test(text)) types.push("民族/少数民族");
  if (/马来西亚/.test(text)) types.push("中外合作办学/境外校区");
  if (/医学/.test(text)) types.push("医学类");
  if (/面向厦门|面向漳州/.test(text)) types.push("地方定向/面向地区");
  if (!types.length) types.push("普通录取");
  return types.join("；");
}

function formalScoreScope(categoryRaw, majorRaw, subjectRaw) {
  const text = [categoryRaw, majorRaw, subjectRaw].map(cleanText).join(" ");
  if (/国家专项|高校专项|艺术|美术|音乐|舞蹈|绘画|设计|预科|民族|少数民族/.test(text)) {
    return "special-path-only";
  }
  return "school-official-only";
}

function recordFromRow(row, rawPath, query, ordinal) {
  const year = parsePositiveInt(row.nf);
  const province = normalizeProvince(row.sf);
  const subjectType = normalizeSubject(row.klmc);
  const category = cleanText(row.zslb);
  const majorName = cleanText(row.zymc);
  const minScore = parseNumber(row.zdf);
  if (!year || !province || !subjectType || !majorName || !Number.isFinite(minScore)) return null;
  const minRank = parsePositiveInt(row.zdfwc);
  const maxRank = parsePositiveInt(row.zgfwc);
  const avgRank = parsePositiveInt(row.pjfwc);
  const scope = formalScoreScope(category, majorName, row.klmc);
  const hash = stableId([
    year,
    province,
    row.klmc,
    category,
    row.pcmc,
    majorName,
    row.xkkm,
    minScore,
    minRank || "",
    ordinal,
  ]);
  const record = {
    id: `${year}-xmu-national-school-${hash}`,
    province,
    sourceProvinceRaw: cleanText(row.sf),
    year,
    subjectType,
    sourceSubjectRaw: cleanText(row.klmc),
    batch: cleanText(row.pcmc) && cleanText(row.pcmc) !== "-" ? cleanText(row.pcmc) : "本科批",
    sourceBatchRaw: cleanText(row.pcmc),
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "major-admission",
    majorName,
    majorGroup: [SOURCE.schoolName, province, subjectType, category, majorName].filter(Boolean).join("-"),
    admissionType: admissionType(category, majorName, row.klmc),
    admissionSubtype: category,
    formalScoreScope: scope,
    minScore,
    scoreOnly: !minRank,
    rankUnavailable: !minRank,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: PAGE_URL,
    sourcePageUrl: PAGE_URL,
    sourceListPageUrl: LIST_PAGE_URL,
    sourceApiUrl: apiUrl("/api/front/lqxx/getList"),
    officialEvidencePath: rawPath,
    sourceApiPath: rawPath,
    sourceMinScoreRaw: cleanText(row.zdf),
    sourceQuery: query,
    rawRow: row,
    cautions: [
      "本记录来自厦门大学招生信息官方历年分数动态查询系统，是单校分省/科类/专业录取边界，不是省级教育考试院全量投档/录取分数表。",
      minRank
        ? "源系统公开最低位次；运行层按原表位次保存为该校该行最低分对应位次，不得仅凭单校行输出录取概率。"
        : "源系统本行未公开有效位次或位次为0；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      scope === "special-path-only"
        ? "本记录属于专项、艺术类、民族/预科或其他特殊入口，已按 formalScoreScope=special-path-only 隔离，不与普通批无资格限制入口混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于厦门大学候选边界复核，但不得替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  const maxScore = parseNumber(row.zgf);
  if (Number.isFinite(maxScore)) {
    record.maxScore = maxScore;
    record.sourceMaxScoreRaw = cleanText(row.zgf);
  }
  const averageScore = parseNumber(row.pjf);
  if (Number.isFinite(averageScore)) {
    record.averageScore = averageScore;
    record.sourceAverageScoreRaw = cleanText(row.pjf);
  }
  const admitCount = parsePositiveInt(row.lqrs);
  if (admitCount) {
    record.admitCount = admitCount;
    record.sourceAdmitCountRaw = cleanText(row.lqrs);
  }
  if (minRank) {
    record.minRankStart = minRank;
    record.minRankEnd = minRank;
    record.rankRangeText = String(minRank);
    record.sourceRankRaw = cleanText(row.zdfwc);
  }
  if (maxRank) record.sourceMaxRankRaw = cleanText(row.zgfwc);
  if (avgRank) record.sourceAverageRankRaw = cleanText(row.pjfwc);
  const subjectRequirement = cleanText(row.xkkm);
  if (subjectRequirement && subjectRequirement !== "-") record.subjectRequirement = subjectRequirement;
  const selectSubject = cleanText(row.sxkm);
  if (selectSubject && selectSubject !== "-") record.sourceSelectionRaw = selectSubject;
  const group = cleanText(row.zygroup);
  if (group && group !== "-") record.majorGroupCode = group;
  const duration = cleanText(row.xzmc);
  if (duration && duration !== "-") record.studyDuration = duration;
  return record;
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || "";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

async function main() {
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  await downloadText(rawRoot, "xmu-admission-page.html", PAGE_URL, args.useCache);
  await downloadText(rawRoot, "xmu-admission-list-page.html", LIST_PAGE_URL, args.useCache);
  const typePayload = await downloadJson(
    rawRoot,
    "api/lnfs-types.json",
    apiUrl("/api/front/lqxx/getType"),
    { type: "lnfs" },
    args.useCache,
  );
  if (typePayload.code !== 200 || !typePayload.typeMap) {
    throw new Error(`Unexpected getType response: ${JSON.stringify(typePayload).slice(0, 400)}`);
  }

  const queryKeys = [...new Set(Object.keys(typePayload.typeMap).map((key) => {
    const [first, second] = key.split("_");
    const firstIsYear = /^\d{4}$/.test(first);
    const year = firstIsYear ? first : second;
    const province = firstIsYear ? second : first;
    return `${year}_${province}`;
  }))].sort();

  const records = [];
  const rawPaths = [
    path.posix.join(RAW_DIR, "xmu-admission-page.html"),
    path.posix.join(RAW_DIR, "xmu-admission-list-page.html"),
    path.posix.join(RAW_DIR, "api/lnfs-types.json"),
  ];
  const warnings = [];

  for (const key of queryKeys) {
    const [year, province] = key.split("_");
    if (!year || !province) continue;
    const slug = PROVINCE_SLUGS.get(province) || sha256(province).slice(0, 8);
    const rel = `api/${year}-${slug}-all-lnfs.json`;
    const query = { type: "lnfs", sf: province, nf: year, zslb: "全部", klmc: "全部", xqmc: "" };
    const payload = await downloadJson(rawRoot, rel, apiUrl("/api/front/lqxx/getList"), query, args.useCache);
    rawPaths.push(path.posix.join(RAW_DIR, rel));
    if (payload.code !== 200 || !Array.isArray(payload.list)) {
      warnings.push(`Unexpected list response for ${key}: ${JSON.stringify(payload).slice(0, 240)}`);
      continue;
    }
    for (const [index, row] of payload.list.entries()) {
      const record = recordFromRow(row, path.posix.join(RAW_DIR, rel), query, index);
      if (record) records.push(record);
    }
  }

  const seen = new Set();
  const uniqueRecords = [];
  for (const record of records) {
    const key = [
      record.province,
      record.year,
      record.subjectType,
      record.batch,
      record.schoolCode,
      record.schoolName,
      record.majorName,
      record.majorGroup,
      record.minScore,
      record.minRankEnd || "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRecords.push(record);
  }
  const duplicateIds = uniqueRecords.length - new Set(uniqueRecords.map((record) => record.id)).size;
  if (duplicateIds) throw new Error(`Duplicate record ids after dedupe: ${duplicateIds}`);

  const scoreValues = uniqueRecords.map((record) => Number(record.minScore)).filter(Number.isFinite);
  const rankValues = uniqueRecords.map((record) => Number(record.minRankEnd)).filter(Number.isFinite);
  const shaList = rawPaths.map((rel) => {
    const abs = resolveProjectPath(rel);
    return { path: rel, sha256: sha256(fs.readFileSync(abs)) };
  });
  const sourceNotes = [{
    id: SOURCE.id,
    title: "厦门大学招生信息：2023-2025 年全国分省分专业本科生录取情况",
    publisher: "厦门大学招生与考试办公室",
    url: PAGE_URL,
    listPageUrl: LIST_PAGE_URL,
    apiBase: API_BASE,
    apiEndpoints: {
      getType: apiUrl("/api/front/lqxx/getType"),
      getList: apiUrl("/api/front/lqxx/getList"),
    },
    quality: SOURCE.quality,
    usage: "抽取厦门大学官方历年分数动态查询接口；保留2023-2025年31个省级口径的分专业最高分、最低分、平均分和最低位次。普通、医学类、面向厦门/漳州和马来西亚分校作单校候选边界，国家专项、高校专项、艺术类、民族/预科等隔离为特殊路径。",
    parsedRecords: uniqueRecords.length,
    provinceCount: new Set(uniqueRecords.map((record) => record.province)).size,
    years: [...new Set(uniqueRecords.map((record) => record.year).filter(Boolean))].sort((a, b) => a - b),
    queryCount: queryKeys.length,
    recordsWithRank: uniqueRecords.filter((record) => record.minRankEnd).length,
    recordsWithoutRank: uniqueRecords.filter((record) => !record.minRankEnd).length,
    ordinarySchoolOfficialRecords: uniqueRecords.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRecords: uniqueRecords.filter((record) => record.formalScoreScope === "special-path-only").length,
    byYear: countBy(uniqueRecords, (record) => record.year),
    byProvince: countBy(uniqueRecords, (record) => record.province),
    bySubjectType: countBy(uniqueRecords, (record) => record.subjectType),
    byAdmissionType: countBy(uniqueRecords, (record) => record.admissionType),
    byFormalScoreScope: countBy(uniqueRecords, (record) => record.formalScoreScope),
    byDataType: countBy(uniqueRecords, (record) => record.dataType),
    scoreRange: { min: Math.min(...scoreValues), max: Math.max(...scoreValues) },
    rankRange: rankValues.length ? { min: Math.min(...rankValues), max: Math.max(...rankValues) } : null,
    rawPaths,
    sha256: shaList,
    warnings,
    transcriptionMethod: "official-dynamic-query-json",
    cautions: [
      "本源为厦门大学官方单校录取分数查询系统，不是任何省级教育考试院全量投档/录取分数表。",
      "源系统部分行公开最低位次，西藏等少数行返回0或空位次时按 rankUnavailable=true 处理，不生成假位次。",
      "普通学校官网单校行按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "国家专项、高校专项、艺术类、民族/预科等按 formalScoreScope=special-path-only 隔离，不与无资格限制普通批入口混用。",
      "马来西亚分校、面向厦门/漳州、医学类等入口需要单独复核学费、校区、培养模式、选科、语种和调剂限制。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  }];

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes, records: uniqueRecords }, null, 2)}\n`);
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    sourceNotes: sourceNotes.length,
    records: uniqueRecords.length,
    provinceCount: sourceNotes[0].provinceCount,
    years: sourceNotes[0].years,
    queryCount: sourceNotes[0].queryCount,
    recordsWithRank: sourceNotes[0].recordsWithRank,
    recordsWithoutRank: sourceNotes[0].recordsWithoutRank,
    byFormalScoreScope: sourceNotes[0].byFormalScoreScope,
    scoreRange: sourceNotes[0].scoreRange,
    rankRange: sourceNotes[0].rankRange,
    warnings,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
