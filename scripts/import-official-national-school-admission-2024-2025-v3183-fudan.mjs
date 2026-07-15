#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2024-2025-v3183-fudan-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2024-2025-v3183-fudan";
const LIST_URL = "https://ao.fudan.edu.cn/36333/list.htm";
const PAGE_URLS = new Map([
  [2025, "https://ao.fudan.edu.cn/b7/a6/c36333a767910/page.htm"],
  [2024, "https://ao.fudan.edu.cn/a4/04/c36333a697348/page.htm"],
]);
const YEARS = [...PAGE_URLS.keys()];
const SECTION_BY_TABLE = ["普通批（本一批）", "高校专项", "国家专项"];
const SOURCE = {
  id: "official-fudan-national-2024-2025-school-admission",
  quality: "official-school-fudan-2024-2025-national-html-score-only",
  schoolCode: "10246",
  schoolName: "复旦大学",
  city: "上海",
  tags: ["综合", "985", "211", "双一流"],
};
const PROVINCES = [
  "黑龙江", "内蒙古", "北京", "天津", "河北", "山西", "辽宁", "吉林", "上海", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
  "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2024-2025-v3183-fudan.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2024-2025-v3183-fudan.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Fudan University official 2024/2025 national admission score HTML table rows.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${item}\n${usage()}`);
  }
  return args;
}

