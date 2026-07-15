#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2019;
const PROVINCE = "吉林";
const SOURCE_ID = "official-jilin-filing-2019";
const SOURCE_QUALITY = "official-chsi-jilin-2019-first-filing-pdf-score-only";
const DEFAULT_OUT = "data/admissions/official-jilin-filing-2019-import.json";
const RAW_DIR = "data/admissions/raw/official-jilin-filing-2019";
const PAGE_URL = "https://gaokao.eol.cn/ji_lin/dongtai/201909/t20190916_1683020.shtml";
const PDF_URL = "https://gaokao.chsi.com.cn/news/file.do?method=downFile&id=1823135173&attach=true&hist=false";
const PAGE_FILE = "eol-jilin-filing-2019.html";
const PDF_FILE = "jilin-2019-first-filing.pdf";
const TEXT_FILE = "text/jilin-2019-first-filing-layout.txt";

const BATCHES = [
  "国家专项计划批",
  "地方专项计划批",
  "第一批A段",
  "第一批B段",
  "第二批A段",
  "第二批B段",
  "专科批",
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-jilin-filing-2019.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-jilin-filing-2019.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded page/PDF/text files",
    "  --pdftotext PATH   pdftotext executable, default: pdftotext",
    "",
    "Imports the 2019 Jilin ordinary-class first filing PDF as institution/vocational score-only records.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false, pdftotext: process.env.PDFTOTEXT_BIN || "pdftotext" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--pdftotext") args.pdftotext = argv[++i];
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function firstText(html, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return textFromHtml(match[1]);
  }
  return "";
}

