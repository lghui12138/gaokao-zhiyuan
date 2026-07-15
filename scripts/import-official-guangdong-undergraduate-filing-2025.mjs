#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-guangdong-undergraduate-2025");
const DEFAULT_OUT = "data/admissions/official-guangdong-undergraduate-filing-2025-import.json";
const YEAR = 2025;
const PROVINCE = "广东";
const BATCH = "本科批";
const PAGE_URL = "https://eea.gd.gov.cn/ptgk/content/post_4746781.html";
const PDFS = [
  {
    subjectType: "历史类",
    name: "history.pdf",
    url: "https://eea.gd.gov.cn/attachment/0/585/585885/4746781.pdf",
    title: "广东省2025年本科普通类（历史）投档情况",
    expectedRecords: 1634,
    expectedFiledCount: 66013,
  },
  {
    subjectType: "物理类",
    name: "physics.pdf",
    url: "https://eea.gd.gov.cn/attachment/0/585/585886/4746781.pdf",
    title: "广东省2025年本科普通类（物理）投档情况",
    expectedRecords: 3503,
    expectedFiledCount: 218024,
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-guangdong-undergraduate-filing-2025.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-guangdong-undergraduate-filing-2025.mjs --use-cache",
    "",
    "Imports Guangdong 2025 undergraduate ordinary-category official filing PDFs.",
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
      "Mozilla/5.0 gaokao-guangdong-undergraduate-importer/1.0",
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
        "Mozilla/5.0 gaokao-guangdong-undergraduate-importer/1.0",
        "-o",
        pdfPath,
        item.url,
      ]);
    }
    const stat = fs.statSync(pdfPath);
    if (stat.size < 300 * 1024) {
      throw new Error(`Downloaded Guangdong PDF is too small: ${pdfPath} (${stat.size} bytes)`);
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
  if (/理工|工程|电力|机电|电子|信息|科技|交通|航空|航天|智能|软件|计算机|数据|自动化|机械|材料|化学|建筑|土木/.test(text)) out.add("08");
  if (/医学|医科|中医|药|护理|卫生|口腔|临床|生物医学/.test(text)) out.add("10");
  if (/师范|教育/.test(text)) out.add("04");
  if (/外语|语言|新闻|传媒|艺术|音乐|戏剧|电影|体育|旅游|传播/.test(text)) out.add("05");
  if (/政法|公安|警察|军|国防/.test(text)) out.add("03");
  if (/农业|农林|林业|园林|水产/.test(text)) out.add("09");
  if (/数学|物理|生物|地理/.test(text)) out.add("07");
  return [...out];
}

function schoolTagsFor(record) {
  const tags = ["广东官方本科投档线", record.subjectType];
  const text = `${record.schoolName}${record.majorGroup}`;
  if (/广东|广州|深圳|汕头|佛山|东莞|珠海|中山|惠州|湛江|韶关|肇庆|江门|茂名|汕尾|河源|阳江|清远|潮州|揭阳|云浮/.test(record.schoolName)) {
    tags.push("广东院校");
  }
  if (/985|北京大学|清华大学|中国人民大学|复旦大学|上海交通大学|浙江大学|南京大学|中国科学技术大学|哈尔滨工业大学|西安交通大学|北京师范大学|中山大学|华南理工大学/.test(record.schoolName)) tags.push("985/强基名校");
  if (/中外合作|合作办学|内地香港|香港合作/.test(text)) tags.push("中外/内地港澳合作办学");
  if (/师范|教育/.test(text)) tags.push("师范教育");
  if (/医学|医科|药|护理|卫生|口腔|临床/.test(text)) tags.push("医卫");
  if (/计算机|软件|数据|人工智能|智能|电子|通信|信息|电气|自动化|工程|技术/.test(text)) tags.push("信息技术/工程");
  if (/财经|金融|会计|审计|经济|商务|管理|贸易/.test(text)) tags.push("财经商科");
  if (record.minScore >= 630) tags.push("高分段");
  if (record.minScore <= 450) tags.push("本科批低分边界");
  return [...new Set(tags)];
}

