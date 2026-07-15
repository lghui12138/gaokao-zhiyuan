#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2023;
const PROVINCE = "吉林";
const SOURCE_ID = "official-content-mirror-eol-jilin-rank-2023";
const DEFAULT_OUT = "data/admissions/official-content-mirror-eol-jilin-rank-conversion-2023-import.json";
const DEFAULT_RAW_DIR = "data/admissions/raw/eol-jilin-rank-2023";
const SOURCE_QUALITY = "official-content-mirror-eol-jilin-rank-conversion-html-table";

const SUBJECTS = [
  {
    subjectType: "物理类",
    sourceSubject: "理工1分段表",
    sourceSubjectRaw: "理工类",
    subjectMappingNote: "2023年吉林仍为旧文理口径，站内将理工类映射到物理类以便与新高考普通类位次层衔接。",
    localName: "jilin-2023-science-rank.html",
    url: "https://gaokao.eol.cn/ji_lin/dongtai/202306/t20230623_2446360.shtml",
  },
  {
    subjectType: "历史类",
    sourceSubject: "文史1分段表",
    sourceSubjectRaw: "文史类",
    subjectMappingNote: "2023年吉林仍为旧文理口径，站内将文史类映射到历史类以便与新高考普通类位次层衔接。",
    localName: "jilin-2023-arts-rank.html",
    url: "https://gaokao.eol.cn/ji_lin/dongtai/202306/t20230623_2446361.shtml",
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-eol-jilin-rank-conversion-2023.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-eol-jilin-rank-conversion-2023.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH        output JSON path",
    "  --raw-dir PATH    raw HTML cache directory",
    "  --use-cache      reuse downloaded EOL HTML pages",
    "",
    "Imports EOL mirrored Jilin 2023 science/arts score-segment HTML tables as rank-conversion records.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, rawDir: DEFAULT_RAW_DIR, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--raw-dir") args.rawDir = argv[++i];
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

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-eol-jilin-rank-importer/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureHtml(subject, rawDir, useCache) {
  const file = path.join(rawDir, subject.localName);
  if (!useCache || !fs.existsSync(file)) {
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(file, await download(subject.url));
  }
  if (fs.statSync(file).size < 20 * 1024) throw new Error(`HTML is too small: ${file}`);
  return file;
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&nbsp;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function textFromHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(html, pattern) {
  const match = pattern.exec(html);
  return match ? textFromHtml(match[1]) : "";
}

function pageMeta(html) {
  return {
    title: firstText(html, /<div\s+class=["']title["'][^>]*>([\s\S]*?)<\/div>/i)
      || firstText(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    publishedAt: firstText(html, /<div\s+class=["']time["'][^>]*>([\s\S]*?)<\/div>/i),
    origin: firstText(html, /<div\s+class=["']origin["'][^>]*>([\s\S]*?)<\/div>/i),
  };
}

function parseInteger(value) {
  const normalized = textFromHtml(value).replace(/,/g, "");
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

function extractTableRows(html) {
  const rows = [];
  for (const trMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...trMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => textFromHtml(cell[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseRowsFromHtml(html, subject) {
  const tableRows = extractTableRows(html);
  const headerIndex = tableRows.findIndex((row) =>
    row[0] === "分数" && row.slice(1).some((cell) => /^\+\d+$/.test(cell))
  );
  if (headerIndex < 0) throw new Error(`Could not find score matrix header for ${subject.sourceSubject}`);

  const titleRow = [...tableRows.slice(0, headerIndex)].reverse().find((row) => row.join("").includes("1分段表")) || [];
  const offsets = tableRows[headerIndex].slice(1).map((cell) => {
    const match = /^\+(\d+)$/.exec(cell);
    if (!match) throw new Error(`Unexpected offset header for ${subject.sourceSubject}: ${cell}`);
    return Number(match[1]);
  });
  if (offsets.length !== 10 || offsets[0] !== 9 || offsets[offsets.length - 1] !== 0) {
    throw new Error(`Unexpected +9..+0 matrix for ${subject.sourceSubject}: ${offsets.join(",")}`);
  }

  const rawRows = [];
  const blankScoreCells = [];
  for (const row of tableRows.slice(headerIndex + 1)) {
    const baseScore = parseInteger(row[0] || "");
    if (!Number.isFinite(baseScore) || baseScore < 0 || baseScore > 750) continue;
    offsets.forEach((offset, index) => {
      const sourceCell = row[index + 1] || "";
      const cumulative = parseInteger(sourceCell);
      const score = baseScore + offset;
      if (!Number.isFinite(cumulative)) {
        blankScoreCells.push(score);
        return;
      }
      rawRows.push({
        score,
        cumulative,
        subjectType: subject.subjectType,
        sourceSubjectRaw: subject.sourceSubjectRaw,
        raw: row.join(" | "),
      });
    });
  }

  const byScore = new Map();
  for (const row of rawRows) {
    const existing = byScore.get(row.score);
    if (!existing || row.cumulative < existing.cumulative) byScore.set(row.score, row);
  }
  const allRows = [...byScore.values()].sort((a, b) => b.score - a.score);
  return {
    tableTitle: titleRow.join(" ").trim(),
    headerOffsets: offsets,
    rows: allRows,
    blankScoreCells: [...new Set(blankScoreCells)].sort((a, b) => b - a),
    duplicateScoreCells: rawRows.length - byScore.size,
  };
}

function validateRows(parsed, subject) {
  const errors = [];
  const zeroCandidateScores = [];
  const scoreGaps = [];
  const keptRows = [];

  for (let i = 0; i < parsed.rows.length; i += 1) {
    const row = parsed.rows[i];
    const previous = parsed.rows[i - 1];
    if (i > 0 && previous.score - row.score > 1) {
      scoreGaps.push({ from: previous.score - 1, to: row.score + 1, width: previous.score - row.score - 1 });
    }
    if (i > 0 && row.cumulative < previous.cumulative) {
      errors.push({ type: "decreasing-cumulative", subjectType: subject.subjectType, previous, row });
    }
    const sameRankScore = i === 0 ? row.cumulative : row.cumulative - previous.cumulative;
    if (sameRankScore > 0) {
      keptRows.push({
        ...row,
        sameRankScore,
        rankEnd: row.cumulative,
        rankStart: Math.max(1, row.cumulative - sameRankScore + 1),
      });
    } else {
      zeroCandidateScores.push(row.score);
    }
  }

  if (parsed.rows.length < 500) errors.push({ type: "too-few-html-score-cells", subjectType: subject.subjectType, rows: parsed.rows.length });
  if (keptRows.length < 300) errors.push({ type: "too-few-positive-records", subjectType: subject.subjectType, rows: keptRows.length });
  if (errors.length) throw new Error(`Invalid Jilin 2023 rank rows for ${subject.subjectType}: ${JSON.stringify(errors.slice(0, 5))}`);

  return { rows: keptRows, zeroCandidateScores, scoreGaps };
}

function buildRecord(row) {
  const subjectSlug = row.subjectType === "物理类" ? "physics" : "history";
  const idBase = [YEAR, PROVINCE, row.subjectType, row.score, row.rankStart, row.rankEnd].join("|");
  return {
    id: `${YEAR}-jl-eol-rank-${subjectSlug}-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: row.subjectType,
    sourceSubjectRaw: row.sourceSubjectRaw,
    batch: "一分一段",
    schoolName: "一分一段表",
    dataType: "rank-conversion",
    majorName: "分数位次换算",
    score: row.score,
    rankStart: row.rankStart,
    rankEnd: row.rankEnd,
    sameRankScore: row.sameRankScore,
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    cautions: [
      "一分一段只能用于吉林2023年同科类分数到位次估算。",
      "EOL页面标注来源为吉林省教育考试院；本层按官方内容镜像使用，不等同于省考试院原站直连闭合。",
      "2023年吉林仍为旧文理口径，站内把理工类映射到物理类、文史类映射到历史类；跨新高考年份比较需保留口径差异。",
      "HTML矩阵空白格不生成合成分数行；同分人数由相邻累计人数差值推导。",
      "位次换算不等同于投档线或录取最低分，不能据此单独生成录取概率。",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const rawDir = path.resolve(PROJECT_ROOT, args.rawDir);
  const parsedSubjects = [];
  for (const subject of SUBJECTS) {
    const file = await ensureHtml(subject, rawDir, args.useCache);
    const html = fs.readFileSync(file, "utf8");
    const meta = pageMeta(html);
    const parsed = parseRowsFromHtml(html, subject);
    const validated = validateRows(parsed, subject);
    parsedSubjects.push({
      ...subject,
      file,
      htmlSha256: sha256File(file),
      meta,
      tableTitle: parsed.tableTitle,
      htmlScoreCells: parsed.rows.length,
      duplicateScoreCells: parsed.duplicateScoreCells,
      blankScoreCells: parsed.blankScoreCells,
      zeroCandidateScores: validated.zeroCandidateScores,
      scoreGaps: validated.scoreGaps,
      rows: validated.rows,
    });
  }

  const records = parsedSubjects.flatMap((parsed) => parsed.rows.map(buildRecord));
  const sourceNotes = [
    {
      id: SOURCE_ID,
      title: "吉林省2023年高考成绩一分一段表（理工/文史，含照顾分）",
      publisher: "吉林省教育考试院（EOL页面标注来源）",
      mirroredBy: "中国教育在线 / EOL",
      publishedAt: "2023-06-23",
      url: "https://gaokao.eol.cn/ji_lin/dongtai/202306/t20230625_2446986.shtml",
      attachmentUrls: SUBJECTS.map((subject) => subject.url),
      quality: SOURCE_QUALITY,
      usage: "抽取EOL公开页面中标注来源为吉林省教育考试院的吉林2023理工/文史1分段HTML表，生成同年同原始科类分数到位次换算记录。",
      parsedRecords: records.length,
      subjects: parsedSubjects.map((item) => ({
        subjectType: item.subjectType,
        sourceSubjectRaw: item.sourceSubjectRaw,
        sourceSubject: item.sourceSubject,
        mappingNote: item.subjectMappingNote,
        records: item.rows.length,
        htmlScoreCells: item.htmlScoreCells,
        blankScoreCells: item.blankScoreCells.length,
        zeroCandidateScores: item.zeroCandidateScores.length,
        duplicateScoreCells: item.duplicateScoreCells,
        scoreGapCount: item.scoreGaps.length,
        scoreRange: {
          min: Math.min(...item.rows.map((row) => row.score)),
          max: Math.max(...item.rows.map((row) => row.score)),
        },
        rankRange: {
          min: Math.min(...item.rows.map((row) => row.rankStart)),
          max: Math.max(...item.rows.map((row) => row.rankEnd)),
        },
        pageTitle: item.meta.title,
        pageOrigin: item.meta.origin,
        pagePublishedAt: item.meta.publishedAt,
        tableTitle: item.tableTitle,
        rawPath: path.relative(PROJECT_ROOT, item.file),
        htmlSha256: item.htmlSha256,
      })).sort((a, b) => String(a.subjectType).localeCompare(String(b.subjectType), "zh-Hans-CN")),
    },
  ];

  const payload = {
    dataset: "official-content-mirror-eol-jilin-rank-conversion-2023-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "official-content-mirror-rank-conversion",
    },
    notes: [
      "本文件由 scripts/import-eol-jilin-rank-conversion-2023.mjs 自动生成。",
      "来源为中国教育在线公开页，页面来源栏标注吉林省教育考试院；按 official-content-mirror 使用，不作考试院原站直连闭合。",
      "仅导入理工类/文史类普通1分段表；2023旧文理口径映射为站内物理类/历史类时必须保留原始科类字段。",
      "HTML 矩阵空白格不生成合成分数行；累计人数单调校验通过后才导入。",
      "位次换算不是投档线或录取最低分，不能据此单独生成录取概率。",
    ],
    sourceNotes,
    diagnostics: {
      parsedPageCount: parsedSubjects.length,
      totalRecords: records.length,
      bySubject: Object.fromEntries(parsedSubjects.map((subject) => [subject.subjectType, subject.rows.length])),
      byRawSubject: Object.fromEntries(parsedSubjects.map((subject) => [subject.sourceSubjectRaw, subject.rows.length])),
      blankScoreCells: Object.fromEntries(parsedSubjects.map((subject) => [subject.subjectType, subject.blankScoreCells.length])),
      zeroCandidateScores: Object.fromEntries(parsedSubjects.map((subject) => [subject.subjectType, subject.zeroCandidateScores.length])),
      scoreGaps: Object.fromEntries(parsedSubjects.map((subject) => [subject.subjectType, subject.scoreGaps.length])),
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
    bySubject: payload.diagnostics.bySubject,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
