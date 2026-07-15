#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2023-2025-v3188-suda-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2023-2025-v3188-suda";
const LIST_URL = "https://zsb.suda.edu.cn/markHistory.aspx";
const YEARS = [2023, 2024, 2025];
const OVERALL_PAGE_URLS = new Map([
  [2025, "https://zsb.suda.edu.cn/view.aspx?id=2810"],
  [2024, "https://zsb.suda.edu.cn/view.aspx?id=2779"],
  [2023, "https://zsb.suda.edu.cn/view.aspx?id=2742"],
]);
const SOURCE = {
  id: "official-suda-national-2023-2025-school-admission",
  quality: "official-school-suda-2023-2025-national-html-score-only",
  schoolCode: "10285",
  schoolName: "苏州大学",
  city: "苏州",
  tags: ["综合", "211", "双一流"],
};
const PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
  "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
];
const PROVINCE_SLUGS = new Map([
  ["北京", "beijing"],
  ["天津", "tianjin"],
  ["河北", "hebei"],
  ["山西", "shanxi"],
  ["内蒙古", "neimenggu"],
  ["辽宁", "liaoning"],
  ["吉林", "jilin"],
  ["黑龙江", "heilongjiang"],
  ["上海", "shanghai"],
  ["江苏", "jiangsu"],
  ["浙江", "zhejiang"],
  ["安徽", "anhui"],
  ["福建", "fujian"],
  ["江西", "jiangxi"],
  ["山东", "shandong"],
  ["河南", "henan"],
  ["湖北", "hubei"],
  ["湖南", "hunan"],
  ["广东", "guangdong"],
  ["广西", "guangxi"],
  ["海南", "hainan"],
  ["重庆", "chongqing"],
  ["四川", "sichuan"],
  ["贵州", "guizhou"],
  ["云南", "yunnan"],
  ["西藏", "xizang"],
  ["陕西", "shaanxi"],
  ["甘肃", "gansu"],
  ["青海", "qinghai"],
  ["宁夏", "ningxia"],
  ["新疆", "xinjiang"],
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2023-2025-v3188-suda.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2023-2025-v3188-suda.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Soochow University official 2023-2025 national major and province admission score pages.",
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

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'");
}

function normalizeCell(value) {
  return normalizeText(decodeHtmlEntities(String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")))
    .replace(/\s*（\s*/g, "（")
    .replace(/\s*）\s*/g, "）")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s*\/\s*/g, "/")
    .trim();
}

function attrValue(attrs, name) {
  const regex = new RegExp(`${name}\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^\\s>]+))`, "i");
  const match = String(attrs || "").match(regex);
  return match ? (match[1] || match[2] || match[3] || "") : "";
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

function provinceSlug(province) {
  return PROVINCE_SLUGS.get(province) || hash(province, 10);
}

function majorPageUrl(year, province, index) {
  const url = new URL("view_markhistory.aspx", LIST_URL);
  url.searchParams.set("aa", `${year}年${province}各专业录取分数一览表`);
  url.searchParams.set("aid", String(index + 1));
  url.searchParams.set("ay", String(year));
  return url.toString();
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function download(url, referer = LIST_URL) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-suda-v3188-importer/1.0",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(700 * attempt);
    }
  }
  throw lastError;
}

async function ensureFile(file, useCache, fetcher) {
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file);
  const buffer = await fetcher();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return buffer;
}

async function ensureRaw(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const listFile = path.join(rawDir, "suda-mark-history.html");
  await ensureFile(listFile, useCache, () => download(LIST_URL));

  const majorPages = [];
  for (const year of YEARS) {
    for (const [index, province] of PROVINCES.entries()) {
      const url = majorPageUrl(year, province, index);
      const file = path.join(rawDir, `${year}-${provinceSlug(province)}-major.html`);
      await ensureFile(file, useCache, () => download(url));
      majorPages.push({ year, province, url, file });
      if (!useCache) await sleep(25);
    }
  }

  const overallPages = [];
  for (const [year, url] of OVERALL_PAGE_URLS) {
    const file = path.join(rawDir, `${year}-overall-province-score.html`);
    await ensureFile(file, useCache, () => download(url));
    overallPages.push({ year, url, file });
    if (!useCache) await sleep(50);
  }

  return { listFile, majorPages, overallPages };
}

