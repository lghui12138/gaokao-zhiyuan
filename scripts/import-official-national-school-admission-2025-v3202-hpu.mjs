#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3202-hpu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3202-hpu";
const INDEX_URL = "https://www6.hpu.edu.cn/web5/zsxxw/lnfs.htm";
const SOURCE = {
  id: "official-hpu-national-2025-school-major-admission",
  quality: "official-school-hpu-2025-national-major-html-score-rank",
  schoolCode: "10460",
  schoolName: "河南理工大学",
  city: "焦作",
  tags: ["理工", "河南", "河南理工大学"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

const PROVINCE_ALIASES = new Map([
  ["北京市", "北京"],
  ["天津市", "天津"],
  ["河北省", "河北"],
  ["山西省", "山西"],
  ["内蒙古自治区", "内蒙古"],
  ["辽宁省", "辽宁"],
  ["吉林省", "吉林"],
  ["黑龙江", "黑龙江"],
  ["黑龙江省", "黑龙江"],
  ["上海市", "上海"],
  ["江苏省", "江苏"],
  ["浙江省", "浙江"],
  ["安徽省", "安徽"],
  ["福建省", "福建"],
  ["江西省", "江西"],
  ["山东省", "山东"],
  ["河南省", "河南"],
  ["湖北省", "湖北"],
  ["湖南省", "湖南"],
  ["广东省", "广东"],
  ["广西自治区", "广西"],
  ["广西壮族自治区", "广西"],
  ["海南省", "海南"],
  ["重庆市", "重庆"],
  ["四川省", "四川"],
  ["贵州省", "贵州"],
  ["云南省", "云南"],
  ["西藏自治区", "西藏"],
  ["陕西省", "陕西"],
  ["甘肃省", "甘肃"],
  ["青海省", "青海"],
  ["宁夏回族自治区", "宁夏"],
  ["新疆维吾尔自治区", "新疆"],
]);

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

const ART_PATTERN = /艺术|美术|音乐|舞蹈|设计学类|视觉传达|环境设计|产品设计|绘画|表演|编导/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3202-hpu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3202-hpu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Henan Polytechnic University official 2025 province major admission pages.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--out") {
      args.out = argv[++i];
      continue;
    }
    if (arg === "--use-cache") {
      args.useCache = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

function guardProjectRoot() {
  if (PROJECT_ROOT.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing to run HTML ingestion from /Volumes/mac_2T; run this importer from the internal APFS project copy.");
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveProjectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 18);
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      if (text.length < 100) throw new Error(`Unexpectedly short HTML (${text.length} chars) for ${url}`);
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function downloadText(rawRoot, relPath, url, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const text = await fetchText(url);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text);
  return text;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function clean(value) {
  return decodeHtml(value)
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return clean(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function compactNumberText(value) {
  return clean(value)
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248))
    .replace(/，/g, ",")
    .replace(/(?<=\d)\s+(?=\d)/g, "")
    .replace(/\s*([/\\])\s*/g, "$1")
    .trim();
}

function extractTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function attrNumber(attrs, name, fallback = 1) {
  const match = String(attrs ?? "").match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Number(match[1]) : fallback;
}

function tableRows(tableHtml) {
  const rows = [];
  const spans = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of String(tableHtml).matchAll(rowRe)) {
    const row = [];
    for (let col = 0; col < spans.length; col += 1) {
      if (spans[col]) {
        row[col] = spans[col].text;
        spans[col].remaining -= 1;
        if (spans[col].remaining <= 0) spans[col] = null;
      }
    }
    let col = 0;
    const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    for (const cellMatch of rowMatch[1].matchAll(cellRe)) {
      while (row[col] != null) col += 1;
      const attrs = cellMatch[1];
      const text = stripTags(cellMatch[2]);
      const rowspan = attrNumber(attrs, "rowspan", 1);
      const colspan = attrNumber(attrs, "colspan", 1);
      for (let offset = 0; offset < colspan; offset += 1) {
        row[col + offset] = text;
        if (rowspan > 1) spans[col + offset] = { text, remaining: rowspan - 1 };
      }
      col += colspan;
    }
    const cleaned = row.map((cell) => clean(cell));
    if (cleaned.some(Boolean)) rows.push(cleaned);
  }
  return rows;
}

function tablesWithContext(html) {
  const tables = [];
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  for (const match of String(html).matchAll(tableRe)) {
    const before = html.slice(Math.max(0, match.index - 900), match.index);
    tables.push({
      html: match[0],
      context: meaningfulContext(before),
    });
  }
  return tables;
}

function meaningfulContext(rawHtml) {
  const text = stripTags(rawHtml)
    .replace(/&quot;/g, '"')
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");
  for (const marker of ["河南理工大学", "年分省分专业录取分数情况", "分专业录取分数情况"]) {
    const index = text.lastIndexOf(marker);
    if (index >= 0) return clean(text.slice(index, index + 180));
  }
  const patterns = [
    /河南理工大学\s*202\s*5\s*年[^";<>]{0,140}/g,
    /河南理工大学\s*2025\s*年[^";<>]{0,140}/g,
    /年分省分专业录取分数情况[^";<>]{0,120}/g,
    /分专业录取分数情况[^";<>]{0,120}/g,
  ];
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)].map((match) => clean(match[0]));
    const found = matches.filter(Boolean).at(-1);
    if (found) return found;
  }
  return clean(text.slice(-160));
}

function headerKey(cell) {
  const text = clean(cell).replace(/\s+/g, "");
  if (/^专业.*名称$/.test(text) || text === "专业名称" || text === "专业(类)名称" || text === "专业（类）名称") return "majorName";
  if (text === "分组") return "majorGroupCode";
  if (text === "计划人数") return "planCount";
  if (text === "录取人数" || text === "录取人数") return "admissionCount";
  if (text === "选考科目" || text === "科类" || text === "类别") return "subjectRaw";
  if (text === "最高分") return "maxScore";
  if (text.includes("平均分") && text.includes("位次")) return "avgScoreRank";
  if (text === "平均分") return "avgScore";
  if (text.includes("最低分") && text.includes("位次")) return "minScoreRank";
  if (text === "最低分") return "minScore";
  if (text === "省控线") return "controlLine";
  if (text === "类型") return "admissionSubtypeRaw";
  if (text === "备注") return "remark";
  return "";
}

function headerMap(header) {
  const map = new Map();
  header.forEach((cell, index) => {
    const key = headerKey(cell);
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

function getCell(row, map, key) {
  const index = map.get(key);
  return index == null ? "" : clean(row[index]);
}

function firstNumber(value) {
  const text = compactNumberText(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function integerNumber(value) {
  const n = firstNumber(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseScoreRank(value) {
  const text = compactNumberText(value).replace(/,/g, "");
  if (!text) return { score: null, rank: null };
  const parts = text.split(/[/\\]/);
  const score = firstNumber(parts[0] || text);
  const rank = parts.length > 1 ? integerNumber(parts.slice(1).join("")) : null;
  return { score, rank };
}

function normalizeProvince(raw) {
  const text = clean(raw);
  if (PROVINCE_ALIASES.has(text)) return PROVINCE_ALIASES.get(text);
  if (MAINLAND_PROVINCES.has(text)) return text;
  const simple = text.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
  return PROVINCE_ALIASES.get(simple) || simple;
}

function normalizeSubject(province, raw, majorName, context) {
  const text = [raw, majorName, context].map(clean).join(" ");
  if (ART_PATTERN.test(text)) return "艺术类";
  if (/体育|社会体育/.test(text)) return "体育类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合改革";
  return clean(raw) || "官网未列科类";
}

function isSummaryRow(majorName) {
  return /合计|总计/.test(clean(majorName));
}

function isVocationalRow(province, majorName, context, controlLine) {
  const text = [province, majorName, context].map(clean).join(" ");
  return /高职|专科|民政服务|养老服务|殡葬/.test(text) || (province === "河南" && Number(controlLine) === 185);
}

function classifyAdmission(context, admissionSubtypeRaw, majorName, subjectRaw, dataType) {
  const text = [context, admissionSubtypeRaw, majorName, subjectRaw].map(clean).join(" ");
  if (/专升本/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "专升本", formalScoreScope: "special-path-only" };
  }
  if (/退役士兵/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "退役大学生士兵", formalScoreScope: "special-path-only" };
  }
  if (/建档立卡/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "建档立卡贫困家庭", formalScoreScope: "special-path-only" };
  }
  if (/南疆|哈密|定向|预科|民族|内高班|专项/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "南疆/定向/预科/专项等", formalScoreScope: "special-path-only" };
  }
  if (ART_PATTERN.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|社会体育/.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/中外合作|较高收费|单列|软件/.test(text)) {
    return { admissionType: "特殊收费或单列专业", admissionSubtype: "中外合作/单列专业", formalScoreScope: "school-official-only" };
  }
  if (dataType === "vocational-admission") {
    return { admissionType: "普通高职专科录取", admissionSubtype: "普通高职专科", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch(context, classification, dataType) {
  const text = [context, classification.admissionSubtype, classification.admissionType].map(clean).join(" ");
  if (dataType === "vocational-admission") return "高职（专科）批";
  if (/专升本/.test(text)) return "专升本";
  if (/退役士兵/.test(text)) return "退役大学生士兵专项";
  if (/建档立卡/.test(text)) return "建档立卡专项";
  if (/南疆|哈密|定向|预科|民族|专项/.test(text)) return "特殊类型批次";
  if (/艺术/.test(text)) return "艺术类批次";
  if (/体育/.test(text)) return "体育类批次";
  return "本科批";
}

function scoreMetric(classification, dataType) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  if (dataType === "vocational-admission") return "高职专科学校官网录取分";
  return "高考文化分";
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || "";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

function scoreRange(records) {
  const scores = records.map((record) => record.minScore).filter(Number.isFinite);
  return scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : { min: null, max: null };
}

function rawProvinceName(province) {
  return `hpu-2025-province-${PROVINCE_SLUGS.get(province) || stableId([province])}.html`;
}

function rawDetailName(province) {
  return `hpu-2025-detail-${PROVINCE_SLUGS.get(province) || stableId([province])}.html`;
}

function rawTextAround(html, tableHtml) {
  const index = html.indexOf(tableHtml);
  if (index < 0) return "";
  return meaningfulContext(html.slice(Math.max(0, index - 900), index));
}

function parseProvinceAreas(indexHtml) {
  const areas = [];
  for (const match of indexHtml.matchAll(/<area\b([^>]+)>/gi)) {
    const attrs = match[1];
    const title = attrs.match(/\btitle\s*=\s*"([^"]+)"/i)?.[1] || "";
    const href = attrs.match(/\bhref\s*=\s*"([^"]+)"/i)?.[1] || "";
    if (!href || !title) continue;
    const province = normalizeProvince(title);
    if (!MAINLAND_PROVINCES.has(province)) continue;
    areas.push({
      sourceProvinceRaw: clean(title),
      province,
      provincePageUrl: new URL(href, INDEX_URL).href,
    });
  }
  const byProvince = new Map();
  for (const area of areas) {
    if (!byProvince.has(area.province)) byProvince.set(area.province, area);
  }
  return [...byProvince.values()].sort((a, b) => a.province.localeCompare(b.province, "zh-Hans-CN"));
}

function findYearLink(provincePageHtml, provincePageUrl) {
  for (const match of provincePageHtml.matchAll(/<a[^>]+href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const label = stripTags(match[2]);
    if (/^2025年$/.test(label)) return new URL(href, provincePageUrl).href;
  }
  return "";
}

function parseTables(detailHtml, page, rawDetailPath) {
  const records = [];
  const skippedRows = [];
  const tableSummaries = [];
  const tables = tablesWithContext(detailHtml);
  tables.forEach((table, tableIndex) => {
    const rows = tableRows(table.html);
    const headerIndex = rows.findIndex((row) => row.some((cell) => /专业/.test(cell)) && row.some((cell) => /最低分/.test(cell)));
    if (headerIndex < 0) return;
    const header = rows[headerIndex];
    const map = headerMap(header);
    if (!map.has("majorName") || (!map.has("minScore") && !map.has("minScoreRank"))) {
      skippedRows.push({
        reason: "unsupported-header",
        province: page.province,
        tableIndex,
        tableContext: table.context || rawTextAround(detailHtml, table.html),
        headers: header,
      });
      return;
    }
    const tableContext = table.context || rawTextAround(detailHtml, table.html);
    const tableRecords = [];
    rows.slice(headerIndex + 1).forEach((row, rowIndex) => {
      const majorName = getCell(row, map, "majorName");
      const sourceSubjectRaw = getCell(row, map, "subjectRaw");
      const admissionSubtypeRaw = getCell(row, map, "admissionSubtypeRaw");
      const minScoreRank = parseScoreRank(getCell(row, map, "minScoreRank"));
      const avgScoreRank = parseScoreRank(getCell(row, map, "avgScoreRank"));
      const minScoreRaw = getCell(row, map, "minScoreRank") || getCell(row, map, "minScore");
      const avgScoreRaw = getCell(row, map, "avgScoreRank") || getCell(row, map, "avgScore");
      const maxScoreRaw = getCell(row, map, "maxScore");
      const controlLineRaw = getCell(row, map, "controlLine");
      const minScore = Number.isFinite(minScoreRank.score) ? minScoreRank.score : firstNumber(getCell(row, map, "minScore"));
      const avgScore = Number.isFinite(avgScoreRank.score) ? avgScoreRank.score : firstNumber(getCell(row, map, "avgScore"));
      const maxScore = firstNumber(maxScoreRaw);
      const controlLine = firstNumber(controlLineRaw);
      if (!majorName || !Number.isFinite(minScore)) {
        skippedRows.push({
          reason: "missing-major-or-min-score",
          province: page.province,
          tableIndex,
          rowIndex,
          tableContext,
          headers: header,
          cells: row,
          minScoreRaw,
        });
        return;
      }
      if (minScore > 750 || minScore < 0) {
        skippedRows.push({
          reason: "score-out-of-range",
          province: page.province,
          tableIndex,
          rowIndex,
          tableContext,
          majorName,
          minScore,
          cells: row,
        });
        return;
      }
      const dataType = isSummaryRow(majorName)
        ? "institution-admission"
        : isVocationalRow(page.province, majorName, tableContext, controlLine)
          ? "vocational-admission"
          : "major-admission";
      const classification = classifyAdmission(tableContext, admissionSubtypeRaw, majorName, sourceSubjectRaw, dataType);
      const subjectType = normalizeSubject(page.province, sourceSubjectRaw || majorName, majorName, tableContext);
      const rankUnavailable = !Number.isFinite(minScoreRank.rank);
      const majorGroupCode = getCell(row, map, "majorGroupCode");
      const planCount = integerNumber(getCell(row, map, "planCount"));
      const admissionCount = integerNumber(getCell(row, map, "admissionCount"));
      const record = {
        id: `2025-hpu-${dataType.replace(/-.*/, "")}-${stableId([
          page.province,
          page.detailUrl,
          tableIndex,
          rowIndex,
          majorGroupCode,
          majorName,
          sourceSubjectRaw,
          admissionSubtypeRaw,
          minScore,
          minScoreRank.rank ?? "",
        ])}`,
        province: page.province,
        sourceProvinceRaw: page.sourceProvinceRaw,
        year: 2025,
        subjectType,
        sourceSubjectRaw,
        batch: normalizeBatch(tableContext, classification, dataType),
        sourceBatchRaw: tableContext,
        schoolCode: SOURCE.schoolCode,
        schoolName: SOURCE.schoolName,
        city: SOURCE.city,
        schoolTags: SOURCE.tags,
        dataType,
        majorName: isSummaryRow(majorName) ? "学校录取汇总" : majorName,
        majorGroup: majorGroupCode || [SOURCE.schoolName, page.province, subjectType, majorName].filter(Boolean).join("-"),
        admissionType: classification.admissionType,
        admissionSubtype: classification.admissionSubtype,
        formalScoreScope: classification.formalScoreScope,
        minScore,
        scoreMetric: scoreMetric(classification, dataType),
        scoreOnly: rankUnavailable,
        rankUnavailable,
        sourceId: SOURCE.id,
        sourceQuality: SOURCE.quality,
        schoolOfficialScope: rankUnavailable ? "single-school-score" : "single-school-score-rank",
        sourceUrl: page.detailUrl,
        sourcePageUrl: page.detailUrl,
        sourceIndexUrl: INDEX_URL,
        sourceProvincePageUrl: page.provincePageUrl,
        officialEvidencePath: rawDetailPath,
        sourceHtmlPath: rawDetailPath,
        sourceMinScoreRaw: minScoreRaw,
        sourceAvgScoreRaw: avgScoreRaw,
        sourceMaxScoreRaw: maxScoreRaw,
        sourceControlLineRaw: controlLineRaw,
        sourceRankRaw: getCell(row, map, "minScoreRank"),
        rawRow: {
          source: "hpu-2025-official-html-table",
          tableIndex,
          rowIndex,
          tableContext,
          headers: header,
          cells: row,
          sourceProvinceRaw: page.sourceProvinceRaw,
          normalizedProvince: page.province,
        },
        cautions: [
          `本记录来自河南理工大学招生就业处官方 2025 年“${page.sourceProvinceRaw}”历年分数页，是单校录取边界，不是省级教育考试院全量投档/录取分数表。`,
          rankUnavailable
            ? "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
            : "本行含学校官网公布的最低分位次，但仍是单校来源；推荐层只能用于河南理工大学候选边界复核。",
          classification.formalScoreScope === "special-path-only"
            ? "本行属于艺体、专升本、建档立卡、退役士兵、南疆/定向/预科/专项等特殊路径，运行层按 special-path-only 隔离，不与普通批次边界混用。"
            : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
          "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
        ],
      };
      if (Number.isFinite(planCount)) record.planCount = planCount;
      if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
      if (Number.isFinite(controlLine)) record.controlLine = controlLine;
      if (Number.isFinite(maxScore)) record.maxScore = maxScore;
      if (Number.isFinite(avgScore)) record.avgScore = avgScore;
      if (Number.isFinite(minScoreRank.rank)) record.minRank = minScoreRank.rank;
      if (Number.isFinite(avgScoreRank.rank)) record.avgRank = avgScoreRank.rank;
      if (admissionSubtypeRaw) record.sourceAdmissionSubtypeRaw = admissionSubtypeRaw;
      tableRecords.push(record);
      records.push(record);
    });
    tableSummaries.push({
      tableIndex,
      tableContext,
      headers: header,
      records: tableRecords.length,
      recordsWithRank: tableRecords.filter((record) => !record.rankUnavailable).length,
      recordsWithoutRank: tableRecords.filter((record) => record.rankUnavailable).length,
      byFormalScoreScope: countBy(tableRecords, (record) => record.formalScoreScope),
      byDataType: countBy(tableRecords, (record) => record.dataType),
    });
  });
  return { records, skippedRows, tableSummaries };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const indexHtml = await downloadText(rawRoot, "hpu-2025-lnfs-index.html", INDEX_URL, args.useCache);
  if (!/河南理工大学招生就业处/.test(extractTitle(indexHtml))) {
    throw new Error(`Unexpected HPU index title: ${extractTitle(indexHtml)}`);
  }

  const provinceAreas = parseProvinceAreas(indexHtml);
  const records = [];
  const skippedRows = [];
  const missingProvincePages = [];
  const pageSummaries = [];
  const rawPaths = [path.posix.join(RAW_DIR, "hpu-2025-lnfs-index.html")];

  for (const area of provinceAreas) {
    const provinceRawName = rawProvinceName(area.province);
    const provinceHtml = await downloadText(rawRoot, provinceRawName, area.provincePageUrl, args.useCache);
    rawPaths.push(path.posix.join(RAW_DIR, provinceRawName));
    const detailUrl = findYearLink(provinceHtml, area.provincePageUrl);
    if (!detailUrl) {
      missingProvincePages.push({
        province: area.province,
        sourceProvinceRaw: area.sourceProvinceRaw,
        provincePageUrl: area.provincePageUrl,
        reason: "no-2025-link-on-official-province-page",
      });
      continue;
    }
    const detailRaw = rawDetailName(area.province);
    const detailRawPath = path.posix.join(RAW_DIR, detailRaw);
    const detailHtml = await downloadText(rawRoot, detailRaw, detailUrl, args.useCache);
    rawPaths.push(detailRawPath);
    if (!/河南理工大学招生就业处/.test(extractTitle(detailHtml))) {
      throw new Error(`Unexpected HPU detail title for ${area.province}: ${extractTitle(detailHtml)}`);
    }
    const page = {
      ...area,
      detailUrl,
    };
    const parsed = parseTables(detailHtml, page, detailRawPath);
    records.push(...parsed.records);
    skippedRows.push(...parsed.skippedRows);
    pageSummaries.push({
      province: area.province,
      sourceProvinceRaw: area.sourceProvinceRaw,
      provincePageUrl: area.provincePageUrl,
      detailUrl,
      provinceRawPath: path.posix.join(RAW_DIR, provinceRawName),
      rawPath: detailRawPath,
      records: parsed.records.length,
      skippedRows: parsed.skippedRows.length,
      recordsWithRank: parsed.records.filter((record) => !record.rankUnavailable).length,
      recordsWithoutRank: parsed.records.filter((record) => record.rankUnavailable).length,
      byFormalScoreScope: countBy(parsed.records, (record) => record.formalScoreScope),
      byDataType: countBy(parsed.records, (record) => record.dataType),
      tableSummaries: parsed.tableSummaries,
    });
  }

  if (records.length < 800) throw new Error(`Parsed too few HPU records: ${records.length}`);
  const duplicateIds = records.length - new Set(records.map((record) => record.id)).size;
  if (duplicateIds) throw new Error(`Duplicate record ids in HPU import: ${duplicateIds}`);

  const provincesWithRecords = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingMainland = [...MAINLAND_PROVINCES].filter((province) => !provincesWithRecords.includes(province)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const recordsWithRank = records.filter((record) => !record.rankUnavailable).length;
  const recordsWithoutRank = records.length - recordsWithRank;
  const ordinarySchoolOfficialRecords = records.filter((record) => record.formalScoreScope === "school-official-only").length;
  const specialPathRecords = records.filter((record) => record.formalScoreScope === "special-path-only").length;

  const payload = {
    sourceNotes: [
      {
        id: SOURCE.id,
        title: "河南理工大学招生就业处：2025年全国分省分专业录取分数情况",
        publisher: "河南理工大学招生就业处",
        url: INDEX_URL,
        quality: SOURCE.quality,
        usage: "从河南理工大学招生就业处官方“历年分数”地图页进入各省页面，再定位 2025 年官方 HTML 表。抽取专业（类）名称、分组、计划人数、录取人数、选考科目、最高分、平均分/位次、最低分/位次、省控线、类型等字段；学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
        parsedRecords: records.length,
        skippedOfficialRows: skippedRows.length,
        provincePageCount: provinceAreas.length,
        detailPageCount: pageSummaries.length,
        provinceCount: provincesWithRecords.length,
        provincesWithRecords,
        missingMainlandProvinces: missingMainland,
        missingProvincePages,
        years: [2025],
        recordsWithRank,
        recordsWithoutRank,
        ordinarySchoolOfficialRecords,
        specialPathRecords,
        vocationalRecords: records.filter((record) => record.dataType === "vocational-admission").length,
        byProvince: countBy(records, (record) => record.province),
        bySourceProvinceRaw: countBy(records, (record) => record.sourceProvinceRaw),
        bySubjectType: countBy(records, (record) => record.subjectType),
        byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
        byAdmissionType: countBy(records, (record) => record.admissionType),
        byAdmissionSubtype: countBy(records, (record) => record.admissionSubtype),
        byBatch: countBy(records, (record) => record.batch),
        byDataType: countBy(records, (record) => record.dataType),
        scoreRange: scoreRange(records),
        pageSummaries,
        skippedRows,
        rawPaths,
        cautions: [
          "本导入包来自河南理工大学学校官网单校分数/位次数据，不关闭任何省级正式投档表缺口。",
          "西藏官方省份页未列 2025 年链接，本包不生成西藏假记录。",
          "艺体、专升本、建档立卡、退役士兵、南疆/哈密定向等特殊入口按 special-path-only 隔离，不与普通批次混用。",
          "普通学校官网单校行按 school-official-only 保留；高职专科行只作为学校官网专科候选边界，不替代省级专科正式投档表。",
        ],
      },
    ],
    records,
  };

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    out: args.out,
    records: records.length,
    skippedOfficialRows: skippedRows.length,
    provincePageCount: provinceAreas.length,
    detailPageCount: pageSummaries.length,
    provincesWithRecords: provincesWithRecords.length,
    missingMainlandProvinces: missingMainland,
    missingProvincePages,
    recordsWithRank,
    recordsWithoutRank,
    ordinarySchoolOfficialRecords,
    specialPathRecords,
    vocationalRecords: payload.sourceNotes[0].vocationalRecords,
    byFormalScoreScope: payload.sourceNotes[0].byFormalScoreScope,
    byAdmissionType: payload.sourceNotes[0].byAdmissionType,
    byDataType: payload.sourceNotes[0].byDataType,
    scoreRange: payload.sourceNotes[0].scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
