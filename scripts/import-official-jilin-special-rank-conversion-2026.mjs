#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2026;
const PROVINCE = "吉林";
const SOURCE_ID = "official-jilin-special-rank-2026";
const DEFAULT_OUT = "data/admissions/official-jilin-special-rank-conversion-2026-import.json";
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-jilin-special-rank-2026");
const ART_DETAIL_ID = "202733";
const SPORTS_DETAIL_ID = "202734";

const EXPECTED_ART_CATEGORIES = [
  "艺术美术与设计类",
  "艺术书法类",
  "艺术播音与主持类",
  "艺术舞蹈类(不包含航空服务艺术与管理)",
  "艺术音乐表演类（声乐方向）",
  "艺术音乐表演类（器乐方向）",
  "艺术音乐教育类（声乐主项）",
  "艺术音乐教育类（器乐主项）",
  "艺术表（导）演类（戏剧影视表演方向）",
  "艺术表（导）演类（服装表演方向）",
  "艺术表（导）演类（戏剧影视导演方向）",
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-jilin-special-rank-conversion-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-jilin-special-rank-conversion-2026.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH    output JSON path",
    "  --use-cache  reuse downloaded official API/ZIP/PDF files in tmp/",
    "",
    "Notes:",
    "  - Imports official Jilin 2026 art/sports comprehensive-score segment PDFs.",
    "  - Records include rankUsage and rankCategory so ordinary, sports, and art categories are never mixed.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
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

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
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
    .replace(/\s+/g, "")
    .trim();
}

function detailApiUrl(id) {
  return `https://www.jleea.com.cn/server-front/front/content/detail?id=${id}&isStatic=false`;
}

async function fetchBuffer(url, extraHeaders = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-jilin-special-rank-importer/1.0",
      accept: "*/*",
      "anonymity-header": "Gaokao",
      "site-path": "",
      ...extraHeaders,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "",
    setCookie: response.headers.get("set-cookie") || "",
  };
}

async function fetchText(url) {
  const { buffer } = await fetchBuffer(url, { accept: "application/json,text/plain,*/*" });
  return buffer.toString("utf8");
}

async function downloadBinaryWithAntiLeech(url) {
  const first = await fetchBuffer(url);
  const text = first.buffer.subarray(0, 160).toString("utf8");
  const cookieMatch = /AntiLeech=([^;]+)/.exec(first.setCookie);
  if (/^<html/i.test(text) && cookieMatch) {
    return (await fetchBuffer(url, { cookie: `AntiLeech=${cookieMatch[1]}` })).buffer;
  }
  return first.buffer;
}

function instanceValue(detail, field) {
  return detail?.data?.instance?.instanceItems?.find((item) => item.field === field)?.value;
}

async function officialDetail(id, expectedTitle, args) {
  const file = path.join(TMP_ROOT, `content-${id}.json`);
  const jsonText = args.useCache && fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : await fetchText(detailApiUrl(id));
  fs.writeFileSync(file, jsonText, "utf8");
  const detail = JSON.parse(jsonText);
  if (detail.code !== "00000 00000") throw new Error(`Official Jilin API ${id} returned ${detail.code}`);
  const title = instanceValue(detail, "title") || "";
  if (title !== expectedTitle) throw new Error(`Unexpected title for ${id}: ${title}`);
  const contents = instanceValue(detail, "contents") || {};
  const contentHtml = contents["正文"] || "";
  return {
    id,
    detail,
    title,
    publishedAt: instanceValue(detail, "publishTime") || "",
    contentHtml,
    contentText: `${title}${cleanHtmlText(contentHtml)}`,
    pageUrl: detail.data?.url || `https://www.jleea.com.cn/front/content/${id}`,
    jsonText,
  };
}

