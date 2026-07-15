#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2018-2025-v3186-whut-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2018-2025-v3186-whut";
const PAGE_URL = "https://zs.whut.edu.cn/bkcx/bklqqk/";
const JS_URL = "https://zs.whut.edu.cn/material/static/js/loaddata_lqqk.js";
const YEAR_URL = "https://zs.whut.edu.cn/enroll-info/recruitByMajor/selYearbyProvince.do";
const SUBJECT_URL = "https://zs.whut.edu.cn/enroll-info/recruitByMajor/selSubjectTypeByProvinceAndYear.do";
const SCORE_URL = "https://zs.whut.edu.cn/enroll-info/recruitByMajor/selRecruitByProvinceAndYearAndSubjectType.do";

const SOURCE = {
  id: "official-whut-national-2018-2025-school-admission",
  quality: "official-school-whut-2018-2025-national-dynamic-query-score-rank",
  schoolCode: "10497",
  schoolName: "武汉理工大学",
  city: "武汉",
  tags: ["理工", "211", "双一流"],
};

const FALLBACK_PROVINCES = [
  "安徽", "北京", "重庆", "福建", "广东", "广西", "贵州", "甘肃", "湖北", "湖南",
  "河北", "河南", "黑龙江", "海南", "江苏", "江西", "吉林", "辽宁", "宁夏", "内蒙古",
  "青海", "上海", "四川", "山东", "山西", "陕西", "天津", "新疆", "西藏", "云南", "浙江",
];

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
    `  node scripts/import-official-national-school-admission-2018-2025-v3186-whut.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2018-2025-v3186-whut.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/JS/API JSON",
    "",
    "Imports Wuhan University of Technology official 2018-2025 national admission score/rank query rows.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${item}\n${usage()}`);
  }
  return args;
}

