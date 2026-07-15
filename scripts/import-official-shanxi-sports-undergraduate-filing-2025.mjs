#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-shanxi-sports-undergraduate-filing-2025");
const DEFAULT_OUT = "data/admissions/official-shanxi-sports-undergraduate-filing-2025-import.json";
const YEAR = 2025;
const PROVINCE = "山西";
const SUBJECT_TYPE = "体育类";
const BATCH = "体育本科批";
const SOURCE_ID = "official-shanxi-sports-undergraduate-filing-2025";
const CHSI_PAGE_URL = "https://gaokao.chsi.com.cn/gkxx/zc/ss/202507/20250725/2293394615.html";
const PDF_URL = "https://t1.chei.com.cn/news/getfile/2293394616-2293394615-cd1bb6c3f00d9c030d8a90997ef2a606.pdf";

const EXPECTED = {
  pages: 5,
  records: 137,
  schools: 107,
  unfiledRows: 4,
  scoreMin: 518,
  scoreMax: 643,
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-shanxi-sports-undergraduate-filing-2025.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-shanxi-sports-undergraduate-filing-2025.mjs --use-cache",
    "",
    "Imports Shanxi 2025 sports undergraduate major-group filing minimum composite scores from the CHSI reposted official PDF.",
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

function shortHash(value, length = 16) {
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
      "Mozilla/5.0 gaokao-shanxi-sports-undergraduate-importer/1.0",
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

function textForPdf(pdfPath) {
  const textPath = path.join(TMP_ROOT, "sports.txt");
  run("pdftotext", ["-layout", pdfPath, textPath]);
  const text = fs.readFileSync(textPath, "utf8");
  return { textPath, text };
}

function groupTags(groupName) {
  const tags = ["官方体育本科投档线", BATCH];
  if (/公费师范/.test(groupName)) tags.push("公费师范生");
  if (/合作办学/.test(groupName)) tags.push("合作办学");
  return tags;
}

function tieBreakFromComposite(scoreText) {
  const parts = scoreText.split(".");
  const decimals = parts[1] || "";
  return {
    compositeScoreText: scoreText,
    compositeScoreInteger: Number(parts[0]),
    compositeScoreHundredths: decimals.slice(0, 2),
    cultureScoreText: decimals.slice(2, 5),
    chineseMathSumText: decimals.slice(5, 8),
  };
}

function parseText(text) {
  let currentSchool = null;
  const records = [];
  const warnings = [];
  const unfiledRows = [];

  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    const cleaned = line.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    if (/^(山西省|批次：|院校|代号|说明：|未投档|第\s*\d+\s*页)/.test(cleaned) || /^院校名称/.test(cleaned)) continue;

    const unfiled = /^(?:(\d{4})\s+(.+?)\s+)?体育类\s+(第\d{3}组(?:\([^)]+\))?)$/.exec(cleaned);
    if (unfiled) {
      if (unfiled[1] && unfiled[2]) currentSchool = { code: unfiled[1], name: unfiled[2] };
      unfiledRows.push({
        line: lineIndex + 1,
        schoolCode: currentSchool?.code || "",
        schoolName: currentSchool?.name || "",
        majorGroup: unfiled[3],
        text: cleaned,
      });
      continue;
    }

    const match = /^(?:(\d{4})\s+(.+?)\s+)?体育类\s+(第\d{3}组(?:\([^)]+\))?)\s+(\d{3}\.\d{8})$/.exec(cleaned);
    if (!match) {
      if (/体育类|\d{3}\.\d+/.test(cleaned)) warnings.push({ type: "unparsed-row", line: lineIndex + 1, text: cleaned });
      continue;
    }

    if (match[1] && match[2]) currentSchool = { code: match[1], name: match[2] };
    if (!currentSchool) {
      warnings.push({ type: "missing-current-school", line: lineIndex + 1, text: cleaned });
      continue;
    }

    const majorGroup = match[3];
    const tieBreakScoreText = match[4];
    const minScore = Number(tieBreakScoreText.split(".")[0]);
    const idBase = [YEAR, PROVINCE, SUBJECT_TYPE, currentSchool.code, currentSchool.name, majorGroup, tieBreakScoreText].join("|");
    records.push({
      id: `${YEAR}-shanxi-sports-undergrad-filing-${shortHash(idBase, 18)}`,
      province: PROVINCE,
      year: YEAR,
      subjectType: SUBJECT_TYPE,
      batch: BATCH,
      schoolName: currentSchool.name,
      schoolCode: currentSchool.code,
      schoolTags: groupTags(majorGroup),
      city: "",
      dataType: "major-group-admission",
      majorName: "体育本科批院校专业组投档最低分",
      majorCode: "",
      majorGroup,
      disciplineCodes: [],
      minScore,
      minRankStart: null,
      minRankEnd: null,
      rankRangeText: "",
      tieBreakScoreText,
      tieBreakScores: tieBreakFromComposite(tieBreakScoreText),
      scoreKind: "体育类综合分",
      sourceId: SOURCE_ID,
      sourceQuality: "official-chsi-shanxi-2025-sports-undergraduate-major-group-filing-pdf-score-only",
      cautions: [
        "这是阳光高考平台转载山西省2025年体育本科批院校专业组投档最低分官方 PDF，按院校专业组使用，不是具体专业录取最低分。",
        "原表说明按综合分排序；小数点后前2位为综合分小数，3-5位为文化成绩，6-8位为语文与数学成绩之和。本记录只把整数部分作为 minScore，并保留完整小数串审计。",
        "原表不提供最低位次；推荐器不得生成假位次或录取概率。",
      ],
    });
  }

  return { records, warnings, unfiledRows };
}

