#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const RAW_ROOT = path.join(
  PROJECT_ROOT,
  "data",
  "admissions",
  "raw",
  "third-party-henan-undergraduate2-filing-2024-6617",
);
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-henan-2024-6617-ocr");
const YEAR = 2024;
const PROVINCE = "河南";
const BATCH = "本科二批";
const SOURCE_URL = "https://www.6617.com/p_2085946769.html";
const OFFICIAL_ARTICLE_URL = "https://www.haeea.cn/a/202407/43375_d2d7a8e1.shtml";
const EOL_MIRROR_URL = "https://gaokao.eol.cn/he_nan/dongtai/202408/t20240812_2628490.shtml";
const DATACENTER_URLS = {
  文科: "https://datacenter.haeea.cn/PagePZQuery/ShowPZTDTJ.aspx?yearTip=2024&pc=2&kl=1",
  理科: "https://datacenter.haeea.cn/PagePZQuery/ShowPZTDTJ.aspx?yearTip=2024&pc=2&kl=5",
};
const SOURCE_ID = "third-party-content-mirror-henan-undergraduate2-filing-2024-6617";
const SOURCE_QUALITY = "third-party-content-mirror-henan-2024-undergraduate2-institution-filing-score-rank-image-ocr";
const DEFAULT_OUT = "data/admissions/third-party-content-mirror-henan-undergraduate2-filing-2024-6617-import.json";
const USER_AGENT = "Mozilla/5.0 gaokao-henan-2024-6617-importer/1.0";

const SUBJECT_BOUNDS = {
  文科: { score: [427, 534], rank: [19197, 98536], minRecords: 800 },
  理科: { score: [392, 565], rank: [55035, 336443], minRecords: 1000 },
};

const SCHOOL_NAME_REPLACEMENTS = [
  [/新多学院/g, "新乡学院"],
  [/新乡医学院二全学院/g, "新乡医学院三全学院"],
  [/江苏科技大学苏州理丁学院/g, "江苏科技大学苏州理工学院"],
  [/筆庆学院/g, "肇庆学院"],
];

const SWIFT_VISION_SOURCE = String.raw`
import Foundation
import AppKit
import Vision

if CommandLine.arguments.count < 2 {
  fputs("usage: vision_table_ocr image\n", stderr)
  exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: imageURL) else {
  fputs("cannot load image\n", stderr)
  exit(2)
}

var rect = CGRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
  fputs("cannot create CGImage\n", stderr)
  exit(2)
}

let width = CGFloat(cgImage.width)
let height = CGFloat(cgImage.height)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = false
request.minimumTextHeight = 0.004

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

print("# width\t\(Int(width))\theight\t\(Int(height))\tcount\t\(request.results?.count ?? 0)")
let rows = (request.results ?? []).compactMap { observation -> String? in
  guard let candidate = observation.topCandidates(1).first else { return nil }
  let box = observation.boundingBox
  let x = box.minX * width
  let y = (1.0 - box.maxY) * height
  let w = box.width * width
  let h = box.height * height
  let text = candidate.string
    .replacingOccurrences(of: "\t", with: " ")
    .replacingOccurrences(of: "\n", with: " ")
  return "\(Int(round(x)))\t\(Int(round(y)))\t\(Int(round(w)))\t\(Int(round(h)))\t\(String(format: "%.3f", candidate.confidence))\t\(text)"
}

for line in rows.sorted(by: { left, right in
  let a = left.split(separator: "\t", maxSplits: 5).map(String.init)
  let b = right.split(separator: "\t", maxSplits: 5).map(String.init)
  let ay = Int(a[1]) ?? 0
  let by = Int(b[1]) ?? 0
  if abs(ay - by) > 8 { return ay < by }
  return (Int(a[0]) ?? 0) < (Int(b[0]) ?? 0)
}) {
  print(line)
}
`;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-third-party-henan-undergraduate2-filing-2024-6617.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-third-party-henan-undergraduate2-filing-2024-6617.mjs --use-cache",
    "",
    "Imports 2024 Henan undergraduate batch-2 filing score+rank rows from 6617 table screenshots.",
    "The HAEEA official data-center links are protected in this environment, so this source is third-party-content-mirror only.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeout ?? 180_000,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stderr?.trim(),
      result.stdout?.slice(0, 1200)?.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hash(value, length = 18) {
  return sha256(String(value)).slice(0, length);
}

