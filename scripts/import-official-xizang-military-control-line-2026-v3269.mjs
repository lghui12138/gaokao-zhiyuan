#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_URL = "http://zsks.edu.xizang.gov.cn/71/74/7928.html";
const DEFAULT_OUT = "data/admissions/official-xizang-military-control-line-2026-v3269-import.json";
const RAW_DIR = path.join(PROJECT_ROOT, "data/admissions/raw/official-xizang-military-control-line-2026-v3269");
const OCR_HELPER = path.join(PROJECT_ROOT, "scripts/vision-ocr-json.swift");
const SOURCE_ID = "official-xizang-military-interview-medical-control-line-2026-v3269";
const YEAR = 2026;
const PROVINCE = "西藏";

const EXPECTED_ROWS = [
  ["文史", "男", "A类", 395],
  ["文史", "男", "B类", 460],
  ["理工", "男", "A类", 376],
  ["理工", "男", "B类", 591],
  ["理工", "女", "A类", 415],
  ["理工", "女", "B类", 638],
];

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--url") args.url = argv[++i];
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-military-control-line-2026-v3269.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-military-control-line-2026-v3269.mjs --use-cache",
    "",
    "Imports the Xizang 2026 military-academy interview/medical-exam eligibility lines.",
    "The six rows stay isolated as special-path control lines and never close the ordinary filing-score gap.",
  ].join("\n");
}

function assertOfficialUrl(value, label) {
  const parsed = new URL(value);
  if (parsed.hostname !== "zsks.edu.xizang.gov.cn") {
    throw new Error(`${label} must use the official zsks.edu.xizang.gov.cn host: ${value}`);
  }
  return parsed.href;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hash(value, length = 18) {
  return sha256(String(value)).slice(0, length);
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function cleanHtmlText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function download(url, accept) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-xizang-military-control-importer/1.0",
      accept,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([`${command} ${args.join(" ")} failed`, result.stderr, result.stdout].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function extractMeta(html, pageUrl) {
  const title = cleanHtmlText(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] || "");
  const publishedAt = cleanHtmlText(/<span class="date">([^<]+)<\/span>/i.exec(html)?.[1] || "");
  const publisher = cleanHtmlText(/<span class="from">来源：([^<]+)<\/span>/i.exec(html)?.[1] || "");
  const imageSrc = /<img[^>]+src=["']([^"']*1783224146026\.png)["']/i.exec(html)?.[1];
  if (!/2026年军队院校在藏招收普通高中毕业生面试体检控制分数线/.test(title)) {
    throw new Error(`Unexpected page title: ${title}`);
  }
  if (publisher !== "西藏自治区教育考试院") throw new Error(`Unexpected publisher: ${publisher}`);
  if (!imageSrc) throw new Error("Official control-line image was not found in page 7928");
  return { title, publishedAt, publisher, imageUrl: assertOfficialUrl(new URL(imageSrc, pageUrl).href, "image URL") };
}

function imageDimensions(file) {
  const output = run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1]);
  if (width < 700 || height < 400) throw new Error(`Unexpected control-line image dimensions: ${width}x${height}`);
  return { width, height };
}

