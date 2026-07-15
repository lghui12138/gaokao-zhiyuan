#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2024-2025-v3185-hust-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2024-2025-v3185-hust";
const LIST_URL = "https://zsb.hust.edu.cn/";
const PAGE_URLS = new Map([
  [2025, "https://zsb.hust.edu.cn/info/1217/2981.htm"],
  [2024, "https://zsb.hust.edu.cn/info/1217/2580.htm"],
]);
const SOURCE = {
  id: "official-hust-national-2024-2025-school-admission",
  quality: "official-school-hust-2024-2025-national-html-score-only",
  schoolCode: "10487",
  schoolName: "华中科技大学",
  city: "武汉",
  tags: ["综合", "985", "211", "双一流"],
};
const PROVINCE_ALIASES = new Map([
  ["北京市", "北京"],
  ["北京", "北京"],
  ["天津市", "天津"],
  ["天津", "天津"],
  ["河北省", "河北"],
  ["河北", "河北"],
  ["山西省", "山西"],
  ["山西", "山西"],
  ["内蒙古自治区", "内蒙古"],
  ["内蒙古", "内蒙古"],
  ["辽宁省", "辽宁"],
  ["辽宁", "辽宁"],
  ["吉林省", "吉林"],
  ["吉林", "吉林"],
  ["黑龙江省", "黑龙江"],
  ["黑龙江", "黑龙江"],
  ["上海市", "上海"],
  ["上海", "上海"],
  ["江苏省", "江苏"],
  ["江苏", "江苏"],
  ["浙江省", "浙江"],
  ["浙江", "浙江"],
  ["安徽省", "安徽"],
  ["安徽", "安徽"],
  ["福建省", "福建"],
  ["福建", "福建"],
  ["江西省", "江西"],
  ["江西", "江西"],
  ["山东省", "山东"],
  ["山东", "山东"],
  ["河南省", "河南"],
  ["河南", "河南"],
  ["湖北省", "湖北"],
  ["湖北", "湖北"],
  ["湖南省", "湖南"],
  ["湖南", "湖南"],
  ["广东省", "广东"],
  ["广东", "广东"],
  ["广西壮族自治区", "广西"],
  ["广西", "广西"],
  ["海南省", "海南"],
  ["海南", "海南"],
  ["重庆市", "重庆"],
  ["重庆", "重庆"],
  ["四川省", "四川"],
  ["四川", "四川"],
  ["贵州省", "贵州"],
  ["贵州", "贵州"],
  ["云南省", "云南"],
  ["云南", "云南"],
  ["西藏自治区", "西藏"],
  ["西藏", "西藏"],
  ["陕西省", "陕西"],
  ["陕西", "陕西"],
  ["甘肃省", "甘肃"],
  ["甘肃", "甘肃"],
  ["青海省", "青海"],
  ["青海", "青海"],
  ["宁夏回族自治区", "宁夏"],
  ["宁夏", "宁夏"],
  ["新疆维吾尔自治区", "新疆"],
  ["新疆", "新疆"],
]);
const MAINLAND_PROVINCES = [...new Set(PROVINCE_ALIASES.values())];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2024-2025-v3185-hust.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2024-2025-v3185-hust.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Huazhong University of Science and Technology official 2024/2025 national admission score HTML table rows.",
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
    .replace(/\s*（\s*/g, "（")
    .replace(/\s*）\s*/g, "）")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s*:\s*/g, "：")
    .replace(/\s*：\s*/g, "：")
    .replace(/\s*\+\s*/g, "+")
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
      "user-agent": "Mozilla/5.0 gaokao-hust-v3185-importer/1.0",
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
  const listFile = path.join(rawDir, "hust-admission-home.html");
  if (!useCache || !fs.existsSync(listFile)) {
    fs.writeFileSync(listFile, await download(LIST_URL, "https://zsb.hust.edu.cn/"));
  }
  const pages = [];
  for (const [year, url] of PAGE_URLS) {
    const pageFile = path.join(rawDir, `hust-${year}-admission-score.html`);
    if (!useCache || !fs.existsSync(pageFile)) {
      fs.writeFileSync(pageFile, await download(url));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    pages.push({ year, url, file: pageFile });
  }
  return { listFile, pages };
}

function normalizeSection(sectionRaw) {
  const section = normalizeCell(sectionRaw);
  if (section === "国家专项计划") return "国家专项";
  if (section === "高校专项计划") return "高校专项";
  return section;
}

