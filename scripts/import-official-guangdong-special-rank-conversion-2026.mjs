#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2026;
const PROVINCE = "广东";
const SOURCE_ID = "official-guangdong-special-rank-2026";
const DEFAULT_PAGE_URL = "https://eea.gd.gov.cn/ptgk/content/post_4916165.html";
const DEFAULT_OUT = "data/admissions/official-guangdong-special-rank-conversion-2026-import.json";
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-guangdong-special-rank-2026");

const SPECIAL_PDFS = [
  { no: 3, usage: "sports", category: "体育类", labelPattern: /体育类总分分数段统计表/, file: "guangdong-special-03-sports.pdf" },
  { no: 4, usage: "art", category: "艺术美术与设计类", labelPattern: /美术与设计类总分分数段统计表/, file: "guangdong-special-04-art-design.pdf" },
  { no: 5, usage: "art", category: "艺术音乐教育类", labelPattern: /音乐教育类总分分数段统计表/, file: "guangdong-special-05-music-education.pdf" },
  { no: 6, usage: "art", category: "艺术音乐教育类（声乐主项）", labelPattern: /音乐教育\(声乐主项\)方向总分分数段统计表/, file: "guangdong-special-06-music-education-vocal.pdf" },
  { no: 7, usage: "art", category: "艺术音乐教育类（器乐主项）", labelPattern: /音乐教育\(器乐主项\)方向总分分数段统计表/, file: "guangdong-special-07-music-education-instrumental.pdf" },
  { no: 8, usage: "art", category: "艺术音乐表演类（声乐方向）", labelPattern: /音乐表演\(声乐\)方向总分分数段统计表/, file: "guangdong-special-08-music-performance-vocal.pdf" },
  { no: 9, usage: "art", category: "艺术音乐表演类（器乐方向）", labelPattern: /音乐表演\(器乐\)方向总分分数段统计表/, file: "guangdong-special-09-music-performance-instrumental.pdf" },
  { no: 10, usage: "art", category: "艺术舞蹈类", labelPattern: /舞蹈类总分分数段统计表/, file: "guangdong-special-10-dance.pdf" },
  { no: 11, usage: "art", category: "艺术表（导）演类（戏剧影视表演方向）", labelPattern: /表\(导\)演\(戏剧影视表演\)方向总分分数段统计表/, file: "guangdong-special-11-drama-performance.pdf" },
  { no: 12, usage: "art", category: "艺术表（导）演类（服装表演方向）", labelPattern: /表\(导\)演\(服装表演\)方向总分分数段统计表/, file: "guangdong-special-12-fashion-performance.pdf" },
  { no: 13, usage: "art", category: "艺术表（导）演类（戏剧影视导演方向）", labelPattern: /表\(导\)演\(戏剧影视导演\)方向总分分数段统计表/, file: "guangdong-special-13-drama-directing.pdf" },
  { no: 14, usage: "art", category: "艺术播音与主持类（普通话方向）", labelPattern: /播音与主持\(普通话\)方向总分分数段统计表/, file: "guangdong-special-14-broadcast-mandarin.pdf" },
  { no: 15, usage: "art", category: "艺术播音与主持类（粤语方向）", labelPattern: /播音与主持\(粤语\)方向总分分数段统计表/, file: "guangdong-special-15-broadcast-cantonese.pdf" },
  { no: 16, usage: "art", category: "艺术书法类", labelPattern: /书法类总分分数段统计表/, file: "guangdong-special-16-calligraphy.pdf" },
];

const LEVEL_USAGES = [
  {
    rankLevelUsage: "undergraduate",
    rankLevelUsageLabel: "本科加分",
    sameKey: "undergraduateSame",
    cumulativeKey: "undergraduateCumulative",
  },
  {
    rankLevelUsage: "vocational",
    rankLevelUsageLabel: "专科加分",
    sameKey: "vocationalSame",
    cumulativeKey: "vocationalCumulative",
  },
];

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, pageUrl: DEFAULT_PAGE_URL, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--page-url") args.pageUrl = argv[++i];
    else if (item === "--pdf-dir") args.pdfDir = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-guangdong-special-rank-conversion-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-guangdong-special-rank-conversion-2026.mjs --use-cache",
    "",
    "Imports Guangdong 2026 official sports/art composite-score segment PDFs as rank-conversion records.",
  ].join("\n");
}

