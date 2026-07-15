#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-xinjiang-single-vocational-2025");
const DEFAULT_URL = "https://www.xjzk.gov.cn/c/2025-08-20/494774.shtml";
const DEFAULT_OUT = "data/admissions/official-xinjiang-single-vocational-2025-import.json";
const VISION_HELPER = path.join(PROJECT_ROOT, "scripts", "vision-table-row-ocr.swift");
const YEAR = 2025;
const PROVINCE = "新疆";
const BATCH = "单列类高职（专科）批";
const SOURCE_ID = "official-xinjiang-single-vocational-2025";
const IMAGE_SUBJECTS = new Map([
  ["29731", { subjectType: "单列类历史类", originalSubject: "单列类（文史）" }],
  ["29732", { subjectType: "单列类历史类", originalSubject: "单列类（文史）" }],
  ["29733", { subjectType: "单列类物理类", originalSubject: "单列类（理工）" }],
  ["29734", { subjectType: "单列类物理类", originalSubject: "单列类（理工）" }],
  ["29735", { subjectType: "单列类物理类", originalSubject: "单列类（理工）" }],
]);
const ROW_CORRECTIONS = new Map([]);
const NAME_CORRECTIONS = new Map([
  ["天泮农学院", "天津农学院"],
  ["咯尔滨医科大学", "哈尔滨医科大学"],
  ["柒美大学", "集美大学"],
  ["潮南理工学院", "湖南理工学院"],
  ["新骝医科大学", "新疆医科大学"],
  ["賁岛滨海学院", "青岛滨海学院"],
  ["新躽工程学院", "新疆工程学院"],
  ["西安航室学院", "西安航空学院"],
  ["武品理工学院", "武昌理工学院"],
  ["肯岛工学院", "青岛工学院"],
  ["天泮仁愛学院", "天津仁爱学院"],
  ["潮北三峽航空学院", "湖北三峡航空学院"],
  ["塔里水理工学院", "塔里木理工学院"],
  ["长森中医药大学", "长春中医药大学"],
  ["黒龙江八一农垦大学", "黑龙江八一农垦大学"],
  ["福殚师范大学福建师范大学", "福建师范大学"],
  ["才立干好外经贸学院", "辽宁对外经贸学院"],
  ["产州戴海学院", "广州航海学院"],
  ["齐齐咯尔医学院", "齐齐哈尔医学院"],
  ["武汉生牧工程学院", "武汉生物工程学院"],
  ["新骝棽寥学院", "新疆警察学院"],
  ["东英才学院", "山东英才学院"],
  ["兰州信息科校学院", "兰州信息科技学院"],
  ["长森财经学院", "长春财经学院"],
  ["吉沝殏筑科校学院", "吉林建筑科技学院"],
  ["天泮外国语大学滨海外事学院", "天津外国语大学滨海外事学院"],
  ["产东理工学院", "广东理工学院"],
  ["西安浅车职业大学", "西安汽车职业大学"],
  ["天泮仁爱学院", "天津仁爱学院"],
  ["中国民用航空飞飞行学院", "中国民用航空飞行学院"],
  ["新多学院", "新乡学院"],
  ["翠枝花学院", "攀枝花学院"],
  ["出新华学院", "安徽新华学院"],
  ["美永州配业技术学院T永州职业技术学院", "永州职业技术学院"],
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xinjiang-single-vocational-2025.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xinjiang-single-vocational-2025.mjs --use-cache",
    "",
    "Imports Xinjiang 2025 single-category vocational official image filing scores.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--url") args.url = argv[++i];
    else if (item === "--html") args.html = argv[++i];
    else if (item === "--image-dir") args.imageDir = argv[++i];
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
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

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHtmlText(value) {
  return decodeEntities(String(value ?? "").replace(/<[^>]+>/g, " "));
}

async function downloadText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-xinjiang-single-vocational-importer/1.0",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function downloadBinary(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-xinjiang-single-vocational-importer/1.0",
      accept: "image/jpeg,image/*",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function extractPageMeta(html, pageUrl) {
  const title = cleanHtmlText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
  const publishedAt = decodeEntities(/发布时间[:：]\s*([^<]+)/.exec(html)?.[1] || "");
  if (!/新疆维吾尔自治区2025年普通高校招生单列类\s*高职（专科）批次投档情况/.test(title)) {
    throw new Error(`Unexpected Xinjiang single-category vocational page title: ${title}`);
  }
  const imageMeta = [];
  const regex = /<a\s+href=["']([^"']*\/upload\/resources\/image\/2025\/08\/20\/(2973[1-5])\.jpg)["'][^>]*>\s*<img\b([^>]*)>/gi;
  for (const match of html.matchAll(regex)) {
    const imageId = match[2];
    if (!IMAGE_SUBJECTS.has(imageId)) continue;
    const attrs = match[3] || "";
    const label = decodeEntities(/(?:title|alt)=["']([^"']+)["']/i.exec(attrs)?.[1] || "");
    imageMeta.push({
      imageId,
      url: new URL(match[1], pageUrl).href,
      label,
      ...IMAGE_SUBJECTS.get(imageId),
    });
  }
  const unique = [...new Map(imageMeta.map((item) => [item.imageId, item])).values()];
  if (unique.length !== IMAGE_SUBJECTS.size) {
    throw new Error(`Expected ${IMAGE_SUBJECTS.size} Xinjiang official JPG links, got ${unique.length}`);
  }
  return { title, publishedAt, imageMeta: unique };
}

function imageDimensions(file) {
  const output = run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Could not read image dimensions for ${file}`);
  }
  return { width, height };
}

function ensureVisionBinary() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const binary = path.join(TMP_ROOT, "vision-table-row-ocr");
  if (!fs.existsSync(binary) || fs.statSync(binary).mtimeMs < fs.statSync(VISION_HELPER).mtimeMs) {
    run("/usr/bin/swiftc", [VISION_HELPER, "-o", binary]);
  }
  return binary;
}

function visionItemsForImage(file, cacheDir, dimensions, visionBinary) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const imageId = path.basename(file).replace(/\.[^.]+$/, "");
  const chunkHeight = 4200;
  const chunkStep = 4000;
  const items = [];
  for (let y = 0; y < dimensions.height; y += chunkStep) {
    const height = Math.min(chunkHeight, dimensions.height - y);
    const cache = path.join(cacheDir, `${imageId}-${y}.json`);
    if (!fs.existsSync(cache) || fs.statSync(cache).size === 0) {
      const stdout = run(visionBinary, [
        file,
        "--raw",
        "0",
        String(y),
        String(dimensions.width),
        String(height),
      ]);
      fs.writeFileSync(cache, stdout, "utf8");
    }
    const parsed = JSON.parse(fs.readFileSync(cache, "utf8"));
    for (const observation of parsed.observations || []) {
      items.push({
        text: observation.text,
        confidence: Number(observation.confidence) || 0,
        x: observation.x * parsed.width,
        y: y + (1 - observation.y - observation.height / 2) * parsed.height,
        width: observation.width * parsed.width,
        height: observation.height * parsed.height,
      });
    }
    if (y + height >= dimensions.height) break;
  }
  return items;
}

function cleanDigits(value) {
  return String(value ?? "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss$]/g, "5")
    .replace(/[^0-9.]/g, "");
}

function numberFrom(value, { decimal = false } = {}) {
  const text = cleanDigits(value);
  const pattern = decimal ? /^\d+(?:\.\d+)?$/ : /^\d+$/;
  return pattern.test(text) ? Number(text) : null;
}

function joinedText(items, range) {
  return items
    .filter((item) => item.x >= range[0] && item.x < range[1])
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text)
    .join("");
}

function bestNumber(items, range, options = {}) {
  return items
    .filter((item) => item.x >= range[0] && item.x < range[1])
    .sort((a, b) => b.confidence - a.confidence || b.width - a.width)
    .map((item) => numberFrom(item.text, options))
    .find(Number.isFinite) ?? null;
}

function cleanSchoolName(value) {
  let text = String(value ?? "")
    .replace(/[【】「」『』\[\]—_]/g, "")
    .replace(/[|/\\]+$/g, "")
    .replace(/^[^\u4e00-\u9fa5]+/, "")
    .replace(/\s+/g, "")
    .trim();
  if (text.length % 2 === 0) {
    const half = text.slice(0, text.length / 2);
    if (half.length >= 4 && half === text.slice(text.length / 2)) text = half;
  }
  text = text
    .replace(/^[-一二小艺百主到正]+/, "")
    .replace(/(.{4,}职业技术大学)\1$/g, "$1")
    .replace(/(.{4,}职业技术学院)\1$/g, "$1")
    .replace(/(.{4,}职业学院)\1$/g, "$1")
    .replace(/(.{4,}师范学院)\1$/g, "$1")
    .replace(/(.{4,}学院)\1$/g, "$1")
    .replace(/(.{4,}大学)\1$/g, "$1");
  const corrections = new Map([
    ["天津职业技术师范大学天津职业技术师范大学", "天津职业技术师范大学"],
    ["新疆天山职业技术大学新疆天山职业技术大学", "新疆天山职业技术大学"],
  ]);
  text = corrections.get(text) || text;
  return NAME_CORRECTIONS.get(text) || text;
}

function boundedInteger(value, min, max) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}

function boundedAverage(value, minScore, maxScore) {
  if (!Number.isFinite(value)) return null;
  const candidates = [value];
  if (value > 750) candidates.push(value / 100);
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    if (candidate >= minScore && (!Number.isFinite(maxScore) || candidate <= maxScore)) {
      return Number(candidate.toFixed(2));
    }
  }
  return null;
}

function disciplineCodes(textValue) {
  const text = String(textValue || "");
  const out = new Set();
  if (/财经|金融|会计|审计|经济|商务|管理|贸易|统计/.test(text)) out.add("12");
  if (/理工|工程|电力|机电|电子|信息|科技|交通|航空|航天|智能|软件|计算机|数据|自动化|机械|材料|化学|建筑|土木/.test(text)) out.add("08");
  if (/医学|医科|中医|药|护理|卫生|口腔|临床|生物医学/.test(text)) out.add("10");
  if (/师范|教育/.test(text)) out.add("04");
  if (/外语|语言|新闻|传媒|艺术|音乐|戏剧|电影|体育|旅游/.test(text)) out.add("05");
  if (/政法|公安|警察|军|国防/.test(text)) out.add("03");
  if (/农业|农林|林业|园林|水产/.test(text)) out.add("09");
  return [...out];
}

function schoolTags(record) {
  const text = record.schoolName;
  const tags = ["新疆官方单列类高职专科投档线", "高职/专科", record.subjectType];
  if (/新疆|乌鲁木齐|昌吉|石河子|塔里木|喀什|伊犁|和田/.test(text)) tags.push("新疆本地");
  if (/师范|教育/.test(text)) tags.push("师范教育");
  if (/医学|医科|中医|药|护理|卫生|口腔|临床/.test(text)) tags.push("医卫");
  if (/信息|软件|计算机|数据|智能|电子|电气|自动化|工程|技术|理工/.test(text)) tags.push("信息技术/工程");
  if (/财经|金融|会计|经济|商务|管理|贸易/.test(text)) tags.push("财经商科");
  if (Number(record.minScore) < 250) tags.push("专科低分边界");
  return [...new Set(tags)];
}

function columnsFor(width) {
  const scale = width / 1280;
  const s = (value) => value * scale;
  return {
    code: [0, s(115)],
    name: [s(105), s(475)],
    plan: [s(475), s(580)],
    filed: [s(580), s(675)],
    high: [s(675), s(775)],
    minTotal: [s(775), s(870)],
    chinese: [s(870), s(967)],
    comprehensive: [s(967), s(1065)],
    math: [s(1065), s(1170)],
    avg: [s(1170), width + 10],
  };
}

function validSchoolName(name) {
  return /[\u4e00-\u9fa5]{2,}/.test(name) && /(大学|学院|学校)$/.test(name);
}

function parseImageRows({ image, items, dimensions }) {
  const ranges = columnsFor(dimensions.width);
  const codeItems = items
    .filter((item) => item.y > 220 && item.x >= ranges.code[0] && item.x < ranges.code[1])
    .map((item) => ({ ...item, code: cleanDigits(item.text).slice(0, 4) }))
    .filter((item) => /^\d{4}$/.test(item.code))
    .sort((a, b) => a.y - b.y || b.confidence - a.confidence);

  const anchors = [];
  for (const item of codeItems) {
    if (anchors.some((anchor) => Math.abs(anchor.y - item.y) < 20)) continue;
    anchors.push(item);
  }

  const records = [];
  const skipped = {
    duplicateRow: codeItems.length - anchors.length,
    missingSchool: 0,
    invalidSchool: 0,
    missingScore: 0,
    invalidScore: 0,
    highBelowMin: 0,
    missingPlanAndFiling: 0,
  };

  for (const anchor of anchors) {
    const rowItems = items.filter((item) => Math.abs(item.y - anchor.y) < 26);
    const correctionKey = `${image.imageId}|${Math.round(anchor.y)}`;
    const correction = ROW_CORRECTIONS.get(correctionKey) || {};
    const schoolName = correction.schoolName || cleanSchoolName(joinedText(rowItems, ranges.name));
    if (!schoolName) {
      skipped.missingSchool += 1;
      continue;
    }
    if (!validSchoolName(schoolName)) {
      skipped.invalidSchool += 1;
      continue;
    }
    const minScore = bestNumber(rowItems, ranges.minTotal);
    if (!Number.isFinite(minScore)) {
      skipped.missingScore += 1;
      continue;
    }
    if (minScore < 100 || minScore > 750) {
      skipped.invalidScore += 1;
      continue;
    }
    const highestScore = bestNumber(rowItems, ranges.high);
    if (Number.isFinite(highestScore) && highestScore < minScore) {
      skipped.highBelowMin += 1;
      continue;
    }
    const planCount = bestNumber(rowItems, ranges.plan);
    const filingCount = bestNumber(rowItems, ranges.filed);
    if (!Number.isFinite(planCount) && !Number.isFinite(filingCount)) {
      skipped.missingPlanAndFiling += 1;
    }
    const chinese = bestNumber(rowItems, ranges.chinese);
    const comprehensive = bestNumber(rowItems, ranges.comprehensive);
    const math = bestNumber(rowItems, ranges.math);
    const avgScore = bestNumber(rowItems, ranges.avg, { decimal: true });
    const cleanMaxScore = Number.isFinite(correction.maxScore) ? Math.round(correction.maxScore) : (Number.isFinite(highestScore) ? Math.round(highestScore) : null);
    const cleanMinScore = Math.round(correction.minScore ?? minScore);
    const base = {
      province: PROVINCE,
      year: YEAR,
      subjectType: image.subjectType,
      batch: BATCH,
      schoolName,
      schoolCode: correction.schoolCode || anchor.code,
      schoolTags: [],
      dataType: "vocational-admission",
      majorName: "单列类高职（专科）批次院校投档线",
      majorCode: "",
      majorGroup: "",
      disciplineCodes: disciplineCodes(schoolName),
      planCount: Number.isFinite(planCount) ? Math.round(planCount) : null,
      filingCount: Number.isFinite(filingCount) ? Math.round(filingCount) : null,
      minScore: cleanMinScore,
      maxScore: cleanMaxScore,
      avgScore: Number.isFinite(correction.avgScore) ? Number(correction.avgScore.toFixed(2)) : boundedAverage(avgScore, cleanMinScore, cleanMaxScore),
      minRankStart: null,
      minRankEnd: null,
      rankRangeText: "",
      tieBreakScores: correction.tieBreakScores || {
        totalScore: cleanMinScore,
        chinese: boundedInteger(chinese, 0, 150),
        comprehensive: boundedInteger(comprehensive, 0, 300),
        math: boundedInteger(math, 0, 150),
      },
      sourceId: SOURCE_ID,
      sourceQuality: "official-xinjiang-2025-single-vocational-filing-image-ocr-score-only",
      sourceImageUrl: image.url,
      imageId: image.imageId,
      originalSubject: image.originalSubject,
      ocrRowTop: Math.round(anchor.y),
      ocrCorrection: Object.keys(correction).length ? correction : undefined,
      cautions: [
        "本记录来自新疆教育考试院官网公开图片表，经 macOS Vision OCR 抽取；正式填报前必须回官方原图复核。",
        "原表为单列类高职（专科）批次院校投档分数情况，只公开投档分和同分排序项，不含最低位次；本导入不生成假位次。",
        "单列类文史/理工在本地推荐中隔离为单列类历史类/单列类物理类，不得混入普通类历史/物理推荐。",
        "院校投档线只能判断单列类专科进档边界，不等同于最终专业录取结果；仍需核对当年计划、专业和招生章程。",
      ],
    };
    const idBase = [YEAR, PROVINCE, BATCH, image.subjectType, base.schoolCode, schoolName, base.minScore, image.imageId, Math.round(anchor.y)].join("|");
    base.id = `${YEAR}-xinjiang-single-vocational-filing-${hash(idBase, 18)}`;
    base.schoolTags = schoolTags(base);
    records.push(base);
  }
  return { records, skipped, candidates: anchors.length };
}

function dedupe(records) {
  const map = new Map();
  for (const record of records) {
    const key = [record.subjectType, record.schoolCode, record.schoolName, record.minScore, record.imageId, record.ocrRowTop].join("|");
    map.set(key, record);
  }
  return [...map.values()].sort((a, b) =>
    String(a.subjectType).localeCompare(String(b.subjectType), "zh-Hans-CN") ||
    Number(a.imageId) - Number(b.imageId) ||
    a.ocrRowTop - b.ocrRowTop
  );
}

function summarize(records) {
  return Object.entries(Object.groupBy(records, (record) => record.subjectType))
    .map(([subjectType, subjectRecords]) => ({
      subjectType,
      records: subjectRecords.length,
      scoreRange: {
        min: Math.min(...subjectRecords.map((record) => record.minScore)),
        max: Math.max(...subjectRecords.map((record) => record.minScore)),
      },
      schools: new Set(subjectRecords.map((record) => record.schoolName)).size,
      recordsWithPlanCount: subjectRecords.filter((record) => Number.isFinite(record.planCount)).length,
      recordsWithFilingCount: subjectRecords.filter((record) => Number.isFinite(record.filingCount)).length,
      recordsWithTieBreak: subjectRecords.filter((record) =>
        record.tieBreakScores && Object.values(record.tieBreakScores).some((value) => value !== null)
      ).length,
    }))
    .sort((a, b) => a.subjectType.localeCompare(b.subjectType, "zh-Hans-CN"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const html = args.html
    ? fs.readFileSync(path.resolve(args.html), "utf8")
    : await downloadText(args.url);
  const htmlPath = path.join(TMP_ROOT, "page.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  const pageMeta = extractPageMeta(html, args.url);
  const imageDir = path.resolve(args.imageDir || path.join(TMP_ROOT, "images"));
  const visionDir = path.join(TMP_ROOT, "vision-chunks");
  fs.mkdirSync(imageDir, { recursive: true });
  const visionBinary = ensureVisionBinary();

  const imageFiles = [];
  for (const image of pageMeta.imageMeta) {
    const file = path.join(imageDir, `${image.imageId}.jpg`);
    if (!args.useCache || !fs.existsSync(file) || fs.statSync(file).size === 0) {
      fs.writeFileSync(file, await downloadBinary(image.url));
    }
    imageFiles.push({ ...image, file });
  }

  const imageNotes = [];
  const allRecords = [];
  const skippedTotals = {};
  for (const image of imageFiles) {
    const dimensions = imageDimensions(image.file);
    const items = visionItemsForImage(image.file, path.join(visionDir, image.imageId), dimensions, visionBinary);
    const parsed = parseImageRows({ image, items, dimensions });
    allRecords.push(...parsed.records);
    for (const [key, value] of Object.entries(parsed.skipped)) {
      skippedTotals[key] = (skippedTotals[key] || 0) + value;
    }
    imageNotes.push({
      imageId: image.imageId,
      label: image.label,
      subjectType: image.subjectType,
      originalSubject: image.originalSubject,
      url: image.url,
      width: dimensions.width,
      height: dimensions.height,
      sha256: sha256File(image.file),
      ocrObservations: items.length,
      rowCandidates: parsed.candidates,
      records: parsed.records.length,
      skipped: parsed.skipped,
    });
  }

  const records = dedupe(allRecords);
  const subjectSummaries = summarize(records);
  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    dataset: path.basename(args.out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "新疆 2025 单列类高职（专科）批次官方图片投档线",
    notes: [
      "Official Xinjiang Education Examination Authority image tables are OCR-parsed on internal APFS.",
      "This is a single-category vocational filing-line layer, not a one-score-one-rank conversion table.",
      "The official table has filing scores and same-score sorting items but no minimum rank; this import does not invent rank.",
      "Single-category records are isolated from ordinary history/physics recommendation evidence.",
    ],
    sourceNotes: [{
      id: SOURCE_ID,
      title: pageMeta.title,
      publisher: "新疆教育考试院",
      url: args.url,
      publishedAt: pageMeta.publishedAt,
      quality: "official-xinjiang-2025-single-vocational-filing-image-ocr-score-only",
      usage: `官方单列类高职（专科）批次院校投档图片表，经本地 OCR 抽取 ${records.length} 条院校投档线；无最低位次，按 score-only 单列类专科进档边界使用，不混入普通类。`,
      parsedRecords: records.length,
      imageCount: imageFiles.length,
      htmlSha256: sha256(html),
      htmlBytes: Buffer.byteLength(html),
      imageNotes,
      subjectSummaries,
      skippedTotals,
    }],
    records,
  }, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    subjects: subjectSummaries,
    skippedTotals,
    imageNotes: imageNotes.map((item) => ({
      imageId: item.imageId,
      subjectType: item.subjectType,
      records: item.records,
      rowCandidates: item.rowCandidates,
      skipped: item.skipped,
      sha256: item.sha256,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
