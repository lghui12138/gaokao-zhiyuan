#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2021-v3169-ncut-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2021-v3169-ncut";
const YEAR = 2021;

const SOURCE = {
  id: "official-ncut-national-2021-school-admission",
  quality: "official-school-ncut-2021-national-html-table-filing-score-rank",
  schoolCode: "0009",
  nationalSchoolCode: "10009",
  schoolName: "北方工业大学",
  city: "北京",
  tags: ["理工"],
  url: "https://bkzs.ncut.edu.cn/info/1030/1127.htm",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2021-v3169-ncut.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2021-v3169-ncut.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports North China University of Technology official 2021 national filing score/rank table.",
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
          "user-agent": "Mozilla/5.0 gaokao-national-ncut-v3169-importer/1.0",
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
    "Mozilla/5.0 gaokao-national-ncut-v3169-importer/1.0",
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
  const file = path.join(rawDir, "ncut-2021-national-admission-lines.html");
  if (!useCache || !fs.existsSync(file)) {
    fs.writeFileSync(file, await download(SOURCE.url));
  }
  return file;
}

function compactDigitSpaces(value) {
  return String(value || "").replace(/(?<=\d)\s+(?=\d)/g, "");
}

function normalizeTight(value) {
  return compactDigitSpaces(value)
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/＋/g, "+")
    .trim();
}