function isSectionRow(row) {
  return row.length >= 4 && row[0] && row.slice(0, 4).every((cell) => cell === row[0]);
}

function normalizeProvince(sourceProvinceRaw) {
  const raw = normalizeCell(sourceProvinceRaw).replace(/\s+/g, "");
  if (/港澳台|港澳臺|华侨|華僑|侨|僑|联招|聯招/.test(raw)) return { skip: true, province: raw };
  if (/内地西藏高中班/.test(raw)) {
    return { province: "西藏", sourceProvinceRaw: raw, candidateCategory: "内地西藏高中班" };
  }
  if (/内地新疆高中班/.test(raw)) {
    return { province: "新疆", sourceProvinceRaw: raw, candidateCategory: "内地新疆高中班" };
  }
  const suffix = raw.match(/^(.+?)[（(](.+?)[）)]$/);
  const base = suffix ? suffix[1] : raw;
  const candidateCategory = suffix ? suffix[2].replace(/\s+/g, "") : "";
  const province = PROVINCE_ALIASES.get(base);
  if (!province || !MAINLAND_PROVINCES.includes(province)) {
    throw new Error(`Unsupported HUST province label: ${sourceProvinceRaw}`);
  }
  return { province, sourceProvinceRaw: raw, candidateCategory };
}

function parseScore(value, fieldName) {
  const text = normalizeCell(value);
  const score = Number(text);
  if (!Number.isFinite(score)) throw new Error(`Unsupported HUST ${fieldName}: ${text}`);
  return { score, raw: text };
}

function subjectTypeFor(category, section) {
  const text = `${category} ${section}`;
  if (/艺术|美术|设计|音乐|舞蹈|播音|表演/.test(text)) return "艺术类";
  if (/综合改革|综合/.test(text)) return "综合";
  if (/历史|文史|文科|仅历史|历史类|文$/.test(text)) return "历史类";
  if (/物理|理工|理科|物\+化|医科|物理类|理$/.test(text)) return "物理类";
  return "综合";
}

function subjectMappingNoteFor(category, section) {
  const text = `${category} ${section}`;
  if (/艺术|美术|设计|音乐|舞蹈|播音|表演|综合改革|综合|历史|文史|文科|仅历史|物理|理工|理科|物\+化|医科/.test(text)) {
    return undefined;
  }
  return "华中科技大学源表该行仅给出科类批次/类别名称，未明示精确科类或选科；运行层按综合口径保存，不当作精确选科匹配。";
}

function admissionKinds(category, section, candidateCategory) {
  const text = `${category} ${section} ${candidateCategory || ""}`;
  const kinds = [];
  if (/国家专项/.test(text)) kinds.push("国家专项");
  if (/高校专项/.test(text)) kinds.push("高校专项");
  if (/提前批|轮机/.test(text)) kinds.push("提前批轮机工程");
  if (/民族|少数民族/.test(text)) kinds.push("民族/少数民族");
  if (/内地西藏高中班|内地新疆高中班|内高班|内地班|西藏班|新疆班/.test(text)) kinds.push("内高班/内地班");
  if (/中外合作/.test(text)) kinds.push("中外合作办学");
  if (/艺术|美术|设计|音乐|舞蹈|播音|表演/.test(text)) kinds.push("艺术类");
  if (/医科/.test(text)) kinds.push("医科组");
  return kinds;
}

function formalScoreScopeFor(section, category, provinceInfo) {
  const text = `${section} ${category} ${provinceInfo.candidateCategory || ""}`;
  if (/国家专项|高校专项|提前批|轮机|民族|少数民族|内地西藏高中班|内地新疆高中班|内高班|内地班|艺术|美术|设计|音乐|舞蹈|播音|表演/.test(text)) {
    return "special-path-only";
  }
  return "school-official-only";
}

function admissionTypeFor(category, section, provinceInfo) {
  const kinds = admissionKinds(category, section, provinceInfo.candidateCategory);
  if (!kinds.length) return "普通录取";
  if (section === "普通批" && kinds.every((kind) => kind === "医科组")) return "普通录取；医科组";
  return kinds.join("；");
}

function batchFor(section, scope, admissionType) {
  if (admissionType.includes("国家专项")) return "国家专项本科";
  if (admissionType.includes("高校专项")) return "高校专项";
  if (admissionType.includes("提前批轮机工程")) return "本科提前批";
  if (admissionType.includes("艺术类")) return "艺术类本科";
  if (admissionType.includes("民族")) return "民族班";
  if (admissionType.includes("内高班")) return "内高班/内地班";
  if (admissionType.includes("中外合作办学")) return "本科批（中外合作办学）";
  if (scope === "special-path-only") return "特殊类型本科";
  if (section === "普通批") return "本科批";
  return section;
}