function hash(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function numericRange(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function textFromHtml(html) {
  return decodeHtmlEntities(String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p\s*>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

function normalizeCell(value) {
  return textFromHtml(value)
    .replace(/[　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attrValue(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`${name}\\s*=\\s*["']?([^"'>\\s]+)`, "i"));
  return match ? match[1] : "";
}

function spanValue(attrs, name) {
  const value = Number.parseInt(attrValue(attrs, name) || "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function extractTables(html) {
  return [...String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function tableGridFromHtml(tableHtml) {
  const htmlRows = [...String(tableHtml).matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const pending = new Map();
  const grid = [];
  for (const htmlRow of htmlRows) {
    const row = [];
    let col = 0;
    const fillPending = () => {
      while (pending.has(col)) {
        const item = pending.get(col);
        row[col] = item.text;
        item.rowsLeft -= 1;
        if (item.rowsLeft <= 0) pending.delete(col);
        else pending.set(col, item);
        col += 1;
      }
    };
    const cells = [...htmlRow.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)];
    fillPending();
    for (const cell of cells) {
      fillPending();
      const attrs = cell[2] || "";
      const text = normalizeCell(cell[3]);
      const colspan = spanValue(attrs, "colspan");
      const rowspan = spanValue(attrs, "rowspan");
      for (let offset = 0; offset < colspan; offset += 1) {
        row[col + offset] = text;
        if (rowspan > 1) pending.set(col + offset, { text, rowsLeft: rowspan - 1 });
      }
      col += colspan;
    }
    fillPending();
    if (row.some((cell) => String(cell || "").trim())) grid.push(row.map((cell) => String(cell || "").trim()));
  }
  return grid;
}

async function download(url, referer = LIST_URL) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-fudan-v3183-importer/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      referer,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureRaw(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const listFile = path.join(rawDir, "fudan-score-list.html");
  if (!useCache || !fs.existsSync(listFile)) {
    fs.writeFileSync(listFile, await download(LIST_URL, "https://ao.fudan.edu.cn/"));
  }
  const pages = [];
  for (const [year, url] of PAGE_URLS) {
    const pageFile = path.join(rawDir, `fudan-${year}-admission-score.html`);
    if (!useCache || !fs.existsSync(pageFile)) {
      fs.writeFileSync(pageFile, await download(url));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    pages.push({ year, url, file: pageFile });
  }
  return { listFile, pages };
}

function parseScoreCell(value) {
  const text = normalizeCell(value).replace(/＋/g, "+");
  if (!text || text === "/" || text === "-" || text === "--") return null;
  const exact = text.match(/^(\d{2,3})$/);
  if (exact) return { minScore: Number(exact[1]), scoreLowerBound: false, sourceScoreRaw: text };
  const lower = text.match(/^(\d{2,3})\+$/);
  if (lower) {
    const minScore = Number(lower[1]);
    return {
      minScore,
      scoreLowerBound: true,
      scoreRange: { min: minScore },
      rankRangeText: text,
      sourceScoreRaw: text,
    };
  }
  throw new Error(`Unsupported Fudan score cell: ${text}`);
}

function normalizeProvince(sourceProvinceRaw) {
  const raw = normalizeCell(sourceProvinceRaw).replace(/\s+/g, "");
  if (/港澳台|港澳臺|侨|僑|联招|聯招/.test(raw)) return { skip: true, province: raw };
  let candidateCategory = "";
  const suffix = raw.match(/^(.+?)[（(](.+?)[）)]$/);
  const base = suffix ? suffix[1] : raw;
  if (suffix) candidateCategory = suffix[2];
  let province = base === "内蒙" ? "内蒙古" : base;
  const known = PROVINCES.find((item) => province.startsWith(item));
  province = known || province;
  if (!PROVINCES.includes(province)) throw new Error(`Unsupported Fudan province label: ${sourceProvinceRaw}`);
  return { province, sourceProvinceRaw: raw, candidateCategory };
}

function subjectTypeFromHeader(header) {
  const text = normalizeCell(header);
  if (/文史|历史|文科/.test(text)) return "历史类";
  if (/理工|物理|理科/.test(text)) return "物理类";
  throw new Error(`Unsupported Fudan subject header: ${header}`);
}

function formalScoreScopeFor(section, sourceProvinceRaw) {
  if (section !== "普通批（本一批）") return "special-path-only";
  return /[（(].*民.*[）)]|少数民族/.test(sourceProvinceRaw) ? "special-path-only" : "school-official-only";
}

function batchFor(section) {
  if (section === "高校专项") return "高校专项";
  if (section === "国家专项") return "国家专项本科";
  return "本科一批/普通批";
}

function admissionTypeFor(section, sourceProvinceRaw, header) {
  const parts = [];
  if (section === "高校专项") parts.push("高校专项");
  else if (section === "国家专项") parts.push("国家专项");
  else parts.push("普通录取");
  if (/医学院/.test(header)) parts.push("医学院");
  if (/护理学/.test(header)) parts.push("护理学");
  if (/[（(].*民.*[）)]|少数民族/.test(sourceProvinceRaw)) parts.push("西藏少数民族");
  return parts.join("；");
}

function columnLabel(header) {
  return normalizeCell(header)
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*（\s*/g, "（")
    .replace(/\s*）\s*/g, "）");
}

function majorNameFor(section, header) {
  const label = columnLabel(header);
  if (/医学院/.test(label)) return `复旦大学上海医学院${section}录取分数（${label}）`;
  return `复旦大学${section}录取分数（${label}）`;
}

function schoolTagsFor(header, score) {
  const tags = [...SOURCE.tags];
  if (/医学院/.test(header)) tags.push("医卫");
  if (/护理学/.test(header)) tags.push("护理");
  if (score.scoreLowerBound) tags.push("580分以上下界");
  return tags;
}

function cautionsFor(record) {
  const cautions = [
    "本记录来自复旦大学招生网官方历年录取分数 HTML 表，是单校分省分批次录取分数边界，不是省级教育考试院全量投档/录取分数表。",
    "源页说明数据仅供参考，最终以各省级招生考试机构公布为准。",
    "源表未公开最低位次；推荐层不得生成假位次或仅凭本行分数单独输出录取概率。",
    "复旦源页说明 3+3 模式省份为便于查询按文史类/理工类简化归并；本记录沿用源表列名，不改写为综合改革精确选科。",
  ];
  if (record.scoreLowerBound) {
    cautions.push(`源表只公布 ${record.sourceMinScoreRaw}，本记录按最低边界 ${record.minScore} 分入库，不把区间上限当作精确最低分。`);
  }
  if (record.formalScoreScope === "school-official-only") {
    cautions.push("普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于复旦大学候选边界复核，但不得替代同省省级正式投档表。");
  } else {
    cautions.push(`${record.admissionType}按 formalScoreScope=special-path-only 隔离，只用于对应资格入口复核，不与普通批文化分边界混用。`);
  }
  if (/医学院|护理学/.test(record.sourceSubjectRaw) || /医学院|护理学/.test(record.admissionType)) {
    cautions.push("医学院/护理学口径需单独核对院校代码、培养地点、体检限制、学费、调剂范围和当年招生章程。");
  }
  return cautions;
}

function parsePage(page, audit) {
  const html = fs.readFileSync(page.file, "utf8");
  const tables = extractTables(html);
  if (tables.length < SECTION_BY_TABLE.length) {
    throw new Error(`Expected at least ${SECTION_BY_TABLE.length} Fudan tables for ${page.year}, got ${tables.length}`);
  }
  const records = [];
  for (let tableIndex = 0; tableIndex < SECTION_BY_TABLE.length; tableIndex += 1) {
    const section = SECTION_BY_TABLE[tableIndex];
    const grid = tableGridFromHtml(tables[tableIndex]);
    const headerIndex = grid.findIndex((row) => /省市|省份/.test(row[0] || "") && row.length > 1);
    if (headerIndex < 0) throw new Error(`Header row not found for Fudan ${page.year} ${section}`);
    const headers = grid[headerIndex].map(columnLabel);
    audit.tableHeaders.push({ year: page.year, section, headers });
    for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex];
      const rawProvince = normalizeCell(row[0]);
      if (!rawProvince) continue;
      const provinceInfo = normalizeProvince(rawProvince);
      if (provinceInfo.skip) {
        audit.skippedRows.push({ year: page.year, section, sourceProvinceRaw: rawProvince, reason: "non-mainland-admission-route" });
        continue;
      }
      for (let col = 1; col < headers.length; col += 1) {
        const header = headers[col];
        if (!header) continue;
        const cell = normalizeCell(row[col]);
        const score = parseScoreCell(cell);
        if (!score) {
          if (cell) audit.skippedScoreCells.push({ year: page.year, section, province: provinceInfo.province, header, value: cell });
          continue;
        }
        const sourceProvinceRaw = provinceInfo.sourceProvinceRaw || rawProvince;
        const scope = formalScoreScopeFor(section, sourceProvinceRaw);
        const admissionType = admissionTypeFor(section, sourceProvinceRaw, header);
        const subjectType = subjectTypeFromHeader(header);
        const idBase = [page.year, SOURCE.schoolCode, provinceInfo.province, sourceProvinceRaw, section, header, rowIndex, col, score.sourceScoreRaw].join("|");
        const record = {
          id: `${page.year}-fudan-national-school-${hash(idBase, 16)}`,
          province: provinceInfo.province,
          sourceProvinceRaw,
          year: page.year,
          subjectType,
          sourceSubjectRaw: header,
          subjectMappingNote: "复旦源页说明3+3模式省份为便于查询按文史类/理工类简化归并；本记录沿用源表列名，不改写为综合改革精确选科。",
          batch: batchFor(section),
          sourceBatchRaw: section,
          schoolCode: SOURCE.schoolCode,
          schoolName: SOURCE.schoolName,
          city: SOURCE.city,
          schoolTags: schoolTagsFor(header, score),
          dataType: "institution-admission",
          majorName: majorNameFor(section, header),
          collegeName: /医学院/.test(header) ? "复旦大学上海医学院" : undefined,
          majorGroup: `${SOURCE.schoolName}${page.year}${provinceInfo.province}${section}|${header}`,
          admissionType,
          admissionSubtype: admissionType,
          formalScoreScope: scope,
          minScore: score.minScore,
          scoreOnly: true,
          rankUnavailable: true,
          sourceId: SOURCE.id,
          sourceQuality: SOURCE.quality,
          schoolOfficialScope: "single-school-admission-score",
          sourceUrl: page.url,
          sourcePageUrl: page.url,
          sourceMinScoreRaw: score.sourceScoreRaw,
          rawTableSection: section,
          rawRow: {
            tableIndex,
            rowIndex,
            columnIndex: col,
            sourceProvinceRaw,
            sourceSubjectRaw: header,
            sourceScoreRaw: score.sourceScoreRaw,
          },
        };
        if (provinceInfo.candidateCategory) {
          record.candidateCategory = provinceInfo.candidateCategory.includes("民") ? "西藏少数民族/民" : provinceInfo.candidateCategory;
        }
        if (score.scoreLowerBound) {
          record.scoreLowerBound = true;
          record.scoreRange = score.scoreRange;
          record.rankRangeText = score.rankRangeText;
        }
        Object.keys(record).forEach((key) => record[key] === undefined && delete record[key]);
        record.cautions = cautionsFor(record);
        records.push(record);
      }
    }
  }
  return records;
}

function buildRecords(raw) {
  const audit = { tableHeaders: [], skippedRows: [], skippedScoreCells: [] };
  const records = raw.pages.flatMap((page) => parsePage(page, audit));
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`Duplicate Fudan record id: ${record.id}`);
    ids.add(record.id);
  }
  return { records, audit };
}

function buildSourceNote(records, raw, audit) {
  const ordinary = records.filter((record) => record.formalScoreScope === "school-official-only");
  const special = records.filter((record) => record.formalScoreScope === "special-path-only");
  const lowerBound = records.filter((record) => record.scoreLowerBound);
  const rawFiles = [raw.listFile, ...raw.pages.map((page) => page.file)];
  return {
    id: SOURCE.id,
    title: "复旦大学招生网：2024-2025年全国分省分批次录取分数",
    publisher: SOURCE.schoolName,
    url: LIST_URL,
    pageUrls: Object.fromEntries(PAGE_URLS),
    quality: SOURCE.quality,
    usage: "抽取复旦大学招生网官方历年录取分数 HTML 表中2024、2025年普通批（本一批）、高校专项和国家专项分省分科类最低分；普通批作单校候选边界，专项及西藏少数民族行隔离为特殊路径。",
    parsedRecords: records.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    ordinarySchoolOfficialRecords: ordinary.length,
    specialPathRecords: special.length,
    lowerBoundRecords: lowerBound.length,
    exactScoreRecords: records.length - lowerBound.length,
    skippedRows: audit.skippedRows.length,
    skippedScoreCells: audit.skippedScoreCells.length,
    skippedRowsDetail: audit.skippedRows,
    skippedScoreCellsDetail: audit.skippedScoreCells,
    byYear: countBy(records, (record) => record.year),
    bySection: countBy(records, (record) => record.sourceBatchRaw),
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    scoreRange: numericRange(records.map((record) => record.minScore)),
    tableHeaders: audit.tableHeaders,
    rawPaths: rawFiles.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: rawFiles.map((file) => ({
      path: path.relative(PROJECT_ROOT, file),
      sha256: sha256File(file),
    })),
    transcriptionMethod: "official-html-table",
    cautions: [
      "本源为复旦大学官方单校录取数据，不是任何省级教育考试院全量投档/录取分数表。",
      "源页说明以上数据仅供参考，以各省招办公布为准。",
      "源页说明3+3模式省份为便于查询按文史类/理工类简化归并；本导入沿用源表列名，不改写为综合改革精确选科。",
      "源表未公开最低位次，推荐层不得生成假位次或仅凭该单校分数输出录取概率。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "高校专项、国家专项和西藏少数民族行按 formalScoreScope=special-path-only 隔离。",
      "580+ 等高分段只作为最低边界入库，不把区间上限当作精确最低分。",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const raw = await ensureRaw(path.join(PROJECT_ROOT, RAW_DIR), args.useCache);
  const { records, audit } = buildRecords(raw);
  const sourceNotes = [buildSourceNote(records, raw, audit)];
  const outPath = path.join(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes, records }, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    out: args.out,
    records: records.length,
    provinceCount: sourceNotes[0].provinceCount,
    ordinarySchoolOfficialRecords: sourceNotes[0].ordinarySchoolOfficialRecords,
    specialPathRecords: sourceNotes[0].specialPathRecords,
    lowerBoundRecords: sourceNotes[0].lowerBoundRecords,
    skippedRows: sourceNotes[0].skippedRows,
    skippedScoreCells: sourceNotes[0].skippedScoreCells,
    byYear: sourceNotes[0].byYear,
    bySection: sourceNotes[0].bySection,
    bySubjectType: sourceNotes[0].bySubjectType,
    scoreRange: sourceNotes[0].scoreRange,
    sha256: sha256File(outPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
