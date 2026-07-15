#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-school-admission-2026-guide-v3163-xmu-import.json";
const RAW_DIR = "data/admissions/raw/official-xizang-school-admission-2026-guide-v3163-xmu";
const PROVINCE = "西藏";

const SOURCE = {
  id: "official-xmu-xizang-2026-guide-school-admission",
  quality: "official-school-xmu-2026-xizang-guide-score-only",
  schoolCode: "0165",
  nationalSchoolCode: "10384",
  schoolName: "厦门大学",
  city: "厦门",
  tags: ["综合", "985", "211", "双一流"],
  url: "https://zs.xmu.edu.cn/zsdt/info/1021/1025.htm",
  queryUrl: "https://zsdata.xmu.edu.cn/public/zsdata/lqxx/#/lnfs",
};

const FILING_ROWS = [
  { category: "普通类(A类)", subjectRaw: "文史", scores: { 2025: 441, 2024: 433, 2023: 400 } },
  { category: "普通类(A类)", subjectRaw: "理工", scores: { 2025: 407, 2024: 419, 2023: 417 } },
  { category: "普通类(B类)", subjectRaw: "文史", scores: { 2025: 587, 2024: 592, 2023: 582 } },
  { category: "普通类(B类)", subjectRaw: "理工", scores: { 2025: 642, 2024: 607, 2023: 602 } },
];

