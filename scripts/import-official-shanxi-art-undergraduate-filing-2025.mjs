#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-shanxi-art-undergraduate-filing-2025");
const DEFAULT_OUT = "data/admissions/official-shanxi-art-undergraduate-filing-2025-import.json";
const YEAR = 2025;
const PROVINCE = "山西";
const SUBJECT_TYPE = "艺术类";
const BATCH = "艺术本科批";
const SOURCE_ID = "official-shanxi-art-undergraduate-filing-2025";
const CHSI_PAGE_URL = "https://gaokao.chsi.com.cn/gkxx/zc/ss/202507/20250725/2293394603.html";

const PDFS = [
  {
    id: "2293394604",
    category: "音乐表演（声乐）",
    title: "山西省2025年普通高校招生院校专业组投档最低分_E艺术本科批_D音乐表演（声乐）",
    url: "https://t1.chei.com.cn/news/getfile/2293394604-2293394603-3b0bd1b4bf9a01218355b2c766284ef4.pdf",
  },
  {
    id: "2293394605",
    category: "音乐表演（器乐）",
    title: "2025年普通高考院校专业组投档最低分_E音乐表演（器乐）",
    url: "https://t2.chei.com.cn/news/getfile/2293394605-2293394603-5d7cfcd420dccb40c6e044839b3269fd.pdf",
  },
  {
    id: "2293394606",
    category: "音乐教育（声乐主项）",
    title: "2025年普通高考院校专业组投档最低分_F音乐教育（声乐）",
    url: "https://t1.chei.com.cn/news/getfile/2293394606-2293394603-774cfbc6da6f9a053de466d2fc4f88da.pdf",
  },
  {
    id: "2293394607",
    category: "音乐教育（器乐主项）",
    title: "2025年普通高考院校专业组投档最低分_G音乐教育（器乐）",
    url: "https://t3.chei.com.cn/news/getfile/2293394607-2293394603-63bd3a4929642e18deff594961ca95e6.pdf",
  },
  {
    id: "2293394608",
    category: "舞蹈类",
    title: "2025年普通高考院校专业组投档最低分_H舞蹈类",
    url: "https://t2.chei.com.cn/news/getfile/2293394608-2293394603-77bf3134b5ed3efb67f58e77c04a33ac.pdf",
  },
  {
    id: "2293394609",
    category: "播音与主持类",
    title: "2025年普通高考院校专业组投档最低分_J播音与主持类",
    url: "https://t1.chei.com.cn/news/getfile/2293394609-2293394603-316015cb34ac6864b5b8cfbf8102589a.pdf",
  },
  {
    id: "2293394610",
    category: "美术与设计类",
    title: "2025年普通高考院校专业组投档最低分_K美术与设计类",
    url: "https://t2.chei.com.cn/news/getfile/2293394610-2293394603-e56b77007c1f8845d322de4e36c61bd8.pdf",
  },
  {
    id: "2293394611",
    category: "书法类",
    title: "2025年普通高考院校专业组投档最低分_L书法类",
    url: "https://t3.chei.com.cn/news/getfile/2293394611-2293394603-c5dec4351a61545ad5f8a9a9c6e8eeec.pdf",
  },
  {
    id: "2293394612",
    category: "表（导）演类（服装表演）",
    title: "2025年普通高考院校专业组投档最低分_M服装表演",
    url: "https://t3.chei.com.cn/news/getfile/2293394612-2293394603-c96cc6f84bc2ae3e43873dc42c2174e5.pdf",
  },
  {
    id: "2293394613",
    category: "表（导）演类（戏剧影视表演）",
    title: "2025年普通高考院校专业组投档最低分_N戏剧影视表演",
    url: "https://t1.chei.com.cn/news/getfile/2293394613-2293394603-94ed2fb5b427f8288e1d94082663223e.pdf",
  },
  {
    id: "2293394614",
    category: "表（导）演类（戏剧影视导演）",
    title: "2025年普通高考院校专业组投档最低分_P戏剧影视导演",
    url: "https://t1.chei.com.cn/news/getfile/2293394614-2293394603-0d69eee6d53f5e314c90fda448174f2b.pdf",
  },
];

