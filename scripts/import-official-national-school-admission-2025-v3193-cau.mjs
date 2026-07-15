#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3193-cau-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3193-cau";
const SITE_BASE = "https://jwzs.cau.edu.cn";
const LIST_URL = `${SITE_BASE}/col/col4538/index.html`;
const PAGE_URL = `${SITE_BASE}/art/2025/7/8/art_4538_788362.html`;
const SOURCE = {
  id: "official-cau-national-2025-school-admission",
  quality: "official-school-cau-2025-national-html-first-choice-min-score",
  schoolCode: "10019",
  schoolName: "中国农业大学",
  city: "北京",
  tags: ["农林", "985", "211", "双一流"],
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

const SINGLE_COLUMN_META = {
  1: {
    columnLabel: "普通理工/物理类",
    subjectType: "物理类",
    sourceSubjectRaw: "普通理工/物理类",
    admissionType: "普通录取",
    admissionSubtype: "普通类",
    formalScoreScope: "school-official-only",
  },
  2: {
    columnLabel: "普通文史/历史类",
    subjectType: "历史类",
    sourceSubjectRaw: "普通文史/历史类",
    admissionType: "普通录取",
    admissionSubtype: "普通类",
    formalScoreScope: "school-official-only",
  },
  3: {
    columnLabel: "中外理工/物理类",
    subjectType: "物理类",
    sourceSubjectRaw: "中外理工/物理类",
    admissionType: "中外合作办学",
    admissionSubtype: "中外合作办学",
    formalScoreScope: "school-official-only",
  },
  4: {
    columnLabel: "中外文史/历史类",
    subjectType: "历史类",
    sourceSubjectRaw: "中外文史/历史类",
    admissionType: "中外合作办学",
    admissionSubtype: "中外合作办学",
    formalScoreScope: "school-official-only",
  },
  5: {
    columnLabel: "国家专项",
    subjectType: "官网未列科类",
    sourceSubjectRaw: "国家专项最低分，官网未列科类",
    admissionType: "专项计划",
    admissionSubtype: "国家专项",
    formalScoreScope: "special-path-only",
  },
  6: {
    columnLabel: "高校专项",
    subjectType: "官网未列科类",
    sourceSubjectRaw: "高校专项最低分，官网未列科类",
    admissionType: "专项计划",
    admissionSubtype: "高校专项",
    formalScoreScope: "special-path-only",
  },
  7: {
    columnLabel: "其他",
    subjectType: "官网未列科类",
    sourceSubjectRaw: "其他类型最低分，官网未列科类",
    admissionType: "其他录取",
    admissionSubtype: "其他",
    formalScoreScope: "special-path-only",
  },
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3193-cau.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3193-cau.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports China Agricultural University official 2025 national first-choice minimum score table.",
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
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 16);
}

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(45_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
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

function cleanInline(value) {
  return decodeHtml(value)
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellLines(cellHtml) {
  const withBreaks = String(cellHtml ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtml(withBreaks)
    .split(/\n+/)
    .map((line) => line.replace(/\u00a0/g, " ").replace(/[　]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function attrNumber(attrs, name, fallback = 1) {
  const match = String(attrs ?? "").match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Number(match[1]) : fallback;
}

function extractFirstAdmissionTable(html) {
  const marker = html.indexOf("表中各省分数为一志愿录取最低分");
  const start = marker >= 0 ? html.indexOf("<table", marker) : html.indexOf("<table");
  if (start < 0) throw new Error("Could not find admission score table");
  const end = html.indexOf("</table>", start);
  if (end < 0) throw new Error("Could not find admission score table end");
  return html.slice(start, end + "</table>".length);
}

function parseRows(tableHtml) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of tableHtml.matchAll(rowRe)) {
    const cells = [];
    const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let logicalCol = 0;
    for (const cellMatch of rowMatch[1].matchAll(cellRe)) {
      const attrs = cellMatch[1];
      const colspan = attrNumber(attrs, "colspan", 1);
      const rowspan = attrNumber(attrs, "rowspan", 1);
      const lines = cellLines(cellMatch[2]);
      cells.push({
        start: logicalCol,
        colspan,
        rowspan,
        lines,
        text: lines.join(" "),
      });
      logicalCol += colspan;
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function normalizeProvince(raw) {
  const text = cleanInline(raw);
  if (PROVINCE_ALIASES.has(text)) return PROVINCE_ALIASES.get(text);
  return text.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
}

function metaForCell(start, colspan) {
  if (start === 1 && colspan === 2) {
    return {
      columnLabel: "普通综合改革合并列",
      subjectType: "综合",
      sourceSubjectRaw: "普通综合改革合并列",
      admissionType: "普通录取",
      admissionSubtype: "普通类",
      formalScoreScope: "school-official-only",
    };
  }
  if (start === 3 && colspan === 2) {
    return {
      columnLabel: "中外综合改革合并列",
      subjectType: "综合",
      sourceSubjectRaw: "中外综合改革合并列",
      admissionType: "中外合作办学",
      admissionSubtype: "中外合作办学",
      formalScoreScope: "school-official-only",
    };
  }
  return SINGLE_COLUMN_META[start] || null;
}

function parseScoreEntry(line) {
  const text = cleanInline(line).replace(/\s+/g, "");
  if (!text || text === "-" || text === "—" || text === "/") return null;
  const labeled = text.match(/^(.+?)[：:](\d+(?:\.\d+)?)$/);
  if (labeled) {
    return {
      label: cleanInline(labeled[1]),
      score: Number(labeled[2]),
      raw: text,
    };
  }
  const plain = text.match(/^(\d+(?:\.\d+)?)$/);
  if (plain) {
    return {
      label: "",
      score: Number(plain[1]),
      raw: text,
    };
  }
  return null;
}

function isSpecialLabel(label) {
  return /专项|预科|南疆|协作|民|汉|定向|单列|内高班|内地|民族|少数民族|港澳台/.test(label);
}

function subtypeWithLabel(baseSubtype, label) {
  if (!label) return baseSubtype;
  if (/^\d{2,4}组/.test(label)) return `${baseSubtype}-${label}`;
  if (label === "普通") return baseSubtype;
  return `${baseSubtype}-${label}`;
}

function campusFromLabel(label) {
  return /烟台/.test(label) ? "烟台研究院" : "";
}

function makeRecord({ province, rowIndex, cell, meta, entry, entryIndex, rawPath }) {
  const label = entry.label;
  const campusName = campusFromLabel(label);
  const admissionSubtype = subtypeWithLabel(meta.admissionSubtype, label);
  const formalScoreScope = meta.formalScoreScope === "special-path-only" || isSpecialLabel(label)
    ? "special-path-only"
    : meta.formalScoreScope;
  const id = `2025-cau-national-school-${stableId([
    province,
    rowIndex,
    cell.start,
    cell.colspan,
    meta.columnLabel,
    label,
    entry.score,
    entryIndex,
  ])}`;
  const majorName = [
    SOURCE.schoolName,
    campusName,
    `${admissionSubtype}录取最低分`,
    `（${meta.subjectType}）`,
  ].filter(Boolean).join("");
  const record = {
    id,
    province,
    sourceProvinceRaw: province,
    year: 2025,
    subjectType: meta.subjectType,
    sourceSubjectRaw: meta.sourceSubjectRaw,
    batch: "本科批",
    sourceBatchRaw: "2025年各省一志愿录取最低分",
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "institution-admission",
    majorName,
    majorGroup: [SOURCE.schoolName, campusName, province, meta.subjectType, admissionSubtype].filter(Boolean).join("-"),
    admissionType: meta.admissionType,
    admissionSubtype,
    formalScoreScope,
    minScore: entry.score,
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: PAGE_URL,
    sourcePageUrl: PAGE_URL,
    sourceListUrl: LIST_URL,
    officialEvidencePath: rawPath,
    sourcePagePath: rawPath,
    sourceMinScoreRaw: String(entry.score),
    rawRow: {
      rowIndex,
      province,
      cellStart: cell.start,
      colspan: cell.colspan,
      columnLabel: meta.columnLabel,
      lines: cell.lines,
      entryLabel: label,
      entryRaw: entry.raw,
    },
    cautions: [
      "本记录来自中国农业大学本科招生网官方2025年各省录取结果表，是单校分省/类型一志愿录取最低分边界，不是省级教育考试院全量投档/录取分数表。",
      "源页面只公开最低分，未公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      formalScoreScope === "special-path-only"
        ? "本行属于专项、预科、民族、南疆、协作或其他特殊路径，运行层按 special-path-only 隔离，不与普通批次边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于中国农业大学候选边界复核，但不得替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  if (campusName) {
    record.campusName = campusName;
    record.sourceCampusRaw = label;
  }
  if (label) record.sourceGroupRaw = label;
  return record;
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || "";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

async function main() {
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const listHtml = await downloadText(rawRoot, "cau-admission-list.html", LIST_URL, args.useCache);
  const pageHtml = await downloadText(rawRoot, "cau-2025-admission-result.html", PAGE_URL, args.useCache);
  const rawPaths = [
    path.posix.join(RAW_DIR, "cau-admission-list.html"),
    path.posix.join(RAW_DIR, "cau-2025-admission-result.html"),
  ];
  if (!/中国农业大学2025年各省录取结果查询/.test(listHtml)) {
    throw new Error("List page did not contain the expected 2025 CAU admission result link");
  }

  const tableHtml = extractFirstAdmissionTable(pageHtml);
  const rows = parseRows(tableHtml);
  const records = [];
  const warnings = [];
  const skippedRows = [];
  const pageRawPath = path.posix.join(RAW_DIR, "cau-2025-admission-result.html");

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const provinceCell = row[0];
    const province = normalizeProvince(provinceCell?.text || "");
    if (!province) continue;
    if (!MAINLAND_PROVINCES.has(province)) {
      skippedRows.push({ province, reason: "non-mainland-gaokao-region" });
      continue;
    }
    for (const cell of row.slice(1)) {
      const meta = metaForCell(cell.start, cell.colspan);
      if (!meta) {
        warnings.push(`No column metadata for province=${province} row=${rowIndex} start=${cell.start} colspan=${cell.colspan}`);
        continue;
      }
      let parsedInCell = 0;
      for (const [entryIndex, line] of cell.lines.entries()) {
        const entry = parseScoreEntry(line);
        if (!entry) continue;
        parsedInCell += 1;
        records.push(makeRecord({
          province,
          rowIndex,
          cell,
          meta,
          entry,
          entryIndex,
          rawPath: pageRawPath,
        }));
      }
      if (cell.lines.length && parsedInCell === 0 && cell.text && !/^[-—/]+$/.test(cell.text)) {
        warnings.push(`Unparsed cell province=${province} row=${rowIndex} column=${meta.columnLabel} text=${cell.text}`);
      }
    }
  }

  const uniqueIds = new Set(records.map((record) => record.id));
  if (uniqueIds.size !== records.length) {
    throw new Error(`Duplicate record ids: ${records.length - uniqueIds.size}`);
  }
  const mainlandProvinceCount = new Set(records.map((record) => record.province)).size;
  if (mainlandProvinceCount !== 31) {
    warnings.push(`Expected 31 mainland provinces, parsed ${mainlandProvinceCount}`);
  }

  const scoreValues = records.map((record) => Number(record.minScore)).filter(Number.isFinite);
  const shaList = rawPaths.map((rel) => {
    const abs = resolveProjectPath(rel);
    return { path: rel, sha256: sha256(fs.readFileSync(abs)) };
  });

  const sourceNotes = [{
    id: SOURCE.id,
    title: "中国农业大学本科招生网：2025年各省录取结果查询",
    publisher: "中国农业大学招生办公室",
    url: PAGE_URL,
    listUrl: LIST_URL,
    quality: SOURCE.quality,
    usage: "抽取中国农业大学本科招生网官方2025年各省录取结果 HTML 表；按普通理工/物理类、普通文史/历史类、中外、国家专项、高校专项、其他等列拆分一志愿录取最低分。综合改革省份的合并列按综合口径保留；专项、预科、民族、南疆、协作等特殊路径按 special-path-only 隔离。",
    parsedRecords: records.length,
    provinceCount: mainlandProvinceCount,
    years: [2025],
    recordsWithRank: 0,
    recordsWithoutRank: records.length,
    ordinarySchoolOfficialRecords: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRecords: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    byDataType: countBy(records, (record) => record.dataType),
    scoreRange: { min: Math.min(...scoreValues), max: Math.max(...scoreValues) },
    rawPaths,
    sha256: shaList,
    skippedRows,
    warnings,
    transcriptionMethod: "official-html-table",
    cautions: [
      "本源为中国农业大学官方单校各省一志愿最低分表，不是任何省级教育考试院全量投档/录取分数表。",
      "源页面未公开最低位次；运行层不生成假位次。",
      "特殊路径按 special-path-only 隔离，普通学校官网单校行按 school-official-only 保留，均不参与 formalScoreMissingProvinces 闭合统计。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  }];

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes, records }, null, 2)}\n`);
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    sourceNotes: sourceNotes.length,
    records: records.length,
    provinceCount: mainlandProvinceCount,
    years: sourceNotes[0].years,
    recordsWithRank: 0,
    recordsWithoutRank: records.length,
    ordinarySchoolOfficialRecords: sourceNotes[0].ordinarySchoolOfficialRecords,
    specialPathRecords: sourceNotes[0].specialPathRecords,
    bySubjectType: sourceNotes[0].bySubjectType,
    byFormalScoreScope: sourceNotes[0].byFormalScoreScope,
    scoreRange: sourceNotes[0].scoreRange,
    skippedRows,
    warnings,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
