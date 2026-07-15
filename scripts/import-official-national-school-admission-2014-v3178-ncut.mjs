#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2014-v3178-ncut-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2014-v3178-ncut";
const YEAR = 2014;

const SOURCE = {
  id: "official-ncut-national-2014-school-admission",
  quality: "official-school-ncut-2014-national-html-table-filing-score-only",
  schoolCode: "0009",
  nationalSchoolCode: "10009",
  schoolName: "北方工业大学",
  city: "北京",
  tags: ["理工"],
  url: "https://bkzs.ncut.edu.cn/info/1030/1129.htm",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2014-v3178-ncut.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2014-v3178-ncut.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports North China University of Technology official 2014 national filing score-only table.",
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
    .replace(/[\u200b\ufeff]/g, "")
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
          "user-agent": "Mozilla/5.0 gaokao-national-ncut-v3178-importer/1.0",
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
    "Mozilla/5.0 gaokao-national-ncut-v3178-importer/1.0",
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
  const file = path.join(rawDir, "ncut-2014-national-admission-lines.html");
  if (!useCache || !fs.existsSync(file)) {
    fs.writeFileSync(file, await download(SOURCE.url));
  }
  return file;
}

function numericCell(value) {
  const match = String(value || "").replace(/[\u200b\ufeff]/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeTight(value) {
  return String(value || "")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim();
}

function sourceSubjectMeta(sourceColumn) {
  if (sourceColumn === "理工") {
    return {
      subjectType: "物理类",
      sourceSubjectRaw: "理工",
      subjectMappingNote: "2014年源表仍为旧文理/理工文史口径，站内将理工映射到物理类以便与新高考普通类数据层衔接。",
    };
  }
  if (sourceColumn === "文史") {
    return {
      subjectType: "历史类",
      sourceSubjectRaw: "文史",
      subjectMappingNote: "2014年源表仍为旧文理/理工文史口径，站内将文史映射到历史类以便与新高考普通类数据层衔接。",
    };
  }
  throw new Error(`Unsupported source subject ${sourceColumn}`);
}

function provinceFromLabel(label) {
  const province = String(label || "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+[12]本$/u, "")
    .trim();
  return province === "内蒙" ? "内蒙古" : province;
}

function parentheticalTag(label) {
  return (String(label || "").match(/[（(]\s*([^）)]+?)\s*[）)]/)?.[1] || "").replace(/\s+/g, "");
}

function provinceCodeNote(label) {
  const tag = parentheticalTag(label);
  if (!tag || ["一批", "二批", "一本", "二本"].includes(tag)) return "";
  return `源表省份标签含招生代码/院校代码 ${tag}，不得与同省其他代码行自动合并。`;
}

function admissionSubtype(label) {
  const batchMatch = String(label || "").match(/\s+([12]本)$/u);
  if (batchMatch) return `普通类-${batchMatch[1]}`;
  const tag = parentheticalTag(label);
  if (["一批", "二批", "一本", "二本"].includes(tag)) return `普通类-${tag}`;
  const note = provinceCodeNote(label);
  return note ? `普通类-${tag}` : "普通类";
}

function tableGridFromHtml(html) {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw new Error("NCUT source page has no HTML table.");
  const grid = [];
  const spans = [];
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  for (let r = 0; r < rows.length; r += 1) {
    grid[r] = [];
    for (const span of spans) {
      if (span.until > r) grid[r][span.col] = span.text;
    }
    const cells = [...rows[r].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)];
    let c = 0;
    for (const match of cells) {
      while (grid[r][c] !== undefined) c += 1;
      const attrs = match[1];
      const cellText = textFromHtml(match[2]);
      const rowspan = Number((attrs.match(/rowspan=["']?(\d+)/i) || [])[1] || 1);
      const colspan = Number((attrs.match(/colspan=["']?(\d+)/i) || [])[1] || 1);
      for (let offset = 0; offset < colspan; offset += 1) {
        grid[r][c + offset] = cellText;
        if (rowspan > 1) spans.push({ col: c + offset, until: r + rowspan, text: cellText });
      }
      c += colspan;
    }
  }
  return grid;
}

function rowsFromGrid(grid) {
  const headers = grid.slice(0, 3).map((row) => row.join("|")).join("\n");
  if (!headers.includes("重点本科控制分数线") || !headers.includes("一般本科控制分数线") || !headers.includes("我校调档分数线") || !headers.includes("理工") || !headers.includes("文史")) {
    throw new Error(`Unexpected NCUT 2014 table headers: ${headers}`);
  }
  return grid.slice(3).map((row, index) => {
    if (!row[0] || row[0] === "省份" || ["理工", "文史"].includes(row[0])) return null;
    if (row.length < 7) throw new Error(`Unexpected NCUT 2014 table row width at source index ${index + 4}: ${row.join("|")}`);
    return {
      sourceRowIndex: index + 4,
      sourceProvinceLabel: row[0],
      scienceKeyControlScoreRaw: row[1],
      artsKeyControlScoreRaw: row[2],
      scienceGeneralControlScoreRaw: row[3],
      artsGeneralControlScoreRaw: row[4],
      scienceScoreRaw: row[5],
      artsScoreRaw: row[6],
    };
  }).filter(Boolean);
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
    schoolOfficialScope: "single-school-national-filing-score",
    sourceUrl: SOURCE.url,
  };
}

function cautionsFor(row, meta) {
  const cautions = [
    "本记录来自北方工业大学招生网官方2014年录取分数线 HTML 表，是单校分省调档分数边界，不是省级教育考试院全量投档/录取分数表。",
    "2014源表为旧文理/理工文史口径，站内映射到物理类/历史类仅用于跨年候选检索和风险提示。",
    "学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得替代同省省级正式投档表或清除任何省级缺口。",
    "学校官网单校分数不参与 formalScoreMissingProvinces 省级全量闭合统计。",
    "源表未公开最低位次；不得生成假位次或单独输出录取概率。",
  ];
  const codeNote = provinceCodeNote(row.sourceProvinceLabel);
  if (codeNote) cautions.push(codeNote);
  if (["一批", "二批"].includes(parentheticalTag(row.sourceProvinceLabel)) || /\s+[12]本$/u.test(row.sourceProvinceLabel)) {
    cautions.push("北京、天津源表按 1本/2本 或一批/二批分列，已保留 sourceProvinceLabel 和 admissionSubtype，不自动合并为单一省份行。");
  }
  if (row.sourceProvinceLabel === "内蒙") {
    cautions.push("源表省份标签为内蒙，运行层归一为内蒙古，并保留 sourceProvinceLabel=内蒙 供审计回查。");
  }
  if (meta.sourceSubjectRaw === "理工") {
    cautions.push("源表理工列已保留 sourceSubjectRaw=理工；物理类映射不是新高考选科等价证明。");
  }
  if (meta.sourceSubjectRaw === "文史") {
    cautions.push("源表文史列已保留 sourceSubjectRaw=文史；历史类映射不是新高考选科等价证明。");
  }
  return cautions;
}

function buildRecordsFromRows(rows) {
  const records = [];
  for (const row of rows) {
    const candidates = [
      { sourceColumn: "理工", scoreRaw: row.scienceScoreRaw, keyControlRaw: row.scienceKeyControlScoreRaw, generalControlRaw: row.scienceGeneralControlScoreRaw },
      { sourceColumn: "文史", scoreRaw: row.artsScoreRaw, keyControlRaw: row.artsKeyControlScoreRaw, generalControlRaw: row.artsGeneralControlScoreRaw },
    ];
    for (const candidate of candidates) {
      const minScore = numericCell(candidate.scoreRaw);
      if (!Number.isFinite(minScore)) continue;
      const meta = sourceSubjectMeta(candidate.sourceColumn);
      const province = provinceFromLabel(row.sourceProvinceLabel);
      const idBase = [YEAR, SOURCE.schoolCode, row.sourceProvinceLabel, candidate.sourceColumn, minScore].join("|");
      const record = {
        id: `${YEAR}-ncut-national-school-${hash(idBase, 18)}`,
        province,
        year: YEAR,
        subjectType: meta.subjectType,
        sourceSubjectRaw: meta.sourceSubjectRaw,
        subjectMappingNote: meta.subjectMappingNote,
        batch: "本科批",
        sourceBatchRaw: "重点本科控制分数线/一般本科控制分数线/我校调档分数线",
        ...baseFields(),
        dataType: "institution-admission",
        majorGroup: `${SOURCE.schoolName}${YEAR}校线|${row.sourceProvinceLabel}|${meta.sourceSubjectRaw}`,
        admissionType: "普通类",
        admissionSubtype: admissionSubtype(row.sourceProvinceLabel),
        formalScoreScope: "school-official-only",
        minScore,
        scoreOnly: true,
        rankUnavailable: true,
        sourceControlScore: numericCell(candidate.keyControlRaw),
        sourceGeneralControlScore: numericCell(candidate.generalControlRaw),
        sourceScienceControlScore: numericCell(row.scienceKeyControlScoreRaw),
        sourceArtsControlScore: numericCell(row.artsKeyControlScoreRaw),
        sourceScienceGeneralControlScore: numericCell(row.scienceGeneralControlScoreRaw),
        sourceArtsGeneralControlScore: numericCell(row.artsGeneralControlScoreRaw),
        sourceMinScoreRaw: normalizeTight(candidate.scoreRaw),
        sourceRankRaw: "/",
        sourceScoreCellRaw: String(candidate.scoreRaw || "").trim(),
        sourceProvinceLabel: row.sourceProvinceLabel,
        sourceScoreScale: "source-declared-filing-score",
        transcriptionMethod: "official-html-table-legacy-arts-science-score-only-parser",
        cautions: cautionsFor(row, meta),
        rawText: [
          String(YEAR),
          row.sourceProvinceLabel,
          `重点本科控制线理工${numericCell(row.scienceKeyControlScoreRaw) ?? "/"}`,
          `重点本科控制线文史${numericCell(row.artsKeyControlScoreRaw) ?? "/"}`,
          `一般本科控制线理工${numericCell(row.scienceGeneralControlScoreRaw) ?? "/"}`,
          `一般本科控制线文史${numericCell(row.artsGeneralControlScoreRaw) ?? "/"}`,
          candidate.sourceColumn,
          `调档分${minScore}`,
          "位次/",
        ].join(" / "),
      };
      records.push(record);
    }
  }
  return records;
}

function validateHtml(html) {
  const meta = pageMeta(html);
  const plain = textFromHtml(html);
  if (!plain.includes("2014年录取分数线") || !plain.includes("重点本科控制分数线") || !plain.includes("一般本科控制分数线") || !plain.includes("我校调档分数线")) {
    throw new Error("NCUT source page no longer exposes the expected 2014 admission line table tokens.");
  }
  const publishedAt = meta.publishedAt.replace(/[年月]/g, "-").replace(/日/g, "");
  if (publishedAt && publishedAt !== "2015-06-05") {
    throw new Error(`Unexpected NCUT 2014 publishedAt ${meta.publishedAt}`);
  }
  const rows = rowsFromGrid(tableGridFromHtml(html));
  if (rows.length !== 27 || rows.some((row) => row.sourceProvinceLabel === "西藏")) {
    throw new Error(`Unexpected NCUT 2014 parsed source row count: ${rows.length}`);
  }
  return { meta, rows };
}

function diagnosticsFor(records) {
  return {
    totalRows: records.length,
    schoolOfficialRows: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRows: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    rankRows: records.filter((record) => Number.isFinite(record.minRankEnd)).length,
    scoreOnlyRows: records.filter((record) => record.rankUnavailable).length,
    bySourceId: countBy(records, (record) => record.sourceId),
    bySchool: countBy(records, (record) => record.schoolName),
    byProvince: countBy(records, (record) => record.province),
    byDataType: countBy(records, (record) => record.dataType),
    bySubject: countBy(records, (record) => record.subjectType),
    byRawSubject: countBy(records, (record) => record.sourceSubjectRaw),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
    rankRange: null,
  };
}

function sourceNoteFor(records, htmlFile, meta) {
  const rawPath = path.relative(PROJECT_ROOT, htmlFile);
  return {
    id: SOURCE.id,
    title: "北方工业大学招生网：2014年录取分数线",
    publisher: SOURCE.schoolName,
    publishedAt: meta.publishedAt || "2015-06-05",
    url: SOURCE.url,
    quality: SOURCE.quality,
    usage: `抽取${SOURCE.schoolName}招生网2014年录取分数线表中的全国分省旧文理调档分数。`,
    parsedRecords: records.length,
    rawPaths: [rawPath],
    sha256: [{ path: rawPath, sha256: sha256File(htmlFile) }],
    transcriptionMethod: "official-html-table-legacy-arts-science-score-only-parser",
    cautions: [
      "本源为高校官方单校录取分数表，不是各省教育考试院全量投档/录取分数表。",
      "2014源表为旧文理/理工文史口径，站内映射到物理类/历史类仅用于跨年候选检索和风险提示。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "使用单校校线 majorGroup 前缀保存，避免覆盖同省省级正式投档表。",
      "源表未公开最低位次，不生成假位次或录取概率。",
      "北京、天津源表按 1本/2本 分列，保留 sourceProvinceLabel 和 admissionSubtype，不自动合并。",
      "源表省份标签“内蒙”在运行层归一为内蒙古，并保留 sourceProvinceLabel=内蒙 供审计回查。",
      "本导入仅做不可见字符清理，不补造源表不存在的行。",
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
  const { meta, rows } = validateHtml(html);
  const records = buildRecordsFromRows(rows);
  const diagnostics = diagnosticsFor(records);
  if (diagnostics.totalRows !== 42 || diagnostics.schoolOfficialRows !== 42 || diagnostics.specialPathRows !== 0 || diagnostics.rankRows !== 0 || diagnostics.scoreOnlyRows !== 42) {
    throw new Error(`Unexpected v3.178 NCUT national diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const output = {
    dataset: "official-national-school-admission-2014-v3178-ncut-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: "全国",
      sourceKind: "school-official-single-university-national-html-table-legacy-arts-science-score-only",
      schools: [SOURCE.schoolName],
    },
    notes: [
      "本文件由 scripts/import-official-national-school-admission-2014-v3178-ncut.mjs 自动生成。",
      "来源为北方工业大学招生网《2014年录取分数线》HTML 表；原始页面已保留在 raw provenance pack。",
      "本文件导入 2014 年全国分省旧文理调档分数；源表无最低位次，全部为 score-only。",
      "2014源表为旧文理/理工文史口径，站内映射到物理类/历史类仅用于跨年候选检索和风险提示。",
      "学校官网单校分数只作候选边界复核，不能替代各省考试院全量投档/录取分数表。",
      "使用单校校线 majorGroup 前缀保存，避免覆盖同省省级正式投档表。",
      "北京、天津源表按 1本/2本 分列，保留 sourceProvinceLabel 和 admissionSubtype，不自动合并。",
      "源表省份标签“内蒙”在运行层归一为内蒙古，并保留 sourceProvinceLabel=内蒙 供审计回查。",
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
    rankRows: diagnostics.rankRows,
    scoreOnlyRows: diagnostics.scoreOnlyRows,
    provinces: Object.keys(diagnostics.byProvince).length,
    scoreRange: diagnostics.scoreRange,
    rankRange: diagnostics.rankRange,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
