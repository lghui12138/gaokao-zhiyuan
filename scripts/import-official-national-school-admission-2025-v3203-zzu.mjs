#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3203-zzu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3203-zzu";
const INDEX_URL = "https://ao.zzu.edu.cn/xxgk/lnlq_.htm";
const SOURCE = {
  id: "official-zzu-national-2025-school-major-admission",
  quality: "official-school-zzu-2025-national-major-html-score-rank",
  schoolCode: "10459",
  schoolName: "郑州大学",
  city: "郑州",
  tags: ["双一流", "综合", "河南", "郑州大学"],
};

const PROVINCE_ORDER = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
];
const MAINLAND_PROVINCES = new Set(PROVINCE_ORDER);

const PROVINCE_ALIASES = new Map([
  ["北京市", "北京"],
  ["天津市", "天津"],
  ["河北省", "河北"],
  ["山西省", "山西"],
  ["内蒙古自治区", "内蒙古"],
  ["辽宁省", "辽宁"],
  ["吉林省", "吉林"],
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

const ZZU_URL_SLUGS = new Map([
  ["北京", "bj"],
  ["天津", "tj"],
  ["河北", "hb"],
  ["山西", "sx"],
  ["内蒙古", "nmg"],
  ["辽宁", "ln"],
  ["吉林", "jl"],
  ["黑龙江", "hlj"],
  ["上海", "sh"],
  ["江苏", "js"],
  ["浙江", "zj"],
  ["安徽", "ah"],
  ["福建", "fj"],
  ["江西", "jx"],
  ["山东", "sd"],
  ["河南", "hn2"],
  ["湖北", "hb1"],
  ["湖南", "hn1"],
  ["广东", "gd"],
  ["广西", "gx"],
  ["海南", "hn"],
  ["重庆", "zq"],
  ["四川", "sc"],
  ["贵州", "gz"],
  ["云南", "yn"],
  ["西藏", "xz"],
  ["陕西", "sx1"],
  ["甘肃", "gs"],
  ["青海", "qh"],
  ["宁夏", "nx"],
  ["新疆", "xj"],
]);

const RAW_SLUGS = new Map([
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

const NEW_GAOKAO_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const ART_PATTERN = /艺术|美术|音乐|舞蹈|设计|视觉传达|环境设计|绘画|国画|书法|雕塑|表演|播音|编导/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3203-zzu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3203-zzu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Zhengzhou University official 2025 province major admission pages.",
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
          referer: INDEX_URL,
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      if (text.length < 100) throw new Error(`Unexpectedly short HTML (${text.length} chars) for ${url}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function downloadText(rawRoot, relPath, url, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8").replace(/\0/g, "");
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
      const isLayoutTitle = colspan >= 4 && /郑州大学|录取情况/.test(text) && !/专业名称|科类|最低分|最高分|位次/.test(text);
      for (let offset = 0; offset < colspan; offset += 1) {
        row[col + offset] = text;
        if (!isLayoutTitle && text && rowspan > 1) spans[col + offset] = { text, remaining: rowspan - 1 };
      }
      col += colspan;
    }
    const cleaned = row.map((cell) => clean(cell));
    if (cleaned.some(Boolean)) rows.push(cleaned);
  }
  return rows;
}

function meaningfulContext(rawHtml) {
  const text = stripTags(rawHtml)
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");
  const matches = [...text.matchAll(/(?:2025年)?郑州大学在[^录。；;]{1,40}录取情况(?:表)?/g)]
    .map((match) => clean(match[0]))
    .filter(Boolean);
  return matches.at(-1) || clean(text.slice(-180));
}

function tablesWithContext(html) {
  const tables = [];
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  for (const match of String(html).matchAll(tableRe)) {
    const before = html.slice(Math.max(0, match.index - 1200), match.index);
    tables.push({
      html: match[0],
      context: meaningfulContext(before),
    });
  }
  return tables;
}

function headerKey(cell) {
  const text = clean(cell).replace(/\s+/g, "");
  if (text === "科类" || text === "类别" || text === "选科要求") return "subjectRaw";
  if (/^专业.*名称$/.test(text) || text === "专业" || text === "录取专业") return "majorName";
  if (text === "专业组" || text === "院校专业组") return "majorGroupCode";
  if (text === "招生类别" || text === "录取类型" || text === "统计类型") return "admissionSubtypeRaw";
  if (text === "录取人数" || text === "录取数") return "admissionCount";
  if (text === "计划人数" || text === "计划数") return "planCount";
  if (text === "控制线" || text === "省控线" || text === "批次线") return "controlLine";
  if (/最高分/.test(text)) return "maxScore";
  if (/平均分/.test(text)) return "avgScore";
  if (/最低分位次|最低位次|最低分排名|位次$/.test(text)) return "minRank";
  if (/最低分高出线|最低超线|高出线/.test(text)) return "minScoreAboveControl";
  if (/录取最低分|最低分/.test(text)) return "minScore";
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

function normalizeProvince(raw) {
  const text = clean(raw);
  if (PROVINCE_ALIASES.has(text)) return PROVINCE_ALIASES.get(text);
  if (MAINLAND_PROVINCES.has(text)) return text;
  const simple = text.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
  return PROVINCE_ALIASES.get(simple) || simple;
}

function normalizeSubject(province, raw, majorName, context) {
  const rowText = [raw, majorName].map(clean).join(" ");
  if (ART_PATTERN.test(rowText)) return "艺术类";
  if (/体育|社会体育/.test(rowText)) return "体育类";
  if (/历史|文史|文科/.test(rowText)) return "历史类";
  if (/物理|理工|理科/.test(rowText)) return "物理类";
  if (/综合改革|不限|选科/.test(rowText) || NEW_GAOKAO_PROVINCES.has(province)) return "综合改革";
  return clean(raw) || "官网未列科类";
}

function inferTableContext(rows, headerIndex, fallback) {
  for (let index = headerIndex - 1; index >= 0; index -= 1) {
    const unique = [...new Set(rows[index].map(clean).filter(Boolean))];
    const titleCell = unique.find((cell) => /^2025年郑州大学在.+录取情况(?:表)?$/.test(cell));
    if (titleCell) return titleCell;
    const titleMatch = clean(unique.join(" ")).match(/2025年郑州大学在[^录。；;]{1,40}录取情况(?:表)?/);
    if (titleMatch) return titleMatch[0];
  }
  const beforeRows = rows.slice(0, headerIndex).map((row) => [...new Set(row.filter(Boolean))].join(" "));
  const text = clean(beforeRows.join(" "));
  return meaningfulContext(text) || clean(text) || fallback;
}

function isSummaryRow(majorName) {
  return /合计|总计|小计/.test(clean(majorName));
}

function classifyAdmission(context, admissionSubtypeRaw, majorName, subjectRaw) {
  const rowText = [admissionSubtypeRaw, majorName, subjectRaw].map(clean).join(" ");
  const contextText = clean(context);
  const allText = [contextText, rowText].join(" ");
  if (/高校专项/.test(allText)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "高校专项", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(allText)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "国家专项", formalScoreScope: "special-path-only" };
  }
  if (/地方专项/.test(allText)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "地方专项", formalScoreScope: "special-path-only" };
  }
  if (/预科|民族|内高班|单列|定向|专项/.test(allText)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "预科/民族/单列/定向/专项等", formalScoreScope: "special-path-only" };
  }
  if (ART_PATTERN.test(rowText)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|社会体育/.test(rowText)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/中外合作|国际化班|软件/.test(allText)) {
    return { admissionType: "特殊收费或单列专业", admissionSubtype: "中外合作/特殊收费", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function normalizeBatch(context, classification) {
  const text = [context, classification.admissionSubtype, classification.admissionType].map(clean).join(" ");
  if (classification.admissionType === "艺术类录取") return "艺术类批次";
  if (classification.admissionType === "体育类录取") return "体育类批次";
  if (/高校专项/.test(text)) return "高校专项";
  if (/国家专项/.test(text)) return "国家专项";
  if (/地方专项/.test(text)) return "地方专项";
  if (/预科|民族|单列|定向|专项/.test(text)) return "特殊类型批次";
  return "本科批";
}

function scoreMetric(classification) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
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
  return `zzu-2025-province-${RAW_SLUGS.get(province) || stableId([province])}.html`;
}

function rawDetailName(province) {
  return `zzu-2025-detail-${RAW_SLUGS.get(province) || stableId([province])}.html`;
}

function provincePageUrl(province) {
  return new URL(`lnlq_/${ZZU_URL_SLUGS.get(province)}.htm`, INDEX_URL).href;
}

function discoverIndexLinks(indexHtml) {
  const discovered = [];
  for (const match of String(indexHtml).matchAll(/<a[^>]+href\s*=\s*"([^"]*lnlq_[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const label = stripTags(match[2]);
    const province = normalizeProvince(label);
    if (!MAINLAND_PROVINCES.has(province)) continue;
    discovered.push({
      province,
      sourceProvinceRaw: label,
      discoveredUrl: new URL(href, INDEX_URL).href,
    });
  }
  const byProvince = new Map();
  for (const item of discovered) {
    if (!byProvince.has(item.province)) byProvince.set(item.province, item);
  }
  return [...byProvince.values()].sort((a, b) => PROVINCE_ORDER.indexOf(a.province) - PROVINCE_ORDER.indexOf(b.province));
}

function findYearLink(provincePageHtml, provinceUrl) {
  for (const match of provincePageHtml.matchAll(/<a[^>]+href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const label = stripTags(match[2]);
    if (/^2025$|^2025年$/.test(label)) return new URL(href, provinceUrl).href;
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
    const headerIndexes = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.some((cell) => /专业/.test(cell)) && row.some((cell) => /最低分/.test(cell)))
      .map(({ index }) => index);
    if (!headerIndexes.length) return;
    headerIndexes.forEach((headerIndex, sectionIndex) => {
      const header = rows[headerIndex];
      const map = headerMap(header);
      const tableContext = inferTableContext(rows.slice(0, headerIndex + 1), headerIndex, table.context);
      if (!map.has("majorName") || !map.has("minScore")) {
        skippedRows.push({
          reason: "unsupported-header",
          province: page.province,
          tableIndex,
          sectionIndex,
          headerIndex,
          tableContext,
          headers: header,
        });
        return;
      }
      const nextHeaderIndex = headerIndexes[sectionIndex + 1] ?? rows.length;
      const tableRecords = [];
      rows.slice(headerIndex + 1, nextHeaderIndex).forEach((row, rowOffset) => {
      const rowIndex = headerIndex + 1 + rowOffset;
      const majorNameRaw = getCell(row, map, "majorName");
      const sourceSubjectRaw = getCell(row, map, "subjectRaw");
      const admissionSubtypeRaw = getCell(row, map, "admissionSubtypeRaw");
      const minScoreRaw = getCell(row, map, "minScore");
      const minRankRaw = getCell(row, map, "minRank");
      const maxScoreRaw = getCell(row, map, "maxScore");
      const avgScoreRaw = getCell(row, map, "avgScore");
      const controlLineRaw = getCell(row, map, "controlLine");
      const minScoreAboveControlRaw = getCell(row, map, "minScoreAboveControl");
      const minScore = firstNumber(minScoreRaw);
      const minRank = integerNumber(minRankRaw);
      const maxScore = firstNumber(maxScoreRaw);
      const avgScore = firstNumber(avgScoreRaw);
      const controlLine = firstNumber(controlLineRaw);
      const minScoreAboveControl = firstNumber(minScoreAboveControlRaw);
      const rowText = clean([...new Set(row.filter(Boolean))].join(" "));
      if (/郑州大学.*录取情况|录取规则见招生简章/.test(rowText) && (!Number.isFinite(minScore) || minScore === 2025)) {
        return;
      }
      if (/本科线|一本线|控制线|批次线|分数线/.test([majorNameRaw, rowText].join(" "))) {
        return;
      }
      if (!majorNameRaw || !Number.isFinite(minScore)) {
        if (/郑州大学.*录取情况|专业名称|科类|最低分|最高分|位次/.test(rowText) && !Number.isFinite(minScore)) {
          return;
        }
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
      if (minScore < 0 || minScore > 750) {
        skippedRows.push({
          reason: "score-out-of-range",
          province: page.province,
          tableIndex,
          rowIndex,
          tableContext,
          majorName: majorNameRaw,
          minScore,
          cells: row,
        });
        return;
      }
      const dataType = isSummaryRow(majorNameRaw) ? "institution-admission" : "major-admission";
      const classification = classifyAdmission(tableContext, admissionSubtypeRaw, majorNameRaw, sourceSubjectRaw);
      const subjectType = normalizeSubject(page.province, sourceSubjectRaw, majorNameRaw, tableContext);
      const rankUnavailable = !Number.isFinite(minRank);
      const majorGroupCode = getCell(row, map, "majorGroupCode");
      const planCount = integerNumber(getCell(row, map, "planCount"));
      const admissionCount = integerNumber(getCell(row, map, "admissionCount"));
      const majorName = isSummaryRow(majorNameRaw) ? "学校录取汇总" : majorNameRaw;
      const record = {
        id: `2025-zzu-${dataType.replace(/-.*/, "")}-${stableId([
          page.province,
          page.detailUrl,
          tableIndex,
          rowIndex,
          majorGroupCode,
          majorNameRaw,
          sourceSubjectRaw,
          tableContext,
          minScore,
          minRank ?? "",
        ])}`,
        province: page.province,
        sourceProvinceRaw: page.sourceProvinceRaw,
        year: 2025,
        subjectType,
        sourceSubjectRaw,
        batch: normalizeBatch(tableContext, classification),
        sourceBatchRaw: tableContext,
        schoolCode: SOURCE.schoolCode,
        schoolName: SOURCE.schoolName,
        city: SOURCE.city,
        schoolTags: SOURCE.tags,
        dataType,
        majorName,
        majorGroup: majorGroupCode || [SOURCE.schoolName, page.province, subjectType, majorName].filter(Boolean).join("-"),
        admissionType: classification.admissionType,
        admissionSubtype: classification.admissionSubtype,
        formalScoreScope: classification.formalScoreScope,
        minScore,
        scoreMetric: scoreMetric(classification),
        scoreOnly: rankUnavailable,
        rankUnavailable,
        sourceId: SOURCE.id,
        sourceQuality: SOURCE.quality,
        schoolOfficialScope: rankUnavailable ? "single-school-score" : "single-school-score-rank",
        sourceUrl: page.detailUrl,
        sourcePageUrl: page.detailUrl,
        sourceIndexUrl: INDEX_URL,
        sourceProvincePageUrl: page.provincePageUrl,
        sourceIndexDiscoveredProvinceUrl: page.sourceIndexDiscoveredProvinceUrl,
        officialEvidencePath: rawDetailPath,
        sourceHtmlPath: rawDetailPath,
        sourceMinScoreRaw: minScoreRaw,
        sourceMaxScoreRaw: maxScoreRaw,
        sourceAvgScoreRaw: avgScoreRaw,
        sourceControlLineRaw: controlLineRaw,
        sourceMinScoreAboveControlRaw: minScoreAboveControlRaw,
        sourceRankRaw: minRankRaw,
        rawRow: {
          source: "zzu-2025-official-html-table",
          tableIndex,
          rowIndex,
          tableContext,
          headers: header,
          cells: row,
          sourceProvinceRaw: page.sourceProvinceRaw,
          normalizedProvince: page.province,
        },
        cautions: [
          `本记录来自郑州大学招生网官方 2025 年“${page.sourceProvinceRaw}”历年录取页，是单校录取边界，不是省级教育考试院全量投档/录取分数表。`,
          rankUnavailable
            ? "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
            : "本行含学校官网公布的最低分位次，但仍是单校来源；推荐层只能用于郑州大学候选边界复核。",
          classification.formalScoreScope === "special-path-only"
            ? "本行属于艺体、专项、预科、民族、单列、定向等特殊路径，运行层按 special-path-only 隔离，不与普通批次边界混用。"
            : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
          "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
        ],
      };
      if (Number.isFinite(planCount)) record.planCount = planCount;
      if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
      if (Number.isFinite(controlLine)) record.controlLine = controlLine;
      if (Number.isFinite(minScoreAboveControl)) record.minScoreAboveControl = minScoreAboveControl;
      if (Number.isFinite(maxScore)) record.maxScore = maxScore;
      if (Number.isFinite(avgScore)) record.avgScore = avgScore;
      if (Number.isFinite(minRank)) record.minRank = minRank;
      if (admissionSubtypeRaw) record.sourceAdmissionSubtypeRaw = admissionSubtypeRaw;
      tableRecords.push(record);
      records.push(record);
    });
    tableSummaries.push({
      tableIndex,
      sectionIndex,
      headerIndex,
      tableContext,
      headers: header,
      records: tableRecords.length,
      recordsWithRank: tableRecords.filter((record) => !record.rankUnavailable).length,
      recordsWithoutRank: tableRecords.filter((record) => record.rankUnavailable).length,
      byFormalScoreScope: countBy(tableRecords, (record) => record.formalScoreScope),
      byDataType: countBy(tableRecords, (record) => record.dataType),
    });
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

  const indexHtml = await downloadText(rawRoot, "zzu-2025-lnfs-index.html", INDEX_URL, args.useCache);
  if (!/历年录取-郑州大学招生网/.test(extractTitle(indexHtml))) {
    throw new Error(`Unexpected ZZU index title: ${extractTitle(indexHtml)}`);
  }

  const discoveredIndexLinks = discoverIndexLinks(indexHtml);
  const discoveredByProvince = new Map(discoveredIndexLinks.map((item) => [item.province, item]));
  const records = [];
  const skippedRows = [];
  const missingProvincePages = [];
  const correctedProvincePageUrls = [];
  const pageSummaries = [];
  const rawPaths = [path.posix.join(RAW_DIR, "zzu-2025-lnfs-index.html")];

  for (const province of PROVINCE_ORDER) {
    const slug = ZZU_URL_SLUGS.get(province);
    const discovered = discoveredByProvince.get(province) || {};
    const url = provincePageUrl(province);
    if (discovered.discoveredUrl && discovered.discoveredUrl !== url && province === "重庆") {
      correctedProvincePageUrls.push({
        province,
        sourceIndexDiscoveredProvinceUrl: discovered.discoveredUrl,
        correctedProvincePageUrl: url,
        reason: "official-index-link-points-to-anhui-2020-page-but-official-zq-province-page-exists",
      });
    }
    const provinceRaw = rawProvinceName(province);
    const provinceRawPath = path.posix.join(RAW_DIR, provinceRaw);
    const provinceHtml = await downloadText(rawRoot, provinceRaw, url, args.useCache);
    rawPaths.push(provinceRawPath);
    const pageTitle = extractTitle(provinceHtml);
    if (/404错误提示/.test(pageTitle)) {
      missingProvincePages.push({
        province,
        sourceProvinceRaw: discovered.sourceProvinceRaw || province,
        provincePageUrl: url,
        sourceIndexDiscoveredProvinceUrl: discovered.discoveredUrl || "",
        reason: "official-province-page-404",
      });
      continue;
    }
    const detailUrl = findYearLink(provinceHtml, url);
    if (!detailUrl) {
      missingProvincePages.push({
        province,
        sourceProvinceRaw: discovered.sourceProvinceRaw || province,
        provincePageUrl: url,
        sourceIndexDiscoveredProvinceUrl: discovered.discoveredUrl || "",
        reason: "no-2025-link-on-official-province-page",
      });
      continue;
    }
    const detailRaw = rawDetailName(province);
    const detailRawPath = path.posix.join(RAW_DIR, detailRaw);
    const detailHtml = await downloadText(rawRoot, detailRaw, detailUrl, args.useCache);
    rawPaths.push(detailRawPath);
    const detailTitle = extractTitle(detailHtml);
    if (/404错误提示/.test(detailTitle)) {
      missingProvincePages.push({
        province,
        sourceProvinceRaw: discovered.sourceProvinceRaw || province,
        provincePageUrl: url,
        detailUrl,
        sourceIndexDiscoveredProvinceUrl: discovered.discoveredUrl || "",
        reason: "official-2025-detail-page-404",
      });
      continue;
    }
    if (!/郑州大学招生网/.test(detailTitle)) {
      throw new Error(`Unexpected ZZU detail title for ${province}: ${detailTitle}`);
    }
    const page = {
      province,
      sourceProvinceRaw: discovered.sourceProvinceRaw || province,
      provincePageUrl: url,
      sourceIndexDiscoveredProvinceUrl: discovered.discoveredUrl || "",
      detailUrl,
    };
    const parsed = parseTables(detailHtml, page, detailRawPath);
    records.push(...parsed.records);
    skippedRows.push(...parsed.skippedRows);
    pageSummaries.push({
      province,
      sourceProvinceRaw: page.sourceProvinceRaw,
      provincePageUrl: url,
      sourceIndexDiscoveredProvinceUrl: page.sourceIndexDiscoveredProvinceUrl,
      detailUrl,
      provinceRawPath,
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

  if (records.length < 700) throw new Error(`Parsed too few ZZU records: ${records.length}`);
  const duplicateIds = records.length - new Set(records.map((record) => record.id)).size;
  if (duplicateIds) throw new Error(`Duplicate record ids in ZZU import: ${duplicateIds}`);

  const provincesWithRecords = [...new Set(records.map((record) => record.province))]
    .sort((a, b) => PROVINCE_ORDER.indexOf(a) - PROVINCE_ORDER.indexOf(b));
  const missingMainland = PROVINCE_ORDER.filter((province) => !provincesWithRecords.includes(province));
  const recordsWithRank = records.filter((record) => !record.rankUnavailable).length;
  const recordsWithoutRank = records.length - recordsWithRank;
  const ordinarySchoolOfficialRecords = records.filter((record) => record.formalScoreScope === "school-official-only").length;
  const specialPathRecords = records.filter((record) => record.formalScoreScope === "special-path-only").length;

  const payload = {
    sourceNotes: [
      {
        id: SOURCE.id,
        title: "郑州大学招生网：2025年全国分省分专业录取情况",
        publisher: "郑州大学招生网",
        url: INDEX_URL,
        quality: SOURCE.quality,
        usage: "从郑州大学招生网官方“历年录取”页面和各省官方年份页抽取 2025 年分省分专业录取表。抽取专业名称、科类、最高分、最低分、最低分高出线、最低分位次等字段；学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
        parsedRecords: records.length,
        skippedOfficialRows: skippedRows.length,
        discoveredProvinceLinkCount: discoveredIndexLinks.length,
        provincePageCount: PROVINCE_ORDER.length,
        detailPageCount: pageSummaries.length,
        provinceCount: provincesWithRecords.length,
        provincesWithRecords,
        missingMainlandProvinces: missingMainland,
        missingProvincePages,
        correctedProvincePageUrls,
        years: [2025],
        recordsWithRank,
        recordsWithoutRank,
        ordinarySchoolOfficialRecords,
        specialPathRecords,
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
          "本导入包来自郑州大学学校官网单校分数/位次数据，不关闭任何省级正式投档表缺口。",
          "黑龙江官方省份页未列 2025 年链接，本包不生成黑龙江假记录。",
          "郑州大学官方索引页中重庆入口指向安徽旧页；本包记录该目录瑕疵，并使用同站可访问的重庆官方页 zq/a2025.htm。",
          "艺体、高校专项、国家专项、地方专项、预科、民族、单列、定向等特殊入口按 special-path-only 隔离，不与普通批次混用。",
          "普通学校官网单校行按 school-official-only 保留；推荐层只能用于郑州大学候选边界复核，不替代省级正式投档表。",
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
    discoveredProvinceLinkCount: discoveredIndexLinks.length,
    provincePageCount: PROVINCE_ORDER.length,
    detailPageCount: pageSummaries.length,
    provincesWithRecords: provincesWithRecords.length,
    missingMainlandProvinces: missingMainland,
    missingProvincePages,
    correctedProvincePageUrls,
    recordsWithRank,
    recordsWithoutRank,
    ordinarySchoolOfficialRecords,
    specialPathRecords,
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
