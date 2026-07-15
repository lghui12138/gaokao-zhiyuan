#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2025;
const PROVINCE = "西藏";
const SOURCE_ID = "official-mnnu-xizang-2025-school-admission";
const SOURCE_QUALITY = "official-school-mnnu-2025-xizang-admission-html-score-only";
const PAGE_URL = "https://zsb.mnnu.edu.cn/info/1005/3791.htm";
const DEFAULT_OUT = "data/admissions/official-mnnu-xizang-2025-school-admission-import.json";
const RAW_DIR = "data/admissions/raw/official-mnnu-xizang-2025-school-admission";
const PAGE_FILE = "mnnu-xizang-2025-admission-score-page.html";

const SUBJECT_MAP = {
  "文史类": "历史类",
  "理工类": "物理类",
};

const HEADERS = ["年份", "省份", "批次", "科类", "专业", "录取数", "最高分", "平均分", "最低分", "特殊类型控制线", "本科控制线"];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-mnnu-xizang-2025-school-admission.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-mnnu-xizang-2025-school-admission.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded page file",
    "",
    "Imports Min Nan Normal University's official 2025 Xizang school-level admission page.",
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
    title: firstText(html, [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]),
    publishedAt: firstText(html, [/时间\s*([0-9]{4}年[0-9]{2}月[0-9]{2}日\s*[0-9:]+)/i]),
  };
}

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-mnnu-xizang-2025-importer/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureRawFiles(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const pageFile = path.join(rawDir, PAGE_FILE);
  if (!useCache || !fs.existsSync(pageFile)) {
    fs.writeFileSync(pageFile, await download(PAGE_URL));
  }
  const html = fs.readFileSync(pageFile, "utf8");
  if (html.length < 8 * 1024 || !html.includes("2025年面向西藏录取分数参考") || !html.includes("西藏自治区")) {
    throw new Error(`MNNU source page is missing expected Xizang score table tokens: ${pageFile}`);
  }
  return { pageFile };
}

function parseAdmissionTable(html) {
  const tables = [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const table = tables.find((item) => item.includes("特殊类型控制线") && item.includes("西藏自治区"));
  if (!table) throw new Error("Could not locate MNNU Xizang admission table");
  const rows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map((match) => [...match[0].matchAll(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi)].map((cell) => textFromHtml(cell[0])))
    .filter((cells) => cells.length > 0);
  const header = rows[0] || [];
  if (HEADERS.some((item, index) => header[index] !== item)) {
    throw new Error(`Unexpected MNNU table header: ${JSON.stringify(header)}`);
  }
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== HEADERS.length) {
      throw new Error(`Unexpected MNNU row width at ${index + 1}: ${JSON.stringify(cells)}`);
    }
    return Object.fromEntries(HEADERS.map((key, i) => [key, cells[i]]));
  });
}

function numberValue(value, label) {
  const normalized = String(value).replace(/[^\d.-]/g, "");
  const number = normalized ? Number(normalized) : NaN;
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric value for ${label}: ${value}`);
  return number;
}

function integerValue(value, label) {
  const number = numberValue(value, label);
  if (!Number.isInteger(number)) throw new Error(`Expected integer for ${label}: ${value}`);
  return number;
}

function subjectType(raw) {
  if (!SUBJECT_MAP[raw]) throw new Error(`Unknown MNNU subject: ${raw}`);
  return SUBJECT_MAP[raw];
}

function cautionsFor(row) {
  const cautions = [
    "本记录来自闽南师范大学本科招生网官方页面，是单校分省分专业录取分数参考，不是西藏自治区教育考试院全量投档/录取分数表。",
    "学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校该专业候选边界复核，但不得清除西藏省级全量正式分数表缺口。",
    "原表未公开最低位次，推荐层不能生成假位次或单独输出录取概率。",
  ];
  if (String(row["批次"]).includes("区内")) {
    cautions.push("源表区分本科二批与本科二批（区内）控制线，区内口径需按考生对应资格/控制线单独复核。");
  }
  return cautions;
}

function buildRecord(row) {
  const subject = subjectType(row["科类"]);
  const idBase = [YEAR, PROVINCE, "mnnu", row["批次"], subject, row["专业"], row["最低分"]].join("|");
  return {
    id: `${YEAR}-mnnu-xizang-major-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: integerValue(row["年份"], "年份"),
    subjectType: subject,
    sourceSubjectRaw: row["科类"],
    batch: row["批次"],
    schoolCode: "10402",
    schoolName: "闽南师范大学",
    city: "漳州",
    schoolTags: ["师范"],
    dataType: "major-admission",
    majorName: row["专业"],
    admissionCount: integerValue(row["录取数"], "录取数"),
    maxScore: numberValue(row["最高分"], "最高分"),
    avgScore: numberValue(row["平均分"], "平均分"),
    minScore: numberValue(row["最低分"], "最低分"),
    specialTypeControlLine: integerValue(row["特殊类型控制线"], "特殊类型控制线"),
    undergraduateControlLine: integerValue(row["本科控制线"], "本科控制线"),
    scoreOnly: true,
    rankUnavailable: true,
    admissionType: "普通类",
    admissionSubtype: String(row["批次"]).includes("区内") ? "区内" : undefined,
    formalScoreScope: "school-official-only",
    schoolOfficialScope: "single-school-admission-score",
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    cautions: cautionsFor(row),
    rawText: HEADERS.map((key) => `${key}:${row[key]}`).join(" / "),
  };
}

