#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/gk100-jilin-vocational-2025-local-image-import.json";
const RAW_DIR = path.join(PROJECT_ROOT, "data", "admissions", "raw", "gk100-jilin-vocational-2025");
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-jilin-vocational-2025-import");
const VISION_HELPER = path.join(PROJECT_ROOT, "scripts", "vision-table-row-ocr.swift");
const PAGE_URL = "https://www.gk100.com/read_103457.htm";
const YEAR = 2025;
const PROVINCE = "吉林";
const SCORE_OVERRIDES = new Map([
  [
    "物理类|本科批|长春理工大学|第014组",
    {
      minScore: 511,
      reason: "OCR read the score cell as 541; row crop confirms the image value is 511.",
    },
  ],
  [
    "物理类|本科批|白城师范学院|第017组",
    {
      minScore: 411,
      reason: "OCR read the score cell as 444; row crop confirms the image value is 411.",
    },
  ],
]);

const IMAGE_SOURCES = [
  {
    subjectType: "物理类",
    sourceSubjectRaw: "物理",
    batch: "本科批",
    recordType: "undergraduate",
    imageUrl: "https://p1.gk100.com/article/20251118/566d9b65494fcc84.png",
    localName: "physics-undergraduate.png",
    scoreCenterX: 730,
    rankCenterX: 850,
  },
  {
    subjectType: "历史类",
    sourceSubjectRaw: "历史",
    batch: "本科批",
    recordType: "undergraduate",
    imageUrl: "https://p1.gk100.com/article/20251118/dead1be7b7c1499b.png",
    localName: "history-undergraduate.png",
    scoreCenterX: 735,
    rankCenterX: 868,
  },
  {
    subjectType: "物理类",
    sourceSubjectRaw: "物理",
    batch: "普通类高职（专科）批",
    recordType: "vocational",
    imageUrl: "https://p1.gk100.com/article/20251118/51231fc8698ec6bc.png",
    localName: "physics-vocational-tail.png",
    scoreCenterX: 742,
    rankCenterX: 879,
  },
  {
    subjectType: "历史类",
    sourceSubjectRaw: "历史",
    batch: "普通类高职（专科）批",
    recordType: "vocational",
    imageUrl: "https://p1.gk100.com/article/20251118/18e79cdd890c100e.png",
    localName: "history-vocational-tail.png",
    scoreCenterX: 764,
    rankCenterX: 898,
  },
];

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--tmp-root") args.tmpRoot = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--swiftc") args.swiftc = argv[++i];
    else if (item === "--vision-helper") args.visionHelper = argv[++i];
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    `  node scripts/import-gk100-jilin-vocational-2025.mjs --out ${DEFAULT_OUT}`,
    "",
    "Imports GK100 2025 Jilin local undergraduate and higher-vocational/specialist image tables as third-party partial score+rank seed records.",
  ].join("\n");
}

function hash(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    timeout: options.timeout ?? 180_000,
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

function commandWorks(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: PROJECT_ROOT, encoding: "utf8" });
  return !result.error && result.status === 0;
}

function findCommand(explicit, defaults, label, probeArgs = ["--version"]) {
  for (const candidate of [explicit, ...defaults].filter(Boolean)) {
    if (commandWorks(candidate, probeArgs)) return candidate;
  }
  throw new Error(`Could not find ${label}.`);
}

function compileVisionHelper(args, tmpRoot) {
  if (args.visionHelper) return path.resolve(args.visionHelper);
  const swiftc = findCommand(args.swiftc, ["swiftc", "/usr/bin/swiftc"], "swiftc");
  const helperBinary = path.join(tmpRoot, "vision-table-row-ocr");
  const needsCompile = !fs.existsSync(helperBinary) ||
    fs.statSync(helperBinary).mtimeMs < fs.statSync(VISION_HELPER).mtimeMs;
  if (needsCompile) run(swiftc, [VISION_HELPER, "-o", helperBinary], { timeout: 240_000 });
  return helperBinary;
}