function summarize(records, input) {
  const scores = records.map((record) => record.minScore);
  return {
    records: records.length,
    schools: new Set(records.map((record) => `${record.schoolCode}|${record.schoolName}`)).size,
    scoreRange: { min: Math.min(...scores), max: Math.max(...scores) },
    pdf: {
      url: PDF_URL,
      pdfPath: rel(input.pdfPath),
      pdfBytes: fs.statSync(input.pdfPath).size,
      pdfSha256: sha256File(input.pdfPath),
      textPath: rel(input.textPath),
      textBytes: Buffer.byteLength(input.text),
      textSha256: sha256(input.text),
      pages: input.info.pages,
      unfiledRows: input.unfiledRows.length,
      warnings: input.warnings.length,
    },
  };
}

function validate(records, parsedInput) {
  const errors = [];
  const duplicateIds = records.length - new Set(records.map((record) => record.id)).size;
  if (duplicateIds) errors.push({ type: "duplicate-ids", duplicateIds });
  const scores = records.map((record) => record.minScore);
  const schools = new Set(records.map((record) => `${record.schoolCode}|${record.schoolName}`)).size;
  if (records.length !== EXPECTED.records) errors.push({ type: "record-count", expected: EXPECTED.records, actual: records.length });
  if (schools !== EXPECTED.schools) errors.push({ type: "school-count", expected: EXPECTED.schools, actual: schools });
  if (parsedInput.info.pages !== EXPECTED.pages) errors.push({ type: "page-count", expected: EXPECTED.pages, actual: parsedInput.info.pages });
  if (parsedInput.unfiledRows.length !== EXPECTED.unfiledRows) errors.push({ type: "unfiled-count", expected: EXPECTED.unfiledRows, actual: parsedInput.unfiledRows.length });
  if (parsedInput.warnings.length !== 0) errors.push({ type: "parse-warnings", warnings: parsedInput.warnings.slice(0, 10), total: parsedInput.warnings.length });
  if (Math.min(...scores) !== EXPECTED.scoreMin || Math.max(...scores) !== EXPECTED.scoreMax) {
    errors.push({ type: "score-range", expected: [EXPECTED.scoreMin, EXPECTED.scoreMax], actual: [Math.min(...scores), Math.max(...scores)] });
  }
  if (!records.some((record) => record.schoolName === "华东师范大学" && record.minScore === 643 && record.majorGroup.includes("公费师范生"))) {
    errors.push({ type: "missing-anchor", anchor: "华东师范大学 公费师范生 643.60529195" });
  }
  if (!records.some((record) => record.schoolName === "山西工程科技职业大学" && record.minScore === 536)) {
    errors.push({ type: "missing-anchor", anchor: "山西工程科技职业大学 536.70354146" });
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
  const pdfPath = path.join(TMP_ROOT, "sports.pdf");
  ensureDownloaded(pagePath, CHSI_PAGE_URL, args.useCache);
  ensureDownloaded(pdfPath, PDF_URL, args.useCache);

  const pageHtml = fs.readFileSync(pagePath, "utf8");
  if (!pageHtml.includes("山西：2025年普通高校招生体育本科批院校专业组投档最低分") || !pageHtml.includes(PDF_URL)) {
    throw new Error("CHSI source page validation failed: title or PDF URL missing");
  }

  const info = pdfInfo(pdfPath);
  const { textPath, text } = textForPdf(pdfPath);
  if (!text.includes("批次： 体育本科批") || !text.includes("按综合分")) {
    throw new Error("PDF text validation failed: expected sports undergraduate batch notes missing");
  }

  const parsed = parseText(text);
  const parsedInput = { pdfPath, info, textPath, text, ...parsed };
  const errors = validate(parsed.records, parsedInput);
  if (errors.length) {
    throw new Error(`Shanxi sports undergraduate filing validation failed:\n${JSON.stringify(errors, null, 2)}`);
  }

  const summary = summarize(parsed.records, parsedInput);
  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    dataset: path.basename(args.out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "山西 2025 体育本科批院校专业组投档最低分（阳光高考转载官方 PDF）",
    notes: [
      "本文件由 scripts/import-official-shanxi-sports-undergraduate-filing-2025.mjs 自动生成。",
      "该 PDF 为阳光高考平台转载的山西省 2025 年体育本科批院校专业组投档最低分，导入为 major-group-admission score-only 记录。",
      "体育类投档最低分按综合分排序；minScore 只使用整数部分，完整综合分和同分排序串保留为 tieBreakScoreText/tieBreakScores。",
      "未投档专业组为空分，不入主数据；原表不含最低位次，不生成假位次。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: "山西：2025年普通高校招生体育本科批院校专业组投档最低分",
        publisher: "阳光高考平台转载山西省招生考试管理中心",
        url: CHSI_PAGE_URL,
        pdfUrl: PDF_URL,
        quality: "official-chsi-shanxi-2025-sports-undergraduate-major-group-filing-pdf-score-only",
        usage: `阳光高考转载官方 PDF 抽取山西2025体育本科批院校专业组投档最低分${summary.records}条；按体育类综合分院校专业组投档边界使用，不替代专业录取最低分或位次。`,
        parsedRecords: summary.records,
        schoolCount: summary.schools,
        scoreRange: summary.scoreRange,
        pdf: summary.pdf,
        chsiPage: {
          url: CHSI_PAGE_URL,
          htmlPath: rel(pagePath),
          htmlBytes: Buffer.byteLength(pageHtml),
          htmlSha256: sha256(pageHtml),
        },
        unfiledRows: parsed.unfiledRows,
        unfiledRowCount: parsed.unfiledRows.length,
        parseWarnings: parsed.warnings,
        parseWarningCount: parsed.warnings.length,
        caution: "体育本科批投档最低分不是具体专业录取分；原表不含最低位次，需要结合山西体育类综合分规则、招生计划和招生章程复核。",
      },
    ],
    records: parsed.records.sort((a, b) =>
      String(a.schoolCode).localeCompare(String(b.schoolCode), "zh-Hans-CN") ||
      String(a.majorGroup).localeCompare(String(b.majorGroup), "zh-Hans-CN")
    ),
    stats: summary,
  }, null, 2));

  console.log(JSON.stringify({
    ok: true,
    out: rel(outPath),
    records: summary.records,
    schools: summary.schools,
    scoreRange: summary.scoreRange,
    unfiledRowCount: parsed.unfiledRows.length,
    parseWarningCount: parsed.warnings.length,
    pdfSha256: summary.pdf.pdfSha256,
    chsiPageSha256: sha256(pageHtml),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
