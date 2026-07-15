#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_URL = "https://www.sdzk.cn/NewsInfo.aspx?NewsID=7256";
const DEFAULT_OUT = "data/admissions/official-shandong-control-lines-2026-import.json";
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-shandong-control-lines-2026");
const YEAR = 2026;
const PROVINCE = "山东";
const SOURCE_ID = "official-shandong-control-lines-2026";
const SOURCE_QUALITY = "official-shandong-control-line-pdf-text-verified";

const PDF_TEXT_ASSERTIONS = [
  "山东省 2026 年夏季高考",
  "特殊类型招生控制线",
  "525",
  "一段线",
  "442",
  "二段线",
  "150",
  "3+2 对口贯通分段培养",
  "392",
  "本科文化控制线",
  "331",
  "287",
  "体育类",
  "574",
  "444",
  "2026 年 6 月 25 日",
];

const ORDINARY_LINES = [
  ["特殊类型招生控制线", 525, "普通类特殊类型招生控制线"],
  ["普通类一段线", 442, "普通类一段线"],
  ["普通类二段线", 150, "普通类二段线"],
  ["3+2 对口贯通分段培养高职志愿填报资格线", 392, "3+2 对口贯通分段培养高职志愿填报资格线"],
];

const ART_CATEGORIES = [
  ["播音与主持类", 442],
  ["美术与设计类", 331],
  ["音乐类", 331],
  ["书法类", 331],
  ["舞蹈类", 287],
  ["表（导）演类", 287],
  ["戏曲类", 287],
];

const SPORTS_LINES = [
  ["体育类一段线", 574, "本科文化控制线 287；划线成绩为综合成绩，专业成绩占 70%、文化成绩占 30%。"],
  ["体育类二段线", 444, "专科文化控制线 150；划线成绩为综合成绩，专业成绩占 70%、文化成绩占 30%。"],
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-shandong-control-lines-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-shandong-control-lines-2026.mjs --use-cache",
    "",
    "Options:",
    `  --url URL   official Shandong page, default ${DEFAULT_URL}`,
    "  --html PATH use an already downloaded official HTML page",
    "  --pdf PATH  use an already downloaded official PDF file",
    "  --out PATH  output JSON path",
    "  --use-cache reuse tmp official HTML/PDF if present",
    "",
    "Notes:",
    "  - Imports official Shandong 2026 summer gaokao category score lines as control-line records.",
    "  - Control lines are batch/category eligibility boundaries, not filing/admission records.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--url") args.url = argv[++i];
    else if (item === "--html") args.html = argv[++i];
    else if (item === "--pdf") args.pdf = argv[++i];
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
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
    .replace(/&#32;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/\u00a0/g, " ");
}

