#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3196-cuit-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3196-cuit";
const PROVINCE_URL = "https://zs.cuit.edu.cn/info/1022/1578.htm";
const SICHUAN_MAJOR_URL = "https://zs.cuit.edu.cn/info/1022/1579.htm";
const CHARTER_URL = "https://zs.cuit.edu.cn/info/1096/1462.htm";
const SOURCE = {
  id: "official-cuit-national-2025-school-admission",
  quality: "official-school-cuit-2025-national-html-province-and-sichuan-major-score-rank",
  schoolCode: "10621",
  schoolName: "成都信息工程大学",
  city: "成都",
  tags: ["理工", "气象"],
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
    `  node scripts/import-official-national-school-admission-2025-v3196-cuit.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3196-cuit.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML",
    "",
    "Imports Chengdu University of Information Technology official 2025 province summary and Sichuan major score tables.",
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

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  if (text.length < 1000) throw new Error(`Unexpectedly short HTML (${text.length} chars) for ${url}`);
  return text;
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
  return stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractTables(html) {
  return [...String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function tableGrid(tableHtml) {
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
      const colspan = attrNumber(attrs, "colspan", 1);
      const rowspan = attrNumber(attrs, "rowspan", 1);
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

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(text) : null;
}

function parseFirstNumber(value) {
  const match = clean(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseCategoryScores(value) {
  const text = clean(value);
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*（?\s*([AB])\s*类\s*）?/gi)];
  if (matches.length) {
    return matches.map((match) => ({ category: `${match[2].toUpperCase()}类`, value: Number(match[1]) }));
  }
  const one = parseFirstNumber(text);
  return Number.isFinite(one) ? [{ category: "", value: one }] : [];
}

function normalizeSubject(raw) {
  const text = clean(raw);
  if (/历史|文史/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/艺术|美术|设计|音乐/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  return "官网未列科类";
}

function classifyAdmission(textParts) {
  const text = textParts.map(clean).join(" ");
  if (/定向/.test(text)) {
    return { admissionType: "定向招生", admissionSubtype: "定向生", formalScoreScope: "special-path-only" };
  }
  if (/中高计划/.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "中高计划", formalScoreScope: "special-path-only" };
  }
  if (/国家专项|地方专项|专项/.test(text)) {
    return { admissionType: "专项计划", admissionSubtype: /国家专项/.test(text) ? "国家专项" : /地方专项/.test(text) ? "地方专项" : "专项计划", formalScoreScope: "special-path-only" };
  }
  if (/中外合作|中法|合作办学/.test(text)) {
    return { admissionType: "中外合作办学", admissionSubtype: "中外合作办学", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function makeRecord(base) {
  const id = `2025-cuit-school-${stableId([
    base.dataType,
    base.province,
    base.subjectType,
    base.sourceSubjectRaw,
    base.majorName,
    base.admissionSubtype,
    base.candidateCategory || "",
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
    batch: base.batch || "本科批",
    sourceBatchRaw: base.sourceBatchRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: base.dataType,
    majorName: base.majorName,
    majorGroup: base.majorGroup,
    admissionType: base.admissionType,
    admissionSubtype: base.admissionSubtype,
    formalScoreScope: base.formalScoreScope,
    minScore: base.minScore,
    scoreOnly: base.rankUnavailable,
    rankUnavailable: base.rankUnavailable,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: base.rankUnavailable ? "single-school-score" : "single-school-major-score-rank",
    sourceUrl: base.sourceUrl,
    sourcePageUrl: base.sourceUrl,
    sourceCharterUrl: CHARTER_URL,
    officialEvidencePath: base.sourceHtmlPath,
    sourceHtmlPath: base.sourceHtmlPath,
    sourceMinScoreRaw: String(base.minScore),
    rawRow: base.rawRow,
    cautions: base.cautions,
  };
  if (Number.isFinite(base.maxScore)) {
    record.maxScore = base.maxScore;
    record.sourceMaxScoreRaw = String(base.maxScore);
  }
  if (Number.isFinite(base.avgScore)) {
    record.avgScore = base.avgScore;
    record.sourceAvgScoreRaw = String(base.avgScore);
  }
  if (Number.isFinite(base.minRank)) {
    record.minRank = base.minRank;
    record.sourceRankRaw = String(base.minRank);
  }
  if (base.controlLine != null) {
    record.controlLine = base.controlLine;
    record.sourceControlLineRaw = String(base.controlLine);
  }
  if (base.candidateCategory) {
    record.candidateCategory = base.candidateCategory;
    record.sourceCandidateCategoryRaw = base.candidateCategory;
  }
  if (base.majorCode) record.majorCode = base.majorCode;
  if (base.electiveRequirement) record.electiveRequirement = base.electiveRequirement;
  return record;
}

function parseProvinceSummary(html) {
  const tables = extractTables(html).map(tableGrid);
  if (tables.length !== 2) throw new Error(`Expected 2 province-summary tables, found ${tables.length}`);
  const rawPath = path.posix.join(RAW_DIR, "cuit-2025-province-summary.html");
  const records = [];
  let ordinal = 0;

  for (const row of tables[0].slice(2)) {
    const [province, rawSubject, maxRaw, avgRaw, minRaw, controlRaw] = row;
    if (!MAINLAND_PROVINCES.has(province)) continue;
    const minScores = parseCategoryScores(minRaw);
    for (const min of minScores) {
      const max = parseCategoryScores(maxRaw).find((item) => item.category === min.category)?.value ?? parseFirstNumber(maxRaw);
      const avg = parseCategoryScores(avgRaw).find((item) => item.category === min.category)?.value ?? parseFirstNumber(avgRaw);
      const controlLine = parseCategoryScores(controlRaw).find((item) => item.category === min.category)?.value ?? parseFirstNumber(controlRaw);
      const classification = classifyAdmission([rawSubject, min.category]);
      const subtype = min.category ? `西藏${min.category}` : classification.admissionSubtype;
      records.push(makeRecord({
        province,
        sourceProvinceRaw: province,
        sourceSubjectRaw: rawSubject,
        subjectType: normalizeSubject(rawSubject),
        sourceBatchRaw: "2025年分省录取分数统计表：未改革省份",
        dataType: "school-admission-summary",
        majorName: "分省录取分数统计",
        majorGroup: [SOURCE.schoolName, province, rawSubject, min.category || "普通"].join("-"),
        ...classification,
        admissionSubtype: subtype,
        formalScoreScope: "school-official-only",
        minScore: min.value,
        maxScore: max,
        avgScore: avg,
        controlLine,
        rankUnavailable: true,
        candidateCategory: min.category ? min.category : "",
        sourceUrl: PROVINCE_URL,
        sourceHtmlPath: rawPath,
        ordinal,
        rawRow: { source: "cuit-province-summary-unreformed-html", cells: row, category: min.category },
        cautions: [
          "本记录来自成都信息工程大学本科招生网官方2025年分省录取分数统计表，是单校分省/科类录取边界，不是省级教育考试院全量投档/录取分数表。",
          "源表未公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
          "西藏A/B类等候选类别必须按 candidateCategory 分开复核；学校官网单校数据不关闭西藏省级正式投档表缺口。",
          "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
        ],
      }));
      ordinal += 1;
    }
  }

  for (const row of tables[1].slice(2)) {
    const [province, rawSubject, maxRaw, avgRaw, minRaw, controlRaw] = row;
    if (!MAINLAND_PROVINCES.has(province)) continue;
    const minScore = parseNumber(minRaw);
    if (!Number.isFinite(minScore)) continue;
    const classification = classifyAdmission([rawSubject]);
    records.push(makeRecord({
      province,
      sourceProvinceRaw: province,
      sourceSubjectRaw: rawSubject,
      subjectType: normalizeSubject(rawSubject),
      sourceBatchRaw: "2025年分省录取分数统计表：专业＋学校",
      dataType: "school-admission-summary",
      majorName: "分省录取分数统计",
      majorGroup: [SOURCE.schoolName, province, rawSubject, classification.admissionSubtype, ordinal].join("-"),
      ...classification,
      minScore,
      maxScore: parseNumber(maxRaw),
      avgScore: parseNumber(avgRaw),
      controlLine: parseNumber(controlRaw),
      rankUnavailable: true,
      sourceUrl: PROVINCE_URL,
      sourceHtmlPath: rawPath,
      ordinal,
      rawRow: { source: "cuit-province-summary-html", cells: row },
      cautions: [
        "本记录来自成都信息工程大学本科招生网官方2025年分省录取分数统计表，是单校分省/科类录取边界，不是省级教育考试院全量投档/录取分数表。",
        "源表未公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
        classification.formalScoreScope === "special-path-only"
          ? "本行含中高计划、定向或专项等特殊路径语义，运行层按 special-path-only 隔离，不与普通批次边界混用。"
          : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于成都信息工程大学候选边界复核，但不得替代同省省级正式投档表。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    }));
    ordinal += 1;
  }
  return records;
}

function parseSichuanMajor(html) {
  const tables = extractTables(html).map(tableGrid);
  if (tables.length !== 1) throw new Error(`Expected 1 Sichuan-major table, found ${tables.length}`);
  const rawPath = path.posix.join(RAW_DIR, "cuit-2025-sichuan-major.html");
  const rows = tables[0];
  const headerIndex = rows.findIndex((row) => row.includes("专业名称") && row.includes("最低位次"));
  if (headerIndex < 0) throw new Error("Could not find Sichuan major table header");
  const records = [];
  let ordinal = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const [subjectRaw, groupRaw, electiveRaw, majorRaw, maxRaw, avgRaw, minRaw, rankRaw] = row;
    const majorName = clean(majorRaw);
    if (!majorName || /专业名称/.test(majorName)) continue;
    const minScore = parseNumber(minRaw);
    if (!Number.isFinite(minScore)) continue;
    const minRank = parseNumber(rankRaw);
    const classification = classifyAdmission([subjectRaw, groupRaw, electiveRaw, majorName]);
    records.push(makeRecord({
      province: "四川",
      sourceProvinceRaw: "四川",
      sourceSubjectRaw: subjectRaw,
      subjectType: normalizeSubject(subjectRaw),
      sourceBatchRaw: "2025年四川本科B段录取情况（不含征集）",
      batch: "本科B段",
      dataType: "major-admission",
      majorName,
      majorCode: groupRaw,
      majorGroup: [SOURCE.schoolName, "四川", subjectRaw, groupRaw, electiveRaw, majorName].filter(Boolean).join("-"),
      electiveRequirement: electiveRaw,
      ...classification,
      minScore,
      maxScore: parseNumber(maxRaw),
      avgScore: parseNumber(avgRaw),
      minRank,
      rankUnavailable: !Number.isFinite(minRank),
      sourceUrl: SICHUAN_MAJOR_URL,
      sourceHtmlPath: rawPath,
      ordinal,
      rawRow: {
        source: "cuit-sichuan-major-html",
        cells: row,
        subjectRaw,
        majorGroupCode: groupRaw,
        electiveRequirement: electiveRaw,
        majorName,
      },
      cautions: [
        "本记录来自成都信息工程大学本科招生网官方2025年四川分专业录取分数统计表，是单校四川本科B段专业录取分数/位次边界，不是四川省教育考试院全量投档表。",
        Number.isFinite(minRank)
          ? "本行含学校官网公布的最低位次，但仍是单校来源；推荐层可用于成都信息工程大学候选边界复核，不得替代省级正式投档表和当年计划约束。"
          : "源表本行未公开最低位次；运行层不生成假位次。",
        classification.formalScoreScope === "special-path-only"
          ? "本行属于定向生、中高计划或其他特殊路径之一，运行层按 special-path-only 隔离，不与普通批次边界混用。"
          : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    }));
    ordinal += 1;
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

  const provinceHtml = await downloadText(rawRoot, "cuit-2025-province-summary.html", PROVINCE_URL, args.useCache);
  const sichuanHtml = await downloadText(rawRoot, "cuit-2025-sichuan-major.html", SICHUAN_MAJOR_URL, args.useCache);
  const charterHtml = await downloadText(rawRoot, "cuit-2025-charter.html", CHARTER_URL, args.useCache);
  if (!/2025年分省录取分数统计表/.test(extractTitle(provinceHtml))) {
    throw new Error("Province summary source title did not match expected 2025 CUIT page");
  }
  if (!/2025年四川分专业录取分数统计表/.test(extractTitle(sichuanHtml))) {
    throw new Error("Sichuan major source title did not match expected 2025 CUIT page");
  }
  if (!/学校录取规则为“位次优先，遵循志愿”/.test(charterHtml)) {
    throw new Error("CUIT charter page did not contain expected admission-rule text");
  }

  const provinceRecords = parseProvinceSummary(provinceHtml);
  const sichuanMajorRecords = parseSichuanMajor(sichuanHtml);
  const records = [...provinceRecords, ...sichuanMajorRecords];
  if (provinceRecords.length < 100) throw new Error(`Parsed too few CUIT province summary records: ${provinceRecords.length}`);
  if (sichuanMajorRecords.length < 50) throw new Error(`Parsed too few CUIT Sichuan major records: ${sichuanMajorRecords.length}`);

  const provinces = [...new Set(records.map((record) => record.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const missingMainland = [...MAINLAND_PROVINCES].filter((province) => !provinces.includes(province)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const recordsWithRank = records.filter((record) => !record.rankUnavailable).length;
  const recordsWithoutRank = records.length - recordsWithRank;
  const ordinarySchoolOfficialRecords = records.filter((record) => record.formalScoreScope === "school-official-only").length;
  const specialPathRecords = records.filter((record) => record.formalScoreScope === "special-path-only").length;

  const payload = {
    sourceNotes: [
      {
        id: SOURCE.id,
        title: "成都信息工程大学本科招生网：2025年分省录取分数统计表、2025年四川分专业录取分数统计表",
        publisher: "成都信息工程大学本科招生网",
        url: PROVINCE_URL,
        provinceSummaryUrl: PROVINCE_URL,
        sichuanMajorUrl: SICHUAN_MAJOR_URL,
        charterUrl: CHARTER_URL,
        quality: SOURCE.quality,
        usage: "抽取成都信息工程大学本科招生网官方2025年分省录取分数统计表和四川分专业录取分数统计表。分省表按省份/科类/最高分/平均分/最低分/控制线解析为单校分省汇总记录；四川分专业表按科类/专业组/选科/专业/最高分/平均分/最低分/最低位次解析为专业粒度记录。西藏A/B类、定向生、中高计划等边界单独标注并按需隔离。",
        parsedRecords: records.length,
        provinceSummaryRecords: provinceRecords.length,
        sichuanMajorRecords: sichuanMajorRecords.length,
        provinceCount: provinces.length,
        missingMainlandProvinces: missingMainland,
        years: [2025],
        recordsWithRank,
        recordsWithoutRank,
        ordinarySchoolOfficialRecords,
        specialPathRecords,
        byProvince: countBy(records, (record) => record.province),
        bySubjectType: countBy(records, (record) => record.subjectType),
        byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
        byAdmissionType: countBy(records, (record) => record.admissionType),
        byDataType: countBy(records, (record) => record.dataType),
        scoreRange: scoreRange(records),
        rawPaths: [
          path.posix.join(RAW_DIR, "cuit-2025-province-summary.html"),
          path.posix.join(RAW_DIR, "cuit-2025-sichuan-major.html"),
          path.posix.join(RAW_DIR, "cuit-2025-charter.html"),
        ],
        cautions: [
          "本导入包来自成都信息工程大学学校官网单校数据，不关闭任何省级正式投档表缺口。",
          "分省汇总表无最低位次，运行层不生成假位次；四川专业表含最低位次但仍只用于单校候选边界复核。",
          "西藏A/B类、中高计划、定向生等记录需要按 candidateCategory 或 formalScoreScope 单独复核，不参与普通批次混合边界。",
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
    provinceSummaryRecords: provinceRecords.length,
    sichuanMajorRecords: sichuanMajorRecords.length,
    provinces: provinces.length,
    missingMainlandProvinces: missingMainland,
    recordsWithRank,
    recordsWithoutRank,
    ordinarySchoolOfficialRecords,
    specialPathRecords,
    byProvince: payload.sourceNotes[0].byProvince,
    byFormalScoreScope: payload.sourceNotes[0].byFormalScoreScope,
    byDataType: payload.sourceNotes[0].byDataType,
    scoreRange: payload.sourceNotes[0].scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
