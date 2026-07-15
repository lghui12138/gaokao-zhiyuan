#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-beijing-vocational-filing-2025-import.json";
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-beijing-vocational-2025");
const PDFTOTEXT = process.env.PDFTOTEXT || "pdftotext";
const PDFINFO = process.env.PDFINFO || "pdfinfo";
const YEAR = 2025;
const PROVINCE = "北京";
const SUBJECT_TYPE = "综合";
const BATCH = "专科批";
const SOURCE_ID = "official-beijing-vocational-filing-2025";
const PAGE_URL = "https://www.bjeea.cn/html/gkgz/tzgg/2025/0730/87264.html";
const PDF_URL = "https://www.bjeea.cn/uploads/soft/250730/178-250I01I930.pdf";
const EXPECTED = {
  pages: 22,
  records: 583,
  schools: 84,
  fullTieBreakRows: 369,
  scoreOnlyRows: 214,
  wrappedRows: 126,
  splitHeaderRows: 9,
  minScore: 120,
  maxScore: 292,
  below200: 314,
  below250: 508,
  below300: 583,
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-beijing-vocational-filing-2025.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-beijing-vocational-filing-2025.mjs --pdf /path/to/file.pdf",
    "  node scripts/import-official-beijing-vocational-filing-2025.mjs --use-cache",
    "",
    "Imports the official Beijing 2025 vocational ordinary-batch filing-score PDF as score-only vocational records.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--pdf") args.pdf = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: options.timeout ?? 180_000,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stderr?.trim(),
      result.stdout?.slice(0, 1000)?.trim(),
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