function hrefsFromHtml(html, extension) {
  return [...String(html).matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((href) => href.toLowerCase().includes(extension))
    .map((href) => new URL(href, "https://www.jleea.com.cn/").href)
    .filter((href) => href.startsWith("https://www.jleea.com.cn/"));
}

function extractZipPdfs(zipFile, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const buffer = fs.readFileSync(zipFile);
  const files = [];
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) break;
    let data = buffer.subarray(dataStart, dataEnd);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) throw new Error(`Unsupported ZIP compression method ${method}`);
    if (data.subarray(0, 4).toString() === "%PDF") {
      const file = path.join(outDir, `art-${String(files.length + 1).padStart(2, "0")}.pdf`);
      fs.writeFileSync(file, data);
      files.push(file);
    }
    offset = dataEnd;
  }
  if (files.length !== 22) throw new Error(`Expected 22 art PDFs in Jilin art ZIP, extracted ${files.length}`);
  return files;
}

function parseMatrixRows(text, subjectType) {
  const allRows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*(\d{1,3})\s+(.+)$/.exec(line);
    if (!match) continue;
    const baseScore = Number(match[1]);
    if (!Number.isFinite(baseScore) || baseScore < 0 || baseScore > 750) continue;
    const values = [...match[2].matchAll(/\d+/g)].map((item) => Number(item[0]));
    if (values.length < 3 || values.length > 10) continue;
    const startOffset = values.length - 1;
    for (let i = 0; i < values.length; i += 1) {
      allRows.push({
        score: baseScore + startOffset - i,
        cumulative: values[i],
        subjectType,
        raw: line.replace(/\s+/g, " ").trim(),
      });
    }
  }
  const byScore = new Map();
  for (const row of allRows) {
    const existing = byScore.get(row.score);
    if (!existing || row.cumulative < existing.cumulative) byScore.set(row.score, row);
  }
  return [...byScore.values()].sort((a, b) => b.score - a.score);
}

function validateRows(allRows, meta) {
  const errors = [];
  const zeroCandidateScores = [];
  const rows = [];
  for (let i = 0; i < allRows.length; i += 1) {
    const row = allRows[i];
    const previous = allRows[i - 1];
    if (i > 0 && previous.score - row.score !== 1) {
      errors.push({ type: "score-gap", previous: previous.score, score: row.score, ...meta });
    }
    if (i > 0 && row.cumulative < previous.cumulative) {
      errors.push({ type: "decreasing-cumulative", previous, row, ...meta });
    }
    const sameRankScore = i === 0 ? row.cumulative : row.cumulative - previous.cumulative;
    if (sameRankScore > 0) {
      rows.push({
        ...row,
        sameRankScore,
        rankStart: Math.max(1, row.cumulative - sameRankScore + 1),
        rankEnd: row.cumulative,
      });
    } else {
      zeroCandidateScores.push(row.score);
    }
  }
  if (allRows.length < 20) errors.push({ type: "too-few-score-cells", rows: allRows.length, ...meta });
  if (!rows.length) errors.push({ type: "no-positive-records", ...meta });
  if (errors.length) throw new Error(`Invalid rank matrix for ${meta.subjectType} ${meta.rankCategory}: ${JSON.stringify(errors.slice(0, 5))}`);
  return { rows, zeroCandidateScores };
}

function normalizeCategory(rawCategory) {
  return String(rawCategory || "")
    .replace(/^体育体育类$/, "体育类")
    .replace(/（/g, "（")
    .replace(/）/g, "）")
    .trim();
}

