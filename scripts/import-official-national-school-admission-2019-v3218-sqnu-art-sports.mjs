#!/usr/bin/env node

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2019;
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2019-v3218-sqnu-art-sports-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2019-v3218-sqnu-art-sports";
const BASE_URL = "https://zhaoban.sqnu.edu.cn";
const INDEX_URL = `${BASE_URL}/lqfs/5.htm`;
const SOURCE_URL = `${BASE_URL}/info/1005/2053.htm`;

const SOURCE = {
  id: "official-sqnu-national-2019-school-art-sports-major-admission",
  quality: "official-school-sqnu-2019-national-pdf-art-sports-score",
  schoolCode: "10483",
  schoolName: "商丘师范学院",
  city: "商丘",
  tags: ["师范", "河南", "商丘", "商丘师范学院"],
};

const PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
];
const PROVINCE_SET = new Set(PROVINCES);
const SCORE_HEADERS = new Set(["录取最低分", "科类", "批次", "文化课", "专业课", "总分"]);
const BATCH_LABELS = new Set(["本科提前A", "艺术二小批"]);
const CATEGORY_LABELS = new Set(["美术学", "音乐", "体育"]);
const MAJOR_NORMALIZE = new Map([
  ["雕塑", "雕塑"],
  ["美术学", "美术学"],
  ["绘画", "绘画"],
  ["动画", "动画"],
  ["书法", "书法"],
  ["摄影", "摄影"],
  ["环境设计", "环境设计"],
  ["视觉传达设计", "视觉传达设计"],
  ["音乐学", "音乐学"],
  ["音乐表演", "音乐表演"],
  ["舞蹈编导", "舞蹈编导"],
  ["广播电视编导", "广播电视编导"],
  ["播音主持", "播音主持"],
  ["体育教育", "体育教育"],
  ["体育教育理", "体育教育"],
  ["社会体育", "社会体育"],
  ["社会体育文科", "社会体育"],
]);
const SPORTS_MAJORS = new Set(["体育教育", "体育教育理", "社会体育", "社会体育文科"]);
const ART_PATTERN = /雕塑|美术|绘画|动画|书法|摄影|环境设计|视觉传达|音乐|舞蹈|广播电视编导|播音主持/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2019-v3218-sqnu-art-sports.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2019-v3218-sqnu-art-sports.mjs --use-cache",
    "",
    "Imports 商丘师范学院招生信息网 official 2019 outside-province art/sports PDF using pdftotext bbox coordinates.",
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
    throw new Error("Refusing to run PDF ingestion from /Volumes/mac_2T; run this importer from the internal APFS project copy.");
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
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function countBy(records, key) {
  return records.reduce((acc, record) => {
    const value = record[key] ?? "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function countByValue(values) {
  return values.reduce((acc, value) => {
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
      return buffer;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

function absolutizeUrl(maybeUrl) {
  const value = clean(maybeUrl);
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return new URL(value, SOURCE_URL).toString();
}

function extractPdfUrl(html) {
  const candidates = [...String(html).matchAll(/(?:href|src)=["']([^"']+\.pdf)["']/gi)]
    .map((match) => absolutizeUrl(match[1]));
  const pdfUrl = candidates.find((url) => url.includes("__local")) || candidates[0];
  if (!pdfUrl) throw new Error(`Could not find official PDF attachment on ${SOURCE_URL}`);
  return pdfUrl;
}

async function downloadRaw(rawRoot, useCache) {
  const htmlRel = "2019-outside-art-sports.html";
  const pdfRel = "2019-outside-art-sports.pdf";
  const textRel = "2019-outside-art-sports-layout.txt";
  const bboxRel = "2019-outside-art-sports-bbox.html";
  const htmlPath = path.join(rawRoot, htmlRel);
  const pdfPath = path.join(rawRoot, pdfRel);
  const textPath = path.join(rawRoot, textRel);
  const bboxPath = path.join(rawRoot, bboxRel);

  let html;
  if (useCache && fs.existsSync(htmlPath)) {
    html = fs.readFileSync(htmlPath, "utf8");
  } else {
    html = (await fetchBuffer(SOURCE_URL, INDEX_URL)).toString("utf8").replace(/\0/g, "");
    if (!html.includes("2019年省外艺术、体育类专业录取最低分")) {
      throw new Error(`Official SQNU 2019 art/sports title token not found in ${SOURCE_URL}`);
    }
    fs.writeFileSync(htmlPath, html);
  }

  const pdfUrl = extractPdfUrl(html);
  if (useCache && fs.existsSync(pdfPath)) {
    // Reuse cached PDF.
  } else {
    const pdf = await fetchBuffer(pdfUrl, SOURCE_URL, "application/pdf,*/*;q=0.8");
    if (!pdf.subarray(0, 5).toString("ascii").startsWith("%PDF")) {
      throw new Error(`Downloaded source is not a PDF: ${pdfUrl}`);
    }
    fs.writeFileSync(pdfPath, pdf);
  }

  if (!useCache || !fs.existsSync(textPath)) {
    childProcess.execFileSync("pdftotext", ["-layout", pdfPath, textPath], { stdio: "pipe" });
  }
  if (!useCache || !fs.existsSync(bboxPath)) {
    childProcess.execFileSync("pdftotext", ["-bbox-layout", pdfPath, bboxPath], { stdio: "pipe" });
  }
  return { html, pdfUrl, htmlRel, pdfRel, textRel, bboxRel, htmlPath, pdfPath, textPath, bboxPath };
}

function extractRowsFromBbox(bboxHtml) {
  const rows = [];
  const pageRe = /<page\b[^>]*>([\s\S]*?)<\/page>/g;
  let pageMatch;
  let pageIndex = 0;
  while ((pageMatch = pageRe.exec(bboxHtml))) {
    pageIndex += 1;
    const words = [];
    for (const match of pageMatch[1].matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([\s\S]*?)<\/word>/g)) {
      words.push({
        page: pageIndex,
        x: Number(match[1]),
        y: Number(match[2]),
        x2: Number(match[3]),
        y2: Number(match[4]),
        text: clean(match[5]),
      });
    }
    words.sort((a, b) => a.y - b.y || a.x - b.x);
    const pageRows = [];
    for (const word of words) {
      let row = pageRows.find((candidate) => Math.abs(candidate.y - word.y) < 2.6);
      if (!row) {
        row = { page: pageIndex, y: word.y, globalY: (pageIndex - 1) * 1000 + word.y, words: [] };
        pageRows.push(row);
      }
      row.words.push(word);
    }
    for (const row of pageRows) {
      row.words.sort((a, b) => a.x - b.x);
      row.text = row.words.map((word) => word.text).join(" ");
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.globalY - b.globalY);
}

function isHeaderRow(row) {
  const texts = new Set(row.words.map((word) => word.text));
  return ["科类", "批次", "文化课", "专业课", "总分"].every((token) => texts.has(token));
}

function isScoreWord(word) {
  return Number.isFinite(parseNumber(word.text));
}

function scoreColumn(word) {
  if (word.x >= 410) return "total";
  if (word.x >= 345) return "professional";
  return "culture";
}

function normalizeProvince(value) {
  const text = clean(value);
  if (text === "内蒙") return "内蒙古";
  return text;
}

function normalizeBatch(raw) {
  const text = clean(raw);
  if (/提前/.test(text)) return "本科提前批";
  if (/艺术二小批/.test(text)) return "艺术二小批";
  if (/体育/.test(text)) return "体育类本科批";
  return text || "官网未列批次";
}

function inferCategory(majorNameRaw, rowCategoryRaw = "") {
  const text = [rowCategoryRaw, majorNameRaw].map(clean).join(" ");
  if ([...SPORTS_MAJORS].some((major) => text.includes(major)) || /体育/.test(text)) return "体育";
  if (/音乐/.test(text)) return "音乐";
  if (/美术|绘画|动画|书法|摄影|环境设计|视觉传达|雕塑/.test(text)) return "美术学";
  return ART_PATTERN.test(text) ? "艺术" : "官网未列科类";
}

function normalizeSubject(categoryRaw, majorNameRaw) {
  const text = [categoryRaw, majorNameRaw].map(clean).join(" ");
  if (/体育|社会体育/.test(text)) return "体育类";
  if (ART_PATTERN.test(text)) return "艺术类";
  return "官网未列科类";
}

function classifyAdmission(categoryRaw, majorNameRaw) {
  const text = [categoryRaw, majorNameRaw].map(clean).join(" ");
  if (/体育|社会体育/.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
}

function selectedScore(scores) {
  const priority = ["total", "professional", "culture"];
  for (const column of priority) {
    if (scores[column]) return { column, raw: scores[column].raw, value: scores[column].value };
  }
  return null;
}

function scoreMetricFor(column) {
  if (column === "total") return "艺术/体育类学校源表总分或综合分";
  if (column === "professional") return "艺术/体育类学校源表专业课最低分";
  return "艺术/体育类学校源表文化课最低分";
}

function collectGroupBatch(groupRows) {
  const labels = [];
  for (const row of groupRows) {
    for (const word of row.words) {
      if (BATCH_LABELS.has(word.text)) labels.push(word.text);
    }
  }
  const unique = [...new Set(labels)];
  return unique.length === 1 ? unique[0] : "";
}

function collectGroupProvince(groupRows) {
  const labels = [];
  for (const row of groupRows) {
    for (const word of row.words) {
      const province = normalizeProvince(word.text);
      if (word.x < 100 && PROVINCE_SET.has(province)) labels.push(province);
    }
  }
  const unique = [...new Set(labels)];
  if (unique.length !== 1) return { province: "", labels: unique };
  return { province: unique[0], labels: unique };
}

function rowScoreCells(row) {
  const scores = {};
  for (const word of row.words.filter(isScoreWord)) {
    const column = scoreColumn(word);
    scores[column] = { raw: word.text, value: parseNumber(word.text), x: word.x };
  }
  return scores;
}

function rowBatch(row) {
  return row.words.find((word) => BATCH_LABELS.has(word.text))?.text || "";
}

function rowCategory(row) {
  return row.words.find((word) => {
    if (word.text === "音乐" || word.text === "体育") return true;
    return word.text === "美术学" && word.x < 220;
  })?.text || "";
}

function majorCandidates(row) {
  const candidates = [];
  for (const word of row.words) {
    const text = clean(word.text);
    if (!text || SCORE_HEADERS.has(text) || BATCH_LABELS.has(text) || PROVINCE_SET.has(normalizeProvince(text)) || isScoreWord(word)) continue;
    if (text === "音乐" || text === "体育") continue;
    if (text === "美术学" && word.x < 220) continue;
    if (MAJOR_NORMALIZE.has(text)) {
      candidates.push({ raw: text, normalized: MAJOR_NORMALIZE.get(text), x: word.x });
    }
  }
  return candidates;
}

function sourceLineFor(row) {
  return row.words.map((word) => `[${Math.round(word.x)}:${word.text}]`).join(" ");
}

function makeRecord({ row, rowIndex, province, batchRaw, categoryRaw, major, scores, score }) {
  const classification = classifyAdmission(categoryRaw, major.normalized);
  const subjectType = normalizeSubject(categoryRaw, major.normalized);
  const batch = normalizeBatch(batchRaw);
  const record = {
    id: `${YEAR}-sqnu-art-sports-major-${stableId([
      province,
      batchRaw,
      categoryRaw,
      major.raw,
      score.column,
      score.raw,
      row.page,
      row.y.toFixed(1),
    ])}`,
    province,
    sourceProvinceRaw: province,
    year: YEAR,
    subjectType,
    sourceSubjectRaw: categoryRaw || inferCategory(major.raw),
    batch,
    sourceBatchRaw: batchRaw || "官网未列批次",
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "major-admission",
    majorName: major.normalized,
    majorGroup: [SOURCE.schoolName, YEAR, province, subjectType, batch, major.normalized].filter(Boolean).join("-"),
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    minScore: score.value,
    scoreMetric: scoreMetricFor(score.column),
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-score",
    sourceUrl: SOURCE_URL,
    sourcePageUrl: SOURCE_URL,
    sourceIndexUrl: INDEX_URL,
    officialEvidencePath: `${RAW_DIR}/2019-outside-art-sports.pdf`,
    sourcePdfPath: `${RAW_DIR}/2019-outside-art-sports.pdf`,
    sourceTextPath: `${RAW_DIR}/2019-outside-art-sports-layout.txt`,
    sourceBboxPath: `${RAW_DIR}/2019-outside-art-sports-bbox.html`,
    sourcePageKey: "outside-art-sports-major-2019",
    sourcePageTitle: "2019年省外艺术、体育类专业录取最低分",
    sourceMajorNameRaw: major.raw,
    sourceCultureScoreRaw: scores.culture?.raw || "",
    sourceProfessionalScoreRaw: scores.professional?.raw || "",
    sourceTotalScoreRaw: scores.total?.raw || "",
    sourceScoreColumnUsed: score.column,
    sourceMinScoreRaw: score.raw,
    rawRow: {
      source: "sqnu-2019-official-pdf-pdftotext-bbox",
      pageKey: "outside-art-sports-major-2019",
      page: row.page,
      y: Number(row.y.toFixed(3)),
      rowIndex,
      sourceLine: sourceLineFor(row),
    },
    cautions: [
      "本记录来自商丘师范学院招生信息网官方 2019 年省外艺术、体育类专业录取最低分 PDF，是单校分省分专业特殊类型录取边界，不是省级教育考试院全量投档/录取分数表。",
      "源表未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      "本行属于艺术或体育特殊路径，运行层按 special-path-only 隔离，不与普通批文化分边界混用。",
      "源表按文化课、专业课、总分三列给出最低分；运行层优先使用总分，其次专业课，再其次文化课，并保留 sourceScoreColumnUsed 与原始列值。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业/术科统考规则、综合分折算公式、体检限制、学费校区和调剂规则复核。",
    ],
  };
  if (scores.culture?.value != null) record.sourceCultureScore = scores.culture.value;
  if (scores.professional?.value != null) record.sourceProfessionalScore = scores.professional.value;
  if (scores.total?.value != null) record.sourceTotalScore = scores.total.value;
  return record;
}

function parseRecordsFromBbox(bboxHtml) {
  const rows = extractRowsFromBbox(bboxHtml);
  const headerRows = rows.filter(isHeaderRow);
  if (!headerRows.length) throw new Error("No table headers found in SQNU 2019 art/sports bbox PDF text.");

  const records = [];
  const skippedRows = [];
  const pageGroups = [];
  let rowIndex = 0;
  for (let i = 0; i < headerRows.length; i += 1) {
    const header = headerRows[i];
    const nextHeader = headerRows[i + 1];
    const groupRows = rows.filter((row) => row.globalY > header.globalY && (!nextHeader || row.globalY < nextHeader.globalY));
    const dataRows = groupRows.filter((row) => !row.words.some((word) => SCORE_HEADERS.has(word.text)));
    if (!dataRows.length) continue;
    const { province, labels } = collectGroupProvince(dataRows);
    const groupBatch = collectGroupBatch(dataRows);
    pageGroups.push({
      headerPage: header.page,
      headerY: Number(header.y.toFixed(3)),
      province: province || labels.join("/"),
      groupBatch: groupBatch || "官网未列批次",
      rows: dataRows.length,
    });
    if (!province) {
      skippedRows.push({
        reason: "province-group-not-unique",
        headerPage: header.page,
        headerY: Number(header.y.toFixed(3)),
        provinceLabels: labels,
        rows: dataRows.map(sourceLineFor),
      });
      continue;
    }
    for (const row of dataRows) {
      rowIndex += 1;
      const scores = rowScoreCells(row);
      const score = selectedScore(scores);
      const majors = majorCandidates(row);
      if (!majors.length) continue;
      if (majors.length > 1) {
        skippedRows.push({
          reason: "multiple-major-candidates",
          province,
          rowIndex,
          page: row.page,
          y: Number(row.y.toFixed(3)),
          majors: majors.map((major) => major.raw),
          sourceLine: sourceLineFor(row),
        });
        continue;
      }
      const categoryRaw = rowCategory(row) || inferCategory(majors[0].raw);
      const batchRaw = rowBatch(row) || groupBatch || "官网未列批次";
      if (!score) {
        skippedRows.push({
          reason: "missing-score-in-official-pdf",
          province,
          sourceBatchRaw: batchRaw,
          sourceSubjectRaw: categoryRaw,
          majorNameRaw: majors[0].raw,
          rowIndex,
          page: row.page,
          y: Number(row.y.toFixed(3)),
          sourceLine: sourceLineFor(row),
        });
        continue;
      }
      records.push(makeRecord({ row, rowIndex, province, batchRaw, categoryRaw, major: majors[0], scores, score }));
    }
  }
  return { records, skippedRows, pageGroups };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const raw = await downloadRaw(rawRoot, args.useCache);
  const bboxHtml = fs.readFileSync(raw.bboxPath, "utf8");
  const { records, skippedRows, pageGroups } = parseRecordsFromBbox(bboxHtml);
  const duplicateIds = records.map((record) => record.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate record IDs: ${[...new Set(duplicateIds)].slice(0, 5).join(", ")}`);
  }
  const recordsMissingScore = records.filter((record) => !Number.isFinite(record.minScore));
  if (recordsMissingScore.length) {
    throw new Error(`Records with missing minScore: ${recordsMissingScore.slice(0, 3).map((record) => record.id).join(", ")}`);
  }
  const invalidMajorRecords = records.filter((record) => ["音乐", "体育", "本科提前A", "艺术二小批"].includes(record.majorName));
  if (invalidMajorRecords.length) {
    throw new Error(`Invalid major-only category records: ${invalidMajorRecords.slice(0, 3).map((record) => record.id).join(", ")}`);
  }

  const scoreColumnCounts = countByValue(records.map((record) => record.sourceScoreColumnUsed));
  const sourceNote = {
    id: SOURCE.id,
    title: "商丘师范学院招生信息网：2019年省外艺术、体育类专业录取最低分官方 PDF",
    publisher: "商丘师范学院招生信息网",
    publishedAt: extractPublishedAt(raw.html) || "2020-07-11",
    url: SOURCE_URL,
    indexUrl: INDEX_URL,
    pdfUrl: raw.pdfUrl,
    quality: SOURCE.quality,
    usage: "从商丘师范学院招生信息网官方“录取分数”栏目下载 2019 年省外艺术、体育类专业录取最低分 PDF，使用 pdftotext -bbox-layout 按页码和坐标重建分省专业行，抽取文化课、专业课、总分列中的官方最低分；源表未公开最低位次，运行层不生成假位次。学校官网单校特殊路径数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    blankScoreRows: skippedRows.filter((row) => row.reason === "missing-score-in-official-pdf").length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    provincesWithRecords: uniqueSorted(records, "province"),
    pageSummaries: [{
      key: "outside-art-sports-major-2019",
      title: "2019年省外艺术、体育类专业录取最低分",
      officialTitle: extractOfficialTitle(raw.html),
      url: SOURCE_URL,
      pdfUrl: raw.pdfUrl,
      rawHtmlPath: `${RAW_DIR}/${raw.htmlRel}`,
      rawPdfPath: `${RAW_DIR}/${raw.pdfRel}`,
      rawTextPath: `${RAW_DIR}/${raw.textRel}`,
      rawBboxPath: `${RAW_DIR}/${raw.bboxRel}`,
      parsedRecords: records.length,
      skippedRows: skippedRows.length,
      bboxTableGroups: pageGroups,
      sha256Html: sha256File(raw.htmlPath),
      sha256Pdf: sha256File(raw.pdfPath),
      sha256Text: sha256File(raw.textPath),
      sha256Bbox: sha256File(raw.bboxPath),
    }],
    rawDir: RAW_DIR,
    rawFiles: [
      { path: `${RAW_DIR}/${raw.htmlRel}`, url: SOURCE_URL, sha256: sha256File(raw.htmlPath) },
      { path: `${RAW_DIR}/${raw.pdfRel}`, url: raw.pdfUrl, sha256: sha256File(raw.pdfPath) },
      { path: `${RAW_DIR}/${raw.textRel}`, url: raw.pdfUrl, sha256: sha256File(raw.textPath) },
      { path: `${RAW_DIR}/${raw.bboxRel}`, url: raw.pdfUrl, sha256: sha256File(raw.bboxPath) },
    ],
    recordTypeCounts: countBy(records, "dataType"),
    formalScoreScopeCounts: countBy(records, "formalScoreScope"),
    admissionTypeCounts: countBy(records, "admissionType"),
    admissionSubtypeCounts: countBy(records, "admissionSubtype"),
    subjectTypeCounts: countBy(records, "subjectType"),
    sourceScoreColumnCounts: scoreColumnCounts,
    recordsWithRank: 0,
    recordsRankUnavailable: records.length,
    scoreRange: rangeOf(records, "minScore"),
    specialPathScoreRange: rangeOf(records, "minScore"),
    rankRange: null,
    boundaryNotes: [
      "商丘师范学院单校官网艺体分专业最低分只用于该校特殊路径候选边界复核，不替代省级教育考试院全量投档/录取分数表。",
      "PDF 为跨行省份/科类/批次版式，本导入器按 bbox 坐标分组；只有同时识别到省份、专业和至少一个官方分数列的行才入库。",
      "源表未公开最低分位次；所有行 rankUnavailable=true，不生成假位次。",
      "艺术、体育记录全部按 special-path-only 隔离，不与普通高考文化分概率混算。",
      "源表空白专业行不补数，只在 skippedRows 中保留 missing-score-in-official-pdf 证据。",
    ],
  };

  const outPath = resolveProjectPath(args.out);
  ensureDir(path.dirname(outPath));
  const payload = {
    sourceNotes: [sourceNote],
    records,
    skippedRows,
    generatedAt: new Date().toISOString(),
    parserVersion: "v3218-sqnu-pdf-bbox-2019-outside-art-sports-01",
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${records.length} records -> ${args.out}`);
  console.log(`Skipped rows: ${skippedRows.length}`);
  console.log(`Blank score rows: ${sourceNote.blankScoreRows}`);
  console.log(`Provinces: ${sourceNote.provincesWithRecords.join(", ")}`);
  console.log(`Score column counts: ${JSON.stringify(scoreColumnCounts)}`);
  console.log(`Admission type counts: ${JSON.stringify(sourceNote.admissionTypeCounts)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