function hash(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function numericRange(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function textFromHtml(html) {
  return normalizeText(decodeHtmlEntities(String(html ?? "").replace(/<[^>]+>/g, " ")));
}

function parseProvincesFromPage(html) {
  const select = String(html).match(/<div\b[^>]*id=["']select1["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
  const provinces = [...select.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => textFromHtml(match[1]))
    .filter(Boolean);
  return provinces.length ? provinces : FALLBACK_PROVINCES;
}

function provinceSlug(province) {
  return PROVINCE_SLUGS.get(province) || hash(province, 10);
}

function subjectSlug(subjectType) {
  const ascii = String(subjectType || "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return ascii || hash(subjectType, 10);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function download(url, options = {}) {
  const attempts = options.attempts || 4;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        body: options.body,
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-whut-v3186-importer/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,application/json,text/javascript,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || PAGE_URL,
          ...(options.body ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(800 * attempt);
    }
  }
  throw lastError;
}

async function downloadJson(url, data) {
  const body = new URLSearchParams(Object.entries(data).map(([key, value]) => [key, String(value)]));
  const buffer = await download(url, {
    method: "POST",
    body,
    accept: "application/json,text/javascript,*/*;q=0.8",
  });
  return { buffer, json: JSON.parse(buffer.toString("utf8")) };
}

async function ensureFile(file, useCache, fetcher) {
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file);
  const buffer = await fetcher();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return buffer;
}

async function ensureJsonFile(file, useCache, fetcher) {
  const buffer = await ensureFile(file, useCache, async () => (await fetcher()).buffer);
  return { buffer, json: JSON.parse(buffer.toString("utf8")) };
}

async function ensureRaw(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const pageFile = path.join(rawDir, "whut-score-page.html");
  const jsFile = path.join(rawDir, "whut-loaddata_lqqk.js");
  const pageHtml = (await ensureFile(pageFile, useCache, () => download(PAGE_URL))).toString("utf8");
  await ensureFile(jsFile, useCache, () => download(JS_URL));

  const provinces = parseProvincesFromPage(pageHtml);
  const queries = [];
  for (const province of provinces) {
    const yearsFile = path.join(rawDir, `${provinceSlug(province)}-years.json`);
    const yearsPayload = await ensureJsonFile(yearsFile, useCache, () => downloadJson(YEAR_URL, { province }));
    const years = (yearsPayload.json.data || []).map((item) => Number(item)).filter(Number.isFinite);
    for (const year of years) {
      const subjectsFile = path.join(rawDir, `${year}-${provinceSlug(province)}-subjects.json`);
      const subjectsPayload = await ensureJsonFile(subjectsFile, useCache, () =>
        downloadJson(SUBJECT_URL, { province, year })
      );
      const subjects = (subjectsPayload.json.data || []).map((item) => normalizeText(item)).filter(Boolean);
      const concreteSubjects = subjects.filter((subject) => subject !== "全部");
      const subjectsToFetch = concreteSubjects.length ? concreteSubjects : subjects;
      for (const subjectType of subjectsToFetch) {
        const scoreFile = path.join(rawDir, `${year}-${provinceSlug(province)}-${subjectSlug(subjectType)}-${hash(subjectType, 8)}-score.json`);
        const scorePayload = await ensureJsonFile(scoreFile, useCache, () =>
          downloadJson(SCORE_URL, { province, year, subjectType })
        );
        queries.push({ province, year, subjectType, file: scoreFile, payload: scorePayload.json });
        if (!useCache) await sleep(30);
      }
    }
  }
  return { pageFile, jsFile, provinces, queries };
}

function optionalNumber(value) {
  const text = normalizeText(value);
  if (!text || text === "--" || text === "-") return null;
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function optionalRank(value) {
  const text = normalizeText(value).replace(/,/g, "");
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function normalizedSubjectType(raw) {
  const text = normalizeText(raw);
  if (/艺术|美术|音乐|设计/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/综合|不分文理|改革/.test(text)) return "综合";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (text === "全部") return "综合";
  throw new Error(`Unsupported WHUT subject type: ${raw}`);
}

function subjectMappingNote(raw, normalized) {
  const text = normalizeText(raw);
  if (text === normalized) return undefined;
  if (/A类|B类/.test(text)) return `${text} 保留为 sourceSubjectRaw/candidateCategory，运行层仅按物理类/历史类大类归一检索。`;
  if (text === "综合改革") return "源站综合改革归一为站内综合科类。";
  return `源站科类 ${text} 归一为站内 ${normalized}。`;
}

function candidateCategory(raw) {
  const text = normalizeText(raw);
  const ab = text.match(/([AB])类/);
  if (ab) return `${ab[1]}类考生`;
  if (/少数民族/.test(text)) return "少数民族考生";
  return undefined;
}

function admissionKinds(text) {
  const kinds = [];
  if (/国家专项/.test(text)) kinds.push("国家专项");
  if (/高校专项/.test(text)) kinds.push("高校专项");
  if (/民族|少数民族/.test(text)) kinds.push("民族/少数民族");
  if (/预科/.test(text)) kinds.push("少数民族预科");
  if (/内高班|内地班|西藏班|新疆班/.test(text)) kinds.push("内高班/内地班");
  if (/南疆单列|单列/.test(text)) kinds.push("单列计划");
  if (/定向/.test(text)) kinds.push("定向");
  if (/提前批|航海|轮机/.test(text)) kinds.push("提前批/航海类");
  if (/艺术|美术|音乐|体育|设计/.test(text)) kinds.push("艺术/体育类");
  if (/中外合作|中英|中法|中澳|中俄/.test(text)) kinds.push("中外合作办学");
  return kinds;
}

function admissionTypeFor(...parts) {
  const kinds = admissionKinds(parts.map((part) => normalizeText(part)).join(" "));
  return kinds.length ? kinds.join("；") : "普通录取";
}

function formalScoreScopeFor(...parts) {
  const text = parts.map((part) => normalizeText(part)).join(" ");
  return /国家专项|高校专项|民族|少数民族|预科|内高班|内地班|西藏班|新疆班|南疆单列|单列|定向|提前批|航海|轮机|艺术|美术|音乐|体育/.test(text)
    ? "special-path-only"
    : "school-official-only";
}

function batchFor(scope, admissionType) {
  if (scope !== "special-path-only") return "本科批";
  if (admissionType.includes("国家专项")) return "国家专项本科";
  if (admissionType.includes("高校专项")) return "高校专项";
  if (admissionType.includes("预科")) return "少数民族预科";
  if (admissionType.includes("内高班")) return "内高班/内地班";
  if (admissionType.includes("艺术") || admissionType.includes("体育")) return "艺术/体育类本科";
  if (admissionType.includes("航海") || admissionType.includes("提前批")) return "提前批本科";
  if (admissionType.includes("单列")) return "单列计划本科";
  if (admissionType.includes("民族")) return "民族/少数民族本科";
  return "特殊类型本科";
}

function cautionsFor(record) {
  const cautions = [
    "本记录来自武汉理工大学本科招生网官方历年分数动态查询系统，是单校分省分类型/专业录取边界，不是省级教育考试院全量投档/录取分数表。",
  ];
  if (record.minRankEnd) {
    cautions.push("源系统公开位次值，运行层按原表位次保存为该校该行最低分对应位次；不得仅凭单校行输出录取概率。");
  } else {
    cautions.push("源系统该行未公开可计算的最低位次或仅给出非位次说明；运行层不生成假位次。");
  }
  if (record.formalScoreScope === "school-official-only") {
    cautions.push("普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于武汉理工大学候选边界复核，但不得替代同省省级正式投档表。");
  } else {
    cautions.push("该行属于专项、民族/考生类别、艺术体育、提前批/航海等特殊入口，按 formalScoreScope=special-path-only 隔离，不与普通本科批文化分边界混用。");
  }
  if (/中外合作/.test(record.admissionType || "")) {
    cautions.push("中外合作办学需额外复核学费、培养模式、外语要求和转专业限制。");
  }
  if (record.candidateCategory) {
    cautions.push("源站科类含考生类别标记，运行层保留 candidateCategory/sourceSubjectRaw，正式填报须回到当地当年招生政策复核适用资格。");
  }
  return cautions;
}

function baseRecord({ row, query, dataType, majorName, majorGroup, sourceApiPath, rowKind }) {
  const sourceSubjectRaw = normalizeText(row.subjectType || query.subjectType);
  const subjectType = normalizedSubjectType(sourceSubjectRaw);
  const rawType = normalizeText(row.type);
  const rawMajor = normalizeText(row.majorType || majorName);
  const admissionType = admissionTypeFor(rawType, rawMajor, sourceSubjectRaw);
  const formalScoreScope = formalScoreScopeFor(rawType, rawMajor, sourceSubjectRaw);
  const minScore = optionalNumber(row.zdf);
  if (!Number.isFinite(minScore)) return null;
  const maxScore = optionalNumber(row.zgf);
  const averageScore = optionalNumber(row.pjf);
  const controlScore = optionalNumber(row.skx);
  const minRank = optionalRank(row.wcz);
  const record = {
    id: `${row.year}-whut-national-school-${hash([
      rowKind,
      row.id,
      row.year,
      row.province,
      sourceSubjectRaw,
      rawType,
      rawMajor,
      row.electiveSubject || "",
      row.zdf,
      row.wcz,
    ].join("|"))}`,
    province: normalizeText(row.province || query.province),
    sourceProvinceRaw: normalizeText(row.province || query.province),
    year: Number(row.year || query.year),
    subjectType,
    sourceSubjectRaw,
    batch: batchFor(formalScoreScope, admissionType),
    sourceBatchRaw: rawType || admissionType,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: [...SOURCE.tags, ...admissionKinds(`${rawType} ${rawMajor} ${sourceSubjectRaw}`).filter((kind) => kind !== "中外合作办学")],
    dataType,
    majorName,
    majorGroup,
    admissionType,
    admissionSubtype: rawType || admissionType,
    formalScoreScope,
    minScore,
    scoreOnly: !minRank,
    rankUnavailable: !minRank,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: PAGE_URL,
    sourcePageUrl: PAGE_URL,
    sourceApiUrl: SCORE_URL,
    officialEvidencePath: path.relative(PROJECT_ROOT, sourceApiPath),
    sourceApiPath: path.relative(PROJECT_ROOT, sourceApiPath),
    sourceControlScoreRaw: normalizeText(row.skx),
    sourceMinScoreRaw: normalizeText(row.zdf),
    sourceMaxScoreRaw: normalizeText(row.zgf),
    sourceAverageScoreRaw: normalizeText(row.pjf),
    sourceRankRaw: normalizeText(row.wcz),
    rawRow: row,
  };
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(averageScore)) record.averageScore = averageScore;
  if (Number.isFinite(controlScore)) record.controlScore = controlScore;
  if (minRank) {
    record.minRankStart = minRank;
    record.minRankEnd = minRank;
    record.rankRangeText = String(row.wcz);
  }
  const mappingNote = subjectMappingNote(sourceSubjectRaw, subjectType);
  if (mappingNote) record.subjectMappingNote = mappingNote;
  const category = candidateCategory(sourceSubjectRaw);
  if (category) record.candidateCategory = category;
  if (row.electiveSubject != null && normalizeText(row.electiveSubject) && normalizeText(row.electiveSubject) !== "--") {
    record.electiveRequirement = normalizeText(row.electiveSubject);
  }
  if (row.remarks != null && normalizeText(row.remarks) && normalizeText(row.remarks) !== "--") {
    record.remarks = normalizeText(row.remarks);
  }
  record.cautions = cautionsFor(record);
  return record;
}

function recordsFromQuery(query) {
  const ext = query.payload?.ext || {};
  const records = [];
  const sourceApiPath = query.file;
  for (const row of ext.recruitStatisticsList || []) {
    const sourceSubjectRaw = normalizeText(row.subjectType || query.subjectType);
    const rawType = normalizeText(row.type);
    const admissionType = admissionTypeFor(rawType, sourceSubjectRaw);
    const subjectType = normalizedSubjectType(sourceSubjectRaw);
    const record = baseRecord({
      row,
      query,
      dataType: "institution-admission",
      majorName: `${SOURCE.schoolName}${admissionType}录取分数（${sourceSubjectRaw || subjectType}）`,
      majorGroup: `${SOURCE.schoolName}${normalizeText(row.province || query.province)}${sourceSubjectRaw}|${rawType || admissionType}`,
      sourceApiPath,
      rowKind: "statistics",
    });
    if (record) records.push(record);
  }
  for (const row of ext.recruitByMajorList || []) {
    const sourceSubjectRaw = normalizeText(row.subjectType || query.subjectType);
    const rawType = normalizeText(row.type);
    const majorName = normalizeText(row.majorType);
    if (!majorName) continue;
    const record = baseRecord({
      row,
      query,
      dataType: "major-admission",
      majorName,
      majorGroup: `${SOURCE.schoolName}${normalizeText(row.province || query.province)}${sourceSubjectRaw}|${rawType || "录取"}|${normalizeText(row.electiveSubject) || "选科未明"}`,
      sourceApiPath,
      rowKind: "major",
    });
    if (record) records.push(record);
  }
  return records;
}

function buildSourceNote(raw, records, skippedQueries) {
  const sourceFiles = [raw.pageFile, raw.jsFile, ...raw.queries.map((query) => query.file)];
  const years = [...new Set(records.map((record) => record.year).filter(Boolean))].sort((a, b) => a - b);
  const provinces = [...new Set(records.map((record) => record.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const scoreValues = records.map((record) => record.minScore).filter(Number.isFinite);
  const rankValues = records.map((record) => record.minRankEnd).filter(Number.isFinite);
  return {
    id: SOURCE.id,
    title: "武汉理工大学本科招生网：历年分数 2018-2025 年全国录取情况查询",
    publisher: "武汉理工大学",
    url: PAGE_URL,
    pageUrl: PAGE_URL,
    jsUrl: JS_URL,
    apiUrls: {
      years: YEAR_URL,
      subjectTypes: SUBJECT_URL,
      scoreAndRank: SCORE_URL,
    },
    quality: SOURCE.quality,
    usage: "抽取武汉理工大学本科招生网官方历年分数动态查询接口；保留 2018-2025 年全国分省分科类省级类型边界和分专业录取分数/位次。普通单校行作候选边界复核，专项、民族/考生类别、艺术体育、提前批/航海等隔离为特殊路径。",
    parsedRecords: records.length,
    provinceCount: provinces.length,
    years,
    queryCount: raw.queries.length,
    skippedQueries,
    institutionRecords: records.filter((record) => record.dataType === "institution-admission").length,
    majorRecords: records.filter((record) => record.dataType === "major-admission").length,
    recordsWithRank: records.filter((record) => record.minRankEnd).length,
    recordsWithoutRank: records.filter((record) => !record.minRankEnd).length,
    ordinarySchoolOfficialRecords: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRecords: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    byYear: countBy(records, (record) => record.year),
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    bySourceSubjectRaw: countBy(records, (record) => record.sourceSubjectRaw),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byDataType: countBy(records, (record) => record.dataType),
    scoreRange: numericRange(scoreValues),
    rankRange: numericRange(rankValues),
    rawPaths: sourceFiles.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: sourceFiles.map((file) => ({
      path: path.relative(PROJECT_ROOT, file),
      sha256: sha256File(file),
    })),
    transcriptionMethod: "official-dynamic-query-json",
    cautions: [
      "本源为武汉理工大学官方单校历年分数查询系统，不是任何省级教育考试院全量投档/录取分数表。",
      "源系统公开的位次值只作为该校该专业/类型最低分对应位次保存；推荐层不得仅凭单校行输出录取概率。",
      "普通学校官网单校行按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "国家专项、高校专项、民族/少数民族或 A/B 类考生口径、艺术体育、提前批/航海等按 formalScoreScope=special-path-only 隔离。",
      "源站 2018-2025 期间存在旧文理、新高考、综合改革和西藏 A/B 类考生口径并存；运行层保留 sourceSubjectRaw/candidateCategory，不改写成省级统一表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const raw = await ensureRaw(path.join(PROJECT_ROOT, RAW_DIR), args.useCache);
  const records = [];
  const skippedQueries = [];
  for (const query of raw.queries) {
    const ext = query.payload?.ext;
    if (!ext) {
      skippedQueries.push({
        province: query.province,
        year: query.year,
        subjectType: query.subjectType,
        reason: "missing ext payload",
        file: path.relative(PROJECT_ROOT, query.file),
      });
      continue;
    }
    records.push(...recordsFromQuery(query));
  }
  const sourceNote = buildSourceNote(raw, records, skippedQueries);
  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes: [sourceNote], records }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, outPath),
    sourceId: SOURCE.id,
    records: records.length,
    institutionRecords: sourceNote.institutionRecords,
    majorRecords: sourceNote.majorRecords,
    recordsWithRank: sourceNote.recordsWithRank,
    recordsWithoutRank: sourceNote.recordsWithoutRank,
    provinces: sourceNote.provinceCount,
    years: sourceNote.years,
    byFormalScoreScope: sourceNote.byFormalScoreScope,
    skippedQueries: skippedQueries.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
