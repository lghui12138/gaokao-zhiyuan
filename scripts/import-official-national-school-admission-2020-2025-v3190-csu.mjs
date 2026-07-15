#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2020-2025-v3190-csu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2020-2025-v3190-csu";
const API_BASE = "https://job-web-api.jobpi.cn";
const SCHOOL_ID = 21393;
const SOURCE = {
  id: "official-csu-national-2020-2025-school-admission",
  quality: "official-school-csu-2020-2025-national-dynamic-query-score-only",
  schoolCode: "10533",
  schoolName: "中南大学",
  city: "长沙",
  tags: ["综合", "985", "211", "双一流"],
};

const PAGES = [
  { key: "bkptl", title: "本科普通类", url: "https://zhaosheng.csu.edu.cn/lnfs/bkptl.htm" },
  { key: "gjzx", title: "国家专项", url: "https://zhaosheng.csu.edu.cn/lnfs/gjzx.htm" },
  { key: "ysl", title: "艺术类", url: "https://zhaosheng.csu.edu.cn/lnfs/ysl.htm" },
  { key: "dundee", title: "中南大学邓迪国际学院", url: "https://zhaosheng.csu.edu.cn/lnfs/zndxddgjxy.htm" },
  { key: "monash", title: "中南大学和蒙纳士大学中外合作办学项目", url: "https://zhaosheng.csu.edu.cn/lnfs/zndxhmnsdxzwhzbxxm.htm" },
];

const TARGETS = [
  {
    id: 2614,
    slug: "ordinary-major",
    title: "中南大学本科普通类录取结果公示",
    pageKey: "bkptl",
    dataType: "major-admission",
    admissionType: "普通录取",
    admissionSubtype: "本科普通类",
    formalScoreScope: "school-official-only",
    minScoreKey: "G",
    maxScoreKey: "F",
    avgScoreKey: "H",
    countKey: "I",
    majorKey: "D",
    detailKey: "E",
  },
  {
    id: 2615,
    slug: "ordinary-overview",
    title: "本科普通类录取概况",
    pageKey: "bkptl",
    dataType: "institution-admission",
    admissionType: "普通录取",
    admissionSubtype: "本科普通类录取概况",
    formalScoreScope: "school-official-only",
    overview: true,
  },
  {
    id: 2617,
    slug: "national-special-major",
    title: "中南大学国家贫困专项分专业录取结果公示",
    pageKey: "gjzx",
    dataType: "major-admission",
    admissionType: "国家贫困专项",
    admissionSubtype: "国家贫困专项",
    formalScoreScope: "special-path-only",
    minScoreKey: "F",
    countKey: "E",
    majorKey: "D",
  },
  {
    id: 2618,
    slug: "art-major",
    title: "中南大学艺术类分专业录取结果公示",
    pageKey: "ysl",
    dataType: "major-admission",
    admissionType: "艺术类",
    admissionSubtype: "艺术类",
    formalScoreScope: "special-path-only",
    minScoreKey: "F",
    countKey: "E",
    majorKey: "C",
    subjectKey: "D",
    remarkKey: "G",
    scoreKind: "composite-score",
  },
  {
    id: 2619,
    slug: "dundee-major",
    title: "中南大学邓迪国际学院分专业录取结果公示",
    pageKey: "dundee",
    dataType: "major-admission",
    admissionType: "普通录取",
    admissionSubtype: "邓迪国际学院",
    formalScoreScope: "school-official-only",
    minScoreKey: "H",
    countKey: "G",
    majorKey: "D",
    subjectKey: "F",
    batchKey: "C",
    selectionKey: "E",
  },
  {
    id: 2620,
    slug: "monash-major",
    title: "中南大学和蒙纳士大学中外合作办学项目分专业录取结果公示",
    pageKey: "monash",
    dataType: "major-admission",
    admissionType: "普通录取",
    admissionSubtype: "中外合作办学",
    formalScoreScope: "school-official-only",
    minScoreKey: "H",
    countKey: "G",
    majorKey: "D",
    subjectKey: "F",
    batchKey: "C",
    selectionKey: "E",
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2020-2025-v3190-csu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2020-2025-v3190-csu.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/API JSON",
    "",
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
    if (arg === "--use-cache") {
      args.useCache = true;
      continue;
    }
    if (arg === "--out") {
      args.out = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 16);
}

function resolveProjectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return { json: JSON.parse(text), text };
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${error.message}\n${text.slice(0, 200)}`);
  }
}

async function downloadText(rawRoot, relPath, url, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const text = await fetchText(url);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text);
  return text;
}

async function downloadJson(rawRoot, relPath, url, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const { json, text } = await fetchJson(url);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  fs.writeFileSync(`${file}.raw.txt`, text);
  return json;
}

function apiUrl(endpoint, params = {}) {
  const url = new URL(`${API_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  });
  return url.href;
}

