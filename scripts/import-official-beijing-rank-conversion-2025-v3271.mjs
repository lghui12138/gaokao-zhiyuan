#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_PAGE_URL = "https://www.bjeea.cn/html/gkgz/tzgg/2025/0625/87165.html";
const DEFAULT_OUT = "data/admissions/official-beijing-rank-conversion-2025-v3271-import.json";
const RAW_DIR = path.join(PROJECT_ROOT, "data/admissions/raw/official-beijing-rank-conversion-2025-v3271");
const SOURCE_ID = "official-beijing-rank-2025-v3271";
const SUPERSEDED_SOURCE_ID = "dxsbb-rank-8df9f3efff";
const YEAR = 2025;
const SOURCE_QUALITY = "official-beijing-2025-rank-conversion-pdf-text-validated";
export const EXPECTED_RAW_HASHES = Object.freeze({
  page: "79b375f0b40dc2746da4004e13d769652aba6e4ebb28aa02fea9fc780d0d47c9",
  pdf: "338827fa23721b1a0450f7052f35d35b5b8502b8e80e462c724d88ec34b80a6c",
});

function parseArgs(argv) {
  const args = { pageUrl: DEFAULT_PAGE_URL, out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--page-url") args.pageUrl = argv[++i];
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-beijing-rank-conversion-2025-v3271.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-beijing-rank-conversion-2025-v3271.mjs --use-cache",
    "",
    "Imports the official Beijing 2025 gaokao score distribution PDF as ordinary rank conversions.",
  ].join("\n");
}

export function assertOfficialUrl(value, label) {
  const url = new URL(value);
  if (!/^(www\.)?bjeea\.cn$/.test(url.hostname)) {
    throw new Error(`${label} must use the official bjeea.cn host: ${value}`);
  }
  return url.href;
}