function buildDiagnostics(records) {
  return {
    totalRows: records.length,
    ordinarySchoolOfficialRows: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRows: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    districtInnerRows: records.filter((record) => record.admissionSubtype === "区内").length,
    bySubject: countBy(records, (record) => record.subjectType),
    byBatch: countBy(records, (record) => record.batch),
    byDataType: countBy(records, (record) => record.dataType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const rawDir = path.resolve(PROJECT_ROOT, RAW_DIR);
  const { pageFile } = await ensureRawFiles(rawDir, args.useCache);
  const html = fs.readFileSync(pageFile, "utf8");
  const meta = pageMeta(html);
  const rows = parseAdmissionTable(html);
  const records = rows.map(buildRecord);
  const diagnostics = buildDiagnostics(records);
  if (records.length !== 16 || diagnostics.ordinarySchoolOfficialRows !== 16 || diagnostics.districtInnerRows !== 9) {
    throw new Error(`Unexpected MNNU Xizang record counts: ${JSON.stringify(diagnostics)}`);
  }

  const sourceNotes = [
    {
      id: SOURCE_ID,
      title: "闽南师范大学2025年面向西藏录取分数参考",
      publisher: "闽南师范大学招生就业工作处",
      sourcePageTitle: meta.title || "2025年面向西藏录取分数参考",
      publishedAt: meta.publishedAt || "2026年01月30日 21:03",
      url: PAGE_URL,
      quality: SOURCE_QUALITY,
      usage: "抽取闽南师范大学本科招生网官方 HTML 表中 2025 年西藏本科二批/本科二批（区内）分专业最高分、平均分、最低分和控制线，生成单校 score-only 专业录取边界。",
      parsedRecords: records.length,
      ordinarySchoolOfficialRows: diagnostics.ordinarySchoolOfficialRows,
      rawPath: path.relative(PROJECT_ROOT, pageFile),
      pageSha256: sha256File(pageFile),
      cautions: [
        "本源为高校官方招生网单校分专业录取分数参考，不是西藏自治区教育考试院全量投档/录取分数表。",
        "全部记录按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
        "源表含本科二批（区内）口径，需按考生对应资格和控制线复核。",
        "原表无最低位次，不生成假位次或录取概率。",
      ],
    },
  ];

  const payload = {
    dataset: "official-mnnu-xizang-2025-school-admission-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "school-official-single-university-score-only",
      school: "闽南师范大学",
    },
    notes: [
      "本文件由 scripts/import-official-mnnu-xizang-2025-school-admission.mjs 自动生成。",
      "来源为闽南师范大学本科招生网官方 2025 年面向西藏录取分数参考页面。",
      "学校官网单校分数只作该校西藏考生候选边界，不能替代西藏考试院全量投档/录取分数表。",
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
    districtInnerRows: diagnostics.districtInnerRows,
    sourceId: SOURCE_ID,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
