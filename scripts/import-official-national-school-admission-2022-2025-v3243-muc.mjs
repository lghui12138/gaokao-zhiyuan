#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE_ID = "official-muc-national-2022-2025-school-admission";
const SOURCE_QUALITY = "official-school-muc-2022-2025-national-admission-api-score-rank";
const PAGE_URL = "https://zb.muc.edu.cn/content/zs/7fd7b6c2-f0de-11ee-a4af-00163e36a0b0.htm";
const API_BASE = "https://zb.muc.edu.cn";
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2022-2025-v3243-muc-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2022-2025-v3243-muc";
const PAGE_FILE = "muc-admission-score-page.html";
const EXISTING_SOURCE_SKIP = { year: 2025, province: "西藏" };

const ENDPOINTS = {
  kl: "/query/findKlList.json",
  lx: "/query/findLxList.json",
  total: "/query/findAdmissionScoreTotal.json",
  detail: "/query/findAdmissionScore.json",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2022-2025-v3243-muc.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2022-2025-v3243-muc.mjs --use-cache --concurrency 6",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded page/API JSON files",
    "  --concurrency N    concurrent API requests, default 6",
    "",
    "Imports Minzu University of China's official national admission score API.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false, concurrency: 6 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 12) {
    throw new Error("--concurrency must be an integer between 1 and 12");
  }
  return args;
}