function runOcr(imageFile, ocrFile) {
  if (!fs.existsSync(OCR_HELPER)) throw new Error(`Missing OCR helper: ${OCR_HELPER}`);
  const stdout = run("swift", [OCR_HELPER, imageFile]);
  const parsed = JSON.parse(stdout);
  fs.writeFileSync(ocrFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}

function assertOcr(parsed) {
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const tokens = items.map((item) => String(item.text || "").replace(/\s+/g, ""));
  const joined = tokens.join("|");
  if (!joined.includes("西藏自治区2026年军队院校招生面试体检控制分数线")) {
    throw new Error("OCR did not recover the official table title");
  }
  for (const [, , , score] of EXPECTED_ROWS) {
    if (!tokens.includes(`${score}分`)) throw new Error(`OCR did not recover expected score ${score}`);
  }
  const firstRow = tokens.indexOf("文史");
  const expectedRowTokens = EXPECTED_ROWS.flatMap(([subject, gender, candidateClass, score]) => [subject, gender, candidateClass, `${score}分`]);
  const recoveredRowTokens = tokens.slice(firstRow, firstRow + expectedRowTokens.length);
  if (firstRow < 0 || JSON.stringify(recoveredRowTokens) !== JSON.stringify(expectedRowTokens)) {
    throw new Error(`OCR row sequence mismatch: ${JSON.stringify(recoveredRowTokens)}`);
  }
  const count = (token) => tokens.filter((item) => item === token).length;
  const expectedCounts = { 文史: 2, 理工: 4, 男: 4, 女: 2, "A类": 3, "B类": 3 };
  for (const [token, expected] of Object.entries(expectedCounts)) {
    if (count(token) !== expected) throw new Error(`OCR token count mismatch for ${token}: ${count(token)} != ${expected}`);
  }
  return { observationCount: items.length, recoveredScores: EXPECTED_ROWS.map((row) => row[3]) };
}

function makeRecords(meta, pageUrl, pageFile, imageFile, ocrFile, pageSha, imageSha) {
  return EXPECTED_ROWS.map(([rawSubject, gender, candidateClass, minScore]) => {
    const subjectType = rawSubject === "文史" ? "历史类" : "物理类";
    const key = `${YEAR}|${rawSubject}|${gender}|${candidateClass}|${minScore}`;
    return {
      id: `${YEAR}-xz-military-control-${hash(key)}`,
      province: PROVINCE,
      year: YEAR,
      subjectType,
      sourceSubjectRaw: rawSubject,
      batch: "提前批军队院校面试体检资格线",
      schoolName: "西藏自治区2026年军队院校招生面试体检控制分数线",
      schoolCode: null,
      schoolTags: ["西藏官方资格线", "军队院校", "特殊路径", gender, candidateClass],
      dataType: "control-line",
      majorName: "军队院校面试体检控制分数线",
      majorCode: null,
      majorGroup: `${rawSubject}/${gender}/${candidateClass}`,
      electiveRequirement: `科类：${rawSubject}；性别：${gender}；生源类别：${candidateClass}`,
      disciplineCodes: ["11"],
      planCount: null,
      minScore,
      minRankStart: null,
      minRankEnd: null,
      rankRangeText: "",
      rankUnavailable: true,
      scoreOnly: true,
      candidateGender: gender,
      candidateClass,
      thresholdType: "军队院校面试体检控制分数线",
      sourceId: SOURCE_ID,
      sourceQuality: "official-xizang-2026-military-interview-medical-control-line-image",
      sourceUrl: pageUrl,
      sourceFile: rel(pageFile),
      sourceImageFile: rel(imageFile),
      sourceOcrFile: rel(ocrFile),
      sourcePublishedAt: meta.publishedAt,
      pageSha256: pageSha,
      imageSha256: imageSha,
      formalScoreScope: "special-path-only",
      cautions: [
        "本记录是军队院校面试体检资格控制线，不是普通批次院校投档线、录取最低分、专业最低位次或录取概率证据。",
        "达到该线只表示具备参加相应面试体检的资格边界，最终仍取决于政治考核、面试、体检、招生计划和院校录取规则。",
        "A类/B类、科类和性别必须按官方原表分别匹配，不得跨类别回退或合并使用。",
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
  args.url = assertOfficialUrl(args.url, "page URL");
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const pageFile = path.join(RAW_DIR, "page-7928.html");
  const imageFile = path.join(RAW_DIR, "military-interview-medical-control-line.png");
  const ocrFile = path.join(RAW_DIR, "military-interview-medical-control-line-ocr.json");

  if (!args.useCache || !fs.existsSync(pageFile)) {
    fs.writeFileSync(pageFile, await download(args.url, "text/html,application/xhtml+xml"));
  }
  const htmlBuffer = fs.readFileSync(pageFile);
  const html = htmlBuffer.toString("utf8");
  const meta = extractMeta(html, args.url);
  if (!args.useCache || !fs.existsSync(imageFile)) {
    fs.writeFileSync(imageFile, await download(meta.imageUrl, "image/png,image/*"));
  }
  const imageBuffer = fs.readFileSync(imageFile);
  const dimensions = imageDimensions(imageFile);
  const ocrAudit = assertOcr(runOcr(imageFile, ocrFile));
  const pageSha = sha256(htmlBuffer);
  const imageSha = sha256(imageBuffer);
  const records = makeRecords(meta, args.url, pageFile, imageFile, ocrFile, pageSha, imageSha);

  const sourceNote = {
    id: SOURCE_ID,
    title: meta.title,
    publisher: meta.publisher,
    url: args.url,
    imageUrl: meta.imageUrl,
    publishedAt: meta.publishedAt,
    quality: "official-xizang-2026-military-interview-medical-control-line-image-vision-verified",
    usage: "官方图片表抽取西藏2026年军队院校面试体检控制分数线6条，按文史/理工、性别和A/B类隔离，仅作特殊路径资格边界。",
    parsedRecords: records.length,
    scoreRange: { min: Math.min(...records.map((row) => row.minScore)), max: Math.max(...records.map((row) => row.minScore)) },
    rawFiles: [
      { path: rel(pageFile), bytes: htmlBuffer.length, sha256: pageSha },
      { path: rel(imageFile), bytes: imageBuffer.length, sha256: imageSha, ...dimensions },
      { path: rel(ocrFile), bytes: fs.statSync(ocrFile).size, sha256: sha256(fs.readFileSync(ocrFile)) },
    ],
    ocrAudit,
    cautions: [
      "该表是军队院校面试体检入围资格线，不是普通批投档线、录取最低分、一分一段或最低位次。",
      "全部记录保持formalScoreScope=special-path-only，不参与西藏普通正式分数闭合，也不进入普通推荐候选池。",
      "源表未公开位次，系统不生成假位次或录取概率。",
    ],
    file: args.out,
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({
    dataset: path.basename(args.out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "西藏2026军队院校面试体检控制分数线（特殊路径）",
    notes: [
      "本文件由 scripts/import-official-xizang-military-control-line-2026-v3269.mjs 自动生成。",
      "原始页面、图片和macOS Vision OCR结果均本地留存并带sha256。",
      "六条资格线不替代普通批投档/录取分，也不生成最低位次或录取概率。",
    ],
    sourceNotes: [sourceNote],
    records,
  }, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    out: rel(outPath),
    sourceId: SOURCE_ID,
    records: records.length,
    scoreRange: sourceNote.scoreRange,
    dimensions,
    ocrAudit,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