function hash(value, length = 16) {
  return sha256(String(value)).slice(0, length);
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function cleanName(value) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function integerFrom(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

function ensurePdf(args) {
  if (args.pdf) return path.resolve(args.pdf);
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const pdfPath = path.join(TMP_ROOT, "beijing-vocational-2025.pdf");
  if (!args.useCache || !fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
    run("curl", [
      "-L",
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "120",
      "--user-agent",
      "Mozilla/5.0 gaokao-beijing-vocational-importer/1.0",
      "-o",
      pdfPath,
      PDF_URL,
    ]);
  }
  const stat = fs.statSync(pdfPath);
  if (stat.size < 400 * 1024) {
    throw new Error(`Downloaded Beijing vocational PDF is too small: ${pdfPath} (${stat.size} bytes)`);
  }
  return pdfPath;
}

function pdfInfo(pdfPath) {
  const output = run(PDFINFO, [pdfPath]);
  const pages = Number(/Pages:\s+(\d+)/.exec(output)?.[1] || 0);
  const fileSize = Number(/File size:\s+(\d+)/.exec(output)?.[1] || fs.statSync(pdfPath).size);
  return { pages, fileSize, raw: output };
}

function textForPdf(pdfPath) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const textPath = path.join(TMP_ROOT, "beijing-vocational-2025.raw.txt");
  run(PDFTOTEXT, ["-raw", pdfPath, textPath]);
  const text = fs.readFileSync(textPath, "utf8");
  if (!/序号\s+院校\s+专业\s+总分\s+语文\s+数学\s+外语/.test(text)) {
    throw new Error("Converted text does not look like the Beijing 2025 vocational filing table.");
  }
  if (!/北京城市学院/.test(text) || !/西藏职业技术学院/.test(text)) {
    throw new Error("Converted text is missing expected Beijing vocational first/last table rows.");
  }
  return { textPath, text };
}

function cleanLine(raw) {
  return String(raw ?? "").replace(/\f/g, " ").replace(/\s+/g, " ").trim();
}

function isHardSkip(line) {
  return !line ||
    /序号\s+院校\s+专业\s+总分/.test(line) ||
    /^第\s*\d+\s*页/.test(line);
}

function isVisualFooterLine(line) {
  return /^[北京教育考试院\s]+$/.test(line);
}

function fullHead(line) {
  return /^(\d+)\s+(\d{4})\s+(.+?)\s+([0-9A-Z]{2})(?:\s+(.*))?$/u.exec(line);
}

function splitHead(line) {
  return /^(\d+)\s+(\d{4})$/u.exec(line);
}

function majorLine(line) {
  return /^([0-9A-Z]{2})(?:\s+(.*))?$/u.exec(line);
}

function isRowStart(line) {
  return Boolean(fullHead(line) || splitHead(line));
}

function parseMajor(parts) {
  const combined = parts
    .filter((part) => part && !isHardSkip(part) && !isVisualFooterLine(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const match = /^(.+?)\s+(\d{3})(?:\s+(\d{1,3})\s+(\d{1,3})\s+(\d{1,3}))?$/u.exec(combined);
  return { match, combined };
}

function disciplineCodes(textValue) {
  const text = cleanName(textValue);
  const out = new Set();
  if (/财经|金融|会计|审计|经济|商务|管理|贸易|统计|证券|电商|市场营销|物流/.test(text)) out.add("12");
  if (/工程|电力|机电|电子|信息|科技|交通|航空|智能|软件|计算机|数据|自动化|机械|制造|汽车|建筑|土木|测绘|安全|机器人|网络|通信|无人机|轨道|互联网/.test(text)) out.add("08");
  if (/医学|医科|中医|药|护理|卫生|口腔|临床|康复|健康|检验|影像/.test(text)) out.add("10");
  if (/师范|教育|学前|早期教育/.test(text)) out.add("04");
  if (/外语|英语|语言|新闻|传媒|编导|影视|艺术|设计|音乐|戏剧|电影|旅游|会展/.test(text)) out.add("05");
  if (/政法|法律|公安|警察|党务|社会工作|司法/.test(text)) out.add("03");
  if (/农业|农林|园林|园艺|动物|水利|水电/.test(text)) out.add("09");
  return [...out];
}

function schoolTagsFor(recordLike) {
  const text = cleanName(`${recordLike.schoolName}${recordLike.majorName}`);
  const tags = ["高职/专科", "北京专科普通批", SUBJECT_TYPE];
  if (/北京/.test(recordLike.schoolName)) tags.push("北京本地");
  if (/职|高专|职业|专科|技师|职院/.test(text)) tags.push("职业院校");
  if (/医学|医科|药|护理|健康|中医|口腔|康复|卫生|检验|影像/.test(text)) tags.push("医卫专科");
  if (/计算机|软件|数据|人工智能|智能|电子|通信|信息|电气|自动化|工程|技术|机电|机械|制造|汽车|航空|轨道|交通|无人机|互联网/.test(text)) tags.push("信息技术/工程");
  if (/财经|金融|会计|审计|经济|商务|管理|贸易|证券|市场营销|电商|物流/.test(text)) tags.push("财经商科");
  if (/师范|教育|学前|早期教育/.test(text)) tags.push("师范教育");
  if (/法律|政法|公安|警察|党务|社会工作|司法/.test(text)) tags.push("政法社会服务");
  if (/艺术|设计|传媒|影视|编导|新闻|文化|旅游|会展|英语/.test(text)) tags.push("文旅传媒");
  if (recordLike.hasTieBreak === false) tags.push("同分项未公开");
  if (Number(recordLike.minScore) < 200) tags.push("低分段");
  return [...new Set(tags)];
}

function cityFor(schoolName) {
  return /北京/.test(schoolName) ? "北京" : "";
}

function parseRows(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, text: cleanLine(raw) }))
    .filter((item) => !isHardSkip(item.text));

  const rows = [];
  const misses = [];
  const splitHeaderRows = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isVisualFooterLine(lines[i].text) && !splitHead(lines[i].text)) continue;

    let head = fullHead(lines[i].text);
    let row = null;
    let parts = [];
    let j = i + 1;
    let wrapped = false;

    if (head) {
      row = {
        sequence: Number(head[1]),
        schoolCode: head[2],
        schoolName: cleanName(head[3]),
        majorCode: head[4],
        line: lines[i].line,
      };
      if (head[5]) parts.push(head[5]);
      while (j < lines.length && !isRowStart(lines[j].text)) {
        parts.push(lines[j].text);
        j += 1;
      }
      wrapped = parts.length > 1;
    } else if ((head = splitHead(lines[i].text))) {
      const schoolParts = [];
      j = i + 1;
      while (j < lines.length && !majorLine(lines[j].text) && !isRowStart(lines[j].text)) {
        if (!isHardSkip(lines[j].text)) schoolParts.push(lines[j].text);
        j += 1;
      }
      const majorHead = majorLine(lines[j]?.text || "");
      if (!majorHead) {
        misses.push({ line: lines[i].line, text: lines[i].text, reason: "split-row-without-major-code", schoolParts });
        continue;
      }
      row = {
        sequence: Number(head[1]),
        schoolCode: head[2],
        schoolName: cleanName(schoolParts.join("")),
        majorCode: majorHead[1],
        line: lines[i].line,
      };
      if (majorHead[2]) parts.push(majorHead[2]);
      j += 1;
      while (j < lines.length && !isRowStart(lines[j].text)) {
        parts.push(lines[j].text);
        j += 1;
      }
      splitHeaderRows.push(row.sequence);
      wrapped = true;
    } else {
      continue;
    }

    const { match, combined } = parseMajor(parts);
    if (!match) {
      misses.push({ line: lines[i].line, text: lines[i].text, combined });
      i = j - 1;
      continue;
    }
    rows.push({
      ...row,
      majorName: cleanName(match[1]),
      minScore: Number(match[2]),
      chinese: integerFrom(match[3]),
      math: integerFrom(match[4]),
      foreignLanguage: integerFrom(match[5]),
      wrapped,
    });
    i = j - 1;
  }

  rows.sort((a, b) => a.sequence - b.sequence);
  return { rows, misses, splitHeaderRows };
}