const EXPECTED = {
  pdfs: 11,
  pages: 53,
  records: 1417,
  schools: 499,
  unfiledRows: 62,
  scoreMin: 408,
  scoreMax: 625,
  categoryRecords: {
    "音乐表演（声乐）": 92,
    "音乐表演（器乐）": 156,
    "音乐教育（声乐主项）": 114,
    "音乐教育（器乐主项）": 95,
    "舞蹈类": 176,
    "播音与主持类": 129,
    "美术与设计类": 485,
    "书法类": 67,
    "表（导）演类（服装表演）": 49,
    "表（导）演类（戏剧影视表演）": 42,
    "表（导）演类（戏剧影视导演）": 12,
  },
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-shanxi-art-undergraduate-filing-2025.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-shanxi-art-undergraduate-filing-2025.mjs --use-cache",
    "",
    "Imports Shanxi 2025 art undergraduate major-group filing minimum composite scores from CHSI reposted official PDFs.",
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

function shortHash(value, length = 18) {
  return sha256(String(value)).slice(0, length);
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function ensureDownloaded(file, url, useCache) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  if (!useCache || !fs.existsSync(file) || fs.statSync(file).size === 0) {
    run("curl", [
      "-L",
      "--fail",
      "--max-time",
      "60",
      "--user-agent",
      "Mozilla/5.0 gaokao-shanxi-art-undergraduate-importer/1.0",
      "-o",
      file,
      url,
    ]);
  }
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error(`Missing downloaded source: ${file}`);
  }
}

function pdfInfo(pdfPath) {
  const output = run("pdfinfo", [pdfPath]);
  const pages = Number(/Pages:\s+(\d+)/.exec(output)?.[1] || 0);
  const fileSize = Number(/File size:\s+(\d+)/.exec(output)?.[1] || fs.statSync(pdfPath).size);
  return { pages, fileSize, raw: output };
}

function textForPdf(pdfPath, pdf) {
  const textPath = path.join(TMP_ROOT, `${pdf.id}.txt`);
  run("pdftotext", ["-layout", pdfPath, textPath]);
  const text = fs.readFileSync(textPath, "utf8");
  return { textPath, text };
}

function groupTags(category, groupName) {
  const tags = ["官方艺术本科投档线", BATCH, category];
  if (/合作办学/.test(groupName)) tags.push("合作办学");
  return tags;
}

function tieBreakFromComposite(scoreText) {
  const [integerPart, decimals = ""] = scoreText.split(".");
  return {
    compositeScoreText: scoreText,
    compositeScoreInteger: Number(integerPart),
    compositeScoreHundredths: decimals.slice(0, 2),
    cultureScoreText: decimals.slice(2, 5),
    chineseMathSumText: decimals.slice(5, 8),
  };
}