function optionalNumber(value) {
  const text = normalizeCell(value).replace(/,/g, "");
  if (!text || text === "-" || text === "--" || text === "—") return null;
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function normalizedSubjectType(raw, extra = "") {
  const text = `${normalizeCell(raw)} ${normalizeCell(extra)}`;
  if (/艺术|美术|设计|音乐|舞蹈|播音|表演/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/综合|不分文理|改革/.test(text)) return "综合";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  return "综合";
}

function subjectMappingNote(raw, subjectType) {
  const text = normalizeCell(raw);
  if (!text) return "苏州大学源表未明示科类；运行层按综合口径保存，不当作精确选科匹配。";
  if (subjectType === "综合" && !/综合|不分文理|改革/.test(text)) {
    return `苏州大学源表科类 ${text} 未能映射为精确物理/历史/艺体口径，运行层按综合保存。`;
  }
  return undefined;
}

function admissionKinds(...parts) {
  const text = parts.map((part) => normalizeCell(part)).join(" ").replace(/非定向/g, "");
  const kinds = [];
  if (/国家专项/.test(text)) kinds.push("国家专项");
  if (/高校专项/.test(text)) kinds.push("高校专项");
  if (/三大专项|专项计划/.test(text)) kinds.push("专项计划");
  if (/民族|少数民族/.test(text)) kinds.push("民族/少数民族");
  if (/预科/.test(text)) kinds.push("少数民族预科");
  if (/内高班|内地班|西藏班|新疆班/.test(text)) kinds.push("内高班/内地班");
  if (/定向/.test(text)) kinds.push("定向");
  if (/艺术|美术|设计|音乐|舞蹈|播音|表演/.test(text)) kinds.push("艺术类");
  if (/体育/.test(text)) kinds.push("体育类");
  if (/中外合作/.test(text)) kinds.push("中外合作办学");
  if (/苏州医学院|临床|医学|药学|护理|口腔/.test(text)) kinds.push("医卫");
  return kinds;
}

function formalScoreScopeFor(...parts) {
  const text = parts.map((part) => normalizeCell(part)).join(" ").replace(/非定向/g, "");
  if (/国家专项|高校专项|三大专项|专项计划|民族|少数民族|预科|内高班|内地班|西藏班|新疆班|定向|艺术|美术|设计|音乐|舞蹈|播音|表演|体育/.test(text)) {
    return "special-path-only";
  }
  return "school-official-only";
}

function admissionTypeFor(...parts) {
  const kinds = admissionKinds(...parts).filter((kind) => kind !== "医卫");
  return kinds.length ? kinds.join("；") : "普通录取";
}

function schoolTagsFor(...parts) {
  const tags = [...SOURCE.tags];
  const kinds = admissionKinds(...parts);
  if (kinds.includes("中外合作办学")) tags.push("中外合作办学");
  if (kinds.includes("艺术类")) tags.push("艺术类");
  if (kinds.includes("体育类")) tags.push("体育类");
  if (kinds.includes("医卫")) tags.push("医卫");
  return [...new Set(tags)];
}

function batchFor(scope, admissionType) {
  if (admissionType.includes("国家专项")) return "国家专项本科";
  if (admissionType.includes("高校专项")) return "高校专项";
  if (admissionType.includes("专项计划")) return "专项计划本科";
  if (admissionType.includes("预科")) return "少数民族预科";
  if (admissionType.includes("内高班")) return "内高班/内地班";
  if (admissionType.includes("艺术类")) return "艺术类本科";
  if (admissionType.includes("体育类")) return "体育类本科";
  if (admissionType.includes("民族")) return "民族/少数民族本科";
  if (scope === "special-path-only") return "特殊类型本科";
  if (admissionType.includes("中外合作办学")) return "本科批（中外合作办学）";
  return "本科批";
}

function splitMajorAndGroup(value) {
  const text = normalizeCell(value);
  const parts = text.split(/--/);
  if (parts.length > 1) {
    return {
      majorName: normalizeCell(parts[0]),
      majorGroup: normalizeCell(parts.slice(1).join("--")),
    };
  }
  return { majorName: text, majorGroup: "" };
}

function cautionsFor(record) {
  const cautions = [
    "本记录来自苏州大学本科招生网官方历年分数 HTML 页面，是单校分省/专业/专业组录取分数边界，不是省级教育考试院全量投档/录取分数表。",
    "源表未公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
  ];
  if (record.formalScoreScope === "school-official-only") {
    cautions.push("普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于苏州大学候选边界复核，但不得替代同省省级正式投档表。");
  } else {
    cautions.push(`${record.admissionType}按 formalScoreScope=special-path-only 隔离，只用于对应资格入口复核，不与普通本科批文化分边界混用。`);
  }
  if (record.subjectMappingNote) cautions.push(record.subjectMappingNote);
  if (record.admissionType.includes("中外合作办学")) {
    cautions.push("中外合作办学需额外复核学费、培养模式、外语要求、校区和家庭预算红线。");
  }
  if (/医卫|临床|医学|药学|护理|口腔|苏州医学院/.test(`${record.majorName} ${record.majorGroup} ${record.schoolTags?.join(" ") || ""}`)) {
    cautions.push("医卫相关专业需额外核对体检限制、培养地点、学制、专业组、调剂范围和当年招生章程。");
  }
  return cautions;
}

function parseMajorPage(page, audit) {
  const html = fs.readFileSync(page.file, "utf8");
  const tables = extractTables(html).map((table) => tableGridFromHtml(table));
  const grid = tables.find((candidate) =>
    candidate.some((row) => row.includes("专业名称") && row.includes("最低分") && row.includes("平均分"))
  );
  if (!grid) {
    audit.majorPagesWithoutTable.push({
      year: page.year,
      province: page.province,
      url: page.url,
      file: path.relative(PROJECT_ROOT, page.file),
      reason: "major-score-table-not-found",
    });
    return [];
  }
  const headerIndex = grid.findIndex((row) => row.includes("专业名称") && row.includes("最低分") && row.includes("平均分"));
  const records = [];
  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    if (row.length < 6 || !row[0] || row[0] === "注：") continue;
    const minScore = optionalNumber(row[4]);
    if (!Number.isFinite(minScore)) {
      audit.skippedRows.push({
        year: page.year,
        province: page.province,
        kind: "major",
        rowIndex,
        reason: "missing-min-score",
        row,
      });
      continue;
    }
    const { majorName, majorGroup } = splitMajorAndGroup(row[0]);
    const sourceSubjectRaw = normalizeCell(row[2]);
    const subjectType = normalizedSubjectType(sourceSubjectRaw, `${majorName} ${majorGroup}`);
    const scope = formalScoreScopeFor(sourceSubjectRaw, majorName, majorGroup);
    const admissionType = admissionTypeFor(sourceSubjectRaw, majorName, majorGroup);
    const maxScore = optionalNumber(row[3]);
    const averageScore = optionalNumber(row[5]);
    const mappingNote = subjectMappingNote(sourceSubjectRaw, subjectType);
    const record = {
      id: `${page.year}-suda-major-${hash([page.year, page.province, sourceSubjectRaw, majorName, majorGroup, row[3], row[4], row[5]].join("|"))}`,
      province: page.province,
      sourceProvinceRaw: page.province,
      year: page.year,
      subjectType,
      sourceSubjectRaw,
      subjectMappingNote: mappingNote,
      batch: batchFor(scope, admissionType),
      sourceBatchRaw: "各专业录取分数一览表",
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      city: SOURCE.city,
      schoolTags: schoolTagsFor(sourceSubjectRaw, majorName, majorGroup),
      dataType: "major-admission",
      majorName,
      majorGroup: majorGroup || `${SOURCE.schoolName}${page.year}${page.province}${sourceSubjectRaw}`,
      admissionType,
      admissionSubtype: admissionType,
      formalScoreScope: scope,
      minScore,
      scoreOnly: true,
      rankUnavailable: true,
      sourceId: SOURCE.id,
      sourceQuality: SOURCE.quality,
      schoolOfficialScope: "single-school-admission-score",
      sourceUrl: LIST_URL,
      sourcePageUrl: page.url,
      officialEvidencePath: path.relative(PROJECT_ROOT, page.file),
      sourceMinScoreRaw: normalizeCell(row[4]),
      sourceMaxScoreRaw: normalizeCell(row[3]),
      sourceAverageScoreRaw: normalizeCell(row[5]),
      sourceDurationRaw: normalizeCell(row[1]),
      rawRow: {
        tableRowIndex: rowIndex,
        rawMajor: normalizeCell(row[0]),
        sourceDurationRaw: normalizeCell(row[1]),
        sourceSubjectRaw,
        sourceMaxScoreRaw: normalizeCell(row[3]),
        sourceMinScoreRaw: normalizeCell(row[4]),
        sourceAverageScoreRaw: normalizeCell(row[5]),
      },
    };
    if (Number.isFinite(maxScore)) record.maxScore = maxScore;
    if (Number.isFinite(averageScore)) record.averageScore = averageScore;
    Object.keys(record).forEach((key) => record[key] === undefined && delete record[key]);
    record.cautions = cautionsFor(record);
    records.push(record);
  }
  return records;
}