function parsePdf(file) {
  const text = run("pdftotext", ["-layout", file, "-"]);
  const title = String(text).split(/\r?\n/).map((line) => line.trim()).find((line) => /[一1]分段表/.test(line)) || "";
  const match = /2026年吉林省普通高校招生考试(物理|历史)-(.+?)综合分1分段表/.exec(title);
  if (!match) throw new Error(`Could not parse Jilin special rank title in ${file}: ${title}`);
  const subjectType = `${match[1]}类`;
  const rankCategory = normalizeCategory(match[2]);
  const rankUsage = rankCategory.includes("体育") ? "sports" : "art";
  const rankUsageLabel = rankUsage === "sports" ? "体育类综合分" : `${rankCategory}综合分`;
  const allRows = parseMatrixRows(text, subjectType);
  const parsed = validateRows(allRows, { subjectType, rankUsage, rankCategory, file: path.basename(file) });
  return {
    file,
    title,
    subjectType,
    rankUsage,
    rankUsageLabel,
    rankCategory,
    rows: parsed.rows,
    zeroCandidateScores: parsed.zeroCandidateScores,
    allRowCount: allRows.length,
    pdfSha256: sha256File(file),
    pdfPages: Number(/^Pages:\s+(\d+)/m.exec(run("pdfinfo", [file]))?.[1] || 0),
  };
}