function parseRawText(rawText, source) {
  const records = [];
  const skipped = [];
  const rowPattern = /^(\d{5})\s+(.+?)\s+(\d{3})\s+(\d+)\s+(\d+)\s+(\d{3})\s+(\d+)\s*$/u;
  const lines = rawText.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || /^(广东省|院校代码|第\s*\d+页|广|东|省|教|育|考|试|院)$/.test(line)) continue;
    const match = rowPattern.exec(line);
    if (!match) {
      if (/^\d{5}\s+/.test(line)) skipped.push({ line: index + 1, text: line });
      continue;
    }
    const [, schoolCode, schoolName, groupCode, planText, filedText, scoreText, rankText] = match;
    const planCount = numberFrom(planText);
    const filedCount = numberFrom(filedText);
    const minScore = numberFrom(scoreText);
    const minRank = numberFrom(rankText);
    if (
      minScore < 400 ||
      minScore > 750 ||
      minRank < 1 ||
      planCount < 0 ||
      filedCount < 0 ||
      filedCount > planCount + 20
    ) {
      skipped.push({ line: index + 1, text: line, reason: "range-check" });
      continue;
    }

    const majorGroup = `${groupCode}专业组`;
    const idBase = [
      YEAR,
      PROVINCE,
      source.subjectType,
      BATCH,
      schoolCode,
      schoolName,
      majorGroup,
      minScore,
      minRank,
    ].join("|");
    const record = {
      id: `${YEAR}-gd-undergrad-filing-${hash(idBase, 18)}`,
      province: PROVINCE,
      year: YEAR,
      subjectType: source.subjectType,
      batch: BATCH,
      schoolName,
      schoolCode,
      schoolTags: [],
      city: "",
      dataType: "major-group-admission",
      majorName: "院校专业组投档线",
      majorCode: groupCode,
      majorGroup,
      disciplineCodes: disciplineCodes(`${schoolName}${majorGroup}`),
      planCount,
      filedCount,
      minScore,
      minRankStart: minRank,
      minRankEnd: minRank,
      rankRangeText: String(minRank),
      sourceId: "official-guangdong-undergraduate-filing-2025",
      sourceQuality: "official-guangdong-2025-undergraduate-major-group-filing-pdf-score-rank",
      cautions: [
        "省级本科投档线只能判断院校专业组进档边界，不能替代专业录取结果。",
        "同一专业组内仍需核对具体专业、选科、体检、语种、学费、校区和调剂范围。",
        "本记录来自广东省教育考试院公开附件，正式填报前仍需核对当年招生计划和招生章程。",
      ],
    };
    record.schoolTags = schoolTagsFor(record);
    records.push(record);
  }
  return { records, skipped };
}

function parsePdf(source) {
  const rawText = run("pdftotext", ["-raw", source.file, "-"]);
  const { records, skipped } = parseRawText(rawText, source);
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
    skipped,
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
  if (records.length !== 5137) throw new Error(`deduped ${records.length} rows, expected 5137`);

  const out = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const payload = {
    dataset: path.basename(out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "广东省2025年本科普通类官方投档线",
    notes: [
      "本文件由 scripts/import-official-guangdong-undergraduate-filing-2025.mjs 自动生成。",
      "来源为广东省教育考试院 2025 年本科普通类历史/物理投档情况 PDF。",
      "投档最低分与最低排位只能用于院校专业组进档边界判断，不能替代专业录取结果。",
    ],
    audit: {
      pagePath,
      expectedFiledCounts: {
        "历史类": 66013,
        "物理类": 218024,
      },
      parsedFiledCounts: Object.fromEntries(parsed.map((item) => [item.subjectType, item.filedCount])),
      parsedRecords: Object.fromEntries(parsed.map((item) => [item.subjectType, item.records.length])),
      skippedRows: parsed.flatMap((item) =>
        item.skipped.map((row) => ({ subjectType: item.subjectType, ...row }))
      ),
    },
    sourceNotes: [
      {
        id: "official-guangdong-undergraduate-filing-2025",
        title: "广东省2025年本科普通类投档情况",
        publisher: "广东省教育考试院",
        url: PAGE_URL,
        attachmentUrls: PDFS.map((item) => item.url),
        quality: "official-guangdong-2025-undergraduate-major-group-filing-pdf-score-rank",
        usage: `自动抽取本科普通类历史/物理院校专业组投档线${records.length}条，含最低分和最低排位。`,
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