function makeOverallRecord({ page, row, rowIndex, sourceSubjectRaw, majorGroup, controlScoreRaw, maxScoreRaw, minScoreRaw, averageScoreRaw, dataType, section }) {
  const province = normalizeCell(row[0]);
  const minScore = optionalNumber(minScoreRaw);
  if (!PROVINCES.includes(province) || !Number.isFinite(minScore)) return null;
  const subjectType = normalizedSubjectType(sourceSubjectRaw, majorGroup);
  const scope = formalScoreScopeFor(sourceSubjectRaw, majorGroup, section);
  const admissionType = admissionTypeFor(sourceSubjectRaw, majorGroup, section);
  const maxScore = optionalNumber(maxScoreRaw);
  const averageScore = optionalNumber(averageScoreRaw);
  const controlScore = optionalNumber(controlScoreRaw);
  const mappingNote = subjectMappingNote(sourceSubjectRaw, subjectType);
  const record = {
    id: `${page.year}-suda-overall-${hash([page.year, province, sourceSubjectRaw, majorGroup, minScoreRaw, section].join("|"))}`,
    province,
    sourceProvinceRaw: province,
    year: page.year,
    subjectType,
    sourceSubjectRaw,
    subjectMappingNote: mappingNote,
    batch: batchFor(scope, admissionType),
    sourceBatchRaw: section,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: schoolTagsFor(sourceSubjectRaw, majorGroup, section),
    dataType,
    majorName: dataType === "major-group-admission"
      ? `${SOURCE.schoolName}${majorGroup}录取分数`
      : `${SOURCE.schoolName}普通类录取分数（${sourceSubjectRaw}）`,
    majorGroup: majorGroup || `${SOURCE.schoolName}${page.year}${province}${sourceSubjectRaw}`,
    admissionType,
    admissionSubtype: admissionType,
    formalScoreScope: scope,
    minScore,
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: LIST_URL,
    sourcePageUrl: page.url,
    officialEvidencePath: path.relative(PROJECT_ROOT, page.file),
    sourceControlScoreRaw: normalizeCell(controlScoreRaw),
    sourceMinScoreRaw: normalizeCell(minScoreRaw),
    sourceMaxScoreRaw: normalizeCell(maxScoreRaw),
    sourceAverageScoreRaw: normalizeCell(averageScoreRaw),
    rawTableSection: section,
    rawRow: { tableRowIndex: rowIndex, row },
  };
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(averageScore)) record.averageScore = averageScore;
  if (Number.isFinite(controlScore)) record.controlScore = controlScore;
  Object.keys(record).forEach((key) => record[key] === undefined && delete record[key]);
  record.cautions = cautionsFor(record);
  return record;
}