function schoolTagsFor(category, admissionType, subjectType) {
  const tags = [...SOURCE.tags];
  const text = `${category} ${admissionType}`;
  if (/医科|医学|药学|生物科学/.test(text)) tags.push("医卫");
  if (/中外合作/.test(text)) tags.push("中外合作办学");
  if (subjectType === "艺术类") tags.push("艺术类");
  return [...new Set(tags)];
}

function majorNameFor(category, section) {
  const label = normalizeCell(category);
  if (section === "普通批") return `${SOURCE.schoolName}普通批录取分数（${label}）`;
  if (section === "中外合作办学") return `${SOURCE.schoolName}中外合作办学录取分数（${label}）`;
  return `${SOURCE.schoolName}${section}录取分数（${label}）`;
}

function cautionsFor(record) {
  const cautions = [
    "本记录来自华中科技大学本科生招生信息网官方录取情况统计 HTML 表，是单校分省分批次/类别录取分数边界，不是省级教育考试院全量投档/录取分数表。",
    "源表未公开最低位次；推荐层不得生成假位次或仅凭本行分数单独输出录取概率。",
  ];
  if (record.formalScoreScope === "school-official-only") {
    cautions.push("普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于华中科技大学候选边界复核，但不得替代同省省级正式投档表。");
  } else {
    cautions.push(`${record.admissionType}按 formalScoreScope=special-path-only 隔离，只用于对应资格入口复核，不与普通本科批文化分边界混用。`);
  }
  if (record.subjectMappingNote) cautions.push(record.subjectMappingNote);
  if (record.admissionType.includes("中外合作办学")) {
    cautions.push("中外合作办学口径需额外核对学费、培养模式、外语要求、校区和家庭预算红线。");
  }
  if (/医科|医学|药学|生物科学/.test(`${record.majorName} ${record.admissionType}`)) {
    cautions.push("医科/医学/药学/生物科学相关口径需额外核对体检限制、培养地点、专业组、调剂范围和当年招生章程。");
  }
  return cautions;
}

function makeRecord({ page, section, row, rowIndex }) {
  const provinceInfo = normalizeProvince(row[0]);
  if (provinceInfo.skip) return { skip: true, reason: "港澳台/联招", rowIndex, row };
  const category = normalizeCell(row[1]);
  const maxScore = parseScore(row[2], "maxScore");
  const minScore = parseScore(row[3], "minScore");
  if (minScore.score > maxScore.score) {
    throw new Error(`HUST minScore > maxScore for ${page.year} ${row.join(" | ")}`);
  }
  const scope = formalScoreScopeFor(section, category, provinceInfo);
  const admissionType = admissionTypeFor(category, section, provinceInfo);
  const subjectType = subjectTypeFor(category, section);
  const subjectMappingNote = subjectMappingNoteFor(category, section);
  const idBase = [page.year, SOURCE.schoolCode, provinceInfo.province, section, provinceInfo.sourceProvinceRaw, category, minScore.raw, maxScore.raw].join("|");
  const record = {
    id: `${page.year}-hust-national-school-${hash(idBase, 16)}`,
    province: provinceInfo.province,
    sourceProvinceRaw: provinceInfo.sourceProvinceRaw,
    year: page.year,
    subjectType,
    sourceSubjectRaw: category,
    subjectMappingNote,
    batch: batchFor(section, scope, admissionType),
    sourceBatchRaw: section,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: schoolTagsFor(category, admissionType, subjectType),
    dataType: "institution-admission",
    majorName: majorNameFor(category, section),
    majorGroup: `${SOURCE.schoolName}${page.year}${provinceInfo.province}${section}|${category}`,
    admissionType,
    admissionSubtype: admissionType,
    formalScoreScope: scope,
    minScore: minScore.score,
    maxScore: maxScore.score,
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: page.url,
    sourcePageUrl: page.url,
    sourceMinScoreRaw: minScore.raw,
    sourceMaxScoreRaw: maxScore.raw,
    rawTableSection: section,
    rawRow: {
      tableRowIndex: rowIndex,
      sourceProvinceRaw: provinceInfo.sourceProvinceRaw,
      sourceSubjectRaw: category,
      sourceMaxScoreRaw: maxScore.raw,
      sourceMinScoreRaw: minScore.raw,
    },
  };
  if (provinceInfo.candidateCategory) record.candidateCategory = provinceInfo.candidateCategory;
  Object.keys(record).forEach((key) => record[key] === undefined && delete record[key]);
  record.cautions = cautionsFor(record);
  return { record };
}

