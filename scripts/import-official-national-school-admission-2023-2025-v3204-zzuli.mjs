#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2023-2025-v3204-zzuli-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2023-2025-v3204-zzuli";
const BASE_URL = "https://zhaosheng.zzuli.edu.cn";
const INDEX_URL = `${BASE_URL}/#/routerView/lnlqcx`;
const SOURCE = {
  id: "official-zzuli-national-2023-2025-school-major-admission",
  quality: "official-school-zzuli-2023-2025-national-major-api-score",
  schoolCode: "10462",
  schoolName: "郑州轻工业大学",
  city: "郑州",
  tags: ["理工", "河南", "郑州轻工业大学"],
};

const MAINLAND_PROVINCES = [
  ["北京", "11"],
  ["天津", "12"],
  ["河北", "13"],
  ["山西", "14"],
  ["内蒙古", "15"],
  ["辽宁", "21"],
  ["吉林", "22"],
  ["黑龙江", "23"],
  ["上海", "31"],
  ["江苏", "32"],
  ["浙江", "33"],
  ["安徽", "34"],
  ["福建", "35"],
  ["江西", "36"],
  ["山东", "37"],
  ["河南", "41"],
  ["湖北", "42"],
  ["湖南", "43"],
  ["广东", "44"],
  ["广西", "45"],
  ["海南", "46"],
  ["重庆", "50"],
  ["四川", "51"],
  ["贵州", "52"],
  ["云南", "53"],
  ["西藏", "54"],
  ["陕西", "61"],
  ["甘肃", "62"],
  ["青海", "63"],
  ["宁夏", "64"],
  ["新疆", "65"],
];

const NEW_GAOKAO_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const ART_PATTERN = /艺术|美术|音乐|舞蹈|设计|视觉传达|环境设计|绘画|动画|服装与服饰设计|工艺美术|产品设计|表演|播音|编导/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2023-2025-v3204-zzuli.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2023-2025-v3204-zzuli.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source JSON/JS evidence",
    "",
    "Imports Zhengzhou University of Light Industry official 2023-2025 admission API data.",
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

