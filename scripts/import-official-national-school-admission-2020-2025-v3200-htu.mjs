#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2020-2025-v3200-htu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2020-2025-v3200-htu";
const SOURCE_PAGE_URL = "https://www.htu.edu.cn/zs/2020/1126/c13854a182403/page.htm";
const DATA_LQ_URL = "https://www.htu.edu.cn/_upload/tpl/0c/a6/3238/template3238/js/data_lq.js?20251120";
const DATA_KM_URL = "https://www.htu.edu.cn/_upload/tpl/0c/a6/3238/template3238/js/data_km.js?2606";
const CHARTER_URL = "http://www.htu.edu.cn/zs/2026/0517/c13750a384905/page.htm";
const SOURCE = {
  id: "official-htu-national-2020-2025-school-major-admission",
  quality: "official-school-htu-2020-2025-national-major-js-score-rank",
  schoolCode: "10476",
  schoolName: "河南师范大学",
  city: "新乡",
  tags: ["师范", "河南", "河南师范大学"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

const PROVINCE_ALIASES = new Map([
  ["北京市", "北京"],
  ["天津市", "天津"],
  ["上海市", "上海"],
  ["内蒙古自治区", "内蒙古"],
  ["广西壮族自治区", "广西"],
  ["宁夏回族自治区", "宁夏"],
  ["新疆维吾尔自治区", "新疆"],
  ["西藏自治区", "西藏"],
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2020-2025-v3200-htu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2020-2025-v3200-htu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/JS",
    "",
    "Imports Henan Normal University official 2020-2025 admission query data.",
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
    throw new Error("Refusing to run HTML/JS ingestion from /Volumes/mac_2T; run this importer from the internal APFS project copy.");
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

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "text/html,application/xhtml+xml,application/xml,text/javascript,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      if (text.length < 1000) throw new Error(`Unexpectedly short source (${text.length} chars) for ${url}`);
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function downloadText(rawRoot, relPath, url, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const text = await fetchText(url);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text);
  return text;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function clean(value) {
  return decodeHtml(value)
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return clean(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function extractTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function normalizeProvince(raw) {
  const text = clean(raw);
  if (PROVINCE_ALIASES.has(text)) return PROVINCE_ALIASES.get(text);
  if (MAINLAND_PROVINCES.has(text)) return text;
  if (text.startsWith("河南")) return "河南";
  if (text.includes("哈密") || text.includes("南疆") || text.startsWith("新疆")) return "新疆";
  const simple = text.replace(/市$|省$/g, "");
  return PROVINCE_ALIASES.get(simple) || simple;
}

function normalizeSubject(raw, admissionTypeRaw, majorName) {
  const subject = clean(raw);
  const text = [subject, admissionTypeRaw, majorName].map(clean).join(" ");
  if (/艺术|美术|音乐|舞蹈|表演|编导|设计|绘画/.test(text)) return "艺术类";
  if (/体育|运动/.test(text)) return "体育类";
  if (/综合改革/.test(subject)) return "综合改革";
  if (/不分文理/.test(subject)) return "不分文理";
  if (/文\/历史|历史|文史|文科/.test(subject)) return "历史类";
  if (/理\/物理|物理|理工|理科/.test(subject)) return "物理类";
  return subject || "官网未列科类";
}

function classifyAdmission({ admissionTypeRaw, majorName, subjectRaw, sourceProvinceRaw }) {
  const text = [admissionTypeRaw, majorName, subjectRaw, sourceProvinceRaw].map(clean).join(" ");
  if (/专升本/.test(text)) {
    return { admissionType: "专升本", admissionSubtype: "专升本", formalScoreScope: "special-path-only" };
  }
  if (/对口/.test(text)) {
    return { admissionType: "对口招生", admissionSubtype: "对口招生", formalScoreScope: "special-path-only" };
  }
  if (/艺术|美术|音乐|舞蹈|表演|编导|设计|绘画/.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|运动人体/.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) {
    return { admissionType: "专项计划", admissionSubtype: "国家专项", formalScoreScope: "special-path-only" };
  }
  if (/地方专项/.test(text)) {
    return { admissionType: "专项计划", admissionSubtype: "地方专项", formalScoreScope: "special-path-only" };
  }
  if (/公费师范|优师/.test(text)) {
    return { admissionType: "公费师范/优师专项", admissionSubtype: /优师/.test(text) ? "地方优师专项" : "地方公费师范生", formalScoreScope: "special-path-only" };
  }
  if (/定向|非西藏|非西定西|哈密|南疆|预科|少数民族|协作/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "定向/预科/南疆等", formalScoreScope: "special-path-only" };
  }
  if (/中外合作|软件类|单列专业组/.test(text)) {
    return { admissionType: "特殊收费或单列专业", admissionSubtype: /软件类/.test(text) ? "软件类" : /中外合作/.test(text) ? "中外合作办学" : "单列专业组", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch({ admissionTypeRaw, sourceProvinceRaw, year }) {
  const text = [admissionTypeRaw, sourceProvinceRaw].map(clean).join(" ");
  if (/专升本/.test(text)) return "专升本";
  if (/对口/.test(text)) return "对口招生";
  if (/艺术/.test(text)) return "艺术类批次";
  if (/体育/.test(text)) return "体育类批次";
  if (/公费师范|优师/.test(text)) return "地方公费师范/优师专项";
  if (/国家专项/.test(text)) return "国家专项";
  if (/地方专项/.test(text)) return "地方专项";
  if (/预科/.test(text)) return "民族预科";
  if (/定向|哈密|南疆|非西/.test(text)) return "定向/南疆等特殊批次";
  return year >= 2021 ? "本科批" : "本科批";
}

function parseDataLq(jsText) {
  const sandbox = {};
  vm.runInNewContext(jsText, sandbox, { timeout: 1000 });
  if (!Array.isArray(sandbox.data_lq)) throw new Error("Could not find official data_lq array");
  return sandbox.data_lq.map((line) => String(line).split("|"));
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

function makeRecord(row, ordinal) {
  if (![9, 10].includes(row.length)) {
    return {
      skipped: {
        reason: "unexpected-column-count",
        cells: row,
      },
    };
  }
  const [yearRaw, sourceProvinceRaw, majorRaw, subjectRaw, admissionTypeRaw, maxScoreRaw, minScoreRaw, avgScoreRaw, controlLineRaw, rankRaw = ""] = row.map(clean);
  const year = Number(yearRaw);
  const province = normalizeProvince(sourceProvinceRaw);
  const majorNameRaw = clean(majorRaw);
  const majorName = majorNameRaw || "学校录取汇总";
  const minScore = parseNumber(minScoreRaw);
  if (!Number.isFinite(year) || !MAINLAND_PROVINCES.has(province) || !Number.isFinite(minScore)) {
    return {
      skipped: {
        reason: "missing-required-fields",
        yearRaw,
        sourceProvinceRaw,
        normalizedProvince: province,
        majorRaw,
        minScoreRaw,
        cells: row,
      },
    };
  }
  const subjectType = normalizeSubject(subjectRaw, admissionTypeRaw, majorName);
  const classification = classifyAdmission({ admissionTypeRaw, majorName, subjectRaw, sourceProvinceRaw });
  const minRank = parseNumber(rankRaw);
  const maxScore = parseNumber(maxScoreRaw);
  const avgScore = parseNumber(avgScoreRaw);
  const controlLine = parseNumber(controlLineRaw);
  const sourceNumericAnomaly = minScore < 100
    && ((Number.isFinite(avgScore) && avgScore > 100) || (Number.isFinite(maxScore) && maxScore > 100))
    && classification.admissionType !== "艺术类录取"
    && classification.admissionType !== "体育类录取";
  if (sourceNumericAnomaly) {
    return {
      skipped: {
        reason: "official-source-numeric-anomaly",
        year,
        sourceProvinceRaw,
        normalizedProvince: province,
        majorName,
        minScoreRaw,
        avgScoreRaw,
        maxScoreRaw,
        cells: row,
        note: "官方 JS 最低分小于100，但同一行平均分/最高分在100以上；不替官方猜测修正，跳过可计算记录以免污染低分段推荐。",
      },
    };
  }

  const rankUnavailable = !Number.isFinite(minRank);
  const scoreMetric = classification.formalScoreScope === "special-path-only"
    ? "艺术/体育/专项/定向/预科等特殊路径综合分或学校源表计分"
    : "高考文化分";
  const record = {
    id: `${year}-htu-major-${stableId([
      sourceProvinceRaw,
      province,
      majorName,
      subjectRaw,
      admissionTypeRaw,
      minScore,
      minRank ?? "",
      ordinal,
    ])}`,
    province,
    sourceProvinceRaw,
    year,
    subjectType,
    sourceSubjectRaw: subjectRaw,
    batch: normalizeBatch({ admissionTypeRaw, sourceProvinceRaw, year }),
    sourceBatchRaw: admissionTypeRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: majorNameRaw ? "major-admission" : "institution-admission",
    majorName,
    majorGroup: [SOURCE.schoolName, sourceProvinceRaw, year, admissionTypeRaw, subjectRaw, majorName].filter(Boolean).join("-"),
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    minScore,
    scoreMetric,
    scoreOnly: rankUnavailable,
    rankUnavailable,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: rankUnavailable ? "single-school-major-score" : "single-school-major-score-rank",
    sourceUrl: SOURCE_PAGE_URL,
    sourcePageUrl: SOURCE_PAGE_URL,
    sourceDataUrl: DATA_LQ_URL,
    sourceMajorCatalogUrl: DATA_KM_URL,
    sourceCharterUrl: CHARTER_URL,
    officialEvidencePath: path.posix.join(RAW_DIR, "htu-2020-2025-data_lq.js"),
    sourceHtmlPath: path.posix.join(RAW_DIR, "htu-2020-2025-page.html"),
    sourceMinScoreRaw: minScoreRaw,
    sourceAvgScoreRaw: avgScoreRaw,
    sourceMaxScoreRaw: maxScoreRaw,
    sourceControlLineRaw: controlLineRaw,
    sourceRankRaw: rankRaw,
    rawRow: {
      source: "htu-2020-2025-official-data_lq-js",
      cells: row,
      sourceProvinceRaw,
      normalizedProvince: province,
      sourceMajorRaw: majorRaw,
      ordinal,
    },
    cautions: [
      majorNameRaw
        ? "本记录来自河南师范大学招生网官方历年录取情况智能查询系统 data_lq.js，是单校分省专业录取边界，不是省级教育考试院全量投档/录取分数表。"
        : "本记录来自河南师范大学招生网官方历年录取情况智能查询系统 data_lq.js；源表未列专业名，按单校学校层录取汇总边界保存，不是省级教育考试院全量投档/录取分数表。",
      rankUnavailable
        ? "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
        : "本行含学校官网公布的最低分位次，但仍是单校来源；推荐层只能用于河南师范大学候选边界复核。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺术、体育、专项、公费师范、优师、预科、定向、南疆、对口或专升本等特殊路径，运行层按 special-path-only 隔离，不与普通批次边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(avgScore)) record.avgScore = avgScore;
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (Number.isFinite(minRank)) record.minRank = minRank;
  return record;
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const pageHtml = await downloadText(rawRoot, "htu-2020-2025-page.html", SOURCE_PAGE_URL, args.useCache);
  if (!/河南师范大学历年录取情况智能查询系统/.test(extractTitle(pageHtml))) {
    throw new Error(`Unexpected HTU source page title: ${extractTitle(pageHtml)}`);
  }
  const dataLqJs = await downloadText(rawRoot, "htu-2020-2025-data_lq.js", DATA_LQ_URL, args.useCache);
  const dataKmJs = await downloadText(rawRoot, "htu-2020-2025-data_km.js", DATA_KM_URL, args.useCache);
  const charterHtml = await downloadText(rawRoot, "htu-2026-charter-page.html", CHARTER_URL, args.useCache);
  if (!/河南师范大学2026年.*本科招生章程/.test(extractTitle(charterHtml))) {
    throw new Error(`Unexpected HTU charter title: ${extractTitle(charterHtml)}`);
  }
  if (!/var\s+data_zy\s*=/.test(dataKmJs)) throw new Error("Expected data_zy major catalog in data_km.js");

  const rows = parseDataLq(dataLqJs);
  const records = [];
  const skippedRows = [];
  rows.forEach((row, ordinal) => {
    const record = makeRecord(row, ordinal);
    if (!record) return;
    if (record.skipped) {
      skippedRows.push(record.skipped);
      return;
    }
    records.push(record);
  });

  if (records.length < 2500) throw new Error(`Parsed too few HTU records: ${records.length}`);
  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingMainland = [...MAINLAND_PROVINCES].filter((province) => !provincesWithRecords.includes(province)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const recordsWithRank = records.filter((record) => !record.rankUnavailable).length;
  const recordsWithoutRank = records.length - recordsWithRank;
  const ordinarySchoolOfficialRecords = records.filter((record) => record.formalScoreScope === "school-official-only").length;
  const specialPathRecords = records.filter((record) => record.formalScoreScope === "special-path-only").length;
  const sourceProvinceRawCount = new Set(records.map((record) => record.sourceProvinceRaw)).size;

  const payload = {
    sourceNotes: [
      {
        id: SOURCE.id,
        title: "河南师范大学招生网：历年录取情况智能查询系统",
        publisher: "河南师范大学招生网",
        url: SOURCE_PAGE_URL,
        dataUrl: DATA_LQ_URL,
        majorCatalogUrl: DATA_KM_URL,
        charterUrl: CHARTER_URL,
        quality: SOURCE.quality,
        usage: "从河南师范大学招生网官方历年录取情况智能查询系统下载页面和 data_lq.js，抽取2020-2025年年度、省份/源表地区、专业、科类、类型、最高分、最低分、平均分、省控线和最低分位次。2025年源表公开最低分位次；2020-2024年源表未列位次，按无位次记录保存。河南县域公费师范/优师、新疆哈密/南疆/预科等按目标省份归并，同时保留 sourceProvinceRaw。",
        parsedRows: rows.length,
        parsedRecords: records.length,
        skippedOfficialRows: skippedRows.length,
        provinceCount: provincesWithRecords.length,
        sourceProvinceRawCount,
        provincesWithRecords,
        missingMainlandProvinces: missingMainland,
        years: [2020, 2021, 2022, 2023, 2024, 2025],
        recordsWithRank,
        recordsWithoutRank,
        ordinarySchoolOfficialRecords,
        specialPathRecords,
        byProvince: countBy(records, (record) => record.province),
        bySourceProvinceRaw: countBy(records, (record) => record.sourceProvinceRaw),
        byYear: countBy(records, (record) => String(record.year)),
        bySubjectType: countBy(records, (record) => record.subjectType),
        byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
        byAdmissionType: countBy(records, (record) => record.admissionType),
        byAdmissionSubtype: countBy(records, (record) => record.admissionSubtype),
        byBatch: countBy(records, (record) => record.batch),
        byDataType: countBy(records, (record) => record.dataType),
        scoreRange: scoreRange(records),
        skippedRows,
        rawPaths: [
          path.posix.join(RAW_DIR, "htu-2020-2025-page.html"),
          path.posix.join(RAW_DIR, "htu-2020-2025-data_lq.js"),
          path.posix.join(RAW_DIR, "htu-2020-2025-data_km.js"),
          path.posix.join(RAW_DIR, "htu-2026-charter-page.html"),
        ],
        cautions: [
          "本导入包来自河南师范大学学校官网单校专业录取数据，不关闭任何省级正式投档表缺口。",
          "2020-2024年源表未列最低分位次，运行层不生成假位次。",
          "河南县域公费师范/优师、新疆哈密/南疆/预科等特殊源表地区已归并到目标省份，但 sourceProvinceRaw 保留原口径。",
          "艺术、体育、专项、公费师范、优师、预科、定向、南疆、对口和专升本等记录按 special-path-only 隔离，不与普通批次混用。",
          "2026招生章程用于当前学校层约束溯源；2025录取数据仍以官方 data_lq.js 为原始数据源。",
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
    rows: rows.length,
    records: records.length,
    skippedOfficialRows: skippedRows.length,
    provincesWithRecords: provincesWithRecords.length,
    sourceProvinceRawCount,
    missingMainlandProvinces: missingMainland,
    recordsWithRank,
    recordsWithoutRank,
    ordinarySchoolOfficialRecords,
    specialPathRecords,
    byYear: payload.sourceNotes[0].byYear,
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