const MAJOR_ROWS = [
  {
    subjectRaw: "文史",
    majorName: "公共管理类(含双学士学位项目选拔)",
    futurePlanCount2026: 2,
    scores: { 2025: { maxScore: 446, minScore: 441 }, 2024: { maxScore: 434, minScore: 433 } },
    remark: "含政治学与行政学、行政管理、国际政治。分流时本专业类内专业任选。入校后可选拔进入国际政治+英语双学士学位项目。",
  },
  {
    subjectRaw: "文史",
    majorName: "经济学类(含双学士学位项目选拔)",
    futurePlanCount2026: 1,
    scores: { 2025: { maxScore: 589, minScore: 589 }, 2024: { maxScore: 595, minScore: 595 } },
    remark: "含金融学、财政学、税收学、国际经济与贸易、经济学。分流时本专业类内专业任选。入校后可选拔进入王亚南经济学专业本科创新实验班、财政学国际化试验班、经济学/金融学+数据科学与大数据技术、税收学+法学双学士学位项目等特色培养项目。",
  },
  {
    subjectRaw: "理工",
    majorName: "公共管理类(含双学士学位项目选拔)",
    futurePlanCount2026: 1,
    scores: { 2025: { maxScore: 458, minScore: 407 }, 2024: { maxScore: 425, minScore: 419 } },
    remark: "含政治学与行政学、行政管理、国际政治。分流时本专业类内专业任选。入校后可选拔进入国际政治+英语双学士学位项目。",
  },
  {
    subjectRaw: "理工",
    majorName: "经济学类(含双学士学位项目选拔)",
    futurePlanCount2026: 1,
    scores: { 2025: { maxScore: 645, minScore: 645 }, 2024: { maxScore: 651, minScore: 651 } },
    remark: "含金融学、财政学、税收学、国际经济与贸易、经济学。分流时本专业类内专业任选。入校后可选拔进入王亚南经济学专业本科创新实验班、财政学国际化试验班、经济学/金融学+数据科学与大数据技术、税收学+法学双学士学位项目等特色培养项目。",
  },
  {
    subjectRaw: "理工",
    majorName: "工商管理类(含双学士学位项目选拔)",
    futurePlanCount2026: 1,
    scores: { 2025: { maxScore: 642, minScore: 642 }, 2024: { maxScore: 444, minScore: 444 } },
    remark: "含人力资源管理、工商管理、市场营销(含数智营销方向)、旅游管理。分流时本专业类内专业任选。入校后可选拔进入工商管理/市场营销/旅游管理+人工智能双学士学位项目。",
  },
  {
    subjectRaw: "理工",
    majorName: "工科试验班(航空航天与智能制造，含双学士学位项目选拔)",
    futurePlanCount2026: 1,
    scores: { 2025: { maxScore: 645, minScore: 642 }, 2024: { maxScore: 623, minScore: 607 } },
    remark: "含机械设计制造及其自动化、测控技术与仪器、自动化、飞行器设计与工程、飞行器动力工程。分流时本专业类内专业任选。入校后可选拔进入飞行器设计与工程+海洋技术双学士学位项目。",
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-school-admission-2026-guide-v3163-xmu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-school-admission-2026-guide-v3163-xmu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Xiamen University official 2026 Xizang application guide historical filing/admission scores.",
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
    title: firstText(html, [
      /<meta\s+name=["']pageTitle["']\s+content=["']([\s\S]*?)["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /<div[^>]+class=["']title["'][^>]*>([\s\S]*?)<\/div>/i,
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
          "user-agent": "Mozilla/5.0 gaokao-xizang-xmu-v3163-importer/1.0",
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
    "Mozilla/5.0 gaokao-xizang-xmu-v3163-importer/1.0",
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
  const file = path.join(rawDir, "xmu-xizang-2026-guide.html");
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
    nationalSchoolCode: SOURCE.nationalSchoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-application-guide-score",
    sourceUrl: SOURCE.url,
  };
}

function schoolOfficialCautions(extra = []) {
  return [
    "本记录来自厦门大学招生网官方西藏考生报考指南，是单校分省历史出档/录取分数边界，不是西藏自治区教育考试院全量投档/录取分数表。",
    "学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得清除西藏省级全量正式分数表缺口。",
    "源页未公开最低位次；不得生成假位次或单独输出录取概率。",
    ...extra,
  ];
}

function buildFilingRecords() {
  const records = [];
  for (const row of FILING_ROWS) {
    for (const [yearText, minScore] of Object.entries(row.scores)) {
      const year = Number(yearText);
      const idBase = [year, SOURCE.schoolCode, "filing", row.category, row.subjectRaw, minScore].join("|");
      records.push({
        id: `${year}-xmu-xizang-filing-${hash(idBase, 16)}`,
        province: PROVINCE,
        year,
        subjectType: subjectType(row.subjectRaw),
        sourceSubjectRaw: row.subjectRaw,
        batch: "本科一批",
        sourceBatchRaw: "普通本科批",
        ...baseFields(),
        dataType: "institution-admission",
        majorGroup: `${row.category}|${row.subjectRaw}`,
        admissionType: row.category,
        admissionSubtype: row.category,
        formalScoreScope: "school-official-only",
        xizangCandidateCategory: row.category.replace("普通类", ""),
        minScore,
        scoreOnly: true,
        rankUnavailable: true,
        sourceMinScoreRaw: String(minScore),
        sourceScoreScale: "source-declared-filing-score",
        transcriptionMethod: "official-html-table-manual-transcription-validated",
        cautions: schoolOfficialCautions(["该行是同页明确标注普通类 A/B 类的出档线，可作厦门大学西藏普通类分科类校线边界。"]),
        rawText: `${year} / ${PROVINCE} / ${row.category} / ${row.subjectRaw} / 出档线${minScore}`,
      });
    }
  }
  return records;
}

function buildMajorRecords() {
  const records = [];
  for (const row of MAJOR_ROWS) {
    for (const [yearText, scores] of Object.entries(row.scores)) {
      const year = Number(yearText);
      const idBase = [year, SOURCE.schoolCode, "major", row.subjectRaw, row.majorName, scores.minScore, scores.maxScore].join("|");
      records.push({
        id: `${year}-xmu-xizang-major-${hash(idBase, 16)}`,
        province: PROVINCE,
        year,
        subjectType: subjectType(row.subjectRaw),
        sourceSubjectRaw: row.subjectRaw,
        batch: "本科一批",
        sourceBatchRaw: "普通本科批",
        ...baseFields(),
        dataType: "major-admission",
        majorName: row.majorName,
        admissionType: "普通类",
        formalScoreScope: "school-official-only",
        xizangCandidateCategory: "源表专业行未明示A/B类",
        futurePlanCount2026: row.futurePlanCount2026,
        minScore: scores.minScore,
        maxScore: scores.maxScore,
        scoreOnly: true,
        rankUnavailable: true,
        sourceMinScoreRaw: String(scores.minScore),
        sourceMaxScoreRaw: String(scores.maxScore),
        sourceScoreScale: "source-declared-admission-score",
        transcriptionMethod: "official-html-table-manual-transcription-validated",
        cautions: schoolOfficialCautions(["同页专业录取情况表只标注普通类、科类、专业和最高/最低分，没有在专业行逐条明示 A/B 类；使用专业最低分时必须回看同页普通类 A/B 出档线。"]),
        rawText: `${year} / ${PROVINCE} / 普通类 / ${row.subjectRaw} / ${row.majorName} / 最高分${scores.maxScore} / 最低分${scores.minScore} / 2026计划${row.futurePlanCount2026} / ${row.remark}`,
      });
    }
  }
  return records;
}

function validateHtml(html) {
  const meta = pageMeta(html);
  const plain = textFromHtml(html);
  if (!plain.includes("厦门大学2026年本科招生西藏考生报考指南") || !plain.includes("100%不调剂") || !plain.includes("各类别往年录取情况详见")) {
    throw new Error("XMU source page no longer exposes the expected Xizang guide tokens.");
  }
  for (const row of FILING_ROWS) {
    const expected = [row.category, row.subjectRaw, String(row.scores[2025]), String(row.scores[2024]), String(row.scores[2023])];
    assertSequence(plain, expected, `filing ${row.category} ${row.subjectRaw}`);
  }
  for (const row of MAJOR_ROWS) {
    const expected = [
      "普通类",
      row.subjectRaw,
      row.majorName,
      String(row.futurePlanCount2026),
      String(row.scores[2025].maxScore),
      String(row.scores[2025].minScore),
      String(row.scores[2024].maxScore),
      String(row.scores[2024].minScore),
    ];
    assertSequence(plain, expected, `major ${row.subjectRaw} ${row.majorName}`);
  }
  return meta;
}

function assertSequence(text, tokens, label) {
  let cursor = 0;
  for (const token of tokens) {
    const next = text.indexOf(token, cursor);
    if (next === -1) throw new Error(`XMU source page missing expected token sequence for ${label}: ${tokens.join(" / ")}`);
    cursor = next + token.length;
  }
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
    byYear: countBy(records, (record) => record.year),
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
    title: "厦门大学招生网：2026年本科招生西藏考生报考指南",
    publisher: SOURCE.schoolName,
    url: SOURCE.url,
    queryUrl: SOURCE.queryUrl,
    quality: SOURCE.quality,
    pageTitle: meta.title || undefined,
    usage: `抽取${SOURCE.schoolName}西藏考生报考指南中的普通类 A/B 出档线及 2025/2024 普通类专业最高分、最低分。`,
    parsedRecords: records.length,
    rawPaths: [rawPath],
    sha256: [{ path: rawPath, sha256: sha256File(htmlFile) }],
    transcriptionMethod: "official-html-table-manual-transcription-validated",
    cautions: [
      "本源为高校官方单校报考指南，不是西藏自治区教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "同页专业录取情况表未逐条明示 A/B 类，专业分数使用时必须回看同页 A/B 出档线和考生类别。",
      "源页未公开最低位次，不生成假位次或录取概率。",
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
  const records = [...buildFilingRecords(), ...buildMajorRecords()];
  const diagnostics = diagnosticsFor(records);
  if (diagnostics.totalRows !== 24 || diagnostics.schoolOfficialRows !== 24 || diagnostics.specialPathRows !== 0 || diagnostics.rankRows !== 0) {
    throw new Error(`Unexpected v3.163 XMU diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const output = {
    dataset: "official-xizang-school-admission-2026-guide-v3163-xmu-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      sourceKind: "school-official-single-university-application-guide-score",
      schools: [SOURCE.schoolName],
    },
    notes: [
      "本文件由 scripts/import-official-xizang-school-admission-2026-guide-v3163-xmu.mjs 自动生成。",
      "来源为厦门大学招生网《2026年本科招生西藏考生报考指南》HTML 正文；原始页面已保留在 raw provenance pack。",
      "普通类 A/B 出档线 12 条按 institution-admission 保存；2025/2024 普通专业最高/最低分 12 条按 major-admission 保存。",
      "专业行未逐条明示 A/B 类，使用时必须回看同页 A/B 出档线；不自动推断考生类别。",
      "学校官网单校分数只作候选边界复核，不能替代西藏考试院全量投档/录取分数表。",
      "源页未公开最低位次；所有记录均不生成假位次或录取概率。",
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
    byYear: diagnostics.byYear,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