export function assertExpectedSha(buffer, expected, label) {
  const actual = sha256(buffer);
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: expected ${expected}, got ${actual}`);
  return actual;
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"");
}

function cleanHtmlText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export async function download(url, accept, fetchImpl = fetch, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "user-agent": "Mozilla/5.0 gaokao-beijing-rank-importer/1.0", accept },
        redirect: "follow",
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      assertOfficialUrl(response.url || url, "Final response URL");
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([`${command} ${args.join(" ")} failed`, result.stderr, result.stdout].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function parsePage(html, pageUrl) {
  const title = cleanHtmlText(/<div class="info-ctit[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] || "");
  const publishedAt = cleanHtmlText(/<span class="info-item">([^<]+)<\/span>/i.exec(html)?.[1] || "");
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: match[1], text: cleanHtmlText(match[2]) }));
  const pdf = links.find((item) => item.text === "北京市2025年高考考生分数分布" && /\.pdf(?:$|\?)/i.test(item.href));
  if (title !== "北京市2025年高考考生分数分布") throw new Error(`Unexpected page title: ${title}`);
  if (publishedAt !== "2025-06-25") throw new Error(`Unexpected publication date: ${publishedAt}`);
  if (!pdf) throw new Error("Official Beijing 2025 score-distribution PDF link not found");
  return { title, publishedAt, pdfUrl: assertOfficialUrl(new URL(pdf.href, pageUrl).href, "PDF URL") };
}

function parseRows(text) {
  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/\s+/g, " ");
    let match = /^(\d+)分以上 (\d+) (\d+)$/.exec(line);
    if (match) {
      const min = Number(match[1]);
      rows.push({ label: `${min}分以上`, score: min, scoreRange: { min, max: 750 }, count: Number(match[2]), cumulative: Number(match[3]) });
      continue;
    }
    match = /^(\d+)[→至~-](\d+) (\d+) (\d+)$/.exec(line);
    if (match) {
      const min = Number(match[1]);
      const max = Number(match[2]);
      rows.push({ label: `${min}→${max}`, score: max, scoreRange: { min, max }, count: Number(match[3]), cumulative: Number(match[4]) });
      continue;
    }
    match = /^(\d+) (\d+) (\d+)$/.exec(line);
    if (match) {
      const score = Number(match[1]);
      rows.push({ label: String(score), score, count: Number(match[2]), cumulative: Number(match[3]) });
    }
  }
  return rows;
}

function validateRows(rows) {
  if (rows.length !== 347) throw new Error(`Expected 347 rows, got ${rows.length}`);
  if (rows[0].label !== "698分以上" || rows[0].count !== 113 || rows[0].cumulative !== 113) {
    throw new Error(`Unexpected first row: ${JSON.stringify(rows[0])}`);
  }
  if (rows.at(-1).label !== "100→109" || rows.at(-1).count !== 24 || rows.at(-1).cumulative !== 65434) {
    throw new Error(`Unexpected last row: ${JSON.stringify(rows.at(-1))}`);
  }
  let previousCumulative = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.count <= 0 || row.cumulative !== previousCumulative + row.count) {
      throw new Error(`Cumulative invariant failed at ${row.label}`);
    }
    if (i > 0) {
      const previous = rows[i - 1];
      const previousMin = previous.scoreRange?.min ?? previous.score;
      const currentMax = row.scoreRange?.max ?? row.score;
      if (currentMax !== previousMin - 1) throw new Error(`Score continuity failed: ${previous.label} -> ${row.label}`);
    }
    previousCumulative = row.cumulative;
  }
}

function makeRankConversions(rows) {
  let previousCumulative = 0;
  return rows.map((row) => {
    const record = {
      id: `${YEAR}-bj-rank-${hash(`${SOURCE_ID}|${row.label}|${row.count}|${row.cumulative}`)}`,
      province: "北京",
      year: YEAR,
      subjectType: "综合",
      dataType: "rank-conversion",
      score: row.score,
      rankStart: previousCumulative + 1,
      rankEnd: row.cumulative,
      sameRankScore: row.count,
      sourceId: SOURCE_ID,
      sourceQuality: SOURCE_QUALITY,
    };
    if (row.scoreRange) record.scoreRange = row.scoreRange;
    previousCumulative = row.cumulative;
    return record;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  args.pageUrl = assertOfficialUrl(args.pageUrl, "Page URL");
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const pageFile = path.join(RAW_DIR, "page-87165.html");
  const pdfFile = path.join(RAW_DIR, "beijing-2025-score-distribution.pdf");
  const textFile = path.join(RAW_DIR, "beijing-2025-score-distribution-raw.txt");
  const outFile = path.resolve(PROJECT_ROOT, args.out);

  if (!args.useCache || !fs.existsSync(pageFile)) fs.writeFileSync(pageFile, await download(args.pageUrl, "text/html,application/xhtml+xml"));
  const pageBuffer = fs.readFileSync(pageFile);
  assertExpectedSha(pageBuffer, EXPECTED_RAW_HASHES.page, "Official page");
  const meta = parsePage(pageBuffer.toString("utf8"), args.pageUrl);
  if (!args.useCache || !fs.existsSync(pdfFile)) fs.writeFileSync(pdfFile, await download(meta.pdfUrl, "application/pdf"));
  const pdfBuffer = fs.readFileSync(pdfFile);
  assertExpectedSha(pdfBuffer, EXPECTED_RAW_HASHES.pdf, "Official PDF");
  if (pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Downloaded file is not a PDF");
  const pageCount = Number(/^Pages:\s+(\d+)$/m.exec(run("pdfinfo", [pdfFile]))?.[1]);
  if (pageCount !== 10) throw new Error(`Expected 10 PDF pages, got ${pageCount}`);
  run("pdftotext", ["-raw", pdfFile, textFile]);
  const textBuffer = fs.readFileSync(textFile);
  const rows = parseRows(textBuffer.toString("utf8"));
  validateRows(rows);
  const rankConversions = makeRankConversions(rows);

  let generatedAt = new Date().toISOString();
  if (args.useCache && fs.existsSync(outFile)) {
    const existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
    if (existing.dataset === "official-beijing-rank-conversion-2025-v3271" && existing.generatedAt) generatedAt = existing.generatedAt;
  }
  const sourceNote = {
    id: SOURCE_ID,
    title: meta.title,
    publisher: "北京教育考试院",
    province: "北京",
    subjectType: "综合",
    year: YEAR,
    url: args.pageUrl,
    pdfUrl: meta.pdfUrl,
    publishedAt: meta.publishedAt,
    quality: SOURCE_QUALITY,
    usage: "北京市2025年普通高考综合类考生分数分布；用于分数到累计位次区间换算，分数含全国性照顾加分。",
    parsedRecords: rankConversions.length,
    scoreRange: { min: 100, max: 750 },
    cumulativeCandidates: rows.at(-1).cumulative,
    pageCount,
    supersedes: [SUPERSEDED_SOURCE_ID],
    rawFiles: [
      { path: rel(pageFile), bytes: pageBuffer.length, sha256: sha256(pageBuffer) },
      { path: rel(pdfFile), bytes: pdfBuffer.length, sha256: sha256(pdfBuffer), pages: pageCount },
      { path: rel(textFile), bytes: textBuffer.length, sha256: sha256(textBuffer) },
    ],
    cautions: [
      "统计分数含全国性照顾加分，必须按北京综合类普通高考口径使用。",
      "698分以上和379分以下部分按官方合并分数段保存为scoreRange，不得伪造段内逐分位次。",
      "位次换算是同年累计人数边界，不等同于院校或专业录取概率。",
    ],
  };
  const payload = {
    dataset: "official-beijing-rank-conversion-2025-v3271",
    generatedAt,
    scope: "ordinary-rank-conversion",
    sourceNotes: [sourceNote],
    records: [],
    rankConversions,
    audit: {
      rowCount: rows.length,
      exactScoreRows: rows.filter((row) => !row.scoreRange).length,
      groupedScoreRows: rows.filter((row) => row.scoreRange).length,
      firstRow: rows[0],
      lastRow: rows.at(-1),
      cumulativeInvariant: true,
      scoreContinuity: true,
    },
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: rel(outFile),
    sourceId: SOURCE_ID,
    rankConversions: rankConversions.length,
    scoreRange: sourceNote.scoreRange,
    cumulativeCandidates: sourceNote.cumulativeCandidates,
    pageSha256: sourceNote.rawFiles[0].sha256,
    pdfSha256: sourceNote.rawFiles[1].sha256,
  }, null, 2));
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
