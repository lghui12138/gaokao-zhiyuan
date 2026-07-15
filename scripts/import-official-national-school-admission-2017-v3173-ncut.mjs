#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2017-v3173-ncut-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2017-v3173-ncut";
const YEAR = 2017;

const SOURCE = {
  id: "official-ncut-national-2017-school-admission",
  quality: "official-school-ncut-2017-national-html-table-filing-score-only",
  schoolCode: "0009",
  nationalSchoolCode: "10009",
  schoolName: "北方工业大学",
  city: "北京",
  tags: ["理工"],
  url: "https://bkzs.ncut.edu.cn/info/1030/1128.htm",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2017-v3173-ncut.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2017-v3173-ncut.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports North China University of Technology official 2017 national filing score-only table.",
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
          "user-agent": "Mozilla/5.0 gaokao-national-ncut-v3173-importer/1.0",
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
    "Mozilla/5.0 gaokao-national-ncut-v3173-importer/1.0",
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
  const file = path.join(rawDir, "ncut-2017-national-admission-lines.html");
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
      subjectMappingNote: "2017年源表仍为旧文理/理工文史口径，站内将理工映射到物理类以便与新高考普通类数据层衔接。",
    };
  }
  if (sourceColumn === "文史") {
    return {
      subjectType: "历史类",
      sourceSubjectRaw: "文史",
      subjectMappingNote: "2017年源表仍为旧文理/理工文史口径，站内将文史映射到历史类以便与新高考普通类数据层衔接。",
    };
  }
  throw new Error(`Unsupported source subject ${sourceColumn}`);
}

function provinceFromLabel(label) {
  return String(label || "")
    .replace(/（.*?）/g, "")
    .replace(/\s+[12]本$/u, "")
    .trim();
}

function provinceCodeNote(label) {
  const match = String(label || "").match(/（([0-9A-Za-z]+)）/);
  return match ? `源表省份标签含招生代码/院校代码 ${match[1]}，不得与同省其他代码行自动合并。` : "";
}

