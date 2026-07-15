#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2023-2025-v3199-haust-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2023-2025-v3199-haust";
const INDEX_URL = "https://zjc.haust.edu.cn/lnfs.htm";
const CHARTER_URL = "https://zjc.haust.edu.cn/info/1133/32743.htm";
const SOURCE = {
  id: "official-haust-national-2023-2025-school-major-admission",
  quality: "official-school-haust-2023-2025-national-major-html-score-rank",
  schoolCode: "10464",
  schoolName: "河南科技大学",
  city: "洛阳",
  tags: ["综合", "河南", "河南科技大学"],
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
  ["河北省", "河北"],
  ["山西省", "山西"],
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
  ["广西壮族自治区", "广西"],
  ["海南省", "海南"],
  ["重庆市", "重庆"],
  ["四川省", "四川"],
  ["贵州省", "贵州"],
  ["云南省", "云南"],
  ["西藏自治区", "西藏"],
  ["陕西省", "陕西"],
  ["甘肃省", "甘肃"],
  ["青海省", "青海"],
  ["宁夏回族自治区", "宁夏"],
  ["新疆维吾尔自治区", "新疆"],
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2023-2025-v3199-haust.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2023-2025-v3199-haust.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Henan University of Science and Technology official 2023-2025 province major admission pages.",
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

function extractTableBlocks(html) {
  return [...String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => ({
    html: match[0],
    index: match.index,
    rows: tableRows(match[0]),
  }));
}

function normalizeProvince(raw) {
  const text = clean(raw);
  if (PROVINCE_ALIASES.has(text)) return PROVINCE_ALIASES.get(text);
  const simple = text.replace(/市$|省$/g, "");
  return PROVINCE_ALIASES.get(simple) || simple;
}

function rawPageName(pageUrl) {
  const slug = new URL(pageUrl).pathname.split("/").pop()?.replace(/\.htm$/i, "") || stableId([pageUrl]);
  return `haust-2023-2025-${slug}.html`;
}

function discoverProvinceLinks(indexHtml) {
  const links = new Map();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(indexHtml).matchAll(re)) {
    const label = stripTags(match[2]);
    const province = normalizeProvince(label);
    if (!MAINLAND_PROVINCES.has(province)) continue;
    const url = new URL(match[1], INDEX_URL).href;
    if (!url.includes("/info/1143/")) continue;
    if (!links.has(province)) {
      links.set(province, {
        province,
        label,
        url,
        rawPath: path.posix.join(RAW_DIR, rawPageName(url)),
      });
    }
  }
  return [...links.values()].sort((a, b) => a.province.localeCompare(b.province, "zh-Hans-CN"));
}

function nearbyYear(html, tableIndex) {
  const before = stripTags(html.slice(Math.max(0, tableIndex - 1600), tableIndex));
  const matches = [...before.matchAll(/河南科技大学\s*(20\d{2})年[^。]*?录取情\s*况/g)];
  if (matches.length) return Number(matches.at(-1)[1]);
  const loose = [...before.matchAll(/(20\d{2})年[^。]{0,80}录取情\s*况/g)];
  return loose.length ? Number(loose.at(-1)[1]) : null;
}