async function fetchBuffer(url, accept = "*/*") {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-jilin-vocational-image-importer/1.0",
      accept,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchText(url) {
  return (await fetchBuffer(url, "text/html,application/xhtml+xml")).toString("utf8");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/[|｜]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return cleanText(value).replace(/\s+/g, "");
}

function cleanHtmlText(html) {
  return cleanText(String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function pageTitle(html) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return cleanHtmlText(h1 || title || "吉林2025高考录取分数线一览表");
}

function imageDimensions(file, sipsCommand) {
  const output = run(sipsCommand, ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error(`Could not read image dimensions for ${file}`);
  return { width, height };
}

function parseVisionItems(stdout, crop) {
  const parsed = JSON.parse(stdout);
  const scaleX = parsed.width / crop.width;
  const scaleY = parsed.height / crop.height;
  return (parsed.observations || [])
    .map((item) => {
      const centerX = (item.x + item.width / 2) * parsed.width;
      const centerY = (1 - item.y - item.height / 2) * parsed.height;
      return {
      text: cleanText(item.text),
      confidence: Number(item.confidence) || 0,
        x: crop.x + centerX / scaleX,
        y: crop.y + centerY / scaleY,
        width: item.width * parsed.width / scaleX,
        height: item.height * parsed.height / scaleY,
      };
    })
    .filter((item) => item.text);
}

function visionItemsForImage(file, dimensions, visionHelper) {
  const chunkHeight = dimensions.height > 2600 ? 1200 : dimensions.height;
  const overlap = dimensions.height > 2600 ? 80 : 0;
  const scale = dimensions.height > 2600 ? 2 : 1;
  const items = [];
  for (let y = 0; y < dimensions.height; y += chunkHeight - overlap) {
    const height = Math.min(chunkHeight, dimensions.height - y);
    const crop = { x: 0, y, width: dimensions.width, height };
    const stdout = run(visionHelper, [
      file,
      "--raw",
      String(crop.x),
      String(crop.y),
      String(crop.width),
      String(crop.height),
    ], {
      timeout: 240_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { VISION_TABLE_OCR_SCALE: String(scale) },
    });
    items.push(...parseVisionItems(stdout, crop));
    if (y + height >= dimensions.height) break;
  }

  const deduped = [];
  for (const item of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const duplicate = deduped.some((existing) =>
      existing.text === item.text &&
      Math.abs(existing.x - item.x) < 6 &&
      Math.abs(existing.y - item.y) < 6
    );
    if (!duplicate) deduped.push(item);
  }
  return deduped
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function nearestText(items, y, left, right, tolerance = 16) {
  const candidates = items
    .filter((item) => item.x >= left && item.x < right && Math.abs(item.y - y) <= tolerance)
    .sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y) || a.x - b.x);
  return candidates.map((item) => item.text).join("");
}

function cropCell(imagePath, tmpDir, label, y, centerX, width, height, sipsCommand) {
  const out = path.join(tmpDir, `${label}-${Math.round(y)}-${Math.round(centerX)}.png`);
  const top = Math.max(0, Math.round(y - height / 2));
  const left = Math.max(0, Math.round(centerX - width / 2));
  run(sipsCommand, [
    "-c",
    String(height),
    String(width),
    "--cropOffset",
    String(top),
    String(left),
    imagePath,
    "-o",
    out,
  ], { timeout: 60_000 });
  return out;
}

function digitsFromCell(imagePath, tmpDir, label, y, centerX, tesseractCommand, sipsCommand, options = {}) {
  const attempts = [
    { width: 124, height: 36 },
    { width: 150, height: 42 },
    { width: 170, height: 48 },
  ];
  const minDigits = options.minDigits ?? 1;
  const maxDigits = options.maxDigits ?? Infinity;
  for (const attempt of attempts) {
    const cell = cropCell(imagePath, tmpDir, label, y, centerX, attempt.width, attempt.height, sipsCommand);
    const stdout = run(tesseractCommand, [
      cell,
      "stdout",
      "--psm",
      "7",
      "-l",
      "eng",
      "-c",
      "tessedit_char_whitelist=0123456789",
    ], { timeout: 60_000 });
    const digits = stdout.replace(/\D/g, "");
    if (digits.length >= minDigits && digits.length <= maxDigits) return Number(digits);
  }
  return null;
}

function normalizeSubject(value) {
  const text = compact(value);
  if (/物理/.test(text)) return "物理类";
  if (/历史/.test(text)) return "历史类";
  return "";
}

function normalizeMajorGroup(value) {
  const text = compact(value)
    .replace(/組/g, "组")
    .replace(/[笆筚]/g, "第")
    .replace(/[紹始丝经好路岁年冬]/g, "组");
  const match = /第?([0-9OolIl]{3})组?([\s\S]*)/.exec(text);
  if (!match) return text;
  const digits = match[1]
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1");
  return `第${digits}组${match[2] || ""}`;
}

function scoreOverrideFor(source, schoolName, majorGroup) {
  return SCORE_OVERRIDES.get([source.subjectType, source.batch, schoolName, majorGroup].join("|")) || null;
}

function schoolTags(name) {
  const tags = ["吉林本地"];
  if (/职业|专科|高等|技术/.test(name)) tags.unshift("高职/专科");
  return tags;
}

function disciplineCodes(name) {
  const text = String(name ?? "");
  const out = new Set();
  if (/医学|医药|卫生|护理|健康|康美|口腔/.test(text)) out.add("10");
  if (/师范|教育/.test(text)) out.add("04");
  if (/交通|汽车|铁道|航空|通用航空/.test(text)) out.add("08");
  if (/信息|数字|科技|电子|工程|工业/.test(text)) out.add("08");
  if (/金融|经济/.test(text)) out.add("02");
  if (/司法|警官/.test(text)) out.add("03");
  if (/城市|现代|管理/.test(text)) out.add("12");
  return [...out];
}

function sourceIdForImage(source) {
  return `gk100-jilin-${source.recordType}-2025-${source.subjectType === "物理类" ? "physics" : "history"}-${hash(source.imageUrl, 10)}`;
}

function sourceQualityFor(source, seed = false) {
  const base = source.recordType === "vocational"
    ? "third-party-partial-local-vocational-image-ocr-score-rank"
    : "third-party-partial-local-undergraduate-image-ocr-score-rank";
  return seed ? `${base}-seed` : base;
}

function buildRecord({ source, row, rowNumber }) {
  const id = `2025-jl-gk100-${source.recordType}-${hash([
    source.subjectType,
    source.batch,
    row.schoolName,
    row.majorGroup,
    row.minScore,
    row.minRank,
  ].join("|"))}`;
  return {
    id,
    province: PROVINCE,
    year: YEAR,
    subjectType: source.subjectType,
    batch: source.batch,
    schoolName: row.schoolName,
    schoolTags: schoolTags(row.schoolName),
    dataType: source.recordType === "vocational" ? "vocational-admission" : "major-group-admission",
    majorName: source.recordType === "vocational"
      ? "院校专业组投档线（第三方省内专科院校排名）"
      : "院校专业组投档线（第三方省内本科院校排名）",
    majorGroup: row.majorGroup,
    disciplineCodes: disciplineCodes(row.schoolName),
    minScore: row.minScore,
    minRankStart: row.minRank,
    minRankEnd: row.minRank,
    rankRangeText: String(row.minRank),
    sourceId: sourceIdForImage(source),
    sourceQuality: sourceQualityFor(source, true),
    sourceUrl: PAGE_URL,
    sourceImageUrl: source.imageUrl,
    sourceRowNumber: rowNumber,
    sourceSubjectRaw: source.sourceSubjectRaw,
    ocrSchoolRaw: row.schoolNameRaw,
    ocrMajorGroupRaw: row.majorGroupRaw,
    ocrRowTop: Math.round(row.y),
    ...(row.scoreOverride ? {
      ocrScoreOriginal: row.scoreOverride.original,
      ocrScoreOverride: row.scoreOverride.reason,
    } : {}),
    cautions: [
      "该表为高考100第三方整理的吉林2025省内大学分数线图片，不是吉林省教育考试院全量投档/录取表。",
      source.recordType === "vocational"
        ? "当前仅作为吉林本地高职专科 score+rank 候选种子；外省院校在吉林招生和官方全量投档表仍待补。"
        : "当前仅作为吉林本地本科院校专业组 score+rank 候选种子；外省院校在吉林招生和官方全量投档表仍待补。",
      "院校专业组投档线只能判断进档边界，不能替代专业录取结果；正式填报前必须回吉林省教育考试院、院校招生网、招生章程和当年计划复核。",
    ],
  };
}

function parseImageRows({ source, imagePath, tmpDir, dimensions, visionItems, tesseractCommand, sipsCommand }) {
  const schoolItems = visionItems
    .filter((item) => item.x < 330)
    .filter((item) => item.y > 42)
    .filter((item) => /[\u4e00-\u9fff]/.test(item.text))
    .filter((item) => !/学校名|首选科目|专业组|分数|位次/.test(item.text))
    .sort((a, b) => a.y - b.y);

  const rows = [];
  const badRows = [];
  for (const item of schoolItems) {
    const subjectRaw = nearestText(visionItems, item.y, 330, 505);
    const subject = normalizeSubject(subjectRaw) || source.subjectType;
    const majorGroupRaw = nearestText(visionItems, item.y, 505, Math.min(720, dimensions.width));
    const majorGroup = normalizeMajorGroup(majorGroupRaw);
    let minScore = digitsFromCell(imagePath, tmpDir, `${source.subjectType}-score`, item.y, source.scoreCenterX, tesseractCommand, sipsCommand, { minDigits: 3, maxDigits: 3 });
    const minRank = digitsFromCell(imagePath, tmpDir, `${source.subjectType}-rank`, item.y, source.rankCenterX, tesseractCommand, sipsCommand, { minDigits: 2, maxDigits: 6 });
    const scoreOverride = scoreOverrideFor(source, cleanText(item.text), majorGroup);
    const scoreOverrideAudit = scoreOverride && Number.isFinite(minScore)
      ? { original: minScore, reason: scoreOverride.reason }
      : null;
    if (scoreOverride) minScore = scoreOverride.minScore;
    const row = {
      y: item.y,
      schoolName: cleanText(item.text),
      schoolNameRaw: item.text,
      subject,
      majorGroup,
      majorGroupRaw,
      minScore,
      minRank,
      scoreOverride: scoreOverrideAudit,
    };
    if (
      subject !== source.subjectType ||
      !majorGroup ||
      !Number.isFinite(minScore) ||
      minScore < 100 ||
      minScore > 750 ||
      !Number.isFinite(minRank) ||
      minRank <= 0
    ) {
      badRows.push(row);
    } else {
      rows.push(row);
    }
  }

  const duplicateKeys = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = [row.schoolName, source.subjectType, row.majorGroup, row.minScore, row.minRank].join("|");
    if (duplicateKeys.has(key)) continue;
    duplicateKeys.add(key);
    deduped.push(row);
  }
  for (let i = 1; i < deduped.length; i += 1) {
    const previous = deduped[i - 1];
    const current = deduped[i];
    if (current.minScore > previous.minScore && current.minRank === previous.minRank) {
      current.scoreOverride = {
        original: current.minScore,
        reason: `OCR score increased inside the same rank plateau (${current.minRank}); inherited previous row score ${previous.minScore}.`,
      };
      current.minScore = previous.minScore;
    }
  }
  return { rows: deduped, badRows };
}

function validateSubjectRows(subjectType, rows) {
  const errors = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].minScore > rows[i - 1].minScore) {
      errors.push(`${subjectType} score order increased at row ${i + 1}: ${rows[i - 1].minScore} ${rows[i - 1].schoolName} ${rows[i - 1].majorGroup} y=${rows[i - 1].ocrRowTop} -> ${rows[i].minScore} ${rows[i].schoolName} ${rows[i].majorGroup} y=${rows[i].ocrRowTop}`);
    }
    if (rows[i].minRank < rows[i - 1].minRank) {
      errors.push(`${subjectType} rank order decreased at row ${i + 1}: ${rows[i - 1].minRank} ${rows[i - 1].schoolName} ${rows[i - 1].majorGroup} y=${rows[i - 1].ocrRowTop} -> ${rows[i].minRank} ${rows[i].schoolName} ${rows[i].majorGroup} y=${rows[i].ocrRowTop}`);
    }
  }
  return errors;
}

