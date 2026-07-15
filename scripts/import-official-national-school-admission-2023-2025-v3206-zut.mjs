#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2023-2025-v3206-zut-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2023-2025-v3206-zut";
const BASE_URL = "https://zsc.zut.edu.cn";
const INDEX_URL = `${BASE_URL}/xxcx/lnfstj.htm`;
const TEMPLATE_CODE = "Form-1723534575105-3287";
const OWNER = "1462437906";
const QUERY_URL = `${BASE_URL}/aop_component//webber/formquery/data/get/info`;
const ITEMS_URL = `${BASE_URL}/aop_component//webber/formquery/query/front/items/get`;
const RESULT_SHOW_URL = `${BASE_URL}/aop_component//webber/formquery/query/result/show/${TEMPLATE_CODE}`;
const TOKEN_URL = `${BASE_URL}/system/resource/getToken.jsp?mode=%2010&r=0.3206`;
const SESSION_URL = `${BASE_URL}/system/resource/getSession.jsp?r=0.3206`;

const SOURCE = {
  id: "official-zut-national-2023-2025-school-major-admission",
  quality: "official-school-zut-2023-2025-national-major-api-score",
  schoolCode: "10465",
  schoolName: "中原工学院",
  city: "郑州",
  tags: ["理工", "河南", "中原工学院"],
};

const YEARS = [2023, 2024, 2025];
const MAINLAND_PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
];
const SUBJECTS = ["物理", "历史", "综合改革", "艺术", "理科", "文科"];

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

const SUBJECT_SLUGS = new Map([
  ["物理", "physics"],
  ["历史", "history"],
  ["综合改革", "comprehensive"],
  ["艺术", "art"],
  ["理科", "science"],
  ["文科", "liberal"],
]);

const ART_PATTERN = /艺术|美术|设计|服装与服饰设计|视觉传达|环境设计|产品设计|摄影|动画|表演|播音|编导/;
const SPECIAL_PATTERN = /国家专项|地方专项|专项计划|中原彼得堡|中外合作|联合办学|联办|较高收费|单列|预科|民族|定向|南疆|哈密/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2023-2025-v3206-zut.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2023-2025-v3206-zut.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded official HTML/JSON evidence",
    "",
    "Imports Zhongyuan University of Technology official 2023-2025 province major admission query API data.",
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