function headerKey(cell) {
  const text = clean(cell).replace(/\s+/g, "");
  if (text === "省份" || text === "生源省份") return "sourceProvinceRaw";
  if (text === "批次" || text === "录取批次") return "batch";
  if (text === "科类") return "subjectType";
  if (text === "专业" || text === "录取专业" || text === "招生专业") return "majorName";
  if (text === "录取人数") return "admissionCount";
  if (text === "最高分") return "maxScore";
  if (text === "平均分") return "avgScore";
  if (text === "最低分") return "minScore";
  if (text === "最低分位次" || text === "最低分排位") return "minRank";
  if (text === "专业组") return "sourceMajorGroup";
  if (text === "备注") return "remark";
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

function tableLooksLikeAdmission(rows) {
  if (!rows.length) return false;
  const map = headerMap(rows[0]);
  return map.has("batch") && map.has("majorName") && map.has("admissionCount") && map.has("minScore");
}

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function normalizeSubject(raw, batch, majorName, remark) {
  const subject = clean(raw);
  const text = [subject, batch, majorName, remark].map(clean).join(" ");
  if (/艺术|美术|设计|音乐|舞蹈|表演|播音/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/历史/.test(subject)) return "历史类";
  if (/物理/.test(subject)) return "物理类";
  if (/综合改革/.test(subject)) return "综合改革";
  if (/不分文理/.test(subject)) return "不分文理";
  if (/理科综合|理工|理科/.test(subject)) return "理科";
  if (/文科综合|文史|文科/.test(subject)) return "文科";
  return subject || "官网未列科类";
}

function classifyAdmission({ batch, majorName, subjectType, remark }) {
  const text = [batch, majorName, subjectType, remark].map(clean).join(" ");
  if (/艺术|美术|设计|音乐|舞蹈|表演|播音|动画/.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育/.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项|地方专项|高校专项|专项/.test(text)) {
    return { admissionType: "专项计划", admissionSubtype: /国家专项/.test(text) ? "国家专项" : /地方专项/.test(text) ? "地方专项" : "专项计划", formalScoreScope: "special-path-only" };
  }
  if (/少数民族|民族预科|预科|南疆|协作计划|单列|内高班|新疆班|定向/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "民族预科/定向/单列", formalScoreScope: "special-path-only" };
  }
  if (/合作办学|中外合作|较高收费|医护类|农林类/.test(text)) {
    return { admissionType: "特殊收费或单列专业", admissionSubtype: "中外合作/单列专业", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch(batch) {
  const text = clean(batch);
  if (!text) return "官网未列批次";
  if (/艺术/.test(text)) return text;
  if (/体育/.test(text)) return text;
  if (/本科一批/.test(text)) return "本科一批";
  if (/本科二批/.test(text)) return "本科二批";
  if (/本科批|本科普通批|普通本科批/.test(text)) return "本科批";
  if (/提前/.test(text)) return text;
  return text;
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

function getCell(row, map, key) {
  const index = map.get(key);
  return index == null ? "" : clean(row[index]);
}

function makeRecord({ row, header, year, page, ordinal, tableOrdinal }) {
  const map = headerMap(header);
  const batchRaw = getCell(row, map, "batch");
  const subjectRaw = getCell(row, map, "subjectType");
  const majorName = getCell(row, map, "majorName");
  const remark = getCell(row, map, "remark");
  const sourceProvinceRaw = normalizeProvince(getCell(row, map, "sourceProvinceRaw") || page.province);
  const minScoreRaw = getCell(row, map, "minScore");
  const minScore = parseNumber(minScoreRaw);
  if (!majorName || !Number.isFinite(minScore)) return null;

  const subjectType = normalizeSubject(subjectRaw, batchRaw, majorName, remark);
  const classification = classifyAdmission({ batch: batchRaw, majorName, subjectType, remark });
  const minRankRaw = getCell(row, map, "minRank");
  const minRank = parseNumber(minRankRaw);
  const admissionCountRaw = getCell(row, map, "admissionCount");
  const avgScoreRaw = getCell(row, map, "avgScore");
  const maxScoreRaw = getCell(row, map, "maxScore");
  const sourceMajorGroup = getCell(row, map, "sourceMajorGroup");
  const admissionCount = parseNumber(admissionCountRaw);
  const avgScore = parseNumber(avgScoreRaw);
  const maxScore = parseNumber(maxScoreRaw);
  const rankUnavailable = !Number.isFinite(minRank);
  const sourceNumericAnomaly = minScore < 100
    && ((Number.isFinite(avgScore) && avgScore > 100) || (Number.isFinite(maxScore) && maxScore > 100))
    && classification.admissionType !== "艺术类录取"
    && classification.admissionType !== "体育类录取";
  if (sourceNumericAnomaly) {
    return {
      skipped: {
        reason: "official-source-numeric-anomaly",
        province: page.province,
        year,
        sourceUrl: page.url,
        rawPath: page.rawPath,
        headers: header,
        cells: row,
        minScoreRaw,
        avgScoreRaw,
        maxScoreRaw,
        note: "官方 HTML 最低分小于100，但同一行平均分/最高分在100以上；不替官方猜测修正，跳过可计算记录以免污染低分段推荐。",
      },
    };
  }
  const scoreMetric = classification.formalScoreScope === "special-path-only"
    ? "艺术/体育/特殊路径综合分或学校源表计分"
    : "高考文化分";

  const record = {
    id: `${year}-haust-major-${stableId([
      page.province,
      batchRaw,
      subjectRaw,
      majorName,
      sourceMajorGroup,
      minScore,
      minRank ?? "",
      ordinal,
    ])}`,
    province: page.province,
    sourceProvinceRaw,
    year,
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
    majorGroup: sourceMajorGroup || [SOURCE.schoolName, page.province, year, batchRaw, subjectRaw, majorName].filter(Boolean).join("-"),
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
    sourceIndexUrl: INDEX_URL,
    sourceCharterUrl: CHARTER_URL,
    officialEvidencePath: page.rawPath,
    sourceHtmlPath: page.rawPath,
    sourceMinScoreRaw: minScoreRaw,
    sourceAdmissionCountRaw: admissionCountRaw,
    sourceAvgScoreRaw: avgScoreRaw,
    sourceMaxScoreRaw: maxScoreRaw,
    sourceRankRaw: minRankRaw,
    sourceRemark: remark,
    rawRow: {
      source: "haust-2023-2025-province-major-html",
      year,
      tableOrdinal,
      cells: row,
      headers: header,
      province: page.province,
      pageLabel: page.label,
    },
    cautions: [
      "本记录来自河南科技大学招生就业办公室官方历年分数省份页，是单校分省专业录取边界，不是省级教育考试院全量投档/录取分数表。",
      rankUnavailable
        ? "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
        : "本行含学校官网公布的最低分位次，但仍是单校来源；推荐层只能用于河南科技大学候选边界复核。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺术、体育、专项、预科、定向或单列等特殊路径，运行层按 special-path-only 隔离，不与普通批次边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
  if (Number.isFinite(avgScore)) record.avgScore = avgScore;
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(minRank)) record.minRank = minRank;
  return record;
}

function parseProvincePage(html, page) {
  const records = [];
  const skippedRows = [];
  const tableSummaries = [];
  let ordinal = 0;
  const blocks = extractTableBlocks(html);
  for (let tableOrdinal = 0; tableOrdinal < blocks.length; tableOrdinal += 1) {
    const block = blocks[tableOrdinal];
    if (!tableLooksLikeAdmission(block.rows)) continue;
    const year = nearbyYear(html, block.index);
    if (![2023, 2024, 2025].includes(year)) {
      throw new Error(`Could not detect 2023-2025 year for ${page.province} table ${tableOrdinal + 1}`);
    }
    const header = block.rows[0];
    const tableRecords = [];
    for (const row of block.rows.slice(1)) {
      if (row.some((cell) => /最低分|录取人数|录取批次|批次/.test(clean(cell)))) continue;
      const record = makeRecord({ row, header, year, page, ordinal, tableOrdinal });
      if (!record) continue;
      if (record.skipped) {
        skippedRows.push(record.skipped);
        continue;
      }
      tableRecords.push(record);
      records.push(record);
      ordinal += 1;
    }
    tableSummaries.push({
      year,
      tableOrdinal: tableOrdinal + 1,
      headers: header,
      records: tableRecords.length,
      skippedRows: skippedRows.filter((skipped) => skipped.year === year).length,
      recordsWithRank: tableRecords.filter((record) => !record.rankUnavailable).length,
    });
  }
  return { records, tableSummaries, skippedRows };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const indexHtml = await downloadText(rawRoot, "haust-2023-2025-index.html", INDEX_URL, args.useCache);
  const discoveredPages = discoverProvinceLinks(indexHtml);
  if (discoveredPages.length !== 31) throw new Error(`Expected 31 province links, found ${discoveredPages.length}`);

  const charterHtml = await downloadText(rawRoot, "haust-2025-charter.html", CHARTER_URL, args.useCache);
  if (!/河南科技大学2025年全日制普通本科招生章程/.test(extractTitle(charterHtml))) {
    throw new Error(`Unexpected HAUST charter title: ${extractTitle(charterHtml)}`);
  }

  const records = [];
  const skippedRows = [];
  const pageSummaries = [];
  for (const page of discoveredPages) {
    const html = await downloadText(rawRoot, path.basename(page.rawPath), page.url, args.useCache);
    const title = extractTitle(html);
    if (!title.includes(page.label) && !title.includes(page.province)) {
      throw new Error(`Unexpected title for ${page.province}: ${title}`);
    }
    const parsed = parseProvincePage(html, page);
    records.push(...parsed.records);
    skippedRows.push(...parsed.skippedRows);
    pageSummaries.push({
      province: page.province,
      label: page.label,
      url: page.url,
      rawPath: page.rawPath,
      records: parsed.records.length,
      skippedRows: parsed.skippedRows.length,
      recordsWithRank: parsed.records.filter((record) => !record.rankUnavailable).length,
      recordsWithoutRank: parsed.records.filter((record) => record.rankUnavailable).length,
      byYear: countBy(parsed.records, (record) => String(record.year)),
      tableSummaries: parsed.tableSummaries,
    });
  }

  if (records.length < 1800) throw new Error(`Parsed too few HAUST records: ${records.length}`);
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
        title: "河南科技大学招生就业办公室：2023年-2025年全国分省录取情况",
        publisher: "河南科技大学招生就业办公室（大学生就业创业指导中心）",
        url: INDEX_URL,
        charterUrl: CHARTER_URL,
        quality: SOURCE.quality,
        usage: "从河南科技大学招生就业办公室官方历年分数栏目发现31个省份页，抽取2023、2024、2025年分省批次、科类、专业、录取人数、最高分、平均分、最低分、最低分位次和专业组/备注。2024/2023多数源表未列最低分位次，按无位次记录保存；学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
        parsedRecords: records.length,
        provinceCount: provincesWithRecords.length,
        discoveredProvincePages: discoveredPages.length,
        provincesWithRecords,
        missingMainlandProvinces: missingMainland,
        years: [2023, 2024, 2025],
        recordsWithRank,
        recordsWithoutRank,
        skippedOfficialRows: skippedRows.length,
        ordinarySchoolOfficialRecords,
        specialPathRecords,
        byProvince: countBy(records, (record) => record.province),
        byYear: countBy(records, (record) => String(record.year)),
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
          path.posix.join(RAW_DIR, "haust-2023-2025-index.html"),
          ...discoveredPages.map((page) => page.rawPath),
          path.posix.join(RAW_DIR, "haust-2025-charter.html"),
        ],
        cautions: [
          "本导入包来自河南科技大学学校官网单校专业录取数据，不关闭任何省级正式投档表缺口。",
          "2024/2023多数源表未列最低分位次，运行层不生成假位次。",
          "官方 HTML 中若出现最低分明显小于100但均分/最高分在100以上的数值异常行，不猜测修正，跳过可计算记录并保留 skippedRows 审计。",
          "艺术、体育、专项、预科、定向、单列等记录按 special-path-only 隔离，不与普通批次混用。",
          "西藏页含河南科技大学单校录取分，但不是西藏考试院全量录取结果，不能关闭西藏 formalScoreMissingProvinces 缺口。",
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
    skippedOfficialRows: skippedRows.length,
    ordinarySchoolOfficialRecords,
    specialPathRecords,
    byYear: payload.sourceNotes[0].byYear,
    byFormalScoreScope: payload.sourceNotes[0].byFormalScoreScope,
    byAdmissionType: payload.sourceNotes[0].byAdmissionType,
    byAdmissionSubtype: payload.sourceNotes[0].byAdmissionSubtype,
    byDataType: payload.sourceNotes[0].byDataType,
    scoreRange: payload.sourceNotes[0].scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
