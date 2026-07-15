#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-hubei-undergraduate-2025");
const DEFAULT_OUT = "data/admissions/official-hubei-undergraduate-filing-2025-import.json";
const YEAR = 2025;
const PROVINCE = "湖北";
const BATCH = "本科普通批平行志愿";
const LIST_URL = "https://www.hbksw.com/gkbm/tools-data-list.html?t=pt";
const FILE_LIST_URL = "https://www.hbksw.com/gkbm/static/pdf/pt/file_names.json?v1";
const BASE_PDF_URL = "https://www.hbksw.com/gkbm/static/pdf/pt";
const SOURCES = [
  {
    subjectType: "历史类",
    firstChoiceSubject: "历史",
    name: "history.pdf",
    originalName: "湖北省2025年本科普通批录取院校（首选历史）平行志愿投档分数线.pdf",
    md5Name: "e66ce126800708d9927e7363f8ced8e0.pdf",
    expectedRecords: 1380,
    expectedNoScoreRows: 4,
  },
  {
    subjectType: "物理类",
    firstChoiceSubject: "物理",
    name: "physics.pdf",
    originalName: "湖北省2025年本科普通批录取院校（首选物理）平行志愿投档分数线.pdf",
    md5Name: "acb833110a3df395529c246779fa82c7.pdf",
    expectedRecords: 3160,
    expectedNoScoreRows: 16,
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-hubei-undergraduate-filing-2025.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-hubei-undergraduate-filing-2025.mjs --use-cache",
    "",
    "Imports Hubei 2025 undergraduate ordinary-batch official major-group filing PDFs.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hash(value, length = 18) {
  return sha256(String(value)).slice(0, length);
}

function ensureCache(useCache) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const listPath = path.join(TMP_ROOT, "file_names.json");
  if (!useCache || !fs.existsSync(listPath) || fs.statSync(listPath).size === 0) {
    run("curl", [
      "-L",
      "--fail",
      "--max-time",
      "120",
      "--user-agent",
      "Mozilla/5.0 gaokao-hubei-undergraduate-importer/1.0",
      "-o",
      listPath,
      FILE_LIST_URL,
    ]);
  }

  const fileList = JSON.parse(fs.readFileSync(listPath, "utf8"));
  const byName = new Map(fileList.map((item) => [item.md5Name, item.originalName]));
  const pdfs = [];
  for (const item of SOURCES) {
    if (byName.get(item.md5Name) !== item.originalName) {
      throw new Error(`Hubei file list mismatch for ${item.md5Name}: ${byName.get(item.md5Name) || "missing"}`);
    }
    const pdfPath = path.join(TMP_ROOT, item.name);
    const url = `${BASE_PDF_URL}/${item.md5Name}`;
    if (!useCache || !fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
      run("curl", [
        "-L",
        "--fail",
        "--max-time",
        "120",
        "--user-agent",
        "Mozilla/5.0 gaokao-hubei-undergraduate-importer/1.0",
        "-o",
        pdfPath,
        url,
      ]);
    }
    const stat = fs.statSync(pdfPath);
    if (stat.size < 250 * 1024) {
      throw new Error(`Downloaded Hubei undergraduate PDF is too small: ${pdfPath} (${stat.size} bytes)`);
    }
    pdfs.push({ ...item, file: pdfPath, url, bytes: stat.size, sha256: sha256File(pdfPath) });
  }
  return { listPath, fileListBytes: fs.statSync(listPath).size, fileListSha256: sha256File(listPath), pdfs };
}

function disciplineCodes(textValue) {
  const text = String(textValue || "");
  const out = new Set();
  if (/财经|金融|会计|审计|经济|商务|管理|贸易|统计/.test(text)) out.add("12");
  if (/理工|工程|电力|机电|电子|信息|科技|交通|航空|航天|智能|软件|计算机|数据|自动化|机械|材料|化学|建筑|土木|水利/.test(text)) out.add("08");
  if (/医学|医科|中医|药|护理|卫生|口腔|临床|康复|检验/.test(text)) out.add("10");
  if (/师范|教育|学前/.test(text)) out.add("04");
  if (/外语|语言|新闻|传媒|艺术|音乐|戏剧|电影|体育|旅游|传播/.test(text)) out.add("05");
  if (/政法|公安|警察|军|国防/.test(text)) out.add("03");
  if (/农业|农林|林业|园林|水产/.test(text)) out.add("09");
  return [...out];
}