function parseOverallPage(page, audit) {
  const html = fs.readFileSync(page.file, "utf8");
  const tables = extractTables(html).map((table) => tableGridFromHtml(table));
  const records = [];
  for (const [tableIndex, grid] of tables.entries()) {
    if (!grid.length) continue;
    const header = grid[0].join("|");
    if (header.includes("专业组") && header.includes("最低分")) {
      for (let rowIndex = 1; rowIndex < grid.length; rowIndex += 1) {
        const row = grid[rowIndex];
        const record = makeOverallRecord({
          page,
          row,
          rowIndex,
          sourceSubjectRaw: row[1],
          majorGroup: row[2],
          controlScoreRaw: row[3],
          maxScoreRaw: row[4],
          minScoreRaw: row[5],
          averageScoreRaw: row[6],
          dataType: "major-group-admission",
          section: "普通类非定向专业组录取",
        });
        if (record) records.push(record);
        else audit.skippedRows.push({ year: page.year, kind: "overall-major-group", tableIndex, rowIndex, reason: "invalid-row", row });
      }
      continue;
    }
    if (header.includes("科类") && header.includes("最低分")) {
      for (let rowIndex = 1; rowIndex < grid.length; rowIndex += 1) {
        const row = grid[rowIndex];
        const record = makeOverallRecord({
          page,
          row,
          rowIndex,
          sourceSubjectRaw: row[1],
          majorGroup: "",
          controlScoreRaw: row[2],
          maxScoreRaw: row[3],
          minScoreRaw: row[4],
          averageScoreRaw: row[5],
          dataType: "institution-admission",
          section: "普通类非定向分省录取",
        });
        if (record) records.push(record);
        else audit.skippedRows.push({ year: page.year, kind: "overall-province", tableIndex, rowIndex, reason: "invalid-row", row });
      }
      continue;
    }
    if (grid.length >= 4 && grid[1]?.join("|").includes("文史") && grid[1]?.join("|").includes("理工")) {
      for (let rowIndex = 3; rowIndex < grid.length; rowIndex += 1) {
        const row = grid[rowIndex];
        if (row.length < 9) continue;
        const history = makeOverallRecord({
          page,
          row,
          rowIndex,
          sourceSubjectRaw: "文史",
          majorGroup: "",
          controlScoreRaw: row[1],
          maxScoreRaw: row[2],
          minScoreRaw: row[3],
          averageScoreRaw: row[4],
          dataType: "institution-admission",
          section: "传统文理省份普通类非定向录取",
        });
        const physics = makeOverallRecord({
          page,
          row,
          rowIndex,
          sourceSubjectRaw: "理工",
          majorGroup: "",
          controlScoreRaw: row[5],
          maxScoreRaw: row[6],
          minScoreRaw: row[7],
          averageScoreRaw: row[8],
          dataType: "institution-admission",
          section: "传统文理省份普通类非定向录取",
        });
        if (history) records.push(history);
        if (physics) records.push(physics);
      }
    }
  }
  return records;
}

