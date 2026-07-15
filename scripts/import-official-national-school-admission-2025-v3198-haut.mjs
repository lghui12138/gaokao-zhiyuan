#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3198-haut-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3198-haut";
const BASE_URL = "https://zs.haut.edu.cn/gwfs/lntj/bj/a2025n.htm";
const CHARTER_URL = "https://zs.haut.edu.cn/info/1067/7272.htm";
const SOURCE = {
  id: "official-haut-national-2025-school-major-admission",
  quality: "official-school-haut-2025-national-major-html-score-rank",
  schoolCode: "10463",
  schoolName: "河南工业大学",
  city: "郑州",
  tags: ["理工", "粮食", "河南"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3198-haut.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3198-haut.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Henan University of Technology official 2025 province major admission pages.",
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
    throw new Error("Refusing to run HTML ingestion from /Volumes/mac_2T; run this importer from the internal APFS project copy.");
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
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      if (text.length < 1000) throw new Error(`Unexpectedly short HTML (${text.length} chars) for ${url}`);
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

function attrNumber(attrs, name, fallback = 1) {
  const match = String(attrs ?? "").match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Number(match[1]) : fallback;
}

function extractTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractTables(html) {
  return [...String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function tableRows(tableHtml) {
  const rows = [];
  const spans = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of String(tableHtml).matchAll(rowRe)) {
    const row = [];
    for (let col = 0; col < spans.length; col += 1) {
      if (spans[col]) {
        row[col] = spans[col].text;
        spans[col].remaining -= 1;
        if (spans[col].remaining <= 0) spans[col] = null;
      }
    }
    let col = 0;
    const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    for (const cellMatch of rowMatch[1].matchAll(cellRe)) {
      while (row[col] != null) col += 1;
      const attrs = cellMatch[1];
      const text = stripTags(cellMatch[2]);
      const rowspan = attrNumber(attrs, "rowspan", 1);
      row[col] = text;
      if (rowspan > 1) spans[col] = { text, remaining: rowspan - 1 };
      col += 1;
    }
    const cleaned = row.map((cell) => clean(cell));
    if (cleaned.some(Boolean)) rows.push(cleaned);
  }
  return rows;
}

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function provinceFileName(code) {
  return `haut-2025-${code}.html`;
}

function discoverProvinceLinks(baseHtml) {
  const links = new Map();
  const re = /<a\b[^>]*href=["']\.\.\/([^"'/.]+)\.htm["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(baseHtml).matchAll(re)) {
    const code = clean(match[1]);
    const province = stripTags(match[2]);
    if (MAINLAND_PROVINCES.has(province) && !links.has(province)) {
      links.set(province, {
        code,
        province,
        url: `https://zs.haut.edu.cn/gwfs/lntj/${code}/a2025n.htm`,
        rawPath: path.posix.join(RAW_DIR, provinceFileName(code)),
      });
    }
  }
  return [...links.values()].sort((a, b) => a.province.localeCompare(b.province, "zh-Hans-CN"));
}

function normalizeSubject(raw, batch, majorName) {
  const text = [raw, batch, majorName].map(clean).join(" ");
  if (/艺术|设计|播音/.test(text)) return "艺术类";
  if (/文|历史/.test(text)) return "历史类";
  if (/理|物理/.test(text)) return "物理类";
  if (/综合改革/.test(text)) return "综合改革";
  if (/不分文理/.test(text)) return "不分文理";
  return "官网未列科类";
}

function classifyAdmission(batch, majorName) {
  const text = [batch, majorName].map(clean).join(" ");
  if (/艺术|设计|播音/.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: /播音/.test(text) ? "播音与主持艺术" : "设计学类", formalScoreScope: "special-path-only" };
  }
  if (/南疆单列/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "南疆单列", formalScoreScope: "special-path-only" };
  }
  if (/哈密定向|定向/.test(text)) {
    return { admissionType: "定向招生", admissionSubtype: "哈密定向", formalScoreScope: "special-path-only" };
  }
  if (/国家专项|地方专项|专项/.test(text)) {
    return { admissionType: "专项计划", admissionSubtype: /国家专项/.test(text) ? "国家专项" : /地方专项/.test(text) ? "地方专项" : "专项计划", formalScoreScope: "special-path-only" };
  }
  if (/合作办学|合作/.test(text)) {
    return { admissionType: "中外合作办学", admissionSubtype: "中外合作办学", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch(batch) {
  const text = clean(batch);
  if (/南疆单列/.test(text)) return "南疆单列";
  if (/哈密定向/.test(text)) return "哈密定向";
  if (/艺术/.test(text) || /设计/.test(text) || /播音/.test(text)) return text;
  if (/本科二批/.test(text)) return "本科二批";
  if (/本科/.test(text)) return "本科批";
  return text || "本科批";
}

function makeRecord({ row, page, ordinal }) {
  const [batchRaw, majorRaw, subjectRaw, countRaw, avgRaw, controlRaw, maxRaw, minRaw, rankRaw = ""] = row;
  const majorName = clean(majorRaw);
  const minScore = parseNumber(minRaw);
  if (!majorName || !Number.isFinite(minScore)) return null;
  const classification = classifyAdmission(batchRaw, majorName);
  const subjectType = normalizeSubject(subjectRaw, batchRaw, majorName);
  const minRank = parseNumber(rankRaw);
  const admissionCount = parseNumber(countRaw);
  const avgScore = parseNumber(avgRaw);
  const maxScore = parseNumber(maxRaw);
  const controlLine = parseNumber(controlRaw);
  const scoreMetric = classification.admissionType === "艺术类录取" ? "艺术类综合分或学校源表计分" : "高考文化分";
  const rankUnavailable = !Number.isFinite(minRank);
  const record = {
    id: `2025-haut-major-${stableId([
      page.province,
      batchRaw,
      majorName,
      subjectRaw,
      classification.admissionSubtype,
      minScore,
      minRank ?? "",
      ordinal,
    ])}`,
    province: page.province,
    sourceProvinceRaw: page.province,
    year: 2025,
    subjectType,
    sourceSubjectRaw: subjectRaw,
    batch: normalizeBatch(batchRaw),
    sourceBatchRaw: batchRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "major-admission",
    majorName,
    majorGroup: [SOURCE.schoolName, page.province, batchRaw, subjectRaw, majorName].filter(Boolean).join("-"),
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
    sourceUrl: page.url,
    sourcePageUrl: page.url,
    sourceCharterUrl: CHARTER_URL,
    officialEvidencePath: page.rawPath,
    sourceHtmlPath: page.rawPath,
    sourceMinScoreRaw: minRaw,
    sourceAdmissionCountRaw: countRaw,
    sourceAvgScoreRaw: avgRaw,
    sourceMaxScoreRaw: maxRaw,
    sourceControlLineRaw: controlRaw,
    rawRow: {
      source: "haut-2025-province-major-html",
      cells: row,
      provinceCode: page.code,
      province: page.province,
    },
    cautions: [
      "本记录来自河南工业大学招生网官方2025年历年分数省份页，是单校分省专业录取边界，不是省级教育考试院全量投档/录取分数表。",
      rankUnavailable
        ? "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
        : "本行含学校官网公布的最低分位次，但仍是单校来源；推荐层只能用于河南工业大学候选边界复核。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺术类、南疆单列、哈密定向或专项等特殊路径，运行层按 special-path-only 隔离，不与普通批次边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
  if (Number.isFinite(avgScore)) record.avgScore = avgScore;
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (Number.isFinite(minRank)) {
    record.minRank = minRank;
    record.sourceRankRaw = rankRaw;
  }
  return record;
}

function parseProvincePage(html, page) {
  const tables = extractTables(html).map(tableRows);
  const rows = tables.flatMap((table) => table);
  const headerIndex = rows.findIndex((row) => row.includes("批次") && row.includes("专业") && row.includes("最低分"));
  if (headerIndex < 0) return [];
  const records = [];
  let ordinal = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.length < 8 || row.includes("最低分") || row.includes("批次")) continue;
    const record = makeRecord({ row, page, ordinal });
    if (!record) continue;
    records.push(record);
    ordinal += 1;
  }
  return records;
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
  return { min: Math.min(...scores), max: Math.max(...scores) };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const baseHtml = await downloadText(rawRoot, provinceFileName("bj"), BASE_URL, args.useCache);
  const discoveredPages = discoverProvinceLinks(baseHtml);
  if (discoveredPages.length !== 31) throw new Error(`Expected 31 province links, found ${discoveredPages.length}`);
  const charterHtml = await downloadText(rawRoot, "haut-2025-charter.html", CHARTER_URL, args.useCache);
  if (!/河南工业大学2025年普通本科招生章程/.test(extractTitle(charterHtml))) {
    throw new Error("HAUT charter title did not match expected 2025 page");
  }

  const records = [];
  const pageSummaries = [];
  for (const page of discoveredPages) {
    const html = page.province === "北京"
      ? baseHtml
      : await downloadText(rawRoot, provinceFileName(page.code), page.url, args.useCache);
    if (!/2025年/.test(extractTitle(html))) throw new Error(`Unexpected title for ${page.province}: ${extractTitle(html)}`);
    const pageRecords = parseProvincePage(html, page);
    records.push(...pageRecords);
    pageSummaries.push({
      province: page.province,
      code: page.code,
      url: page.url,
      rawPath: page.rawPath,
      records: pageRecords.length,
    });
  }

  if (records.length < 1000) throw new Error(`Parsed too few HAUT records: ${records.length}`);
  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingMainland = [...MAINLAND_PROVINCES].filter((province) => !provincesWithRecords.includes(province)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const recordsWithRank = records.filter((record) => !record.rankUnavailable).length;
  const recordsWithoutRank = records.length - recordsWithRank;
  const ordinarySchoolOfficialRecords = records.filter((record) => record.formalScoreScope === "school-official-only").length;
  const specialPathRecords = records.filter((record) => record.formalScoreScope === "special-path-only").length;

  const payload = {
    sourceNotes: [
      {
        id: SOURCE.id,
        title: "河南工业大学招生网：2025年历年分数分省专业录取表",
        publisher: "河南工业大学招生网",
        url: BASE_URL,
        charterUrl: CHARTER_URL,
        quality: SOURCE.quality,
        usage: "从河南工业大学招生网官方历年分数栏目发现31个2025年省份页，并抽取各省批次、专业、科类、录取数、平均分、省控线、最高分、最低分、最低分位次。西藏页无可解析表格，不生成假记录；新疆页源表未列最低分位次，按无位次记录保存。",
        parsedRecords: records.length,
        provinceCount: provincesWithRecords.length,
        discoveredProvincePages: discoveredPages.length,
        provincesWithRecords,
        missingMainlandProvinces: missingMainland,
        years: [2025],
        recordsWithRank,
        recordsWithoutRank,
        ordinarySchoolOfficialRecords,
        specialPathRecords,
        byProvince: countBy(records, (record) => record.province),
        bySubjectType: countBy(records, (record) => record.subjectType),
        byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
        byAdmissionType: countBy(records, (record) => record.admissionType),
        byAdmissionSubtype: countBy(records, (record) => record.admissionSubtype),
        byBatch: countBy(records, (record) => record.batch),
        byDataType: countBy(records, (record) => record.dataType),
        scoreRange: scoreRange(records),
        pageSummaries,
        rawPaths: [
          ...discoveredPages.map((page) => page.rawPath),
          path.posix.join(RAW_DIR, "haut-2025-charter.html"),
        ],
        cautions: [
          "本导入包来自河南工业大学学校官网单校专业录取数据，不关闭任何省级正式投档表缺口。",
          "西藏页没有可解析2025表格，本包不生成西藏记录。",
          "新疆页源表未列最低分位次，运行层不生成假位次。",
          "艺术类、南疆单列、哈密定向和专项等记录按 special-path-only 隔离，不与普通本科批次混用。",
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
    discoveredProvincePages: discoveredPages.length,
    provincesWithRecords: provincesWithRecords.length,
    missingMainlandProvinces: missingMainland,
    recordsWithRank,
    recordsWithoutRank,
    ordinarySchoolOfficialRecords,
    specialPathRecords,
    byFormalScoreScope: payload.sourceNotes[0].byFormalScoreScope,
    byAdmissionType: payload.sourceNotes[0].byAdmissionType,
    byAdmissionSubtype: payload.sourceNotes[0].byAdmissionSubtype,
    byBatch: payload.sourceNotes[0].byBatch,
    byDataType: payload.sourceNotes[0].byDataType,
    scoreRange: payload.sourceNotes[0].scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