function buildRecord(row) {
  const hasTieBreak = row.chinese !== null && row.math !== null && row.foreignLanguage !== null;
  const idBase = [
    YEAR,
    PROVINCE,
    SUBJECT_TYPE,
    BATCH,
    row.sequence,
    row.schoolCode,
    row.schoolName,
    row.majorCode,
    row.majorName,
    row.minScore,
  ].join("|");
  const base = {
    id: `2025-beijing-voc-filing-${hash(idBase, 18)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: SUBJECT_TYPE,
    batch: BATCH,
    schoolName: row.schoolName,
    schoolCode: row.schoolCode,
    schoolTags: [],
    city: cityFor(row.schoolName),
    dataType: "vocational-admission",
    majorName: row.majorName,
    majorCode: row.majorCode,
    majorGroup: "",
    disciplineCodes: disciplineCodes(`${row.schoolName}${row.majorName}`),
    minScore: row.minScore,
    minRankStart: null,
    minRankEnd: null,
    rankRangeText: "",
    sourceId: SOURCE_ID,
    sourceQuality: "official-beijing-2025-vocational-major-filing-pdf-score-only",
    originalSequence: row.sequence,
    cautions: [
      "本记录来自北京教育考试院公布的2025年北京市高招专科（高职）普通批录取投档线官方 PDF。",
      "原表不含最低位次，本记录不生成假位次；只能作为北京综合改革专科普通批专业投档边界。",
      "投档线不等同于最终专业录取结果或录取概率，正式填报前应结合当年一分一段、招生计划、专业要求和招生章程复核。",
    ],
  };
  if (hasTieBreak) {
    base.tieBreakScores = {
      chinese: row.chinese,
      math: row.math,
      foreignLanguage: row.foreignLanguage,
    };
  } else {
    base.cautions.unshift("原表该行只公开总分，没有语文/数学/外语同分项；模型只按 score-only 边界使用。");
  }
  if (row.wrapped) {
    base.cautions.unshift("原 PDF 文本层存在换行拆分，导入器已按序号、院校代码和专业代码合并。");
  }
  base.schoolTags = schoolTagsFor({ ...base, hasTieBreak });
  return base;
}

function validate(rows, misses, splitHeaderRows, info) {
  const errors = [];
  if (info.pages !== EXPECTED.pages) errors.push({ type: "page-count", expected: EXPECTED.pages, actual: info.pages });
  if (misses.length) errors.push({ type: "unparsed-rows", count: misses.length, sample: misses.slice(0, 10) });
  if (rows.length !== EXPECTED.records) errors.push({ type: "record-count", expected: EXPECTED.records, actual: rows.length });

  for (let i = 1; i <= EXPECTED.records; i += 1) {
    if (rows[i - 1]?.sequence !== i) {
      errors.push({ type: "sequence-gap", expected: i, actual: rows[i - 1]?.sequence ?? null });
      if (errors.length > 20) break;
    }
  }

  const schoolCount = new Set(rows.map((row) => `${row.schoolCode}|${row.schoolName}`)).size;
  if (schoolCount !== EXPECTED.schools) errors.push({ type: "school-count", expected: EXPECTED.schools, actual: schoolCount });

  const scores = rows.map((row) => row.minScore);
  const scoreRange = [Math.min(...scores), Math.max(...scores)];
  if (scoreRange[0] !== EXPECTED.minScore || scoreRange[1] !== EXPECTED.maxScore) {
    errors.push({ type: "score-range", expected: [EXPECTED.minScore, EXPECTED.maxScore], actual: scoreRange });
  }
  for (const row of rows) {
    if (!Number.isInteger(row.minScore) || row.minScore < 100 || row.minScore > 750) {
      errors.push({ type: "invalid-score", sequence: row.sequence, minScore: row.minScore });
    }
    for (const [key, value] of [["chinese", row.chinese], ["math", row.math], ["foreignLanguage", row.foreignLanguage]]) {
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 150)) {
        errors.push({ type: "invalid-tie-break", sequence: row.sequence, key, value });
      }
    }
  }

  const fullTieBreakRows = rows.filter((row) => row.chinese !== null && row.math !== null && row.foreignLanguage !== null).length;
  const scoreOnlyRows = rows.length - fullTieBreakRows;
  if (fullTieBreakRows !== EXPECTED.fullTieBreakRows || scoreOnlyRows !== EXPECTED.scoreOnlyRows) {
    errors.push({
      type: "tie-break-count",
      expected: { fullTieBreakRows: EXPECTED.fullTieBreakRows, scoreOnlyRows: EXPECTED.scoreOnlyRows },
      actual: { fullTieBreakRows, scoreOnlyRows },
    });
  }

  const wrappedRows = rows.filter((row) => row.wrapped).length;
  if (wrappedRows !== EXPECTED.wrappedRows) errors.push({ type: "wrapped-row-count", expected: EXPECTED.wrappedRows, actual: wrappedRows });
  if (splitHeaderRows.length !== EXPECTED.splitHeaderRows) {
    errors.push({ type: "split-header-row-count", expected: EXPECTED.splitHeaderRows, actual: splitHeaderRows.length, splitHeaderRows });
  }

  const lowBands = {
    below200: rows.filter((row) => row.minScore < 200).length,
    below250: rows.filter((row) => row.minScore < 250).length,
    below300: rows.filter((row) => row.minScore < 300).length,
  };
  for (const [key, expected] of Object.entries({ below200: EXPECTED.below200, below250: EXPECTED.below250, below300: EXPECTED.below300 })) {
    if (lowBands[key] !== expected) errors.push({ type: "low-band-count", key, expected, actual: lowBands[key] });
  }

  if (errors.length) {
    throw new Error(`Beijing vocational filing import validation failed:\n${JSON.stringify(errors, null, 2)}`);
  }
}

function summarize(records, rows, splitHeaderRows, pdfPath, textPath, text, info) {
  const scores = records.map((record) => record.minScore);
  const fullTieBreakRows = records.filter((record) => record.tieBreakScores).length;
  const scoreOnlyRows = records.length - fullTieBreakRows;
  return {
    records: records.length,
    schools: new Set(records.map((record) => `${record.schoolCode}|${record.schoolName}`)).size,
    scoreRange: { min: Math.min(...scores), max: Math.max(...scores) },
    fullTieBreakRows,
    scoreOnlyRows,
    wrappedRows: rows.filter((row) => row.wrapped).length,
    splitHeaderRows,
    lowBands: {
      below200: records.filter((record) => record.minScore < 200).length,
      below250: records.filter((record) => record.minScore < 250).length,
      below300: records.filter((record) => record.minScore < 300).length,
      below500: records.filter((record) => record.minScore < 500).length,
    },
    pdf: {
      url: PDF_URL,
      fileName: path.basename(pdfPath),
      bytes: fs.statSync(pdfPath).size,
      sha256: sha256File(pdfPath),
      pages: info.pages,
    },
    text: {
      fileName: path.basename(textPath),
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const pdfPath = ensurePdf(args);
  const info = pdfInfo(pdfPath);
  const { textPath, text } = textForPdf(pdfPath);
  const { rows, misses, splitHeaderRows } = parseRows(text);
  validate(rows, misses, splitHeaderRows, info);
  const records = rows.map(buildRecord);
  const duplicateIds = records.length - new Set(records.map((record) => record.id)).size;
  if (duplicateIds) throw new Error(`Duplicate Beijing vocational record ids: ${duplicateIds}`);
  const summary = summarize(records, rows, splitHeaderRows, pdfPath, textPath, text, info);

  const out = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    dataset: path.basename(out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "北京市2025年高招专科（高职）普通批录取投档线",
    notes: [
      "本文件由 scripts/import-official-beijing-vocational-filing-2025.mjs 自动生成。",
      "来源为北京教育考试院 2025 年北京市高招专科（高职）普通批录取投档线官方 PDF。",
      "原表按院校和专业代码公布投档总分及部分同分项，不含最低位次；本导入不生成假位次。",
      "原 PDF 文本层有页脚表头、专业名换行和少量院校名断行，导入器按序号、院校代码和专业代码合并，并用连续序号硬校验。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: "北京市2025年高招专科（高职）普通批录取投档线",
        publisher: "北京教育考试院",
        url: PAGE_URL,
        attachmentUrl: PDF_URL,
        publishedAt: "2025-07-30",
        quality: "official-beijing-2025-vocational-major-filing-pdf-score-only",
        usage: `自动抽取北京专科（高职）普通批专业投档线${records.length}条，其中${summary.fullTieBreakRows}条含语文/数学/外语同分项，${summary.scoreOnlyRows}条只公开总分；无最低位次，按 score-only 官方专科投档边界使用。`,
        parsedRecords: records.length,
        fullTieBreakRows: summary.fullTieBreakRows,
        scoreOnlyRows: summary.scoreOnlyRows,
        wrappedRows: summary.wrappedRows,
        splitHeaderRows: summary.splitHeaderRows,
        lowBands: summary.lowBands,
        parsedFiles: [
          {
            fileName: path.basename(pdfPath),
            convertedText: path.basename(textPath),
            subjectType: SUBJECT_TYPE,
            records: records.length,
            pages: info.pages,
            sha256: summary.pdf.sha256,
          },
        ],
      },
    ],
    summary,
    records,
  }, null, 2));

  console.log(JSON.stringify({
    ok: true,
    out: rel(out),
    ...summary,
  }, null, 2));
}

main();