function parsePage(page, audit) {
  const html = fs.readFileSync(page.file, "utf8");
  const tables = extractTables(html);
  if (tables.length !== 1) throw new Error(`Expected one HUST score table for ${page.year}, got ${tables.length}`);
  const grid = tableGridFromHtml(tables[0]);
  const headerIndex = grid.findIndex((row) => row[0] === "省份" && row[1] === "科类批次" && row.includes("最低分"));
  if (headerIndex < 0) throw new Error(`Header row not found for HUST ${page.year}`);
  audit.tableHeaders.push({ year: page.year, headers: grid[headerIndex] });
  const records = [];
  let section = "";
  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex].slice(0, 4).map((cell) => normalizeCell(cell));
    if (isSectionRow(row)) {
      section = normalizeSection(row[0]);
      audit.sections.push({ year: page.year, rowIndex, section });
      continue;
    }
    if (!section) {
      audit.skippedRows.push({ year: page.year, rowIndex, reason: "no-section", row });
      continue;
    }
    if (row.length < 4 || row.some((cell) => !cell)) {
      audit.skippedRows.push({ year: page.year, rowIndex, reason: "incomplete-row", section, row });
      continue;
    }
    const result = makeRecord({ page, section, row, rowIndex });
    if (result.record) records.push(result.record);
    else audit.skippedRows.push({ year: page.year, section, ...result });
  }
  return records;
}

function buildRecords(raw) {
  const audit = { tableHeaders: [], sections: [], skippedRows: [] };
  const records = raw.pages.flatMap((page) => parsePage(page, audit));
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`Duplicate HUST record id: ${record.id}`);
    ids.add(record.id);
  }
  return { records, audit };
}

function buildSourceNote(records, raw, audit) {
  const ordinary = records.filter((record) => record.formalScoreScope === "school-official-only");
  const special = records.filter((record) => record.formalScoreScope === "special-path-only");
  const rawFiles = [raw.listFile, ...raw.pages.map((page) => page.file)];
  return {
    id: SOURCE.id,
    title: "华中科技大学本科生招生信息网：2024-2025年本科招生录取情况统计",
    publisher: SOURCE.schoolName,
    url: LIST_URL,
    pageUrls: Object.fromEntries(PAGE_URLS),
    quality: SOURCE.quality,
    usage: "抽取华中科技大学本科生招生信息网官方2024、2025年本科招生录取情况统计 HTML 表；普通批与中外合作办学作单校候选边界，国家专项、高校专项、艺术类、提前批轮机工程、民族班、内地西藏/新疆高中班和少数民族类别隔离为特殊路径。",
    parsedRecords: records.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    ordinarySchoolOfficialRecords: ordinary.length,
    specialPathRecords: special.length,
    skippedRows: audit.skippedRows.length,
    skippedRowsDetail: audit.skippedRows,
    byYear: countBy(records, (record) => record.year),
    byProvince: countBy(records, (record) => record.province),
    bySection: countBy(records, (record) => record.sourceBatchRaw),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    scoreRange: numericRange(records.map((record) => record.minScore)),
    tableHeaders: audit.tableHeaders,
    sections: audit.sections,
    rawPaths: rawFiles.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: rawFiles.map((file) => ({
      path: path.relative(PROJECT_ROOT, file),
      sha256: sha256File(file),
    })),
    transcriptionMethod: "official-html-table",
    cautions: [
      "本源为华中科技大学官方单校录取情况统计，不是任何省级教育考试院全量投档/录取分数表。",
      "源表未公开最低位次，推荐层不得生成假位次或仅凭该单校分数输出录取概率。",
      "普通批与中外合作办学单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "国家专项、高校专项、艺术类、提前批轮机工程、民族班、内地西藏/新疆高中班和少数民族类别按 formalScoreScope=special-path-only 隔离。",
      "源表部分行仅给出科类批次/类别名称，未明示精确选科；运行层保留 sourceSubjectRaw 与 subjectMappingNote，不改写为精确选科。",
      "港澳台/联招行不混入大陆省级口径。",
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
    skippedRows: sourceNotes[0].skippedRows,
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
