#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-school-admission-2025-v3157-batch-import.json";
const RAW_DIR = "data/admissions/raw/official-xizang-school-admission-2025-v3157-batch";
const PROVINCE = "西藏";

const SOURCES = {
  szu: {
    id: "official-szu-xizang-school-admission-2023-2025",
    quality: "official-school-szu-xizang-2023-2025-admission-html-score-only",
    url: "https://zs.szu.edu.cn/info/1153/2962.htm",
    rawFile: "szu/szu-xizang-school-admission-page.html",
    schoolCode: "10590",
    schoolName: "深圳大学",
    city: "深圳",
    tags: ["双一流", "综合"],
  },
  fjut: {
    id: "official-fjut-xizang-2025-school-admission",
    quality: "official-school-fjut-2025-xizang-admission-html-score-only",
    url: "https://join.fjut.edu.cn/2026/0305/c10952a264595/page.htm",
    rawFile: "fjut/fjut-xizang-2025-admission-page.html",
    schoolCode: "10388",
    schoolName: "福建理工大学",
    city: "福州",
    tags: ["理工"],
  },
  nwpu: {
    id: "official-nwpu-xizang-2025-school-admission",
    quality: "official-school-nwpu-2025-xizang-admission-news-score-rank",
    url: "https://www.nwpu.edu.cn/info/1208/108678.htm",
    rawFile: "nwpu/nwpu-2025-admission-news.html",
    schoolCode: "10699",
    schoolName: "西北工业大学",
    city: "西安",
    tags: ["985", "211", "双一流", "工科"],
  },
};

const SUBJECT_MAP = {
  "理科": "物理类",
  "理工": "物理类",
  "理工类": "物理类",
  "文科": "历史类",
  "文史": "历史类",
  "文史类": "历史类",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-school-admission-2025-v3157-batch.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-school-admission-2025-v3157-batch.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source pages",
    "",
    "Imports a v3.157 batch of official school-level Xizang admission pages.",
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
    publishedAt: firstText(html, [/发布时间\s*[:：]?\s*([0-9]{4}[-年][0-9]{1,2}[-月][0-9]{1,2}日?(?:\s+[0-9:]+)?)/i, /时间\s*[:：]?\s*([0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日\s*[0-9:]+)/i]),
  };
}

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-xizang-school-v3157-importer/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureRawFiles(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const files = {};
  for (const [key, source] of Object.entries(SOURCES)) {
    const file = path.join(rawDir, source.rawFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!useCache || !fs.existsSync(file)) {
      fs.writeFileSync(file, await download(source.url));
    }
    const html = fs.readFileSync(file, "utf8");
    if (html.length < 10 * 1024 || !html.includes("西藏")) {
      throw new Error(`${source.id} source page is too small or missing Xizang token: ${file}`);
    }
    files[key] = file;
  }
  return files;
}

