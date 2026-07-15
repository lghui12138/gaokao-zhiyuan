#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3197-huel-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3197-huel";
const PROVINCE_URL = "https://zs.huel.edu.cn/info/1357/3121.htm";
const CHARTER_URL = "https://zs.huel.edu.cn/info/1356/2966.htm";
const SOURCE = {
  id: "official-huel-national-2025-school-admission",
  quality: "official-school-huel-2025-national-undergraduate-html-province-score-rank",
  schoolCode: "10484",
  schoolName: "河南财经政法大学",
  city: "郑州",
  tags: ["财经", "政法"],
};

const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3197-huel.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3197-huel.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Henan University of Economics and Law official 2025 national undergraduate province admission table.",
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
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 16);
}

function decodeBody(buffer, encoding) {
  const value = String(encoding || "");
  if (/br/i.test(value)) return zlib.brotliDecompressSync(buffer).toString("utf8");
  if (/gzip/i.test(value)) return zlib.gunzipSync(buffer).toString("utf8");
  if (/deflate/i.test(value)) return zlib.inflateSync(buffer).toString("utf8");
  return buffer.toString("utf8");
}

function fetchTextOnce(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      family: 4,
      timeout: 90_000,
      headers: {
        "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        "accept-encoding": "gzip, deflate, br",
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = decodeBody(Buffer.concat(chunks), res.headers["content-encoding"]);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}: ${text.slice(0, 200)}`));
          return;
        }
        resolve(text);
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Timeout fetching ${url}`)));
    req.on("error", reject);
  });
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const text = await fetchTextOnce(url);
      if (text.length < 1000) throw new Error(`Unexpectedly short HTML (${text.length} chars) for ${url}`);
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
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
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function attrNumber(attrs, name, fallback = 1) {
  const match = String(attrs ?? "").match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Number(match[1]) : fallback;
}

function extractTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractTables(html) {
  return [...String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function logicalRows(tableHtml) {
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
      row[col] = text;
      if (rowspan > 1) spans[col] = { text, remaining: rowspan - 1 };
      col += 1;
    }
    const cleaned = row.map((cell) => clean(cell));
    if (cleaned.some(Boolean)) rows.push(cleaned);
  }
  return rows;
}

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function splitRaw(value) {
  const text = clean(value);
  if (!text || text === "-" || text === "—") return [text];
  return text.split("/").map((part) => clean(part));
}

function normalizeSubject(raw) {
  const text = clean(raw);
  if (/历史|文史/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|3\+3|不限科类/.test(text)) return "综合改革";
  return "官网未列科类";
}

function normalizeBatch(raw) {
  const text = clean(raw);
  if (/本科一批/.test(text)) return "本科一批";
  if (/本科普通批/.test(text)) return "本科普通批";
  return text || "本科批";
}

function variantName(index, total) {
  if (total <= 1) return { admissionSubtype: "普通类", sourceVariantRaw: "" };
  if (index === 0) return { admissionSubtype: "普通类", sourceVariantRaw: "普通本科" };
  if (index === 1) return { admissionSubtype: "省级特色化示范性软件学院本科", sourceVariantRaw: "省级特色化示范性软件学院本科" };
  return { admissionSubtype: `源表斜线拆分项${index + 1}`, sourceVariantRaw: `源表斜线拆分项${index + 1}` };
}

function asRawAt(parts, index) {
  if (parts.length === 1) return parts[0];
  return parts[index] ?? "";
}

function shouldKeepControlLine(controlLine, minScore) {
  return Number.isFinite(controlLine) && Number.isFinite(minScore) && controlLine <= minScore;
}