function parseArtMinScore(value) {
  const text = clean(value).replace(/，/g, ",");
  const match = text.match(/最低(?:录取)?分[:：]?\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : firstNumber(text);
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || "";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

function scoreRange(records) {
  const scores = records.map((record) => record.minScore).filter(Number.isFinite);
  return scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : { min: null, max: null };
}

function normalizeSubject(province, raw, majorName, type) {
  if (type === "ysl") return "艺术类";
  const text = [raw, majorName].map(clean).join(" ");
  if (/体育|社会体育/.test(text)) return "体育类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (NEW_GAOKAO_PROVINCES.has(province)) return "综合改革";
  return clean(raw) || "官网未列科类";
}

function classifyAdmission(type, row) {
  const text = [type, row.pc, row.kl, row.zszy, row.lqqk, row.xymc].map(clean).join(" ");
  if (type === "ysl" || ART_PATTERN.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|社会体育/.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "国家专项", formalScoreScope: "special-path-only" };
  }
  if (/地方专项/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "地方专项", formalScoreScope: "special-path-only" };
  }
  if (/南疆|哈密|定向|预科|民族|专项|高水平|专升本/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "专项/定向/预科/民族等", formalScoreScope: "special-path-only" };
  }
  if (/中外合作|合作办学|联办|较高收费|单列/.test(text)) {
    return { admissionType: "特殊收费或联办专业", admissionSubtype: "中外合作/联办/单列专业", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch(type, row, classification) {
  if (type === "ysl") return "艺术类批次";
  const raw = clean(row.pc);
  if (raw) return raw;
  if (classification.admissionType === "体育类录取") return "体育类批次";
  if (classification.admissionType === "特殊类型录取") return "特殊类型批次";
  return "本科批";
}

function scoreMetric(classification, type) {
  if (type === "ysl" || classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  return "高考文化分";
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "text/html,application/javascript,text/javascript,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: `${BASE_URL}/`,
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      await sleep(attempt * 1500);
    }
  }
  throw lastError;
}

async function fetchApi(endpoint, body) {
  const url = `${BASE_URL}${endpoint}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "application/json,text/plain,*/*",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          "content-type": "application/json;charset=UTF-8",
          "zzhz-xtoken": "2021113030155",
          referer: `${BASE_URL}/`,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text);
      if (json.code !== 200) throw new Error(`API code ${json.code} for ${endpoint}: ${text.slice(0, 200)}`);
      return json;
    } catch (error) {
      lastError = error;
      await sleep(attempt * 2000);
    }
  }
  throw lastError;
}

async function downloadText(rawRoot, relPath, url, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8").replace(/\0/g, "");
  const text = await fetchText(url);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text);
  await sleep(150);
  return text;
}

async function downloadJson(rawRoot, relPath, endpoint, body, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const json = await fetchApi(endpoint, body);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  await sleep(250);
  return json;
}

function rawJsonName(type, year, provinceCode, province) {
  return `api-${type}-${year}-${provinceCode}-${stableId([province]).slice(0, 8)}.json`;
}

function buildRecord({ row, type, year, province, provinceCode, rowIndex, rawPath, endpoint }) {
  const majorName = clean(row.zszy);
  const classification = classifyAdmission(type, row);
  const minScore = type === "ysl" ? parseArtMinScore(row.lqqk) : firstNumber(row.zdf);
  const maxScore = firstNumber(row.zgf);
  const controlLine = firstNumber(row.skx);
  if (!majorName || !Number.isFinite(minScore)) return null;
  if (minScore < 0 || minScore > 1000) return null;
  const subjectType = normalizeSubject(province, row.kl || row.zszy, majorName, type);
  const batch = normalizeBatch(type, row, classification);
  const sourceSubjectRaw = type === "ysl" ? clean(row.zszy.match(/[（(](历史|物理|文|理)[）)]/)?.[1] || "艺术类") : clean(row.kl);
  const sourceMinScoreRaw = type === "ysl" ? clean(row.lqqk) : clean(row.zdf);
  const record = {
    id: `${year}-zzuli-${type}-major-${stableId([
      province,
      provinceCode,
      year,
      type,
      rowIndex,
      row.pc,
      row.kl,
      row.xymc,
      row.zszy,
      row.zdf,
      row.lqqk,
    ])}`,
    province,
    sourceProvinceRaw: province,
    provinceCode,
    year: Number(year),
    subjectType,
    sourceSubjectRaw,
    batch,
    sourceBatchRaw: type === "ysl" ? "艺术类录取情况" : clean(row.pc),
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
    scoreMetric: scoreMetric(classification, type),
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-score",
    sourceUrl: `${BASE_URL}${endpoint}`,
    sourcePageUrl: INDEX_URL,
    sourceIndexUrl: INDEX_URL,
    sourceApiEndpoint: endpoint,
    officialEvidencePath: rawPath,
    sourceJsonPath: rawPath,
    sourceMinScoreRaw,
    sourceMaxScoreRaw: clean(row.zgf),
    sourceControlLineRaw: clean(row.skx),
    rawRow: {
      source: `zzuli-${year}-${type}-official-api`,
      rowIndex,
      endpoint,
      request: { sfdm: provinceCode, nd: year },
      cells: row,
    },
    cautions: [
      `本记录来自郑州轻工业大学招生信息网官方“历年录取情况”接口 ${endpoint}，是单校分省分专业录取边界，不是省级教育考试院全量投档/录取分数表。`,
      "源接口未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺术、体育、专项、定向、预科、民族等特殊路径，运行层按 special-path-only 隔离，不与普通批次边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  const planCount = integerNumber(row.jhs);
  const admissionCount = integerNumber(row.lqs);
  if (Number.isFinite(planCount)) record.planCount = planCount;
  if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (row.xymc) record.collegeName = clean(row.xymc);
  return record;
}

async function saveOfficialFrontendEvidence(rawRoot, useCache) {
  const rawPaths = [];
  const home = await downloadText(rawRoot, "zzuli-home.html", `${BASE_URL}/`, useCache);
  rawPaths.push(path.posix.join(RAW_DIR, "zzuli-home.html"));
  const scriptMatches = [...home.matchAll(/src=\.\/(static\/js\/[^>\s]+?\.js)/g)].map((match) => match[1]);
  const chunkUrls = [
    ...scriptMatches,
    "static/js/0.b970b47339eca59ab2b9.js",
    "static/js/3.7fd6975e25fc56e4e469.js",
    "static/js/11.59ccc27973d3405a5a9d.js",
    "static/js/35.b77cfbc34e838b9fe372.js",
  ];
  for (const rel of [...new Set(chunkUrls)]) {
    const filename = rel.replace(/\//g, "-");
    await downloadText(rawRoot, filename, `${BASE_URL}/${rel}`, useCache);
    rawPaths.push(path.posix.join(RAW_DIR, filename));
  }
  return rawPaths;
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const rawPaths = await saveOfficialFrontendEvidence(rawRoot, args.useCache);
  const yearsRawPath = "api-lqqk-nds.json";
  const yearsJson = await downloadJson(rawRoot, yearsRawPath, "/api/lqqk/nds", {}, args.useCache);
  rawPaths.push(path.posix.join(RAW_DIR, yearsRawPath));
  const years = (yearsJson.data || []).map((year) => String(year)).filter((year) => /^\d{4}$/.test(year)).sort();
  if (years.length < 3 || !years.includes("2025")) {
    throw new Error(`Unexpected ZZULI year list: ${JSON.stringify(yearsJson)}`);
  }

  const records = [];
  const skippedRows = [];
  const emptyResponses = [];
  const endpointSummaries = [];
  const endpoints = [
    { type: "fys", endpoint: "/api/lqqk/fys", label: "非艺术类录取情况" },
    { type: "ysl", endpoint: "/api/lqqk/ysl", label: "艺术类录取情况" },
  ];

  for (const year of years) {
    for (const [province, provinceCode] of MAINLAND_PROVINCES) {
      for (const api of endpoints) {
        const relRaw = rawJsonName(api.type, year, provinceCode, province);
        const rawPath = path.posix.join(RAW_DIR, relRaw);
        const json = await downloadJson(rawRoot, relRaw, api.endpoint, { sfdm: provinceCode, nd: year }, args.useCache);
        rawPaths.push(rawPath);
        const payload = json.data || {};
        const rows = Array.isArray(payload.data) ? payload.data : [];
        if (!rows.length) {
          emptyResponses.push({ province, provinceCode, year: Number(year), type: api.type, endpoint: api.endpoint, label: api.label });
        }
        let parsedRows = 0;
        rows.forEach((row, rowIndex) => {
          const record = buildRecord({ row, type: api.type, year, province, provinceCode, rowIndex, rawPath, endpoint: api.endpoint });
          if (record) {
            parsedRows += 1;
            records.push(record);
          } else {
            skippedRows.push({
              reason: "missing-major-or-score",
              province,
              provinceCode,
              year: Number(year),
              type: api.type,
              endpoint: api.endpoint,
              rowIndex,
              row,
            });
          }
        });
        endpointSummaries.push({
          province,
          provinceCode,
          year: Number(year),
          type: api.type,
          label: api.label,
          endpoint: api.endpoint,
          rawPath,
          sourceSelectYear: payload.selectYear,
          sourceYears: payload.years,
          rows: rows.length,
          parsedRows,
        });
      }
    }
  }

  if (records.length < 1000) throw new Error(`Parsed too few ZZULI records: ${records.length}`);
  const duplicateIds = records.length - new Set(records.map((record) => record.id)).size;
  if (duplicateIds) throw new Error(`Duplicate record ids in ZZULI import: ${duplicateIds}`);

  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const yearsWithRecords = [...new Set(records.map((record) => record.year))].sort((a, b) => a - b);
  const missingMainland = MAINLAND_PROVINCES
    .map(([province]) => province)
    .filter((province) => !provincesWithRecords.includes(province))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const ordinarySchoolOfficialRecords = records.filter((record) => record.formalScoreScope === "school-official-only").length;
  const specialPathRecords = records.filter((record) => record.formalScoreScope === "special-path-only").length;

  const payload = {
    sourceNotes: [
      {
        id: SOURCE.id,
        title: "郑州轻工业大学招生信息网：2023-2025年全国分省分专业历年录取情况",
        publisher: "郑州轻工业大学招生信息网",
        url: INDEX_URL,
        apiEndpoints: endpoints.map((api) => `${BASE_URL}${api.endpoint}`),
        quality: SOURCE.quality,
        usage: "从郑州轻工业大学招生信息网官方前端路由“历年录取查询”进入艺术类/非艺术类录取情况；根据前端公开接口 /api/lqqk/nds、/api/lqqk/fys、/api/lqqk/ysl 逐省逐年读取 JSON，抽取批次、科类、专业、计划数、录取数、最高分、最低分、省控线和艺术类录取说明。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
        parsedRecords: records.length,
        skippedOfficialRows: skippedRows.length,
        provinceCount: provincesWithRecords.length,
        provincesWithRecords,
        missingMainlandProvinces: missingMainland,
        years: yearsWithRecords,
        sourceYearList: years,
        apiResponseCount: endpointSummaries.length,
        emptyResponseCount: emptyResponses.length,
        emptyResponses,
        ordinarySchoolOfficialRecords,
        specialPathRecords,
        recordsWithRank: 0,
        recordsWithoutRank: records.length,
        byProvince: countBy(records, (record) => record.province),
        byYear: countBy(records, (record) => String(record.year)),
        byEndpoint: countBy(records, (record) => record.sourceApiEndpoint),
        bySubjectType: countBy(records, (record) => record.subjectType),
        byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
        byAdmissionType: countBy(records, (record) => record.admissionType),
        byAdmissionSubtype: countBy(records, (record) => record.admissionSubtype),
        byBatch: countBy(records, (record) => record.batch),
        byDataType: countBy(records, (record) => record.dataType),
        scoreRange: scoreRange(records),
        endpointSummaries,
        skippedRows,
        rawPaths: [...new Set(rawPaths)],
        cautions: [
          "本导入包来自郑州轻工业大学学校官网单校分数数据，不关闭任何省级正式投档表缺口。",
          "源接口未公开最低位次，本包不生成假位次；推荐层不得仅凭单校无位次行输出录取概率。",
          "艺术类、体育类、国家专项、地方专项、定向/预科/民族等特殊入口按 special-path-only 隔离，不与普通批次混用。",
          "普通学校官网单校行按 school-official-only 保留，用于郑州轻工业大学候选边界复核。",
        ],
      },
    ],
    records,
  };

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    out: args.out,
    records: records.length,
    skippedOfficialRows: skippedRows.length,
    apiResponseCount: endpointSummaries.length,
    emptyResponseCount: emptyResponses.length,
    provinceCount: provincesWithRecords.length,
    missingMainlandProvinces: missingMainland,
    years: yearsWithRecords,
    ordinarySchoolOfficialRecords,
    specialPathRecords,
    recordsWithRank: 0,
    recordsWithoutRank: records.length,
    byEndpoint: payload.sourceNotes[0].byEndpoint,
    byFormalScoreScope: payload.sourceNotes[0].byFormalScoreScope,
    byAdmissionType: payload.sourceNotes[0].byAdmissionType,
    byDataType: payload.sourceNotes[0].byDataType,
    scoreRange: payload.sourceNotes[0].scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
