#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3201-henau-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3201-henau";
const INDEX_URL = "https://zs.henau.edu.cn/html/historical_scores.html";
const LIST_API_URL = "https://zs.henau.edu.cn/api/getContentPage/6/1/100";
const SOURCE = {
  id: "official-henau-national-2025-school-major-institution-admission",
  quality: "official-school-henau-2025-national-html-score-rank",
  schoolCode: "10466",
  schoolName: "河南农业大学",
  city: "郑州",
  tags: ["农林", "河南", "河南农业大学"],
};

const TARGET_TITLES = [
  { key: "outProvinceMajor", name: "2025年河南农业大学外省市分专业录取情况", dataType: "major-admission" },
  { key: "provinceSummary", name: "2025年河南农业大学各省市录取情况统计表", dataType: "institution-admission" },
  { key: "henanMajor", name: "2025年河南农业大学河南省分专业录取情况", dataType: "major-admission" },
];

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

const PROVINCE_ALIASES = new Map([
  ["北京市", "北京"],
  ["天津市", "天津"],
  ["河北省", "河北"],
  ["山西省", "山西"],
  ["内蒙古区", "内蒙古"],
  ["内蒙古自治区", "内蒙古"],
  ["辽宁省", "辽宁"],
  ["吉林省", "吉林"],
  ["黑龙江省", "黑龙江"],
  ["上海市", "上海"],
  ["江苏省", "江苏"],
  ["浙江省", "浙江"],
  ["安徽省", "安徽"],
  ["福建省", "福建"],
  ["江西省", "江西"],
  ["山东省", "山东"],
  ["河南省", "河南"],
  ["湖北省", "湖北"],
  ["湖南省", "湖南"],
  ["广东省", "广东"],
  ["广西区", "广西"],
  ["广西壮族自治区", "广西"],
  ["海南省", "海南"],
  ["重庆市", "重庆"],
  ["四川省", "四川"],
  ["贵州省", "贵州"],
  ["云南省", "云南"],
  ["西藏区", "西藏"],
  ["西藏自治区", "西藏"],
  ["陕西省", "陕西"],
  ["甘肃省", "甘肃"],
  ["青海省", "青海"],
  ["宁夏区", "宁夏"],
  ["宁夏回族自治区", "宁夏"],
  ["新疆区", "新疆"],
  ["新疆维吾尔自治区", "新疆"],
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3201-henau.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3201-henau.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/API JSON",
    "",
    "Imports Henan Agricultural University official 2025 score/rank tables.",
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

async function fetchText(url, { method = "GET" } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        method,
        signal: AbortSignal.timeout(60_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "text/html,application/xhtml+xml,application/xml,application/json,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          origin: "https://zs.henau.edu.cn",
          referer: INDEX_URL,
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      if (text.length < 100) throw new Error(`Unexpectedly short source (${text.length} chars) for ${url}`);
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
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

function attrNumber(attrs, name, fallback = 1) {
  const match = String(attrs ?? "").match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Number(match[1]) : fallback;
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
      const colspan = attrNumber(attrs, "colspan", 1);
      for (let offset = 0; offset < colspan; offset += 1) {
        row[col + offset] = text;
        if (rowspan > 1) spans[col + offset] = { text, remaining: rowspan - 1 };
      }
      col += colspan;
    }
    const cleaned = row.map((cell) => clean(cell));
    if (cleaned.some(Boolean)) rows.push(cleaned);
  }
  return rows;
}

function headerKey(cell) {
  const text = clean(cell).replace(/\s+/g, "");
  if (text === "省市") return "province";
  if (text === "科类" || text === "科类名称") return "subjectType";
  if (text === "专业组") return "majorGroupCode";
  if (text === "专业名称") return "majorName";
  if (text === "统计类型") return "admissionTypeRaw";
  if (text === "录取人数") return "admissionCount";
  if (text === "计划人数") return "planCount";
  if (text === "控制线") return "controlLine";
  if (text === "最低分") return "minScore";
  if (text === "最低超线分") return "minScoreAboveControl";
  if (text === "最低分排名") return "minRank";
  if (text === "最高分") return "maxScore";
  if (text === "最高超线分") return "maxScoreAboveControl";
  if (text === "最高分排名") return "maxRank";
  if (text === "平均分") return "avgScore";
  if (text === "平均超线分") return "avgScoreAboveControl";
  if (text === "平均分排名") return "avgRank";
  return "";
}

function headerMap(header) {
  const map = new Map();
  header.forEach((cell, index) => {
    const key = headerKey(cell);
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

function getCell(row, map, key) {
  const index = map.get(key);
  return index == null ? "" : clean(row[index]);
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
  const simple = text.replace(/省$|市$|区$/g, "");
  return PROVINCE_ALIASES.get(simple) || simple;
}

function normalizeSubject(raw, admissionTypeRaw, majorName) {
  const subject = clean(raw);
  const text = [subject, admissionTypeRaw, majorName].map(clean).join(" ");
  if (/艺术|美术|音乐|舞蹈|表演|编导|设计|绘画/.test(text)) return "艺术类";
  if (/体育|运动/.test(text)) return "体育类";
  if (/综合改革/.test(subject)) return "综合改革";
  if (/不分文理/.test(subject)) return "不分文理";
  if (/历史|文史|文科/.test(subject)) return "历史类";
  if (/物理|理工|理科/.test(subject)) return "物理类";
  return subject || "官网未列科类";
}

function classifyAdmission(admissionTypeRaw, majorName, subjectRaw) {
  const text = [admissionTypeRaw, majorName, subjectRaw].map(clean).join(" ");
  if (/艺术|美术|音乐|舞蹈|表演|编导|设计|绘画/.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育/.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) {
    return { admissionType: "专项计划", admissionSubtype: "国家专项", formalScoreScope: "special-path-only" };
  }
  if (/地方专项/.test(text)) {
    return { admissionType: "专项计划", admissionSubtype: "地方专项", formalScoreScope: "special-path-only" };
  }
  if (/南单|南疆|对口|定向|预科|民族|专项南单/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "南疆/对口/定向等", formalScoreScope: "special-path-only" };
  }
  if (/中外合作|软件|较高收费/.test(text)) {
    return { admissionType: "特殊收费或单列专业", admissionSubtype: /软件/.test(text) ? "软件类" : "中外合作/单列专业", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch(admissionTypeRaw) {
  const text = clean(admissionTypeRaw);
  if (/国家专项/.test(text)) return "国家专项";
  if (/地方专项/.test(text)) return "地方专项";
  if (/专项南单|南疆|对口|定向/.test(text)) return "专项南单/定向等特殊批次";
  if (/艺术/.test(text)) return "艺术类批次";
  if (/体育/.test(text)) return "体育类批次";
  if (/本科二批/.test(text)) return "本科二批";
  if (/本科/.test(text)) return "本科批";
  return text || "官网未列批次";
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

function detailRawName(key) {
  return `henau-2025-${key}.html`;
}

function parseListApi(jsonText) {
  const payload = JSON.parse(jsonText);
  if (payload.code !== 0 || !payload.data || !Array.isArray(payload.data.data)) {
    throw new Error("Unexpected HENAU list API payload");
  }
  const found = new Map();
  for (const target of TARGET_TITLES) {
    const item = payload.data.data.find((entry) => clean(entry.name).replace(/^\u200b/, "") === target.name);
    if (!item) throw new Error(`Could not find list item: ${target.name}`);
    found.set(target.key, {
      ...target,
      id: item.id,
      title: clean(item.name),
      releaseTime: item.releaseTime,
      browseCount: item.browseCount,
      detailUrl: new URL(item.detailUrl, INDEX_URL).href,
      context: item.context,
    });
  }
  return found;
}

function parseDetailTable(html, page) {
  const table = html.match(/<table\b[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw new Error(`No table found for ${page.key}`);
  const rows = tableRows(table);
  if (rows.length < 2) throw new Error(`Too few table rows for ${page.key}`);
  const header = rows[0];
  const map = headerMap(header);
  const required = page.dataType === "major-admission"
    ? ["province", "subjectType", "majorName", "admissionTypeRaw", "minScore"]
    : ["province", "subjectType", "admissionTypeRaw", "minScore"];
  for (const key of required) {
    if (!map.has(key)) throw new Error(`Missing ${key} in ${page.key} header: ${header.join("|")}`);
  }

  const records = [];
  const skippedRows = [];
  rows.slice(1).forEach((row, ordinal) => {
    const sourceProvinceRaw = getCell(row, map, "province");
    const province = normalizeProvince(sourceProvinceRaw);
    const admissionTypeRaw = getCell(row, map, "admissionTypeRaw");
    const majorName = page.dataType === "major-admission" ? getCell(row, map, "majorName") : "学校录取汇总";
    const subjectRaw = getCell(row, map, "subjectType");
    const minScoreRaw = getCell(row, map, "minScore");
    const minScore = parseNumber(minScoreRaw);
    if (!MAINLAND_PROVINCES.has(province) || !majorName || !Number.isFinite(minScore)) {
      skippedRows.push({
        reason: "missing-required-fields",
        pageKey: page.key,
        sourceProvinceRaw,
        normalizedProvince: province,
        majorName,
        minScoreRaw,
        cells: row,
      });
      return;
    }
    const classification = classifyAdmission(admissionTypeRaw, majorName, subjectRaw);
    const subjectType = normalizeSubject(subjectRaw, admissionTypeRaw, majorName);
    const minRankRaw = getCell(row, map, "minRank");
    const maxRankRaw = getCell(row, map, "maxRank");
    const avgRankRaw = getCell(row, map, "avgRank");
    const minRank = parseNumber(minRankRaw);
    const maxRank = parseNumber(maxRankRaw);
    const avgRank = parseNumber(avgRankRaw);
    const admissionCountRaw = getCell(row, map, "admissionCount");
    const planCountRaw = getCell(row, map, "planCount");
    const controlLineRaw = getCell(row, map, "controlLine");
    const maxScoreRaw = getCell(row, map, "maxScore");
    const avgScoreRaw = getCell(row, map, "avgScore");
    const admissionCount = parseNumber(admissionCountRaw);
    const planCount = parseNumber(planCountRaw);
    const controlLine = parseNumber(controlLineRaw);
    const maxScore = parseNumber(maxScoreRaw);
    const avgScore = parseNumber(avgScoreRaw);
    const majorGroupCode = getCell(row, map, "majorGroupCode");
    const rankUnavailable = !Number.isFinite(minRank);
    const record = {
      id: `2025-henau-${page.dataType.replace(/-.*/, "")}-${stableId([
        page.key,
        sourceProvinceRaw,
        majorGroupCode,
        majorName,
        subjectRaw,
        admissionTypeRaw,
        minScore,
        minRank ?? "",
        ordinal,
      ])}`,
      province,
      sourceProvinceRaw,
      year: 2025,
      subjectType,
      sourceSubjectRaw: subjectRaw,
      batch: normalizeBatch(admissionTypeRaw),
      sourceBatchRaw: admissionTypeRaw,
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      city: SOURCE.city,
      schoolTags: SOURCE.tags,
      dataType: page.dataType,
      majorName,
      majorGroup: majorGroupCode || [SOURCE.schoolName, sourceProvinceRaw, admissionTypeRaw, subjectRaw, majorName].filter(Boolean).join("-"),
      admissionType: classification.admissionType,
      admissionSubtype: classification.admissionSubtype,
      formalScoreScope: classification.formalScoreScope,
      minScore,
      scoreMetric: classification.formalScoreScope === "special-path-only" ? "特殊路径文化分或学校源表计分" : "高考文化分",
      scoreOnly: rankUnavailable,
      rankUnavailable,
      sourceId: SOURCE.id,
      sourceQuality: SOURCE.quality,
      schoolOfficialScope: rankUnavailable ? "single-school-score" : "single-school-score-rank",
      sourceUrl: page.detailUrl,
      sourcePageUrl: page.detailUrl,
      sourceIndexUrl: INDEX_URL,
      sourceListApiUrl: LIST_API_URL,
      officialEvidencePath: path.posix.join(RAW_DIR, detailRawName(page.key)),
      sourceHtmlPath: path.posix.join(RAW_DIR, detailRawName(page.key)),
      sourceMinScoreRaw: minScoreRaw,
      sourceAvgScoreRaw: avgScoreRaw,
      sourceMaxScoreRaw: maxScoreRaw,
      sourceControlLineRaw: controlLineRaw,
      sourceAdmissionCountRaw: admissionCountRaw,
      sourcePlanCountRaw: planCountRaw,
      sourceRankRaw: minRankRaw,
      sourceMaxRankRaw: maxRankRaw,
      sourceAvgRankRaw: avgRankRaw,
      rawRow: {
        source: "henau-2025-official-html-table",
        pageKey: page.key,
        pageTitle: page.title,
        headers: header,
        cells: row,
        sourceProvinceRaw,
        normalizedProvince: province,
      },
      cautions: [
        `本记录来自河南农业大学招生信息网官方“${page.title}”表，是单校录取边界，不是省级教育考试院全量投档/录取分数表。`,
        rankUnavailable
          ? "源表本行未公开最低分排名；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
          : "本行含学校官网公布的最低分排名，但仍是单校来源；推荐层只能用于河南农业大学候选边界复核。",
        classification.formalScoreScope === "special-path-only"
          ? "本行属于专项、南疆/对口/定向、艺术体育等特殊路径，运行层按 special-path-only 隔离，不与普通批次边界混用。"
          : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    };
    if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
    if (Number.isFinite(planCount)) record.planCount = planCount;
    if (Number.isFinite(controlLine)) record.controlLine = controlLine;
    if (Number.isFinite(maxScore)) record.maxScore = maxScore;
    if (Number.isFinite(avgScore)) record.avgScore = avgScore;
    if (Number.isFinite(minRank)) record.minRank = minRank;
    if (Number.isFinite(maxRank)) record.maxRank = maxRank;
    if (Number.isFinite(avgRank)) record.avgRank = avgRank;
    records.push(record);
  });
  return { records, skippedRows, header };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const indexHtml = await downloadText(rawRoot, "henau-2025-historical-scores-index.html", INDEX_URL, args.useCache);
  if (!/河南农业大学招生信息网/.test(extractTitle(indexHtml))) {
    throw new Error(`Unexpected HENAU index title: ${extractTitle(indexHtml)}`);
  }
  const listJson = await downloadText(rawRoot, "henau-2025-historical-scores-list-api.json", LIST_API_URL, args.useCache, { method: "POST" });
  const pages = parseListApi(listJson);

  const records = [];
  const skippedRows = [];
  const pageSummaries = [];
  for (const page of pages.values()) {
    const html = await downloadText(rawRoot, detailRawName(page.key), page.detailUrl, args.useCache);
    if (!/河南农业大学招生信息网/.test(extractTitle(html))) {
      throw new Error(`Unexpected title for ${page.key}: ${extractTitle(html)}`);
    }
    if (!html.includes("最低分排名")) throw new Error(`Expected rank header in ${page.key}`);
    const parsed = parseDetailTable(html, page);
    records.push(...parsed.records);
    skippedRows.push(...parsed.skippedRows);
    pageSummaries.push({
      key: page.key,
      title: page.title,
      detailUrl: page.detailUrl,
      releaseTime: page.releaseTime,
      rawPath: path.posix.join(RAW_DIR, detailRawName(page.key)),
      dataType: page.dataType,
      records: parsed.records.length,
      skippedRows: parsed.skippedRows.length,
      recordsWithRank: parsed.records.filter((record) => !record.rankUnavailable).length,
      recordsWithoutRank: parsed.records.filter((record) => record.rankUnavailable).length,
      headers: parsed.header,
      byProvince: countBy(parsed.records, (record) => record.province),
      byFormalScoreScope: countBy(parsed.records, (record) => record.formalScoreScope),
    });
  }

  if (records.length < 500) throw new Error(`Parsed too few HENAU records: ${records.length}`);
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
        title: "河南农业大学招生信息网：2025年分专业与各省市录取情况统计表",
        publisher: "河南农业大学招生就业办公室",
        url: INDEX_URL,
        listApiUrl: LIST_API_URL,
        quality: SOURCE.quality,
        usage: "从河南农业大学招生信息网官方历年分数栏目和列表 API 定位三张 2025 年官方 HTML 表：外省市分专业录取情况、河南省分专业录取情况、各省市录取情况统计表。抽取省市、科类/专业组、专业名称、统计类型、录取人数、计划人数、控制线、最低分、最低分排名、最高分、最高分排名、平均分、平均分排名等字段；学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
        parsedRecords: records.length,
        skippedOfficialRows: skippedRows.length,
        provinceCount: provincesWithRecords.length,
        provincesWithRecords,
        missingMainlandProvinces: missingMainland,
        years: [2025],
        recordsWithRank,
        recordsWithoutRank,
        ordinarySchoolOfficialRecords,
        specialPathRecords,
        byProvince: countBy(records, (record) => record.province),
        bySourceProvinceRaw: countBy(records, (record) => record.sourceProvinceRaw),
        bySubjectType: countBy(records, (record) => record.subjectType),
        byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
        byAdmissionType: countBy(records, (record) => record.admissionType),
        byAdmissionSubtype: countBy(records, (record) => record.admissionSubtype),
        byBatch: countBy(records, (record) => record.batch),
        byDataType: countBy(records, (record) => record.dataType),
        scoreRange: scoreRange(records),
        pageSummaries,
        skippedRows,
        rawPaths: [
          path.posix.join(RAW_DIR, "henau-2025-historical-scores-index.html"),
          path.posix.join(RAW_DIR, "henau-2025-historical-scores-list-api.json"),
          ...[...pages.values()].map((page) => path.posix.join(RAW_DIR, detailRawName(page.key))),
        ],
        cautions: [
          "本导入包来自河南农业大学学校官网单校分数/排名数据，不关闭任何省级正式投档表缺口。",
          "新疆部分专项南单对口本二记录源表未列排名，运行层不生成假位次。",
          "专项、南疆/对口/定向、艺术体育等记录按 special-path-only 隔离，不与普通批次混用。",
          "各省市汇总表按 institution-admission 保存；分专业表按 major-admission 保存，二者服务不同复核层，不互相覆盖。",
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
    pages: pageSummaries.map((page) => ({ key: page.key, records: page.records, rank: page.recordsWithRank })),
    provincesWithRecords: provincesWithRecords.length,
    missingMainlandProvinces: missingMainland,
    recordsWithRank,
    recordsWithoutRank,
    ordinarySchoolOfficialRecords,
    specialPathRecords,
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