function summarize(records) {
  const bySubject = {};
  for (const subjectType of [...new Set(records.map((record) => record.subjectType))].sort()) {
    const subset = records.filter((record) => record.subjectType === subjectType);
    bySubject[subjectType] = {
      records: subset.length,
      scoreRange: [Math.min(...subset.map((record) => record.minScore)), Math.max(...subset.map((record) => record.minScore))],
      rankRange: [Math.min(...subset.map((record) => record.minRankStart)), Math.max(...subset.map((record) => record.minRankEnd))],
      below250: subset.filter((record) => record.minScore < 250).length,
      below300: subset.filter((record) => record.minScore < 300).length,
    };
  }
  return {
    records: records.length,
    bySubject,
    schools: new Set(records.map((record) => record.schoolName)).size,
    below250: records.filter((record) => record.minScore < 250).length,
    below300: records.filter((record) => record.minScore < 300).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const tmpRoot = path.resolve(args.tmpRoot || TMP_ROOT);
  fs.mkdirSync(tmpRoot, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const sipsCommand = findCommand(null, ["sips", "/usr/bin/sips"], "sips", ["--help"]);
  const tesseractCommand = findCommand(null, ["/opt/homebrew/bin/tesseract", "tesseract"], "tesseract");
  const visionHelper = compileVisionHelper(args, tmpRoot);

  const pageRawPath = path.join(RAW_DIR, "page.html");
  const pageHtml = args.useCache && fs.existsSync(pageRawPath)
    ? fs.readFileSync(pageRawPath, "utf8")
    : await fetchText(PAGE_URL);
  fs.writeFileSync(pageRawPath, pageHtml, "utf8");

  const records = [];
  const audit = {
    pageSha256: sha256File(pageRawPath),
    images: [],
    badRows: [],
    validationErrors: [],
  };

  for (const source of IMAGE_SOURCES) {
    const imageRawPath = path.join(RAW_DIR, source.localName);
    if (!args.useCache || !fs.existsSync(imageRawPath)) {
      fs.writeFileSync(imageRawPath, await fetchBuffer(source.imageUrl, "image/png,image/*"));
    }
    const dimensions = imageDimensions(imageRawPath, sipsCommand);
    const visionItems = visionItemsForImage(imageRawPath, dimensions, visionHelper);
    const subjectTmp = path.join(tmpRoot, source.subjectType);
    fs.mkdirSync(subjectTmp, { recursive: true });
    const parsed = parseImageRows({
      source,
      imagePath: imageRawPath,
      tmpDir: subjectTmp,
      dimensions,
      visionItems,
      tesseractCommand,
      sipsCommand,
    });
    const subjectRecords = parsed.rows.map((row, index) => buildRecord({ source, row, rowNumber: index + 1 }));
    records.push(...subjectRecords);
    audit.badRows.push(...parsed.badRows.map((row) => ({ subjectType: source.subjectType, ...row })));
    audit.validationErrors.push(...validateSubjectRows(`${source.subjectType}${source.batch}`, subjectRecords));
    audit.images.push({
      id: sourceIdForImage(source),
      subjectType: source.subjectType,
      batch: source.batch,
      recordType: source.recordType,
      url: source.imageUrl,
      rawPath: rel(imageRawPath),
      sha256: sha256File(imageRawPath),
      width: dimensions.width,
      height: dimensions.height,
      visionItems: visionItems.length,
      parsedRows: parsed.rows.length,
      badRows: parsed.badRows.length,
    });
  }

  const seen = new Set();
  const dedupedRecords = records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });

  if (audit.badRows.length || audit.validationErrors.length) {
    throw new Error(JSON.stringify({
      message: "Jilin GK100 vocational OCR import failed validation.",
      badRows: audit.badRows,
      validationErrors: audit.validationErrors,
    }, null, 2));
  }

  const title = pageTitle(pageHtml);
  const sourceNotes = IMAGE_SOURCES.map((source) => ({
    id: sourceIdForImage(source),
    title: `${title}（${source.sourceSubjectRaw}${source.recordType === "vocational" ? "专科" : "本科"}表）`,
    publisher: "高考100",
    url: PAGE_URL,
    imageUrl: source.imageUrl,
    quality: sourceQualityFor(source),
    usage: source.recordType === "vocational"
      ? `从高考100图片表抽取吉林2025${source.sourceSubjectRaw}省内高职专科/专科层院校专业组分数与位次；非考试院全量表，只作吉林专科候选种子和补数提示。`
      : `从高考100图片表抽取吉林2025${source.sourceSubjectRaw}省内本科院校专业组分数与位次；非考试院全量表，只作吉林本科候选种子和补数提示。`,
    rawPath: rel(path.join(RAW_DIR, source.localName)),
    parsedRecords: dedupedRecords.filter((record) => record.sourceId === sourceIdForImage(source)).length,
  }));

  const output = {
    dataset: "gk100-jilin-vocational-2025-local-image-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      batch: "本科批、普通类高职（专科）批",
      sourceUrl: PAGE_URL,
      sourceBoundary: "third-party-local-province-image-table; not official full filing table",
    },
    notes: [
      "该导入只覆盖高考100图片中吉林省内院校本科与专科层专业组，不覆盖外省院校在吉林招生。",
      "图片 OCR 使用 Vision 识别学校/专业组列，Tesseract 仅读数字格；所有分数、位次通过顺序校验后入库。",
      "sourceQuality 带 partial，构建器会继续保留吉林官方/学信网正式分数待补缺口。",
    ],
    summary: summarize(dedupedRecords),
    audit,
    sourceNotes,
    records: dedupedRecords,
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    out: rel(outPath),
    summary: output.summary,
    images: audit.images,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