function guardRuntime() {
  const cwd = path.resolve(process.cwd());
  if (cwd.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing to run Node importer from /Volumes/mac_2T; run from internal APFS project root.");
  }
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

function range(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? [Math.min(...nums), Math.max(...nums)] : null;
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

function parseListItems(html, containerId) {
  const container = String(html).match(new RegExp(`<ul[^>]+id=["']${containerId}["'][^>]*>([\\s\\S]*?)<\\/ul>`, "i"))?.[1] || "";
  return [...container.matchAll(/<li\b[^>]*data-code=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => ({ code: String(match[1]).trim(), name: textFromHtml(match[2]) }))
    .filter((item) => item.code && item.name);
}

async function fetchBuffer(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    body: options.body,
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-muc-national-v3243-importer/1.0",
      accept: options.accept || "*/*",
      referer: PAGE_URL,
      ...(options.body ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" } : {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function rawJsonName(prefix, parts) {
  const compact = parts.map((part) => String(part).replace(/[^0-9A-Za-z_-]/g, "")).join("-");
  return `${prefix}-${compact}.json`;
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
  return { file, payload, body, endpoint };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function numberOrUndefined(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : undefined;
}

function positiveRankOrUndefined(value) {
  const number = numberOrUndefined(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : undefined;
}

function normalizeSubject(raw) {
  const value = String(raw || "").trim();
  if (/艺术/.test(value)) return "艺术类";
  if (/体育/.test(value)) return "体育类";
  if (/综合|不分文理/.test(value)) return "综合";
  if (/物理|理工/.test(value)) return "物理类";
  if (/历史|文史/.test(value)) return "历史类";
  return value || "官网未列科类";
}

function formalScoreScopeFor(row) {
  const type = String(row.zslbmc || "");
  const subject = String(row.klmc || "");
  if (/艺术|体育|合作|预科|民族语|国家专项|高校专项|强基|港澳|华侨|新疆班|西藏班|定向|单列/.test(`${type} ${subject}`)) {
    return "special-path-only";
  }
  if (/普通本科|普通类|本科批/.test(type)) return "school-official-only";
  return "special-path-only";
}

function batchFor(row) {
  const text = `${row.zslbmc || ""} ${row.klmc || ""}`;
  if (/艺术/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  return "本科批";
}

function cautionsFor(row, minRank) {
  const scope = formalScoreScopeFor(row);
  const cautions = [
    "本记录来自中央民族大学本科招生网官方录取分数查询接口，是单校分省录取分/专业分，不是任何省级教育考试院全量投档/录取分数表。",
    "学校官网单校分数可用于中央民族大学候选边界复核，但不得替代省级正式投档/录取表或单独输出录取概率。",
  ];
  if (!minRank) cautions.push("接口未公开有效最低位次，本记录保持 rankUnavailable=true，不生成假位次。");
  if (scope === "special-path-only") {
    cautions.push("特殊类别或特殊计分口径按 special-path-only 隔离，需要结合考生资格、招生章程和省考试院规则复核。");
  }
  return cautions;
}

function buildBaseRecord(row, combo, kind) {
  const minScore = numberOrUndefined(row.mincj);
  const minRank = positiveRankOrUndefined(row.minwc);
  const scope = formalScoreScopeFor(row);
  const subject = normalizeSubject(row.klmc);
  const majorName = kind === "institution"
    ? `${row.zslbmc || combo.lxName || "录取概况"}录取概况`
    : String(row.zymc || "").trim();
  const idBase = [
    SOURCE_ID,
    kind,
    row.year,
    row.sfmc,
    row.klmc,
    row.zslbmc,
    majorName,
    row.maxcj,
    row.avgcj,
    row.mincj,
    row.minwc,
  ].join("|");
  return {
    id: `muc-${hash(idBase, 18)}`,
    year: Number(row.year),
    province: row.sfmc,
    city: "北京",
    schoolCode: "10052",
    schoolName: "中央民族大学",
    schoolTags: ["985", "211", "双一流", "民族"],
    batch: batchFor(row),
    subjectType: subject,
    majorName,
    dataType: kind === "institution" ? "institution-admission" : "major-admission",
    admissionType: row.zslbmc || combo.lxName || "官网未列类别",
    admissionSubtype: scope === "special-path-only" ? (row.zslbmc || combo.lxName) : undefined,
    formalScoreScope: scope,
    schoolOfficialScope: true,
    maxScore: numberOrUndefined(row.maxcj),
    avgScore: numberOrUndefined(row.avgcj),
    minScore,
    controlLine: numberOrUndefined(row.kzx),
    minRank,
    minRankStart: minRank,
    minRankEnd: minRank,
    rankUnavailable: !minRank,
    scoreOnly: !minRank,
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    sourceUrl: PAGE_URL,
    sourcePageUrl: PAGE_URL,
    sourceIndexUrl: "https://zb.muc.edu.cn/content/zs/",
    sourcePageTitle: "录取分数 - 中央民族大学本科招生网",
    sourcePageKey: `muc-${combo.year}-${combo.provinceCode}-k${combo.kldm}-lx${combo.lxdm}`,
    officialEvidencePath: combo.rawFile,
    sourceProvinceCodeRaw: combo.provinceCode,
    sourceProvinceRaw: row.sfmc,
    sourceSubjectCodeRaw: combo.kldm,
    sourceSubjectRaw: row.klmc,
    sourceAdmissionTypeCodeRaw: combo.lxdm,
    sourceAdmissionTypeRaw: row.zslbmc || combo.lxName,
    sourceMajorRaw: row.zymc,
    sourceMaxScoreRaw: row.maxcj,
    sourceAverageScoreRaw: row.avgcj,
    sourceMinScoreRaw: row.mincj,
    sourceMinRankRaw: row.minwc,
    sourceControlLineRaw: row.kzx,
    rawRow: row,
    cautions: cautionsFor(row, minRank),
  };
}

function shouldSkipExisting(row) {
  return Number(row.year) === EXISTING_SOURCE_SKIP.year && row.sfmc === EXISTING_SOURCE_SKIP.province;
}

function buildRecords(apiResults) {
  const records = [];
  const skippedRows = [];
  for (const result of apiResults) {
    if (!result || !result.kind || !Array.isArray(result.rows)) continue;
    for (const row of result.rows) {
      if (shouldSkipExisting(row)) {
        skippedRows.push({ issue: "skipped_existing_muc_xizang_2025_source", row, combo: result.combo });
        continue;
      }
      const record = buildBaseRecord(row, result.combo, result.kind);
      if (!Number.isFinite(record.year) || !record.province || !Number.isFinite(record.minScore)) {
        skippedRows.push({ issue: "skipped_missing_required_fields_or_score", row, combo: result.combo });
        continue;
      }
      if (record.dataType === "major-admission" && !record.majorName) {
        skippedRows.push({ issue: "skipped_missing_major_name", row, combo: result.combo });
        continue;
      }
      records.push(record);
    }
  }

  const seen = new Set();
  const deduped = [];
  const duplicateRecords = [];
  for (const record of records) {
    if (seen.has(record.id)) {
      duplicateRecords.push(record);
      continue;
    }
    seen.add(record.id);
    deduped.push(record);
  }
  return { records: deduped, skippedRows, duplicateRecords };
}

async function main() {
  guardRuntime();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const rawRoot = path.resolve(PROJECT_ROOT, RAW_DIR);
  fs.mkdirSync(rawRoot, { recursive: true });
  const pageFile = path.join(rawRoot, PAGE_FILE);
  if (!args.useCache || !fs.existsSync(pageFile)) {
    fs.writeFileSync(pageFile, await fetchBuffer(PAGE_URL, { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }));
  }
  const html = fs.readFileSync(pageFile, "utf8");
  if (!html.includes("findAdmissionScore") || !html.includes("中央民族大学本科招生网")) {
    throw new Error(`MUC source page is missing expected tokens: ${pageFile}`);
  }
  const meta = pageMeta(html);
  const years = parseListItems(html, "years").map((item) => Number(item.code)).filter(Number.isFinite);
  const provinces = parseListItems(html, "pros");
  if (years.length < 2 || provinces.length < 30) {
    throw new Error(`Could not detect expected years/provinces from MUC page: years=${years.length}, provinces=${provinces.length}`);
  }

  const rawFiles = [pageFile];
  const requestLog = [];
  const klTasks = [];
  for (const year of years) {
    for (const province of provinces) {
      klTasks.push({ year, province });
    }
  }

  const klResults = await mapLimit(klTasks, args.concurrency, async ({ year, province }) => {
    const name = rawJsonName("findKlList", [year, province.code]);
    const result = await writeJsonRequest(rawRoot, name, ENDPOINTS.kl, {
      vepd_sf: province.code,
      vepd_year: String(year),
    }, args.useCache);
    rawFiles.push(result.file);
    requestLog.push({ endpoint: ENDPOINTS.kl, year, province: province.name, provinceCode: province.code, rows: (result.payload.rows || []).length });
    return { year, province, rows: result.payload.rows || [], rawFile: path.relative(PROJECT_ROOT, result.file) };
  });

  const lxTasks = [];
  for (const klResult of klResults) {
    for (const kl of klResult.rows) {
      lxTasks.push({ ...klResult, kldm: String(kl.kldm), klName: String(kl.klmc || "") });
    }
  }

  const lxResults = await mapLimit(lxTasks, args.concurrency, async (task) => {
    const name = rawJsonName("findLxList", [task.year, task.province.code, `k${task.kldm}`]);
    const result = await writeJsonRequest(rawRoot, name, ENDPOINTS.lx, {
      vepd_sf: task.province.code,
      vepd_year: String(task.year),
      vepd_kldm: task.kldm,
    }, args.useCache);
    rawFiles.push(result.file);
    requestLog.push({ endpoint: ENDPOINTS.lx, year: task.year, province: task.province.name, provinceCode: task.province.code, kldm: task.kldm, klName: task.klName, rows: (result.payload.rows || []).length });
    return { ...task, rows: result.payload.rows || [], rawFile: path.relative(PROJECT_ROOT, result.file) };
  });

  const admissionTasks = [];
  for (const lxResult of lxResults) {
    for (const lx of lxResult.rows) {
      const combo = {
        year: lxResult.year,
        province: lxResult.province.name,
        provinceCode: lxResult.province.code,
        kldm: lxResult.kldm,
        klName: lxResult.klName,
        lxdm: String(lx.lxdm),
        lxName: String(lx.lxmc || ""),
      };
      admissionTasks.push({ endpoint: ENDPOINTS.total, kind: "institution", prefix: "findAdmissionScoreTotal", combo });
      admissionTasks.push({ endpoint: ENDPOINTS.detail, kind: "major", prefix: "findAdmissionScore", combo });
    }
  }

  const apiResults = await mapLimit(admissionTasks, args.concurrency, async (task) => {
    const combo = task.combo;
    const name = rawJsonName(task.prefix, [combo.year, combo.provinceCode, `k${combo.kldm}`, `lx${combo.lxdm}`]);
    const result = await writeJsonRequest(rawRoot, name, task.endpoint, {
      vepd_sf: combo.provinceCode,
      vepd_year: String(combo.year),
      vepd_kldm: combo.kldm,
      vepd_xslxdm: combo.lxdm,
    }, args.useCache);
    rawFiles.push(result.file);
    const rawFile = path.relative(PROJECT_ROOT, result.file);
    requestLog.push({ endpoint: task.endpoint, kind: task.kind, year: combo.year, province: combo.province, provinceCode: combo.provinceCode, kldm: combo.kldm, klName: combo.klName, lxdm: combo.lxdm, lxName: combo.lxName, rows: (result.payload.rows || []).length });
    return { kind: task.kind, combo: { ...combo, rawFile }, rows: result.payload.rows || [] };
  });

  const { records, skippedRows, duplicateRecords } = buildRecords(apiResults);
  const rawFilesRel = [...new Set(rawFiles.map((file) => path.relative(PROJECT_ROOT, file)))].sort();
  const recordsWithRank = records.filter((record) => record.minRank != null).length;
  const recordsRankUnavailable = records.filter((record) => record.rankUnavailable).length;
  const sourceNote = {
    id: SOURCE_ID,
    publisher: "中央民族大学招生办公室",
    title: "中央民族大学本科招生网录取分数（2022-2025）",
    url: PAGE_URL,
    officialNavigationUrl: "https://zb.muc.edu.cn/content/zs/",
    quality: SOURCE_QUALITY,
    usage: "调用中央民族大学本科招生网官方录取分数查询页面及 AJAX 接口，抽取 2022-2025 年全国分省分科类录取概况与分专业录取分数/位次，生成单校候选边界；不替代任何省级教育考试院全量投档/录取表。",
    rawDir: RAW_DIR,
    rawFiles: rawFilesRel,
    parsedRecords: records.length,
    skippedRows: skippedRows.length,
    duplicateRecordsSkipped: duplicateRecords.length,
    pageSha256: sha256File(pageFile),
    configSha256: Object.fromEntries(rawFilesRel.slice(0, 20).map((file) => [file, sha256File(path.resolve(PROJECT_ROOT, file))])),
    years,
    provincesWithRecords: Object.keys(countBy(records, (record) => record.province)).sort(),
    provinceCount: Object.keys(countBy(records, (record) => record.province)).length,
    yearCounts: countBy(records, (record) => record.year),
    subjectTypeCounts: countBy(records, (record) => record.subjectType),
    formalScoreScopeCounts: countBy(records, (record) => record.formalScoreScope),
    admissionTypeCounts: countBy(records, (record) => record.admissionType),
    recordTypeCounts: countBy(records, (record) => record.dataType),
    scoreRange: range(records.map((record) => record.minScore)),
    rankRange: range(records.map((record) => record.minRank).filter((value) => value != null)),
    recordsWithRank,
    recordsRankUnavailable,
    xizangRecords: records.filter((record) => record.province === "西藏").length,
    xinjiangRecords: records.filter((record) => record.province === "新疆").length,
    boundaryNotes: [
      "本源为中央民族大学本科招生网官方单校录取分数查询接口，不是省级教育考试院全量正式投档/录取表。",
      "接口公开最低位次的行保留原始最低位次；接口未公开有效最低位次的行保持 rankUnavailable=true，不生成假位次。",
      "普通本科按 school-official-only 保存；艺术、体育、合作办学、预科、民族语、专项等按 special-path-only 隔离。",
      "2025 年西藏行已由既有 official-muc-xizang-2025-school-admission 源导入，本轮全国扩展显式跳过该组合，避免重复计数。",
      "学校官网单校分数只用于中央民族大学候选边界和专业复核，不清除西藏等省级正式分数表缺口。",
    ],
  };

  const payload = {
    dataset: "official-national-school-admission-2022-2025-v3243-muc",
    generatedAt: new Date().toISOString(),
    scope: {
      years,
      provinces: provinces.map((item) => item.name),
      school: "中央民族大学",
      sourceKind: "school-official-single-university-score-rank",
      skippedExistingSource: EXISTING_SOURCE_SKIP,
    },
    notes: [
      "本文件由 scripts/import-official-national-school-admission-2022-2025-v3243-muc.mjs 自动生成。",
      "来源为中央民族大学本科招生网官方录取分数查询页面及 AJAX 接口。",
      "2025 年西藏行已有窄源导入，本轮全国扩展跳过该组合；其余省年科类类别按接口返回导入。",
      "学校官网单校分数不替代任何省级教育考试院全量投档/录取表。",
    ],
    sourceNotes: [sourceNote],
    records,
    audit: {
      meta,
      requestCount: requestLog.length,
      requestLog,
      skippedRows,
      duplicateRecordsSkipped: duplicateRecords.length,
      duplicateRecords: duplicateRecords.slice(0, 50),
      formalScoreScopeCounts: sourceNote.formalScoreScopeCounts,
      subjectTypeCounts: sourceNote.subjectTypeCounts,
      recordTypeCounts: sourceNote.recordTypeCounts,
      admissionTypeCounts: sourceNote.admissionTypeCounts,
      yearCounts: sourceNote.yearCounts,
      provinceCounts: countBy(records, (record) => record.province),
      scoreRange: sourceNote.scoreRange,
      rankRange: sourceNote.rankRange,
      recordsWithRank,
      recordsRankUnavailable,
      xizangRecords: sourceNote.xizangRecords,
      xinjiangRecords: sourceNote.xinjiangRecords,
    },
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    rawFiles: rawFilesRel.length,
    requestCount: requestLog.length,
    skippedRows: skippedRows.length,
    duplicateRecordsSkipped: duplicateRecords.length,
    formalScoreScopeCounts: sourceNote.formalScoreScopeCounts,
    subjectTypeCounts: sourceNote.subjectTypeCounts,
    recordTypeCounts: sourceNote.recordTypeCounts,
    provinceCount: sourceNote.provinceCount,
    yearCounts: sourceNote.yearCounts,
    scoreRange: sourceNote.scoreRange,
    rankRange: sourceNote.rankRange,
    recordsWithRank,
    recordsRankUnavailable,
    xizangRecords: sourceNote.xizangRecords,
    xinjiangRecords: sourceNote.xinjiangRecords,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
