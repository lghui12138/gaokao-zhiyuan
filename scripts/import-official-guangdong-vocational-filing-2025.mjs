#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-guangdong-vocational-2025");
const DEFAULT_OUT = "data/admissions/official-guangdong-vocational-filing-2025-import.json";
const YEAR = 2025;
const PROVINCE = "广东";
const BATCH = "专科批";
const PAGE_URL = "https://eea.gd.gov.cn/ptgk/content/post_4754637.html";
const PDFS = [
  {
    subjectType: "历史类",
    name: "history.pdf",
    url: "https://eea.gd.gov.cn/attachment/0/587/587545/4754637.pdf",
    title: "广东省2025年专科普通类（历史）投档情况",
    expectedRecords: 1068,
    expectedFiledCount: 89625,
  },
  {
    subjectType: "物理类",
    name: "physics.pdf",
    url: "https://eea.gd.gov.cn/attachment/0/587/587546/4754637.pdf",
    title: "广东省2025年专科普通类（物理）投档情况",
    expectedRecords: 1270,
    expectedFiledCount: 115495,
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-guangdong-vocational-filing-2025.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-guangdong-vocational-filing-2025.mjs --use-cache",
    "",
    "Imports Guangdong 2025 vocational ordinary-category official filing PDFs.",
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
  const pagePath = path.join(TMP_ROOT, "official-page.html");
  if (!useCache || !fs.existsSync(pagePath) || fs.statSync(pagePath).size === 0) {
    run("curl", [
      "-L",
      "--fail",
      "--max-time",
      "120",
      "--user-agent",
      "Mozilla/5.0 gaokao-guangdong-vocational-importer/1.0",
      "-o",
      pagePath,
      PAGE_URL,
    ]);
  }

  const pdfs = [];
  for (const item of PDFS) {
    const pdfPath = path.join(TMP_ROOT, item.name);
    if (!useCache || !fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
      run("curl", [
        "-L",
        "--fail",
        "--max-time",
        "120",
        "--user-agent",
        "Mozilla/5.0 gaokao-guangdong-vocational-importer/1.0",
        "-o",
        pdfPath,
        item.url,
      ]);
    }
    const stat = fs.statSync(pdfPath);
    if (stat.size < 300 * 1024) {
      throw new Error(`Downloaded Guangdong vocational PDF is too small: ${pdfPath} (${stat.size} bytes)`);
    }
    pdfs.push({ ...item, file: pdfPath, bytes: stat.size, sha256: sha256File(pdfPath) });
  }
  return { pagePath, pdfs };
}

function numberFrom(value) {
  return Number(String(value).replace(/[^\d]/g, ""));
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

function schoolTagsFor(record) {
  const tags = ["广东官方专科投档线", record.subjectType, "高职专科"];
  const text = `${record.schoolName}${record.majorGroup}`;
  if (/广东|广州|深圳|汕头|佛山|东莞|珠海|中山|惠州|湛江|韶关|肇庆|江门|茂名|汕尾|河源|阳江|清远|潮州|揭阳|云浮|顺德/.test(record.schoolName)) tags.push("广东院校");
  if (/职业技术大学|深圳职业技术大学|顺德职业技术大学|广东轻工职业技术大学|苏州职业技术大学|武汉职业技术大学/.test(record.schoolName)) tags.push("职业本科/高水平高职");
  if (/协同培养|联合培养/.test(text)) tags.push("协同/联合培养");
  if (/中外合作|合作办学|学分互认/.test(text)) tags.push("合作办学/学分互认");
  if (/师范|教育|学前/.test(text)) tags.push("师范教育");
  if (/医学|医科|药|护理|卫生|口腔|临床|康复|检验/.test(text)) tags.push("医卫");
  if (/计算机|软件|数据|人工智能|智能|电子|通信|信息|电气|自动化|工程|技术|水利|机械/.test(text)) tags.push("信息技术/工程");
  if (/财经|金融|会计|审计|经济|商务|管理|贸易/.test(text)) tags.push("财经商科");
  if (record.minScore <= 250) tags.push("专科低分段");
  if (record.minScore >= 480) tags.push("专科高分边界");
  return [...new Set(tags)];
}

function makeRecord(source, row) {
  const majorGroup = `${row.groupCode}专业组`;
  const idBase = [
    YEAR,
    PROVINCE,
    source.subjectType,
    BATCH,
    row.schoolCode,
    row.schoolName,
    majorGroup,
    row.minScore,
    row.minRank,
  ].join("|");
  const record = {
    id: `${YEAR}-gd-vocational-filing-${hash(idBase, 18)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: source.subjectType,
    batch: BATCH,
    schoolName: row.schoolName,
    schoolCode: row.schoolCode,
    schoolTags: [],
    city: "",
    dataType: "vocational-admission",
    majorName: "院校专业组投档线",
    majorCode: row.groupCode,
    majorGroup,
    disciplineCodes: disciplineCodes(`${row.schoolName}${majorGroup}`),
    planCount: row.planCount,
    filedCount: row.filedCount,
    minScore: row.minScore,
    minRankStart: row.minRank,
    minRankEnd: row.minRank,
    rankRangeText: String(row.minRank),
    sourceId: "official-guangdong-vocational-filing-2025",
    sourceQuality: "official-guangdong-2025-vocational-major-group-filing-pdf-score-rank",
    cautions: [
      "省级专科投档线只能判断院校专业组进档边界，不能替代专业录取结果。",
      "高职专科需结合专业组内专业、校区、学费、协同培养、升本通道和就业质量复核。",
      "本记录来自广东省教育考试院公开附件，正式填报前仍需核对当年招生计划和招生章程。",
    ],
  };
  record.schoolTags = schoolTagsFor(record);
  return record;
}

function parseRawText(rawText, source) {
  const records = [];
  const skippedRows = [];
  const fullPattern = /^(\d{5})\s+(.+?)\s+(\d{3})\s+(\d+)\s+(\d+)\s+(\d{3})\s+(\d+)\s*$/u;
  const codeNamePattern = /^(\d{5})\s+(.+)$/u;
  const codeOnlyPattern = /^(\d{5})$/;
  const numericPattern = /^(\d{3})\s+(\d+)\s+(\d+)\s+(\d{3}|-)\s+(\d+|-)\s*$/;
  const markerPattern = /^(广东省|院校代码|第\s*\d+\s*页|广|东|省|教|育|考|试|院)$/;
  let pending = null;

  for (const [index, rawLine] of rawText.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || markerPattern.test(line)) continue;

    let match = fullPattern.exec(line);
    if (match) {
      pending = null;
      const [, schoolCode, schoolName, groupCode, planText, filedText, scoreText, rankText] = match;
      records.push(makeRecord(source, {
        schoolCode,
        schoolName: schoolName.replace(/\s+/g, ""),
        groupCode,
        planCount: numberFrom(planText),
        filedCount: numberFrom(filedText),
        minScore: numberFrom(scoreText),
        minRank: numberFrom(rankText),
      }));
      continue;
    }

    match = codeOnlyPattern.exec(line);
    if (match) {
      pending = { schoolCode: match[1], parts: [], line: index + 1 };
      continue;
    }

    match = codeNamePattern.exec(line);
    if (match) {
      pending = { schoolCode: match[1], parts: [match[2]], line: index + 1 };
      continue;
    }

    match = numericPattern.exec(line);
    if (match && pending) {
      const schoolName = pending.parts.join("").replace(/\s+/g, "");
      const [, groupCode, planText, filedText, scoreText, rankText] = match;
      if (scoreText === "-" || rankText === "-") {
        skippedRows.push({
          line: index + 1,
          schoolCode: pending.schoolCode,
          schoolName,
          groupCode,
          reason: "empty-filing-score-officially-unfiled",
        });
      } else {
        records.push(makeRecord(source, {
          schoolCode: pending.schoolCode,
          schoolName,
          groupCode,
          planCount: numberFrom(planText),
          filedCount: numberFrom(filedText),
          minScore: numberFrom(scoreText),
          minRank: numberFrom(rankText),
        }));
      }
      pending = null;
      continue;
    }

    if (pending) {
      pending.parts.push(line);
      continue;
    }

    if (/^\d{5}/.test(line) || /^\d{3}\s+/.test(line)) {
      skippedRows.push({ line: index + 1, text: line, reason: "unparsed-row" });
    }
  }

  const invalid = records.filter((record) =>
    record.minScore < 100 ||
    record.minScore > 750 ||
    record.minRankEnd < 1 ||
    record.planCount < 0 ||
    record.filedCount < 0 ||
    record.filedCount > record.planCount + 20
  );
  if (invalid.length) throw new Error(`Invalid Guangdong vocational rows: ${JSON.stringify(invalid.slice(0, 5))}`);
  return { records, skippedRows };
}

function parsePdf(source) {
  const rawText = run("pdftotext", ["-raw", source.file, "-"]);
  const { records, skippedRows } = parseRawText(rawText, source);
  const filedCount = records.reduce((sum, record) => sum + record.filedCount, 0);
  if (records.length !== source.expectedRecords) {
    throw new Error(`${source.subjectType} parsed ${records.length} rows, expected ${source.expectedRecords}`);
  }
  if (filedCount !== source.expectedFiledCount) {
    throw new Error(`${source.subjectType} filedCount ${filedCount}, expected ${source.expectedFiledCount}`);
  }
  return {
    ...source,
    records,
    skippedRows,
    filedCount,
    planCount: records.reduce((sum, record) => sum + record.planCount, 0),
    minScore: Math.min(...records.map((record) => record.minScore)),
    maxScore: Math.max(...records.map((record) => record.minScore)),
    minRank: Math.min(...records.map((record) => record.minRankEnd)),
    maxRank: Math.max(...records.map((record) => record.minRankEnd)),
  };
}

function dedupeRecords(records) {
  const map = new Map();
  for (const record of records) {
    const key = [
      record.province,
      record.year,
      record.subjectType,
      record.batch,
      record.schoolCode,
      record.majorGroup,
    ].join("|");
    const existing = map.get(key);
    if (!existing || record.minRankEnd < existing.minRankEnd) map.set(key, record);
  }
  return [...map.values()].sort((a, b) =>
    String(a.subjectType).localeCompare(String(b.subjectType), "zh-Hans-CN") ||
    (a.minRankEnd || 0) - (b.minRankEnd || 0) ||
    String(a.schoolName).localeCompare(String(b.schoolName), "zh-Hans-CN")
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const { pagePath, pdfs } = ensureCache(args.useCache);
  const parsed = pdfs.map(parsePdf);
  const records = dedupeRecords(parsed.flatMap((item) => item.records));
  if (records.length !== 2338) throw new Error(`deduped ${records.length} rows, expected 2338`);

  const out = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const payload = {
    dataset: path.basename(out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "广东省2025年专科普通类官方投档线",
    notes: [
      "本文件由 scripts/import-official-guangdong-vocational-filing-2025.mjs 自动生成。",
      "来源为广东省教育考试院 2025 年专科普通类历史/物理投档情况 PDF。",
      "投档最低分与最低排位只能用于院校专业组进档边界判断，不能替代专业录取结果。",
    ],
    audit: {
      pagePath,
      expectedFiledCounts: {
        "历史类": 89625,
        "物理类": 115495,
      },
      parsedFiledCounts: Object.fromEntries(parsed.map((item) => [item.subjectType, item.filedCount])),
      parsedRecords: Object.fromEntries(parsed.map((item) => [item.subjectType, item.records.length])),
      skippedRows: parsed.flatMap((item) =>
        item.skippedRows.map((row) => ({ subjectType: item.subjectType, ...row }))
      ),
    },
    sourceNotes: [
      {
        id: "official-guangdong-vocational-filing-2025",
        title: "广东省2025年专科普通类投档情况",
        publisher: "广东省教育考试院",
        url: PAGE_URL,
        attachmentUrls: PDFS.map((item) => item.url),
        quality: "official-guangdong-2025-vocational-major-group-filing-pdf-score-rank",
        usage: `自动抽取专科普通类历史/物理院校专业组投档线${records.length}条，含最低分和最低排位。`,
        parsedRecords: records.length,
        parsedFiles: parsed.map((item) => ({
          fileName: path.basename(item.file),
          title: item.title,
          subjectType: item.subjectType,
          records: item.records.length,
          planCount: item.planCount,
          filedCount: item.filedCount,
          scoreRange: { min: item.minScore, max: item.maxScore },
          rankRange: { min: item.minRank, max: item.maxRank },
          bytes: item.bytes,
          sha256: item.sha256,
          url: item.url,
        })),
      },
    ],
    records,
  };
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, out),
    records: records.length,
    bySubject: Object.fromEntries(parsed.map((item) => [item.subjectType, item.records.length])),
    filedCounts: Object.fromEntries(parsed.map((item) => [item.subjectType, item.filedCount])),
    scoreRange: {
      min: Math.min(...records.map((record) => record.minScore)),
      max: Math.max(...records.map((record) => record.minScore)),
    },
    rankRange: {
      min: Math.min(...records.map((record) => record.minRankEnd)),
      max: Math.max(...records.map((record) => record.minRankEnd)),
    },
  }, null, 2));
}

main();