function cleanHtmlText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchBinary(url, accept = "*/*") {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-shandong-control-importer/1.0",
      accept,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchText(url) {
  const buffer = await fetchBinary(url, "text/html,application/xhtml+xml");
  return buffer.toString("utf8");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function pdfText(file) {
  return run("/opt/homebrew/bin/pdftotext", ["-layout", file, "-"]);
}

function pdfInfo(file) {
  const output = run("/opt/homebrew/bin/pdfinfo", [file]);
  const pages = Number(/^Pages:\s+(\d+)/m.exec(output)?.[1]);
  const fileSize = Number(/^File size:\s+(\d+)/m.exec(output)?.[1]);
  return { pages, fileSize, raw: output };
}

function extractPageMeta(html, pageUrl) {
  const title = cleanHtmlText(/<h1[^>]*id=["']ti["'][^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
  const publishedAt = cleanHtmlText(/发布时间：\s*([0-9-]+)/.exec(html)?.[1] || "");
  if (!/山东省2026年夏季高考各类别分数线/.test(title)) {
    throw new Error(`Unexpected Shandong control-line page title: ${title}`);
  }
  const pdfHref = [...html.matchAll(/href=["']([^"']+\.pdf)["']/gi)]
    .map((match) => match[1])
    .find((href) => /20260625/.test(href)) ||
    [...html.matchAll(/href=["']([^"']+\.pdf)["']/gi)].map((match) => match[1])[0];
  if (!pdfHref) throw new Error("Could not find official Shandong control-line PDF");
  return {
    title,
    publishedAt,
    publisher: "山东省教育招生考试院",
    pdfUrl: new URL(pdfHref, pageUrl).href,
  };
}

function assertPdfText(text) {
  const compact = text.replace(/\s+/g, " ");
  const missing = PDF_TEXT_ASSERTIONS.filter((expected) => !compact.includes(expected.replace(/\s+/g, " ")));
  if (missing.length) {
    throw new Error(`Official PDF text did not contain expected controls: ${missing.join(", ")}`);
  }
}

function baseRecord({ subjectType, batch, majorName, majorGroup, minScore, disciplineCodes = [], extra = {} }) {
  const idBase = [YEAR, PROVINCE, subjectType, batch, majorName, majorGroup, minScore].join("|");
  return {
    id: `${YEAR}-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType,
    batch,
    schoolName: "山东省2026年夏季高考各类别分数线",
    schoolTags: ["批次控制线", majorGroup],
    city: "山东",
    dataType: "control-line",
    majorName,
    majorCode: "",
    majorGroup,
    disciplineCodes,
    minScore,
    cultureScoreLine: minScore,
    rankRangeText: "",
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    controlLineKind: majorGroup,
    cautions: [
      "这是山东省教育招生考试院公布的各类别分数线，只能作为批次/类别资格边界，不等同于院校投档线或专业录取分。",
      "山东 2026 目前已接入一分一段和类别分数线，但正式投档/录取最低分仍需等待省考试院后续批次表。",
      "艺术、体育和 3+2 对口贯通分段培养需要同时核对招生章程、专业/综合成绩折算和具体志愿资格要求。",
    ],
    ...extra,
  };
}

function recordsFor() {
  const records = [];
  for (const [batch, minScore, majorName] of ORDINARY_LINES) {
    records.push(baseRecord({
      subjectType: "综合改革",
      batch,
      majorName,
      majorGroup: "普通类",
      minScore,
    }));
  }
  for (const [category, minScore] of ART_CATEGORIES) {
    records.push(baseRecord({
      subjectType: "艺术类",
      batch: "艺术类本科文化控制线",
      majorName: `${category}本科文化控制线`,
      majorGroup: category,
      minScore,
      disciplineCodes: ["13"],
      extra: { artCategory: category },
    }));
    records.push(baseRecord({
      subjectType: "艺术类",
      batch: "艺术类专科文化控制线",
      majorName: `${category}专科文化控制线`,
      majorGroup: category,
      minScore: 150,
      disciplineCodes: ["13"],
      extra: { artCategory: category },
    }));
  }
  for (const [batch, minScore, note] of SPORTS_LINES) {
    records.push(baseRecord({
      subjectType: "体育类",
      batch,
      majorName: batch,
      majorGroup: "体育类",
      minScore,
      disciplineCodes: ["04"],
      extra: {
        scoreKind: "综合分",
        sportCompositeFormula: "专业成绩占70%，文化成绩占30%",
        controlLineNote: note,
        cultureScoreLine: /一段/.test(batch) ? 287 : 150,
      },
    }));
  }
  return records;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const htmlPath = path.join(TMP_ROOT, "page.html");
  const html = args.html
    ? fs.readFileSync(path.resolve(args.html), "utf8")
    : args.useCache && fs.existsSync(htmlPath)
      ? fs.readFileSync(htmlPath, "utf8")
      : await fetchText(args.url);
  fs.writeFileSync(htmlPath, html, "utf8");
  const pageMeta = extractPageMeta(html, args.url);

  const pdfPath = args.pdf
    ? path.resolve(args.pdf)
    : path.join(TMP_ROOT, path.basename(new URL(pageMeta.pdfUrl).pathname));
  if (!args.pdf && (!args.useCache || !fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0)) {
    fs.writeFileSync(pdfPath, await fetchBinary(pageMeta.pdfUrl, "application/pdf,*/*"));
  }

  const text = pdfText(pdfPath);
  assertPdfText(text);
  const info = pdfInfo(pdfPath);
  if (info.pages !== 1) throw new Error(`Expected one-page official PDF, found ${info.pages}`);

  const records = recordsFor();
  const payload = {
    dataset: "official-shandong-control-lines-2026-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "official-control-lines",
    },
    notes: [
      "本文件由 scripts/import-official-shandong-control-lines-2026.mjs 自动生成。",
      "来源为山东省教育招生考试院 2026 年夏季高考各类别分数线 PDF。",
      "本批记录为 control-line 批次/类别资格边界，不是院校投档线、录取最低分或录取概率证据。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: pageMeta.title,
        publisher: pageMeta.publisher,
        publishedAt: pageMeta.publishedAt,
        url: args.url,
        attachmentUrl: pageMeta.pdfUrl,
        quality: SOURCE_QUALITY,
        usage: "抽取山东 2026 普通类、艺术类和体育类各类别分数线 20 条，作为批次/类别资格边界。",
        parsedRecords: records.length,
        pdfSha256: sha256File(pdfPath),
        pdfSize: fs.statSync(pdfPath).size,
        pdfPages: info.pages,
        htmlSha256: sha256(html),
      },
    ],
    diagnostics: {
      ordinaryRecords: ORDINARY_LINES.length,
      artRecords: ART_CATEGORIES.length * 2,
      sportsRecords: SPORTS_LINES.length,
      pdfTextAssertions: PDF_TEXT_ASSERTIONS,
    },
    records,
  };

  const out = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, out),
    records: payload.records.length,
    sourceId: SOURCE_ID,
    pageTitle: pageMeta.title,
    publishedAt: pageMeta.publishedAt,
    pdfUrl: pageMeta.pdfUrl,
    pdfSha256: payload.sourceNotes[0].pdfSha256,
    tableBreakdown: payload.diagnostics,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