function stripTags(value) {
  return clean(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
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
      if (text.length < 10) throw new Error(`Unexpectedly short response (${text.length} chars) for ${url}`);
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

async function getAuth(rawRoot, useCache) {
  const token = clean(await downloadText(rawRoot, "auth-token.txt", TOKEN_URL, useCache, { accept: "text/plain,*/*" })) || "tourist";
  const session = clean(await downloadText(rawRoot, "auth-session.txt", SESSION_URL, useCache, { accept: "text/plain,*/*" }));
  return { token, session };
}

async function fetchJson(rawRoot, relPath, url, useCache, options = {}) {
  const text = await downloadText(rawRoot, relPath, url, useCache, {
    ...options,
    accept: "application/json,text/plain,*/*",
  });
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse JSON from ${relPath}: ${error.message}; prefix=${text.slice(0, 200)}`);
  }
}

function rawQueryName(year, province, subject) {
  return `api-${year}-${PROVINCE_SLUGS.get(province) || stableId([province])}-${SUBJECT_SLUGS.get(subject) || stableId([subject])}.json`;
}

function extractAvailableYears(indexHtml) {
  const years = new Set();
  for (const match of String(indexHtml).matchAll(/data-value="(20\d{2})"/g)) {
    years.add(Number(match[1]));
  }
  return [...years].sort((a, b) => a - b);
}

function extractAvailableProvinces(indexHtml) {
  const provinces = new Set();
  for (const province of MAINLAND_PROVINCES) {
    if (indexHtml.includes(`data-value="${province}"`)) provinces.add(province);
  }
  return [...provinces];
}

function extractAvailableSubjects(indexHtml) {
  const subjects = new Set();
  for (const subject of SUBJECTS) {
    if (indexHtml.includes(`data-value="${subject}"`)) subjects.add(subject);
  }
  return [...subjects];
}

function valueFromRow(row, name) {
  for (const key of Object.keys(row)) {
    if (!key.endsWith("-name")) continue;
    if (row[key] !== name) continue;
    return clean(row[key.replace(/-name$/, "-value")]);
  }
  return "";
}

function normalizeSubject(raw) {
  const text = clean(raw);
  if (text === "艺术") return "艺术类";
  if (text === "综合改革") return "综合改革";
  if (text === "历史" || text === "文科") return "历史类";
  if (text === "物理" || text === "理科") return "物理类";
  return text || "官网未列科类";
}

function classifyAdmission(subjectRaw, majorName) {
  const text = [subjectRaw, majorName].map(clean).join(" ");
  if (ART_PATTERN.test(text) || subjectRaw === "艺术") {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (SPECIAL_PATTERN.test(text)) {
    const coopOnly = COOP_ONLY(text);
    return coopOnly
      ? { admissionType: "特殊收费或合作办学专业", admissionSubtype: "中外合作/联办/单列专业", formalScoreScope: "school-official-only" }
      : { admissionType: "特殊类型录取", admissionSubtype: "专项/定向/预科/民族等", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function COOP_ONLY(text) {
  return /中外合作|联合办学|联办|较高收费/.test(text) && !/专项|定向|预科|民族|南疆|哈密/.test(text);
}

function normalizeBatch(classification) {
  if (classification.admissionType === "艺术类录取") return "艺术类批次";
  if (classification.formalScoreScope === "special-path-only") return "特殊类型批次";
  return "本科批";
}

function scoreMetric(classification) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  return "高考文化分";
}

function parseRecordsFromResponse(json, request, rawRelPath) {
  if (json.code !== "0000") return { records: [], skippedRows: [] };
  const rows = json.data?.dataList || [];
  const records = [];
  const skippedRows = [];
  rows.forEach((row, rowIndex) => {
    const year = Number(valueFromRow(row, "年份"));
    const province = valueFromRow(row, "省市");
    const sourceSubjectRaw = valueFromRow(row, "科类");
    const majorName = valueFromRow(row, "专业");
    const maxScoreRaw = valueFromRow(row, "最高分");
    const minScoreRaw = valueFromRow(row, "最低分");
    const avgScoreRaw = valueFromRow(row, "平均分");
    const minScore = firstNumber(minScoreRaw);
    const maxScore = firstNumber(maxScoreRaw);
    const avgScore = firstNumber(avgScoreRaw);
    if (year !== request.year || province !== request.province || sourceSubjectRaw !== request.subject) {
      skippedRows.push({ reason: "unexpected-year-province-subject", request, rowIndex, cells: row });
      return;
    }
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-major-or-min-score", request, rowIndex, cells: row, minScoreRaw });
      return;
    }
    if (minScore < 0 || minScore > 750) {
      skippedRows.push({ reason: "score-out-of-range", request, rowIndex, cells: row, minScore });
      return;
    }
    const classification = classifyAdmission(sourceSubjectRaw, majorName);
    const subjectType = normalizeSubject(sourceSubjectRaw);
    const batch = normalizeBatch(classification);
    const record = {
      id: `${year}-zut-major-${stableId([
        year,
        province,
        sourceSubjectRaw,
        majorName,
        rowIndex,
        minScoreRaw,
        maxScoreRaw,
      ])}`,
      province,
      sourceProvinceRaw: province,
      year,
      subjectType,
      sourceSubjectRaw,
      batch,
      sourceBatchRaw: "中原工学院官网历年分数统计未列批次字段",
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
      sourceApiEndpoint: "/aop_component//webber/formquery/data/get/info",
      officialEvidencePath: rawRelPath,
      sourceJsonPath: rawRelPath,
      sourceMinScoreRaw: minScoreRaw,
      sourceMaxScoreRaw: maxScoreRaw,
      sourceAvgScoreRaw: avgScoreRaw,
      rawRow: {
        source: "zut-2023-2025-official-formquery-api",
        rowIndex,
        request: { nf: String(request.year), ss: request.province, subject: request.subject },
        cells: row,
      },
      cautions: [
        "本记录来自中原工学院招生信息网官方“历年分数统计”接口，是单校分省分专业录取边界，不是省级教育考试院全量投档/录取分数表。",
        "官网源表没有公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
        "官网源表未列批次字段；运行层按普通/艺术/特殊路径规则推断批次标签，并保留专业名和科类原文。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    };
    if (Number.isFinite(maxScore)) record.maxScore = maxScore;
    if (Number.isFinite(avgScore)) record.avgScore = avgScore;
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

  const indexHtml = await downloadText(rawRoot, "index-lnfstj.html", INDEX_URL, args.useCache);
  const availableYears = extractAvailableYears(indexHtml);
  const availableProvinces = extractAvailableProvinces(indexHtml);
  const availableSubjects = extractAvailableSubjects(indexHtml);
  const years = YEARS.filter((year) => availableYears.includes(year));
  if (years.length !== YEARS.length) throw new Error(`Official page missing expected years: ${YEARS.join(",")}; found ${availableYears.join(",")}`);
  if (availableProvinces.length !== MAINLAND_PROVINCES.length) throw new Error(`Official page province list mismatch: found ${availableProvinces.length}`);
  if (availableSubjects.length !== SUBJECTS.length) throw new Error(`Official page subject list mismatch: found ${availableSubjects.join(",")}`);

  const auth = await getAuth(rawRoot, args.useCache);
  const headers = {
    "content-type": "application/json",
    owner: OWNER,
    Authorization: auth.token || "tourist",
    session: auth.session,
  };
  const itemsJson = await fetchJson(rawRoot, "api-items.json", ITEMS_URL, args.useCache, {
    method: "POST",
    headers,
    body: JSON.stringify({ owner: OWNER, templateCode: TEMPLATE_CODE }),
  });
  const resultShowJson = await fetchJson(rawRoot, "api-result-show.json", RESULT_SHOW_URL, args.useCache, {
    headers,
  });
  if (itemsJson.code !== "0000") throw new Error(`items endpoint failed: ${JSON.stringify(itemsJson).slice(0, 200)}`);
  if (resultShowJson.code !== "0000") throw new Error(`result/show endpoint failed: ${JSON.stringify(resultShowJson).slice(0, 200)}`);

  const records = [];
  const skippedRows = [];
  const emptyResponses = [];
  const querySummaries = [];
  for (const year of years) {
    for (const province of MAINLAND_PROVINCES) {
      for (const subject of SUBJECTS) {
        const requestPayload = {
          owner: OWNER,
          randomCode: "",
          randomKey: "",
          datas: {
            "Item-1723534575222-9364": province,
            "Item-1723534575222-2898": String(year),
            "Item-1723534575222-3089": subject,
            "": "",
          },
          templateCode: TEMPLATE_CODE,
          current: 1,
          size: 1000,
          pageCode: "",
          ifRandomCode: true,
        };
        const relPath = rawQueryName(year, province, subject);
        const json = await fetchJson(rawRoot, relPath, QUERY_URL, args.useCache, {
          method: "POST",
          headers,
          body: JSON.stringify(requestPayload),
        });
        const sourceRelPath = `${RAW_DIR}/${relPath}`;
        const parsed = parseRecordsFromResponse(json, { year, province, subject }, sourceRelPath);
        records.push(...parsed.records);
        skippedRows.push(...parsed.skippedRows.map((row) => ({ ...row, rawPath: sourceRelPath })));
        if (json.code !== "0000" || parsed.records.length === 0) {
          emptyResponses.push({
            year,
            province,
            subject,
            code: json.code,
            msg: json.msg,
            rawPath: sourceRelPath,
          });
        }
        querySummaries.push({
          year,
          province,
          subject,
          code: json.code,
          msg: json.msg,
          total: json.data?.total ?? 0,
          parsedRecords: parsed.records.length,
          rawPath: sourceRelPath,
          sha256: sha256File(path.join(rawRoot, relPath)),
        });
        await sleep(35);
      }
    }
  }

  const dupes = duplicateIds(records);
  if (dupes.length) throw new Error(`Duplicate record ids: ${dupes.slice(0, 5).join(", ")}`);
  const badScores = records.filter((record) => !Number.isFinite(record.minScore) || record.minScore < 0 || record.minScore > 750);
  if (badScores.length) throw new Error(`Bad minScore rows: ${badScores.slice(0, 3).map((record) => record.id).join(", ")}`);

  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingMainlandProvinces = MAINLAND_PROVINCES.filter((province) => !provincesWithRecords.includes(province));
  const sourceNote = {
    id: SOURCE.id,
    title: "中原工学院招生信息网：2023-2025年全国分省分专业历年分数统计",
    publisher: "中原工学院招生信息网",
    url: INDEX_URL,
    queryUrl: QUERY_URL,
    quality: SOURCE.quality,
    usage: "从中原工学院招生信息网官方“历年分数统计”页面读取年份、省市、科目筛选项和表单 templateCode，并用官方 formquery 接口逐年逐省逐科类下载 JSON，抽取专业、最高分、最低分和平均分。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: provincesWithRecords.length,
    provincesWithRecords,
    missingMainlandProvinces,
    years,
    sourceYearList: availableYears,
    sourceSubjectList: availableSubjects,
    queryCount: querySummaries.length,
    emptyResponseCount: emptyResponses.length,
    emptyResponses,
    recordTypeCounts: countBy(records, (record) => record.dataType),
    formalScoreScopeCounts: countBy(records, (record) => record.formalScoreScope),
    admissionTypeCounts: countBy(records, (record) => record.admissionType),
    subjectTypeCounts: countBy(records, (record) => record.subjectType),
    recordsByYear: countBy(records, (record) => String(record.year)),
    recordsByProvince: countBy(records, (record) => record.province),
    scoreRange: scoreRange(records),
    ordinarySchoolOfficialScoreRange: scoreRange(records.filter((record) => record.formalScoreScope === "school-official-only")),
    specialPathScoreRange: scoreRange(records.filter((record) => record.formalScoreScope === "special-path-only")),
    rawDir: RAW_DIR,
    rawFiles: [
      { path: `${RAW_DIR}/index-lnfstj.html`, url: INDEX_URL, sha256: sha256File(path.join(rawRoot, "index-lnfstj.html")) },
      { path: `${RAW_DIR}/auth-token.txt`, url: TOKEN_URL, sha256: sha256File(path.join(rawRoot, "auth-token.txt")) },
      { path: `${RAW_DIR}/auth-session.txt`, url: SESSION_URL, sha256: sha256File(path.join(rawRoot, "auth-session.txt")) },
      { path: `${RAW_DIR}/api-items.json`, url: ITEMS_URL, sha256: sha256File(path.join(rawRoot, "api-items.json")) },
      { path: `${RAW_DIR}/api-result-show.json`, url: RESULT_SHOW_URL, sha256: sha256File(path.join(rawRoot, "api-result-show.json")) },
      ...querySummaries.map((query) => ({
        path: query.rawPath,
        url: QUERY_URL,
        request: { nf: String(query.year), ss: query.province, subject: query.subject },
        sha256: query.sha256,
      })),
    ],
    cautions: [
      "中原工学院官网单校分数只用于该校候选边界复核，不替代各省教育考试院全量投档/录取分数表。",
      "官网源表未公开最低位次；本包所有记录均标记 rankUnavailable=true，不生成假位次。",
      "官网源表没有批次字段；本包仅按科类和专业名识别普通/艺术/特殊路径，其他批次信息必须回到官网和省考试院复核。",
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
    years,
    queryCount: querySummaries.length,
    emptyResponseCount: emptyResponses.length,
    recordTypeCounts: sourceNote.recordTypeCounts,
    formalScoreScopeCounts: sourceNote.formalScoreScopeCounts,
    scoreRange: sourceNote.scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