function parseText(text, pdf) {
  let currentSchool = null;
  const records = [];
  const warnings = [];
  const unfiledRows = [];

  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/\f/g, " ").trimEnd();
    if (!line.trim()) continue;
    if (/山西省|批次：|院校|代号|说明：|未投档|最低分|第\d+页/.test(line)) continue;

    const groupMatch = line.match(/第\d{3}组(?:\([^)]+\)|（[^）]+）)?/);
    if (!groupMatch) continue;

    const scoreMatch = line.match(/(\d{3}\.\d{8})\s*$/);
    const scoreText = scoreMatch ? scoreMatch[1] : "";
    const noScoreLine = scoreMatch ? line.slice(0, scoreMatch.index).trimEnd() : line.trimEnd();
    const group = groupMatch[0];
    const beforeGroup = noScoreLine.slice(0, groupMatch.index).trimEnd();
    const categoryIndex = beforeGroup.lastIndexOf(pdf.category);
    if (categoryIndex < 0) {
      warnings.push({ type: "category-not-found", pdfId: pdf.id, category: pdf.category, line: lineIndex + 1, text: rawLine });
      continue;
    }

    const schoolPart = beforeGroup.slice(0, categoryIndex).trim();
    if (schoolPart) {
      const schoolMatch = schoolPart.match(/^(\d{4})\s+(.+?)\s*$/);
      if (!schoolMatch) {
        warnings.push({ type: "school-not-parsed", pdfId: pdf.id, category: pdf.category, line: lineIndex + 1, schoolPart, text: rawLine });
        continue;
      }
      currentSchool = { code: schoolMatch[1], name: schoolMatch[2].trim() };
    }

    if (!currentSchool) {
      warnings.push({ type: "missing-current-school", pdfId: pdf.id, category: pdf.category, line: lineIndex + 1, text: rawLine });
      continue;
    }

    if (!scoreText) {
      unfiledRows.push({
        pdfId: pdf.id,
        category: pdf.category,
        line: lineIndex + 1,
        schoolCode: currentSchool.code,
        schoolName: currentSchool.name,
        majorGroup: group,
        text: line.trim(),
      });
      continue;
    }

    const minScore = Number(scoreText.split(".")[0]);
    const idBase = [YEAR, PROVINCE, SUBJECT_TYPE, pdf.category, currentSchool.code, currentSchool.name, group, scoreText].join("|");
    records.push({
      id: `${YEAR}-shanxi-art-undergrad-filing-${shortHash(idBase)}`,
      province: PROVINCE,
      year: YEAR,
      subjectType: SUBJECT_TYPE,
      batch: BATCH,
      schoolName: currentSchool.name,
      schoolCode: currentSchool.code,
      schoolTags: groupTags(pdf.category, group),
      city: "",
      dataType: "major-group-admission",
      majorName: `艺术本科批${pdf.category}院校专业组投档最低分`,
      majorCode: "",
      majorGroup: group,
      disciplineCodes: [],
      minScore,
      minRankStart: null,
      minRankEnd: null,
      rankRangeText: "",
      tieBreakScoreText: scoreText,
      tieBreakScores: tieBreakFromComposite(scoreText),
      scoreKind: "艺术类综合分",
      rankUsage: "art",
      rankCategory: pdf.category,
      sourceId: SOURCE_ID,
      sourceQuality: "official-chsi-shanxi-2025-art-undergraduate-major-group-filing-pdf-score-only",
      cautions: [
        "这是阳光高考平台转载山西省2025年艺术本科批院校专业组投档最低分官方 PDF，按艺术类别和院校专业组使用，不是具体专业录取最低分。",
        "原表说明按综合分排序；小数点后前2位为综合分小数，3-5位为文化成绩，6-8位为语文与数学成绩之和。本记录只把整数部分作为 minScore，并保留完整小数串审计。",
        "原表不提供最低位次；推荐器不得生成假位次或录取概率，且不得与普通类或体育类混用。",
      ],
    });
  }

  return { records, warnings, unfiledRows };
}

function summarize(parsedPdfs, pageHtml, pagePath) {
  const records = parsedPdfs.flatMap((item) => item.records);
  const unfiledRows = parsedPdfs.flatMap((item) => item.unfiledRows);
  const warnings = parsedPdfs.flatMap((item) => item.warnings);
  const scores = records.map((record) => record.minScore);
  const categoryBreakdown = Object.fromEntries(parsedPdfs.map((item) => {
    const catScores = item.records.map((record) => record.minScore);
    return [item.pdf.category, {
      pdfId: item.pdf.id,
      records: item.records.length,
      unfiledRows: item.unfiledRows.length,
      schools: new Set(item.records.map((record) => `${record.schoolCode}|${record.schoolName}`)).size,
      scoreRange: { min: Math.min(...catScores), max: Math.max(...catScores) },
      pages: item.info.pages,
      pdfSha256: sha256File(item.pdfPath),
      textSha256: sha256(item.text),
    }];
  }));

  return {
    records,
    unfiledRows,
    warnings,
    stats: {
      records: records.length,
      schools: new Set(records.map((record) => `${record.schoolCode}|${record.schoolName}`)).size,
      scoreRange: { min: Math.min(...scores), max: Math.max(...scores) },
      pdfCount: parsedPdfs.length,
      pageCount: parsedPdfs.reduce((sum, item) => sum + item.info.pages, 0),
      categoryBreakdown,
      pdfs: parsedPdfs.map((item) => ({
        id: item.pdf.id,
        category: item.pdf.category,
        title: item.pdf.title,
        url: item.pdf.url,
        pdfPath: rel(item.pdfPath),
        pdfBytes: fs.statSync(item.pdfPath).size,
        pdfSha256: sha256File(item.pdfPath),
        textPath: rel(item.textPath),
        textBytes: Buffer.byteLength(item.text),
        textSha256: sha256(item.text),
        pages: item.info.pages,
        parsedRecords: item.records.length,
        unfiledRows: item.unfiledRows.length,
        parseWarnings: item.warnings.length,
      })),
      chsiPage: {
        url: CHSI_PAGE_URL,
        htmlPath: rel(pagePath),
        htmlBytes: Buffer.byteLength(pageHtml),
        htmlSha256: sha256(pageHtml),
      },
    },
  };
}

