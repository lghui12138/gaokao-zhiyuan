#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2026;
const PROVINCE = "山东";
const SOURCE_ID = "official-shandong-spring-rank-2026";
const PAGE_URL = "https://www.sdzk.cn/NewsInfo.aspx?NewsID=7259";
const EXPECTED_TITLE = "2026年春季高考成绩一分一段表";
const DEFAULT_OUT = "data/admissions/official-shandong-spring-rank-conversion-2026-import.json";
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-shandong-spring-rank-2026");
const RAW_DIR = path.join(PROJECT_ROOT, "data", "admissions", "raw");

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-shandong-spring-rank-conversion-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-shandong-spring-rank-conversion-2026.mjs --use-cache",
    "",
    "Imports Shandong 2026 official spring-gaokao score segment XLS as rank-conversion records by professional category.",
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
    "Mozilla/5.0 gaokao-shandong-spring-rank-importer/1.0",
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
    "Mozilla/5.0 gaokao-shandong-spring-rank-importer/1.0",
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

function ensureSource(args) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const htmlPath = path.join(TMP_ROOT, "page.html");
  const html = args.useCache && fs.existsSync(htmlPath)
    ? fs.readFileSync(htmlPath, "utf8")
    : fetchText(PAGE_URL);
  fs.writeFileSync(htmlPath, html, "utf8");
  const title = extractTitle(html);
  if (!title.includes(EXPECTED_TITLE)) {
    throw new Error(`Unexpected Shandong spring rank page title: ${title}`);
  }
  const found = xlsLinksFromPage(html, PAGE_URL).find((link) => link.label.includes(EXPECTED_TITLE));
  if (!found) throw new Error("Missing Shandong spring rank XLS attachment.");

  const xls = path.join(TMP_ROOT, "spring-rank.xls");
  if (!args.useCache || !fs.existsSync(xls)) download(found.href, xls);
  const stat = fs.statSync(xls);
  if (stat.size < 100 * 1024) throw new Error(`Downloaded XLS is too small: ${xls} (${stat.size} bytes)`);

  const rawPageFile = path.join(RAW_DIR, "official-shandong-spring-rank-2026.html");
  const rawXlsFile = path.join(RAW_DIR, "official-shandong-spring-rank-2026.xls");
  fs.copyFileSync(htmlPath, rawPageFile);
  fs.copyFileSync(xls, rawXlsFile);
  return {
    title,
    publishedAt: extractPubDate(html),
    pageUrl: PAGE_URL,
    xlsUrl: found.href,
    xlsLabel: found.label,
    xls,
    xlsBytes: stat.size,
    xlsSha256: sha256File(xls),
    rawPageFile,
    rawPageSha256: sha256File(rawPageFile),
    rawXlsFile,
  };
}

