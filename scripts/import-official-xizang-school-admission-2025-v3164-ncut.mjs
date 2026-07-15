#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-school-admission-2025-v3164-ncut-import.json";
const RAW_DIR = "data/admissions/raw/official-xizang-school-admission-2025-v3164-ncut";
const PROVINCE = "西藏";

const SOURCE = {
  id: "official-ncut-xizang-2025-school-admission",
  quality: "official-school-ncut-2025-xizang-html-table-filing-score-only",
  schoolCode: "0009",
  nationalSchoolCode: "10009",
  schoolName: "北方工业大学",
  city: "北京",
  tags: ["理工"],
  url: "https://bkzs.ncut.edu.cn/info/1030/2745.htm",
};

const SOURCE_ROWS = [
  {
    sourceProvinceLabel: "西藏（汉族）",
    candidateCategory: "汉族",
    sourceScienceControlScore: 400,
    sourceArtsControlScore: 410,
    subjectRaw: "文史",
    minScore: 441,
  },
  {
    sourceProvinceLabel: "西藏（少数）",
    candidateCategory: "少数民族",
    sourceScienceControlScore: 300,
    sourceArtsControlScore: 338,
    subjectRaw: "文史",
    minScore: 379,
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-school-admission-2025-v3164-ncut.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-school-admission-2025-v3164-ncut.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports North China University of Technology official 2025 Xizang filing score rows.",
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
    title: firstText(html, [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]),
    publishedAt: firstText(html, [
      /日期\s*[:：]\s*([0-9]{4}[-年][0-9]{1,2}[-月][0-9]{1,2}日?)/i,
      /发布时间\s*[:：]?\s*([0-9]{4}[-年][0-9]{1,2}[-月][0-9]{1,2}日?)/i,
    ]),
  };
}

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-xizang-ncut-v3164-importer/1.0",
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
    "120",
    "-A",
    "Mozilla/5.0 gaokao-xizang-ncut-v3164-importer/1.0",
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
  const file = path.join(rawDir, "ncut-2025-admission-lines.html");
  if (!useCache || !fs.existsSync(file)) {
    fs.writeFileSync(file, await download(SOURCE.url));
  }
  return file;
}

function subjectType(sourceSubjectRaw) {
  if (sourceSubjectRaw === "文史") return "历史类";
  if (sourceSubjectRaw === "理工") return "物理类";
  throw new Error(`Unsupported subject: ${sourceSubjectRaw}`);
}

function baseFields() {
  return {
    schoolCode: SOURCE.schoolCode,
    nationalSchoolCode: SOURCE.nationalSchoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-filing-score",
    sourceUrl: SOURCE.url,
  };
}

function schoolOfficialCautions(row) {
  return [
    "本记录来自北方工业大学招生网官方2025年录取分数线 HTML 表，是单校分省调档分数边界，不是西藏自治区教育考试院全量投档/录取分数表。",
    `源表按${row.sourceProvinceLabel}分列，使用时必须保留该考生类别，不得与其他西藏普通类/A-B 类口径自动合并。`,
    "源表西藏行仅公开文史调档分数线，理工和综合改革栏为空/斜杠；不得据此推断理工调档分或专业最低分。",
    "源表未公开最低位次；不得生成假位次或单独输出录取概率。",
    "学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得清除西藏省级全量正式分数表缺口。",
  ];
}