function makeRecord(base) {
  const id = `2025-huel-school-${stableId([
    base.province,
    base.subjectType,
    base.sourceSubjectRaw,
    base.admissionSubtype,
    base.minScore,
    base.minRank ?? "",
    base.ordinal,
  ])}`;
  const record = {
    id,
    province: base.province,
    sourceProvinceRaw: base.sourceProvinceRaw || base.province,
    year: 2025,
    subjectType: base.subjectType,
    sourceSubjectRaw: base.sourceSubjectRaw,
    batch: base.batch,
    sourceBatchRaw: base.sourceBatchRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "school-admission-summary",
    majorName: "普通本科分省录取情况",
    majorGroup: [SOURCE.schoolName, base.province, base.sourceSubjectRaw, base.admissionSubtype].filter(Boolean).join("-"),
    admissionType: "普通录取",
    admissionSubtype: base.admissionSubtype,
    formalScoreScope: "school-official-only",
    minScore: base.minScore,
    scoreOnly: base.rankUnavailable,
    rankUnavailable: base.rankUnavailable,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: base.rankUnavailable ? "single-school-score" : "single-school-province-score-rank",
    sourceUrl: PROVINCE_URL,
    sourcePageUrl: PROVINCE_URL,
    sourceCharterUrl: CHARTER_URL,
    officialEvidencePath: base.sourceHtmlPath,
    sourceHtmlPath: base.sourceHtmlPath,
    sourceMinScoreRaw: base.sourceMinScoreRaw,
    rawRow: base.rawRow,
    cautions: base.cautions,
  };
  if (base.sourceVariantRaw) record.sourceVariantRaw = base.sourceVariantRaw;
  if (Number.isFinite(base.admissionCount)) {
    record.admissionCount = base.admissionCount;
    record.sourceAdmissionCountRaw = base.sourceAdmissionCountRaw;
  }
  if (Number.isFinite(base.minRank)) {
    record.minRank = base.minRank;
    record.sourceRankRaw = base.sourceRankRaw;
  }
  if (Number.isFinite(base.controlLine)) {
    record.controlLine = base.controlLine;
  }
  if (base.sourceControlLineRaw) {
    record.sourceControlLineRaw = base.sourceControlLineRaw;
  }
  if (base.controlLineSourceAnomaly) {
    record.controlLineSourceAnomaly = base.controlLineSourceAnomaly;
  }
  return record;
}

