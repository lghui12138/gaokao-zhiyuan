#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3195-qust-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3195-qust";
const SITE_BASE = "https://zs.qust.edu.cn";
const LIST_URL = `${SITE_BASE}/query/wnlqfs.htm`;
const DETAIL_INDEX_URL = `${SITE_BASE}/info/1005/4837.htm`;
const SUMMARY_URL = `${SITE_BASE}/info/1005/4803.htm`;
const SOURCE = {
  id: "official-qust-national-2025-school-admission",
  quality: "official-school-qust-2025-national-html-major-score-rank",
  schoolCode: "10426",
  schoolName: "青岛科技大学",
  city: "青岛",
  tags: ["理工"],
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
    `  node scripts/import-official-national-school-admission-2025-v3195-qust.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3195-qust.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Qingdao University of Science and Technology official 2025 province detail HTML major score tables.",
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
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 16);
}

async function fetchText(url, referer = LIST_URL) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      referer,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  if (text.length < 500) throw new Error(`Unexpectedly short HTML (${text.length} chars) for ${url}`);
  return text;
}

async function downloadText(rawRoot, relPath, url, useCache, referer = LIST_URL) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const text = await fetchText(url, referer);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text);
  return text;
}

function absoluteUrl(href, baseUrl) {
  return new URL(href, baseUrl).href;
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
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function attrNumber(attrs, name, fallback = 1) {
  const match = String(attrs ?? "").match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Number(match[1]) : fallback;
}

function extractTitle(html) {
  return stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractProvinceLinks(indexHtml) {
  const links = [];
  const seen = new Set();
  for (const match of String(indexHtml).matchAll(/<a\b([^>]*)href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[2];
    const text = stripTags(match[3]).replace(/[【】〖〗\s]/g, "");
    const province = normalizeProvince(text);
    if (!MAINLAND_PROVINCES.has(province)) continue;
    const url = absoluteUrl(href, DETAIL_INDEX_URL);
    if (!/\/info\/1021\/\d+\.htm$/.test(url)) continue;
    const key = `${province}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ province, sourceProvinceRaw: text, url });
  }
  return links;
}

function extractFirstTable(html, url) {
  const match = String(html).match(/<table\b[\s\S]*?<\/table>/i);
  if (!match) throw new Error(`Could not find first table in ${url}`);
  return match[0];
}

function tableGrid(tableHtml) {
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
      const colspan = attrNumber(attrs, "colspan", 1);
      const rowspan = attrNumber(attrs, "rowspan", 1);
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

function normalizeProvince(raw) {
  const text = clean(raw).replace(/[【】〖〗]/g, "");
  if (PROVINCE_ALIASES.has(text)) return PROVINCE_ALIASES.get(text);
  return text.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
}

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(text) : null;
}

function normalizeSubject(sourceSubjectRaw, province) {
  const text = clean(sourceSubjectRaw);
  if (/艺术|美术|设计|音乐/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/历史|文史|预科班（?文）?|内高文/.test(text)) return "历史类";
  if (/物理|理工|理科|预科班（?理）?|内高理/.test(text)) return "物理类";
  if (/综合改革|综合/.test(text)) return "综合";
  if (province === "山东" && /普通类|地方专项|中外合作/.test(text)) return "综合";
  return "官网未列科类";
}

