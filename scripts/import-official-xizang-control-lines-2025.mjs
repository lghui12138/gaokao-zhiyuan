#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_URL = "https://education.news.cn/20250625/6ca7a008afd04d868610226b472081f8/c.html";
const DEFAULT_OUT = "data/admissions/official-xizang-control-lines-2025-import.json";
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-xizang-control-lines-2025");
const VISION_HELPER = path.join(PROJECT_ROOT, "scripts", "vision-table-row-ocr.swift");
const YEAR = 2025;
const PROVINCE = "西藏";

const CONTROL_LINES = [
  ["普通生源", "文科", "本科一批", "A类考生", 338],
  ["普通生源", "文科", "本科一批", "B类考生", 410],
  ["普通生源", "文科", "本科二批", "A类考生", 304],
  ["普通生源", "文科", "本科二批", "B类考生", 315],
  ["普通生源", "文科", "专科批", "A类考生", 255],
  ["普通生源", "文科", "专科批", "B类考生", 255],
  ["普通生源", "理科", "本科一批", "A类考生", 300],
  ["普通生源", "理科", "本科一批", "B类考生", 400],
  ["普通生源", "理科", "本科二批", "A类考生", 266],
  ["普通生源", "理科", "本科二批", "B类考生", 305],
  ["普通生源", "理科", "专科批", "A类考生", 222],
  ["普通生源", "理科", "专科批", "B类考生", 222],
  ["艺术、体育类", "艺体文科", "本科", "A类考生", 228],
  ["艺术、体育类", "艺体文科", "本科", "B类考生", 236],
  ["艺术、体育类", "艺体文科", "专科", "A类考生", 179],
  ["艺术、体育类", "艺体文科", "专科", "B类考生", 179],
  ["艺术、体育类", "艺体理科", "本科", "A类考生", 200],
  ["艺术、体育类", "艺体理科", "本科", "B类考生", 229],
  ["艺术、体育类", "艺体理科", "专科", "A类考生", 155],
  ["艺术、体育类", "艺体理科", "专科", "B类考生", 155],
  ["部队生源", "文科", "本科", "部队生源", 257],
  ["部队生源", "理科", "本科", "部队生源", 205],
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-control-lines-2025.mjs --out ${DEFAULT_OUT}`,
    "",
    "Options:",
    `  --url URL   official/Xinhua mirror page, default ${DEFAULT_URL}`,
    "  --html PATH use an already downloaded HTML page",
    "  --out PATH  output JSON path",
    "",
    "Notes:",
    "  - Imports Xizang 2025 admission control lines from a Xinhua page sourced to the Xizang Education Examination Authority.",
    "  - Control lines are batch eligibility boundaries, not filing/admission records.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--url") args.url = argv[++i];
    else if (item === "--html") args.html = argv[++i];
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function hash(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
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
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 gaokao-xizang-control-importer/1.0",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function downloadBinary(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 gaokao-xizang-control-importer/1.0",
      accept: "image/jpeg,image/png,image/*",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function extractPageMeta(html, pageUrl) {
  const title = cleanHtmlText(
    /<h1[^>]*>[\s\S]*?<span[^>]+class=["']title["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/h1>/i.exec(html)?.[1] ||
      /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] ||
      /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ||
      "",
  );
  const publishedAt = decodeEntities(/<div class=["']header-time[^>]*>[\s\S]*?<em>(\d{4})<\/em>[\s\S]*?<em>(\d{2})<\/em>\/<em>(\d{2})<\/em>[\s\S]*?<span class=["']time["']>([^<]+)<\/span>/i.exec(html)?.slice(1).join("-") || "");
  const publisher = decodeEntities(/<div class=["']source["']>\s*来源：([^<]+)<\/div>/i.exec(html)?.[1] || /来源：([^<\s]+)/.exec(html)?.[1] || "西藏自治区教育考试院");
  if (!/西藏自治区2025年普通高等学校招生录取最低控制分数线/.test(title)) {
    throw new Error(`Unexpected Xizang control-line page title: ${title}`);
  }
  if (!/西藏自治区教育考试院/.test(publisher)) {
    throw new Error(`Unexpected Xizang control-line publisher/source: ${publisher}`);
  }
  const imageMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png))["'][^>]*>/gi)]
    .map((match) => match[1]);
  const imageSrc = imageMatches.find((src) => /20250625f829c0aa7e5e4d82b9b6bee4c611a5cf/.test(src)) ||
    imageMatches.find((src) => /20250625/.test(src) && !/sharelogo|ewm|qrcode|code/i.test(src));
  if (!imageSrc) throw new Error("Could not find official Xizang control-line image");
  return {
    title,
    publishedAt: publishedAt.replace(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/, "$1-$2-$3 $4"),
    publisher,
    imageUrl: new URL(imageSrc, pageUrl).href,
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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

function imageDimensions(file) {
  const output = run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Could not read image dimensions for ${file}`);
  }
  return { width, height };
}

function visionTextForImage(file, dimensions) {
  if (!fs.existsSync(VISION_HELPER)) return { text: "", observationCount: 0 };
  const stdout = run("swift", [
    VISION_HELPER,
    file,
    "--raw",
    "0",
    "0",
    String(dimensions.width),
    String(dimensions.height),
  ]);
  const parsed = JSON.parse(stdout);
  const text = (parsed.observations || []).map((item) => item.text).join("\n");
  return { text, observationCount: parsed.observations?.length || 0 };
}

function subjectTypeFor(rawSubject) {
  if (/理/.test(rawSubject)) return "物理类";
  if (/文/.test(rawSubject)) return "历史类";
  return rawSubject;
}

function disciplineCodes(rawSubject) {
  if (/艺体/.test(rawSubject)) return ["13", "04"];
  return [];
}

