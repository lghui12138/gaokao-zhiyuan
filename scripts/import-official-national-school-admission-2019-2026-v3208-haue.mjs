#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2019-2026-v3208-haue-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2019-2026-v3208-haue";
const BASE_URL = "https://hauezs.university-hr.com";
const INDEX_URL = `${BASE_URL}/index.php?menu=LLFSCX&sys=home`;
const JS_URL = `${BASE_URL}/js/school_lnlqcj_ajax.js`;
const SELECT_URL = `${BASE_URL}/index.php?sys=home&module=school_lnlqcj&act=getdata&subact=getDefLnlqcj`;
const TABLE_URL = `${BASE_URL}/index.php?sys=home&module=school_lnlqcj&dev=ajax`;

const SOURCE = {
  id: "official-haue-national-2019-2026-school-major-admission",
  quality: "official-school-haue-2019-2026-national-major-api-score-rank",
  schoolCode: "11517",
  schoolName: "河南工程学院",
  city: "郑州",
  tags: ["应用型本科", "河南", "郑州", "工科", "河南工程学院"],
};

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

const ART_PATTERN = /艺术|艺文|艺理|美术|音乐|舞蹈|播音|编导|表演|视觉传达|环境设计|产品设计|服装与服饰设计|数字媒体艺术/;
const SPORTS_PATTERN = /体育|运动训练|社会体育/;
const SPECIAL_PATH_PATTERN = /专升本|退役士兵|建档立卡|对口|专项|定向|预科|民族班|少数民族|南疆|哈密|单列/;
const COOP_OR_SINGLE_PATTERN = /中外合作|合作办学|联办|软件类|特色化示范性软件学院|较高收费|产业学院/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2019-2026-v3208-haue.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2019-2026-v3208-haue.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded official HTML/JSON evidence",
    "",
    "Imports 河南工程学院招生信息网 official 2019-2026 national historical admission query data.",
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

