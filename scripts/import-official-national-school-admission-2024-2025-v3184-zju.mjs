#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2024-2025-v3184-zju-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2024-2025-v3184-zju";
const LIST_URL = "https://zdzsc.zju.edu.cn/87245/list.htm";
const PAGE_URLS = new Map([
  [2025, "https://zdzsc.zju.edu.cn/2026/0617/c87260a3179915/page.htm"],
  [2024, "https://zdzsc.zju.edu.cn/2025/0618/c87260a3062845/page.htm"],
]);
const YEARS = [...PAGE_URLS.keys()];
const SOURCE = {
  id: "official-zju-national-2024-2025-school-admission",
  quality: "official-school-zju-2024-2025-national-html-score-only",
  schoolCode: "10335",
  schoolName: "浙江大学",
  city: "杭州",
  tags: ["综合", "985", "211", "双一流"],
};
const PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
  "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
];
const REMARK_LABELS = ["ZJU-UoE", "ZJU-UIUC", "农学", "海洋", "政治学与行政学", "园林"];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2024-2025-v3184-zju.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2024-2025-v3184-zju.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Zhejiang University official 2024/2025 ordinary first-batch filing score HTML table rows.",
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
    .replace(/[　]/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

function normalizeCell(value) {
  return textFromHtml(value)
    .replace(/\s*：\s*/g, "：")
    .replace(/\s*；\s*/g, "；")
    .replace(/\s*（\s*/g, "（")
    .replace(/\s*）\s*/g, "）")
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
      "user-agent": "Mozilla/5.0 gaokao-zju-v3184-importer/1.0",
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
  const listFile = path.join(rawDir, "zju-score-list.html");
  if (!useCache || !fs.existsSync(listFile)) {
    fs.writeFileSync(listFile, await download(LIST_URL, "https://zdzsc.zju.edu.cn/"));
  }
  const pages = [];
  for (const [year, url] of PAGE_URLS) {
    const pageFile = path.join(rawDir, `zju-${year}-ordinary-first-batch-score.html`);
    if (!useCache || !fs.existsSync(pageFile)) {
      fs.writeFileSync(pageFile, await download(url));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    pages.push({ year, url, file: pageFile });
  }
  return { listFile, pages };
}

function normalizeProvince(raw) {
  const province = normalizeCell(raw).replace(/\s+/g, "");
  if (!PROVINCES.includes(province)) throw new Error(`Unsupported ZJU province label: ${raw}`);
  return province;
}

function parseScoreCell(value) {
  const text = normalizeCell(value);
  if (!text || text === "/" || text === "-" || text === "--") return null;
  const match = text.match(/^(\d{2,3})(?:（(.+?)）)?$/);
  if (!match) return null;
  return {
    minScore: Number(match[1]),
    sourceScoreRaw: text,
    note: match[2] || "",
  };
}

function splitChoiceScores(value) {
  const text = normalizeCell(value);
  const matches = [...text.matchAll(/(物理|不限|历史|化学或生物|化学\+生物|物理\+化学|历史或地理|物或化或生)：(\d{2,3})/g)];
  return matches.map((match) => ({
    label: match[1],
    minScore: Number(match[2]),
    sourceScoreRaw: `${match[1]}：${match[2]}`,
  }));
}

function parseRemarkScores(value) {
  const text = normalizeCell(value);
  if (!text) return [];
  const records = [];
  for (const label of REMARK_LABELS) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}\\s*：\\s*(\\d{2,3})`, "g");
    for (const match of text.matchAll(regex)) {
      records.push({ label, minScore: Number(match[1]), sourceScoreRaw: `${label}：${match[1]}` });
    }
  }
  const deduped = new Map();
  for (const record of records) deduped.set(`${record.label}|${record.minScore}`, record);
  return [...deduped.values()];
}

function subjectTypeFor(label) {
  if (/备注|未明示/.test(label)) return "综合";
  if (/文史|历史/.test(label)) return "历史类";
  if (/不限|综合|物或化或生|历史或地理|化学或生物/.test(label)) return "综合";
  return "物理类";
}

function admissionTypeFor(label, rawScore = "") {
  if (label === "ZJU-UoE") return "中外合作办学；浙江大学爱丁堡大学联合学院";
  if (label === "ZJU-UIUC") return "中外合作办学；浙江大学伊利诺伊大学厄巴纳香槟校区联合学院";
  if (/医药/.test(label)) return "医药类";
  if (/不含藏语言/.test(rawScore)) return "普通录取；不含藏语言";
  return label === "理工" || label === "文史" || /物理|不限|历史/.test(label) ? "普通录取" : label;
}

function tagsFor(label) {
  const tags = [...SOURCE.tags];
  if (/医药/.test(label)) tags.push("医卫");
  if (/ZJU-UoE|ZJU-UIUC/.test(label)) tags.push("中外合作办学");
  if (/农学|园林/.test(label)) tags.push("农林");
  if (/海洋/.test(label)) tags.push("海洋");
  return tags;
}

function majorNameFor(label) {
  if (label === "理工") return "浙江大学普通本一批投档分数（理工）";
  if (label === "文史") return "浙江大学普通本一批投档分数（文史）";
  if (label === "医药") return "浙江大学普通本一批投档分数（医药）";
  if (label === "ZJU-UoE") return "浙江大学爱丁堡大学联合学院普通本一批投档分数";
  if (label === "ZJU-UIUC") return "浙江大学伊利诺伊大学厄巴纳香槟校区联合学院普通本一批投档分数";
  return `浙江大学普通本一批投档分数（${label}）`;
}

function cautionsFor(record) {
  const cautions = [
    "本记录来自浙江大学本科招生网官方历年分数 HTML 表，是单校普通本一批投档分数边界，不是省级教育考试院全量投档/录取分数表。",
    "源页说明分数仅供参考，具体以各省份考试院公布为准。",
    "源表未公开最低位次；推荐层不得生成假位次或仅凭本行分数单独输出录取概率。",
    "学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于浙江大学候选边界复核，但不得替代同省省级正式投档表。",
  ];
  if (record.sourceSubjectRaw === "医药") {
    cautions.push("医药列是源表单独列示口径，未给出完整专业组选科；填报前必须核对当年省级专业组、选科、体检限制和招生章程。");
  }
  if (record.sourceColumn === "备注") {
    cautions.push("备注列未明示科类/选科；本记录只作该备注项目的单校分数边界，不与明确理工/文史/医药列混写。");
  }
  if (/中外合作办学/.test(record.admissionType)) {
    cautions.push("联合学院/中外合作办学口径需额外核对学费、培养模式、外语要求、校区和家庭预算红线。");
  }
  if (/不含藏语言/.test(record.sourceMinScoreRaw || "")) {
    cautions.push("源表西藏行标注不含藏语言，不能外推到藏语言或其他单列类别。");
  }
  return cautions;
}

function makeRecord({ page, province, label, minScore, sourceScoreRaw, sourceColumn, sourceSubjectRaw, sourceNote, tableRowIndex, tableColumn }) {
  const admissionType = admissionTypeFor(label, sourceScoreRaw);
  const subjectRaw = sourceSubjectRaw || label;
  const idBase = [page.year, SOURCE.schoolCode, province, label, sourceColumn, minScore, sourceScoreRaw].join("|");
  const record = {
    id: `${page.year}-zju-national-school-${hash(idBase, 16)}`,
    province,
    sourceProvinceRaw: province,
    year: page.year,
    subjectType: subjectTypeFor(subjectRaw),
    sourceSubjectRaw: subjectRaw,
    subjectMappingNote: sourceColumn === "备注"
      ? "浙江大学源表备注列未明示科类/选科；本记录保留 sourceSubjectRaw=备注未明示科类，不当作精确科类匹配。"
      : sourceSubjectRaw === "医药"
        ? "浙江大学源表将医药作为单独列示口径，未提供完整专业组选科；站内仅按医药单校边界保存。"
        : undefined,
    batch: "本科一批/普通批",
    sourceBatchRaw: "普通本一批投档分数线",
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: tagsFor(label),
    dataType: "institution-admission",
    majorName: majorNameFor(label),
    majorGroup: `${SOURCE.schoolName}${page.year}${province}普通本一批|${label}`,
    admissionType,
    admissionSubtype: admissionType,
    formalScoreScope: "school-official-only",
    minScore,
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: page.url,
    sourcePageUrl: page.url,
    sourceMinScoreRaw: sourceScoreRaw,
    sourceColumn,
    rawTableSection: "普通本一批投档分数线",
    rawRow: {
      tableRowIndex,
      tableColumn,
      sourceProvinceRaw: province,
      sourceSubjectRaw: subjectRaw,
      sourceScoreRaw,
    },
  };
  if (sourceNote) record.sourceScoreNote = sourceNote;
  Object.keys(record).forEach((key) => record[key] === undefined && delete record[key]);
  record.cautions = cautionsFor(record);
  return record;
}

function parsePage(page, audit) {
  const html = fs.readFileSync(page.file, "utf8");
  const tables = extractTables(html);
  if (tables.length !== 1) throw new Error(`Expected one ZJU score table for ${page.year}, got ${tables.length}`);
  const grid = tableGridFromHtml(tables[0]);
  const headerIndex = grid.findIndex((row) => row[0] === "省份" && row.includes("理工") && row.includes("文史"));
  if (headerIndex < 0) throw new Error(`Header row not found for ZJU ${page.year}`);
  const headers = grid[headerIndex];
  audit.tableHeaders.push({ year: page.year, headers });
  const records = [];
  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const firstCell = normalizeCell(row[0]);
    if (!firstCell || firstCell.startsWith("注")) continue;
    const province = normalizeProvince(firstCell);
    const scienceCell = normalizeCell(row[1]);
    const humanitiesCell = normalizeCell(row[2]);
    const medicineCell = normalizeCell(row[3]);
    const remarkCell = normalizeCell(row[4]);

    const choices = splitChoiceScores(scienceCell);
    if (choices.length && scienceCell === humanitiesCell) {
      for (const choice of choices) {
        records.push(makeRecord({
          page,
          province,
          label: choice.label,
          minScore: choice.minScore,
          sourceScoreRaw: choice.sourceScoreRaw,
          sourceColumn: "理工/文史合并",
          sourceSubjectRaw: choice.label,
          tableRowIndex: rowIndex,
          tableColumn: "理工/文史",
        }));
      }
      audit.mergedSubjectRows += 1;
    } else {
      for (const [column, label, value] of [
        ["理工", "理工", scienceCell],
        ["文史", "文史", humanitiesCell],
      ]) {
        const parsed = parseScoreCell(value);
        if (!parsed) {
          if (value) audit.skippedScoreCells.push({ year: page.year, province, column, value });
          continue;
        }
        records.push(makeRecord({
          page,
          province,
          label,
          minScore: parsed.minScore,
          sourceScoreRaw: parsed.sourceScoreRaw,
          sourceColumn: column,
          sourceSubjectRaw: label,
          sourceNote: parsed.note,
          tableRowIndex: rowIndex,
          tableColumn: column,
        }));
      }
    }

    const medicine = parseScoreCell(medicineCell);
    if (medicine) {
      records.push(makeRecord({
        page,
        province,
        label: "医药",
        minScore: medicine.minScore,
        sourceScoreRaw: medicine.sourceScoreRaw,
        sourceColumn: "医药",
        sourceSubjectRaw: "医药",
        sourceNote: medicine.note,
        tableRowIndex: rowIndex,
        tableColumn: "医药",
      }));
    } else if (medicineCell) {
      audit.skippedScoreCells.push({ year: page.year, province, column: "医药", value: medicineCell });
    }

    for (const remark of parseRemarkScores(remarkCell)) {
      records.push(makeRecord({
        page,
        province,
        label: remark.label,
        minScore: remark.minScore,
        sourceScoreRaw: remark.sourceScoreRaw,
        sourceColumn: "备注",
        sourceSubjectRaw: "备注未明示科类",
        tableRowIndex: rowIndex,
        tableColumn: "备注",
      }));
    }
  }
  return records;
}

function buildRecords(raw) {
  const audit = { tableHeaders: [], skippedScoreCells: [], mergedSubjectRows: 0 };
  const records = raw.pages.flatMap((page) => parsePage(page, audit));
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`Duplicate ZJU record id: ${record.id}`);
    ids.add(record.id);
  }
  return { records, audit };
}

function buildSourceNote(records, raw, audit) {
  const rawFiles = [raw.listFile, ...raw.pages.map((page) => page.file)];
  return {
    id: SOURCE.id,
    title: "浙江大学本科招生网：2024-2025年各省份普通本一批投档分数线",
    publisher: SOURCE.schoolName,
    url: LIST_URL,
    pageUrls: Object.fromEntries(PAGE_URLS),
    quality: SOURCE.quality,
    usage: "抽取浙江大学本科招生网官方历年分数 HTML 表中2024、2025年各省份普通本一批投档分数线；理工、文史、医药和备注项目均作为单校候选边界，源表未公开最低位次。",
    parsedRecords: records.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    schoolOfficialRecords: records.length,
    remarkRecords: records.filter((record) => record.sourceColumn === "备注").length,
    mergedSubjectRows: audit.mergedSubjectRows,
    skippedScoreCells: audit.skippedScoreCells.length,
    skippedScoreCellsDetail: audit.skippedScoreCells,
    byYear: countBy(records, (record) => record.year),
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    bySourceColumn: countBy(records, (record) => record.sourceColumn),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    scoreRange: numericRange(records.map((record) => record.minScore)),
    tableHeaders: audit.tableHeaders,
    rawPaths: rawFiles.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: rawFiles.map((file) => ({
      path: path.relative(PROJECT_ROOT, file),
      sha256: sha256File(file),
    })),
    transcriptionMethod: "official-html-table",
    cautions: [
      "本源为浙江大学官方单校普通本一批投档分数，不是任何省级教育考试院全量投档/录取分数表。",
      "源页说明分数仅供参考，具体以各省份考试院公布为准。",
      "源表未公开最低位次，推荐层不得生成假位次或仅凭该单校分数输出录取概率。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "医药列、联合学院、农学、海洋、园林和政治学与行政学等备注项目需回到当年省级专业组、选科、章程、学费校区和调剂范围核验。",
      "2023页存在更多多行选科/备注布局，本轮只导入2024-2025两个结构清楚的官方表。",
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
    remarkRecords: sourceNotes[0].remarkRecords,
    mergedSubjectRows: sourceNotes[0].mergedSubjectRows,
    byYear: sourceNotes[0].byYear,
    bySourceColumn: sourceNotes[0].bySourceColumn,
    bySubjectType: sourceNotes[0].bySubjectType,
    scoreRange: sourceNotes[0].scoreRange,
    sha256: sha256File(outPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
