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
  "official-content-mirror-henan-undergraduate-filing-2024-zizzs",
);
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-henan-2024-zizzs-ocr");
const YEAR = 2024;
const PROVINCE = "河南";
const USER_AGENT = "Mozilla/5.0 gaokao-henan-2024-zizzs-importer/1.0";
const DEFAULT_SOURCE = "batch1-science";
const SOURCE_CONFIGS = {
  "batch1-science": {
    sourceKey: "batch1-science",
    sourceSlug: "undergraduate1-science",
    defaultOut: "data/admissions/official-content-mirror-henan-undergraduate1-filing-2024-zizzs-import.json",
    subjectType: "理科",
    originalSubject: "理科",
    batch: "本科一批",
    sourceId: "official-content-mirror-henan-undergraduate1-filing-2024-science-zizzs",
    officialArticleUrl: "https://gaokao.haedu.cn/501/552/2024/0721/135558.html",
    mirrorUrl: "https://www.zizzs.com/gk/gaokao/171098.html",
    datacenterUrl: "https://datacenter.haeea.cn/PagePZQuery/ShowPZTDTJ.aspx?yearTip=2024&pc=1&kl=5",
    officialFileName: "official-henan-2024-undergraduate1-page.html",
    mirrorFileName: "zizzs-171098-henan-2024-batch1-science.html",
    mirrorContentFileName: "undergraduate1-science-mirror-article-content.html",
    imageUrlListFileName: "undergraduate1-science-image-urls.txt",
    mirrorSubjectLabel: "理科",
    articleTitleNeedle: "2024年河南省普通高招本科一批院校平行投档分数线",
    expectedImageUrls: 7,
    expectedRecords: 681,
    scoreRange: [497, 696],
    rankRange: [94, 152728],
    rankUsage: "henan-2024-legacy-science-filing-rank",
    rankCategory: "普通类理科",
    recordIdPrefix: "2024-henan-undergraduate1-science-filing",
  },
  "batch1-liberal": {
    sourceKey: "batch1-liberal",
    sourceSlug: "undergraduate1-liberal",
    defaultOut: "data/admissions/official-content-mirror-henan-undergraduate1-liberal-filing-2024-zizzs-import.json",
    subjectType: "文科",
    originalSubject: "文科",
    batch: "本科一批",
    sourceId: "official-content-mirror-henan-undergraduate1-filing-2024-liberal-zizzs",
    officialArticleUrl: "https://gaokao.haedu.cn/501/552/2024/0721/135558.html",
    mirrorUrl: "https://www.zizzs.com/gk/gaokao/171102.html",
    datacenterUrl: "https://datacenter.haeea.cn/PagePZQuery/ShowPZTDTJ.aspx?yearTip=2024&pc=1&kl=1",
    officialFileName: "official-henan-2024-undergraduate1-page.html",
    mirrorFileName: "zizzs-171102-henan-2024-batch1-liberal.html",
    mirrorContentFileName: "undergraduate1-liberal-mirror-article-content.html",
    imageUrlListFileName: "undergraduate1-liberal-image-urls.txt",
    mirrorSubjectLabel: "文科",
    articleTitleNeedle: "2024年河南省普通高招本科一批院校平行投档分数线",
    expectedImageUrls: 5,
    expectedRecords: 395,
    scoreRange: [524, 658],
    rankRange: [36, 24082],
    rankUsage: "henan-2024-legacy-liberal-filing-rank",
    rankCategory: "普通类文科",
    recordIdPrefix: "2024-henan-undergraduate1-liberal-filing",
  },
};
let ACTIVE_CONFIG = SOURCE_CONFIGS[DEFAULT_SOURCE];

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
    `  node scripts/import-official-content-mirror-henan-undergraduate1-filing-2024-zizzs.mjs --source batch1-science --out ${SOURCE_CONFIGS["batch1-science"].defaultOut}`,
    `  node scripts/import-official-content-mirror-henan-undergraduate1-filing-2024-zizzs.mjs --source batch1-liberal --out ${SOURCE_CONFIGS["batch1-liberal"].defaultOut}`,
    "  node scripts/import-official-content-mirror-henan-undergraduate1-filing-2024-zizzs.mjs --use-cache",
    "",
    "Imports the 2024 Henan undergraduate batch-1 liberal/science filing lines from official-content mirror images.",
    "The official article links to the protected HAEEA data-center page; the mirror page provides the visible table images.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--source") args.source = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }
  if (!SOURCE_CONFIGS[args.source]) {
    throw new Error(`Unsupported --source ${args.source}; expected one of ${Object.keys(SOURCE_CONFIGS).join(", ")}`);
  }
  if (!args.out) args.out = SOURCE_CONFIGS[args.source].defaultOut;
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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function downloadBinary(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "image/png,image/*,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function extractOfficialArticleMeta(html) {
  const title = cleanHtmlText(/<div class="info-title">\s*([\s\S]*?)\s*<\/div>/i.exec(html)?.[1] ||
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
  const desc = /<div class="info-desc">([\s\S]*?)<\/div>/i.exec(html)?.[1] || "";
  const parts = [...desc.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => cleanHtmlText(m[1]));
  const publishedAt = parts.find((part) => /^\d{4}-\d{2}-\d{2}/.test(part)) || "2024-07-21 17:45:06";
  const publisher = parts.find((part) => part.includes("来源"))?.replace(/^来源[:：]?/, "") || "河南省教育考试院";
  if (!title.includes(ACTIVE_CONFIG.articleTitleNeedle)) {
    throw new Error(`Unexpected official article title: ${title}`);
  }
  if (!html.includes(ACTIVE_CONFIG.datacenterUrl.replaceAll("&", "&amp;")) && !html.includes(ACTIVE_CONFIG.datacenterUrl)) {
    throw new Error("Official article did not contain the expected HAEEA data-center URL.");
  }
  return { title, publishedAt, publisher };
}

function extractMirrorPayload(html) {
  const nuxt = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  if (!nuxt) throw new Error("Could not find Nuxt payload in mirror page.");
  const payload = JSON.parse(nuxt);
  const titleNeedle = `本科一批院校平行投档分数线（${ACTIVE_CONFIG.mirrorSubjectLabel}）`;
  const content = payload.find((item) =>
    typeof item === "string" &&
    item.includes("ShowPZTDTJ.aspx?yearTip=2024") &&
    item.includes("<img") &&
    item.includes(titleNeedle)
  );
  if (!content) throw new Error("Could not find mirror article content with image table.");
  const title = payload.find((item) => typeof item === "string" && item.includes(`2024年河南省本科一批院校平行投档分数线（${ACTIVE_CONFIG.mirrorSubjectLabel}）`)) ||
    `2024年河南省本科一批院校平行投档分数线（${ACTIVE_CONFIG.mirrorSubjectLabel}）`;
  const imageUrls = [...content.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi)].map((match) => match[1]);
  if (imageUrls.length !== ACTIVE_CONFIG.expectedImageUrls) {
    throw new Error(`Expected ${ACTIVE_CONFIG.expectedImageUrls} mirror images, got ${imageUrls.length}`);
  }
  return { title, content, imageUrls };
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

function splitSchoolMeta(rawMid) {
  const typeNames = [
    "综合",
    "理工",
    "师范",
    "农林",
    "财经",
    "医科",
    "中医",
    "药科",
    "政法",
    "交通",
    "邮电",
    "邮",
    "语言",
    "艺术",
    "体育",
    "民族",
    "军事",
    "其他",
  ];
  const normalized = String(rawMid || "")
    .replace(/[|｜]/g, " ")
    .replace(/^\s*[一—-]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const typeName of typeNames) {
    if (normalized === typeName) return { schoolType: typeName, schoolLocation: "" };
    if (normalized.startsWith(typeName)) {
      return {
        schoolType: typeName,
        schoolLocation: normalized.slice(typeName.length).replace(/^\s*[一—-]?\s*/, "").trim(),
      };
    }
  }
  const match = normalized.match(/^(\S+)\s*(.*)$/);
  return {
    schoolType: match?.[1] || "",
    schoolLocation: match?.[2] || "",
  };
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
    .filter((item) => item.y > 55 && item.text && !/^(代码|院校|类型|地域|投档线|位次|2024\|?)$/.test(item.text))
    .sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);

  const clusters = [];
  for (const item of candidates) {
    const cy = item.y + item.h / 2;
    let cluster = clusters.at(-1);
    if (!cluster || Math.abs(cluster.cy - cy) > 14) {
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
    const codeMatch = left.match(/\b(\d{4})\b/);
    if (!codeMatch) {
      skipped.missingCode += 1;
      continue;
    }
    const schoolName = left
      .slice(left.indexOf(codeMatch[1]) + 4)
      .replace(/^[\s|｜]+/, "")
      .replace(/\s+/g, "")
      .trim();
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
    const scoreCell = numericCells.find((item) => item.x >= 610 && item.x < 710 && /^\d{3}$/.test(item.text));
    const rankCell = numericCells.find((item) => item.x >= 710 && /^\d{1,6}$/.test(item.text));
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
    if (!Number.isFinite(minScore) || minScore < 450 || minScore > 750) {
      skipped.invalidScore += 1;
      continue;
    }
    if (!Number.isFinite(minRank) || minRank < 1 || minRank > 300_000) {
      skipped.invalidRank += 1;
      continue;
    }

    const mid = items
      .filter((item) => item.x >= 390 && item.x < 630)
      .map((item) => item.text.replace(/[|｜]/g, " "))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const { schoolType, schoolLocation } = splitSchoolMeta(mid);
    rows.push({
      imageId,
      ocrRowTop: Math.round(cluster.cy),
      schoolCode: codeMatch[1],
      schoolName,
      schoolType,
      schoolLocation,
      minScore,
      minRank,
      ocrConfidence: {
        score: scoreCell.confidence,
        rank: rankCell.confidence,
      },
      rawMid: mid,
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

function buildRecords({ rows, imageNotes }) {
  return rows.map((row, index) => {
    const imageNote = imageNotes.find((item) => item.imageId === row.imageId);
    return {
      id: `${ACTIVE_CONFIG.recordIdPrefix}-${hash([
        row.schoolCode,
        row.schoolName,
        row.minScore,
        row.minRank,
        row.imageId,
        row.ocrRowTop,
      ].join("|"))}`,
      province: PROVINCE,
      year: YEAR,
      subjectType: ACTIVE_CONFIG.subjectType,
      batch: ACTIVE_CONFIG.batch,
      schoolName: row.schoolName,
      schoolCode: row.schoolCode,
      schoolTags: [
        "河南官方内容镜像投档线",
        ACTIVE_CONFIG.batch,
        ACTIVE_CONFIG.subjectType,
        "score+rank",
      ],
      dataType: "institution-admission",
      majorName: "院校平行投档线",
      majorCode: "",
      majorGroup: `${ACTIVE_CONFIG.batch}院校平行投档分数线 / 河南院校代码 ${row.schoolCode}`,
      schoolType: row.schoolType || null,
      schoolLocation: row.schoolLocation || null,
      disciplineCodes: [],
      planCount: null,
      minScore: row.minScore,
      minRankStart: row.minRank,
      minRankEnd: row.minRank,
      rankRangeText: String(row.minRank),
      rankUsage: ACTIVE_CONFIG.rankUsage,
      rankCategory: ACTIVE_CONFIG.rankCategory,
      sourceId: ACTIVE_CONFIG.sourceId,
      sourceQuality: "official-content-mirror-henan-2024-undergraduate1-institution-filing-score-rank-image-ocr",
      sourceUrl: ACTIVE_CONFIG.officialArticleUrl,
      sourceDatacenterUrl: ACTIVE_CONFIG.datacenterUrl,
      sourceMirrorUrl: ACTIVE_CONFIG.mirrorUrl,
      sourceImageUrl: imageNote?.url || "",
      sourceImageFile: imageNote?.file || "",
      sourceImageSha256: imageNote?.sha256 || "",
      sourcePage: Number(row.imageId.split("_").at(-1)) || imageNote?.index || null,
      sourceRowNumber: index + 1,
      sourceSchoolRaw: row.schoolCode,
      sourceScoreOcrRule: "macos-vision-row-table-fixed-columns",
      sourceRankOcrRule: "macos-vision-row-table-fixed-columns",
      ocrRowTop: row.ocrRowTop,
      ocrConfidence: row.ocrConfidence,
      rawMid: row.rawMid,
      rawText: row.rawText,
      cautions: [
        "该记录来自河南省教育考试院官方文章链接到的数据中心表，由自主选拔在线镜像图片可见内容抽取。",
        "考试院数据中心页面当前需要浏览器验证，运行库按 official-content-mirror 分层，不把该记录标为直连 official 数据。",
        "2024年河南仍为文科/理科旧高考口径；不能与2025年起新高考物理类/历史类院校专业组口径直接混用。",
        "该表是院校投档线 score+rank 数据，不等同于专业录取分或最终录取概率。",
        "图片表经 macOS Vision OCR 后按固定列坐标抽取，正式填报前仍须回考试院数据中心、原图、当年招生计划和院校招生章程复核。",
      ],
    };
  });
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];
  const duplicates = [];
  for (const record of records) {
    const key = [record.schoolCode, record.schoolName, record.minScore, record.minRankStart, record.sourceImageFile, record.ocrRowTop].join("|");
    if (seen.has(key)) {
      duplicates.push(record);
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return { deduped, duplicates };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  ACTIVE_CONFIG = SOURCE_CONFIGS[args.source];

  ensureDir(RAW_ROOT);
  ensureDir(TMP_ROOT);
  const officialFile = path.join(RAW_ROOT, ACTIVE_CONFIG.officialFileName);
  const mirrorFile = path.join(RAW_ROOT, ACTIVE_CONFIG.mirrorFileName);
  const mirrorContentFile = path.join(RAW_ROOT, ACTIVE_CONFIG.mirrorContentFileName);
  const imageUrlListFile = path.join(RAW_ROOT, ACTIVE_CONFIG.imageUrlListFileName);

  let officialHtml;
  if (args.useCache && fs.existsSync(officialFile)) officialHtml = fs.readFileSync(officialFile, "utf8");
  else {
    officialHtml = await fetchText(ACTIVE_CONFIG.officialArticleUrl);
    fs.writeFileSync(officialFile, officialHtml);
  }
  const officialMeta = extractOfficialArticleMeta(officialHtml);

  let mirrorHtml;
  if (args.useCache && fs.existsSync(mirrorFile)) mirrorHtml = fs.readFileSync(mirrorFile, "utf8");
  else {
    mirrorHtml = await fetchText(ACTIVE_CONFIG.mirrorUrl);
    fs.writeFileSync(mirrorFile, mirrorHtml);
  }
  const mirror = extractMirrorPayload(mirrorHtml);
  fs.writeFileSync(mirrorContentFile, mirror.content);
  fs.writeFileSync(imageUrlListFile, `${mirror.imageUrls.join("\n")}\n`);

  const visionHelper = compileVisionHelper();
  const imageNotes = [];
  const rows = [];
  const seenImageShas = new Map();
  for (const [index, url] of mirror.imageUrls.entries()) {
    const imageId = path.basename(new URL(url).pathname, ".png");
    const imageFile = path.join(RAW_ROOT, `${imageId}.png`);
    if (!(args.useCache && fs.existsSync(imageFile))) {
      fs.writeFileSync(imageFile, await downloadBinary(url));
    }
    const imageSha256 = sha256File(imageFile);
    const duplicateOf = seenImageShas.get(imageSha256);
    if (duplicateOf) {
      imageNotes.push({
        imageId,
        index: index + 1,
        url,
        file: rel(imageFile),
        width: null,
        height: null,
        sha256: imageSha256,
        duplicateOf,
        duplicateImage: true,
        ocrObservations: 0,
        rowCandidates: 0,
        records: 0,
        skipped: { duplicateImage: 1 },
      });
      continue;
    }
    seenImageShas.set(imageSha256, imageId);

    const tsvFile = path.join(RAW_ROOT, `${imageId}.vision.tsv`);
    let tsv;
    if (args.useCache && fs.existsSync(tsvFile)) tsv = fs.readFileSync(tsvFile, "utf8");
    else {
      tsv = run(visionHelper, [imageFile], { timeout: 240_000 });
      fs.writeFileSync(tsvFile, tsv);
    }
    const parsed = parseVisionTsv(tsv, imageId);
    rows.push(...parsed.rows);
    imageNotes.push({
      imageId,
      index: index + 1,
      url,
      file: rel(imageFile),
      tsvFile: rel(tsvFile),
      width: parsed.width,
      height: parsed.height,
      sha256: imageSha256,
      ocrObservations: parsed.observations,
      rowCandidates: parsed.clusters,
      records: parsed.rows.length,
      skipped: parsed.skipped,
    });
  }

  const { deduped: records, duplicates } = dedupeRecords(buildRecords({ rows, imageNotes }));
  const scoreValues = records.map((record) => record.minScore);
  const rankValues = records.map((record) => record.minRankStart);
  const expectedRecords = ACTIVE_CONFIG.expectedRecords;
  if (records.length !== expectedRecords) {
    throw new Error(`Expected ${expectedRecords} records, got ${records.length}`);
  }
  if (duplicates.length) throw new Error(`Unexpected duplicate rows: ${duplicates.length}`);
  if (Math.min(...scoreValues) !== ACTIVE_CONFIG.scoreRange[0] || Math.max(...scoreValues) !== ACTIVE_CONFIG.scoreRange[1]) {
    throw new Error(`Unexpected score range ${Math.min(...scoreValues)}-${Math.max(...scoreValues)}`);
  }
  if (Math.min(...rankValues) !== ACTIVE_CONFIG.rankRange[0] || Math.max(...rankValues) !== ACTIVE_CONFIG.rankRange[1]) {
    throw new Error(`Unexpected rank range ${Math.min(...rankValues)}-${Math.max(...rankValues)}`);
  }

  records.sort((a, b) =>
    a.minRankStart - b.minRankStart ||
    b.minScore - a.minScore ||
    a.schoolCode.localeCompare(b.schoolCode, "zh-Hans-CN") ||
    a.schoolName.localeCompare(b.schoolName, "zh-Hans-CN")
  );

  const outFile = path.isAbsolute(args.out) ? args.out : path.join(PROJECT_ROOT, args.out);
  ensureDir(path.dirname(outFile));
  const payload = {
    dataset: `${ACTIVE_CONFIG.sourceId}-import`,
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      subjectType: ACTIVE_CONFIG.subjectType,
      batch: ACTIVE_CONFIG.batch,
      dataType: "institution-admission",
      sourceLayer: "official-content-mirror",
    },
    notes: [
      `官方河南高考信息网页面由河南省教育考试院发布，并链接到 HAEEA 数据中心 2024 ${ACTIVE_CONFIG.batch}${ACTIVE_CONFIG.subjectType}投档线。`,
      "HAEEA 数据中心当前对命令行抓取返回验证/防护页，本导入使用自主选拔在线镜像图片作为可见内容证据，按 official-content-mirror 分层。",
      "源图公开最低投档分和位次，运行层保留 score+rank 院校层投档边界；不生成专业录取分或录取概率。",
      "河南 2024 仍为文科/理科旧高考口径，不与 2025 新高考物理类/历史类直接混用。",
    ],
    summary: {
      records: records.length,
      imageCount: imageNotes.length,
      subjectType: ACTIVE_CONFIG.subjectType,
      minScore: Math.min(...scoreValues),
      maxScore: Math.max(...scoreValues),
      minRank: Math.min(...rankValues),
      maxRank: Math.max(...rankValues),
      sourceQuality: "official-content-mirror-henan-2024-undergraduate1-institution-filing-score-rank-image-ocr",
      datacenterUrl: ACTIVE_CONFIG.datacenterUrl,
      officialArticleUrl: ACTIVE_CONFIG.officialArticleUrl,
      mirrorUrl: ACTIVE_CONFIG.mirrorUrl,
    },
    ocrAudit: {
      rowParsing: "macOS Vision full-image OCR, y-clustered table rows, fixed x-ranges for code/name/type/location/score/rank columns",
      imageNotes,
      duplicateRows: duplicates.length,
      scoreRange: [Math.min(...scoreValues), Math.max(...scoreValues)],
      rankRange: [Math.min(...rankValues), Math.max(...rankValues)],
    },
    sourceNotes: [
      {
        id: ACTIVE_CONFIG.sourceId,
        title: `${officialMeta.title}（${ACTIVE_CONFIG.subjectType}镜像图片 OCR 导入）`,
        publisher: officialMeta.publisher,
        url: ACTIVE_CONFIG.officialArticleUrl,
        datacenterUrl: ACTIVE_CONFIG.datacenterUrl,
        mirrorUrl: ACTIVE_CONFIG.mirrorUrl,
        publishedAt: officialMeta.publishedAt,
        quality: "official-content-mirror-henan-2024-undergraduate1-institution-filing-score-rank-image-ocr",
        usage: `河南省教育考试院官方页面链接到的数据中心表，经自主选拔在线镜像图片和本地 OCR 抽取 ${records.length} 条${ACTIVE_CONFIG.subjectType}${ACTIVE_CONFIG.batch}院校投档分数线及位次；按 official-content-mirror score+rank 院校投档边界使用。`,
        parsedRecords: records.length,
        htmlSha256: sha256(officialHtml),
        mirrorHtmlSha256: sha256(mirrorHtml),
        rawFiles: {
          officialPage: rel(officialFile),
          mirrorPage: rel(mirrorFile),
          mirrorContent: rel(mirrorContentFile),
          imageUrlList: rel(imageUrlListFile),
        },
        imageNotes,
      },
    ],
    records,
  };

  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${rel(outFile)} with ${records.length} records`);
  console.log(`scoreRange=${payload.summary.minScore}-${payload.summary.maxScore} rankRange=${payload.summary.minRank}-${payload.summary.maxRank}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