function buildRecords(raw) {
  const audit = {
    majorPagesWithoutTable: [],
    skippedRows: [],
  };
  const records = [
    ...raw.majorPages.flatMap((page) => parseMajorPage(page, audit)),
    ...raw.overallPages.flatMap((page) => parseOverallPage(page, audit)),
  ];
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`Duplicate SUDA record id: ${record.id}`);
    ids.add(record.id);
  }
  return { records, audit };
}

function buildSourceNote(raw, records, audit) {
  const rawFiles = [raw.listFile, ...raw.majorPages.map((page) => page.file), ...raw.overallPages.map((page) => page.file)];
  const years = [...new Set(records.map((record) => record.year))].sort((a, b) => a - b);
  const provinces = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  return {
    id: SOURCE.id,
    title: "苏州大学本科招生网：2023-2025年全国分省分专业及各省录取分数",
    publisher: SOURCE.schoolName,
    url: LIST_URL,
    pageUrl: LIST_URL,
    majorPagePattern: "https://zsb.suda.edu.cn/view_markhistory.aspx?aa={year}年{province}各专业录取分数一览表&aid={provinceIndex}&ay={year}",
    overallPageUrls: Object.fromEntries(OVERALL_PAGE_URLS),
    quality: SOURCE.quality,
    usage: "抽取苏州大学本科招生网官方历年分数 HTML 页面；2023-2025 年分省分专业页按专业最低分保存，各省整体页按学校/专业组最低分保存。普通学校官网单校行作候选边界复核，艺术、体育、专项、民族/预科、内高班等特殊入口隔离为特殊路径。",
    parsedRecords: records.length,
    provinceCount: provinces.length,
    years,
    majorPages: raw.majorPages.length,
    overallPages: raw.overallPages.length,
    majorRecords: records.filter((record) => record.dataType === "major-admission").length,
    majorGroupRecords: records.filter((record) => record.dataType === "major-group-admission").length,
    institutionRecords: records.filter((record) => record.dataType === "institution-admission").length,
    recordsWithRank: records.filter((record) => record.minRankEnd).length,
    recordsWithoutRank: records.filter((record) => !record.minRankEnd).length,
    ordinarySchoolOfficialRecords: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRecords: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    majorPagesWithoutTable: audit.majorPagesWithoutTable.length,
    majorPagesWithoutTableDetail: audit.majorPagesWithoutTable,
    skippedRows: audit.skippedRows.length,
    skippedRowsDetail: audit.skippedRows.slice(0, 250),
    byYear: countBy(records, (record) => record.year),
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byDataType: countBy(records, (record) => record.dataType),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    scoreRange: numericRange(records.map((record) => record.minScore)),
    rawPaths: rawFiles.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: rawFiles.map((file) => ({
      path: path.relative(PROJECT_ROOT, file),
      sha256: sha256File(file),
    })),
    transcriptionMethod: "official-html-table",
    cautions: [
      "本源为苏州大学官方单校历年录取分数页面，不是任何省级教育考试院全量投档/录取分数表。",
      "源表未公开最低位次，运行层不生成假位次；推荐层不得仅凭该单校分数输出录取概率。",
      "普通学校官网单校行按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "艺术、体育、专项、民族/预科、内高班等特殊入口按 formalScoreScope=special-path-only 隔离。",
      "源表跨年包含旧文理、新高考、综合改革、专业组和专业投档口径；运行层保留 sourceSubjectRaw/majorGroup，不改写成省级统一表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
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
  const sourceNotes = [buildSourceNote(raw, records, audit)];
  const outPath = path.join(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes, records }, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    out: args.out,
    sourceId: SOURCE.id,
    records: records.length,
    majorRecords: sourceNotes[0].majorRecords,
    majorGroupRecords: sourceNotes[0].majorGroupRecords,
    institutionRecords: sourceNotes[0].institutionRecords,
    recordsWithRank: sourceNotes[0].recordsWithRank,
    recordsWithoutRank: sourceNotes[0].recordsWithoutRank,
    provinces: sourceNotes[0].provinceCount,
    years: sourceNotes[0].years,
    byFormalScoreScope: sourceNotes[0].byFormalScoreScope,
    byDataType: sourceNotes[0].byDataType,
    majorPagesWithoutTable: sourceNotes[0].majorPagesWithoutTable,
    skippedRows: sourceNotes[0].skippedRows,
    sha256: sha256File(outPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
