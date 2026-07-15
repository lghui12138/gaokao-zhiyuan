#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2021-2025-v3247-ujs-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2021-2025-v3247-ujs";
const OFFICIAL_HOME_URL = "https://zb.ujs.edu.cn/";
const INDEX_PAGE_URL = "https://zb.ujs.edu.cn/lnfs.htm";
const DEFAULT_YEARS = [2025, 2024, 2023, 2022, 2021];

const SOURCE = {
  id: "official-ujs-national-2021-2025-school-admission",
  quality: "official-school-ujs-2021-2025-national-html-score-only",
  schoolCode: "10299",
  schoolName: "江苏大学",
  city: "江苏镇江",
  publisher: "江苏大学本科招生网",
  tags: ["江苏", "镇江", "江苏大学", "综合类", "工科"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

const PROVINCE_SLUGS = {
  北京: "beijing",
  天津: "tianjin",
  河北: "hebei",
  山西: "shanxi",
  内蒙古: "neimenggu",
  辽宁: "liaoning",
  吉林: "jilin",
  黑龙江: "heilongjiang",
  上海: "shanghai",
  江苏: "jiangsu",
  浙江: "zhejiang",
  安徽: "anhui",
  福建: "fujian",
  江西: "jiangxi",
  山东: "shandong",
  河南: "henan",
  湖北: "hubei",
  湖南: "hunan",
  广东: "guangdong",
  广西: "guangxi",
  海南: "hainan",
  重庆: "chongqing",
  四川: "sichuan",
  贵州: "guizhou",
  云南: "yunnan",
  西藏: "xizang",
  陕西: "shaanxi",
  甘肃: "gansu",
  青海: "qinghai",
  宁夏: "ningxia",
  新疆: "xinjiang",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2021-2025-v3247-ujs.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2021-2025-v3247-ujs.mjs --use-cache",
    "  node scripts/import-official-national-school-admission-2021-2025-v3247-ujs.mjs --years 2025,2024,2023,2022,2021",
    "",
    "Imports 江苏大学本科招生网 2021-2025 历年分数 HTML tables for all mainland provinces.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false, years: [...DEFAULT_YEARS] };
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
    if (arg === "--years") {
      args.years = String(argv[++i] || "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 2000 && value <= 2100);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.years.length) throw new Error(`No valid --years supplied.\n${usage()}`);
  return args;
}

function guardProjectRoot() {
  if (PROJECT_ROOT.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing to run the importer from /Volumes/mac_2T; use the internal APFS project copy.");
  }
}

function projectPath(relPath) {
  return path.resolve(PROJECT_ROOT, relPath);
}

function ensureDir(relOrAbs) {
  fs.mkdirSync(path.isAbsolute(relOrAbs) ? relOrAbs : projectPath(relOrAbs), { recursive: true });
}

function writeJson(relPath, value) {
  fs.writeFileSync(projectPath(relPath), `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(absPath) {
  return sha256(fs.readFileSync(absPath));
}

function stableId(parts, length = 18) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, length);
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n\f\v]+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function stripTags(value) {
  return normalizeText(
    decodeHtmlEntities(
      String(value ?? "")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p>|<\/div>|<\/span>|<\/td>|<\/th>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function parseNumber(value) {
  const text = normalizeText(value).replace(/[,，]/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--" || /^无$/.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseInteger(value) {
  const number = parseNumber(value);
  return number == null ? null : Math.trunc(number);
}

function parseSingleControlLine(value) {
  const text = normalizeText(value);
  if (!text || /[/／]/.test(text)) return null;
  const number = parseNumber(text);
  return number != null && number > 0 ? number : null;
}

function attrValue(attrs, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(attrs ?? "").match(pattern);
  return match ? decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function parseAttrInteger(attrs, name, fallback = 1) {
  const value = Number.parseInt(attrValue(attrs, name), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function requestText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || INDEX_PAGE_URL,
        },
        signal: AbortSignal.timeout(options.timeoutMs || 180_000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 240)}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

async function getTextRaw(rawRoot, rawFile, url, useCache, options = {}) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs) && fs.statSync(abs).size > 0) return fs.readFileSync(abs, "utf8");
  const text = await requestText(url, options);
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
  await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 120));
  return text;
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html))) {
    const attrs = match[1] || "";
    const href = attrValue(attrs, "href");
    if (!href || /^javascript:/i.test(href) || href === "#") continue;
    let url = null;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    anchors.push({
      url,
      href,
      title: normalizeText(attrValue(attrs, "title") || stripTags(match[2])),
      text: stripTags(match[2]),
    });
  }
  return anchors;
}

function parseProvinceLinks(indexHtml) {
  const byProvince = new Map();
  for (const anchor of extractAnchors(indexHtml, INDEX_PAGE_URL)) {
    const province = normalizeText(anchor.title || anchor.text);
    if (!MAINLAND_PROVINCES.has(province)) continue;
    if (!/list\.jsp|wbtreeid=/.test(anchor.url)) continue;
    byProvince.set(province, anchor.url);
  }
  return [...byProvince.entries()]
    .map(([province, url]) => ({ province, url, slug: PROVINCE_SLUGS[province] }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function parseDetailLinks(listHtml, listUrl, wantedYears) {
  const wanted = new Set(wantedYears);
  const byKey = new Map();
  for (const anchor of extractAnchors(listHtml, listUrl)) {
    const title = normalizeText(anchor.title || anchor.text);
    const year = parseInteger(title.match(/20\d{2}/)?.[0]);
    if (!year || !wanted.has(year)) continue;
    if (!/录取情况|历年分数|分数/.test(title)) continue;
    if (!/\/info\/|info\//.test(anchor.url)) continue;
    byKey.set(`${year}:${anchor.url}`, { year, title, url: anchor.url });
  }
  return [...byKey.values()].sort((a, b) => b.year - a.year || a.url.localeCompare(b.url));
}

function extractPageTitle(html) {
  return (
    stripTags(html.match(/<p\b[^>]*class=["']p2["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]) ||
    stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
  );
}

function extractPublishedAt(html) {
  const text = stripTags(html.match(/<p\b[^>]*class=["']time["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
  return normalizeText(text.replace(/访问次数.*/, "").replace(/^时间[:：]?/, ""));
}

function extractContentTable(html) {
  const markerIndex = html.search(/class=["']v_news_content["']|id=["']vsb_content["']/i);
  const body = markerIndex >= 0 ? html.slice(markerIndex) : html;
  const tableMatch = body.match(/<table\b[\s\S]*?<\/table>/i);
  if (!tableMatch) return null;
  const table = tableMatch[0];
  if (!/最低分/.test(stripTags(table)) || !/录取人数|录取数|总人数|人数/.test(stripTags(table))) return null;
  return table;
}

function parseTableRows(tableHtml) {
  const rows = [];
  const pending = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tableHtml))) {
    const row = [];
    let col = 0;
    const fillPending = () => {
      while (pending[col]?.remaining > 0) {
        row[col] = pending[col].value;
        pending[col].remaining -= 1;
        if (pending[col].remaining <= 0) delete pending[col];
        col += 1;
      }
    };
    const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      fillPending();
      const attrs = cellMatch[1] || "";
      const text = stripTags(cellMatch[2]);
      const colspan = parseAttrInteger(attrs, "colspan", 1);
      const rowspan = parseAttrInteger(attrs, "rowspan", 1);
      for (let offset = 0; offset < colspan; offset += 1) {
        row[col + offset] = text;
        if (rowspan > 1) pending[col + offset] = { remaining: rowspan - 1, value: text };
      }
      col += colspan;
    }
    while (col < pending.length) fillPending();
    if (row.some((value) => normalizeText(value))) rows.push(row.map(normalizeText));
  }
  return rows;
}

function headerIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(header));
}

function valuesFromTableRow(headers, row) {
  const batchIdx = headerIndex(headers, /批次|科类|类别/);
  const groupIdx = headerIndex(headers, /专业组|院校专业组/);
  const majorIdx = headers.findIndex((header) => /专业/.test(header) && !/组/.test(header));
  const countIdx = headerIndex(headers, /录取人数|录取数|人数/);
  const maxIdx = headerIndex(headers, /最高分/);
  const minIdx = headerIndex(headers, /最低分|录取最低/);
  const avgIdx = headerIndex(headers, /平均分/);
  const controlIdx = headerIndex(headers, /省控线|控制线|批次线/);
  return {
    batchRaw: batchIdx >= 0 ? row[batchIdx] : "",
    majorGroupRaw: groupIdx >= 0 ? row[groupIdx] : "",
    majorName: majorIdx >= 0 ? row[majorIdx] : "",
    admissionCountRaw: countIdx >= 0 ? row[countIdx] : "",
    maxScoreRaw: maxIdx >= 0 ? row[maxIdx] : "",
    minScoreRaw: minIdx >= 0 ? row[minIdx] : "",
    averageScoreRaw: avgIdx >= 0 ? row[avgIdx] : "",
    controlLineRaw: controlIdx >= 0 ? row[controlIdx] : "",
    rawCells: Object.fromEntries(headers.map((header, index) => [header || `col${index + 1}`, row[index] ?? ""])),
  };
}

function parseDetailTable(html, context) {
  const tableHtml = extractContentTable(html);
  if (!tableHtml) {
    return {
      rows: [],
      warnings: [{ issue: "missing_score_table", ...context }],
      headers: [],
    };
  }
  const tableRows = parseTableRows(tableHtml);
  const headerRowIndex = tableRows.findIndex((row) => row.some((cell) => /最低分|录取最低/.test(cell)) && row.some((cell) => /录取人数|录取数|人数/.test(cell)));
  if (headerRowIndex < 0) {
    return {
      rows: [],
      warnings: [{ issue: "missing_required_header", ...context, previewRows: tableRows.slice(0, 4) }],
      headers: [],
    };
  }
  const headers = tableRows[headerRowIndex].map((header) => normalizeText(header));
  const rows = [];
  const warnings = [];
  for (let i = headerRowIndex + 1; i < tableRows.length; i += 1) {
    const row = tableRows[i];
    const values = valuesFromTableRow(headers, row);
    rows.push({ ...values, rowIndex: i - headerRowIndex });
  }
  if (!rows.length) warnings.push({ issue: "empty_score_table", ...context, headers });
  return { rows, warnings, headers };
}

function normalizeBatch(rawBatch) {
  const batch = normalizeText(rawBatch);
  if (/贫困|国家专项|专项理|专项文/.test(batch)) return "国家专项";
  if (/国家专项/.test(batch)) return "国家专项";
  if (/地方专项/.test(batch)) return "地方专项";
  if (/高校专项/.test(batch)) return "高校专项";
  if (/南疆|单列/.test(batch)) return "南疆单列";
  if (/定向/.test(batch)) return "定向";
  if (/提前/.test(batch)) return "本科提前批";
  if (/本科第一批|第一批本科|本科一批|一批本科|一批|一本|本一/.test(batch)) return "本科一批";
  if (/本科第二批|第二批本科|本科二批|二批本科|二批/.test(batch)) return "本科二批";
  if (/专科|高职/.test(batch)) return "专科批";
  if (/艺术/.test(batch)) return "艺术类";
  if (/体育/.test(batch)) return "体育类";
  if (/普通批|本科批|普通类|本科文|本科理|文史|理工|文科|理科|历史|物理|综合改革|综合|不分文理/.test(batch)) return "本科批";
  return batch || "本科批";
}

function normalizeSubject(batchRaw, groupRaw, province) {
  const batch = normalizeText(batchRaw).replace(/＋/g, "+");
  const group = normalizeText(groupRaw).replace(/＋/g, "+");
  const text = `${batch} ${group}`;
  if (/体育/.test(batch)) return "体育类";
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|设计/.test(batch)) return "艺术类";
  if (!group && /^(贫困|贫困专项|国家专项|地方专项|高校专项)$/.test(batch)) return "官网未列科类";
  if (/历史|文史|文科|本一文|本科文|本科批文|定向文|专项文|贫困文/.test(text)) return "历史类";
  if (/物理|理工|理科|本一理|本科理|本科批理|定向理|专项理|贫困理|南疆单列理/.test(text)) return "物理类";
  if (/综合|不分文理|改革|不限|选考/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  return normalizeText(group || batch) || "官网未列科类";
}

function electiveRequirement(groupRaw) {
  const text = normalizeText(groupRaw).replace(/＋/g, "+");
  if (!text || /^(文史|理工|文科|理科|历史|物理|综合改革|综合|普通批)$/.test(text)) return null;
  if (/选考|必须|不限|政治|地理|化学|生物|历史|物理|\+|\/|／|第?\d+组|（|）|\(|\)/.test(text)) return text;
  return null;
}

function classifyAdmission(values) {
  const text = `${values.batchRaw || ""} ${values.majorGroupRaw || ""} ${values.majorName || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/.test(text)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|单考单招|单独招生|单独考试|本科单招/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/地方专项/.test(text)) return { admissionType: "地方专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/中外合作|合作办学|学分互认|联合培养|中澳|中美|专项|贫困|预科|内高班|西藏班|单列|南疆|定向|援疆|民族班|优师|公费师范|港澳台|提前批|定向培养/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(values) {
  const text = `${values.batchRaw || ""} ${values.majorGroupRaw || ""} ${values.majorName || ""}`;
  const valuesOut = [];
  for (const [pattern, label] of [
    [/中外合作|合作办学/, "中外合作办学"],
    [/学分互认|联合培养|中澳|中美/, "学分互认/联合培养"],
    [/国家专项/, "国家专项"],
    [/地方专项/, "地方专项"],
    [/高校专项/, "高校专项"],
    [/贫困/, "贫困专项"],
    [/预科/, "预科"],
    [/内高班|西藏班/, "内高班/西藏班"],
    [/定向培养|定向|援疆/, "定向/援疆"],
    [/单列|南疆/, "单列/南疆"],
    [/公费师范|优师/, "公费师范/优师"],
    [/提前批/, "提前批"],
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/, "艺术类"],
    [/体育|运动训练|单考单招|单独招生|单独考试|本科单招/, "体育类"],
  ]) {
    if (pattern.test(text)) valuesOut.push(label);
  }
  return [...new Set(valuesOut)].join("/") || "普通";
}

function scoreMetric(values, classification) {
  if (classification.admissionType === "艺术类" || classification.admissionType === "体育类") {
    return "综合/专业或文化分，按官网原表口径";
  }
  if (/综合分|专业分/.test(`${values.batchRaw || ""} ${values.majorGroupRaw || ""} ${values.majorName || ""}`)) {
    return "官网原表分数口径";
  }
  return "高考文化分，按官网原表口径";
}

function buildRecord(values, context) {
  const minScore = parseNumber(values.minScoreRaw);
  const maxScore = parseNumber(values.maxScoreRaw);
  const avgScore = parseNumber(values.averageScoreRaw);
  const majorName = normalizeText(values.majorName);
  if (!majorName || /^(合计|小计|总计|备注)$/.test(majorName) || minScore == null || minScore <= 0) {
    return { record: null, warning: { issue: "skipped_missing_required_fields", ...context, rowIndex: values.rowIndex, values } };
  }
  const batch = normalizeBatch(values.batchRaw);
  const subjectType = normalizeSubject(values.batchRaw, values.majorGroupRaw, context.province);
  const classification = classifyAdmission(values);
  const subtype = admissionSubtype(values);
  const elective = electiveRequirement(values.majorGroupRaw);
  const pageKey = `ujs-${context.year}-${context.province}-${values.batchRaw}-${values.majorGroupRaw}`;
  const record = {
    id: `ujs-${stableId([context.year, context.province, values.batchRaw, values.majorGroupRaw, majorName, values.minScoreRaw, values.maxScoreRaw, values.averageScoreRaw, values.rowIndex])}`,
    year: context.year,
    province: context.province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    campus: "",
    batch,
    subjectType,
    majorName,
    dataType: "major-admission",
    admissionType: classification.admissionType,
    admissionSubtype: subtype,
    formalScoreScope: classification.formalScoreScope,
    schoolOfficialScope: true,
    minScore,
    maxScore,
    avgScore,
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    rankUnavailable: true,
    scoreOnly: true,
    scoreMetric: scoreMetric(values, classification),
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: context.detailUrl,
    sourcePageUrl: context.detailUrl,
    sourceIndexUrl: INDEX_PAGE_URL,
    sourcePageKey: pageKey,
    sourcePageTitle: context.title || `${context.year}年${SOURCE.schoolName}在${context.province}录取情况`,
    officialEvidencePath: `${RAW_DIR}/${context.rawRel}`,
    sourceProvinceRaw: context.province,
    sourceCategoryRaw: normalizeText(values.batchRaw),
    sourceSubjectRaw: normalizeText(values.majorGroupRaw || values.batchRaw),
    sourceCampusRaw: "",
    sourceBatchRaw: normalizeText(values.batchRaw),
    sourceMajorGroupRaw: normalizeText(values.majorGroupRaw),
    sourceMajorRaw: majorName,
    sourceAdmissionCountRaw: normalizeText(values.admissionCountRaw),
    sourceControlLineRaw: normalizeText(values.controlLineRaw),
    sourceMaxScoreRaw: normalizeText(values.maxScoreRaw),
    sourceMinScoreRaw: normalizeText(values.minScoreRaw),
    sourceAverageScoreRaw: normalizeText(values.averageScoreRaw),
    sourceMinRankRaw: "",
    rawRow: {
      ...values.rawCells,
      rowIndex: values.rowIndex,
      province: context.province,
      year: context.year,
      sourcePageTitle: context.title,
    },
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      "源行未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。",
      "江苏大学源页为 HTML 表格；rowspan/colspan 已展开，省控线斜杠口径仅保留原文，不强行拆分。",
    ],
  };
  const admissionCount = parseInteger(values.admissionCountRaw);
  if (admissionCount != null) record.admissionCount = admissionCount;
  const controlLine = parseSingleControlLine(values.controlLineRaw);
  if (controlLine != null) record.sourceControlLine = controlLine;
  if (elective) record.electiveRequirement = elective;
  if (/中外合作|合作办学/.test(`${values.batchRaw || ""} ${values.majorName || ""}`)) {
    record.cautions.push("中外合作办学方向需结合学费、校区和培养模式复核。");
  }
  if (/定向|定向培养/.test(`${values.batchRaw || ""} ${values.majorName || ""}`)) {
    record.cautions.push("定向培养方向为特殊招生路径，需结合地区/单位要求单独复核。");
  }
  if (context.province === "西藏") {
    record.cautions.push(`西藏行仅为${SOURCE.schoolName}官网单校分数；不参与自治区省级全量闭合。`);
  }
  return { record, warning: null };
}

function incrementCounter(target, key, by = 1) {
  target[key] = (target[key] || 0) + by;
}

function range(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric.length) return null;
  return [Math.min(...numeric), Math.max(...numeric)];
}

function countRecords(records) {
  const counters = {
    formalScoreScopeCounts: {},
    subjectTypeCounts: {},
    provinceCounts: {},
    yearCounts: {},
    admissionTypeCounts: {},
    admissionSubtypeCounts: {},
    recordTypeCounts: {},
  };
  for (const record of records) {
    incrementCounter(counters.formalScoreScopeCounts, record.formalScoreScope);
    incrementCounter(counters.subjectTypeCounts, record.subjectType);
    incrementCounter(counters.provinceCounts, record.province);
    incrementCounter(counters.yearCounts, String(record.year));
    incrementCounter(counters.admissionTypeCounts, record.admissionType);
    incrementCounter(counters.admissionSubtypeCounts, record.admissionSubtype);
    incrementCounter(counters.recordTypeCounts, record.dataType);
  }
  return counters;
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];
  const duplicates = [];
  for (const record of records) {
    const key = [
      record.year,
      record.province,
      record.sourceBatchRaw,
      record.sourceMajorGroupRaw,
      record.majorName,
      record.minScore,
      record.maxScore,
      record.avgScore,
      record.formalScoreScope,
    ].join("\t");
    if (seen.has(key)) {
      duplicates.push(record);
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return { deduped, duplicates };
}

function detailFileName(province, year, detailUrl) {
  const slug = PROVINCE_SLUGS[province] || stableId([province], 8);
  const id = detailUrl.match(/\/(\d+)\.htm(?:$|\?)/)?.[1] || stableId([detailUrl], 8);
  return `ujs-${slug}-${year}-${id}.html`;
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));

  const homeHtml = await getTextRaw(rawRoot, "ujs-official-home.html", OFFICIAL_HOME_URL, args.useCache, { referer: OFFICIAL_HOME_URL });
  const indexHtml = await getTextRaw(rawRoot, "ujs-lnfs-index.html", INDEX_PAGE_URL, args.useCache, { referer: OFFICIAL_HOME_URL });
  if (!/江苏大学|本科招生/.test(homeHtml) || !/历年分数|lnfs/.test(indexHtml)) {
    throw new Error("Official pages no longer identify 江苏大学本科招生网 历年分数 context; refusing to import without that evidence.");
  }

  const provinceLinks = parseProvinceLinks(indexHtml);
  const missingProvinceLinks = [...MAINLAND_PROVINCES].filter((province) => !provinceLinks.some((item) => item.province === province));
  if (provinceLinks.length < 31) {
    throw new Error(`Expected 31 mainland province links from ${INDEX_PAGE_URL}, found ${provinceLinks.length}: missing ${missingProvinceLinks.join(",")}`);
  }

  const rawRecords = [];
  const warnings = [];
  const pageSummaries = [];
  const rawFiles = [
    `${RAW_DIR}/ujs-official-home.html`,
    `${RAW_DIR}/ujs-lnfs-index.html`,
  ];

  for (const provinceLink of provinceLinks) {
    const listRel = `ujs-list-${provinceLink.slug}.html`;
    const listHtml = await getTextRaw(rawRoot, listRel, provinceLink.url, args.useCache, { referer: INDEX_PAGE_URL });
    rawFiles.push(`${RAW_DIR}/${listRel}`);
    if (!/历年分数/.test(listHtml) || !new RegExp(provinceLink.province).test(stripTags(listHtml))) {
      warnings.push({ issue: "province_list_identity_weak", province: provinceLink.province, url: provinceLink.url, rawFile: `${RAW_DIR}/${listRel}` });
    }
    const detailLinks = parseDetailLinks(listHtml, provinceLink.url, args.years);
    const foundYears = new Set(detailLinks.map((item) => item.year));
    for (const year of args.years) {
      if (!foundYears.has(year)) {
        warnings.push({ issue: "missing_year_detail_link", province: provinceLink.province, year, provinceListUrl: provinceLink.url, rawFile: `${RAW_DIR}/${listRel}` });
      }
    }
    for (const detail of detailLinks) {
      const detailRel = detailFileName(provinceLink.province, detail.year, detail.url);
      const detailHtml = await getTextRaw(rawRoot, detailRel, detail.url, args.useCache, { referer: provinceLink.url });
      rawFiles.push(`${RAW_DIR}/${detailRel}`);
      const title = extractPageTitle(detailHtml) || detail.title;
      const publishedAt = extractPublishedAt(detailHtml);
      if (!/江苏大学/.test(title) || !new RegExp(String(detail.year)).test(title) || !new RegExp(provinceLink.province).test(title)) {
        warnings.push({ issue: "detail_page_identity_weak", province: provinceLink.province, year: detail.year, title, url: detail.url, rawFile: `${RAW_DIR}/${detailRel}` });
      }
      const parsed = parseDetailTable(detailHtml, {
        province: provinceLink.province,
        year: detail.year,
        detailUrl: detail.url,
        rawRel: detailRel,
        title,
      });
      warnings.push(...parsed.warnings.map((warning) => ({ ...warning, rawFile: `${RAW_DIR}/${detailRel}` })));
      let pageRecordCount = 0;
      for (const values of parsed.rows) {
        const { record, warning } = buildRecord(values, {
          province: provinceLink.province,
          year: detail.year,
          detailUrl: detail.url,
          rawRel: detailRel,
          title,
        });
        if (record) {
          rawRecords.push(record);
          pageRecordCount += 1;
        }
        if (warning) warnings.push({ ...warning, rawFile: `${RAW_DIR}/${detailRel}` });
      }
      pageSummaries.push({
        province: provinceLink.province,
        year: detail.year,
        title,
        publishedAt,
        url: detail.url,
        rawFile: `${RAW_DIR}/${detailRel}`,
        rawSha256: sha256File(projectPath(`${RAW_DIR}/${detailRel}`)),
        headers: parsed.headers,
        parsedRows: parsed.rows.length,
        parsedRecords: pageRecordCount,
      });
    }
  }

  const { deduped: records, duplicates: duplicateRecords } = dedupeRecords(rawRecords);
  const counters = countRecords(records);
  const uniqueRawFiles = [...new Set(rawFiles)].sort();
  const rawSha256 = Object.fromEntries(uniqueRawFiles.map((file) => [path.basename(file), sha256File(projectPath(file))]));
  const sourceNotes = [
    {
      id: SOURCE.id,
      publisher: SOURCE.publisher,
      title: "江苏大学本科招生网历年分数 HTML 表格（2021-2025，全国 31 省份）",
      url: INDEX_PAGE_URL,
      officialNavigationUrl: OFFICIAL_HOME_URL,
      quality: SOURCE.quality,
      usage:
        "学校官网单校分专业录取最低分边界，源表未公开最低位次；可用于江苏大学候选边界复核、江苏/工科/综合类方向分数段趋势和全国单校分数加厚，不替代任何省级教育考试院全量投档/录取表。",
      rawDir: RAW_DIR,
      rawFiles: uniqueRawFiles,
      rawSha256,
      parsedRecords: records.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      skippedRows: warnings,
      pageSummaries,
      provinceListPages: provinceLinks.map((item) => ({ province: item.province, url: item.url, rawFile: `${RAW_DIR}/ujs-list-${item.slug}.html` })),
      provincesWithRecords: Object.keys(counters.provinceCounts).sort(),
      provinceCount: Object.keys(counters.provinceCounts).length,
      years: Object.keys(counters.yearCounts).sort(),
      yearCounts: counters.yearCounts,
      subjectTypeCounts: counters.subjectTypeCounts,
      formalScoreScopeCounts: counters.formalScoreScopeCounts,
      admissionTypeCounts: counters.admissionTypeCounts,
      admissionSubtypeCounts: counters.admissionSubtypeCounts,
      recordTypeCounts: counters.recordTypeCounts,
      scoreRange: range(records.map((record) => record.minScore)),
      recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
      recordsWithRank: records.filter((record) => record.minRank != null).length,
      xizangRecords: records.filter((record) => record.province === "西藏").length,
      xinjiangRecords: records.filter((record) => record.province === "新疆").length,
      lowScoreRecordsUnder200: records.filter((record) => record.minScore < 200).length,
      boundaryNotes: [
        "源表未公开最低位次；全部新增行保持 rankUnavailable=true，不生成假位次。",
        "school-official-only 只作单校候选边界复核，不参与 formalScoreMissingProvinces 省级全量闭合。",
        "艺术体育、专项、中外合作、预科、内高班、西藏班、单列、南疆、定向/援疆、提前批等特殊路径按 special-path-only 隔离。",
        "HTML 表格 rowspan/colspan 已展开；省控线斜杠口径只保存 sourceControlLineRaw，不拆成推断控制线。",
        "西藏行仅为江苏大学官网单校分数，不当作自治区考试院全量正式表。",
      ],
    },
  ];

  const output = {
    dataset: "official-national-school-admission-2021-2025-v3247-ujs",
    generatedAt: new Date().toISOString(),
    scope: {
      years: Object.keys(counters.yearCounts).sort(),
      requestedYears: args.years.map(String).sort(),
      provinceCount: Object.keys(counters.provinceCounts).length,
      school: SOURCE.schoolName,
      sourceType: "school-official-html-score-only",
      officialRankAvailability: "none",
      sourceUrl: INDEX_PAGE_URL,
    },
    sourceNotes,
    records,
    notes: [
      "江苏大学本科招生网官方历年分数 HTML 表格，按省份详情页逐页缓存并解析。",
      "所有新增行均为学校官网单校分数，不替代省级考试院全量投档/录取数据；无最低位次时不生成假位次。",
      "普通录取行进入 school-official-only；艺术体育/专项/中外合作/定向等特殊路径进入 special-path-only。",
    ],
    audit: {
      rawRecords: rawRecords.length,
      parsedRecords: records.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      warningCount: warnings.length,
      rawFileCount: uniqueRawFiles.length,
      detailPageCount: pageSummaries.length,
      counters,
      scoreRange: range(records.map((record) => record.minScore)),
      recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
      recordsWithRank: records.filter((record) => record.minRank != null).length,
    },
  };

  writeJson(args.out, output);
  console.log(JSON.stringify({
    out: args.out,
    records: records.length,
    rawRecords: rawRecords.length,
    duplicateRecordsSkipped: duplicateRecords.length,
    warnings: warnings.length,
    rawFileCount: uniqueRawFiles.length,
    detailPageCount: pageSummaries.length,
    provinceCount: Object.keys(counters.provinceCounts).length,
    years: Object.keys(counters.yearCounts).sort(),
    formalScoreScopeCounts: counters.formalScoreScopeCounts,
    subjectTypeCounts: counters.subjectTypeCounts,
    scoreRange: range(records.map((record) => record.minScore)),
    sha256: sha256File(projectPath(args.out)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
