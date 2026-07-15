#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2025;
const PROVINCE = "西藏";
const SOURCE_ID = "official-bnu-xizang-2025-school-admission";
const SOURCE_QUALITY = "official-school-bnu-2025-xizang-admission-pdf-score-only";
const DEFAULT_OUT = "data/admissions/official-bnu-xizang-2025-school-admission-import.json";
const RAW_DIR = "data/admissions/raw/official-bnu-xizang-2025-school-admission";
const PAGE_URL = "https://admission.bnu.edu.cn/zsjhlnfs/b411741c050f4fa6a6c4e206e2053d14.html";
const PDF_URL = "https://admission.bnu.edu.cn/docs//2026-03/827734dc26e54a21a70dd46a2a27001d.pdf";
const PAGE_FILE = "bnu-2025-province-scores-page.html";
const PDF_FILE = "bnu-xizang-2025-admission-score.pdf";
const TEXT_FILE = "text/bnu-xizang-2025-admission-score-layout.txt";

const SUBJECT_MAP = {
  文史: "历史类",
  理工: "物理类",
};

const TRANSFER_LINES = [
  {
    campus: "北京校区",
    sourceSubjectRaw: "文史",
    batch: "本科一批",
    majorName: "北京校区普通类调档线",
    minScore: 593,
    rawText: "北京校区普通类文史类调档线 593 分",
  },
  {
    campus: "北京校区",
    sourceSubjectRaw: "理工",
    batch: "本科一批",
    majorName: "北京校区普通类调档线",
    minScore: 601,
    rawText: "北京校区普通类理工类调档线 601 分",
  },
];