function numericCell(value) {
  const match = compactDigitSpaces(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function parseScoreCell(cell) {
  const raw = String(cell || "").trim();
  if (!raw || raw === "/" || raw === "//") return null;
  const normalized = normalizeTight(raw);
  let match = normalized.match(/^(\d{2,3}(?:\.\d+)?)(?:\((.*)\))?$/);
  if (match) {
    return { raw, label: match[2] || "", minScore: Number(match[1]) };
  }
  match = normalized.match(/^(.*?)(\d{2,3}(?:\.\d+)?)$/);
  if (!match) throw new Error(`Unsupported score cell: ${raw}`);
  return {
    raw,
    label: normalizeTight(match[1]).replace(/^\((.*)\)$/, "$1"),
    minScore: Number(match[2]),
  };
}

function parseRankCell(cell) {
  const raw = String(cell || "").trim();
  if (!raw || raw === "/" || raw === "//") return { raw, rank: null };
  const match = compactDigitSpaces(raw).match(/\d+/);
  return { raw, rank: match ? Number(match[0]) : null };
}

function subjectMeta(sourceColumn) {
  if (sourceColumn === "6选3") return { subjectType: "综合", dataType: "major-group-admission" };
  if (sourceColumn === "理工") return { subjectType: "物理类", dataType: "institution-admission" };
  if (sourceColumn === "文史") return { subjectType: "历史类", dataType: "institution-admission" };
  throw new Error(`Unsupported source column ${sourceColumn}`);
}

function controlScoreFor(row, subjectType) {
  if (subjectType === "综合") return numericCell(row.scienceControlScoreRaw);
  if (subjectType === "物理类") return numericCell(row.scienceControlScoreRaw);
  if (subjectType === "历史类") return numericCell(row.artsControlScoreRaw);
  return null;
}

function admissionSubtype(label) {
  if (!label) return "普通类";
  if (label.includes("中外合作办学")) return "中外合作办学";
  return label;
}

function recordMajorGroup(row, subjectType, label) {
  const groupLabel = label || subjectType;
  return `${SOURCE.schoolName}${YEAR}校线|${row.sourceProvinceLabel}|${groupLabel}`;
}

function cautionsFor(row, score, rank) {
  const cautions = [
    "本记录来自北方工业大学招生网官方2021年录取分数线 HTML 表，是单校分省调档分数/位次边界，不是省级教育考试院全量投档/录取分数表。",
    "学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得替代同省省级正式投档表或清除任何省级缺口。",
    "学校官网单校分数不参与 formalScoreMissingProvinces 省级全量闭合统计。",
  ];
  if (score.label.includes("中外合作办学")) {
    cautions.push("中外合作办学口径已按 admissionSubtype 标注，需额外核对学费、培养地点、外语要求和家庭预算红线。");
  }
  if (!rank.rank) {
    cautions.push("源表该行未公开最低位次；不得生成假位次或单独输出录取概率。");
  }
  if (row.sourceProvinceLabel.startsWith("西藏")) {
    cautions.push("西藏汉族/少数民族行必须保留考生类别，不得与其他西藏普通类/A-B 类口径自动合并。");
  }
  if (row.sourceProvinceLabel === "新疆") {
    cautions.push("新疆行源表未公开位次，且未细分普通类/单列类等自治区特殊口径，使用前必须回到新疆考试院和学校招生章程复核。");
  }
  return cautions;
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
  if (!headers.includes("省份") || !headers.includes("重点本科控制分数线") || !headers.includes("我校调档分数线") || !headers.includes("位次")) {
    throw new Error(`Unexpected NCUT table headers: ${headers}`);
  }
  return grid.slice(2).map((row, index) => {
    if (!row[0] || row[0] === "省份" || ["6选3", "理工", "文史"].includes(row[0])) return null;
    if (row.length < 9) throw new Error(`Unexpected NCUT table row width at source index ${index + 3}: ${row.join("|")}`);
    return {
      sourceRowIndex: index + 3,
      sourceProvinceLabel: row[0],
      scienceControlScoreRaw: row[1],
      artsControlScoreRaw: row[2],
      comprehensiveScoreRaw: row[3],
      comprehensiveRankRaw: row[4],
      scienceScoreRaw: row[5],
      scienceRankRaw: row[6],
      artsScoreRaw: row[7],
      artsRankRaw: row[8],
    };
  }).filter(Boolean);
}

function provinceFromLabel(label) {
  return String(label || "").replace(/（.*?）/g, "");
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

function buildRecordsFromRows(rows) {
  const records = [];
  for (const row of rows) {
    const candidates = [
      { sourceColumn: "6选3", scoreRaw: row.comprehensiveScoreRaw, rankRaw: row.comprehensiveRankRaw },
      { sourceColumn: "理工", scoreRaw: row.scienceScoreRaw, rankRaw: row.scienceRankRaw },
      { sourceColumn: "文史", scoreRaw: row.artsScoreRaw, rankRaw: row.artsRankRaw },
    ];
    for (const candidate of candidates) {
      const score = parseScoreCell(candidate.scoreRaw);
      if (!score) continue;
      const rank = parseRankCell(candidate.rankRaw);
      const meta = subjectMeta(candidate.sourceColumn);
      const province = provinceFromLabel(row.sourceProvinceLabel);
      const group = recordMajorGroup(row, meta.subjectType, score.label);
      const idBase = [YEAR, SOURCE.schoolCode, row.sourceProvinceLabel, candidate.sourceColumn, score.label, score.minScore, rank.rank || ""].join("|");
      const record = {
        id: `${YEAR}-ncut-national-school-${hash(idBase, 18)}`,
        province,
        year: YEAR,
        subjectType: meta.subjectType,
        sourceSubjectRaw: candidate.sourceColumn,
        batch: "本科批",
        sourceBatchRaw: "重点本科控制分数线/我校调档分数线",
        ...baseFields(),
        dataType: meta.dataType,
        majorGroup: group,
        admissionType: "普通类",
        admissionSubtype: admissionSubtype(score.label),
        formalScoreScope: "school-official-only",
        minScore: score.minScore,
        sourceControlScore: controlScoreFor(row, meta.subjectType),
        sourceScienceControlScore: numericCell(row.scienceControlScoreRaw),
        sourceArtsControlScore: numericCell(row.artsControlScoreRaw),
        sourceMinScoreRaw: String(score.minScore),
        sourceRankRaw: rank.raw || "/",
        sourceScoreCellRaw: score.raw,
        sourceScoreLabel: score.label || undefined,
        sourceProvinceLabel: row.sourceProvinceLabel,
        xizangCandidateCategory: row.sourceProvinceLabel.startsWith("西藏") ? row.sourceProvinceLabel.replace(/^西藏/, "").replace(/[（）]/g, "") : undefined,
        sourceScoreScale: "source-declared-filing-score",
        transcriptionMethod: "official-html-table-rowspan-parser-validated-digit-space-normalized",
        cautions: cautionsFor(row, score, rank),
        rawText: [
          String(YEAR),
          row.sourceProvinceLabel,
          `重点本科控制线理工${numericCell(row.scienceControlScoreRaw)}`,
          `重点本科控制线文史${numericCell(row.artsControlScoreRaw)}`,
          candidate.sourceColumn,
          score.raw,
          `位次${rank.raw || "/"}`,
        ].join(" / "),
      };
      if (rank.rank) {
        record.minRankStart = rank.rank;
        record.minRankEnd = rank.rank;
        record.rankRangeText = String(rank.rank);
      } else {
        record.scoreOnly = true;
        record.rankUnavailable = true;
      }
      records.push(record);
    }
  }
  return records;
}

function validateHtml(html) {
  const meta = pageMeta(html);
  const plain = textFromHtml(html);
  if (!plain.includes("2021年录取分数线") || !plain.includes("我校调档分数线") || !plain.includes("重点本科控制分数线")) {
    throw new Error("NCUT source page no longer exposes the expected 2021 admission line table tokens.");
  }
  const publishedAt = meta.publishedAt.replace(/[年月]/g, "-").replace(/日/g, "");
  if (publishedAt && publishedAt !== "2021-11-08") {
    throw new Error(`Unexpected NCUT publishedAt ${meta.publishedAt}`);
  }
  const rows = rowsFromGrid(tableGridFromHtml(html));
  if (rows.length !== 58 || rows.filter((row) => row.sourceProvinceLabel.startsWith("西藏")).length !== 2) {
    throw new Error(`Unexpected NCUT parsed source row count: ${rows.length}`);
  }
  return { meta, rows };
}

function diagnosticsFor(records) {
  const rankRows = records.filter((record) => Number.isFinite(record.minRankEnd));
  return {
    totalRows: records.length,
    schoolOfficialRows: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRows: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    rankRows: rankRows.length,
    scoreOnlyRows: records.filter((record) => record.rankUnavailable).length,
    bySourceId: countBy(records, (record) => record.sourceId),
    bySchool: countBy(records, (record) => record.schoolName),
    byProvince: countBy(records, (record) => record.province),
    byDataType: countBy(records, (record) => record.dataType),
    bySubject: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
    rankRange: numericRange(rankRows.map((record) => Number(record.minRankEnd))),
  };
}

function sourceNoteFor(records, htmlFile, meta) {
  const rawPath = path.relative(PROJECT_ROOT, htmlFile);
  return {
    id: SOURCE.id,
    title: "北方工业大学招生网：2021年录取分数线",
    publisher: SOURCE.schoolName,
    publishedAt: meta.publishedAt || "2021-11-08",
    url: SOURCE.url,
    quality: SOURCE.quality,
    usage: `抽取${SOURCE.schoolName}招生网2021年录取分数线表中的全国分省调档分数线和位次。`,
    parsedRecords: records.length,
    rawPaths: [rawPath],
    sha256: [{ path: rawPath, sha256: sha256File(htmlFile) }],
    transcriptionMethod: "official-html-table-rowspan-parser-validated-digit-space-normalized",
    cautions: [
      "本源为高校官方单校录取分数表，不是各省教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "使用单校校线 majorGroup 前缀保存，避免覆盖同省省级正式投档表。",
      "西藏汉族/少数民族两行保留 xizangCandidateCategory 字段，不得与其他西藏口径自动合并。",
      "源表部分行未公开最低位次，不生成假位次或录取概率。",
      "源表含少量小数调档分，按原表数值保留，不四舍五入为整数。",
      "源 HTML 中少量数字存在内部空格，本导入仅做数字内部空格归并，不补造源表不存在的行。",
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
  if (diagnostics.totalRows !== 67 || diagnostics.schoolOfficialRows !== 67 || diagnostics.specialPathRows !== 0 || diagnostics.rankRows !== 63 || diagnostics.scoreOnlyRows !== 4) {
    throw new Error(`Unexpected v3.169 NCUT national diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const output = {
    dataset: "official-national-school-admission-2021-v3169-ncut-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: "全国",
      sourceKind: "school-official-single-university-national-html-table-filing-score-rank",
      schools: [SOURCE.schoolName],
    },
    notes: [
      "本文件由 scripts/import-official-national-school-admission-2021-v3169-ncut.mjs 自动生成。",
      "来源为北方工业大学招生网《2021年录取分数线》HTML 表；原始页面已保留在 raw provenance pack。",
      "本文件导入 2021 年全国分省调档分数线和位次；西藏汉族/少数民族两行保留考生类别。",
      "源表含少量小数调档分，按原表数值保留，不四舍五入为整数。",
      "源 HTML 中少量数字存在内部空格，本导入仅做数字内部空格归并，不补造源表不存在的行。",
      "学校官网单校分数只作候选边界复核，不能替代各省考试院全量投档/录取分数表。",
      "使用单校校线 majorGroup 前缀保存，避免覆盖同省省级正式投档表。",
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