function cleanText(value) {
  if (value == null) return "";
  return String(value)
    .replace(/<br\s*\/?>/gi, "；")
    .replace(/<\/br>/gi, "；")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-") return null;
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseIntValue(value) {
  const number = parseNumber(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function detectCandidateCategory(...values) {
  const text = values.map((value) => cleanText(value)).join(" ");
  if (/西藏（藏）|（藏）|\(藏\)|藏族/.test(text)) return "藏族";
  if (/西藏（汉）|（汉）|\(汉\)|汉族/.test(text)) return "汉族";
  return "";
}

function normalizeProvince(raw) {
  const text = cleanText(raw);
  if (/^西藏/.test(text)) return "西藏";
  if (text === "内蒙") return "内蒙古";
  return text.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
}

function normalizeSubject(raw, province = "") {
  const text = cleanText(raw);
  if (!text) return "";
  if (text === "/" && ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  if (text === "/") return "";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/综合|不分文理|不分科目/.test(text)) return "综合";
  if (/艺术/.test(text)) return "艺术类";
  return text;
}

function splitHtmlList(value) {
  const raw = String(value ?? "");
  return raw
    .split(/<br\s*\/?>|<\/br>|；|;/i)
    .map((part) => cleanText(part))
    .filter(Boolean);
}

function splitLabelScores(value) {
  const parts = splitHtmlList(value);
  if (parts.length === 0) return [];
  const parsed = parts.map((part) => {
    const match = part.match(/^(.+?)[：:]\s*(\d+(?:\.\d+)?)/);
    if (match) {
      return { label: cleanText(match[1]), value: Number(match[2]), raw: part };
    }
    const number = parseNumber(part);
    return Number.isFinite(number) ? { label: "", value: number, raw: part } : null;
  }).filter(Boolean);
  return parsed;
}

function mapLabelScores(value) {
  const map = new Map();
  for (const item of splitLabelScores(value)) {
    map.set(item.label || "__plain", item);
  }
  return map;
}

function baseRecord(target, row, sourcePageUrl, sourceApiUrl, rawPath, rowOrdinal, splitSuffix = "") {
  const year = parseIntValue(row.A);
  const provinceRaw = row.B;
  const province = normalizeProvince(provinceRaw);
  const subjectRaw = row[target.subjectKey || "C"];
  const subjectType = normalizeSubject(subjectRaw, province);
  const batch = cleanText(row[target.batchKey]) || "本科批";
  const candidateCategory = detectCandidateCategory(provinceRaw, subjectRaw, row.F, row.G, row.H, row.I);
  const hash = stableId([target.slug, rowOrdinal, row._id, splitSuffix, year, provinceRaw, subjectRaw, row.D, row.E, row.F, row.G, row.H]);
  const record = {
    id: `${year || "unknown"}-csu-${target.slug}-${hash}`,
    province,
    sourceProvinceRaw: cleanText(provinceRaw),
    year,
    subjectType,
    sourceSubjectRaw: cleanText(subjectRaw),
    batch,
    sourceBatchRaw: cleanText(row[target.batchKey]) || "本科批",
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: target.dataType,
    admissionType: target.admissionType,
    admissionSubtype: target.admissionSubtype,
    formalScoreScope: target.formalScoreScope,
    scoreOnly: true,
    rankUnavailable: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: sourcePageUrl,
    sourcePageUrl,
    sourceApiUrl,
    officialEvidencePath: rawPath,
    sourceApiPath: rawPath,
    rawRow: row,
    cautions: [
      "本记录来自中南大学招生在线官方历年分数查询系统，是单校分省/科类/专业录取边界，不是省级教育考试院全量投档/录取分数表。",
      "源系统未公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
      target.formalScoreScope === "special-path-only"
        ? "本记录属于专项、艺术类或其他特殊入口，已按 formalScoreScope=special-path-only 隔离，不与普通批无资格限制入口混用。"
        : "普通学校官网单校行按 formalScoreScope=school-official-only 保留，可用于中南大学候选边界复核，但不得替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  };
  if (candidateCategory) {
    record.candidateCategory = candidateCategory;
    record.sourceCandidateCategoryRaw = candidateCategory;
  }
  return record;
}

function applyScoreFields(record, target, row) {
  const minScore = parseNumber(row[target.minScoreKey]);
  if (!Number.isFinite(minScore)) return null;
  record.minScore = minScore;
  record.sourceMinScoreRaw = cleanText(row[target.minScoreKey]);
  const maxScore = parseNumber(row[target.maxScoreKey]);
  if (Number.isFinite(maxScore)) {
    record.maxScore = maxScore;
    record.sourceMaxScoreRaw = cleanText(row[target.maxScoreKey]);
  }
  const avgScore = parseNumber(row[target.avgScoreKey]);
  if (Number.isFinite(avgScore)) {
    record.avgScore = avgScore;
    record.sourceAvgScoreRaw = cleanText(row[target.avgScoreKey]);
  }
  const admitCount = parseIntValue(row[target.countKey]);
  if (Number.isInteger(admitCount)) {
    record.admitCount = admitCount;
    record.sourceAdmitCountRaw = cleanText(row[target.countKey]);
  }
  if (target.scoreKind) record.scoreKind = target.scoreKind;
  return record;
}

function ordinaryRecord(target, row, sourcePageUrl, sourceApiUrl, rawPath, rowOrdinal) {
  const record = baseRecord(target, row, sourcePageUrl, sourceApiUrl, rawPath, rowOrdinal);
  const majorName = cleanText(row[target.majorKey]);
  const detail = cleanText(row[target.detailKey]);
  record.majorName = majorName;
  if (detail && detail !== "/") record.majorDetail = detail;
  record.majorGroup = [
    SOURCE.schoolName,
    record.province,
    record.sourceSubjectRaw,
    target.admissionSubtype,
    majorName,
  ].filter(Boolean).join("-");
  if (target.selectionKey) record.subjectRequirement = cleanText(row[target.selectionKey]);
  if (target.remarkKey) record.remark = cleanText(row[target.remarkKey]);
  return applyScoreFields(record, target, row);
}

function overviewRecords(target, row, sourcePageUrl, sourceApiUrl, rawPath, rowOrdinal) {
  const minItems = splitLabelScores(row.G);
  const candidates = minItems.length ? minItems : [];
  if (candidates.length === 0) {
    const value = parseNumber(row.G);
    if (Number.isFinite(value)) candidates.push({ label: "", value, raw: cleanText(row.G) });
  }
  const maxMap = mapLabelScores(row.F);
  const filingMap = mapLabelScores(row.E);
  const avgMap = mapLabelScores(row.H);
  const records = [];
  for (const [itemIndex, item] of candidates.entries()) {
    const key = item.label || "__plain";
    const record = baseRecord(target, row, sourcePageUrl, sourceApiUrl, rawPath, rowOrdinal, `${key}-${itemIndex}`);
    const itemCategory = detectCandidateCategory(item.raw);
    if (itemCategory) {
      record.candidateCategory = itemCategory;
      record.sourceCandidateCategoryRaw = itemCategory;
    } else {
      delete record.candidateCategory;
      delete record.sourceCandidateCategoryRaw;
    }
    record.majorName = [SOURCE.schoolName, "本科普通类录取概况", item.label].filter(Boolean).join("-");
    record.majorGroup = [SOURCE.schoolName, record.province, record.sourceSubjectRaw, item.label || "本科普通类录取概况"].filter(Boolean).join("-");
    if (item.label) record.subjectRequirement = item.label;
    record.minScore = item.value;
    record.sourceMinScoreRaw = item.raw;
    const maxItem = maxMap.get(key) || maxMap.get("__plain");
    if (maxItem) {
      record.maxScore = maxItem.value;
      record.sourceMaxScoreRaw = maxItem.raw;
    }
    const filingItem = filingMap.get(key) || filingMap.get("__plain");
    if (filingItem) {
      record.filingScore = filingItem.value;
      record.sourceFilingScoreRaw = filingItem.raw;
    }
    const avgItem = avgMap.get(key) || avgMap.get("__plain");
    if (avgItem) {
      record.avgScore = avgItem.value;
      record.sourceAvgScoreRaw = avgItem.raw;
    }
    const controlScore = parseNumber(row.D);
    if (Number.isFinite(controlScore)) {
      record.controlScore = controlScore;
      record.sourceControlScoreRaw = cleanText(row.D);
    }
    records.push(record);
  }
  return records;
}

async function main() {
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const pageByKey = new Map();
  for (const page of PAGES) {
    const rel = `pages/${page.key}.html`;
    await downloadText(rawRoot, rel, page.url, args.useCache);
    pageByKey.set(page.key, page);
  }

  const enrollListUrl = apiUrl("/enroll", { page: 1, page_size: 200, sch_school_id: SCHOOL_ID });
  const enrollList = await downloadJson(rawRoot, "api/enroll-list.json", enrollListUrl, args.useCache);
  const availableIds = new Set((enrollList.data?.list || []).map((item) => item.id));
  const records = [];
  const warnings = [];

  for (const target of TARGETS) {
    if (!availableIds.has(target.id)) {
      warnings.push(`API enroll list did not include target id ${target.id} (${target.title})`);
    }
    const configUrl = apiUrl(`/enroll/config/v2/${target.id}`, { sch_school_id: SCHOOL_ID });
    const listUrl = apiUrl(`/enroll/${target.id}`, {
      sch_school_id: SCHOOL_ID,
      page: 1,
      page_size: 9999,
      filter_column: "{}",
    });
    const configRel = `api/config-${target.id}-${target.slug}.json`;
    const recordsRel = `api/records-${target.id}-${target.slug}.json`;
    const config = await downloadJson(rawRoot, configRel, configUrl, args.useCache);
    const list = await downloadJson(rawRoot, recordsRel, listUrl, args.useCache);
    if (config.code !== 200) {
      warnings.push(`Config API ${target.id} returned code ${config.code}: ${config.msg || ""}`);
      continue;
    }
    if (list.code !== 200) {
      warnings.push(`Records API ${target.id} returned code ${list.code}: ${list.msg || ""}`);
      continue;
    }
    const sourcePage = pageByKey.get(target.pageKey);
    const rawPath = path.posix.join(RAW_DIR, recordsRel);
    const rows = list.data?.list || [];
    for (const [rowIndex, row] of rows.entries()) {
      if (target.overview) {
        records.push(...overviewRecords(target, row, sourcePage.url, listUrl, rawPath, rowIndex));
      } else {
        const record = ordinaryRecord(target, row, sourcePage.url, listUrl, rawPath, rowIndex);
        if (record) records.push(record);
      }
    }
  }

  const uniqueIds = new Set(records.map((record) => record.id));
  if (uniqueIds.size !== records.length) {
    throw new Error(`Duplicate record ids: ${records.length - uniqueIds.size}`);
  }

  const by = (keyFn) => {
    const out = {};
    for (const record of records) {
      const key = keyFn(record) || "";
      out[key] = (out[key] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
  };
  const scoreValues = records.map((record) => record.minScore).filter(Number.isFinite);
  const rawPaths = [
    ...PAGES.map((page) => path.posix.join(RAW_DIR, `pages/${page.key}.html`)),
    path.posix.join(RAW_DIR, "api/enroll-list.json"),
    ...TARGETS.flatMap((target) => [
      path.posix.join(RAW_DIR, `api/config-${target.id}-${target.slug}.json`),
      path.posix.join(RAW_DIR, `api/records-${target.id}-${target.slug}.json`),
    ]),
  ];
  const shaList = rawPaths.map((rel) => {
    const abs = resolveProjectPath(rel);
    return { path: rel, sha256: sha256(fs.readFileSync(abs)) };
  });

  const sourceNotes = [{
    id: SOURCE.id,
    title: "中南大学招生在线：2020-2025 年全国分省分专业录取结果",
    publisher: "中南大学",
    url: "https://zhaosheng.csu.edu.cn/lnfs/bkptl.htm",
    pageUrls: Object.fromEntries(PAGES.map((page) => [page.key, page.url])),
    apiBase: API_BASE,
    apiTargets: Object.fromEntries(TARGETS.map((target) => [target.slug, {
      id: target.id,
      title: target.title,
      configUrl: apiUrl(`/enroll/config/v2/${target.id}`, { sch_school_id: SCHOOL_ID }),
      recordsUrl: apiUrl(`/enroll/${target.id}`, {
        sch_school_id: SCHOOL_ID,
        page: 1,
        page_size: 9999,
        filter_column: "{}",
      }),
    }])),
    quality: SOURCE.quality,
    usage: "抽取中南大学招生在线官方历年分数动态查询接口；保留本科普通类、普通类录取概况、国家贫困专项、艺术类、邓迪国际学院和中外合作办学项目的分省、科类、专业最低分。普通和中外合作单校行作候选边界复核，国家专项和艺术类隔离为特殊路径。",
    parsedRecords: records.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    years: [...new Set(records.map((record) => record.year).filter(Boolean))].sort((a, b) => a - b),
    recordsWithRank: 0,
    recordsWithoutRank: records.length,
    ordinarySchoolOfficialRecords: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRecords: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    byYear: by((record) => record.year),
    byProvince: by((record) => record.province),
    bySubjectType: by((record) => record.subjectType),
    byAdmissionSubtype: by((record) => record.admissionSubtype),
    byFormalScoreScope: by((record) => record.formalScoreScope),
    byDataType: by((record) => record.dataType),
    scoreRange: {
      min: Math.min(...scoreValues),
      max: Math.max(...scoreValues),
    },
    rawPaths,
    sha256: shaList,
    warnings,
    transcriptionMethod: "official-dynamic-query-json",
    cautions: [
      "本源为中南大学官方单校录取分数查询系统，不是任何省级教育考试院全量投档/录取分数表。",
      "源系统未公开最低位次；运行层不生成假位次，推荐层不得仅凭单校行输出录取概率。",
      "普通学校官网单校行按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "国家贫困专项和艺术类按 formalScoreScope=special-path-only 隔离，不与无资格限制普通批入口混用。",
      "中外合作办学和邓迪国际学院虽保留为学校官网单校边界，但需单独复核学费、培养模式、外语要求、校区和转专业限制。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  }];

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes, records }, null, 2)}\n`);
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    sourceNotes: sourceNotes.length,
    records: records.length,
    provinceCount: sourceNotes[0].provinceCount,
    years: sourceNotes[0].years,
    byFormalScoreScope: sourceNotes[0].byFormalScoreScope,
    scoreRange: sourceNotes[0].scoreRange,
    warnings,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
