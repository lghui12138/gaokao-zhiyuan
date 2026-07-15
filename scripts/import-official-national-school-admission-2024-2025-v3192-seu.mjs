#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2024-2025-v3192-seu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2024-2025-v3192-seu";
const SITE_BASE = "https://zsb.seu.edu.cn";
const MAIN_URL = `${SITE_BASE}/main.htm`;
const SCORE_LIST_URL = `${SITE_BASE}/23657/listm.htm`;
const SOURCE = {
  id: "official-seu-national-2024-2025-school-admission",
  quality: "official-school-seu-2024-2025-national-html-major-score-subject-unspecified",
  schoolCode: "10286",
  schoolName: "东南大学",
  city: "南京",
  tags: ["综合", "985", "211", "双一流"],
};

const PROVINCE_SLUGS = [
  "bjs",
  "tjs",
  "hbs",
  "sds",
  "hns_23731",
  "gds",
  "gxzzzzq",
  "gzs",
  "hns_23719",
  "jxs",
  "fjs",
  "zjs",
  "shs",
  "jss",
  "ahs",
  "hns_24129",
  "sxs_23726",
  "nmgzzq",
  "lns",
  "jls",
  "hljs",
  "qhs",
  "scs",
  "zqs",
  "sxs",
  "gss",
  "nxhzzzq",
  "xjwwezzq",
  "xzzzq",
  "yns",
  "hbs_23718",
];

const COMPREHENSIVE_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const PROVINCE_RE = /(北京市|天津市|河北省|山西省|内蒙古自治区|辽宁省|吉林省|黑龙江省|上海市|江苏省|浙江省|安徽省|福建省|江西省|山东省|河南省|湖北省|湖南省|广东省|广西壮族自治区|海南省|重庆市|四川省|贵州省|云南省|西藏自治区|陕西省|甘肃省|青海省|宁夏回族自治区|新疆维吾尔自治区)/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2024-2025-v3192-seu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2024-2025-v3192-seu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
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
    if (arg === "--use-cache") {
      args.useCache = true;
      continue;
    }
    if (arg === "--out") {
      args.out = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return args;
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

function absoluteUrl(href, base = SITE_BASE) {
  return new URL(href, base).href;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
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
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function cleanText(value) {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, "；")
    .replace(/<\/br>/gi, "；")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text || text === "-" || text === "—" || text === "/") return null;
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeProvince(raw) {
  const text = cleanText(raw);
  return text.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
}

function provinceFromTitle(title) {
  const match = cleanText(title).match(PROVINCE_RE);
  return match ? normalizeProvince(match[1]) : "";
}

function yearFromTitle(title) {
  const match = cleanText(title).match(/(20\d{2})年/);
  return match ? Number(match[1]) : null;
}

function subjectForProvince(province) {
  if (COMPREHENSIVE_PROVINCES.has(province)) return "综合";
  return "官网未列科类";
}

function extractScoreLinksFromList(html) {
  const links = [];
  const re = /<a\s+href='([^']+)'[^>]*title='([^']+)'/g;
  for (const match of html.matchAll(re)) {
    const title = cleanText(match[2]);
    if (!/(2024|2025)年.*各专业分数线/.test(title)) continue;
    const year = yearFromTitle(title);
    const province = provinceFromTitle(title);
    if (!year || !province) continue;
    links.push({
      title,
      year,
      province,
      href: absoluteUrl(match[1]),
    });
  }
  return links;
}

function extractRowsFromScorePage(html) {
  const rows = [];
  for (const trMatch of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const tr = trMatch[0];
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanText(m[1]));
    if (cells.length < 3) continue;
    if (/专业/.test(cells[0]) && /最高/.test(cells[1]) && /最低/.test(cells[2])) continue;
    const majorName = cells[0];
    const maxScore = parseNumber(cells[1]);
    const minScore = parseNumber(cells[2]);
    if (!majorName || !Number.isFinite(minScore)) continue;
    rows.push({
      majorName,
      maxScore: Number.isFinite(maxScore) ? maxScore : null,
      minScore,
      rawCells: cells,
    });
  }
  return rows;
}