function buildRecord(row, parsed) {
  const idBase = [YEAR, PROVINCE, parsed.subjectType, parsed.rankUsage, parsed.rankCategory, row.score, row.rankStart, row.rankEnd].join("|");
  return {
    id: `${YEAR}-jl-special-rank-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: parsed.subjectType,
    batch: parsed.rankUsage === "sports" ? "体育类综合成绩一分一段" : "艺术类综合成绩一分一段",
    schoolName: "一分一段表",
    dataType: "rank-conversion",
    majorName: `${parsed.rankCategory}综合成绩位次换算`,
    score: row.score,
    rankStart: row.rankStart,
    rankEnd: row.rankEnd,
    sameRankScore: row.sameRankScore,
    rankUsage: parsed.rankUsage,
    rankUsageLabel: parsed.rankUsageLabel,
    rankCategory: parsed.rankCategory,
    sourceId: SOURCE_ID,
    sourceQuality: "official-jilin-special-rank-conversion-pdf",
    cautions: [
      `一分一段只能用于吉林2026年${parsed.subjectType}${parsed.rankUsageLabel}同口径综合分到位次估算。`,
      "艺术类/体育类综合成绩分段不能与普通类文化成绩一分一段混用。",
      "PDF 中同分人数为相邻累计人数差值；零人数分数点不生成 rank range。",
      "位次换算不等同于录取线，仍需结合招生计划、院校专业组、章程和专业/文化成绩要求判断。",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const artDetail = await officialDetail(ART_DETAIL_ID, "2026年吉林省普通高校招生考试艺术类综合成绩一分段表", args);
  const sportsDetail = await officialDetail(SPORTS_DETAIL_ID, "2026年吉林省普通高校招生考试体育类综合成绩一分段表", args);

  const artZipUrl = hrefsFromHtml(artDetail.contentHtml, ".zip").find((url) => /2069976748237348866/.test(url)) ||
    hrefsFromHtml(artDetail.contentHtml, ".zip").at(-1);
  if (!artZipUrl) throw new Error("Could not find official Jilin art ZIP URL");
  const sportsPdfUrls = hrefsFromHtml(sportsDetail.contentHtml, ".pdf");
  if (sportsPdfUrls.length !== 2) throw new Error(`Expected 2 official Jilin sports PDFs, found ${sportsPdfUrls.length}`);

  const artZipPath = path.join(TMP_ROOT, "art.zip");
  if (!args.useCache || !fs.existsSync(artZipPath)) {
    fs.writeFileSync(artZipPath, await downloadBinaryWithAntiLeech(artZipUrl));
  }
  const artPdfs = extractZipPdfs(artZipPath, path.join(TMP_ROOT, "art-pdfs"));

  const sportsPdfs = [];
  for (const [index, url] of sportsPdfUrls.entries()) {
    const file = path.join(TMP_ROOT, index === 0 ? "sports-physics.pdf" : "sports-history.pdf");
    if (!args.useCache || !fs.existsSync(file)) fs.writeFileSync(file, await downloadBinaryWithAntiLeech(url));
    sportsPdfs.push(file);
  }

  const parsedPdfs = [...sportsPdfs, ...artPdfs].map(parsePdf);
  const artCategories = [...new Set(parsedPdfs.filter((item) => item.rankUsage === "art").map((item) => item.rankCategory))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingCategories = EXPECTED_ART_CATEGORIES.filter((category) => !artCategories.includes(category));
  if (missingCategories.length) throw new Error(`Missing expected Jilin art categories: ${missingCategories.join(", ")}`);
  const subjectCategoryKeys = new Set(parsedPdfs.map((item) => `${item.subjectType}|${item.rankCategory}`));
  if (subjectCategoryKeys.size !== 24) throw new Error(`Expected 24 Jilin special subject/category PDFs, found ${subjectCategoryKeys.size}`);

  const records = parsedPdfs.flatMap((parsed) => parsed.rows.map((row) => buildRecord(row, parsed)));
  const sourceNotes = [
    {
      id: SOURCE_ID,
      title: "吉林省2026年普通高校招生考试艺术类/体育类综合成绩一分段表",
      publisher: "吉林省教育考试院",
      publishedAt: sportsDetail.publishedAt,
      url: sportsDetail.pageUrl,
      companionUrls: [artDetail.pageUrl],
      apiUrls: [detailApiUrl(ART_DETAIL_ID), detailApiUrl(SPORTS_DETAIL_ID)],
      attachmentUrls: [artZipUrl, ...sportsPdfUrls],
      quality: "official-jilin-special-rank-conversion-pdf",
      usage: "抽取吉林2026艺术类和体育类综合成绩一分段表，按 rankUsage/rankCategory 隔离为特殊类别位次换算记录。",
      parsedRecords: records.length,
      artZipSha256: sha256File(artZipPath),
      artDetailJsonSha256: sha256(artDetail.jsonText),
      sportsDetailJsonSha256: sha256(sportsDetail.jsonText),
      subjects: parsedPdfs.map((item) => ({
        subjectType: item.subjectType,
        rankUsage: item.rankUsage,
        rankCategory: item.rankCategory,
        records: item.rows.length,
        scoreCells: item.allRowCount,
        zeroCandidateScores: item.zeroCandidateScores.length,
        scoreRange: {
          min: Math.min(...item.rows.map((row) => row.score)),
          max: Math.max(...item.rows.map((row) => row.score)),
        },
        rankRange: {
          min: Math.min(...item.rows.map((row) => row.rankStart)),
          max: Math.max(...item.rows.map((row) => row.rankEnd)),
        },
        pdfSha256: item.pdfSha256,
        pdfPages: item.pdfPages,
        title: item.title,
      })).sort((a, b) =>
        String(a.rankUsage).localeCompare(String(b.rankUsage), "zh-Hans-CN") ||
        String(a.rankCategory).localeCompare(String(b.rankCategory), "zh-Hans-CN") ||
        String(a.subjectType).localeCompare(String(b.subjectType), "zh-Hans-CN")
      ),
    },
  ];

  const payload = {
    dataset: "official-jilin-special-rank-conversion-2026-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "official-special-rank-conversion",
    },
    notes: [
      "本文件由 scripts/import-official-jilin-special-rank-conversion-2026.mjs 自动生成。",
      "来源为吉林省教育考试院 2026 艺术类/体育类综合成绩一分段表官方页面和附件。",
      "rankUsage/rankCategory 用于防止普通类、体育综合分和各艺术方向综合分混用。",
      "位次换算不是投档线或录取最低分，不能据此单独生成录取概率。",
    ],
    sourceNotes,
    diagnostics: {
      parsedPdfCount: parsedPdfs.length,
      artPdfCount: artPdfs.length,
      sportsPdfCount: sportsPdfs.length,
      artCategories,
      totalRecords: records.length,
      byUsage: Object.fromEntries(["art", "sports"].map((usage) => [usage, records.filter((record) => record.rankUsage === usage).length])),
    },
    records,
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    sourceId: SOURCE_ID,
    parsedPdfCount: parsedPdfs.length,
    byUsage: payload.diagnostics.byUsage,
    artZipSha256: sourceNotes[0].artZipSha256,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