function sourceSubjectRaw(rawSubject) {
  if (/理/.test(rawSubject)) return "理科";
  if (/文/.test(rawSubject)) return "文科";
  return rawSubject;
}

function recordsFor(sourceId) {
  return CONTROL_LINES.map(([studentSource, rawSubject, batch, candidateClass, minScore]) => {
    const sourceSubject = sourceSubjectRaw(rawSubject);
    const isOrdinary = studentSource === "普通生源";
    const idBase = [YEAR, PROVINCE, studentSource, sourceSubject, batch, candidateClass, minScore].join("|");
    return {
      id: `${YEAR}-xizang-official-control-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: YEAR,
      subjectType: subjectTypeFor(rawSubject),
      sourceSubjectRaw: sourceSubject,
      batch,
      schoolName: isOrdinary ? "西藏普通高校招生录取最低控制分数线" : "西藏自治区普通高校招生录取最低控制分数线",
      schoolTags: ["批次控制线", studentSource, candidateClass],
      city: "西藏",
      dataType: "control-line",
      majorName: isOrdinary
        ? `${YEAR}${sourceSubject}${batch}${candidateClass}控制线`
        : `${YEAR}${studentSource}${sourceSubject}${batch}${candidateClass}控制线`,
      majorCode: "",
      majorGroup: candidateClass,
      disciplineCodes: disciplineCodes(rawSubject),
      minScore,
      rankRangeText: "",
      sourceId,
      sourceQuality: "official-xizang-2025-control-line-xinhua-image",
      controlLineKind: studentSource,
      candidateClass,
      sourceRemark: candidateClass === "A类考生"
        ? "A类考生：区内世居两代（含两代）以上少数民族考生"
        : candidateClass === "B类考生"
          ? "B类考生：汉族及区外少数民族考生"
          : "部队生源",
      cautions: [
        "这是新华社转载且来源标注为西藏自治区教育考试院的录取最低控制分数线，只能作为批次资格边界。",
        "控制线不等同于院校投档线、专业录取分、一分一段或录取概率。",
        "西藏仍缺公开可计算一分一段和高职专科投档/录取表，推荐结果必须继续降级并回官方资料复核。",
      ],
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const html = args.html ? fs.readFileSync(path.resolve(args.html), "utf8") : await downloadText(args.url);
  const htmlPath = path.join(TMP_ROOT, "page.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  const pageMeta = extractPageMeta(html, args.url);
  const imagePath = path.join(TMP_ROOT, path.basename(new URL(pageMeta.imageUrl).pathname));
  if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
    fs.writeFileSync(imagePath, await downloadBinary(pageMeta.imageUrl));
  }
  const dimensions = imageDimensions(imagePath);
  const vision = visionTextForImage(imagePath, dimensions);
  const mustContain = ["本科一批", "本科二批", "专科批", "部队生源", "A类考生", "B类考生"];
  const missingText = mustContain.filter((term) => !vision.text.includes(term));
  if (missingText.length) {
    throw new Error(`Official image OCR sanity check failed, missing: ${missingText.join(", ")}`);
  }

  const sourceId = "official-xizang-control-lines-2025";
  const records = recordsFor(sourceId);
  const scoreRange = {
    min: Math.min(...records.map((record) => record.minScore)),
    max: Math.max(...records.map((record) => record.minScore)),
  };
  const byKind = records.reduce((acc, record) => {
    acc[record.controlLineKind] = (acc[record.controlLineKind] || 0) + 1;
    return acc;
  }, {});
  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    dataset: path.basename(args.out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "西藏 2025 普通高等学校招生录取最低控制分数线",
    notes: [
      "Xinhua page is sourced to the Xizang Education Examination Authority; page and image are downloaded on APFS and sanity-checked with macOS Vision OCR.",
      "The 12 ordinary-source records intentionally share keys with the older DXSBB historical control-line seed so the build keeps the official record.",
      "Control-line records are batch eligibility boundaries, not filing/admission records and not one-score-one-rank conversions.",
      "Formal recommendation must still use Xizang filing/admission tables and one-score-one-rank tables when available.",
    ],
    stats: {
      records: records.length,
      byKind,
      scoreRange,
      ordinaryRecordsReplacingThirdPartySeed: 12,
      newSpecialAndMilitaryControlLineRecords: 10,
    },
    sourceNotes: [{
      id: sourceId,
      title: pageMeta.title,
      publisher: pageMeta.publisher,
      url: args.url,
      publishedAt: pageMeta.publishedAt,
      quality: "official-xizang-2025-control-line-xinhua-image",
      usage: `新华社转载且来源标注为西藏自治区教育考试院的图片页导入 ${records.length} 条 2025 年西藏批次控制线；12 条普通文理记录用于替换旧第三方汇总同键记录，10 条艺体/部队生源记录新增为资格边界。`,
      parsedRecords: records.length,
      imageCount: 1,
      htmlPath: path.relative(PROJECT_ROOT, htmlPath),
      htmlSha256: sha256(html),
      htmlBytes: Buffer.byteLength(html),
      imageUrl: pageMeta.imageUrl,
      imagePath: path.relative(PROJECT_ROOT, imagePath),
      imageSha256: sha256File(imagePath),
      imageBytes: fs.statSync(imagePath).size,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
      ocrObservationCount: vision.observationCount,
      byKind,
      scoreRange,
      caution: "Control-line boundary only; not a filing/admission minimum-score table and not enough to clear Xizang formalScoreMissingProvinces.",
    }],
    records,
  }, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    byKind,
    scoreRange,
    image: path.relative(PROJECT_ROOT, imagePath),
    imageSha256: sha256File(imagePath),
    dimensions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