function pageMeta(html) {
  return {
    title: firstText(html, [
      /<div\s+class=["']title["'][^>]*>([\s\S]*?)<\/div>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]),
    source: firstText(html, [
      /<div\s+class=["']origin["']>\s*([\s\S]*?)<\/div>/i,
      /<span>\s*来源：\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
      /来源：\s*([^<\n]+)</i,
    ]),
    publishedAt: firstText(html, [
      /<div\s+class=["']time["']>\s*([\s\S]*?)<\/div>/i,
      /<span>\s*时间：\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
      /(\d{4}-\d{2}-\d{2})/i,
    ]),
  };
}

async function download(url, options = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-jilin-filing-2019-importer/1.0",
      accept: options.accept || "*/*",
      ...(options.referer ? { referer: options.referer } : {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureRawFiles(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const pageFile = path.join(rawDir, PAGE_FILE);
  const pdfFile = path.join(rawDir, PDF_FILE);

  if (!useCache || !fs.existsSync(pageFile)) {
    fs.writeFileSync(pageFile, await download(PAGE_URL, {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }));
  }
  if (fs.statSync(pageFile).size < 20 * 1024) throw new Error(`EOL source page is too small: ${pageFile}`);

  if (!useCache || !fs.existsSync(pdfFile)) {
    fs.writeFileSync(pdfFile, await download(PDF_URL, {
      accept: "application/pdf,*/*;q=0.8",
      referer: PAGE_URL,
    }));
  }
  const pdf = fs.readFileSync(pdfFile);
  if (pdf.length < 500 * 1024 || pdf.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw new Error(`CHSI filing attachment is not a valid PDF or is too small: ${pdfFile}`);
  }
  return { pageFile, pdfFile };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
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

function ensureTextFile(pdfFile, textFile, useCache, pdftotext) {
  if (useCache && fs.existsSync(textFile) && fs.statSync(textFile).size > 50 * 1024) return;
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  run(pdftotext, ["-layout", pdfFile, textFile]);
  if (!fs.existsSync(textFile) || fs.statSync(textFile).size < 50 * 1024) {
    throw new Error(`pdftotext did not produce a usable text file: ${textFile}`);
  }
}

function subjectForSource(raw) {
  if (raw === "理科") {
    return {
      subjectType: "物理类",
      sourceSubjectRaw: "理科",
      subjectMappingNote: "2019年吉林仍为旧文理口径，站内将理科映射到物理类以便与新高考普通类数据层衔接。",
    };
  }
  if (raw === "文科") {
    return {
      subjectType: "历史类",
      sourceSubjectRaw: "文科",
      subjectMappingNote: "2019年吉林仍为旧文理口径，站内将文科映射到历史类以便与新高考普通类数据层衔接。",
    };
  }
  throw new Error(`Unknown source subject: ${raw}`);
}

function dataTypeForBatch(batch) {
  return batch === "专科批" ? "vocational-admission" : "institution-admission";
}

function formalScoreScopeForBatch(batch) {
  return /专项/.test(batch) ? "special-path-only" : "ordinary";
}

function parseRowsFromText(text) {
  if (!text.includes("2019年普通类有关批次院校第一次投档分数")) {
    throw new Error("Missing expected Jilin 2019 filing PDF title in text layer.");
  }
  if (!text.includes("院校代码") || !text.includes("投档最低分")) {
    throw new Error("Missing expected Jilin 2019 filing table headers in text layer.");
  }

  const batchPattern = BATCHES.map(escapeRegExp).join("|");
  const rowPattern = new RegExp(`^\\s*([0-9A-Z]{4})\\s+(.+?)\\s+(${batchPattern})\\s+(文科|理科)\\s+(\\d{3}\\.\\d{9})\\s*$`);
  const candidatePattern = /^\s*[0-9A-Z]{4}\s+.+?(文科|理科)\s+\d{3}\.\d{9}\s*$/;
  const rows = [];
  const unparsedCandidates = [];

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/^\f/, "").trimEnd();
    const match = rowPattern.exec(line);
    if (!match) {
      if (candidatePattern.test(line)) unparsedCandidates.push(line.trim());
      continue;
    }
    const [, schoolCode, schoolName, batch, rawSubject, filingScoreText] = match;
    const subject = subjectForSource(rawSubject);
    const noFilingCandidates = /^0{3}\.0{9}$/.test(filingScoreText);
    const totalScore = Number(filingScoreText.slice(0, 3));
    rows.push({
      schoolCode,
      schoolName: schoolName.trim().replace(/\s+/g, " "),
      batch,
      rawSubject,
      ...subject,
      filingScoreText,
      totalScore,
      noFilingCandidates,
      rawText: line.trim(),
    });
  }

  return { rows, unparsedCandidates };
}

function validateParsed(parsed) {
  const errors = [];
  const { rows, unparsedCandidates } = parsed;
  if (rows.length < 2500) errors.push({ type: "too-few-filing-rows", rows: rows.length });
  if (unparsedCandidates.length) errors.push({ type: "unparsed-candidate-lines", examples: unparsedCandidates.slice(0, 5), count: unparsedCandidates.length });
  const unknownBatches = rows.filter((row) => !BATCHES.includes(row.batch));
  if (unknownBatches.length) errors.push({ type: "unknown-batches", examples: unknownBatches.slice(0, 5) });
  const badScores = rows.filter((row) =>
    !Number.isFinite(row.totalScore) ||
    row.totalScore < 0 ||
    row.totalScore > 750 ||
    (!row.noFilingCandidates && row.totalScore === 0)
  );
  if (badScores.length) errors.push({ type: "bad-scores", examples: badScores.slice(0, 5) });
  const ordinaryNonZero = rows.filter((row) => formalScoreScopeForBatch(row.batch) === "ordinary" && !row.noFilingCandidates);
  if (ordinaryNonZero.length < 2000) errors.push({ type: "too-few-ordinary-nonzero-score-rows", rows: ordinaryNonZero.length });
  if (!rows.some((row) => row.batch === "专科批" && !row.noFilingCandidates)) {
    errors.push({ type: "missing-vocational-score-rows" });
  }
  if (errors.length) {
    throw new Error(`Invalid Jilin 2019 filing parse: ${JSON.stringify(errors.slice(0, 5), null, 2)}`);
  }
}

function cautionsFor(row) {
  const cautions = [
    "本表为吉林2019普通类有关批次院校第一次投档分数，不包含征集批次。",
    "投档最低分小数点前为高考总成绩，小数点后为同分排序相关单科成绩；站内推荐只使用小数点前总分。",
    "原表不含最低位次，不能生成假位次或单独输出录取概率。",
    "2019旧文理口径映射为站内物理类/历史类时必须保留原始科类字段。",
  ];
  if (formalScoreScopeForBatch(row.batch) === "special-path-only") {
    cautions.push("国家/地方专项计划批需要专项资格，只作特殊路径进档边界，不计作普通批次可直接报考边界。");
  }
  if (row.noFilingCandidates) {
    cautions.push("源表说明投档分数为0.000000000表示无投档考生；本记录不提供可达最低分。");
  }
  return cautions;
}

function buildRecord(row) {
  const subjectSlug = row.subjectType === "物理类" ? "physics" : "history";
  const idBase = [YEAR, PROVINCE, row.schoolCode, row.schoolName, row.batch, row.subjectType, row.filingScoreText].join("|");
  return {
    id: `${YEAR}-jl-filing-${subjectSlug}-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: row.subjectType,
    sourceSubjectRaw: row.sourceSubjectRaw,
    subjectMappingNote: row.subjectMappingNote,
    batch: row.batch,
    schoolCode: row.schoolCode,
    schoolName: row.schoolName,
    dataType: dataTypeForBatch(row.batch),
    majorName: "院校第一次投档",
    minScore: row.noFilingCandidates ? null : row.totalScore,
    minScoreSourceText: row.filingScoreText,
    scoreOnly: true,
    rankUnavailable: true,
    filingRound: "第一次投档",
    filingStatus: row.noFilingCandidates ? "no-filing-candidates" : "filed",
    formalScoreScope: formalScoreScopeForBatch(row.batch),
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    cautions: cautionsFor(row),
    rawText: row.rawText,
  };
}

function buildDiagnostics(records) {
  const nonZero = records.filter((record) => record.filingStatus !== "no-filing-candidates");
  const ordinaryNonZero = nonZero.filter((record) => record.formalScoreScope !== "special-path-only");
  return {
    totalRows: records.length,
    usableScoreRows: nonZero.length,
    noFilingCandidateRows: records.length - nonZero.length,
    ordinaryUsableScoreRows: ordinaryNonZero.length,
    specialPathRows: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    bySubject: countBy(records, (record) => record.subjectType),
    byRawSubject: countBy(records, (record) => record.sourceSubjectRaw),
    byBatch: countBy(records, (record) => record.batch),
    byDataType: countBy(records, (record) => record.dataType),
    scoreRange: numericRange(nonZero.map((record) => Number(record.minScore))),
    ordinaryScoreRange: numericRange(ordinaryNonZero.map((record) => Number(record.minScore))),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const rawDir = path.resolve(PROJECT_ROOT, RAW_DIR);
  const { pageFile, pdfFile } = await ensureRawFiles(rawDir, args.useCache);
  const textFile = path.join(rawDir, TEXT_FILE);
  ensureTextFile(pdfFile, textFile, args.useCache, args.pdftotext);

  const pageHtml = fs.readFileSync(pageFile, "utf8");
  const meta = pageMeta(pageHtml);
  const parsed = parseRowsFromText(fs.readFileSync(textFile, "utf8"));
  validateParsed(parsed);
  const records = parsed.rows.map(buildRecord);
  const diagnostics = buildDiagnostics(records);
  const sourceNotes = [
    {
      id: SOURCE_ID,
      title: "吉林省2019年普通类有关批次院校第一次投档分数",
      publisher: "吉林省教育考试院",
      mirroredBy: "中国教育在线 / 阳光高考 CHSI",
      publishedAt: "2019-09-16",
      sourcePageTitle: meta.title,
      sourcePagePublisherText: meta.source,
      url: PAGE_URL,
      attachmentUrls: [PDF_URL],
      quality: SOURCE_QUALITY,
      usage: "抽取中国教育在线页面中标注来源为吉林省教育考试院、附件托管于阳光高考/CHSI 的2019吉林普通类有关批次院校第一次投档分数PDF，生成院校层 score-only 投档边界。",
      parsedRecords: records.length,
      usableScoreRows: diagnostics.usableScoreRows,
      noFilingCandidateRows: diagnostics.noFilingCandidateRows,
      ordinaryUsableScoreRows: diagnostics.ordinaryUsableScoreRows,
      rawPath: path.relative(PROJECT_ROOT, pageFile),
      pdfPath: path.relative(PROJECT_ROOT, pdfFile),
      textPath: path.relative(PROJECT_ROOT, textFile),
      pageSha256: sha256File(pageFile),
      pdfSha256: sha256File(pdfFile),
      textSha256: sha256File(textFile),
      batches: diagnostics.byBatch,
      subjects: diagnostics.bySubject,
      cautions: [
        "该表为2019旧文理口径，站内映射到物理类/历史类仅用于跨年候选检索和风险提示。",
        "原表只给投档最低分排序分，不给最低位次；不能据此生成位次或录取概率。",
        "国家专项计划批和地方专项计划批按 special-path-only 隔离。",
        "投档分数为0.000000000的行表示无投档考生，不作为可达最低分。",
      ],
    },
  ];

  const payload = {
    dataset: "official-jilin-filing-2019-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "official-chsi-old-subject-first-filing-score-only",
    },
    notes: [
      "本文件由 scripts/import-official-jilin-filing-2019.mjs 自动生成。",
      "来源页标注来源为吉林省教育考试院，附件托管于阳光高考/CHSI。",
      "仅导入普通类有关批次院校第一次投档分数；不包含征集批次。",
      "旧文理口径映射为站内物理类/历史类时必须保留原始科类字段。",
      "国家专项计划批和地方专项计划批按特殊路径边界隔离。",
      "score-only 投档边界不含最低位次，不生成假位次或录取概率。",
    ],
    sourceNotes,
    diagnostics,
    records,
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    usableScoreRows: diagnostics.usableScoreRows,
    ordinaryUsableScoreRows: diagnostics.ordinaryUsableScoreRows,
    noFilingCandidateRows: diagnostics.noFilingCandidateRows,
    sourceId: SOURCE_ID,
    byBatch: diagnostics.byBatch,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
