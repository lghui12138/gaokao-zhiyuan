#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2021;
const PROVINCE = "吉林";
const SOURCE_ID = "official-jilin-rank-2021";
const DEFAULT_OUT = "data/admissions/official-jilin-rank-conversion-2021-import.json";
const RAW_DIR = "data/admissions/raw/official-jilin-rank-2021";
const SOURCE_QUALITY = "official-chsi-jilin-rank-conversion-xls";
const PAGE_URL = "https://gaokao.chsi.com.cn/gkxx/zc/ss/202106/20210623/2079814877.html";

const SUBJECTS = [
  {
    subjectType: "物理类",
    sourceSubjectRaw: "理工类",
    sourceSubject: "理工1分段表",
    localName: "science.xls",
    url: "https://t3.chei.com.cn/news/getfile/2079814878-2079814877-b01f4447586dc8508564feea216fb901.xls",
    mappingNote: "2021年吉林仍为旧文理口径，站内将理工类映射到物理类以便与新高考普通类位次层衔接。",
  },
  {
    subjectType: "历史类",
    sourceSubjectRaw: "文史类",
    sourceSubject: "文史1分段表",
    localName: "arts.xls",
    url: "https://t3.chei.com.cn/news/getfile/2079814879-2079814877-5e9e85fb3e819d42b0d4142683c9f8bf.xls",
    mappingNote: "2021年吉林仍为旧文理口径，站内将文史类映射到历史类以便与新高考普通类位次层衔接。",
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-jilin-rank-conversion-2021.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-jilin-rank-conversion-2021.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH        output JSON path",
    "  --use-cache      reuse downloaded CHSI page/XLS/CSV files",
    "  --soffice PATH   LibreOffice soffice executable, default: soffice",
    "",
    "Imports Jilin 2021 old science/arts score-segment XLS files as ordinary rank-conversion records.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false, soffice: process.env.SOFFICE_BIN || "soffice" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--soffice") args.soffice = argv[++i];
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

async function download(url, accept = "*/*") {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-jilin-rank-2021-importer/1.0",
      accept,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureRawFiles(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const pageFile = path.join(rawDir, "chsi-jilin-rank-2021.html");
  if (!useCache || !fs.existsSync(pageFile)) {
    fs.writeFileSync(pageFile, await download(PAGE_URL, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
  }
  if (fs.statSync(pageFile).size < 20 * 1024) throw new Error(`CHSI page is too small: ${pageFile}`);

  const xlsFiles = [];
  for (const subject of SUBJECTS) {
    const file = path.join(rawDir, subject.localName);
    if (!useCache || !fs.existsSync(file)) {
      fs.writeFileSync(file, await download(subject.url));
    }
    if (fs.statSync(file).size < 8 * 1024) throw new Error(`XLS is too small: ${file}`);
    xlsFiles.push(file);
  }
  return { pageFile, xlsFiles };
}

function convertXlsFilesToCsv(files, csvDir, args) {
  fs.rmSync(csvDir, { recursive: true, force: true });
  fs.mkdirSync(csvDir, { recursive: true });
  const profileDir = path.join(csvDir, `lo-profile-${process.pid}`);
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const output = run(args.soffice, [
    "--headless",
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    "--convert-to",
    "csv",
    "--outdir",
    csvDir,
    ...files,
  ]);
  fs.rmSync(profileDir, { recursive: true, force: true });
  const csvFiles = files.map((file) => path.join(csvDir, `${path.basename(file, path.extname(file))}.csv`));
  const missing = csvFiles.filter((file) => !fs.existsSync(file));
  if (missing.length) throw new Error(`LibreOffice did not create CSV files: ${missing.join(", ")}\n${output}`);
  return csvFiles;
}

function csvFields(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (quoted && line[i + 1] === "\"") {
        field += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field.trim());
  return fields;
}

function parseRowsFromCsv(csvText, subject) {
  const allRows = [];
  for (const line of String(csvText).split(/\r?\n/)) {
    const fields = csvFields(line);
    const baseScore = Number(fields[0]);
    if (!Number.isFinite(baseScore) || baseScore < 0 || baseScore > 750) continue;
    const values = fields.slice(1).map((item) => Number(item)).filter((item) => Number.isFinite(item) && item >= 0);
    if (values.length < 3 || values.length > 10) continue;
    const startOffset = values.length - 1;
    for (let i = 0; i < values.length; i += 1) {
      allRows.push({
        score: baseScore + startOffset - i,
        cumulative: values[i],
        subjectType: subject.subjectType,
        sourceSubjectRaw: subject.sourceSubjectRaw,
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

function validateRows(allRows, subject) {
  const errors = [];
  const zeroCandidateScores = [];
  const keptRows = [];
  for (let i = 0; i < allRows.length; i += 1) {
    const row = allRows[i];
    const previous = allRows[i - 1];
    if (i > 0 && previous.score - row.score !== 1) {
      errors.push({ type: "score-gap-in-xls-matrix", subjectType: subject.subjectType, previous, row });
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
  if (allRows.length < 500) errors.push({ type: "too-few-xls-score-cells", subjectType: subject.subjectType, rows: allRows.length });
  if (keptRows.length < 300) errors.push({ type: "too-few-positive-records", subjectType: subject.subjectType, rows: keptRows.length });
  if (errors.length) throw new Error(`Invalid Jilin 2021 rank rows for ${subject.subjectType}: ${JSON.stringify(errors.slice(0, 5))}`);
  return { rows: keptRows, zeroCandidateScores };
}

function parseCsv(file, subject) {
  const csvText = fs.readFileSync(file, "utf8");
  const titleLine = String(csvText).split(/\r?\n/).map((line) => line.trim()).find((line) => /1分段表/.test(line)) || "";
  const title = csvFields(titleLine)[0] || "";
  const match = /2021年吉林省普通高校招生考试(理工|文史)1分段表/.exec(title);
  if (!match) throw new Error(`Could not parse Jilin 2021 rank title in ${file}: ${title}`);
  const rawSubject = match[1] === "理工" ? "理工类" : "文史类";
  if (rawSubject !== subject.sourceSubjectRaw) {
    throw new Error(`Unexpected source subject for ${file}: ${rawSubject}, expected ${subject.sourceSubjectRaw}`);
  }
  const allRows = parseRowsFromCsv(csvText, subject);
  const parsed = validateRows(allRows, subject);
  return {
    file,
    title,
    subjectType: subject.subjectType,
    sourceSubjectRaw: subject.sourceSubjectRaw,
    rows: parsed.rows,
    zeroCandidateScores: parsed.zeroCandidateScores,
    allRowCount: allRows.length,
    csvSha256: sha256File(file),
  };
}

function buildRecord(row) {
  const subjectSlug = row.subjectType === "物理类" ? "physics" : "history";
  const idBase = [YEAR, PROVINCE, row.subjectType, row.score, row.rankStart, row.rankEnd].join("|");
  return {
    id: `${YEAR}-jl-rank-${subjectSlug}-${hash(idBase, 16)}`,
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
      "一分一段只能用于吉林2021年同科类分数到位次估算。",
      "官方表为理工/文史1分段表且含照顾分；站内映射到物理类/历史类时必须保留旧文理口径差异。",
      "XLS 中同分人数为相邻累计人数差值；零人数分数点不生成 rank range。",
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

  const rawDir = path.resolve(PROJECT_ROOT, RAW_DIR);
  const { pageFile, xlsFiles } = await ensureRawFiles(rawDir, args.useCache);
  const csvDir = path.join(rawDir, "csv");
  const csvFiles = args.useCache && fs.existsSync(csvDir)
    ? xlsFiles.map((file) => path.join(csvDir, `${path.basename(file, path.extname(file))}.csv`))
    : convertXlsFilesToCsv(xlsFiles, csvDir, args);
  const missingCsvFiles = csvFiles.filter((file) => !fs.existsSync(file));
  if (missingCsvFiles.length) throw new Error(`Missing cached CSV files: ${missingCsvFiles.join(", ")}`);

  const parsedSubjects = SUBJECTS.map((subject, index) => parseCsv(csvFiles[index], subject));
  const records = parsedSubjects.flatMap((parsed) => parsed.rows.map(buildRecord));
  const sourceNotes = [
    {
      id: SOURCE_ID,
      title: "吉林省2021年高考成绩一分段表（理工/文史，含照顾分）",
      publisher: "吉林省教育考试院",
      mirroredBy: "阳光高考 / CHSI",
      publishedAt: "2021-06-23",
      url: PAGE_URL,
      attachmentUrls: SUBJECTS.map((subject) => subject.url),
      quality: SOURCE_QUALITY,
      usage: "抽取阳光高考页面中来源为吉林省教育考试院的吉林2021理工/文史1分段XLS表，生成同年同原始科类分数到位次换算记录。",
      parsedRecords: records.length,
      rawPath: path.relative(PROJECT_ROOT, pageFile),
      pageSha256: sha256File(pageFile),
      subjects: parsedSubjects.map((item, index) => ({
        subjectType: item.subjectType,
        sourceSubjectRaw: item.sourceSubjectRaw,
        sourceSubject: SUBJECTS[index].sourceSubject,
        mappingNote: SUBJECTS[index].mappingNote,
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
        title: item.title,
        xlsPath: path.relative(PROJECT_ROOT, xlsFiles[index]),
        csvPath: path.relative(PROJECT_ROOT, item.file),
        xlsSha256: sha256File(xlsFiles[index]),
        csvSha256: item.csvSha256,
      })).sort((a, b) => String(a.subjectType).localeCompare(String(b.subjectType), "zh-Hans-CN")),
    },
  ];

  const payload = {
    dataset: "official-jilin-rank-conversion-2021-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "official-chsi-old-subject-rank-conversion",
    },
    notes: [
      "本文件由 scripts/import-official-jilin-rank-conversion-2021.mjs 自动生成。",
      "来源为阳光高考页面，页面标注来源：吉林省教育考试院。",
      "仅导入理工类/文史类普通1分段表；同页艺术类、体育类表未混入普通类。",
      "2021旧文理口径映射为站内物理类/历史类时必须保留原始科类字段。",
      "位次换算不是投档线或录取最低分，不能据此单独生成录取概率。",
    ],
    sourceNotes,
    diagnostics: {
      parsedSheetCount: parsedSubjects.length,
      totalRecords: records.length,
      bySubject: Object.fromEntries(parsedSubjects.map((subject) => [subject.subjectType, subject.rows.length])),
      byRawSubject: Object.fromEntries(parsedSubjects.map((subject) => [subject.sourceSubjectRaw, subject.rows.length])),
      zeroCandidateScores: Object.fromEntries(parsedSubjects.map((subject) => [subject.subjectType, subject.zeroCandidateScores.length])),
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