function run(command, runArgs, options = {}) {
  const result = spawnSync(command, runArgs, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${runArgs.join(" ")} failed with status ${result.status}`,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function hash(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fetchText(url) {
  return run("curl", [
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--compressed",
    "-A",
    "Mozilla/5.0 gaokao-guangdong-special-rank-importer/1.0",
    url,
  ]);
}

function download(url, out) {
  run("curl", [
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--compressed",
    "-A",
    "Mozilla/5.0 gaokao-guangdong-special-rank-importer/1.0",
    url,
    "-o",
    out,
  ]);
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanText(value) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html, name) {
  const match = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i").exec(html) ||
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i").exec(html);
  return match ? decodeEntities(match[1]).trim() : null;
}

function extractTitle(html) {
  return metaContent(html, "ArticleTitle") ||
    cleanText(/<h3[^>]*class=["'][^"']*articleTitle[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i.exec(html)?.[1] ?? "") ||
    cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") ||
    "关于公布广东省2026年普通高考成绩各分数段数据的通知";
}

function extractPubDate(html) {
  return metaContent(html, "PubDate") ||
    /<span[^>]*class=["']time["'][^>]*>\s*时间\s*:\s*([^<]+)<\/span>/i.exec(html)?.[1]?.trim() ||
    null;
}

function pdfLinksFromPage(html, pageUrl) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = match[0];
    const label = cleanText(match[2]) || cleanText(/alt=["']([^"']+)["']/i.exec(tag)?.[1] ?? "");
    const href = new URL(match[1], pageUrl).href.replace(/^http:/, "https:");
    links.push({ label, href });
  }
  return links;
}

function ensurePdfs(args) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const htmlPath = path.join(TMP_ROOT, "page.html");
  const html = args.useCache && fs.existsSync(htmlPath)
    ? fs.readFileSync(htmlPath, "utf8")
    : fetchText(args.pageUrl);
  fs.writeFileSync(htmlPath, html, "utf8");
  const links = pdfLinksFromPage(html, args.pageUrl);
  const pdfs = [];
  for (const item of SPECIAL_PDFS) {
    const found = links.find((link) => item.labelPattern.test(link.label));
    if (!found) throw new Error(`Could not find Guangdong special PDF ${item.no}: ${item.category}`);
    const file = args.pdfDir ? path.join(path.resolve(args.pdfDir), item.file) : path.join(TMP_ROOT, item.file);
    if (!args.useCache || !fs.existsSync(file)) download(found.href, file);
    const stat = fs.statSync(file);
    if (stat.size < 20 * 1024) throw new Error(`PDF is too small: ${file} (${stat.size} bytes)`);
    pdfs.push({
      ...item,
      url: found.href,
      label: found.label,
      file,
      bytes: stat.size,
      sha256: sha256File(file),
    });
  }
  return { html, pdfs };
}

function parseRows(file) {
  const text = run("pdftotext", ["-raw", file, "-"]);
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d{3})(?:（含以上）)?\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
    if (!match) continue;
    const [score, undergraduateSame, undergraduateCumulative, vocationalSame, vocationalCumulative] =
      match.slice(1).map(Number);
    rows.push({
      score,
      topBoundary: /含以上/.test(line),
      undergraduateSame,
      undergraduateCumulative,
      vocationalSame,
      vocationalCumulative,
      raw: line.trim(),
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

function validateRows(rows, pdf, level) {
  const errors = [];
  if (rows.length < 20) errors.push({ type: "too-few-rows", category: pdf.category, actual: rows.length });
  if (!rows[0]?.topBoundary) errors.push({ type: "missing-top-boundary", category: pdf.category, row: rows[0] });
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    const same = row[level.sameKey];
    const cumulative = row[level.cumulativeKey];
    if (!Number.isFinite(row.score) || row.score < 0 || row.score > 750) {
      errors.push({ type: "invalid-score", category: pdf.category, row });
    }
    if (index > 0 && previous.score - row.score !== 1) {
      errors.push({ type: "score-gap", category: pdf.category, previous: previous.score, score: row.score });
    }
    if (!Number.isFinite(same) || same < 0 || same > 1000000) {
      errors.push({ type: "invalid-same", category: pdf.category, level: level.rankLevelUsage, row });
    }
    if (!Number.isFinite(cumulative) || cumulative < 0 || cumulative > 1000000) {
      errors.push({ type: "invalid-cumulative", category: pdf.category, level: level.rankLevelUsage, row });
    }
    if (index === 0 && same !== cumulative) {
      errors.push({ type: "top-same-cumulative-mismatch", category: pdf.category, level: level.rankLevelUsage, row });
    }
    if (index > 0 && cumulative - previous[level.cumulativeKey] !== same) {
      errors.push({
        type: "same-count-mismatch",
        category: pdf.category,
        level: level.rankLevelUsage,
        score: row.score,
        same,
        computedSame: cumulative - previous[level.cumulativeKey],
      });
    }
    if (index > 0 && cumulative < previous[level.cumulativeKey]) {
      errors.push({ type: "decreasing-cumulative", category: pdf.category, level: level.rankLevelUsage, row, previous });
    }
  }
  return errors;
}

function buildRecord(row, pdf, level) {
  const same = row[level.sameKey];
  const cumulative = row[level.cumulativeKey];
  const rankStart = same > 0 ? cumulative - same + 1 : cumulative;
  const topBoundary = row.topBoundary || row === pdf.rows?.[0];
  const idBase = [YEAR, PROVINCE, pdf.usage, pdf.category, level.rankLevelUsage, row.score, rankStart, cumulative].join("|");
  const categoryLabel = pdf.usage === "sports" ? "体育类总分" : `${pdf.category}总分`;
  return {
    id: `${YEAR}-gd-special-rank-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: "综合",
    batch: `${categoryLabel}一分一段（${level.rankLevelUsageLabel}）`,
    schoolName: "一分一段表",
    dataType: "rank-conversion",
    majorName: topBoundary
      ? `${categoryLabel}位次换算（${row.score}分及以上官方区间，${level.rankLevelUsageLabel}）`
      : `${categoryLabel}位次换算（${level.rankLevelUsageLabel}）`,
    score: row.score,
    rankStart,
    rankEnd: cumulative,
    sameRankScore: same,
    rankUsage: pdf.usage,
    rankUsageLabel: `${categoryLabel}（${level.rankLevelUsageLabel}）`,
    rankCategory: pdf.category,
    rankLevelUsage: level.rankLevelUsage,
    rankLevelUsageLabel: level.rankLevelUsageLabel,
    sourceId: SOURCE_ID,
    sourceQuality: topBoundary
      ? `official-guangdong-special-rank-conversion-pdf-raw-validated-${pdf.usage}-${level.rankLevelUsage}-top-boundary`
      : `official-guangdong-special-rank-conversion-pdf-raw-validated-${pdf.usage}-${level.rankLevelUsage}`,
    ...(topBoundary ? { scoreRange: { min: row.score, max: 750 } } : {}),
    cautions: [
      `一分一段只能用于广东2026年${categoryLabel}${level.rankLevelUsageLabel}同口径总分到位次估算。`,
      "体育/艺术总分分段不能与普通类文化成绩一分一段混用。",
      "广东官方特殊类别表同时区分本科加分和专科加分，本记录用 rankLevelUsage 保留层次口径。",
      "PDF 文本层用 pdftotext -raw 抽取，逐行校验同分人数等于相邻累计人数差值。",
      "位次换算不等同于录取线，仍需结合招生计划、院校专业组、章程和文化/术科双上线要求判断。",
      ...(topBoundary ? [`官方首行是${row.score}分及以上合并区间，不拆分为逐分精确位次。`] : []),
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const { html, pdfs } = ensurePdfs(args);
  const records = [];
  const subjects = [];
  const allErrors = [];

  for (const pdf of pdfs) {
    const rows = parseRows(pdf.file);
    for (const level of LEVEL_USAGES) {
      allErrors.push(...validateRows(rows, pdf, level));
      records.push(...rows.map((row) => buildRecord(row, pdf, level)));
    }
    subjects.push({
      rankUsage: pdf.usage,
      rankCategory: pdf.category,
      pdfNo: pdf.no,
      pdfUrl: pdf.url,
      pdfLabel: pdf.label,
      pdfBytes: pdf.bytes,
      pdfSha256: pdf.sha256,
      displayedRows: rows.length,
      records: rows.length * LEVEL_USAGES.length,
      scoreRange: { min: rows.at(-1)?.score ?? null, max: 750 },
      displayedScoreRange: { min: rows.at(-1)?.score ?? null, max: rows[0]?.score ?? null },
      topBoundary: rows[0] ? {
        score: rows[0].score,
        scoreRange: { min: rows[0].score, max: 750 },
        undergraduateRankEnd: rows[0].undergraduateCumulative,
        vocationalRankEnd: rows[0].vocationalCumulative,
      } : null,
      rankLevels: LEVEL_USAGES.map((level) => ({
        rankLevelUsage: level.rankLevelUsage,
        rankLevelUsageLabel: level.rankLevelUsageLabel,
        finalCumulative: rows.at(-1)?.[level.cumulativeKey] ?? null,
      })),
    });
  }

  if (pdfs.length !== 14) allErrors.push({ type: "wrong-pdf-count", expected: 14, actual: pdfs.length });
  if (allErrors.length) {
    throw new Error(`广东 special rank PDF validation failed:\n${JSON.stringify(allErrors.slice(0, 16), null, 2)}`);
  }

  const payload = {
    dataset: "official-guangdong-special-rank-conversion-2026-import",
    generatedAt: new Date().toISOString(),
    scope: "广东省2026年普通高考体育类/艺术类总分分数段统计表（含本、专科层次加分）",
    notes: [
      "本文件由 scripts/import-official-guangdong-special-rank-conversion-2026.mjs 自动生成。",
      "来源为广东省教育考试院 2026 年普通高考成绩各分数段数据官方 PDF 附件 3-16。",
      "本导入只采用体育类和艺术类总分 PDF，不重复普通历史/物理 PDF。",
      "广东官方特殊类别表同时给出本科层次加分和专科层次加分两组累计人数；本导入用 rankLevelUsage 区分 undergraduate 与 vocational 两个口径。",
      "rankUsage/rankCategory/rankLevelUsage 用于防止普通类、体育总分、艺术方向总分和本专科加分层次混用。",
      "位次换算不是投档线或录取最低分，不能据此单独生成录取概率。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: extractTitle(html),
        publisher: "广东省教育考试院",
        url: args.pageUrl,
        pagePublishedAt: extractPubDate(html),
        pdfUrls: subjects.map((subject) => subject.pdfUrl),
        quality: "official-guangdong-special-rank-conversion-pdf-raw-validated",
        usage: `自动抽取广东2026体育/艺术总分分数段记录${records.length}条，按类别和本科/专科加分层次隔离为特殊类别位次换算记录。`,
        parsedRecords: records.length,
        subjects,
        rankUsages: ["sports", "art"],
        rankLevels: LEVEL_USAGES.map((level) => ({
          rankLevelUsage: level.rankLevelUsage,
          rankLevelUsageLabel: level.rankLevelUsageLabel,
        })),
      },
    ],
    diagnostics: {
      pdfCount: pdfs.length,
      totalRecords: records.length,
      byUsage: Object.fromEntries(["sports", "art"].map((usageName) => [usageName, records.filter((record) => record.rankUsage === usageName).length])),
      byLevel: Object.fromEntries(LEVEL_USAGES.map((level) => [level.rankLevelUsage, records.filter((record) => record.rankLevelUsage === level.rankLevelUsage).length])),
      categories: subjects.map((subject) => subject.rankCategory),
    },
    records: records.sort((a, b) =>
      String(a.rankUsage || "").localeCompare(String(b.rankUsage || ""), "zh-Hans-CN") ||
      String(a.rankCategory || "").localeCompare(String(b.rankCategory || ""), "zh-Hans-CN") ||
      String(a.rankLevelUsage || "").localeCompare(String(b.rankLevelUsage || ""), "zh-Hans-CN") ||
      (Number(b.score) || 0) - (Number(a.score) || 0)
    ),
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    pdfCount: pdfs.length,
    byUsage: payload.diagnostics.byUsage,
    byLevel: payload.diagnostics.byLevel,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
