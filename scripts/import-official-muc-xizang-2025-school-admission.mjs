#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2025;
const PROVINCE = "西藏";
const PROVINCE_CODE = "540000";
const SOURCE_ID = "official-muc-xizang-2025-school-admission";
const SOURCE_QUALITY = "official-school-muc-2025-xizang-admission-api-score-only";
const PAGE_URL = "https://zb.muc.edu.cn/content/zs/7fd7b6c2-f0de-11ee-a4af-00163e36a0b0.htm";
const API_BASE = "https://zb.muc.edu.cn";
const DEFAULT_OUT = "data/admissions/official-muc-xizang-2025-school-admission-import.json";
const RAW_DIR = "data/admissions/raw/official-muc-xizang-2025-school-admission";
const PAGE_FILE = "muc-admission-score-page.html";

const SUBJECT_MAP = {
  "文史": "历史类",
  "理工": "物理类",
};

const EXPECTED_TYPES = {
  "1": ["01", "10"],
  "2": ["01", "10"],
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-muc-xizang-2025-school-admission.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-muc-xizang-2025-school-admission.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded page/API JSON files",
    "",
    "Imports Minzu University of China's official 2025 Xizang admission score API.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
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

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&nbsp;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function textFromHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(html, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return textFromHtml(match[1]);
  }
  return "";
}

