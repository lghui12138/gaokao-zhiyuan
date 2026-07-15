#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2023-2025-v3205-hnmu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2023-2025-v3205-hnmu";
const INDEX_URL = "https://zjc.xxmu.edu.cn/zsxxw/lnfscx.jsp?urltype=tree.TreeTempUrl&wbtreeid=1065";
const QUERY_URL = "https://zjc.xxmu.edu.cn/zsxxw/lnfscx.jsp?wbtreeid=1065";
const SOURCE = {
  id: "official-hnmu-national-2023-2025-school-major-admission",
  quality: "official-school-hnmu-2023-2025-national-major-html-score",
  schoolCode: "10472",
  schoolName: "河南医药大学",
  legacySchoolName: "新乡医学院",
  city: "新乡",
  tags: ["医学", "河南", "河南医药大学", "新乡医学院"],
};

const YEARS = [2023, 2024, 2025];
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

const NEW_GAOKAO_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const SPECIAL_PATTERN = /国家专项|地方专项|免费定向|定向|哈密|南疆|单列类|南疆单列|预科|民族|专项|专升本|退役士兵|大学生士兵|建档立卡/;
const COOP_PATTERN = /中外合作|中外课程合作|合作办学|较高收费|联办|单列/;
const SPORTS_PATTERN = /体育|体育康养/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2023-2025-v3205-hnmu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2023-2025-v3205-hnmu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded official HTML evidence",
    "",
    "Imports Henan Medical University official 2023-2025 province major admission query pages.",
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
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248))
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

function firstNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--" || /没有/.test(text)) return null;
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