function buildRecords() {
  return SOURCE_ROWS.map((row) => {
    const idBase = [2025, SOURCE.schoolCode, row.sourceProvinceLabel, row.subjectRaw, row.minScore].join("|");
    return {
      id: `2025-ncut-xizang-filing-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: 2025,
      subjectType: subjectType(row.subjectRaw),
      sourceSubjectRaw: row.subjectRaw,
      batch: "本科一批",
      sourceBatchRaw: "重点本科控制分数线/我校调档分数线",
      ...baseFields(),
      dataType: "institution-admission",
      majorGroup: `${row.sourceProvinceLabel}|${row.subjectRaw}`,
      admissionType: "普通类",
      admissionSubtype: row.sourceProvinceLabel,
      formalScoreScope: "school-official-only",
      xizangCandidateCategory: row.candidateCategory,
      minScore: row.minScore,
      scoreOnly: true,
      rankUnavailable: true,
      sourceScienceControlScore: row.sourceScienceControlScore,
      sourceArtsControlScore: row.sourceArtsControlScore,
      sourceMinScoreRaw: String(row.minScore),
      sourceRankRaw: "/",
      sourceScoreScale: "source-declared-filing-score",
      transcriptionMethod: "official-html-table-token-sequence-validated",
      cautions: schoolOfficialCautions(row),
      rawText: [
        "2025",
        PROVINCE,
        row.sourceProvinceLabel,
        `重点本科控制线理工${row.sourceScienceControlScore}`,
        `重点本科控制线文史${row.sourceArtsControlScore}`,
        `文史调档线${row.minScore}`,
        "文史位次未公开",
      ].join(" / "),
    };
  });
}

function assertSequence(text, tokens, label) {
  let cursor = 0;
  for (const token of tokens) {
    const next = text.indexOf(token, cursor);
    if (next === -1) {
      throw new Error(`NCUT source page missing expected token sequence for ${label}: ${tokens.join(" / ")}`);
    }
    cursor = next + token.length;
  }
}

function validateHtml(html) {
  const meta = pageMeta(html);
  const plain = textFromHtml(html);
  if (!plain.includes("2025年录取分数线") || !plain.includes("我校调档分数线") || !plain.includes("重点本科控制分数线")) {
    throw new Error("NCUT source page no longer exposes the expected 2025 admission line table tokens.");
  }
  const publishedAt = meta.publishedAt.replace(/[年月]/g, "-").replace(/日/g, "");
  if (publishedAt && publishedAt !== "2025-09-12") {
    throw new Error(`Unexpected NCUT publishedAt ${meta.publishedAt}`);
  }
  for (const row of SOURCE_ROWS) {
    assertSequence(plain, [
      row.sourceProvinceLabel,
      String(row.sourceScienceControlScore),
      String(row.sourceArtsControlScore),
      String(row.minScore),
    ], row.sourceProvinceLabel);
  }
  return meta;
}

function diagnosticsFor(records) {
  const schoolOfficial = records.filter((record) => record.formalScoreScope === "school-official-only");
  return {
    totalRows: records.length,
    schoolOfficialRows: schoolOfficial.length,
    specialPathRows: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    bySourceId: countBy(records, (record) => record.sourceId),
    bySchool: countBy(records, (record) => record.schoolName),
    byDataType: countBy(records, (record) => record.dataType),
    bySubject: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byCandidateCategory: countBy(records, (record) => record.xizangCandidateCategory),
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
    ordinarySchoolOfficialScoreRange: numericRange(schoolOfficial.map((record) => Number(record.minScore))),
    rankRows: records.filter((record) => Number.isFinite(record.minRank)).length,
  };
}

function sourceNoteFor(records, htmlFile, meta) {
  const rawPath = path.relative(PROJECT_ROOT, htmlFile);
  return {
    id: SOURCE.id,
    title: "北方工业大学招生网：2025年录取分数线",
    publisher: SOURCE.schoolName,
    publishedAt: meta.publishedAt || "2025-09-12",
    url: SOURCE.url,
    quality: SOURCE.quality,
    usage: `抽取${SOURCE.schoolName}招生网2025年录取分数线表中的西藏汉族/少数民族文史调档分数线。`,
    parsedRecords: records.length,
    rawPaths: [rawPath],
    sha256: [{ path: rawPath, sha256: sha256File(htmlFile) }],
    transcriptionMethod: "official-html-table-token-sequence-validated",
    cautions: [
      "本源为高校官方单校录取分数表，不是西藏自治区教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "西藏汉族、少数民族两行必须分开使用；源表未提供西藏理工调档线或最低位次。",
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
  if (diagnostics.totalRows !== 2 || diagnostics.schoolOfficialRows !== 2 || diagnostics.specialPathRows !== 0 || diagnostics.rankRows !== 0) {
    throw new Error(`Unexpected v3.164 NCUT diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const output = {
    dataset: "official-xizang-school-admission-2025-v3164-ncut-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      sourceKind: "school-official-single-university-html-table-filing-score",
      schools: [SOURCE.schoolName],
    },
    notes: [
      "本文件由 scripts/import-official-xizang-school-admission-2025-v3164-ncut.mjs 自动生成。",
      "来源为北方工业大学招生网《2025年录取分数线》HTML 表；原始页面已保留在 raw provenance pack。",
      "源表西藏汉族/少数民族两行仅公开文史调档分数线，按 institution-admission 保存。",
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
    byCandidateCategory: diagnostics.byCandidateCategory,
    scoreRange: diagnostics.scoreRange,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