function validate(summary) {
  const errors = [];
  const { records, unfiledRows, warnings, stats } = summary;
  const duplicateIds = records.length - new Set(records.map((record) => record.id)).size;
  if (duplicateIds) errors.push({ type: "duplicate-ids", duplicateIds });
  if (stats.pdfCount !== EXPECTED.pdfs) errors.push({ type: "pdf-count", expected: EXPECTED.pdfs, actual: stats.pdfCount });
  if (stats.pageCount !== EXPECTED.pages) errors.push({ type: "page-count", expected: EXPECTED.pages, actual: stats.pageCount });
  if (stats.records !== EXPECTED.records) errors.push({ type: "record-count", expected: EXPECTED.records, actual: stats.records });
  if (stats.schools !== EXPECTED.schools) errors.push({ type: "school-count", expected: EXPECTED.schools, actual: stats.schools });
  if (unfiledRows.length !== EXPECTED.unfiledRows) errors.push({ type: "unfiled-count", expected: EXPECTED.unfiledRows, actual: unfiledRows.length });
  if (warnings.length !== 0) errors.push({ type: "parse-warnings", warnings: warnings.slice(0, 10), total: warnings.length });
  if (stats.scoreRange.min !== EXPECTED.scoreMin || stats.scoreRange.max !== EXPECTED.scoreMax) {
    errors.push({ type: "score-range", expected: [EXPECTED.scoreMin, EXPECTED.scoreMax], actual: [stats.scoreRange.min, stats.scoreRange.max] });
  }
  for (const [category, expected] of Object.entries(EXPECTED.categoryRecords)) {
    const actual = stats.categoryBreakdown[category]?.records;
    if (actual !== expected) errors.push({ type: "category-record-count", category, expected, actual });
  }
  const anchors = [
    ["北京航空航天大学", "美术与设计类", "第600组", "603.25578204"],
    ["山西传媒学院", "播音与主持类", "第605组", "530.75384153"],
    ["云南艺术学院", "表（导）演类（戏剧影视导演）", "第616组", "564.59500200"],
  ];
  for (const [schoolName, category, group, scoreText] of anchors) {
    if (!records.some((record) => record.schoolName === schoolName && record.rankCategory === category && record.majorGroup === group && record.tieBreakScoreText === scoreText)) {
      errors.push({ type: "missing-anchor", schoolName, category, group, scoreText });
    }
  }
  return errors;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const pagePath = path.join(TMP_ROOT, "chsi-page.html");
  ensureDownloaded(pagePath, CHSI_PAGE_URL, args.useCache);
  const pageHtml = fs.readFileSync(pagePath, "utf8");
  if (!pageHtml.includes("山西：2025年普通高校招生艺术本科批院校专业组投档最低分")) {
    throw new Error("CHSI source page validation failed: title missing");
  }
  for (const pdf of PDFS) {
    if (!pageHtml.includes(pdf.url)) throw new Error(`CHSI source page validation failed: missing PDF URL ${pdf.id}`);
  }

  const parsedPdfs = [];
  for (const pdf of PDFS) {
    const pdfPath = path.join(TMP_ROOT, `${pdf.id}.pdf`);
    ensureDownloaded(pdfPath, pdf.url, args.useCache);
    const info = pdfInfo(pdfPath);
    const { textPath, text } = textForPdf(pdfPath, pdf);
    if (!text.includes("批次： 艺术本科批") || !text.includes("按综合分")) {
      throw new Error(`PDF text validation failed for ${pdf.id}: expected art undergraduate batch notes missing`);
    }
    const parsed = parseText(text, pdf);
    parsedPdfs.push({ pdf, pdfPath, info, textPath, text, ...parsed });
  }

  const summary = summarize(parsedPdfs, pageHtml, pagePath);
  const errors = validate(summary);
  if (errors.length) {
    throw new Error(`Shanxi art undergraduate filing validation failed:\n${JSON.stringify(errors, null, 2)}`);
  }

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    dataset: path.basename(args.out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "山西 2025 艺术本科批院校专业组投档最低分（阳光高考转载官方 PDF）",
    notes: [
      "本文件由 scripts/import-official-shanxi-art-undergraduate-filing-2025.mjs 自动生成。",
      "该页面包含 11 个艺术本科批院校专业组投档最低分 PDF，导入为 major-group-admission score-only 记录。",
      "艺术类投档最低分按综合分排序；minScore 只使用整数部分，完整综合分和同分排序串保留为 tieBreakScoreText/tieBreakScores。",
      "未投档专业组为空分，不入主数据；原表不含最低位次，不生成假位次。",
      "rankUsage/rankCategory 用于防止艺术类别、体育类和普通类混用。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: "山西：2025年普通高校招生艺术本科批院校专业组投档最低分",
        publisher: "阳光高考平台转载山西省招生考试管理中心",
        url: CHSI_PAGE_URL,
        quality: "official-chsi-shanxi-2025-art-undergraduate-major-group-filing-pdf-score-only",
        usage: `阳光高考转载官方 PDF 抽取山西2025艺术本科批院校专业组投档最低分${summary.stats.records}条；按艺术类综合分、艺术方向和院校专业组投档边界使用，不替代专业录取最低分或位次。`,
        parsedRecords: summary.stats.records,
        schoolCount: summary.stats.schools,
        scoreRange: summary.stats.scoreRange,
        pdfCount: summary.stats.pdfCount,
        pageCount: summary.stats.pageCount,
        pdfs: summary.stats.pdfs,
        categoryBreakdown: summary.stats.categoryBreakdown,
        chsiPage: summary.stats.chsiPage,
        unfiledRows: summary.unfiledRows,
        unfiledRowCount: summary.unfiledRows.length,
        parseWarnings: summary.warnings,
        parseWarningCount: summary.warnings.length,
        caution: "艺术本科批投档最低分不是具体专业录取分；原表不含最低位次，需要结合山西艺术类综合分规则、招生计划和招生章程复核。",
      },
    ],
    records: summary.records.sort((a, b) =>
      String(a.rankCategory).localeCompare(String(b.rankCategory), "zh-Hans-CN") ||
      String(a.schoolCode).localeCompare(String(b.schoolCode), "zh-Hans-CN") ||
      String(a.majorGroup).localeCompare(String(b.majorGroup), "zh-Hans-CN")
    ),
    stats: summary.stats,
  }, null, 2));

  console.log(JSON.stringify({
    ok: true,
    out: rel(outPath),
    records: summary.stats.records,
    schools: summary.stats.schools,
    scoreRange: summary.stats.scoreRange,
    pdfCount: summary.stats.pdfCount,
    pageCount: summary.stats.pageCount,
    unfiledRowCount: summary.unfiledRows.length,
    parseWarningCount: summary.warnings.length,
    chsiPageSha256: summary.stats.chsiPage.htmlSha256,
    categoryBreakdown: summary.stats.categoryBreakdown,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
