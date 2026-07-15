#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2021-2025-v3207-zua-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2021-2025-v3207-zua";
const BASE_URL = "https://zsxxw.zua.edu.cn";
const INDEX_URL = `${BASE_URL}/index/lnfs.htm`;
const QUERY_URL = `${BASE_URL}/system/resource/bkzsw/lnfs.jsp`;
const OWNER = "1425408151";
const TEMP_ID = "1";

const SOURCE = {
  id: "official-zua-national-2021-2025-school-major-admission",
  quality: "official-school-zua-2021-2025-national-major-api-score",
  schoolCode: "10485",
  schoolName: "郑州航空工业管理学院",
  city: "郑州",
  tags: ["航空", "管理", "河南", "郑州航空工业管理学院"],
};

const EXPECTED_YEARS = [2021, 2022, 2023, 2024, 2025];
const MAINLAND_PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
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

const ART_PATTERN = /艺术|美术|设计|动画|视觉传达|环境设计|产品设计|航空服务艺术|音乐|舞蹈|播音|编导|表演/;
const SPORTS_PATTERN = /体育|运动训练|社会体育/;
const SPECIAL_PATTERN = /国家专项|地方专项|高校专项|专项|飞行技术|专升本|退役士兵|建档立卡|预科|民族|南疆|哈密|定向|内高班|单列/;
const COOP_PATTERN = /中外合作|合作办学|联办|较高收费|南乌拉尔/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2021-2025-v3207-zua.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2021-2025-v3207-zua.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded official HTML/JSON evidence",
    "",
    "Imports Zhengzhou University of Aeronautics official 2021-2025 province major admission query API data.",
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
    throw new Error("Refusing to run API ingestion from /Volumes/mac_2T; run this importer from the internal APFS project copy.");
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveProjectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 18);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248))
    .replace(/\s+/g, " ")
    .trim();
}

function firstNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function integerNumber(value) {
  const n = firstNumber(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function scoreRange(records) {
  const scores = records.map((record) => record.minScore).filter(Number.isFinite);
  return scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : { min: null, max: null };
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || "";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

function rawQueryName(province) {
  return `api-${PROVINCE_SLUGS.get(province) || stableId([province])}.json`;
}

async function fetchText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: options.method || "GET",
        signal: AbortSignal.timeout(60_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "text/html,application/json,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: INDEX_URL,
          ...(options.headers || {}),
        },
        body: options.body,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      if (text.length < 2) throw new Error(`Unexpectedly short response (${text.length} chars) for ${url}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      await sleep(attempt * 1000);
    }
  }
  throw lastError;
}

async function downloadText(rawRoot, relPath, url, useCache, options = {}) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const text = await fetchText(url, options);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text);
  return text;
}

async function fetchProvinceJson(rawRoot, province, useCache) {
  const relPath = rawQueryName(province);
  const text = await downloadText(rawRoot, relPath, QUERY_URL, useCache, {
    method: "POST",
    accept: "application/json,text/plain,*/*",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      owner: OWNER,
      tempid: TEMP_ID,
      ss: province,
      nf: "",
      kl: "",
    }),
  });
  try {
    const json = JSON.parse(text);
    if (!Array.isArray(json)) throw new Error(`expected array, got ${typeof json}`);
    return { relPath, json };
  } catch (error) {
    throw new Error(`Could not parse JSON from ${relPath}: ${error.message}; prefix=${text.slice(0, 200)}`);
  }
}

function extractAvailableProvinces(indexHtml) {
  const provinceBlockMatch = String(indexHtml).match(/id="province"[\s\S]*?<\/dd>/);
  const provinceBlock = provinceBlockMatch ? provinceBlockMatch[0] : indexHtml;
  return MAINLAND_PROVINCES.filter((province) => provinceBlock.includes(`>${province}<`) || provinceBlock.includes(province));
}

function normalizeSubject(raw) {
  const text = clean(raw);
  if (!text) return "官网未列科类";
  if (/艺术/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/文\/历史|历史|文科|文史/.test(text)) return "历史类";
  if (/理\/物理|物理|理科|理工/.test(text)) return "物理类";
  if (/综合改革|不分文理|不分科目|不分首选科目/.test(text)) return "综合改革";
  if (/文理综合/.test(text)) return "文理综合";
  return text;
}

function classifyAdmission(row) {
  const text = [row.lx, row.kl, row.zy, row.bz].map(clean).join(" ");
  if (ART_PATTERN.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (SPORTS_PATTERN.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/专升本/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "专升本", formalScoreScope: "special-path-only" };
  }
  if (/退役士兵/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "退役士兵", formalScoreScope: "special-path-only" };
  }
  if (/建档立卡/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "建档立卡", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "国家专项", formalScoreScope: "special-path-only" };
  }
  if (/地方专项/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "地方专项", formalScoreScope: "special-path-only" };
  }
  if (/飞行技术/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "飞行技术", formalScoreScope: "special-path-only" };
  }
  if (SPECIAL_PATTERN.test(text) && !COOP_PATTERN.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "专项/定向/预科/民族等", formalScoreScope: "special-path-only" };
  }
  if (COOP_PATTERN.test(text)) {
    return { admissionType: "特殊收费或合作办学专业", admissionSubtype: "中外合作/联办/单列专业", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch(row, classification) {
  const raw = clean(row.lx);
  if (/本科一批/.test(raw)) return "本科一批";
  if (/本科二批/.test(raw)) return "本科二批";
  if (/本科批/.test(raw)) return "本科批";
  if (/国家专项/.test(raw)) return "国家专项批";
  if (/地方专项/.test(raw)) return "地方专项批";
  if (/飞行技术/.test(raw)) return "飞行技术";
  if (/专升本/.test(raw)) return "专升本";
  if (/艺术/.test(raw) || classification.admissionType === "艺术类录取") return "艺术类批次";
  if (/体育/.test(raw) || classification.admissionType === "体育类录取") return "体育类批次";
  if (/中外合作/.test(raw)) return "本科批（中外合作办学）";
  if (/普通类/.test(raw)) return "本科批";
  if (classification.formalScoreScope === "special-path-only") return "特殊类型批次";
  return raw || "本科批";
}

function scoreMetric(classification) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  return "高考文化分";
}

function parseRecordsFromProvince(rows, province, rawRelPath) {
  const records = [];
  const skippedRows = [];
  rows.forEach((row, rowIndex) => {
    const year = Number(clean(row.nf));
    const sourceProvinceRaw = clean(row.ss);
    const sourceSubjectRaw = clean(row.kl);
    const sourceAdmissionTypeRaw = clean(row.lx);
    const majorName = clean(row.zy);
    const note = clean(row.bz);
    const minScoreRaw = clean(row.zdf);
    const maxScoreRaw = clean(row.zgf);
    const avgScoreRaw = clean(row.pjf);
    const minScore = firstNumber(minScoreRaw);
    const maxScore = firstNumber(maxScoreRaw);
    const avgScore = firstNumber(avgScoreRaw);
    const admissionCount = integerNumber(row.lqrs);
    if (sourceProvinceRaw !== province) {
      skippedRows.push({ reason: "unexpected-province", province, rowIndex, row });
      return;
    }
    if (!EXPECTED_YEARS.includes(year)) {
      skippedRows.push({ reason: "outside-expected-year-range", province, rowIndex, row, year });
      return;
    }
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-major-or-min-score", province, rowIndex, row, minScoreRaw });
      return;
    }
    if (minScore < 0 || minScore > 750) {
      skippedRows.push({ reason: "score-out-of-range", province, rowIndex, row, minScore });
      return;
    }
    const classification = classifyAdmission(row);
    const subjectType = normalizeSubject(sourceSubjectRaw);
    const batch = normalizeBatch(row, classification);
    const record = {
      id: `${year}-zua-major-${stableId([
        row._id,
        year,
        province,
        sourceSubjectRaw,
        sourceAdmissionTypeRaw,
        majorName,
        minScoreRaw,
        maxScoreRaw,
      ])}`,
      province,
      sourceProvinceRaw,
      year,
      subjectType,
      sourceSubjectRaw,
      batch,
      sourceBatchRaw: sourceAdmissionTypeRaw || "郑州航空工业管理学院官网历年分数接口未列批次",
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      city: SOURCE.city,
      schoolTags: SOURCE.tags,
      dataType: "major-admission",
      majorName,
      majorGroup: [SOURCE.schoolName, province, subjectType, batch, majorName].filter(Boolean).join("-"),
      admissionType: classification.admissionType,
      admissionSubtype: classification.admissionSubtype,
      formalScoreScope: classification.formalScoreScope,
      minScore,
      scoreMetric: scoreMetric(classification),
      scoreOnly: true,
      rankUnavailable: true,
      sourceId: SOURCE.id,
      sourceQuality: SOURCE.quality,
      schoolOfficialScope: "single-school-score",
      sourceUrl: QUERY_URL,
      sourcePageUrl: QUERY_URL,
      sourceIndexUrl: INDEX_URL,
      sourceApiEndpoint: "/system/resource/bkzsw/lnfs.jsp",
      officialEvidencePath: rawRelPath,
      sourceJsonPath: rawRelPath,
      sourceRecordId: row._id == null ? "" : String(row._id),
      sourceAdmissionTypeRaw,
      sourceMinScoreRaw: minScoreRaw,
      sourceMaxScoreRaw: maxScoreRaw,
      sourceAvgScoreRaw: avgScoreRaw,
      sourceAdmissionCountRaw: clean(row.lqrs),
      rawRow: {
        source: "zua-2021-2025-official-bkzsw-lnfs-api",
        rowIndex,
        request: { owner: OWNER, tempid: TEMP_ID, ss: province, nf: "", kl: "", lx: "" },
        row,
      },
      cautions: [
        "本记录来自郑州航空工业管理学院招生信息网官方“历年分数”接口，是单校分省分专业录取边界，不是省级教育考试院全量投档/录取分数表。",
        "官网源表没有公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
        "艺术、体育、专升本、专项、飞行技术、退役士兵、建档立卡等特殊路径按 special-path-only 隔离，不与普通高考文化分混算。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    };
    if (Number.isFinite(maxScore)) record.maxScore = maxScore;
    if (Number.isFinite(avgScore)) record.avgScore = avgScore;
    if (Number.isFinite(admissionCount)) {
      record.planCount = admissionCount;
      record.admissionCount = admissionCount;
    }
    if (note) record.sourceNoteRaw = note;
    records.push(record);
  });
  return { records, skippedRows };
}

function duplicateIds(records) {
  const seen = new Set();
  const dupes = [];
  for (const record of records) {
    if (seen.has(record.id)) dupes.push(record.id);
    seen.add(record.id);
  }
  return dupes;
}

async function main() {
  const args = parseArgs(process.argv);
  guardProjectRoot();
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const indexHtml = await downloadText(rawRoot, "index-lnfs.html", INDEX_URL, args.useCache);
  const availableProvinces = extractAvailableProvinces(indexHtml);
  if (availableProvinces.length !== MAINLAND_PROVINCES.length) {
    throw new Error(`Official page province list mismatch: found ${availableProvinces.length}; missing ${MAINLAND_PROVINCES.filter((p) => !availableProvinces.includes(p)).join(",")}`);
  }

  const records = [];
  const skippedRows = [];
  const querySummaries = [];
  const emptyResponses = [];
  for (const province of MAINLAND_PROVINCES) {
    const { relPath, json } = await fetchProvinceJson(rawRoot, province, args.useCache);
    const sourceRelPath = `${RAW_DIR}/${relPath}`;
    const parsed = parseRecordsFromProvince(json, province, sourceRelPath);
    records.push(...parsed.records);
    skippedRows.push(...parsed.skippedRows.map((row) => ({ ...row, rawPath: sourceRelPath })));
    if (!parsed.records.length) emptyResponses.push({ province, rawPath: sourceRelPath, rowCount: json.length });
    querySummaries.push({
      province,
      rawRows: json.length,
      parsedRecords: parsed.records.length,
      skippedRows: parsed.skippedRows.length,
      rawPath: sourceRelPath,
      sha256: sha256File(path.join(rawRoot, relPath)),
    });
    await sleep(40);
  }

  const dupes = duplicateIds(records);
  if (dupes.length) throw new Error(`Duplicate record ids: ${dupes.slice(0, 5).join(", ")}`);
  const badScores = records.filter((record) => !Number.isFinite(record.minScore) || record.minScore < 0 || record.minScore > 750);
  if (badScores.length) throw new Error(`Bad minScore rows: ${badScores.slice(0, 3).map((record) => record.id).join(", ")}`);

  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingMainlandProvinces = MAINLAND_PROVINCES.filter((province) => !provincesWithRecords.includes(province));
  const yearsWithRecords = [...new Set(records.map((record) => record.year))].sort((a, b) => a - b);
  const sourceNote = {
    id: SOURCE.id,
    title: "郑州航空工业管理学院招生信息网：2021-2025年全国分省分专业历年分数",
    publisher: "郑州航空工业管理学院招生信息网",
    url: INDEX_URL,
    queryUrl: QUERY_URL,
    quality: SOURCE.quality,
    usage: "从郑州航空工业管理学院招生信息网官方“历年分数”页面读取省份筛选项，并用同页官方 bkzsw/lnfs.jsp 接口逐省下载 JSON，抽取年份、省市、类型、科类、专业、录取人数、最低分、平均分和最高分。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: provincesWithRecords.length,
    provincesWithRecords,
    missingMainlandProvinces,
    years: yearsWithRecords,
    expectedYears: EXPECTED_YEARS,
    queryCount: querySummaries.length,
    emptyResponseCount: emptyResponses.length,
    emptyResponses,
    recordTypeCounts: countBy(records, (record) => record.dataType),
    formalScoreScopeCounts: countBy(records, (record) => record.formalScoreScope),
    admissionTypeCounts: countBy(records, (record) => record.admissionType),
    admissionSubtypeCounts: countBy(records, (record) => record.admissionSubtype),
    subjectTypeCounts: countBy(records, (record) => record.subjectType),
    recordsByYear: countBy(records, (record) => String(record.year)),
    recordsByProvince: countBy(records, (record) => record.province),
    scoreRange: scoreRange(records),
    ordinarySchoolOfficialScoreRange: scoreRange(records.filter((record) => record.formalScoreScope === "school-official-only")),
    specialPathScoreRange: scoreRange(records.filter((record) => record.formalScoreScope === "special-path-only")),
    rawDir: RAW_DIR,
    rawFiles: [
      { path: `${RAW_DIR}/index-lnfs.html`, url: INDEX_URL, sha256: sha256File(path.join(rawRoot, "index-lnfs.html")) },
      ...querySummaries.map((query) => ({
        path: query.rawPath,
        url: QUERY_URL,
        request: { owner: OWNER, tempid: TEMP_ID, ss: query.province, nf: "", kl: "", lx: "" },
        sha256: query.sha256,
      })),
    ],
    cautions: [
      "郑州航空工业管理学院官网单校分数只用于该校候选边界复核，不替代各省教育考试院全量投档/录取分数表。",
      "官网源表未公开最低位次；本包所有记录均标记 rankUnavailable=true，不生成假位次。",
      "艺术、体育、专升本、专项、飞行技术、退役士兵、建档立卡等特殊路径按 special-path-only 隔离。",
      "空响应按官方接口原文保存，不生成假记录，也不关闭省级正式缺口。",
    ],
  };

  const payload = {
    sourceNotes: [sourceNote],
    skippedRows,
    querySummaries,
    records,
  };
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    out: args.out,
    rawDir: RAW_DIR,
    records: records.length,
    skippedRows: skippedRows.length,
    provincesWithRecords: provincesWithRecords.length,
    missingMainlandProvinces,
    years: yearsWithRecords,
    queryCount: querySummaries.length,
    emptyResponseCount: emptyResponses.length,
    recordTypeCounts: sourceNote.recordTypeCounts,
    formalScoreScopeCounts: sourceNote.formalScoreScopeCounts,
    admissionTypeCounts: sourceNote.admissionTypeCounts,
    admissionSubtypeCounts: sourceNote.admissionSubtypeCounts,
    scoreRange: sourceNote.scoreRange,
    ordinarySchoolOfficialScoreRange: sourceNote.ordinarySchoolOfficialScoreRange,
    specialPathScoreRange: sourceNote.specialPathScoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