function schoolTagsFor(row, source) {
  const tags = ["湖北本科普通批", source.subjectType, "院校专业组投档线"];
  const text = `${row.groupName}${row.remark}`;
  if (/武汉|湖北|黄冈|黄石|襄阳|宜昌|荆州|荆门|十堰|孝感|咸宁|恩施|鄂州|随州|仙桃|潜江|天门/.test(row.schoolName)) tags.push("湖北本地");
  if (/国家专项/.test(row.remark)) tags.push("国家专项计划");
  if (/民族班|少数民族预科/.test(row.remark)) tags.push("民族班/预科");
  if (/中外合作|合作办学|国际|学分互认/.test(text)) tags.push("合作办学/国际项目");
  if (/师范|教育/.test(text)) tags.push("师范教育");
  if (/医学|医科|药|护理|卫生|口腔|临床|康复|检验/.test(text)) tags.push("医卫");
  if (/计算机|软件|数据|人工智能|智能|电子|通信|信息|电气|自动化|工程|技术|水利|机械/.test(text)) tags.push("信息技术/工程");
  if (/财经|金融|会计|审计|经济|商务|管理|贸易/.test(text)) tags.push("财经商科");
  if (row.minScore >= 620) tags.push("本科高分边界");
  if (row.minScore <= 430) tags.push("本科低分边界");
  return [...new Set(tags)];
}

function normalizeSchoolName(groupName) {
  return groupName.replace(/第\d+组.*$/u, "");
}

