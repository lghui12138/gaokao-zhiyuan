#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-school-admission-2025-v3162-tgu-import.json";
const RAW_DIR = "data/admissions/raw/official-xizang-school-admission-2025-v3162-tgu";
const PROVINCE = "西藏";

const SOURCE = {
  id: "official-tgu-xizang-2025-school-admission",
  quality: "official-school-tgu-2025-xizang-html-table-score-only",
  schoolCode: "0048",
  schoolName: "天津工业大学",
  city: "天津",
  tags: ["理工"],
  url: "https://zsb.tiangong.edu.cn/2025/1229/c196a111721/page.htm",
};

const SOURCE_ROWS = [
  {
    batch: "国家专项本科",
    majorName: "材料科学与工程",
    subjectRaw: "理工",
    maxScore: 460,
    minScore: 345,
    avgScore: 418.67,
    scienceCount: 3,
    artsCount: 0,
    formalScoreScope: "special-path-only",
    admissionType: "国家专项",
  },
  { batch: "本科一批", majorName: "纺织工程", subjectRaw: "理工", maxScore: 433, minScore: 337, avgScore: 385, scienceCount: 2, artsCount: 0 },
  { batch: "本科一批", majorName: "服装设计与工程", subjectRaw: "理工", maxScore: 343, minScore: 338, avgScore: 340.5, scienceCount: 2, artsCount: 0 },
  { batch: "本科一批", majorName: "环境工程", subjectRaw: "理工", maxScore: 330, minScore: 309, avgScore: 319.5, scienceCount: 2, artsCount: 0 },
  { batch: "本科一批", majorName: "通信工程", subjectRaw: "理工", maxScore: 467, minScore: 455, avgScore: 461, scienceCount: 2, artsCount: 0 },
  { batch: "本科一批", majorName: "自动化", subjectRaw: "理工", maxScore: 473, minScore: 470, avgScore: 471.5, scienceCount: 2, artsCount: 0 },
  { batch: "本科一批", majorName: "金融学", subjectRaw: "理工", maxScore: 374, minScore: 345, avgScore: 359.5, scienceCount: 2, artsCount: 0 },
  { batch: "本科一批", majorName: "信息管理与信息系统", subjectRaw: "理工", maxScore: 448, minScore: 434, avgScore: 441, scienceCount: 2, artsCount: 0 },
  { batch: "本科一批", majorName: "网络与新媒体", subjectRaw: "文史", maxScore: 466, minScore: 395, avgScore: 430.5, scienceCount: 0, artsCount: 2 },
  { batch: "本科一批", majorName: "工商管理", subjectRaw: "文史", maxScore: 386, minScore: 385, avgScore: 385.5, scienceCount: 0, artsCount: 2 },
  { batch: "本科一批", majorName: "会计学", subjectRaw: "文史", maxScore: 462, minScore: 391, avgScore: 426.5, scienceCount: 0, artsCount: 2 },
  { batch: "本科一批", majorName: "法学", subjectRaw: "文史", maxScore: 491, minScore: 472, avgScore: 481.5, scienceCount: 0, artsCount: 2 },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-school-admission-2025-v3162-tgu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-school-admission-2025-v3162-tgu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Tianjin Polytechnic University official Xizang 2025 major admission score table.",
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

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function numericRange(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&nbsp;|\u00a0|&#160;/gi, " ")
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
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(html, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return textFromHtml(match[1]);
  }
  return "";
}

function pageMeta(html) {
  return {
    title: firstText(html, [/<meta\s+property=["']og:title["']\s+content=["']([\s\S]*?)["']/i, /<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]),
    publishedAt: firstText(html, [/发布时间\s*[:：]?\s*([0-9]{4}[-年][0-9]{1,2}[-月][0-9]{1,2}日?(?:\s+[0-9:]+)?)/i]),
  };
}

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-xizang-tgu-v3162-importer/1.0",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }
  const curl = spawnSync("curl", [
    "-L",
    "--compressed",
    "--fail",
    "--silent",
    "--show-error",
    "--max-time",
    "90",
    "-A",
    "Mozilla/5.0 gaokao-xizang-tgu-v3162-importer/1.0",
    SOURCE.url,
  ], {
    encoding: "buffer",
    maxBuffer: 24 * 1024 * 1024,
  });
  if (!curl.error && curl.status === 0 && curl.stdout?.length > 0) return Buffer.from(curl.stdout);
  throw new Error([
    `fetch and curl failed for ${url}`,
    String(lastError),
    curl.error ? String(curl.error) : "",
    curl.stderr?.toString("utf8").trim(),
  ].filter(Boolean).join("\n"));
}

async function ensureRawHtml(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const file = path.join(rawDir, "tgu-xizang-2025-major-admission.html");
  if (!useCache || !fs.existsSync(file)) {
    fs.writeFileSync(file, await download(SOURCE.url));
  }
  return file;
}

function subjectType(sourceSubjectRaw) {
  if (sourceSubjectRaw === "理工") return "物理类";
  if (sourceSubjectRaw === "文史") return "历史类";
  throw new Error(`Unsupported subject: ${sourceSubjectRaw}`);
}

function baseFields() {
  return {
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: SOURCE.url,
  };
}

function cautionsFor(scope) {
  const cautions = [
    "本记录来自天津工业大学招生网官方西藏2025专业录取分数统计，是单校分省专业录取分数边界，不是西藏自治区教育考试院全量投档/录取分数表。",
    "源表未公开最低位次；不得生成假位次或单独输出录取概率。",
  ];
  if (scope === "special-path-only") {
    cautions.push("国家专项本科按 formalScoreScope=special-path-only 隔离，只用于对应资格入口复核，不替代普通本科一批文化分边界。");
  } else {
    cautions.push("普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得清除西藏省级全量正式分数表缺口。");
  }
  return cautions;
}

function rowText(row) {
  return [
    "2025",
    PROVINCE,
    row.batch,
    row.subjectRaw,
    row.majorName,
    `最高分${row.maxScore}`,
    `最低分${row.minScore}`,
    `平均分${row.avgScore.toFixed(2)}`,
    `理工录取人数${row.scienceCount}`,
    `文史录取人数${row.artsCount}`,
  ].join(" / ");
}

function buildRecords() {
  return SOURCE_ROWS.map((row) => {
    const scope = row.formalScoreScope || "school-official-only";
    const idBase = [2025, SOURCE.schoolCode, row.batch, row.subjectRaw, row.majorName, row.minScore, row.maxScore].join("|");
    const admissionCount = row.subjectRaw === "理工" ? row.scienceCount : row.artsCount;
    return {
      id: `2025-tgu-xizang-major-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: 2025,
      subjectType: subjectType(row.subjectRaw),
      sourceSubjectRaw: row.subjectRaw,
      batch: row.batch,
      sourceBatchRaw: row.batch,
      ...baseFields(),
      dataType: "major-admission",
      majorName: row.majorName,
      admissionType: row.admissionType || "普通类",
      formalScoreScope: scope,
      minScore: row.minScore,
      maxScore: row.maxScore,
      avgScore: row.avgScore,
      admissionCount,
      sourceScienceAdmissionCount: row.scienceCount,
      sourceArtsAdmissionCount: row.artsCount,
      scoreOnly: true,
      rankUnavailable: true,
      sourceMinScoreRaw: String(row.minScore),
      sourceMaxScoreRaw: String(row.maxScore),
      sourceAvgScoreRaw: row.avgScore.toFixed(2),
      sourceScoreScale: "source-declared-admission-score",
      transcriptionMethod: "official-html-table-manual-transcription-validated",
      cautions: cautionsFor(scope),
      rawText: rowText(row),
    };
  });
}

function validateHtml(html) {
  const meta = pageMeta(html);
  const plain = textFromHtml(html);
  if (!plain.includes("西藏自治区2025年专业录取分数统计") || !plain.includes("天津工业大学招生办公室")) {
    throw new Error("TGU source page no longer exposes the expected Xizang 2025 title/publisher tokens.");
  }
  const publishedAt = meta.publishedAt.replace(/[年月]/g, "-").replace(/日/g, "");
  if (publishedAt && publishedAt !== "2025-12-29") {
    throw new Error(`Unexpected TGU publishedAt ${meta.publishedAt}`);
  }
  for (const row of SOURCE_ROWS) {
    const expected = [
      row.majorName,
      String(row.maxScore),
      String(row.minScore),
      row.avgScore.toFixed(2),
      String(row.scienceCount),
      String(row.artsCount),
    ];
    let cursor = 0;
    for (const token of expected) {
      const next = plain.indexOf(token, cursor);
      if (next === -1) {
        throw new Error(`TGU source page missing expected token sequence for ${row.majorName}: ${expected.join(" / ")}`);
      }
      cursor = next + token.length;
    }
  }
  return meta;
}

function diagnosticsFor(records) {
  const schoolOfficial = records.filter((record) => record.formalScoreScope === "school-official-only");
  const specialPath = records.filter((record) => record.formalScoreScope === "special-path-only");
  return {
    totalRows: records.length,
    schoolOfficialRows: schoolOfficial.length,
    specialPathRows: specialPath.length,
    bySourceId: countBy(records, (record) => record.sourceId),
    bySchool: countBy(records, (record) => record.schoolName),
    byDataType: countBy(records, (record) => record.dataType),
    bySubject: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
    ordinarySchoolOfficialScoreRange: numericRange(schoolOfficial.map((record) => Number(record.minScore))),
    rankRows: records.filter((record) => Number.isFinite(record.minRank)).length,
  };
}

function sourceNoteFor(records, htmlFile, meta) {
  const rawPath = path.relative(PROJECT_ROOT, htmlFile);
  return {
    id: SOURCE.id,
    title: "天津工业大学招生网：西藏自治区2025年专业录取分数统计",
    publisher: SOURCE.schoolName,
    publishedAt: meta.publishedAt || "2025-12-29",
    url: SOURCE.url,
    quality: SOURCE.quality,
    usage: `抽取${SOURCE.schoolName}招生网西藏2025年专业录取最高分、最低分、平均分和录取人数。`,
    parsedRecords: records.length,
    rawPaths: [rawPath],
    sha256: [{ path: rawPath, sha256: sha256File(htmlFile) }],
    transcriptionMethod: "official-html-table-manual-transcription-validated",
    cautions: [
      "本源为高校官方单校录取数据，不是西藏自治区教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "国家专项本科按 formalScoreScope=special-path-only 隔离。",
      "源表未公开最低位次，不生成假位次或录取概率。",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const rawDir = path.resolve(PROJECT_ROOT, RAW_DIR);
  const htmlFile = await ensureRawHtml(rawDir, args.useCache);
  const html = fs.readFileSync(htmlFile, "utf8");
  const meta = validateHtml(html);
  const records = buildRecords();
  const diagnostics = diagnosticsFor(records);
  if (diagnostics.totalRows !== 12 || diagnostics.rankRows !== 0 || diagnostics.schoolOfficialRows !== 11 || diagnostics.specialPathRows !== 1) {
    throw new Error(`Unexpected v3.162 TGU diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const output = {
    dataset: "official-xizang-school-admission-2025-v3162-tgu-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      sourceKind: "school-official-single-university-html-table-score",
      schools: [SOURCE.schoolName],
    },
    notes: [
      "本文件由 scripts/import-official-xizang-school-admission-2025-v3162-tgu.mjs 自动生成。",
      "来源为天津工业大学招生网《西藏自治区2025年专业录取分数统计》HTML 表；原始页面已保留在 raw provenance pack。",
      "本科一批普通专业 11 条按 school-official-only 使用；国家专项本科 1 条按 special-path-only 隔离。",
      "学校官网单校分数只作候选边界复核，不能替代西藏考试院全量投档/录取分数表。",
      "源表未公开最低位次；所有记录均不生成假位次或录取概率。",
    ],
    sourceNotes: [sourceNoteFor(records, htmlFile, meta)],
    diagnostics,
    records,
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    schoolOfficialRows: diagnostics.schoolOfficialRows,
    specialPathRows: diagnostics.specialPathRows,
    rankRows: diagnostics.rankRows,
    byDataType: diagnostics.byDataType,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