const MAJOR_ROWS = [
  {
    campus: "北京校区",
    admissionType: "普通类",
    batch: "本科一批",
    sourceSubjectRaw: "文史",
    department: "教育学部",
    majorName: "教育学类（含教育学、教育技术学、特殊教育、学前教育）",
    planCount: 2,
    maxScore: 458,
    minScore: 445,
  },
  {
    campus: "北京校区",
    admissionType: "普通类",
    batch: "本科一批",
    sourceSubjectRaw: "文史",
    department: "文学院",
    majorName: "汉语言文学",
    planCount: 1,
    maxScore: 593,
    minScore: 593,
  },
  {
    campus: "北京校区",
    admissionType: "普通类",
    batch: "本科一批",
    sourceSubjectRaw: "理工",
    department: "生命科学学院",
    majorName: "生物科学类（含生物科学、生物技术、生态学）",
    planCount: 1,
    maxScore: 464,
    minScore: 464,
  },
  {
    campus: "北京校区",
    admissionType: "普通类",
    batch: "本科一批",
    sourceSubjectRaw: "理工",
    department: "数学科学学院",
    majorName: "数学与应用数学",
    planCount: 1,
    maxScore: 474,
    minScore: 474,
  },
  {
    campus: "北京校区",
    admissionType: "普通类",
    batch: "本科一批",
    sourceSubjectRaw: "理工",
    department: "外国语言文学学院",
    majorName: "英语",
    planCount: 2,
    maxScore: 605,
    minScore: 601,
  },
  {
    campus: "北京校区",
    admissionType: "公费师范生",
    batch: "提前录取本科一批",
    sourceSubjectRaw: "文史",
    department: "教育学部",
    majorName: "特殊教育",
    planCount: 1,
    maxScore: 453,
    minScore: 453,
  },
  {
    campus: "北京校区",
    admissionType: "公费师范生",
    batch: "提前录取本科一批",
    sourceSubjectRaw: "理工",
    department: "心理学部",
    majorName: "心理学",
    planCount: 2,
    maxScore: 502,
    minScore: 454,
  },
  {
    campus: "北京校区",
    admissionType: "国家专项计划",
    batch: "国家专项本科",
    sourceSubjectRaw: "文史",
    department: "马克思主义学院",
    majorName: "思想政治教育",
    planCount: 2,
    maxScore: 600,
    minScore: 473,
  },
  {
    campus: "北京校区",
    admissionType: "国家专项计划",
    batch: "国家专项本科",
    sourceSubjectRaw: "理工",
    department: "数学科学学院",
    majorName: "数学与应用数学",
    planCount: 2,
    maxScore: 636,
    minScore: 436,
  },
  {
    campus: "珠海校区",
    admissionType: "高校专项计划",
    batch: "高校专项本科",
    sourceSubjectRaw: "理工",
    department: "文理学院",
    majorName: "化学",
    planCount: 1,
    maxScore: 491,
    minScore: 491,
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-bnu-xizang-2025-school-admission.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-bnu-xizang-2025-school-admission.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded page/PDF/text files",
    "  --pdftotext PATH   pdftotext executable, default: pdftotext",
    "",
    "Imports Beijing Normal University's official 2025 Xizang school-level admission PDF.",
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
      /<meta\s+name=["']ArticleTitle["']\s+content=["']([^"']+)["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]),
    publishedAt: firstText(html, [
      /<meta\s+name=["']PubDate["']\s+content=["']([^"']+)["']/i,
      /发布时间：\s*([0-9-]+\s+[0-9:]+)/i,
    ]),
  };
}

async function download(url, options = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-bnu-xizang-2025-importer/1.0",
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
  if (fs.statSync(pageFile).size < 10 * 1024) throw new Error(`BNU source page is too small: ${pageFile}`);

  if (!useCache || !fs.existsSync(pdfFile)) {
    fs.writeFileSync(pdfFile, await download(PDF_URL, {
      accept: "application/pdf,*/*;q=0.8",
      referer: PAGE_URL,
    }));
  }
  const pdf = fs.readFileSync(pdfFile);
  if (pdf.length < 80 * 1024 || pdf.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw new Error(`BNU Xizang attachment is not a valid PDF or is too small: ${pdfFile}`);
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
  if (useCache && fs.existsSync(textFile) && fs.statSync(textFile).size > 2 * 1024) return;
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  run(pdftotext, ["-layout", pdfFile, textFile]);
  if (!fs.existsSync(textFile) || fs.statSync(textFile).size < 2 * 1024) {
    throw new Error(`pdftotext did not produce a usable text file: ${textFile}`);
  }
}

function validateText(text) {
  const required = [
    "北京师范大学 2025 年在西藏",
    "本科招生计划及各专业录取分数",
    "北京校区普通类文史类调档线 593 分",
    "理工类调档线 601 分",
    "教育学类",
    "汉语言文学",
    "生物科学类",
    "数学与应用数学",
    "思想政治教育",
    "高校专项本科",
  ];
  const missing = required.filter((token) => !text.includes(token));
  if (missing.length) throw new Error(`BNU PDF text is missing expected tokens: ${missing.join(", ")}`);
}

function formalScoreScopeFor(item) {
  if (/专项|公费师范|提前录取/.test(`${item.admissionType || ""}${item.batch || ""}`)) return "special-path-only";
  return "school-official-only";
}

function cautionsFor(item) {
  const cautions = [
    "本记录来自北京师范大学本科生招生网官方 PDF，是单校分省录取分/调档线，不是西藏自治区教育考试院全量投档表。",
    "学校官网单校分数可用于该校该专业候选边界复核，但不得清除西藏省级全量投档/录取分数表缺口。",
    "原表未公开最低位次，推荐层不能生成假位次或单独输出录取概率。",
    "PDF 说明 2026 年实际计划尚未确定，最终以省级招生考试机构公布信息为准。",
  ];
  if (formalScoreScopeFor(item) === "special-path-only") {
    cautions.push("公费师范生、国家专项计划和高校专项计划需要对应资格，只作特殊路径边界。");
  }
  return cautions;
}

function subjectType(raw) {
  if (!SUBJECT_MAP[raw]) throw new Error(`Unknown source subject: ${raw}`);
  return SUBJECT_MAP[raw];
}

function schoolNameForCampus(campus) {
  return campus === "珠海校区" ? "北京师范大学（珠海校区）" : "北京师范大学";
}

function buildInstitutionRecord(item) {
  const subject = subjectType(item.sourceSubjectRaw);
  const idBase = [YEAR, PROVINCE, "bnu", item.campus, item.batch, subject, item.majorName, item.minScore].join("|");
  return {
    id: `${YEAR}-bnu-xizang-transfer-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: subject,
    sourceSubjectRaw: item.sourceSubjectRaw,
    batch: item.batch,
    schoolCode: "10027",
    schoolName: schoolNameForCampus(item.campus),
    city: item.campus === "珠海校区" ? "珠海" : "北京",
    campus: item.campus,
    schoolTags: ["985", "211", "双一流", "师范"],
    dataType: "institution-admission",
    majorName: item.majorName,
    minScore: item.minScore,
    scoreOnly: true,
    rankUnavailable: true,
    admissionType: "普通类",
    formalScoreScope: "school-official-only",
    schoolOfficialScope: "single-school-admission-score",
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    cautions: cautionsFor(item),
    rawText: item.rawText,
  };
}

function buildMajorRecord(item) {
  const subject = subjectType(item.sourceSubjectRaw);
  const scope = formalScoreScopeFor(item);
  const idBase = [YEAR, PROVINCE, "bnu", item.campus, item.admissionType, item.batch, subject, item.department, item.majorName, item.minScore].join("|");
  return {
    id: `${YEAR}-bnu-xizang-major-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: subject,
    sourceSubjectRaw: item.sourceSubjectRaw,
    batch: item.batch,
    schoolCode: "10027",
    schoolName: schoolNameForCampus(item.campus),
    city: item.campus === "珠海校区" ? "珠海" : "北京",
    campus: item.campus,
    schoolTags: ["985", "211", "双一流", "师范"],
    dataType: "major-admission",
    department: item.department,
    majorName: item.majorName,
    planCount: item.planCount,
    maxScore: item.maxScore,
    minScore: item.minScore,
    scoreOnly: true,
    rankUnavailable: true,
    admissionType: item.admissionType,
    admissionSubtype: scope === "special-path-only" ? item.admissionType : undefined,
    formalScoreScope: scope,
    schoolOfficialScope: scope === "school-official-only" ? "single-school-admission-score" : undefined,
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    cautions: cautionsFor(item),
    rawText: [
      item.admissionType,
      item.batch,
      item.sourceSubjectRaw,
      item.department,
      item.majorName,
      `计划${item.planCount}`,
      `最高分${item.maxScore}`,
      `最低分${item.minScore}`,
    ].join(" / "),
  };
}

function buildDiagnostics(records) {
  const ordinarySchoolOfficial = records.filter((record) => record.formalScoreScope === "school-official-only");
  const specialPath = records.filter((record) => record.formalScoreScope === "special-path-only");
  return {
    totalRows: records.length,
    ordinarySchoolOfficialRows: ordinarySchoolOfficial.length,
    specialPathRows: specialPath.length,
    bySubject: countBy(records, (record) => record.subjectType),
    byCampus: countBy(records, (record) => record.campus),
    byDataType: countBy(records, (record) => record.dataType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
    ordinaryScoreRange: numericRange(ordinarySchoolOfficial.map((record) => Number(record.minScore))),
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
  const text = fs.readFileSync(textFile, "utf8");
  validateText(text);

  const records = [
    ...TRANSFER_LINES.map(buildInstitutionRecord),
    ...MAJOR_ROWS.map(buildMajorRecord),
  ];
  const diagnostics = buildDiagnostics(records);
  if (records.length !== 12 || diagnostics.ordinarySchoolOfficialRows !== 7 || diagnostics.specialPathRows !== 5) {
    throw new Error(`Unexpected BNU Xizang record counts: ${JSON.stringify(diagnostics)}`);
  }

  const sourceNotes = [
    {
      id: SOURCE_ID,
      title: "北京师范大学2025年在西藏本科招生计划及各专业录取分数",
      publisher: "北京师范大学本科招生办",
      sourcePageTitle: meta.title,
      publishedAt: meta.publishedAt || "2026-03-25 15:31:00",
      url: PAGE_URL,
      attachmentUrls: [PDF_URL],
      quality: SOURCE_QUALITY,
      usage: "抽取北京师范大学本科生招生网官方 PDF 中西藏 2025 年调档线和分专业录取最高/最低分，生成单校 score-only 院校/专业录取边界。",
      parsedRecords: records.length,
      ordinarySchoolOfficialRows: diagnostics.ordinarySchoolOfficialRows,
      specialPathRows: diagnostics.specialPathRows,
      rawPath: path.relative(PROJECT_ROOT, pageFile),
      pdfPath: path.relative(PROJECT_ROOT, pdfFile),
      textPath: path.relative(PROJECT_ROOT, textFile),
      pageSha256: sha256File(pageFile),
      pdfSha256: sha256File(pdfFile),
      textSha256: sha256File(textFile),
      cautions: [
        "本源为高校官方招生网单校分省录取数据，不是西藏自治区教育考试院全量投档/录取分数表。",
        "普通类单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
        "公费师范生、国家专项计划和高校专项计划按 special-path-only 隔离。",
        "原表无最低位次，不生成假位次或录取概率。",
      ],
    },
  ];

  const payload = {
    dataset: "official-bnu-xizang-2025-school-admission-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "school-official-single-university-score-only",
      school: "北京师范大学",
    },
    notes: [
      "本文件由 scripts/import-official-bnu-xizang-2025-school-admission.mjs 自动生成。",
      "来源为北京师范大学本科生招生网 2026-03-25 发布的 2025 年各省份录取分数线及招生计划情况页面及其西藏 PDF 附件。",
      "普通类单校分数只作北京师范大学西藏考生候选边界，不能替代西藏考试院全量投档/录取分数表。",
      "原表不含最低位次，不生成假位次或录取概率。",
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
    ordinarySchoolOfficialRows: diagnostics.ordinarySchoolOfficialRows,
    specialPathRows: diagnostics.specialPathRows,
    sourceId: SOURCE_ID,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