function makeRecord(source, row) {
  const groupNumber = row.groupCode.slice(-2);
  const idBase = [
    YEAR,
    PROVINCE,
    source.subjectType,
    BATCH,
    row.groupCode,
    row.groupName,
    row.minScore,
    row.electiveRequirement,
    row.remark,
  ].join("|");
  const record = {
    id: `${YEAR}-hb-undergraduate-filing-${hash(idBase, 18)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: source.subjectType,
    batch: BATCH,
    schoolName: row.schoolName,
    schoolCode: row.groupCode,
    schoolTags: [],
    dataType: "major-group-admission",
    majorName: "院校专业组投档线",
    majorCode: groupNumber,
    majorGroup: row.groupName,
    electiveRequirement: row.electiveRequirement,
    disciplineCodes: disciplineCodes(`${row.groupName}${row.remark}`),
    minScore: row.minScore,
    tieBreakScores: {
      chineseMathTotal: row.chineseMathTotal,
      higherChineseOrMath: row.higherChineseOrMath,
      foreignLanguage: row.foreignLanguage,
      firstChoiceSubject: row.firstChoiceSubjectScore,
      electiveHighest: row.electiveHighest,
      electiveSecond: row.electiveSecond,
      volunteerNo: row.volunteerNo,
    },
    sourceId: `official-hubei-undergraduate-filing-2025-${source.subjectType === "历史类" ? "history" : "physics"}`,
    sourceQuality: "official-hubei-2025-undergraduate-major-group-filing-pdf-score-only",
    cautions: [
      "本记录来自湖北招生考试网公开 PDF，表头为湖北省2025年本科普通批平行志愿投档分数线。",
      "原表只给院校专业组投档最低分和同分排序项，不给最低位次；本记录按 score-only 本科普通批进档边界使用，不生成假位次。",
      "院校专业组投档线只能判断进档边界，不等同于最终专业录取结果；正式填报前仍需核对当年招生计划、专业组内专业和招生章程。",
    ],
    pdfMeta: {
      fileName: source.name,
      rawCode: row.groupCode,
      rawGroupName: row.groupName,
      rawLine: row.rawLine,
    },
  };
  record.schoolTags = schoolTagsFor(row, source);
  return record;
}

function parsePdf(source) {
  const text = run("pdftotext", ["-raw", source.file, "-"]);
  const rowPattern = /^([A-Z]\d{5})\s+(.+?第\d+组)\s+(\S+)\s+(\d{3})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/u;
  const noScorePattern = /^([A-Z]\d{5})\s+(.+?第\d+组)\s+(\S+)(?:\s+(.*))?$/u;
  const records = [];
  const noScoreRows = [];
  const unmatchedCodeRows = [];

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const rowMatch = line.match(rowPattern);
    if (rowMatch) {
      const row = {
        rawLine: line,
        lineNumber: index + 1,
        groupCode: rowMatch[1],
        groupName: rowMatch[2],
        schoolName: normalizeSchoolName(rowMatch[2]),
        electiveRequirement: rowMatch[3],
        minScore: Number(rowMatch[4]),
        chineseMathTotal: Number(rowMatch[5]),
        higherChineseOrMath: Number(rowMatch[6]),
        foreignLanguage: Number(rowMatch[7]),
        firstChoiceSubjectScore: Number(rowMatch[8]),
        electiveHighest: Number(rowMatch[9]),
        electiveSecond: Number(rowMatch[10]),
        volunteerNo: Number(rowMatch[11]),
        remark: rowMatch[12] || "",
      };
      if (row.minScore < 300 || row.minScore > 750) throw new Error(`Invalid Hubei minScore ${row.minScore}: ${line}`);
      records.push(makeRecord(source, row));
      continue;
    }
    if (/^[A-Z]\d{5}/.test(line)) {
      const noScoreMatch = line.match(noScorePattern);
      if (noScoreMatch) noScoreRows.push({ lineNumber: index + 1, rawLine: line });
      else unmatchedCodeRows.push({ lineNumber: index + 1, rawLine: line });
    }
  }

  if (records.length !== source.expectedRecords) {
    throw new Error(`${source.subjectType} expected ${source.expectedRecords} records, parsed ${records.length}`);
  }
  if (noScoreRows.length !== source.expectedNoScoreRows) {
    throw new Error(`${source.subjectType} expected ${source.expectedNoScoreRows} no-score rows, parsed ${noScoreRows.length}`);
  }
  if (unmatchedCodeRows.length) {
    throw new Error(`${source.subjectType} has unmatched code rows: ${JSON.stringify(unmatchedCodeRows.slice(0, 5))}`);
  }
  return { records, noScoreRows };
}

function summarize(records) {
  const scores = records.map((record) => record.minScore);
  return {
    records: records.length,
    scoreRange: { min: Math.min(...scores), max: Math.max(...scores) },
    below430: records.filter((record) => record.minScore < 430).length,
    below450: records.filter((record) => record.minScore < 450).length,
    below500: records.filter((record) => record.minScore < 500).length,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const cache = ensureCache(args.useCache);
  const allRecords = [];
  const parsedFiles = [];
  const noScoreRows = {};
  for (const source of cache.pdfs) {
    const parsed = parsePdf(source);
    allRecords.push(...parsed.records);
    noScoreRows[source.subjectType] = parsed.noScoreRows;
    parsedFiles.push({
      fileName: source.name,
      originalName: source.originalName,
      subjectType: source.subjectType,
      records: parsed.records.length,
      noScoreRows: parsed.noScoreRows.length,
      ...summarize(parsed.records),
      bytes: source.bytes,
      sha256: source.sha256,
      url: source.url,
    });
  }

  const seen = new Set();
  for (const record of allRecords) {
    const key = [record.province, record.year, record.subjectType, record.batch, record.schoolCode, record.majorGroup].join("|");
    if (seen.has(key)) throw new Error(`Duplicate Hubei undergraduate filing record: ${key}`);
    seen.add(key);
  }

  const out = {
    dataset: "official-hubei-undergraduate-filing-2025",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      batch: BATCH,
      subjects: SOURCES.map((item) => item.subjectType),
      source: "湖北招生考试网高考工具箱 PDF",
    },
    records: allRecords,
    sourceNotes: [
      {
        id: "official-hubei-undergraduate-filing-2025",
        title: "湖北省2025年本科普通批录取院校平行志愿投档分数线",
        publisher: "湖北省教育厅招生办公室 / 湖北招生考试网",
        url: LIST_URL,
        fileListUrl: FILE_LIST_URL,
        attachmentUrls: cache.pdfs.map((item) => item.url),
        quality: "official-hubei-2025-undergraduate-major-group-filing-pdf-score-only",
        usage: "自动抽取湖北省2025本科普通批历史/物理院校专业组投档分数线4540条；原表无最低位次，按 score-only 本科普通批进档边界使用。",
        parsedRecords: allRecords.length,
        parsedFiles,
        fileList: {
          bytes: cache.fileListBytes,
          sha256: cache.fileListSha256,
        },
      },
    ],
    importAudit: {
      parser: "pdftotext-raw-fixed-row-regex",
      expectedRecords: Object.fromEntries(SOURCES.map((item) => [item.subjectType, item.expectedRecords])),
      parsedRecords: Object.fromEntries(parsedFiles.map((item) => [item.subjectType, item.records])),
      expectedNoScoreRows: Object.fromEntries(SOURCES.map((item) => [item.subjectType, item.expectedNoScoreRows])),
      noScoreRows,
      scoreRange: summarize(allRecords).scoreRange,
      lowBands: summarize(allRecords),
    },
    notes: [
      "湖北本科普通批 PDF 有文本层，导入器直接使用 pdftotext -raw 的机器文本行。",
      "无投档分专业组只进入 importAudit.noScoreRows，不生成 minScore。",
      "原表无最低位次，因此所有记录均为 score-only 院校专业组进档边界。",
    ],
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    out: args.out,
    records: allRecords.length,
    bySubject: Object.fromEntries(parsedFiles.map((item) => [item.subjectType, item.records])),
    noScoreRows: Object.fromEntries(parsedFiles.map((item) => [item.subjectType, item.noScoreRows])),
    scoreRange: summarize(allRecords).scoreRange,
  }, null, 2));
}

main();