function cleanHtmlText(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return String(value || "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[|｜]/g, "")
    .replace(/^[^0-9A-Za-z\u4e00-\u9fff]+/u, "")
    .replace(/\s+/g, "")
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function downloadBinary(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "image/png,image/jpeg,image/*,*/*;q=0.8",
      referer: SOURCE_URL,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function extractArticleMeta(html) {
  return {
    title: cleanHtmlText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ||
      /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || ""),
    publishedAt: cleanHtmlText(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/.exec(html)?.[1] || "2024-08-02 10:41"),
    publisher: "6617.com",
  };
}

function extractImageEntries(html) {
  let section = "cover";
  const entries = [];
  const matcher = /<h3[^>]*>([\s\S]*?)<\/h3>|<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(matcher)) {
    if (match[1]) {
      section = cleanHtmlText(match[1]);
      continue;
    }
    const imageUrl = match[2]?.replace(/&amp;/g, "&");
    if (!imageUrl || !/p1\.6617\.com\/article\/20240801\//.test(imageUrl)) continue;
    const extension = path.extname(new URL(imageUrl).pathname).toLowerCase();
    entries.push({
      sourcePage: entries.length + 1,
      section,
      url: imageUrl,
      extension,
      isTableCandidate: extension === ".png",
    });
  }
  const tableEntries = entries.filter((entry) => entry.isTableCandidate);
  if (tableEntries.length !== 22) {
    throw new Error(`Expected 22 table PNG images, got ${tableEntries.length}`);
  }
  return { entries, tableEntries };
}

function compileVisionHelper() {
  ensureDir(TMP_ROOT);
  const sourceFile = path.join(TMP_ROOT, "vision_table_ocr.swift");
  const binaryFile = path.join(TMP_ROOT, "vision_table_ocr");
  fs.writeFileSync(sourceFile, SWIFT_VISION_SOURCE);
  const needsCompile = !fs.existsSync(binaryFile) ||
    fs.statSync(binaryFile).mtimeMs < fs.statSync(sourceFile).mtimeMs;
  if (needsCompile) run("/usr/bin/swiftc", [sourceFile, "-o", binaryFile], { timeout: 180_000 });
  return binaryFile;
}

function parseVisionTsv(tsv, imageId) {
  const observations = [];
  let width = null;
  let height = null;
  for (const line of tsv.split(/\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith("#")) {
      const match = line.match(/width\t(\d+)\theight\t(\d+)\tcount\t(\d+)/);
      if (match) {
        width = Number(match[1]);
        height = Number(match[2]);
      }
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 6) continue;
    observations.push({
      x: Number(parts[0]),
      y: Number(parts[1]),
      w: Number(parts[2]),
      h: Number(parts[3]),
      confidence: Number(parts[4]),
      text: parts.slice(5).join("\t").trim(),
    });
  }

  const candidates = observations
    .filter((item) => item.y > 55 && item.text && !/^(代码|院校|地域|层次|投档线|位次|2024)$/.test(item.text))
    .sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);

  const clusters = [];
  for (const item of candidates) {
    const cy = item.y + item.h / 2;
    let cluster = clusters.at(-1);
    if (!cluster || Math.abs(cluster.cy - cy) > 15) {
      cluster = { items: [], cy };
      clusters.push(cluster);
    }
    cluster.items.push(item);
    cluster.cy = cluster.items.reduce((sum, current) => sum + current.y + current.h / 2, 0) / cluster.items.length;
  }

  const rows = [];
  const skipped = {
    missingCode: 0,
    missingSchool: 0,
    blankFiling: 0,
    missingScore: 0,
    missingRank: 0,
    invalidScore: 0,
    invalidRank: 0,
  };
  for (const cluster of clusters) {
    const items = cluster.items.sort((a, b) => a.x - b.x);
    const left = items
      .filter((item) => item.x < 390)
      .map((item) => item.text.replace(/[|｜]/g, " "))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const codeMatch = left.match(/^\s*(\d{4})\s*(.+)$/);
    if (!codeMatch) {
      skipped.missingCode += 1;
      continue;
    }
    const schoolName = normalizeName(codeMatch[2]);
    if (!schoolName) {
      skipped.missingSchool += 1;
      continue;
    }

    const numericCells = items
      .filter((item) => /^\d+$/.test(item.text.replace(/[|｜]/g, "")))
      .map((item) => ({
        x: item.x,
        text: item.text.replace(/[|｜]/g, ""),
        confidence: item.confidence,
      }));
    const scoreCell = numericCells.find((item) => item.x >= 645 && item.x < 760 && /^\d{3}$/.test(item.text));
    const rankCell = numericCells.find((item) => item.x >= 745 && /^\d{4,6}$/.test(item.text));
    if (!scoreCell && !rankCell) {
      skipped.blankFiling += 1;
      continue;
    }
    if (!scoreCell) {
      skipped.missingScore += 1;
      continue;
    }
    if (!rankCell) {
      skipped.missingRank += 1;
      continue;
    }
    const minScore = Number(scoreCell.text);
    const minRank = Number(rankCell.text);
    if (!Number.isFinite(minScore) || minScore < 300 || minScore > 750) {
      skipped.invalidScore += 1;
      continue;
    }
    if (!Number.isFinite(minRank) || minRank < 1 || minRank > 500_000) {
      skipped.invalidRank += 1;
      continue;
    }

    const location = items
      .filter((item) => item.x >= 390 && item.x < 565)
      .filter((item) => item.x < 535)
      .map((item) => item.text.replace(/[|｜]/g, " "))
      .join(" ")
      .replace(/\s+/g, "")
      .trim();
    const level = items
      .filter((item) => item.x >= 535 && item.x < 645)
      .map((item) => item.text.replace(/[|｜]/g, " "))
      .join(" ")
      .replace(/\s+/g, "")
      .trim();

    rows.push({
      imageId,
      ocrRowTop: Math.round(cluster.cy),
      schoolCode: codeMatch[1],
      schoolName,
      minScore,
      minRank,
      schoolLocation: location,
      schoolLevelRaw: level,
      ocrConfidence: {
        codeSchool: Math.min(...items.filter((item) => item.x < 390).map((item) => item.confidence)),
        score: scoreCell.confidence,
        rank: rankCell.confidence,
      },
      rawLeft: left,
      rawText: items.map((item) => `${item.x}:${item.text}`).join(" | "),
    });
  }
  return {
    width,
    height,
    observations: observations.length,
    clusters: clusters.length,
    rows,
    skipped,
  };
}

function correctSchoolName(row, _codeNameMap) {
  let schoolName = normalizeName(row.schoolName);
  for (const [pattern, replacement] of SCHOOL_NAME_REPLACEMENTS) {
    schoolName = schoolName.replace(pattern, replacement);
  }
  if (schoolName !== row.schoolName) {
    return {
      schoolName,
      correction: {
        from: row.schoolName,
        to: schoolName,
        method: "conservative-ocr-text-cleanup",
      },
    };
  }
  return { schoolName: row.schoolName, correction: null };
}

function inferSubject(entry, rows) {
  const scores = rows.map((row) => row.minScore);
  const ranks = rows.map((row) => row.minRank);
  const maxScore = Math.max(...scores);
  const maxRank = Math.max(...ranks);
  if (/理科/.test(entry.section)) return "理科";
  if (maxScore > SUBJECT_BOUNDS.文科.score[1] || maxRank > 100_000) return "理科";
  return "文科";
}

function buildRecords({ parsedImages, codeNameMap }) {
  const records = [];
  for (const image of parsedImages) {
    const subjectType = inferSubject(image, image.rows);
    for (const [rowIndex, row] of image.rows.entries()) {
      const { schoolName, correction } = correctSchoolName(row, codeNameMap);
      records.push({
        id: `2024-henan-undergraduate2-${subjectType === "文科" ? "liberal" : "science"}-filing-6617-${hash([
          row.schoolCode,
          schoolName,
          row.minScore,
          row.minRank,
          image.imageId,
          row.ocrRowTop,
        ].join("|"))}`,
        province: PROVINCE,
        year: YEAR,
        subjectType,
        batch: BATCH,
        schoolName,
        schoolCode: row.schoolCode,
        schoolTags: [
          "河南本科二批投档线",
          "第三方内容镜像",
          BATCH,
          subjectType,
          row.schoolLevelRaw,
          "score+rank",
        ].filter(Boolean),
        dataType: "institution-admission",
        majorName: "院校平行投档线",
        majorCode: "",
        majorGroup: `${BATCH}院校平行投档分数线 / 河南院校代码 ${row.schoolCode}`,
        schoolType: null,
        schoolLocation: row.schoolLocation || null,
        schoolLevelRaw: row.schoolLevelRaw || null,
        disciplineCodes: [],
        planCount: null,
        minScore: row.minScore,
        minRankStart: row.minRank,
        minRankEnd: row.minRank,
        rankRangeText: String(row.minRank),
        rankUsage: subjectType === "文科" ? "henan-2024-legacy-liberal-filing-rank" : "henan-2024-legacy-science-filing-rank",
        rankCategory: `普通类${subjectType}`,
        sourceId: SOURCE_ID,
        sourceQuality: SOURCE_QUALITY,
        sourceUrl: SOURCE_URL,
        sourceMirrorUrl: SOURCE_URL,
        sourceOfficialArticleUrl: OFFICIAL_ARTICLE_URL,
        sourceOfficialMirrorUrl: EOL_MIRROR_URL,
        sourceDatacenterUrl: DATACENTER_URLS[subjectType],
        sourceLayer: "third-party-content-mirror",
        sourceImageUrl: image.url,
        sourceImageFile: image.file,
        sourceImageSha256: image.sha256,
        sourcePage: image.sourcePage,
        sourceRowNumber: rowIndex + 1,
        sourceSchoolRaw: row.schoolCode,
        sourceScoreOcrRule: "macos-vision-row-table-fixed-columns-6617",
        sourceRankOcrRule: "macos-vision-row-table-fixed-columns-6617",
        ocrRowTop: row.ocrRowTop,
        ocrConfidence: row.ocrConfidence,
        ocrSchoolName: row.schoolName,
        schoolNameCorrection: correction,
        rawLeft: row.rawLeft,
        rawText: row.rawText,
        cautions: [
          "该记录来自 6617.com 转载的河南 2024 本科二批投档线图片表，按 third-party-content-mirror 分层；不标记为考试院直连 official。",
          "河南省教育考试院/HAEEA 数据中心链接已定位，但命令行访问当前返回验证页；正式填报前仍须回考试院数据中心、院校官网、当年计划和招生章程复核。",
          "源图公开最低投档分和位次，运行层仅作为院校投档边界，不等同于专业录取分或最终录取概率。",
          "2024年河南仍为文科/理科旧高考口径；不能与2025年起新高考物理类/历史类院校专业组口径直接混用。",
          "图片表经 macOS Vision OCR 后按固定列坐标抽取；学校名只做保守 OCR 噪声清理，保留 ocrSchoolName 与 rawText 以便复核。",
        ],
      });
    }
  }
  return records;
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];
  const duplicates = [];
  for (const record of records) {
    const key = [record.subjectType, record.schoolCode, record.schoolName, record.minScore, record.minRankStart].join("|");
    if (seen.has(key)) {
      duplicates.push(record);
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return { deduped, duplicates };
}

function validateRecords(records) {
  const bySubject = new Map();
  for (const record of records) {
    const list = bySubject.get(record.subjectType) || [];
    list.push(record);
    bySubject.set(record.subjectType, list);
  }
  for (const [subjectType, bounds] of Object.entries(SUBJECT_BOUNDS)) {
    const list = bySubject.get(subjectType) || [];
    if (list.length < bounds.minRecords) {
      throw new Error(`Expected at least ${bounds.minRecords} ${subjectType} records, got ${list.length}`);
    }
    const scores = list.map((record) => record.minScore);
    const ranks = list.map((record) => record.minRankStart);
    const scoreRange = [Math.min(...scores), Math.max(...scores)];
    const rankRange = [Math.min(...ranks), Math.max(...ranks)];
    if (scoreRange[0] !== bounds.score[0] || scoreRange[1] !== bounds.score[1]) {
      throw new Error(`Unexpected ${subjectType} score range ${scoreRange.join("-")}`);
    }
    if (rankRange[0] !== bounds.rank[0] || rankRange[1] !== bounds.rank[1]) {
      throw new Error(`Unexpected ${subjectType} rank range ${rankRange.join("-")}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  ensureDir(RAW_ROOT);
  ensureDir(TMP_ROOT);
  const pageFile = path.join(RAW_ROOT, "6617-henan-2024-undergraduate2-page.html");
  let html;
  if (args.useCache && fs.existsSync(pageFile)) html = fs.readFileSync(pageFile, "utf8");
  else {
    html = await fetchText(SOURCE_URL);
    fs.writeFileSync(pageFile, html);
  }
  const articleMeta = extractArticleMeta(html);
  const { entries, tableEntries } = extractImageEntries(html);
  fs.writeFileSync(path.join(RAW_ROOT, "image-url-sections.json"), `${JSON.stringify(entries, null, 2)}\n`);

  const visionHelper = compileVisionHelper();
  const parsedImages = [];
  for (const entry of tableEntries) {
    const index = String(entry.sourcePage).padStart(2, "0");
    const imageId = `${index}-${path.basename(new URL(entry.url).pathname, ".png")}`;
    const imageFile = path.join(RAW_ROOT, `${imageId}.png`);
    if (!(args.useCache && fs.existsSync(imageFile))) {
      fs.writeFileSync(imageFile, await downloadBinary(entry.url));
    }
    const tsvFile = path.join(RAW_ROOT, `${imageId}.vision.tsv`);
    let tsv;
    if (args.useCache && fs.existsSync(tsvFile)) tsv = fs.readFileSync(tsvFile, "utf8");
    else {
      tsv = run(visionHelper, [imageFile], { timeout: 240_000 });
      fs.writeFileSync(tsvFile, tsv);
    }
    const parsed = parseVisionTsv(tsv, imageId);
    parsedImages.push({
      ...entry,
      imageId,
      file: rel(imageFile),
      tsvFile: rel(tsvFile),
      sha256: sha256File(imageFile),
      ...parsed,
    });
    const subjectGuess = parsed.rows.length ? inferSubject(entry, parsed.rows) : "无记录";
    console.log(`${imageId}: ${subjectGuess} rows=${parsed.rows.length} skipped=${JSON.stringify(parsed.skipped)}`);
  }

  const codeNameMap = new Map();
  const built = buildRecords({ parsedImages, codeNameMap });
  const { deduped: records, duplicates } = dedupeRecords(built);
  if (duplicates.length) {
    throw new Error(`Unexpected duplicate rows: ${duplicates.length}`);
  }
  validateRecords(records);
  records.sort((a, b) =>
    a.subjectType.localeCompare(b.subjectType, "zh-Hans-CN") ||
    a.minRankStart - b.minRankStart ||
    b.minScore - a.minScore ||
    a.schoolCode.localeCompare(b.schoolCode, "zh-Hans-CN") ||
    a.schoolName.localeCompare(b.schoolName, "zh-Hans-CN")
  );

  const subjectSummary = Object.fromEntries(
    [...new Set(records.map((record) => record.subjectType))].map((subjectType) => {
      const list = records.filter((record) => record.subjectType === subjectType);
      const scores = list.map((record) => record.minScore);
      const ranks = list.map((record) => record.minRankStart);
      return [subjectType, {
        records: list.length,
        minScore: Math.min(...scores),
        maxScore: Math.max(...scores),
        minRank: Math.min(...ranks),
        maxRank: Math.max(...ranks),
        correctedSchoolNames: list.filter((record) => record.schoolNameCorrection).length,
      }];
    }),
  );

  const outFile = path.isAbsolute(args.out) ? args.out : path.join(PROJECT_ROOT, args.out);
  ensureDir(path.dirname(outFile));
  const payload = {
    dataset: `${SOURCE_ID}-import`,
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      subjectType: "文科/理科",
      batch: BATCH,
      dataType: "institution-admission",
      sourceLayer: "third-party-content-mirror",
    },
    notes: [
      "河南省教育考试院 2024 本科二批投档线官方页面与 HAEEA 数据中心链接已定位，但当前命令行抓取返回验证/防护页。",
      "本导入使用 6617.com 可见图片表作为第三方内容镜像，按 third-party-content-mirror 分层，不计作考试院直连 official。",
      "源图公开最低投档分和位次，运行层保留 score+rank 院校层投档边界；不生成专业录取分或最终录取概率。",
      "河南 2024 仍为文科/理科旧高考口径，不与 2025 新高考物理类/历史类直接混用。",
    ],
    summary: {
      records: records.length,
      imageCount: parsedImages.length,
      bySubject: subjectSummary,
      sourceQuality: SOURCE_QUALITY,
      officialArticleUrl: OFFICIAL_ARTICLE_URL,
      datacenterUrls: DATACENTER_URLS,
      mirrorUrl: SOURCE_URL,
      eolOfficialLinkMirrorUrl: EOL_MIRROR_URL,
    },
    ocrAudit: {
      rowParsing: "macOS Vision full-image OCR, y-clustered table rows, fixed x-ranges for code/school/location/level/score/rank columns",
      imageNotes: parsedImages.map((image) => ({
        imageId: image.imageId,
        sourcePage: image.sourcePage,
        section: image.section,
        url: image.url,
        file: image.file,
        tsvFile: image.tsvFile,
        width: image.width,
        height: image.height,
        sha256: image.sha256,
        ocrObservations: image.observations,
        rowCandidates: image.clusters,
        records: image.rows.length,
        skipped: image.skipped,
      })),
      duplicateRows: duplicates.length,
    },
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: `${articleMeta.title}（6617 图片表 OCR 导入）`,
        publisher: articleMeta.publisher,
        url: SOURCE_URL,
        officialArticleUrl: OFFICIAL_ARTICLE_URL,
        eolOfficialLinkMirrorUrl: EOL_MIRROR_URL,
        datacenterUrls: DATACENTER_URLS,
        publishedAt: articleMeta.publishedAt,
        quality: SOURCE_QUALITY,
        usage: `6617.com 转载图片表经本地 OCR 抽取 ${records.length} 条河南 2024 ${BATCH}院校投档分数线及位次；按 third-party-content-mirror score+rank 院校投档边界使用。`,
        parsedRecords: records.length,
        htmlSha256: sha256(html),
        rawFiles: {
          mirrorPage: rel(pageFile),
          imageUrlSections: rel(path.join(RAW_ROOT, "image-url-sections.json")),
        },
      },
    ],
    records,
  };

  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${rel(outFile)} with ${records.length} records`);
  console.log(JSON.stringify(subjectSummary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