function rawPageName(year, province) {
  return `hnmu-${year}-${PROVINCE_SLUGS.get(province) || stableId([province])}.html`;
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
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: INDEX_URL,
          ...(options.headers || {}),
        },
        body: options.body,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      if (text.length < 100) throw new Error(`Unexpectedly short HTML (${text.length} chars) for ${url}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      await sleep(attempt * 1000);
    }
  }
  throw lastError;
}

async function downloadIndex(rawRoot, useCache) {
  const file = path.join(rawRoot, "index-lnfscx.html");
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const html = await fetchText(INDEX_URL);
  fs.writeFileSync(file, html);
  return html;
}

async function downloadQuery(rawRoot, year, province, useCache) {
  const relPath = rawPageName(year, province);
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return { relPath, html: fs.readFileSync(file, "utf8") };
  const body = new URLSearchParams({ nf: String(year), ss: province }).toString();
  const html = await fetchText(QUERY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  fs.writeFileSync(file, html);
  return { relPath, html };
}

function tableRows(tableHtml) {
  const rows = [];
  const spans = [];
  for (const rowMatch of String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = [];
    for (let col = 0; col < spans.length; col += 1) {
      if (spans[col]) {
        row[col] = spans[col].text;
        spans[col].remaining -= 1;
        if (spans[col].remaining <= 0) spans[col] = null;
      }
    }
    let col = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
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

function extractAdmissionRows(html) {
  const tables = [];
  for (const match of String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = tableRows(match[0]);
    if (rows.some((row) => row.includes("年份") && row.includes("省市") && row.some((cell) => /专业/.test(cell)))) {
      tables.push(rows);
    }
  }
  return tables.flatMap((rows) => {
    const headerIndex = rows.findIndex((row) => row.includes("年份") && row.includes("省市") && row.some((cell) => /录取最低分|最高分/.test(cell)));
    if (headerIndex < 0) return [];
    return rows.slice(headerIndex + 1).filter((row) => row.length >= 10 && /^\d{4}$/.test(row[0]));
  });
}

function extractTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function normalizeSubject(province, raw, batch, majorName) {
  const text = [raw, batch, majorName].map(clean).join(" ");
  if (SPORTS_PATTERN.test(text)) return "体育类";
  if (/文\/历史|历史|文史|文科/.test(text)) return "历史类";
  if (/理\/物理|物理|理工|理科/.test(text)) return "物理类";
  if (/综合/.test(text) || NEW_GAOKAO_PROVINCES.has(province)) return "综合改革";
  return raw || "官网未列科类";
}

function classifyAdmission(batch, subjectRaw, majorName) {
  const text = [batch, subjectRaw, majorName].map(clean).join(" ");
  if (SPORTS_PATTERN.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (SPECIAL_PATTERN.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "专项/定向/单列等", formalScoreScope: "special-path-only" };
  }
  if (COOP_PATTERN.test(text)) {
    return { admissionType: "特殊收费或合作办学专业", admissionSubtype: "中外合作/合作课程/单列专业", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function dataTypeFor(batch, majorName) {
  const text = [batch, majorName].map(clean).join(" ");
  if (/专科|高职/.test(text)) return "vocational-admission";
  return "major-admission";
}

function scoreMetric(classification, dataType) {
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  if (dataType === "vocational-admission") return "高职专科学校官网录取分";
  return "高考文化分";
}

function provinceOptionsFromIndex(indexHtml) {
  const provinces = new Set();
  for (const match of indexHtml.matchAll(/<li\b[^>]*class="[^"]*ssmcclick[^"]*"[^>]*id="([^"]+)"/gi)) {
    const province = clean(match[1]);
    if (MAINLAND_PROVINCES.includes(province)) provinces.add(province);
  }
  return [...provinces];
}

function parseRecordsForPage({ year, province, html, rawRelPath }) {
  const rows = extractAdmissionRows(html);
  const records = [];
  const skippedRows = [];
  rows.forEach((row, rowIndex) => {
    const sourceYear = integerNumber(row[0]);
    const sourceProvinceRaw = clean(row[1]);
    const batch = clean(row[2]);
    const sourceSubjectRaw = clean(row[3]);
    const majorName = clean(row[4]);
    const planCount = integerNumber(row[5]);
    const admissionCount = integerNumber(row[6]);
    const minScoreRaw = clean(row[7]);
    const avgScoreRaw = clean(row[8]);
    const scoreExtraRaw = clean(row[9]);
    const minScore = firstNumber(minScoreRaw);
    const avgScore = firstNumber(avgScoreRaw);
    if (sourceYear !== year || sourceProvinceRaw !== province) {
      skippedRows.push({ reason: "unexpected-year-or-province", rowIndex, requestedYear: year, requestedProvince: province, cells: row });
      return;
    }
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-major-or-min-score", rowIndex, province, year, cells: row });
      return;
    }
    if (minScore < 0 || minScore > 750) {
      skippedRows.push({ reason: "score-out-of-range", rowIndex, province, year, minScore, cells: row });
      return;
    }
    const dataType = dataTypeFor(batch, majorName);
    const classification = classifyAdmission(batch, sourceSubjectRaw, majorName);
    const subjectType = normalizeSubject(province, sourceSubjectRaw, batch, majorName);
    const record = {
      id: `${year}-hnmu-${dataType.replace(/-.*/, "")}-${stableId([
        year,
        province,
        batch,
        sourceSubjectRaw,
        majorName,
        rowIndex,
        minScoreRaw,
      ])}`,
      province,
      sourceProvinceRaw,
      year,
      subjectType,
      sourceSubjectRaw,
      batch,
      sourceBatchRaw: batch,
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      legacySchoolName: SOURCE.legacySchoolName,
      city: SOURCE.city,
      schoolTags: SOURCE.tags,
      dataType,
      majorName,
      majorGroup: [SOURCE.schoolName, province, subjectType, batch, majorName].filter(Boolean).join("-"),
      admissionType: classification.admissionType,
      admissionSubtype: classification.admissionSubtype,
      formalScoreScope: classification.formalScoreScope,
      minScore,
      scoreMetric: scoreMetric(classification, dataType),
      scoreOnly: true,
      rankUnavailable: true,
      sourceId: SOURCE.id,
      sourceQuality: SOURCE.quality,
      schoolOfficialScope: "single-school-score",
      sourceUrl: QUERY_URL,
      sourcePageUrl: QUERY_URL,
      sourceIndexUrl: INDEX_URL,
      officialEvidencePath: rawRelPath,
      sourceHtmlPath: rawRelPath,
      sourceMinScoreRaw: minScoreRaw,
      sourceAvgScoreRaw: avgScoreRaw,
      sourceScoreExtraRaw: scoreExtraRaw,
      rawRow: {
        source: "hnmu-2023-2025-official-html-post-table",
        rowIndex,
        request: { nf: String(year), ss: province },
        cells: {
          year: row[0],
          province: row[1],
          batch: row[2],
          subjectRaw: row[3],
          majorName: row[4],
          planCount: row[5],
          admissionCount: row[6],
          visibleScore: row[7],
          hiddenScore1: row[8],
          hiddenScore2: row[9],
        },
      },
      cautions: [
        "本记录来自河南医药大学招生信息网官方“历年分数查询”POST 表格，是单校分省分专业录取边界，不是省级教育考试院全量投档/录取分数表。",
        "官网源表没有公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
        "官网 HTML 表头与隐藏列存在错位：第一个分数字段按页面可见录取最低分边界使用，两个隐藏小数字段保留为原始扩展字段，不当作最低分位次。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    };
    if (Number.isFinite(avgScore)) record.avgScore = avgScore;
    if (Number.isFinite(planCount)) record.planCount = planCount;
    if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
    records.push(record);
  });
  return { records, skippedRows, sourceRows: rows.length };
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

  const indexHtml = await downloadIndex(rawRoot, args.useCache);
  const provincesFromIndex = provinceOptionsFromIndex(indexHtml);
  const provinceList = MAINLAND_PROVINCES.filter((province) => provincesFromIndex.includes(province));
  if (provinceList.length !== MAINLAND_PROVINCES.length) {
    throw new Error(`Official page province list mismatch: found ${provinceList.length}, expected ${MAINLAND_PROVINCES.length}`);
  }

  const records = [];
  const skippedRows = [];
  const pageSummaries = [];
  const emptyPages = [];
  for (const year of YEARS) {
    for (const province of provinceList) {
      const { relPath, html } = await downloadQuery(rawRoot, year, province, args.useCache);
      const sourceRelPath = `${RAW_DIR}/${relPath}`;
      const parsed = parseRecordsForPage({ year, province, html, rawRelPath: sourceRelPath });
      records.push(...parsed.records);
      skippedRows.push(...parsed.skippedRows.map((row) => ({ ...row, rawPath: sourceRelPath })));
      const hasNoData = /没有符合条件的数据/.test(stripTags(html));
      if (hasNoData && parsed.records.length === 0) {
        emptyPages.push({ year, province, rawPath: sourceRelPath });
      }
      pageSummaries.push({
        year,
        province,
        rawPath: sourceRelPath,
        htmlTitle: extractTitle(html),
        sourceRows: parsed.sourceRows,
        parsedRecords: parsed.records.length,
        noData: hasNoData,
        sha256: sha256File(resolveProjectPath(sourceRelPath)),
      });
      await sleep(120);
    }
  }

  const dupes = duplicateIds(records);
  if (dupes.length) {
    throw new Error(`Duplicate record ids: ${dupes.slice(0, 5).join(", ")}`);
  }
  const badScores = records.filter((record) => !Number.isFinite(record.minScore) || record.minScore < 0 || record.minScore > 750);
  if (badScores.length) {
    throw new Error(`Bad minScore rows: ${badScores.slice(0, 3).map((record) => record.id).join(", ")}`);
  }

  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingMainlandProvinces = MAINLAND_PROVINCES.filter((province) => !provincesWithRecords.includes(province));
  const sourceNote = {
    id: SOURCE.id,
    title: "河南医药大学招生信息网：2023-2025年全国分省分专业历年分数查询",
    publisher: "河南医药大学招生信息网",
    url: INDEX_URL,
    queryUrl: QUERY_URL,
    quality: SOURCE.quality,
    usage: "从河南医药大学招生信息网官方“历年分数查询”页面读取年份、省市筛选项，并用官方表单 POST 参数 nf/ss 逐年逐省下载 HTML 表格，抽取批次、类别、专业、计划人数、录取人数和页面可见录取最低分。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: provincesWithRecords.length,
    provincesWithRecords,
    missingMainlandProvinces,
    years: YEARS,
    officialPageCount: pageSummaries.length + 1,
    queryPageCount: pageSummaries.length,
    emptyPageCount: emptyPages.length,
    emptyPages,
    sourceRows: pageSummaries.reduce((sum, page) => sum + page.sourceRows, 0),
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
      {
        path: `${RAW_DIR}/index-lnfscx.html`,
        url: INDEX_URL,
        sha256: sha256File(path.join(rawRoot, "index-lnfscx.html")),
      },
      ...pageSummaries.map((page) => ({ path: page.rawPath, url: QUERY_URL, request: { nf: String(page.year), ss: page.province }, sha256: page.sha256 })),
    ],
    cautions: [
      "河南医药大学/原新乡医学院官网单校分数只用于该校候选边界复核，不替代各省教育考试院全量投档/录取分数表。",
      "官网源表未公开最低位次；本包所有记录均标记 rankUnavailable=true，不生成假位次。",
      "官网 HTML 表头与隐藏列存在错位：第一个分数字段按页面可见录取最低分边界使用，隐藏小数字段仅保留为原始字段。",
      "西藏在 2023-2025 查询页返回“没有符合条件的数据”，本包不生成西藏假记录，也不关闭西藏正式省级缺口。",
    ],
  };

  const payload = {
    sourceNotes: [sourceNote],
    skippedRows,
    pageSummaries,
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
    years: YEARS,
    emptyPageCount: emptyPages.length,
    recordTypeCounts: sourceNote.recordTypeCounts,
    formalScoreScopeCounts: sourceNote.formalScoreScopeCounts,
    scoreRange: sourceNote.scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