function classifyAdmission(majorName, sourceSubjectRaw) {
  const text = [majorName, sourceSubjectRaw].map(clean).join(" ");
  if (/艺术|美术|设计|音乐|体育/.test(text)) {
    return { admissionType: "艺术/体育类", admissionSubtype: /体育/.test(text) ? "体育类" : "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项|地方专项/.test(text)) {
    return { admissionType: "专项计划", admissionSubtype: /国家专项/.test(text) ? "国家专项" : "地方专项", formalScoreScope: "special-path-only" };
  }
  if (/预科|内高|单列|南单|定向|协作计划/.test(text)) {
    const subtype = clean(sourceSubjectRaw) || "特殊路径";
    return { admissionType: "特殊类型录取", admissionSubtype: subtype, formalScoreScope: "special-path-only" };
  }
  if (/中外合作|中德|中韩|中美|中法|合作办学/.test(text)) {
    return { admissionType: "中外合作办学", admissionSubtype: "中外合作办学", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function findHeader(rows) {
  const index = rows.findIndex((row) => row.some((cell) => /专业名称/.test(cell)) && row.some((cell) => /最低分/.test(cell)));
  if (index < 0) throw new Error("Could not find table header row");
  const row = rows[index];
  const pos = (pattern) => row.findIndex((cell) => pattern.test(cell));
  const header = {
    index,
    major: pos(/专业名称/),
    subject: pos(/科类|类别|科目组/),
    count: pos(/录取人数/),
    max: pos(/最高分/),
    min: row.findIndex((cell) => /^最低分$/.test(cell)),
    avg: pos(/平均分/),
    rank: pos(/最低分位次/),
  };
  for (const key of ["major", "subject", "count", "max", "min", "avg"]) {
    if (header[key] < 0) throw new Error(`Could not find ${key} column in header: ${JSON.stringify(row)}`);
  }
  return header;
}

function makeMajorRecord(base) {
  const id = `2025-qust-national-school-${stableId([
    base.province,
    base.year,
    base.majorName,
    base.sourceSubjectRaw,
    base.admissionSubtype,
    base.minScore,
    base.minRank ?? "",
    base.sourcePagePath,
    base.ordinal,
  ])}`;
  const record = {
    id,
    province: base.province,
    sourceProvinceRaw: base.sourceProvinceRaw || base.province,
    year: 2025,
    subjectType: base.subjectType,
    sourceSubjectRaw: base.sourceSubjectRaw,
    batch: base.batch || "本科批",
    sourceBatchRaw: base.sourceBatchRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "major-admission",
    majorName: base.majorName,
    majorGroup: [SOURCE.schoolName, base.province, base.subjectType, base.admissionSubtype, base.majorName].filter(Boolean).join("-"),
    admissionType: base.admissionType,
    admissionSubtype: base.admissionSubtype,
    formalScoreScope: base.formalScoreScope,
    minScore: base.minScore,
    scoreOnly: base.scoreOnly,
    rankUnavailable: base.rankUnavailable,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: base.rankUnavailable ? "single-school-major-score" : "single-school-major-score-rank",
    sourceUrl: base.sourceUrl,
    sourcePageUrl: base.sourceUrl,
    sourceListUrl: LIST_URL,
    sourceDetailIndexUrl: DETAIL_INDEX_URL,
    sourceSummaryUrl: SUMMARY_URL,
    officialEvidencePath: base.sourcePagePath,
    sourceHtmlPath: base.sourcePagePath,
    sourceDetailIndexPath: path.posix.join(RAW_DIR, "qust-2025-detail-index.html"),
    sourceSummaryPath: path.posix.join(RAW_DIR, "qust-2025-province-summary.html"),
    sourceMinScoreRaw: String(base.minScore),
    rawRow: base.rawRow,
    cautions: base.cautions,
  };
  if (Number.isFinite(base.admitCount)) {
    record.admitCount = base.admitCount;
    record.sourceAdmitCountRaw = String(base.admitCount);
  }
  if (Number.isFinite(base.maxScore)) {
    record.maxScore = base.maxScore;
    record.sourceMaxScoreRaw = String(base.maxScore);
  }
  if (Number.isFinite(base.avgScore)) {
    record.avgScore = base.avgScore;
    record.sourceAvgScoreRaw = String(base.avgScore);
  }
  if (Number.isFinite(base.minRank)) {
    record.minRank = base.minRank;
    record.sourceRankRaw = String(base.minRank);
  }
  return record;
}

function parseProvincePage({ html, provinceLink, rawPath }) {
  const title = extractTitle(html);
  const table = extractFirstTable(html, provinceLink.url);
  const rows = tableGrid(table);
  const header = findHeader(rows);
  const records = [];
  const warnings = [];
  let ordinal = 0;
  for (const row of rows.slice(header.index + 1)) {
    const majorName = clean(row[header.major]);
    if (!majorName || /^注[:：]|^注$|总计|专业名称/.test(majorName)) continue;
    const sourceSubjectRaw = clean(row[header.subject] || "官网未列类别");
    const admitCount = parseNumber(row[header.count]);
    const maxScore = parseNumber(row[header.max]);
    const minScore = parseNumber(row[header.min]);
    const avgScore = parseNumber(row[header.avg]);
    const minRank = header.rank >= 0 ? parseNumber(row[header.rank]) : null;
    if (!Number.isFinite(minScore)) {
      warnings.push(`skip no min score ${provinceLink.province}: ${row.join(" | ")}`);
      continue;
    }
    const subjectType = normalizeSubject(sourceSubjectRaw, provinceLink.province);
    const classification = classifyAdmission(majorName, sourceSubjectRaw);
    const rankUnavailable = !Number.isFinite(minRank);
    const cautions = [
      "本记录来自青岛科技大学本科招生信息网官方2025年各省市详细录取情况统计HTML表，是单校分省/专业录取边界，不是省级教育考试院全量投档/录取分数表。",
      rankUnavailable
        ? "源网页本行未公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
        : "本行含学校官网公布的最低位次，但仍是单校来源；推荐层可用于青岛科技大学候选边界复核，不得替代省级正式投档表和当年计划约束。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于专项、预科、内高班、单列、艺术体育等特殊路径之一，运行层按 special-path-only 隔离，不与普通批次边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于青岛科技大学候选边界复核，但不得替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ];
    records.push(makeMajorRecord({
      province: provinceLink.province,
      sourceProvinceRaw: provinceLink.sourceProvinceRaw,
      sourceSubjectRaw,
      sourceBatchRaw: title || "2025年各省市详细录取情况统计",
      majorName,
      ...classification,
      subjectType,
      minScore,
      maxScore,
      avgScore,
      admitCount,
      minRank,
      scoreOnly: rankUnavailable,
      rankUnavailable,
      sourceUrl: provinceLink.url,
      sourcePagePath: rawPath,
      ordinal,
      rawRow: {
        source: "qust-province-detail-html",
        title,
        cells: row,
        province: provinceLink.sourceProvinceRaw,
        majorName,
        sourceSubjectRaw,
        admitCount,
        maxScore,
        minScore,
        avgScore,
        minRank,
      },
      cautions,
    }));
    ordinal += 1;
  }
  return { records, warnings, title, rows: rows.length };
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

  const listHtml = await downloadText(rawRoot, "qust-score-list.html", LIST_URL, args.useCache);
  const detailIndexHtml = await downloadText(rawRoot, "qust-2025-detail-index.html", DETAIL_INDEX_URL, args.useCache);
  const summaryHtml = await downloadText(rawRoot, "qust-2025-province-summary.html", SUMMARY_URL, args.useCache);
  if (!/2025年各省市详细录取情况统计/.test(listHtml) || !/2025年各省市录取情况一览表/.test(listHtml)) {
    throw new Error("QUST score list did not contain expected 2025 source links");
  }
  if (!/2025年各省市详细录取情况统计/.test(detailIndexHtml)) {
    throw new Error("QUST detail index did not contain the expected 2025 detail title");
  }
  if (!/2025年各省市招生录取情况统计表/.test(summaryHtml)) {
    throw new Error("QUST summary page did not contain the expected 2025 summary table title");
  }

  const provinceLinks = extractProvinceLinks(detailIndexHtml);
  if (provinceLinks.length !== 30) {
    throw new Error(`Expected 30 QUST 2025 province detail links, found ${provinceLinks.length}`);
  }
  const duplicateProvince = Object.entries(countBy(provinceLinks, (link) => link.province)).filter(([, count]) => count !== 1);
  if (duplicateProvince.length) throw new Error(`Duplicate province links: ${JSON.stringify(duplicateProvince)}`);

  const records = [];
  const warnings = [];
  const pageSummaries = [];
  for (const link of provinceLinks) {
    const id = link.url.match(/\/(\d+)\.htm$/)?.[1] || stableId([link.url]);
    const rawRel = path.posix.join("detail", `qust-2025-${link.province}-${id}.html`);
    const html = await downloadText(rawRoot, rawRel, link.url, args.useCache, DETAIL_INDEX_URL);
    const parsed = parseProvincePage({
      html,
      provinceLink: link,
      rawPath: path.posix.join(RAW_DIR, rawRel),
    });
    records.push(...parsed.records);
    warnings.push(...parsed.warnings);
    pageSummaries.push({
      province: link.province,
      sourceProvinceRaw: link.sourceProvinceRaw,
      url: link.url,
      title: parsed.title,
      rawPath: path.posix.join(RAW_DIR, rawRel),
      tableRows: parsed.rows,
      records: parsed.records.length,
      recordsWithRank: parsed.records.filter((record) => !record.rankUnavailable).length,
      recordsWithoutRank: parsed.records.filter((record) => record.rankUnavailable).length,
    });
  }

  if (records.length < 500) throw new Error(`Parsed too few QUST records: ${records.length}`);
  if (warnings.length) {
    const severe = warnings.filter((warning) => !/skip no min score/.test(warning));
    if (severe.length) throw new Error(`Unexpected parse warnings: ${severe.slice(0, 5).join(" | ")}`);
  }

  const provinces = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingMainland = [...MAINLAND_PROVINCES].filter((province) => !provinces.includes(province)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const recordsWithRank = records.filter((record) => !record.rankUnavailable).length;
  const recordsWithoutRank = records.length - recordsWithRank;
  const ordinarySchoolOfficialRecords = records.filter((record) => record.formalScoreScope === "school-official-only").length;
  const specialPathRecords = records.filter((record) => record.formalScoreScope === "special-path-only").length;
  const payload = {
    sourceNotes: [
      {
        id: SOURCE.id,
        title: "青岛科技大学本科招生信息网：2025年各省市详细录取情况统计",
        publisher: "青岛科技大学本科招生信息网",
        url: DETAIL_INDEX_URL,
        listUrl: LIST_URL,
        summaryUrl: SUMMARY_URL,
        quality: SOURCE.quality,
        usage: "抽取青岛科技大学本科招生信息网官方2025年各省市详细录取情况统计HTML表。按各省入口解析专业名称、科类/类别、录取人数、最高分、最低分、平均分和最低分位次；新疆等源表未公开位次的记录保留分数但不生成假位次；专项、预科、内高班、单列等特殊路径按 special-path-only 隔离。",
        parsedRecords: records.length,
        provinceCount: provinces.length,
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
        byDataType: countBy(records, (record) => record.dataType),
        scoreRange: scoreRange(records),
        pageSummaries,
        rawPaths: [
          path.posix.join(RAW_DIR, "qust-score-list.html"),
          path.posix.join(RAW_DIR, "qust-2025-detail-index.html"),
          path.posix.join(RAW_DIR, "qust-2025-province-summary.html"),
          path.posix.join(RAW_DIR, "detail"),
        ],
        cautions: [
          "本导入包来自青岛科技大学学校官网单校数据，不关闭任何省级正式投档表缺口。",
          "学校官网位次可用于单校候选边界复核；正式预测仍必须结合省级投档表、一分一段、当年计划、选科限制和招生章程。",
          "专项、预科、内高班、单列等特殊路径记录按 special-path-only 保存，不参与普通批次混合边界。",
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
    provinces: provinces.length,
    missingMainlandProvinces: missingMainland,
    recordsWithRank,
    recordsWithoutRank,
    ordinarySchoolOfficialRecords,
    specialPathRecords,
    byProvince: payload.sourceNotes[0].byProvince,
    byFormalScoreScope: payload.sourceNotes[0].byFormalScoreScope,
    scoreRange: payload.sourceNotes[0].scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