function convertToCsv(source, soffice) {
  const csvDir = path.join(TMP_ROOT, "csv");
  fs.rmSync(csvDir, { recursive: true, force: true });
  fs.mkdirSync(csvDir, { recursive: true });
  run(soffice, ["--headless", "--convert-to", "csv", "--outdir", csvDir, source.xls], {
    timeout: 120_000,
  });
  const csv = path.join(csvDir, "spring-rank.csv");
  if (fs.existsSync(csv)) return csv;
  const fallback = path.join(csvDir, `${path.basename(source.xls, path.extname(source.xls))}.csv`);
  if (fs.existsSync(fallback)) return fallback;
  throw new Error(`Missing converted CSV in ${csvDir}`);
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

function cleanCategoryCode(value) {
  const text = String(value ?? "").trim();
  return text.padStart(2, "0");
}

function scoreKey(score) {
  return Number(score).toFixed(2).replace(/\.?0+$/, "");
}

function parseRows(csvText) {
  const rows = [];
  const skipped = [];
  for (const [lineIndex, rawLine] of String(csvText).split(/\r?\n/).entries()) {
    const cells = parseCsvLine(rawLine);
    const code = cleanCategoryCode(cells[0]);
    const categoryName = String(cells[1] ?? "").trim();
    const score = numberFrom(cells[2]);
    const same = numberFrom(cells[3]);
    const cumulative = numberFrom(cells[4]);
    if (!/^\d{2}$/.test(code) || !categoryName || !Number.isFinite(score) || !Number.isFinite(same) || !Number.isFinite(cumulative)) {
      if (cells.some(Boolean) && lineIndex > 1) skipped.push({ lineIndex: lineIndex + 1, rawLine });
      continue;
    }
    if (score < 0 || score > 750 || same < 0 || cumulative < same) {
      skipped.push({ lineIndex: lineIndex + 1, rawLine, reason: "out-of-range" });
      continue;
    }
    rows.push({
      code,
      categoryName,
      category: `${code} ${categoryName}`,
      score: Number(score.toFixed(2)),
      same,
      cumulative,
      raw: rawLine.replace(/\s+/g, " ").trim(),
    });
  }
  return { rows, skipped };
}

function validateRows(parsed) {
  const errors = [];
  const byCategory = new Map();
  for (const row of parsed.rows) {
    const list = byCategory.get(row.category) || [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  for (const [category, rows] of byCategory.entries()) {
    const seen = new Set();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const previous = rows[i - 1];
      const key = scoreKey(row.score);
      if (seen.has(key)) errors.push({ type: "duplicate-score", category, score: row.score });
      seen.add(key);
      if (previous && row.score >= previous.score) {
        errors.push({ type: "non-decreasing-score", category, previous: previous.score, score: row.score });
      }
      if (i === 0 && row.same !== row.cumulative) {
        errors.push({ type: "top-same-cumulative-mismatch", category, row });
      }
      if (previous) {
        if (row.cumulative <= previous.cumulative) {
          errors.push({ type: "non-increasing-cumulative", category, previous, row });
        }
        const computedSame = row.cumulative - previous.cumulative;
        if (row.same !== computedSame) {
          errors.push({ type: "same-count-mismatch", category, score: row.score, same: row.same, computedSame });
        }
      }
    }
  }
  if (!parsed.rows.length) errors.push({ type: "no-rows" });
  return { errors, byCategory };
}

function buildRecord(row) {
  const rankStart = row.same > 0 ? row.cumulative - row.same + 1 : row.cumulative;
  const categoryLabel = `春季高考${row.category}成绩`;
  const idBase = [YEAR, PROVINCE, "spring", row.category, scoreKey(row.score), rankStart, row.cumulative].join("|");
  return {
    id: `${YEAR}-sd-spring-rank-${hash(idBase, 16)}`,
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
    rankUsage: "spring",
    rankUsageLabel: categoryLabel,
    rankCategory: row.category,
    sourceId: SOURCE_ID,
    sourceQuality: "official-shandong-spring-rank-conversion-xls",
    cautions: [
      `一分一段只能用于山东2026年${categoryLabel}同口径分数到位次估算。`,
      "春季高考专业类别位次不能与夏季高考普通类、艺术类、体育类或其他专业类别混用。",
      "XLS 转 CSV 后按专业类别逐行校验本段人数等于相邻累计人数差值。",
      "位次换算不等同于录取线，仍需结合春季高考招生计划、专业类别、院校章程和投档录取规则判断。",
    ],
  };
}

function summarizeCategories(byCategory, recordsByCategory) {
  return [...byCategory.entries()].map(([category, rows]) => {
    const records = recordsByCategory.get(category) || [];
    const scores = rows.map((row) => row.score);
    const first = rows[0] || null;
    const last = rows.at(-1) || null;
    return {
      rankUsage: "spring",
      rankCategory: category,
      categoryCode: first?.code || "",
      categoryName: first?.categoryName || "",
      parsedRows: rows.length,
      records: records.length,
      scoreRange: { min: Math.min(...scores), max: Math.max(...scores) },
      rankRange: { min: records[0]?.rankStart ?? null, max: records.at(-1)?.rankEnd ?? null },
      firstRow: first,
      lastRow: last,
    };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const soffice = findSoffice(args.soffice);
  const source = ensureSource(args);
  const csv = convertToCsv(source, soffice);
  const parsed = parseRows(fs.readFileSync(csv, "utf8"));
  const { errors, byCategory } = validateRows(parsed);
  if (errors.length) {
    throw new Error(`Shandong spring rank XLS validation failed:\n${JSON.stringify(errors.slice(0, 30), null, 2)}`);
  }

  const records = parsed.rows.map(buildRecord);
  const recordsByCategory = new Map();
  for (const record of records) {
    const list = recordsByCategory.get(record.rankCategory) || [];
    list.push(record);
    recordsByCategory.set(record.rankCategory, list);
  }
  const duplicateIds = [];
  const seenIds = new Set();
  for (const record of records) {
    if (seenIds.has(record.id)) duplicateIds.push(record.id);
    seenIds.add(record.id);
  }
  if (duplicateIds.length) {
    throw new Error(`Duplicate Shandong spring record ids: ${duplicateIds.slice(0, 10).join(", ")}`);
  }
  const subjects = summarizeCategories(byCategory, recordsByCategory);
  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    dataset: path.basename(args.out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "山东省2026年春季高考成绩一分一段表",
    notes: [
      "本文件由 scripts/import-official-shandong-spring-rank-conversion-2026.mjs 自动生成。",
      "来源为山东省教育招生考试院 2026 年春季高考成绩一分一段表官方 XLS 附件。",
      "本文件只生成 rank-conversion 记录，用于同专业类别春季高考成绩到位次估算；不生成夏季高考普通类位次、院校投档线、录取最低分或录取概率。",
      "不同春季高考专业类别之间不能互相混用位次。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: "山东省2026年春季高考成绩一分一段表",
        publisher: "山东省教育招生考试院",
        url: PAGE_URL,
        pageUrls: [PAGE_URL],
        attachmentUrls: [source.xlsUrl],
        quality: "official-shandong-spring-rank-conversion-xls",
        usage: `自动抽取山东省2026年春季高考成绩一分一段记录${records.length}条，按 rankUsage=spring 和 rankCategory 隔离为春季高考专业类别位次换算记录。`,
        year: YEAR,
        province: PROVINCE,
        subjectType: "综合",
        parsedRecords: records.length,
        parsedSubjects: subjects,
        pages: [
          {
            title: source.title,
            url: source.pageUrl,
            publishedAt: source.publishedAt,
            rawPageFile: path.relative(PROJECT_ROOT, source.rawPageFile),
            rawPageSha256: source.rawPageSha256,
          },
        ],
        caution: "春季高考专业类别位次只用于同类别春季高考成绩换位次，不能替代夏季高考普通类、艺体类或院校投档/录取最低分。",
      },
    ],
    importAudit: {
      script: "scripts/import-official-shandong-spring-rank-conversion-2026.mjs",
      parser: "official-xls-to-csv",
      file: {
        xlsLabel: source.xlsLabel,
        xlsUrl: source.xlsUrl,
        xlsBytes: source.xlsBytes,
        xlsSha256: source.xlsSha256,
        rawXlsFile: path.relative(PROJECT_ROOT, source.rawXlsFile),
      },
      skippedRows: parsed.skipped,
    },
    records,
  }, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    categories: subjects.length,
    subjects,
  }, null, 2));
}

main();