function positiveInteger(value) {
  const n = integerNumber(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function scoreRange(records) {
  const scores = records.map((record) => record.minScore).filter(Number.isFinite);
  return scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : { min: null, max: null };
}

function rankRange(records) {
  const ranks = records.map((record) => record.minRankEnd).filter(Number.isFinite);
  return ranks.length ? { min: Math.min(...ranks), max: Math.max(...ranks) } : { min: null, max: null };
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || "";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

function extractNames(html) {
  return [...String(html || "").matchAll(/data-name='([^']+)'/g)].map((match) => clean(match[1]));
}

function parseYears(indexHtml) {
  const years = extractNames(indexHtml)
    .map((value) => Number(value))
    .filter((year) => Number.isInteger(year) && year >= 2010 && year <= 2030);
  return [...new Set(years)].sort((a, b) => b - a);
}

function slugProvince(province) {
  return PROVINCE_SLUGS.get(province) || stableId([province]);
}

function slugText(value) {
  return stableId([value]);
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

async function downloadJson(rawRoot, relPath, url, useCache, bodyObj) {
  const text = await downloadText(rawRoot, relPath, url, useCache, {
    method: "POST",
    accept: "application/json,text/plain,*/*",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(bodyObj),
  });
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse JSON from ${relPath}: ${error.message}; prefix=${text.slice(0, 200)}`);
  }
}

async function fetchSelect(rawRoot, relPath, useCache, params) {
  const json = await downloadJson(rawRoot, relPath, SELECT_URL, useCache, params);
  if (!json || Number(json.result) !== 1 || !json.content) {
    throw new Error(`Unexpected select response in ${relPath}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.content;
}

function parseTotalCount(countpage) {
  const text = String(countpage || "");
  const match = text.match(/共\s*<b>(\d+)<\/b>\s*条信息/);
  return match ? Number(match[1]) : null;
}

async function fetchTable(rawRoot, baseRelPath, useCache, params) {
  const first = await downloadJson(rawRoot, `${baseRelPath}-offset0.json`, TABLE_URL, useCache, {
    ...params,
    pagelist: "500",
    pageNumber: "1",
    pageSize: "500",
    limit: "500",
    offset: "0",
  });
  const records = Array.isArray(first.records_block) ? [...first.records_block] : [];
  const rawFiles = [`${baseRelPath}-offset0.json`];
  const totalCount = parseTotalCount(first.countpage);
  if (Number.isFinite(totalCount) && totalCount > records.length && records.length >= 500) {
    for (let offset = 500; offset < totalCount; offset += 500) {
      const pageNumber = Math.floor(offset / 500) + 1;
      const relPath = `${baseRelPath}-offset${offset}.json`;
      const next = await downloadJson(rawRoot, relPath, TABLE_URL, useCache, {
        ...params,
        pagelist: "500",
        pageNumber: String(pageNumber),
        pageSize: "500",
        limit: "500",
        offset: String(offset),
      });
      const more = Array.isArray(next.records_block) ? next.records_block : [];
      records.push(...more);
      rawFiles.push(relPath);
      await sleep(20);
    }
  }
  return {
    first,
    records,
    rawFiles,
    totalCount,
  };
}

function normalizeSubject(raw) {
  const text = clean(raw);
  if (!text) return "官网未列科类";
  if (/艺术|艺文|艺理/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/文\/历史|历史/.test(text)) return "历史类";
  if (/理\/物理|物理/.test(text)) return "物理类";
  if (/文科|文史/.test(text)) return "文科";
  if (/理科|理工/.test(text)) return "理科";
  if (/综合改革|不分文理|不分科目|不分首选科目/.test(text)) return "综合改革";
  return text;
}

function classifyAdmission(row) {
  const text = [row.KLMC, row.PCMC, row.CCMC, row.KSLX, row.ZYMC, row.BZ].map(clean).join(" ");
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
  if (SPECIAL_PATH_PATTERN.test(text) && !COOP_OR_SINGLE_PATTERN.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "专项/定向/预科/民族/对口等", formalScoreScope: "special-path-only" };
  }
  if (COOP_OR_SINGLE_PATTERN.test(text)) {
    return { admissionType: "普通录取", admissionSubtype: "中外合作/软件类/产业学院等单列专业", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch(row, classification) {
  const raw = clean(row.PCMC);
  if (/高职|专科/.test(raw)) return "高职（专科）批";
  if (/本科一批/.test(raw)) return "本科一批";
  if (/本科二批|本科第二批/.test(raw)) return "本科二批";
  if (/普通本科批|本科批/.test(raw)) return "本科批";
  if (/艺术/.test(raw) || classification.admissionType === "艺术类录取") return "艺术类批次";
  if (/体育/.test(raw) || classification.admissionType === "体育类录取") return "体育类批次";
  if (/专升本/.test(raw)) return "专升本";
  if (classification.formalScoreScope === "special-path-only") return "特殊类型批次";
  return raw || "官网未列批次";
}

function inferDataType(row) {
  const text = [row.PCMC, row.CCMC, row.ZYMC].map(clean).join(" ");
  if (/高职|专科/.test(text)) return "vocational-admission";
  return "major-admission";
}

function scoreMetric(classification) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  return "高考文化分";
}

function parseRows(rows, context) {
  const records = [];
  const skippedRows = [];
  rows.forEach((row, rowIndex) => {
    const year = Number(clean(row.ND));
    const sourceProvinceRaw = clean(row.SFMC);
    const sourceSubjectRaw = clean(row.KLMC);
    const sourceBatchRaw = clean(row.PCMC);
    const sourceLevelRaw = clean(row.CCMC);
    const sourceExamTypeRaw = clean(row.KSLX);
    const majorName = clean(row.ZYMC);
    const minScoreRaw = clean(row.ZDF);
    const minScore = firstNumber(minScoreRaw);
    const maxScore = firstNumber(row.ZGF);
    const avgScore = firstNumber(row.PJF);
    const controlLine = firstNumber(row.SKX);
    const minRank = positiveInteger(row.ZDFPW);
    const avgRank = positiveInteger(row.PJFPW);
    const admissionCount = integerNumber(row.TDRS);
    const note = clean(row.BZ);

    if (year !== context.year) {
      skippedRows.push({ reason: "unexpected-year", context, rowIndex, row, year });
      return;
    }
    if (sourceProvinceRaw !== context.province) {
      skippedRows.push({ reason: "unexpected-province", context, rowIndex, row });
      return;
    }
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-major-or-min-score", context, rowIndex, row, minScoreRaw });
      return;
    }
    if (minScore <= 0) {
      skippedRows.push({ reason: "nonpositive-min-score-placeholder", context, rowIndex, row, minScore });
      return;
    }
    if (minScore > 750) {
      skippedRows.push({ reason: "score-out-of-range", context, rowIndex, row, minScore });
      return;
    }

    const classification = classifyAdmission(row);
    const subjectType = normalizeSubject(sourceSubjectRaw);
    const batch = normalizeBatch(row, classification);
    const dataType = inferDataType(row);
    const sourceRelPath = `${RAW_DIR}/${context.rawFiles[0]}`;
    const record = {
      id: `${year}-haue-major-${stableId([
        row.ID,
        year,
        sourceProvinceRaw,
        sourceSubjectRaw,
        sourceBatchRaw,
        majorName,
        minScoreRaw,
        row.ZDFPW,
      ])}`,
      province: context.province,
      sourceProvinceRaw,
      year,
      subjectType,
      sourceSubjectRaw,
      batch,
      sourceBatchRaw,
      sourceLevelRaw,
      sourceExamTypeRaw,
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      city: SOURCE.city,
      schoolTags: SOURCE.tags,
      dataType,
      majorName,
      majorGroup: [SOURCE.schoolName, context.province, subjectType, batch, majorName].filter(Boolean).join("-"),
      admissionType: classification.admissionType,
      admissionSubtype: classification.admissionSubtype,
      formalScoreScope: classification.formalScoreScope,
      minScore,
      scoreMetric: scoreMetric(classification),
      scoreOnly: !Number.isFinite(minRank),
      rankUnavailable: !Number.isFinite(minRank),
      sourceId: SOURCE.id,
      sourceQuality: SOURCE.quality,
      schoolOfficialScope: "single-school-score",
      sourceUrl: TABLE_URL,
      sourcePageUrl: TABLE_URL,
      sourceIndexUrl: INDEX_URL,
      sourceApiEndpoint: "/index.php?sys=home&module=school_lnlqcj&dev=ajax",
      officialEvidencePath: sourceRelPath,
      sourceJsonPath: sourceRelPath,
      sourceRawFiles: context.rawFiles.map((file) => `${RAW_DIR}/${file}`),
      sourceRecordId: row.ID == null ? "" : String(row.ID),
      sourceMinScoreRaw: minScoreRaw,
      sourceMinRankRaw: clean(row.ZDFPW),
      sourceAvgRankRaw: clean(row.PJFPW),
      sourceMaxScoreRaw: clean(row.ZGF),
      sourceAvgScoreRaw: clean(row.PJF),
      sourceControlLineRaw: clean(row.SKX),
      sourceAdmissionCountRaw: clean(row.TDRS),
      rawRow: {
        source: "haue-2019-2026-official-school-lnlqcj-api",
        rowIndex,
        request: context.request,
        row,
      },
      cautions: [
        "本记录来自河南工程学院招生信息网官方“历年录取成绩查询”接口，是单校分省分专业录取边界，不是省级教育考试院全量投档/录取分数表。",
        "源表列出最低分排位时按官方 ZDFPW 保存；源表未列最低位次时标记 rankUnavailable=true，不生成假位次。",
        "艺术、体育、专升本、对口、专项、定向、预科、民族等特殊路径按 special-path-only 隔离，不与普通高考文化分混算。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    };
    if (Number.isFinite(maxScore)) record.maxScore = maxScore;
    if (Number.isFinite(avgScore)) record.avgScore = avgScore;
    if (Number.isFinite(controlLine)) record.controlLine = controlLine;
    if (Number.isFinite(minRank)) {
      record.minRankStart = minRank;
      record.minRankEnd = minRank;
      record.rankRangeText = String(minRank);
    }
    if (Number.isFinite(avgRank)) record.avgRank = avgRank;
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

function rawFileInfo(rawRoot, relPath, extra = {}) {
  const file = path.join(rawRoot, relPath);
  return {
    path: `${RAW_DIR}/${relPath}`,
    sha256: sha256File(file),
    bytes: fs.statSync(file).size,
    ...extra,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  guardProjectRoot();
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const indexHtml = await downloadText(rawRoot, "index-llfscx.html", INDEX_URL, args.useCache);
  await downloadText(rawRoot, "school_lnlqcj_ajax.js", JS_URL, args.useCache);
  const years = parseYears(indexHtml);
  if (!years.length) throw new Error("Could not extract any years from HAUE official query page");

  const records = [];
  const skippedRows = [];
  const querySummaries = [];
  const emptyQueries = [];
  const selectSummaries = [];

  for (const year of years) {
    const yearRel = `select-year-${year}.json`;
    const yearContent = await fetchSelect(rawRoot, yearRel, args.useCache, {
      select_id: "ND",
      ND_value: String(year),
      SFMC_value: "",
      PCMC_value: "",
      KLMC_value: "",
    });
    const provinces = extractNames(yearContent.SFMC_selects);
    selectSummaries.push({
      year,
      rawPath: `${RAW_DIR}/${yearRel}`,
      provinceCount: provinces.length,
      provinces,
    });
    for (const province of provinces) {
      const provinceRel = `select-province-${year}-${slugProvince(province)}.json`;
      const provinceContent = await fetchSelect(rawRoot, provinceRel, args.useCache, {
        select_id: "SFMC",
        ND_value: String(year),
        SFMC_value: province,
        PCMC_value: "",
        KLMC_value: "",
      });
      const batches = extractNames(provinceContent.PCMC_selects);
      selectSummaries.push({
        year,
        province,
        rawPath: `${RAW_DIR}/${provinceRel}`,
        batchCount: batches.length,
        batches,
      });
      for (const batch of batches) {
        const batchHash = slugText(batch);
        const batchRel = `select-batch-${year}-${slugProvince(province)}-${batchHash}.json`;
        const batchContent = await fetchSelect(rawRoot, batchRel, args.useCache, {
          select_id: "PCMC",
          ND_value: String(year),
          SFMC_value: province,
          PCMC_value: batch,
          KLMC_value: "",
        });
        const subjects = extractNames(batchContent.KLMC_selects);
        selectSummaries.push({
          year,
          province,
          batch,
          rawPath: `${RAW_DIR}/${batchRel}`,
          subjectCount: subjects.length,
          subjects,
        });
        for (const subject of subjects) {
          const subjectHash = slugText(subject);
          const baseRel = `table-${year}-${slugProvince(province)}-${batchHash}-${subjectHash}`;
          const request = {
            ND: String(year),
            SFMC: province,
            PCMC: batch,
            KLMC: subject,
          };
          const table = await fetchTable(rawRoot, baseRel, args.useCache, request);
          const context = { year, province, batch, subject, request, rawFiles: table.rawFiles };
          const parsed = parseRows(table.records, context);
          records.push(...parsed.records);
          skippedRows.push(...parsed.skippedRows.map((row) => ({ ...row, rawPath: `${RAW_DIR}/${table.rawFiles[0]}` })));
          const summary = {
            year,
            province,
            batch,
            subject,
            totalCount: table.totalCount,
            rawRows: table.records.length,
            parsedRecords: parsed.records.length,
            skippedRows: parsed.skippedRows.length,
            rawFiles: table.rawFiles.map((file) => `${RAW_DIR}/${file}`),
            sha256: sha256File(path.join(rawRoot, table.rawFiles[0])),
          };
          querySummaries.push(summary);
          if (!parsed.records.length) emptyQueries.push(summary);
          await sleep(20);
        }
      }
    }
  }

  const dupes = duplicateIds(records);
  if (dupes.length) throw new Error(`Duplicate record ids: ${dupes.slice(0, 5).join(", ")}`);
  const badScores = records.filter((record) => !Number.isFinite(record.minScore) || record.minScore <= 0 || record.minScore > 750);
  if (badScores.length) throw new Error(`Bad minScore rows: ${badScores.slice(0, 3).map((record) => record.id).join(", ")}`);
  const implausibleOrdinary = records.filter((record) => record.formalScoreScope === "school-official-only" && record.minScore < 100);
  if (implausibleOrdinary.length) {
    throw new Error(`Implausible ordinary school-official scores below 100: ${implausibleOrdinary.slice(0, 3).map((record) => `${record.id}:${record.sourceSubjectRaw}:${record.sourceBatchRaw}:${record.minScore}`).join(", ")}`);
  }
  const badRanks = records.filter((record) => record.rankUnavailable === false && (!Number.isInteger(record.minRankEnd) || record.minRankEnd <= 0));
  if (badRanks.length) throw new Error(`Bad rank rows: ${badRanks.slice(0, 3).map((record) => record.id).join(", ")}`);

  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const yearsWithRecords = [...new Set(records.map((record) => record.year))].sort((a, b) => a - b);
  const missingMainlandProvinces = MAINLAND_PROVINCES.filter((province) => !provincesWithRecords.includes(province));
  const recordsWithRank = records.filter((record) => !record.rankUnavailable);
  const rankUnavailableRecords = records.filter((record) => record.rankUnavailable);
  const rawFileCount = 2 + selectSummaries.length + querySummaries.reduce((sum, query) => sum + query.rawFiles.length, 0);
  const detailedRawManifest = {
    index: rawFileInfo(rawRoot, "index-llfscx.html", { url: INDEX_URL }),
    script: rawFileInfo(rawRoot, "school_lnlqcj_ajax.js", { url: JS_URL }),
    selectFiles: selectSummaries.map((summary) => ({
      ...summary,
      sha256: sha256File(path.join(rawRoot, summary.rawPath.replace(`${RAW_DIR}/`, ""))),
    })),
    tableFiles: querySummaries.map((summary) => summary),
  };
  const manifestRel = "raw-file-manifest.json";
  fs.writeFileSync(path.join(rawRoot, manifestRel), `${JSON.stringify(detailedRawManifest, null, 2)}\n`);

  const sourceNote = {
    id: SOURCE.id,
    title: "河南工程学院招生信息网：2019-2026年全国分省分专业历年录取成绩",
    publisher: "河南工程学院招生信息网",
    url: INDEX_URL,
    queryUrl: TABLE_URL,
    quality: SOURCE.quality,
    usage: "从河南工程学院招生信息网官方“历年录取成绩查询”页面读取 2019-2026 年、分省、分批次、分科类联动筛选项，并用同页官方 school_lnlqcj ajax 接口逐组合下载 JSON，抽取年份、省份、科类、批次、层次、考试类型、专业、控制线、最低分、最低分排位、平均分、最高分和录取人数。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: provincesWithRecords.length,
    provincesWithRecords,
    missingMainlandProvinces,
    years: yearsWithRecords,
    availableYearsFromPage: years,
    queryCount: querySummaries.length,
    emptyQueryCount: emptyQueries.length,
    emptyQueries,
    rawDir: RAW_DIR,
    rawFileCount,
    rawFileManifestPath: `${RAW_DIR}/${manifestRel}`,
    rawFiles: [
      { path: `${RAW_DIR}/index-llfscx.html`, url: INDEX_URL, sha256: sha256File(path.join(rawRoot, "index-llfscx.html")) },
      { path: `${RAW_DIR}/school_lnlqcj_ajax.js`, url: JS_URL, sha256: sha256File(path.join(rawRoot, "school_lnlqcj_ajax.js")) },
      { path: `${RAW_DIR}/${manifestRel}`, sha256: sha256File(path.join(rawRoot, manifestRel)) },
    ],
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
    recordsWithRank: recordsWithRank.length,
    rankUnavailableRecords: rankUnavailableRecords.length,
    officialRankRange: rankRange(recordsWithRank),
    cautions: [
      "河南工程学院官网单校分数/位次只用于该校候选边界复核，不替代各省教育考试院全量投档/录取分数表。",
      "源表列出最低分排位的记录按 ZDFPW 保存；未列 ZDFPW 的记录不生成假位次。",
      "艺术、体育、专升本、对口、专项、定向、预科、民族等特殊路径按 special-path-only 隔离。",
      "软件类、中外合作办学、产业学院等单列专业保留为 school-official-only 并通过 admissionSubtype 提示，不与普通无额外成本/培养模式风险的专业混为一谈。",
      "空组合按官方接口原文保存，不生成假记录，也不关闭省级正式缺口。",
    ],
  };

  const payload = {
    sourceNotes: [sourceNote],
    skippedRows,
    selectSummaries,
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
    years: yearsWithRecords,
    availableYearsFromPage: years,
    provincesWithRecords: provincesWithRecords.length,
    missingMainlandProvinces,
    queryCount: querySummaries.length,
    emptyQueryCount: emptyQueries.length,
    rawFileCount,
    recordTypeCounts: sourceNote.recordTypeCounts,
    formalScoreScopeCounts: sourceNote.formalScoreScopeCounts,
    admissionTypeCounts: sourceNote.admissionTypeCounts,
    admissionSubtypeCounts: sourceNote.admissionSubtypeCounts,
    recordsWithRank: sourceNote.recordsWithRank,
    rankUnavailableRecords: sourceNote.rankUnavailableRecords,
    scoreRange: sourceNote.scoreRange,
    ordinarySchoolOfficialScoreRange: sourceNote.ordinarySchoolOfficialScoreRange,
    specialPathScoreRange: sourceNote.specialPathScoreRange,
    officialRankRange: sourceNote.officialRankRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