function makeRecord({ row, source, rawPath, index }) {
  const subjectType = subjectForProvince(source.province);
  const id = `${source.year}-seu-national-school-${stableId([
    source.year,
    source.province,
    subjectType,
    row.majorName,
    row.minScore,
    row.maxScore ?? "",
    index,
  ])}`;
  const record = {
    id,
    province: source.province,
    sourceProvinceRaw: source.provinceRaw,
    year: source.year,
    subjectType,
    sourceSubjectRaw: COMPREHENSIVE_PROVINCES.has(source.province) ? "综合改革省份页面未分专业组" : "官方页面未列科类/选科",
    batch: "本科批",
    sourceBatchRaw: "各专业分数线",
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "major-admission",
    majorName: row.majorName,
    majorGroup: [SOURCE.schoolName, source.province, subjectType, row.majorName].join("-"),
    admissionType: "普通录取",
    admissionSubtype: "各专业分数线",
    formalScoreScope: "school-official-only",
    minScore: row.minScore,
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-major-score",
    sourceUrl: source.href,
    sourcePageUrl: source.href,
    sourceListUrl: source.listUrl,
    sourceMainUrl: MAIN_URL,
    officialEvidencePath: rawPath,
    sourcePagePath: rawPath,
    sourceMinScoreRaw: String(row.minScore),
    rawRow: row,
    cautions: [
      "本记录来自东南大学本科招生网官方省级栏目各专业分数线页面，是单校分省/专业录取边界，不是省级教育考试院全量投档/录取分数表。",
      "源页面未公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      COMPREHENSIVE_PROVINCES.has(source.province)
        ? "该省份为综合改革省份，页面未进一步列出院校专业组；本行仅按官方页面原样保留。"
        : "源页面未列科类/首选科目/选科组，运行层按 subjectType=官网未列科类 隔离，不与同省精确科类记录混用。",
      "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于东南大学候选边界复核，但不得替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  if (Number.isFinite(row.maxScore)) {
    record.maxScore = row.maxScore;
    record.sourceMaxScoreRaw = String(row.maxScore);
  }
  return record;
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || "";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

async function main() {
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const rawPaths = [];
  const records = [];
  const warnings = [];
  const pageSummaries = [];

  await downloadText(rawRoot, "seu-main.html", MAIN_URL, args.useCache);
  await downloadText(rawRoot, "seu-score-listm.html", SCORE_LIST_URL, args.useCache);
  rawPaths.push(path.posix.join(RAW_DIR, "seu-main.html"), path.posix.join(RAW_DIR, "seu-score-listm.html"));

  const sourceLinks = [];
  for (const slug of PROVINCE_SLUGS) {
    const listUrl = `${SITE_BASE}/${slug}/list.htm`;
    const rel = `province-lists/${slug}.html`;
    const html = await downloadText(rawRoot, rel, listUrl, args.useCache);
    rawPaths.push(path.posix.join(RAW_DIR, rel));
    sourceLinks.push(...extractScoreLinksFromList(html).map((item) => ({
      ...item,
      provinceRaw: item.province,
      listUrl,
      listSlug: slug,
    })));
  }

  const seenLinks = new Map();
  for (const item of sourceLinks) {
    seenLinks.set(`${item.year}|${item.province}|${item.href}`, item);
  }
  const uniqueLinks = [...seenLinks.values()].sort((a, b) =>
    a.province.localeCompare(b.province, "zh-Hans-CN") || b.year - a.year
  );

  for (const item of uniqueLinks) {
    const slug = item.listSlug;
    const rel = `score-pages/${item.year}-${slug}.html`;
    const html = await downloadText(rawRoot, rel, item.href, args.useCache);
    rawPaths.push(path.posix.join(RAW_DIR, rel));
    const rows = extractRowsFromScorePage(html);
    pageSummaries.push({
      province: item.province,
      year: item.year,
      title: item.title,
      url: item.href,
      rows: rows.length,
    });
    if (!rows.length) {
      warnings.push(`No score rows parsed for ${item.title} ${item.href}`);
      continue;
    }
    for (const [index, row] of rows.entries()) {
      records.push(makeRecord({
        row,
        source: item,
        rawPath: path.posix.join(RAW_DIR, rel),
        index,
      }));
    }
  }

  const uniqueIds = new Set(records.map((record) => record.id));
  if (uniqueIds.size !== records.length) {
    throw new Error(`Duplicate record ids: ${records.length - uniqueIds.size}`);
  }

  const scoreValues = records.map((record) => Number(record.minScore)).filter(Number.isFinite);
  const shaList = rawPaths.map((rel) => {
    const abs = resolveProjectPath(rel);
    return { path: rel, sha256: sha256(fs.readFileSync(abs)) };
  });
  const sourceNotes = [{
    id: SOURCE.id,
    title: "东南大学本科招生网：2024-2025 年全国各省各专业分数线",
    publisher: "东南大学招生办公室",
    url: SCORE_LIST_URL,
    mainUrl: MAIN_URL,
    quality: SOURCE.quality,
    usage: "抽取东南大学本科招生网官方省级栏目中的2024、2025年各专业分数线 HTML 表。该源覆盖31个省级栏目和两年专业最高/最低分；页面未列科类/选科时按 subjectType=官网未列科类 隔离，综合改革省份按综合口径保留。",
    parsedRecords: records.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    years: [...new Set(records.map((record) => record.year).filter(Boolean))].sort((a, b) => a - b),
    queryCount: uniqueLinks.length,
    recordsWithRank: 0,
    recordsWithoutRank: records.length,
    ordinarySchoolOfficialRecords: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRecords: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    byYear: countBy(records, (record) => record.year),
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byDataType: countBy(records, (record) => record.dataType),
    scoreRange: { min: Math.min(...scoreValues), max: Math.max(...scoreValues) },
    pageSummaries,
    rawPaths,
    sha256: shaList,
    warnings,
    transcriptionMethod: "official-html-table",
    cautions: [
      "本源为东南大学官方单校专业分数页面，不是任何省级教育考试院全量投档/录取分数表。",
      "源页面未公开最低位次；运行层不生成假位次。",
      "多数非综合改革省份页面未列科类/选科组，运行层按 subjectType=官网未列科类 隔离，不与同省同科类精确表混用。",
      "普通学校官网单校行按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  }];

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes, records }, null, 2)}\n`);
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    sourceNotes: sourceNotes.length,
    records: records.length,
    provinceCount: sourceNotes[0].provinceCount,
    years: sourceNotes[0].years,
    queryCount: sourceNotes[0].queryCount,
    bySubjectType: sourceNotes[0].bySubjectType,
    scoreRange: sourceNotes[0].scoreRange,
    warnings,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