function recordsForSubject({ row, province, batchRaw, subjectRaw, values, sourceSection, ordinalRef, sourceHtmlPath }) {
  const countParts = splitRaw(values.countRaw);
  const minParts = splitRaw(values.minRaw);
  const rankParts = splitRaw(values.rankRaw);
  const maxParts = Math.max(countParts.length, minParts.length, rankParts.length);
  const records = [];
  for (let index = 0; index < maxParts; index += 1) {
    const minRaw = asRawAt(minParts, index);
    const minScore = parseNumber(minRaw);
    if (!Number.isFinite(minScore)) continue;
    const countRaw = asRawAt(countParts, index);
    const rankRaw = asRawAt(rankParts, index);
    const controlRaw = clean(values.controlRaw);
    const controlNumber = parseNumber(controlRaw);
    const controlLine = shouldKeepControlLine(controlNumber, minScore) ? controlNumber : null;
    const controlLineSourceAnomaly = Number.isFinite(controlNumber) && Number.isFinite(minScore) && controlNumber > minScore
      ? "源表省控线单元格高于最低分，运行层仅保留 sourceControlLineRaw，不将其作为数值控制线约束。"
      : "";
    const minRank = parseNumber(rankRaw);
    const { admissionSubtype, sourceVariantRaw } = variantName(index, maxParts);
    const variantCaution = sourceVariantRaw
      ? "源表说明斜线数据按“普通本科 / 省级特色化示范性软件学院本科”顺序拆分；本记录只对应其中一个子类型。"
      : "本行无斜线拆分，按源表单一普通本科边界保留。";
    const anomalyCaution = controlLineSourceAnomaly
      ? "源表存在省控线/最低分显示不一致的单元格，运行层不自行纠错，只保留原始单元格供人工复核。"
      : "省控线仅作为源表辅助字段保留，推荐层仍需回到省级考试院和当年计划复核。";
    records.push(makeRecord({
      province,
      sourceProvinceRaw: province,
      subjectType: normalizeSubject(subjectRaw),
      sourceSubjectRaw: subjectRaw,
      batch: normalizeBatch(batchRaw),
      sourceBatchRaw: batchRaw,
      admissionSubtype,
      sourceVariantRaw,
      minScore,
      sourceMinScoreRaw: minRaw,
      minRank,
      sourceRankRaw: rankRaw,
      admissionCount: parseNumber(countRaw),
      sourceAdmissionCountRaw: countRaw,
      controlLine,
      sourceControlLineRaw: controlRaw,
      controlLineSourceAnomaly,
      rankUnavailable: !Number.isFinite(minRank),
      sourceHtmlPath,
      ordinal: ordinalRef.value,
      rawRow: {
        source: sourceSection,
        cells: row,
        subjectRaw,
        countRaw,
        controlRaw,
        minScoreRaw: minRaw,
        minRankRaw: rankRaw,
        sourceVariantRaw,
      },
      cautions: [
        "本记录来自河南财经政法大学招生信息网官方2025年普通本科分省录取情况一览表，是单校分省/科类录取边界，不是省级教育考试院全量投档/录取分数表。",
        "源表说明本表数据不含国家专项、地方专项、艺术类、少数民族预科、哈密定向、南疆单列、协作计划、内地班和中外合作办学。",
        variantCaution,
        anomalyCaution,
        "学校官网单校数据按 formalScoreScope=school-official-only 保留，不关闭西藏或其他省级正式投档表缺口。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    }));
    ordinalRef.value += 1;
  }
  return records;
}

function parseAdmissionTable(html) {
  const tables = extractTables(html).map(logicalRows);
  const rows = tables.find((tableRows) => tableRows.some((row) => row.includes("本科一批")) && tableRows.some((row) => row.includes("河南")));
  if (!rows) throw new Error("Could not find HUEL national undergraduate admission table");
  const rawPath = path.posix.join(RAW_DIR, "huel-2025-province-undergraduate.html");
  const records = [];
  const ordinalRef = { value: 0 };
  for (const row of rows) {
    const batchRaw = clean(row[0]);
    const province = clean(row[1]);
    if (!MAINLAND_PROVINCES.has(province)) continue;
    if (/3\+3/.test(batchRaw)) {
      const [countRaw, controlRaw, minRaw, rankRaw] = row.slice(2, 6);
      records.push(...recordsForSubject({
        row,
        province,
        batchRaw,
        subjectRaw: "3+3综合改革",
        values: { countRaw, controlRaw, minRaw, rankRaw },
        sourceSection: "huel-2025-3plus3-html",
        ordinalRef,
        sourceHtmlPath: rawPath,
      }));
      continue;
    }
    if (/文史|理工|历史类|物理类|本科一批|3\+1\+2/.test(batchRaw) || row.length >= 10) {
      const historySubject = /本科一批/.test(batchRaw) ? "文史" : "历史类";
      const physicsSubject = /本科一批/.test(batchRaw) ? "理工" : "物理类";
      records.push(...recordsForSubject({
        row,
        province,
        batchRaw,
        subjectRaw: historySubject,
        values: {
          countRaw: row[2],
          controlRaw: row[3],
          minRaw: row[4],
          rankRaw: row[5],
        },
        sourceSection: /本科一批/.test(batchRaw) ? "huel-2025-unreformed-html" : "huel-2025-3plus1plus2-html",
        ordinalRef,
        sourceHtmlPath: rawPath,
      }));
      records.push(...recordsForSubject({
        row,
        province,
        batchRaw,
        subjectRaw: physicsSubject,
        values: {
          countRaw: row[6],
          controlRaw: row[7],
          minRaw: row[8],
          rankRaw: row[9],
        },
        sourceSection: /本科一批/.test(batchRaw) ? "huel-2025-unreformed-html" : "huel-2025-3plus1plus2-html",
        ordinalRef,
        sourceHtmlPath: rawPath,
      }));
    }
  }
  return records;
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
  return { min: Math.min(...scores), max: Math.max(...scores) };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const provinceHtml = await downloadText(rawRoot, "huel-2025-province-undergraduate.html", PROVINCE_URL, args.useCache);
  const charterHtml = await downloadText(rawRoot, "huel-2025-charter.html", CHARTER_URL, args.useCache);
  if (!/2025年普通本科分省录取情况一览表/.test(extractTitle(provinceHtml))) {
    throw new Error("HUEL province admission source title did not match expected 2025 page");
  }
  if (!/河南财经政法大学2025年招生章程/.test(extractTitle(charterHtml))) {
    throw new Error("HUEL charter page title did not match expected 2025 charter page");
  }
  if (!/本表数据不含国家专项、地方专项、艺术类、少数民族预科/.test(provinceHtml)) {
    throw new Error("HUEL source table did not contain expected exclusion note");
  }

  const records = parseAdmissionTable(provinceHtml);
  if (records.length < 50) throw new Error(`Parsed too few HUEL admission records: ${records.length}`);
  const provinces = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingMainland = [...MAINLAND_PROVINCES].filter((province) => !provinces.includes(province)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const recordsWithRank = records.filter((record) => !record.rankUnavailable).length;
  const recordsWithoutRank = records.length - recordsWithRank;
  const slashSplitRecords = records.filter((record) => record.sourceVariantRaw).length;
  const controlLineRawOnlyRecords = records.filter((record) => record.controlLineSourceAnomaly).length;

  const payload = {
    sourceNotes: [
      {
        id: SOURCE.id,
        title: "河南财经政法大学招生信息网：2025年普通本科分省录取情况一览表",
        publisher: "河南财经政法大学招生信息网",
        url: PROVINCE_URL,
        provinceSummaryUrl: PROVINCE_URL,
        charterUrl: CHARTER_URL,
        quality: SOURCE.quality,
        usage: "抽取河南财经政法大学招生信息网官方2025年普通本科分省录取情况一览表。未改革、新高考3+1+2和3+3省份分别按源表列解析为单校分省/科类/最低分/最低位次记录；源表斜线数据按表注“普通本科 / 省级特色化示范性软件学院本科”拆分为独立记录。",
        parsedRecords: records.length,
        provinceCount: provinces.length,
        missingMainlandProvinces: missingMainland,
        years: [2025],
        recordsWithRank,
        recordsWithoutRank,
        slashSplitRecords,
        controlLineRawOnlyRecords,
        ordinarySchoolOfficialRecords: records.length,
        specialPathRecords: 0,
        byProvince: countBy(records, (record) => record.province),
        bySubjectType: countBy(records, (record) => record.subjectType),
        byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
        byAdmissionSubtype: countBy(records, (record) => record.admissionSubtype),
        byDataType: countBy(records, (record) => record.dataType),
        scoreRange: scoreRange(records),
        rawPaths: [
          path.posix.join(RAW_DIR, "huel-2025-province-undergraduate.html"),
          path.posix.join(RAW_DIR, "huel-2025-charter.html"),
        ],
        cautions: [
          "本导入包来自河南财经政法大学学校官网单校数据，不关闭任何省级正式投档表缺口。",
          "源表已说明不含国家专项、地方专项、艺术、预科、定向、南疆单列、协作计划、内地班和中外合作办学。",
          "源表斜线数据按普通本科/省级特色化示范性软件学院本科拆分，推荐层不得把两个子类型合并成单一边界。",
          "若源表省控线单元格与最低分明显不一致，运行层保留原始单元格但不自行补造修正值。",
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
    provinces: provinces.length,
    missingMainlandProvinces: missingMainland,
    recordsWithRank,
    recordsWithoutRank,
    slashSplitRecords,
    controlLineRawOnlyRecords,
    byProvince: payload.sourceNotes[0].byProvince,
    byFormalScoreScope: payload.sourceNotes[0].byFormalScoreScope,
    byAdmissionSubtype: payload.sourceNotes[0].byAdmissionSubtype,
    byDataType: payload.sourceNotes[0].byDataType,
    scoreRange: payload.sourceNotes[0].scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