function admissionSubtype(label) {
  if (/西藏.*汉族/u.test(String(label || ""))) return "普通类-汉族";
  if (/西藏.*少/u.test(String(label || ""))) return "普通类-少数民族";
  const batchMatch = String(label || "").match(/\s+([12]本)$/u);
  if (batchMatch) return `普通类-${batchMatch[1]}`;
  const note = provinceCodeNote(label);
  return note ? `普通类-${String(label).match(/（([^）]+)）/)?.[1]}` : "普通类";
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
  if (!headers.includes("省份") || !headers.includes("文史") || !headers.includes("理工") || !headers.includes("一本线") || !headers.includes("我校调档分数线")) {
    throw new Error(`Unexpected NCUT 2017 table headers: ${headers}`);
  }
  const sourceRows = grid.slice(2).map((row, index) => ({ row, sourceRowIndex: index + 3 }))
    .filter(({ row }) => row[0] && row[0] !== "省份" && !["理工", "文史"].includes(row[0]));
  const rows = [];
  for (let i = 0; i < sourceRows.length; i += 1) {
    const { row, sourceRowIndex } = sourceRows[i];
    if (row.length < 7) throw new Error(`Unexpected NCUT 2017 table row width at source index ${sourceRowIndex}: ${row.join("|")}`);
    if (row[0] === "西藏" && row[1] === "汉" && row[2] === "少") {
      const next = sourceRows[i + 1]?.row;
      if (!next || next[0] !== "西藏") throw new Error("NCUT 2017 Xizang split header is not followed by the expected score row.");
      rows.push({
        sourceRowIndex,
        sourceProvinceLabel: "西藏（汉族）",
        candidateCategory: "汉族",
        scienceControlScoreRaw: "",
        artsControlScoreRaw: next[1],
        scienceScoreRaw: "",
        artsScoreRaw: next[4],
      });
      rows.push({
        sourceRowIndex: sourceRows[i + 1].sourceRowIndex,
        sourceProvinceLabel: "西藏（少数）",
        candidateCategory: "少数民族",
        scienceControlScoreRaw: "",
        artsControlScoreRaw: next[2],
        scienceScoreRaw: "",
        artsScoreRaw: next[5],
      });
      i += 1;
      continue;
    }
    if (row[0] === "西藏") continue;
    const artsScore = numericCell(row[4]);
    const duplicateArtsScore = numericCell(row[5]);
    if (Number.isFinite(artsScore) && Number.isFinite(duplicateArtsScore) && artsScore !== duplicateArtsScore) {
      throw new Error(`Unexpected NCUT 2017 duplicate arts score mismatch at source index ${sourceRowIndex}: ${row.join("|")}`);
    }
    rows.push({
      sourceRowIndex,
      sourceProvinceLabel: row[0],
      artsControlScoreRaw: row[1],
      scienceControlScoreRaw: row[3],
      artsScoreRaw: row[4],
      scienceScoreRaw: row[6],
    });
  }
  return rows;
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
    "本记录来自北方工业大学招生网官方2017年录取分数线 HTML 表，是单校分省调档分数边界，不是省级教育考试院全量投档/录取分数表。",
    "2017源表为旧文理/理工文史口径，站内映射到物理类/历史类仅用于跨年候选检索和风险提示。",
    "学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得替代同省省级正式投档表或清除任何省级缺口。",
    "学校官网单校分数不参与 formalScoreMissingProvinces 省级全量闭合统计。",
    "源表未公开最低位次；不得生成假位次或单独输出录取概率。",
  ];
  const codeNote = provinceCodeNote(row.sourceProvinceLabel);
  if (codeNote) cautions.push(codeNote);
  if (row.sourceProvinceLabel.startsWith("西藏")) {
    cautions.push("西藏源表按汉族/少数民族分列，仅公开文史调档分数，必须保留考生类别，不得与西藏 A/B 类或省级投档表自动合并。");
  }
  if (/^北京\s+[12]本$/u.test(row.sourceProvinceLabel)) {
    cautions.push("北京源表按 1本/2本分列，已保留 sourceProvinceLabel 和 admissionSubtype，不自动合并为单一北京行。");
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
      { sourceColumn: "理工", scoreRaw: row.scienceScoreRaw, controlRaw: row.scienceControlScoreRaw },
      { sourceColumn: "文史", scoreRaw: row.artsScoreRaw, controlRaw: row.artsControlScoreRaw },
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
        sourceBatchRaw: "一本线/我校调档分数线",
        ...baseFields(),
        dataType: "institution-admission",
        majorGroup: `${SOURCE.schoolName}${YEAR}校线|${row.sourceProvinceLabel}|${meta.sourceSubjectRaw}`,
        admissionType: "普通类",
        admissionSubtype: admissionSubtype(row.sourceProvinceLabel),
        formalScoreScope: "school-official-only",
        ...(row.candidateCategory ? { xizangCandidateCategory: row.candidateCategory } : {}),
        minScore,
        scoreOnly: true,
        rankUnavailable: true,
        sourceControlScore: numericCell(candidate.controlRaw),
        sourceScienceControlScore: numericCell(row.scienceControlScoreRaw),
        sourceArtsControlScore: numericCell(row.artsControlScoreRaw),
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
          `一本线理工${numericCell(row.scienceControlScoreRaw) ?? "/"}`,
          `一本线文史${numericCell(row.artsControlScoreRaw) ?? "/"}`,
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
  if (!plain.includes("2017年录取分数线") || !plain.includes("我校调档分数线") || !plain.includes("一本线")) {
    throw new Error("NCUT source page no longer exposes the expected 2017 admission line table tokens.");
  }
  const publishedAt = meta.publishedAt.replace(/[年月]/g, "-").replace(/日/g, "");
  if (publishedAt && publishedAt !== "2017-12-18") {
    throw new Error(`Unexpected NCUT 2017 publishedAt ${meta.publishedAt}`);
  }
  const rows = rowsFromGrid(tableGridFromHtml(html));
  if (rows.length !== 29 || rows.filter((row) => row.sourceProvinceLabel.startsWith("西藏")).length !== 2) {
    throw new Error(`Unexpected NCUT 2017 parsed source row count: ${rows.length}`);
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
    title: "北方工业大学招生网：2017年录取分数线",
    publisher: SOURCE.schoolName,
    publishedAt: meta.publishedAt || "2017-12-18",
    url: SOURCE.url,
    quality: SOURCE.quality,
    usage: `抽取${SOURCE.schoolName}招生网2017年录取分数线表中的全国分省旧文理调档分数。`,
    parsedRecords: records.length,
    rawPaths: [rawPath],
    sha256: [{ path: rawPath, sha256: sha256File(htmlFile) }],
    transcriptionMethod: "official-html-table-legacy-arts-science-score-only-parser",
    cautions: [
      "本源为高校官方单校录取分数表，不是各省教育考试院全量投档/录取分数表。",
      "2017源表为旧文理/理工文史口径，站内映射到物理类/历史类仅用于跨年候选检索和风险提示。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "使用单校校线 majorGroup 前缀保存，避免覆盖同省省级正式投档表。",
      "源表未公开最低位次，不生成假位次或录取概率。",
      "北京两行源表按 1本/2本分列，保留 sourceProvinceLabel 和 admissionSubtype，不自动合并。",
      "西藏汉族、少数民族两条必须分开使用；源表未提供西藏理工调档线或最低位次。",
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
  if (diagnostics.totalRows !== 40 || diagnostics.schoolOfficialRows !== 40 || diagnostics.specialPathRows !== 0 || diagnostics.rankRows !== 0 || diagnostics.scoreOnlyRows !== 40) {
    throw new Error(`Unexpected v3.173 NCUT national diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const output = {
    dataset: "official-national-school-admission-2017-v3173-ncut-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: "全国",
      sourceKind: "school-official-single-university-national-html-table-legacy-arts-science-score-only",
      schools: [SOURCE.schoolName],
    },
    notes: [
      "本文件由 scripts/import-official-national-school-admission-2017-v3173-ncut.mjs 自动生成。",
      "来源为北方工业大学招生网《2017年录取分数线》HTML 表；原始页面已保留在 raw provenance pack。",
      "本文件导入 2017 年全国分省旧文理调档分数；源表无最低位次，全部为 score-only。",
      "2017源表为旧文理/理工文史口径，站内映射到物理类/历史类仅用于跨年候选检索和风险提示。",
      "学校官网单校分数只作候选边界复核，不能替代各省考试院全量投档/录取分数表。",
      "使用单校校线 majorGroup 前缀保存，避免覆盖同省省级正式投档表。",
      "北京两行源表按 1本/2本分列，保留 sourceProvinceLabel 和 admissionSubtype，不自动合并。",
      "西藏汉族、少数民族两条必须分开使用；源表未提供西藏理工调档线或最低位次。",
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
