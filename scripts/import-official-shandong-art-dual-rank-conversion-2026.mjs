#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2026;
const PROVINCE = "山东";
const SOURCE_ID = "official-shandong-art-dual-rank-2026";
const DEFAULT_OUT = "data/admissions/official-shandong-art-dual-rank-conversion-2026-import.json";
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-shandong-art-dual-rank-2026");
const RAW_DIR = path.join(PROJECT_ROOT, "data", "admissions", "raw");

const CATEGORIES = [
  { key: "design", category: "艺术美术与设计类", labelName: "美术与设计类" },
  { key: "calligraphy", category: "艺术书法类", labelName: "书法类" },
  { key: "dance", category: "艺术舞蹈类", labelName: "舞蹈类" },
  { key: "music-instrumental", category: "艺术音乐类（音乐表演-器乐）", labelName: "音乐类（音乐表演-器乐）" },
  { key: "music-vocal", category: "艺术音乐类（音乐表演-声乐）", labelName: "音乐类（音乐表演-声乐）" },
  { key: "music-education", category: "艺术音乐类（音乐教育）", labelName: "音乐类（音乐教育）" },
  { key: "broadcast", category: "艺术播音与主持类", labelName: "播音与主持类" },
  { key: "drama-performance", category: "艺术表（导）演类（戏剧影视表演方向）", labelName: "表（导）演类（戏剧影视表演方向）" },
  { key: "drama-directing", category: "艺术表（导）演类（戏剧影视导演方向）", labelName: "表（导）演类（戏剧影视导演方向）" },
  { key: "fashion-performance", category: "艺术表（导）演类（服装表演方向）", labelName: "表（导）演类（服装表演方向）" },
];

