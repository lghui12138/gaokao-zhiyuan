#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2017;
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2017-v3222-sqnu-henan-images-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2017-v3222-sqnu-henan-images";
const BASE_URL = "https://zhaoban.sqnu.edu.cn";
const INDEX_URL = `${BASE_URL}/lqfs/5.htm`;
const EXPECTED_UPGRADE_IMAGE_SHA256 = "413888c0db0807f39c8e900d48b87621ec490cefa3a4e1f140b0c4510e6ef955";

const PAGES = [
  {
    key: "henan-upgrade-image-2017",
    title: "2017商丘师范学院年专升本录取最低分",
    url: `${BASE_URL}/info/1005/1541.htm`,
    rawBase: "2017-henan-upgrade-deferred",
    parser: "upgradeImage",
  },
  {
    key: "major-min-score-2014-2016-image-deferred",
    title: "2014-2016年各专业录取最低分",
    url: `${BASE_URL}/info/1005/1522.htm`,
    rawBase: "2014-2016-major-min-score-deferred",
    parser: "deferredMultiyearImage",
  },
];

const SOURCE = {
  id: "official-sqnu-national-2017-school-henan-upgrade-image-admission",
  quality: "official-school-sqnu-2017-henan-image-score",
  schoolCode: "10483",
  schoolName: "商丘师范学院",
  city: "商丘",
  tags: ["师范", "河南", "商丘", "商丘师范学院"],
};