function tablesFromHtml(html) {
  return [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function rowsFromTable(table) {
  return [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map((row) => [...row[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => textFromHtml(cell[1])))
    .filter((cells) => cells.length > 0);
}

function numberValue(value, label) {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric value for ${label}: ${value}`);
  return number;
}

function integerValue(value, label) {
  const number = numberValue(value, label);
  if (!Number.isInteger(number)) throw new Error(`Expected integer for ${label}: ${value}`);
  return number;
}

function subjectType(raw) {
  if (!SUBJECT_MAP[raw]) throw new Error(`Unknown subject: ${raw}`);
  return SUBJECT_MAP[raw];
}

function schoolOfficialCautions(schoolName, extra = []) {
  return [
    `本记录来自${schoolName}官方招生/新闻页面，是单校分省录取分数边界，不是西藏自治区教育考试院全量投档/录取分数表。`,
    "学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得清除西藏省级全量正式分数表缺口。",
    "未公开最低位次的记录不得生成假位次或单独输出录取概率。",
    ...extra,
  ];
}

function baseSchoolFields(sourceKey) {
  const source = SOURCES[sourceKey];
  return {
    schoolCode: source.schoolCode,
    schoolName: source.schoolName,
    city: source.city,
    schoolTags: source.tags,
    sourceId: source.id,
    sourceQuality: source.quality,
    formalScoreScope: "school-official-only",
    schoolOfficialScope: "single-school-admission-score",
  };
}

function buildSzuRecords(html) {
  const source = SOURCES.szu;
  const tables = tablesFromHtml(html);
  const summaryTable = tables.find((table) => table.includes("理科（投档分）") && table.includes("文科（投档分）"));
  const majorTable = tables.find((table) => table.includes("2025年") && table.includes("2024年") && table.includes("专业"));
  if (!summaryTable || !majorTable) throw new Error("Could not locate Shenzhen University Xizang tables");

  const records = [];
  const controlLines = new Map();
  let currentYear;
  for (const row of rowsFromTable(summaryTable).slice(2)) {
    let year;
    let category;
    let offset;
    if (row[0] === PROVINCE) {
      year = integerValue(row[1], "SZU year");
      category = row[2];
      offset = 3;
      currentYear = year;
    } else if (/^\d{4}$/.test(row[0])) {
      year = integerValue(row[0], "SZU year");
      category = row[1];
      offset = 2;
      currentYear = year;
    } else {
      year = currentYear;
      category = row[0];
      offset = 1;
    }
    if (!Number.isInteger(year) || !/^[AB]类$/.test(category)) {
      throw new Error(`Unexpected SZU summary row: ${JSON.stringify(row)}`);
    }
    for (const item of [
      { raw: "理科", start: offset },
      { raw: "文科", start: offset + 5 },
    ]) {
      const admissionCount = integerValue(row[item.start], "SZU admission count");
      const controlLine = integerValue(row[item.start + 1], "SZU control line");
      const minScore = integerValue(row[item.start + 2], "SZU min score");
      const maxScore = integerValue(row[item.start + 3], "SZU max score");
      const avgScore = numberValue(row[item.start + 4], "SZU average score");
      const subject = subjectType(item.raw);
      controlLines.set([year, category, subject].join("|"), controlLine);
      const idBase = [year, "szu", category, subject, "summary", minScore].join("|");
      records.push({
        id: `${year}-szu-xizang-summary-${hash(idBase, 16)}`,
        province: PROVINCE,
        year,
        subjectType: subject,
        sourceSubjectRaw: item.raw,
        batch: "本科一批",
        ...baseSchoolFields("szu"),
        dataType: "institution-admission",
        majorName: `${category}${item.raw}投档分`,
        admissionType: "普通类",
        admissionSubtype: category,
        xizangCandidateCategory: category,
        admissionCount,
        controlLine,
        minScore,
        maxScore,
        avgScore,
        scoreOnly: true,
        rankUnavailable: true,
        cautions: schoolOfficialCautions(source.schoolName, ["深圳大学源表按西藏 A类/B类分别列示，需按考生类别单独复核。"]),
        rawText: row.join(" / "),
      });
    }
  }

  for (const row of rowsFromTable(majorTable).slice(2)) {
    const category = String(row[0] || "").replace(/^西藏/, "");
    const sourceSubjectRaw = row[1];
    const majorName = row[2].replace(/\s+/g, "");
    if (!/^[AB]类$/.test(category) || !majorName) throw new Error(`Unexpected SZU major row: ${JSON.stringify(row)}`);
    const subject = subjectType(sourceSubjectRaw);
    for (const yearSpec of [
      { year: 2025, start: 3 },
      { year: 2024, start: 7 },
    ]) {
      const countRaw = row[yearSpec.start];
      const minRaw = row[yearSpec.start + 3];
      if (!countRaw || !minRaw) continue;
      const admissionCount = integerValue(countRaw, `SZU ${yearSpec.year} admission count`);
      const maxScore = integerValue(row[yearSpec.start + 1], `SZU ${yearSpec.year} max score`);
      const avgScore = numberValue(row[yearSpec.start + 2], `SZU ${yearSpec.year} avg score`);
      const minScore = integerValue(minRaw, `SZU ${yearSpec.year} min score`);
      const idBase = [yearSpec.year, "szu", category, subject, majorName, minScore].join("|");
      records.push({
        id: `${yearSpec.year}-szu-xizang-major-${hash(idBase, 16)}`,
        province: PROVINCE,
        year: yearSpec.year,
        subjectType: subject,
        sourceSubjectRaw,
        batch: "本科一批",
        ...baseSchoolFields("szu"),
        dataType: "major-admission",
        majorName,
        admissionType: "普通类",
        admissionSubtype: category,
        xizangCandidateCategory: category,
        admissionCount,
        controlLine: controlLines.get([yearSpec.year, category, subject].join("|")),
        minScore,
        maxScore,
        avgScore,
        scoreOnly: true,
        rankUnavailable: true,
        cautions: schoolOfficialCautions(source.schoolName, ["深圳大学专业表按西藏 A类/B类分别列示，需按考生类别单独复核。"]),
        rawText: row.join(" / "),
      });
    }
  }

  if (records.length !== 29) throw new Error(`Unexpected SZU record count: ${records.length}`);
  return records;
}

function buildFjutRecords(html) {
  const source = SOURCES.fjut;
  const table = tablesFromHtml(html).find((item) => item.includes("生源省份") && item.includes("招生计划数"));
  if (!table) throw new Error("Could not locate FJUT Xizang admission table");
  const records = [];
  let currentPlanCategory = "普通类";
  let currentSubjectRaw = "理工";
  for (const row of rowsFromTable(table).slice(1)) {
    let majorName;
    let college;
    let planCount;
    let planCategory;
    let sourceSubjectRaw;
    let maxScore;
    let minScore;
    let avgScore;
    if (row.length === 9) {
      if (row[0] !== PROVINCE) throw new Error(`Unexpected FJUT province row: ${JSON.stringify(row)}`);
      [, majorName, college, planCount, planCategory, sourceSubjectRaw, maxScore, minScore, avgScore] = row;
    } else if (row.length === 8) {
      [majorName, college, planCount, planCategory, sourceSubjectRaw, maxScore, minScore, avgScore] = row;
    } else if (row.length === 6) {
      [majorName, college, planCount, maxScore, minScore, avgScore] = row;
      planCategory = currentPlanCategory;
      sourceSubjectRaw = currentSubjectRaw;
    } else {
      throw new Error(`Unexpected FJUT row width: ${JSON.stringify(row)}`);
    }
    currentPlanCategory = planCategory;
    currentSubjectRaw = sourceSubjectRaw;
    const subject = subjectType(sourceSubjectRaw);
    const min = integerValue(minScore, "FJUT min score");
    const idBase = [2025, "fjut", subject, majorName, min].join("|");
    records.push({
      id: `2025-fjut-xizang-major-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: 2025,
      subjectType: subject,
      sourceSubjectRaw,
      batch: "本科批",
      ...baseSchoolFields("fjut"),
      dataType: "major-admission",
      college,
      majorName,
      planCount: integerValue(planCount, "FJUT plan count"),
      admissionType: planCategory,
      minScore: min,
      maxScore: integerValue(maxScore, "FJUT max score"),
      avgScore: numberValue(avgScore, "FJUT avg score"),
      scoreOnly: true,
      rankUnavailable: true,
      cautions: schoolOfficialCautions(source.schoolName, ["福建理工大学源表未列批次字段，运行层按本科批单校分专业录取边界使用。"]),
      rawText: row.join(" / "),
    });
  }
  if (records.length !== 11) throw new Error(`Unexpected FJUT record count: ${records.length}`);
  return records;
}

function buildNwpuRecords(html) {
  const source = SOURCES.nwpu;
  const table = tablesFromHtml(html).find((item) => item.includes("最低分") && item.includes("西藏"));
  if (!table) throw new Error("Could not locate NWPU Xizang admission table");
  const row = rowsFromTable(table).find((item) => item[0] === PROVINCE);
  if (!row || row.length < 5) throw new Error(`Could not parse NWPU Xizang row: ${JSON.stringify(row)}`);
  const controlLine = integerValue(row[1], "NWPU control line");
  const minScore = integerValue(row[2], "NWPU min score");
  const minRank = integerValue(row[3], "NWPU min rank");
  const scoreDiff = integerValue(row[4], "NWPU score diff");
  const idBase = [2025, "nwpu", "xizang", "science", minScore, minRank].join("|");
  return [{
    id: `2025-nwpu-xizang-summary-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: 2025,
    subjectType: "物理类",
    sourceSubjectRaw: "理工类",
    batch: "本科一批",
    ...baseSchoolFields("nwpu"),
    dataType: "institution-admission",
    majorName: "物理类（理工类）专业录取最低分",
    admissionType: "普通类",
    controlLine,
    minScore,
    minRank,
    minRankEnd: minRank,
    scoreDiffFromControlLine: scoreDiff,
    cautions: schoolOfficialCautions(source.schoolName, ["西北工业大学新闻表只公开物理类（理工类）汇总最低分和位次，本记录不代表历史类或分专业录取结果。"]),
    rawText: row.join(" / "),
  }];
}

function diagnosticsFor(records) {
  const schoolOfficial = records.filter((record) => record.formalScoreScope === "school-official-only");
  return {
    totalRows: records.length,
    schoolOfficialRows: schoolOfficial.length,
    bySourceId: countBy(records, (record) => record.sourceId),
    bySchool: countBy(records, (record) => record.schoolName),
    byDataType: countBy(records, (record) => record.dataType),
    bySubject: countBy(records, (record) => record.subjectType),
    byYear: countBy(records, (record) => record.year),
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
    rankRows: records.filter((record) => Number.isFinite(record.minRank)).length,
  };
}

function sourceNoteFor(sourceKey, records, rawFile, html) {
  const source = SOURCES[sourceKey];
  const meta = pageMeta(html);
  return {
    id: source.id,
    title: meta.title || source.schoolName,
    publisher: source.schoolName,
    publishedAt: meta.publishedAt || undefined,
    url: source.url,
    quality: source.quality,
    usage: `抽取${source.schoolName}官方页面中西藏录取分数，生成单校 score-only${sourceKey === "nwpu" ? "/score+rank" : ""} 边界。`,
    parsedRecords: records.length,
    rawPath: path.relative(PROJECT_ROOT, rawFile),
    pageSha256: sha256File(rawFile),
    cautions: [
      "本源为高校官方单校录取数据，不是西藏自治区教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "未公开最低位次的记录不生成假位次或录取概率。",
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
  const files = await ensureRawFiles(rawDir, args.useCache);
  const html = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));
  const grouped = {
    szu: buildSzuRecords(html.szu),
    fjut: buildFjutRecords(html.fjut),
    nwpu: buildNwpuRecords(html.nwpu),
  };
  const records = Object.values(grouped).flat();
  const diagnostics = diagnosticsFor(records);
  if (records.length !== 41 || diagnostics.rankRows !== 1) {
    throw new Error(`Unexpected v3.157 Xizang school batch diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const sourceNotes = Object.entries(grouped).map(([key, items]) => sourceNoteFor(key, items, files[key], html[key]));
  const payload = {
    dataset: "official-xizang-school-admission-2025-v3157-batch-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      sourceKind: "school-official-single-university-score-batch",
      schools: Object.values(SOURCES).map((source) => source.schoolName),
    },
    notes: [
      "本文件由 scripts/import-official-xizang-school-admission-2025-v3157-batch.mjs 自动生成。",
      "来源为深圳大学、福建理工大学、西北工业大学官方招生或新闻页面。",
      "学校官网单校分数只作候选边界复核，不能替代西藏考试院全量投档/录取分数表。",
      "未公开最低位次的记录不生成假位次或录取概率；西北工业大学新闻表公开的最低位次仅用于该校物理类汇总边界。",
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
    rankRows: diagnostics.rankRows,
    bySourceId: diagnostics.bySourceId,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