const PAGES = [
  {
    key: "professional",
    usage: "art-professional",
    scoreMode: "professional",
    scoreModeLabel: "专业成绩",
    pageUrl: "https://www.sdzk.cn/NewsInfo.aspx?NewsID=7270",
    expectedTitle: "2026年本科艺术统考各类别双达线考生专业成绩一分一段表",
  },
  {
    key: "cultural",
    usage: "art-cultural",
    scoreMode: "cultural",
    scoreModeLabel: "文化成绩",
    pageUrl: "https://www.sdzk.cn/NewsInfo.aspx?NewsID=7271",
    expectedTitle: "2026年本科艺术统考各类别双达线考生文化成绩一分一段表",
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-shandong-art-dual-rank-conversion-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-shandong-art-dual-rank-conversion-2026.mjs --use-cache",
    "",
    "Imports Shandong 2026 official art double-qualified professional-score and cultural-score segment XLS files as isolated rank-conversion records.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--soffice") args.soffice = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function hash(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
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

function commandWorks(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function findSoffice(explicit) {
  const candidates = [
    explicit,
    process.env.SOFFICE_BIN,
    "soffice",
    "libreoffice",
    "/opt/homebrew/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (commandWorks(candidate)) return candidate;
  }
  throw new Error("Could not find LibreOffice/soffice for XLS to CSV conversion. Pass --soffice /path/to/soffice.");
}

function fetchText(url) {
  return run("curl", [
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--compressed",
    "-A",
    "Mozilla/5.0 gaokao-shandong-art-dual-rank-importer/1.0",
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
    "Mozilla/5.0 gaokao-shandong-art-dual-rank-importer/1.0",
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

function extractTitle(html) {
  return cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
}

function extractPubDate(html) {
  return /<span[^>]*class=["']date["'][^>]*>([^<]+)<\/span>/i.exec(html)?.[1]?.trim() ||
    /发布时间[:：]\s*([0-9-]+(?:\s+[0-9:]+)?)/.exec(cleanText(html))?.[1] ||
    "";
}

function xlsLinksFromPage(html, pageUrl) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+\.xls)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    links.push({
      href: new URL(match[1], pageUrl).href,
      label: cleanText(match[2]),
    });
  }
  return links;
}

function attachmentMatches(link, page, category) {
  return link.label.includes(category.labelName) &&
    link.label.includes("双达线考生") &&
    link.label.includes(page.scoreModeLabel) &&
    link.label.includes("一分一段表");
}

function ensureSources(args) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const pages = [];
  const files = [];
  for (const page of PAGES) {
    const htmlPath = path.join(TMP_ROOT, `${page.key}-page.html`);
    const html = args.useCache && fs.existsSync(htmlPath)
      ? fs.readFileSync(htmlPath, "utf8")
      : fetchText(page.pageUrl);
    fs.writeFileSync(htmlPath, html, "utf8");
    const title = extractTitle(html);
    if (!title.includes(page.expectedTitle)) {
      throw new Error(`Unexpected Shandong art dual page title for ${page.key}: ${title}`);
    }
    const links = xlsLinksFromPage(html, page.pageUrl);
    const rawPageFile = path.join(RAW_DIR, `official-shandong-art-dual-rank-2026-${page.key}.html`);
    fs.copyFileSync(htmlPath, rawPageFile);
    pages.push({
      key: page.key,
      usage: page.usage,
      scoreMode: page.scoreMode,
      scoreModeLabel: page.scoreModeLabel,
      pageUrl: page.pageUrl,
      title,
      publishedAt: extractPubDate(html),
      rawPageFile,
      rawPageSha256: sha256File(rawPageFile),
    });
    for (const category of CATEGORIES) {
      const found = links.find((link) => attachmentMatches(link, page, category));
      if (!found) throw new Error(`Missing Shandong art dual ${page.scoreModeLabel} attachment: ${category.category}`);
      const file = path.join(TMP_ROOT, `${page.key}-${category.key}.xls`);
      if (!args.useCache || !fs.existsSync(file)) download(found.href, file);
      const stat = fs.statSync(file);
      if (stat.size < 10 * 1024) throw new Error(`Downloaded XLS is too small: ${file} (${stat.size} bytes)`);
      const rawXlsFile = path.join(RAW_DIR, `official-shandong-art-dual-rank-2026-${page.key}-${category.key}.xls`);
      fs.copyFileSync(file, rawXlsFile);
      files.push({
        ...category,
        usage: page.usage,
        scoreMode: page.scoreMode,
        scoreModeLabel: page.scoreModeLabel,
        pageKey: page.key,
        pageUrl: page.pageUrl,
        pageTitle: title,
        publishedAt: extractPubDate(html),
        xlsUrl: found.href,
        xlsLabel: found.label,
        xls: file,
        xlsBytes: stat.size,
        xlsSha256: sha256File(file),
        rawXlsFile,
      });
    }
  }
  return { pages, files };
}

function convertToCsv(files, soffice) {
  const csvDir = path.join(TMP_ROOT, "csv");
  fs.rmSync(csvDir, { recursive: true, force: true });
  fs.mkdirSync(csvDir, { recursive: true });
  run(soffice, ["--headless", "--convert-to", "csv", "--outdir", csvDir, ...files.map((file) => file.xls)], {
    timeout: 120_000,
  });
  return files.map((file) => {
    const csv = path.join(csvDir, `${path.basename(file.xls, path.extname(file.xls))}.csv`);
    if (!fs.existsSync(csv)) throw new Error(`Missing converted CSV: ${csv}`);
    return { ...file, csv };
  });
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (quoted && line[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((item) => item.trim());
}

function numberFrom(value) {
  const text = String(value ?? "").replace(/[,，]/g, "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function scoreKey(score) {
  return Number(score).toFixed(2).replace(/\.?0+$/, "");
}

function parseRows(csvText, file) {
  const rows = [];
  const skipped = [];
  for (const [lineIndex, rawLine] of String(csvText).split(/\r?\n/).entries()) {
    const cells = parseCsvLine(rawLine);
    const score = numberFrom(cells[0]);
    const same = numberFrom(cells[1]);
    const cumulative = numberFrom(cells[2]);
    if (!Number.isFinite(score) || !Number.isFinite(same) || !Number.isFinite(cumulative)) {
      if (cells.some(Boolean) && lineIndex > 1) skipped.push({ lineIndex: lineIndex + 1, rawLine });
      continue;
    }
    if (score < 0 || score > 750 || same < 0 || cumulative < same) {
      skipped.push({ lineIndex: lineIndex + 1, rawLine, reason: "out-of-range" });
      continue;
    }
    rows.push({
      score: Number(score.toFixed(2)),
      same,
      cumulative,
      raw: rawLine.replace(/\s+/g, " ").trim(),
    });
  }
  return { file, rows, skipped };
}

function validateRows(parsed, file) {
  const errors = [];
  const seen = new Set();
  for (let i = 0; i < parsed.rows.length; i += 1) {
    const row = parsed.rows[i];
    const previous = parsed.rows[i - 1];
    const key = scoreKey(row.score);
    if (seen.has(key)) errors.push({ type: "duplicate-score", category: file.category, scoreMode: file.scoreMode, score: row.score });
    seen.add(key);
    if (previous && row.score >= previous.score) {
      errors.push({ type: "non-decreasing-score", category: file.category, scoreMode: file.scoreMode, previous: previous.score, score: row.score });
    }
    if (i === 0 && row.same !== row.cumulative) {
      errors.push({ type: "top-same-cumulative-mismatch", category: file.category, scoreMode: file.scoreMode, row });
    }
    if (previous) {
      if (row.cumulative <= previous.cumulative) {
        errors.push({ type: "non-increasing-cumulative", category: file.category, scoreMode: file.scoreMode, previous, row });
      }
      const computedSame = row.cumulative - previous.cumulative;
      if (row.same !== computedSame) {
        errors.push({ type: "same-count-mismatch", category: file.category, scoreMode: file.scoreMode, score: row.score, same: row.same, computedSame });
      }
    }
  }
  if (!parsed.rows.length) errors.push({ type: "no-rows", category: file.category, scoreMode: file.scoreMode, file: file.xlsLabel });
  return errors;
}

function buildRecord(row, file) {
  const rankStart = row.same > 0 ? row.cumulative - row.same + 1 : row.cumulative;
  const categoryLabel = `${file.category}${file.scoreModeLabel}（双达线）`;
  const idBase = [YEAR, PROVINCE, file.usage, file.category, scoreKey(row.score), rankStart, row.cumulative].join("|");
  return {
    id: `${YEAR}-sd-art-dual-rank-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: "综合",
    batch: `${categoryLabel}一分一段`,
    schoolName: "一分一段表",
    dataType: "rank-conversion",
    majorName: `${categoryLabel}位次换算`,
    score: row.score,
    rankStart,
    rankEnd: row.cumulative,
    sameRankScore: row.same,
    rankUsage: file.usage,
    rankUsageLabel: categoryLabel,
    rankCategory: file.category,
    sourceId: SOURCE_ID,
    sourceQuality: `official-shandong-art-dual-rank-conversion-xls-${file.scoreMode}`,
    cautions: [
      `一分一段只能用于山东2026年${categoryLabel}同口径分数到位次估算。`,
      "双达线专业成绩、双达线文化成绩、综合成绩和普通类文化成绩必须分层使用，不能相互混用。",
      "官方标题限定为本科艺术统考各类别双达线考生，不能推广为全部艺术考生或普通类考生。",
      "XLS 转 CSV 后逐行校验本段人数等于相邻累计人数差值。",
      "位次换算不等同于录取线，仍需结合招生计划、院校专业组、章程和文化/专业双上线要求判断。",
    ],
  };
}

function summarizeParsed(file, records, parsed) {
  const scores = parsed.rows.map((row) => row.score);
  return {
    rankUsage: file.usage,
    rankCategory: file.category,
    scoreMode: file.scoreMode,
    scoreModeLabel: file.scoreModeLabel,
    xlsLabel: file.xlsLabel,
    xlsUrl: file.xlsUrl,
    xlsBytes: file.xlsBytes,
    xlsSha256: file.xlsSha256,
    parsedRows: parsed.rows.length,
    records: records.length,
    scoreRange: { min: Math.min(...scores), max: Math.max(...scores) },
    rankRange: { min: records[0]?.rankStart ?? null, max: records.at(-1)?.rankEnd ?? null },
    firstRow: parsed.rows[0] || null,
    lastRow: parsed.rows.at(-1) || null,
    skippedRows: parsed.skipped.length,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const soffice = findSoffice(args.soffice);
  const source = ensureSources(args);
  const files = convertToCsv(source.files, soffice);
  const records = [];
  const subjects = [];
  const validationErrors = [];
  const skippedRows = [];

  for (const file of files) {
    const parsed = parseRows(fs.readFileSync(file.csv, "utf8"), file);
    validationErrors.push(...validateRows(parsed, file));
    const fileRecords = parsed.rows.map((row) => buildRecord(row, file));
    records.push(...fileRecords);
    subjects.push(summarizeParsed(file, fileRecords, parsed));
    skippedRows.push(...parsed.skipped.map((row) => ({ ...row, category: file.category, scoreMode: file.scoreMode, xlsLabel: file.xlsLabel })));
  }

  const seenIds = new Set();
  const duplicateIds = [];
  for (const record of records) {
    if (seenIds.has(record.id)) duplicateIds.push(record.id);
    seenIds.add(record.id);
  }
  if (duplicateIds.length) validationErrors.push({ type: "duplicate-record-ids", duplicateIds: duplicateIds.slice(0, 10) });
  if (validationErrors.length) {
    throw new Error(`Shandong art dual rank XLS validation failed:\n${JSON.stringify(validationErrors.slice(0, 30), null, 2)}`);
  }

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    dataset: path.basename(args.out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "山东省2026年本科艺术统考各类别双达线考生专业成绩/文化成绩一分一段表",
    notes: [
      "本文件由 scripts/import-official-shandong-art-dual-rank-conversion-2026.mjs 自动生成。",
      "来源为山东省教育招生考试院 2026 年本科艺术统考各类别双达线考生专业成绩和文化成绩一分一段表官方 XLS 附件。",
      "本文件只生成 rank-conversion 记录，用于同类别、同成绩口径的艺术双达线考生分数到位次估算；不生成普通类文化成绩位次、综合成绩位次、院校投档线、录取最低分或录取概率。",
      "专业成绩、文化成绩、综合成绩和普通类文化成绩应继续分层使用，不能相互混用。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: "山东省2026年本科艺术统考各类别双达线考生专业成绩/文化成绩一分一段表",
        publisher: "山东省教育招生考试院",
        url: source.pages.map((page) => page.pageUrl).join(" ; "),
        pageUrls: source.pages.map((page) => page.pageUrl),
        attachmentUrls: source.files.map((file) => file.xlsUrl),
        quality: "official-shandong-art-dual-rank-conversion-xls",
        usage: `自动抽取山东省2026年本科艺术统考各类别双达线考生专业成绩/文化成绩一分一段记录${records.length}条，按 rankUsage/rankCategory 隔离为艺术双达线位次换算记录。`,
        year: YEAR,
        province: PROVINCE,
        subjectType: "综合",
        parsedRecords: records.length,
        parsedSubjects: subjects,
        pages: source.pages.map((page) => ({
          key: page.key,
          usage: page.usage,
          scoreMode: page.scoreMode,
          title: page.title,
          url: page.pageUrl,
          publishedAt: page.publishedAt,
          rawPageFile: path.relative(PROJECT_ROOT, page.rawPageFile),
          rawPageSha256: page.rawPageSha256,
        })),
        caution: "双达线专业成绩/文化成绩一分一段只用于同类别同成绩口径换位次，不能替代普通类文化成绩、艺体综合成绩、院校投档/录取最低分或录取概率。",
      },
    ],
    importAudit: {
      script: "scripts/import-official-shandong-art-dual-rank-conversion-2026.mjs",
      parser: "official-xls-to-csv",
      files: source.files.map((file) => ({
        rankUsage: file.usage,
        rankCategory: file.category,
        scoreMode: file.scoreMode,
        xlsLabel: file.xlsLabel,
        xlsUrl: file.xlsUrl,
        xlsBytes: file.xlsBytes,
        xlsSha256: file.xlsSha256,
        rawXlsFile: path.relative(PROJECT_ROOT, file.rawXlsFile),
      })),
      skippedRows,
    },
    records,
  }, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    subjects,
  }, null, 2));
}

main();