const UPGRADE_ROWS = [
  [1, "经济学", "147.073074"],
  [2, "国际经济与贸易", "153.098055"],
  [3, "法学", "127.058069"],
  [4, "思想政治教育（师范）", "127.070057"],
  [5, "教育学（师范）", "106.049057"],
  [6, "学前教育（师范）", "130.057073"],
  [7, "小学教育（师范）", "130.05008"],
  [8, "数学与应用数学（师范）", "167.072095"],
  [9, "化学（师范）", "174.091083"],
  [10, "生物科学（师范）", "148.069079"],
  [11, "生物技术", "142.064078"],
  [12, "应用心理学（师范）", "131.06107"],
  [13, "地理科学（师范）", "82.044038"],
  [14, "电气工程及其自动化", "113.074039"],
  [15, "电子信息工程", "142.039103"],
  [16, "自动化", "147.043104"],
  [17, "通信工程", "85.051034"],
  [18, "计算机科学与技术（师范）", "126.064062"],
  [19, "物联网工程", "102.03207"],
  [20, "土木工程", "155.066089"],
  [21, "城乡规划", "168.069099"],
  [22, "测绘工程", "122.039083"],
  [23, "应用化学", "143.042101"],
  [24, "化学工程与工艺", "145.034111"],
  [25, "建筑学", "138.070068"],
  [26, "生物工程", "159.032127"],
  [27, "园林", "113.056057"],
  [28, "动物科学", "80.036044"],
  [29, "信息管理与信息系统", "121.049072"],
  [30, "市场营销", "131.049082"],
  [31, "物流管理", "152.091061"],
  [32, "财务管理", "139.074065"],
  [33, "统计学", "103.030073"],
  [34, "文化产业管理", "127.043084"],
  [35, "电子商务", "108.037071"],
  [36, "汉语言文学（师范）", "191.085106"],
  [37, "汉语国际教育（师范）", "183.068115"],
  [38, "日语（师范）", "165.07509"],
  [39, "广播电视学", "180.075105"],
  [40, "广播电视编导", "153.041112"],
  [41, "播音与主持艺术", "147.048099"],
  [42, "英语（师范）", "210.106104"],
  [43, "体育教育（师范）", "123.031092"],
  [44, "社会体育指导与管理", "132.039093"],
  [45, "音乐表演", "171.047124"],
  [46, "音乐学（师范）", "172.046126"],
  [47, "舞蹈编导", "148.027121"],
  [48, "美术学（师范）", "155.047108"],
  [49, "绘画", "128.031097"],
  [50, "雕塑", "146.031115"],
  [51, "摄影", "115.022093"],
  [52, "视觉传达设计", "163.052111"],
  [53, "环境设计", "159.02913"],
  [54, "动画", "153.018135"],
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2017-v3222-sqnu-henan-images.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2017-v3222-sqnu-henan-images.mjs --use-cache",
    "",
    "Imports the official SQNU 2017 Henan upgrade image table and preserves 2014-2016 multiyear images as raw evidence.",
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
    throw new Error("Refusing to run image ingestion from /Volumes/mac_2T; run this importer from the internal APFS project copy.");
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

async function fetchBuffer(url, referer = INDEX_URL, accept = "text/html,application/xhtml+xml,application/xml,*/*;q=0.8") {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept,
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer,
        },
      });
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${buffer.toString("utf8", 0, 200)}`);
      if (buffer.length < 1000) throw new Error(`Unexpectedly short source (${buffer.length} bytes) for ${url}`);
      return { buffer, contentType: res.headers.get("content-type") || "" };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function downloadHtml(page, rawRoot, useCache) {
  const htmlRel = `${page.rawBase}.html`;
  const htmlPath = path.join(rawRoot, htmlRel);
  if (useCache && fs.existsSync(htmlPath)) return { htmlRel, htmlPath, html: fs.readFileSync(htmlPath, "utf8") };
  const { buffer } = await fetchBuffer(page.url, INDEX_URL);
  const html = buffer.toString("utf8").replace(/\0/g, "");
  if (!html.includes(page.title)) {
    throw new Error(`Official page title token not found for ${page.url}: ${page.title}`);
  }
  fs.writeFileSync(htmlPath, html);
  return { htmlRel, htmlPath, html };
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
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
    .replace(/[\u200b\ufeff]/g, "")
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

function extractOfficialTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractPublishedAt(html) {
  const plain = stripTags(html);
  return plain.match(/(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}/)?.[1] || "";
}

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "").replace(/\s+/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function extractLocalImageUrls(html, pageUrl) {
  const urls = [];
  for (const match of String(html).matchAll(/(?:href|src)=["']([^"']+\.(?:png|jpg|jpeg))(?:\?[^"']*)?["']/gi)) {
    const url = new URL(match[1], pageUrl).href;
    if (!url.includes("/__local/")) continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

function imageFileName(index, page) {
  const ext = page.parser === "upgradeImage" ? "png" : "jpg";
  return `${String(index + 1).padStart(2, "0")}-${page.rawBase}.${ext}`;
}

async function downloadImages(page, html, rawRoot, useCache, imageIndexOffset) {
  const imageUrls = extractLocalImageUrls(html, page.url);
  const imageFiles = [];
  for (let i = 0; i < imageUrls.length; i += 1) {
    const url = imageUrls[i];
    const fileName = imageFileName(imageIndexOffset + i, page);
    const imagePath = path.join(rawRoot, fileName);
    let contentType = "";
    if (!(useCache && fs.existsSync(imagePath))) {
      const fetched = await fetchBuffer(url, page.url, "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
      contentType = fetched.contentType;
      fs.writeFileSync(imagePath, fetched.buffer);
    }
    imageFiles.push({
      path: `${RAW_DIR}/${fileName}`,
      url,
      contentType,
      sha256: sha256File(imagePath),
      bytes: fs.statSync(imagePath).size,
    });
  }
  return imageFiles;
}

function validateUpgradeRows() {
  if (UPGRADE_ROWS.length !== 54) throw new Error(`Expected 54 upgrade rows, got ${UPGRADE_ROWS.length}`);
  UPGRADE_ROWS.forEach(([serial, majorName, scoreRaw], index) => {
    if (serial !== index + 1) throw new Error(`Unexpected serial at index ${index}: ${serial}`);
    if (!majorName) throw new Error(`Missing major at serial ${serial}`);
    const score = parseNumber(scoreRaw);
    if (!Number.isFinite(score)) throw new Error(`Invalid score at serial ${serial}: ${scoreRaw}`);
  });
}

function makeUpgradeRecord({ page, rawHtmlRel, rawImageRel, rowIndex, serial, majorName, minScoreRaw }) {
  const minScore = parseNumber(minScoreRaw);
  const majorGroup = [SOURCE.schoolName, "河南", "专升本", "专升本批", majorName].filter(Boolean).join("-");
  return {
    id: `${YEAR}-sqnu-major-${stableId([page.key, "专升本", majorName, minScoreRaw, serial])}`,
    province: "河南",
    sourceProvinceRaw: "河南",
    year: YEAR,
    subjectType: "专升本",
    sourceSubjectRaw: "专升本",
    batch: "专升本批",
    sourceBatchRaw: "专升本",
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "major-admission",
    majorName,
    majorGroup,
    admissionType: "特殊类型录取",
    admissionSubtype: "专升本",
    formalScoreScope: "special-path-only",
    minScore,
    scoreMetric: "特殊路径学校源表计分",
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-score",
    sourceUrl: page.url,
    sourcePageUrl: page.url,
    sourceIndexUrl: INDEX_URL,
    officialEvidencePath: rawImageRel,
    sourceHtmlPath: rawHtmlRel,
    sourceImagePath: rawImageRel,
    sourcePageKey: page.key,
    sourcePageTitle: page.title,
    sourceMinScoreRaw: minScoreRaw,
    sourceScoreDetailRaw: "小数点后为英语、综合分（最后一位是0的不显示）",
    candidateCategory: "专升本",
    sourceExtractionMethod: "official-image-table-transcription-vision-checked",
    rawRow: {
      source: "sqnu-2017-official-image-table-v3222",
      pageKey: page.key,
      rowIndex,
      cells: [String(serial), majorName, minScoreRaw],
      imagePath: rawImageRel,
    },
    cautions: [
      `本记录来自商丘师范学院招生信息网官方 ${YEAR} 年河南专升本录取最低分图片表，是单校特殊路径录取边界，不是省级教育考试院全量投档/录取分数表。`,
      "源图未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出普通高考录取概率。",
      "本行属于专升本特殊路径，运行层按 special-path-only 隔离，不与普通批文化分边界混用。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业限制、考试类别和特殊路径规则复核。",
    ],
  };
}

function countBy(records, key) {
  return records.reduce((acc, record) => {
    const value = record[key] ?? "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function uniqueSorted(records, key) {
  return [...new Set(records.map((record) => record[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN"));
}

function rangeOf(records, key) {
  const values = records.map((record) => record[key]).filter(Number.isFinite).sort((a, b) => a - b);
  return values.length ? { min: values[0], max: values[values.length - 1] } : null;
}

async function main() {
  guardProjectRoot();
  validateUpgradeRows();
  const args = parseArgs(process.argv);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const records = [];
  const skippedRows = [];
  const pageSummaries = [];
  const rawFiles = [];
  let imageIndexOffset = 0;

  for (const page of PAGES) {
    const { html, htmlRel, htmlPath } = await downloadHtml(page, rawRoot, args.useCache);
    const rawHtmlRel = `${RAW_DIR}/${htmlRel}`;
    const imageFiles = await downloadImages(page, html, rawRoot, args.useCache, imageIndexOffset);
    imageIndexOffset += imageFiles.length;
    const sha256Html = sha256File(htmlPath);
    rawFiles.push({ path: rawHtmlRel, url: page.url, sha256: sha256Html });
    rawFiles.push(...imageFiles.map((file) => ({ path: file.path, url: file.url, sha256: file.sha256 })));

    if (page.parser === "upgradeImage") {
      if (imageFiles.length !== 1) throw new Error(`Expected one official upgrade image, got ${imageFiles.length}`);
      if (imageFiles[0].sha256 !== EXPECTED_UPGRADE_IMAGE_SHA256) {
        throw new Error(`Upgrade image hash changed: ${imageFiles[0].sha256}`);
      }
      records.push(...UPGRADE_ROWS.map(([serial, majorName, minScoreRaw], index) => makeUpgradeRecord({
        page,
        rawHtmlRel,
        rawImageRel: imageFiles[0].path,
        rowIndex: index + 1,
        serial,
        majorName,
        minScoreRaw,
      })));
    } else {
      skippedRows.push({
        reason: "deferred-multiyear-image-table-needs-year-column-splitting",
        page: page.key,
        imageCount: imageFiles.length,
        note: "页面正文为 2014-2016 多年度多栏图片表；本轮只缓存官方图片证据，不把不同年份、科类和专业列混为单年记录。",
      });
    }

    pageSummaries.push({
      key: page.key,
      title: page.title,
      officialTitle: extractOfficialTitle(html),
      publishedAt: extractPublishedAt(html),
      url: page.url,
      rawHtmlPath: rawHtmlRel,
      imageFiles,
      parsedRecords: page.parser === "upgradeImage" ? UPGRADE_ROWS.length : 0,
      skippedRows: page.parser === "upgradeImage" ? 0 : 1,
      sha256Html,
    });
  }

  const duplicateIds = records.map((record) => record.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate record IDs: ${[...new Set(duplicateIds)].slice(0, 5).join(", ")}`);
  }

  const scoreRange = rangeOf(records, "minScore");
  if (!scoreRange || scoreRange.min !== 80.036044 || scoreRange.max !== 210.106104) {
    throw new Error(`Unexpected upgrade score range: ${JSON.stringify(scoreRange)}`);
  }

  const sourceNote = {
    id: SOURCE.id,
    title: "商丘师范学院招生信息网：2017年河南专升本录取最低分官方图片表",
    publisher: "商丘师范学院招生信息网",
    publishedAt: pageSummaries.find((page) => page.key === "henan-upgrade-image-2017")?.publishedAt || "2018-03-06",
    url: `${BASE_URL}/info/1005/1541.htm`,
    quality: SOURCE.quality,
    usage: "从商丘师范学院招生信息网官方“2017商丘师范学院年专升本录取最低分”页面下载 HTML 与正文图片，结构化图片表 54 条河南专升本单校分专业最低分。同步缓存 2014-2016 各专业最低分 4 张官方多年度图片，但因需拆分年份、科类和多栏专业，本轮只保留 raw 证据，不混入运行层。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    provincesWithRecords: uniqueSorted(records, "province"),
    pageSummaries,
    rawDir: RAW_DIR,
    rawFiles,
    recordTypeCounts: countBy(records, "dataType"),
    formalScoreScopeCounts: countBy(records, "formalScoreScope"),
    admissionTypeCounts: countBy(records, "admissionType"),
    admissionSubtypeCounts: countBy(records, "admissionSubtype"),
    subjectTypeCounts: countBy(records, "subjectType"),
    candidateCategoryCounts: countBy(records, "candidateCategory"),
    recordsWithRank: 0,
    recordsRankUnavailable: records.length,
    scoreRange,
    ordinarySchoolOfficialScoreRange: null,
    specialPathScoreRange: scoreRange,
    rankRange: null,
    boundaryNotes: [
      "商丘师范学院单校官网专升本图片表只用于该校专升本候选边界复核，不替代省级教育考试院全量投档/录取分数表。",
      "2017 专升本图片源表未公开最低分位次；所有行 rankUnavailable=true，不生成假位次。",
      "专升本按 special-path-only 隔离，不与普通高考文化分概率混算。",
      "2014-2016 各专业最低分图片为多年度多栏表，本轮只缓存官方图片证据；拆年拆列前不得导入运行层。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业类别、体检限制、学费校区和调剂规则复核。",
    ],
  };

  const outPath = resolveProjectPath(args.out);
  ensureDir(path.dirname(outPath));
  const payload = {
    sourceNotes: [sourceNote],
    records,
    skippedRows,
    generatedAt: new Date().toISOString(),
    parserVersion: "v3222-sqnu-image-2017-henan-01",
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${records.length} records -> ${args.out}`);
  console.log(`Skipped rows: ${skippedRows.length}`);
  console.log(`Page records: ${pageSummaries.map((page) => `${page.key}:${page.parsedRecords}`).join(", ")}`);
  console.log(`Formal scope counts: ${JSON.stringify(sourceNote.formalScoreScopeCounts)}`);
  console.log(`Subject type counts: ${JSON.stringify(sourceNote.subjectTypeCounts)}`);
  console.log(`Score range: ${JSON.stringify(sourceNote.scoreRange)}`);
  console.log(`Raw files: ${rawFiles.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