function pageMeta(html) {
  return {
    title: firstText(html, [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) || "录取分数 - 中央民族大学本科招生网",
  };
}

async function fetchBuffer(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    body: options.body,
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-muc-xizang-2025-importer/1.0",
      accept: options.accept || "*/*",
      referer: PAGE_URL,
      ...(options.body ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" } : {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function writeJsonRequest(rawDir, fileName, endpoint, body, useCache) {
  const file = path.join(rawDir, fileName);
  if (!useCache || !fs.existsSync(file)) {
    const params = new URLSearchParams(body);
    fs.writeFileSync(file, await fetchBuffer(`${API_BASE}${endpoint}`, {
      method: "POST",
      body: params.toString(),
      accept: "application/json,text/javascript,*/*;q=0.8",
    }));
  }
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!payload.success) throw new Error(`MUC API ${endpoint} returned failure in ${file}`);
  return { file, payload };
}

async function ensureRawFiles(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const pageFile = path.join(rawDir, PAGE_FILE);
  if (!useCache || !fs.existsSync(pageFile)) {
    fs.writeFileSync(pageFile, await fetchBuffer(PAGE_URL, { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }));
  }
  const html = fs.readFileSync(pageFile, "utf8");
  if (html.length < 10 * 1024 || !html.includes("录取分数") || !html.includes("findAdmissionScore")) {
    throw new Error(`MUC source page is missing expected admission-score tokens: ${pageFile}`);
  }

  const apiFiles = [];
  const kl = await writeJsonRequest(rawDir, "findKlList-2025-xizang.json", "/query/findKlList.json", {
    vepd_sf: PROVINCE_CODE,
    vepd_year: String(YEAR),
  }, useCache);
  apiFiles.push(kl.file);
  const klRows = kl.payload.rows || [];
  for (const item of klRows) {
    const kldm = String(item.kldm);
    const lx = await writeJsonRequest(rawDir, `findLxList-2025-xizang-k${kldm}.json`, "/query/findLxList.json", {
      vepd_sf: PROVINCE_CODE,
      vepd_year: String(YEAR),
      vepd_kldm: kldm,
    }, useCache);
    apiFiles.push(lx.file);
    const expected = EXPECTED_TYPES[kldm] || [];
    const returned = (lx.payload.rows || []).map((row) => String(row.lxdm));
    for (const lxdm of expected) {
      if (!returned.includes(lxdm)) throw new Error(`MUC API missing expected type ${lxdm} for kldm ${kldm}`);
    }
    for (const type of lx.payload.rows || []) {
      const lxdm = String(type.lxdm);
      const common = {
        vepd_sf: PROVINCE_CODE,
        vepd_year: String(YEAR),
        vepd_kldm: kldm,
        vepd_xslxdm: lxdm,
      };
      const total = await writeJsonRequest(rawDir, `findAdmissionScoreTotal-2025-xizang-k${kldm}-lx${lxdm}.json`, "/query/findAdmissionScoreTotal.json", common, useCache);
      const detail = await writeJsonRequest(rawDir, `findAdmissionScore-2025-xizang-k${kldm}-lx${lxdm}.json`, "/query/findAdmissionScore.json", common, useCache);
      apiFiles.push(total.file, detail.file);
    }
  }
  return { pageFile, apiFiles };
}

function numberOrUndefined(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : undefined;
}

function positiveRankOrUndefined(value) {
  const number = numberOrUndefined(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function subjectType(raw) {
  if (!SUBJECT_MAP[raw]) throw new Error(`Unknown MUC subject: ${raw}`);
  return SUBJECT_MAP[raw];
}

function formalScoreScopeFor(item) {
  return item.zslbmc === "普通本科" ? "school-official-only" : "special-path-only";
}

function cautionsFor(item) {
  const cautions = [
    "本记录来自中央民族大学本科招生网官方录取分数查询接口，是单校分省录取分/专业分，不是西藏自治区教育考试院全量投档/录取分数表。",
    "学校官网单校分数可用于该校候选边界复核，但不得清除西藏省级全量投档/录取分数表缺口。",
    "本次接口未公开有效最低位次，推荐层不能生成假位次或单独输出录取概率。",
  ];
  if (formalScoreScopeFor(item) === "special-path-only") {
    cautions.push("民族语类型按特殊路径隔离，需要考生类别/语种资格复核。");
  }
  return cautions;
}

function buildInstitutionRecord(row) {
  const subject = subjectType(row.klmc);
  const scope = formalScoreScopeFor(row);
  const minRank = positiveRankOrUndefined(row.minwc);
  const idBase = [YEAR, PROVINCE, "muc", row.zslbmc, subject, "total", row.mincj].join("|");
  return {
    id: `${YEAR}-muc-xizang-total-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: Number(row.year),
    subjectType: subject,
    sourceSubjectRaw: row.klmc,
    batch: "本科批",
    schoolCode: "10052",
    schoolName: "中央民族大学",
    city: "北京",
    schoolTags: ["985", "211", "双一流", "民族"],
    dataType: "institution-admission",
    majorName: `${row.zslbmc}录取概况`,
    maxScore: numberOrUndefined(row.maxcj),
    avgScore: numberOrUndefined(row.avgcj),
    minScore: numberOrUndefined(row.mincj),
    controlLine: numberOrUndefined(row.kzx),
    minRank,
    scoreOnly: !minRank,
    rankUnavailable: !minRank,
    admissionType: row.zslbmc,
    admissionSubtype: scope === "special-path-only" ? row.zslbmc : undefined,
    formalScoreScope: scope,
    schoolOfficialScope: scope === "school-official-only" ? "single-school-admission-score" : undefined,
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    cautions: cautionsFor(row),
    rawText: JSON.stringify(row),
  };
}

function buildMajorRecord(row) {
  const subject = subjectType(row.klmc);
  const scope = formalScoreScopeFor(row);
  const minRank = positiveRankOrUndefined(row.minwc);
  const idBase = [YEAR, PROVINCE, "muc", row.zslbmc, subject, row.zymc, row.mincj].join("|");
  return {
    id: `${YEAR}-muc-xizang-major-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: Number(row.year),
    subjectType: subject,
    sourceSubjectRaw: row.klmc,
    batch: "本科批",
    schoolCode: "10052",
    schoolName: "中央民族大学",
    city: "北京",
    schoolTags: ["985", "211", "双一流", "民族"],
    dataType: "major-admission",
    majorName: row.zymc,
    maxScore: numberOrUndefined(row.maxcj),
    avgScore: numberOrUndefined(row.avgcj),
    minScore: numberOrUndefined(row.mincj),
    minRank,
    scoreOnly: !minRank,
    rankUnavailable: !minRank,
    admissionType: row.zslbmc,
    admissionSubtype: scope === "special-path-only" ? row.zslbmc : undefined,
    formalScoreScope: scope,
    schoolOfficialScope: scope === "school-official-only" ? "single-school-admission-score" : undefined,
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    cautions: cautionsFor(row),
    rawText: JSON.stringify(row),
  };
}

function readApiPayload(rawDir, name) {
  const file = path.join(rawDir, name);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!payload.success) throw new Error(`MUC cached API file is not successful: ${name}`);
  return payload.rows || [];
}

function buildRecords(rawDir) {
  const records = [];
  for (const kldm of Object.keys(EXPECTED_TYPES)) {
    for (const lxdm of EXPECTED_TYPES[kldm]) {
      const totalRows = readApiPayload(rawDir, `findAdmissionScoreTotal-2025-xizang-k${kldm}-lx${lxdm}.json`);
      const detailRows = readApiPayload(rawDir, `findAdmissionScore-2025-xizang-k${kldm}-lx${lxdm}.json`);
      records.push(...totalRows.map(buildInstitutionRecord), ...detailRows.map(buildMajorRecord));
    }
  }
  for (const record of records) {
    if (record.province !== PROVINCE || record.year !== YEAR || !Number.isFinite(record.minScore)) {
      throw new Error(`Unexpected MUC record shape: ${JSON.stringify(record)}`);
    }
  }
  return records;
}

function buildDiagnostics(records) {
  const ordinarySchoolOfficial = records.filter((record) => record.formalScoreScope === "school-official-only");
  const specialPath = records.filter((record) => record.formalScoreScope === "special-path-only");
  return {
    totalRows: records.length,
    ordinarySchoolOfficialRows: ordinarySchoolOfficial.length,
    specialPathRows: specialPath.length,
    bySubject: countBy(records, (record) => record.subjectType),
    byDataType: countBy(records, (record) => record.dataType),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
    ordinaryScoreRange: numericRange(ordinarySchoolOfficial.map((record) => Number(record.minScore))),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const rawDir = path.resolve(PROJECT_ROOT, RAW_DIR);
  const { pageFile, apiFiles } = await ensureRawFiles(rawDir, args.useCache);
  const html = fs.readFileSync(pageFile, "utf8");
  const meta = pageMeta(html);
  const records = buildRecords(rawDir);
  const diagnostics = buildDiagnostics(records);
  if (records.length !== 20 || diagnostics.ordinarySchoolOfficialRows !== 14 || diagnostics.specialPathRows !== 6) {
    throw new Error(`Unexpected MUC Xizang record counts: ${JSON.stringify(diagnostics)}`);
  }

  const sourceNotes = [
    {
      id: SOURCE_ID,
      title: "中央民族大学2025年西藏录取分数",
      publisher: "中央民族大学招生办公室",
      sourcePageTitle: meta.title,
      url: PAGE_URL,
      apiEndpoints: [
        "/query/findKlList.json",
        "/query/findLxList.json",
        "/query/findAdmissionScoreTotal.json",
        "/query/findAdmissionScore.json",
      ],
      quality: SOURCE_QUALITY,
      usage: "调用中央民族大学本科招生网官方录取分数查询接口，抽取 2025 年西藏文史/理工普通本科与民族语类型的录取概况和分专业最高/平均/最低分，生成单校 score-only 院校/专业录取边界。",
      parsedRecords: records.length,
      ordinarySchoolOfficialRows: diagnostics.ordinarySchoolOfficialRows,
      specialPathRows: diagnostics.specialPathRows,
      rawPath: path.relative(PROJECT_ROOT, pageFile),
      apiRawPaths: apiFiles.map((file) => path.relative(PROJECT_ROOT, file)),
      pageSha256: sha256File(pageFile),
      apiSha256: Object.fromEntries(apiFiles.map((file) => [path.relative(PROJECT_ROOT, file), sha256File(file)])),
      cautions: [
        "本源为高校官方招生网单校录取分数查询接口，不是西藏自治区教育考试院全量投档/录取分数表。",
        "普通本科记录按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
        "民族语类型按 special-path-only 隔离，需要考生类别/语种资格复核。",
        "接口未返回有效最低位次，不生成假位次或录取概率。",
      ],
    },
  ];

  const payload = {
    dataset: "official-muc-xizang-2025-school-admission-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "school-official-single-university-score-only",
      school: "中央民族大学",
    },
    notes: [
      "本文件由 scripts/import-official-muc-xizang-2025-school-admission.mjs 自动生成。",
      "来源为中央民族大学本科招生网官方录取分数查询页面及 AJAX 接口。",
      "普通本科单校分数只作中央民族大学西藏考生候选边界，不能替代西藏考试院全量投档/录取分数表。",
      "民族语类型按特殊路径隔离；接口未公开有效最低位次，不生成假位次或录取概率。",
    ],
    sourceNotes,
    diagnostics,
    records,
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    ordinarySchoolOfficialRows: diagnostics.ordinarySchoolOfficialRows,
    specialPathRows: diagnostics.specialPathRows,
    sourceId: SOURCE_ID,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
