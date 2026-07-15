#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2021-2025-v3230-neepu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2021-2025-v3230-neepu";
const BASE_URL = "https://zs.neepu.edu.cn";
const INDEX_URL = `${BASE_URL}/lnfs.htm`;
const ITEMS_URL = `${BASE_URL}/aop_component//webber/formquery/query/front/items/get`;
const RESULT_SHOW_URL = `${BASE_URL}/aop_component//webber/formquery/query/result/show/Form-1718611824115-7316`;
const DATA_URL = `${BASE_URL}/aop_component//webber/formquery/data/get/info`;
const TOKEN_URL = `${BASE_URL}/system/resource/getToken.jsp?mode=10`;
const SESSION_URL = `${BASE_URL}/system/resource/getSession.jsp`;

const SOURCE = {
  id: "official-neepu-national-2021-2025-school-admission",
  quality: "official-school-neepu-2021-2025-national-openapp-score-rank",
  schoolCode: "10188",
  schoolName: "东北电力大学",
  city: "吉林",
  publisher: "东北电力大学招生就业处",
  tags: ["吉林", "吉林市", "东北电力大学", "电力", "理工"],
};

const YEARS = [2021, 2022, 2023, 2024, 2025];

const PROVINCES = [
  ["bj", "北京", "北京市"],
  ["tj", "天津", "天津市"],
  ["hb", "河北", "河北省"],
  ["sx", "山西", "山西省"],
  ["nmg", "内蒙古", "内蒙古自治区"],
  ["ln", "辽宁", "辽宁省"],
  ["jl", "吉林", "吉林省"],
  ["hlj", "黑龙江", "黑龙江省"],
  ["sh", "上海", "上海市"],
  ["js", "江苏", "江苏省"],
  ["zj", "浙江", "浙江省"],
  ["ah", "安徽", "安徽省"],
  ["fj", "福建", "福建省"],
  ["jx", "江西", "江西省"],
  ["sd", "山东", "山东省"],
  ["hn", "河南", "河南省"],
  ["hbs", "湖北", "湖北省"],
  ["hns", "湖南", "湖南省"],
  ["gd", "广东", "广东省"],
  ["gx", "广西", "广西壮族自治区"],
  ["hnss", "海南", "海南省"],
  ["cq", "重庆", "重庆市"],
  ["sc", "四川", "四川省"],
  ["gz", "贵州", "贵州省"],
  ["yn", "云南", "云南省"],
  ["xz", "西藏", "西藏自治区"],
  ["sxs", "陕西", "陕西省"],
  ["gs", "甘肃", "甘肃省"],
  ["qh", "青海", "青海省"],
  ["nx", "宁夏", "宁夏回族自治区"],
  ["xj", "新疆", "新疆维吾尔自治区"],
];

const PROVINCE_BY_CODE = new Map(PROVINCES.map(([code, province, fullName]) => [code, { code, province, fullName }]));

const FIELDS = {
  province: "Item-1718611824265-1952",
  year: "Item-1718611824265-7316",
  batch: "Item-1718611824265-9502",
  subject: "Item-1718611824265-8091",
  group: "Item-1718611824265-8222",
  major: "Item-1718611824265-4608",
  count: "Item-1718611824265-1535",
  maxScore: "Item-1718611824265-9754",
  minScore: "Item-1718611824265-4749",
  avgScore: "Item-1718611824265-4320",
  maxRank: "Item-1718611824265-8128",
  minRank: "Item-1718611824265-9090",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2021-2025-v3230-neepu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2021-2025-v3230-neepu.mjs --province xz --years 2025 --use-cache",
    "",
    "Imports 东北电力大学招生信息网 2021-2025 历年分数 OpenApp JSON query data.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    useCache: false,
    provinceCodes: PROVINCES.map(([code]) => code),
    years: YEARS,
    pageSize: 500,
  };
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
    if (arg === "--province" || arg === "--provinces") {
      const values = String(argv[++i] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      args.provinceCodes = values.map((value) => {
        const direct = PROVINCE_BY_CODE.get(value);
        if (direct) return direct.code;
        const match = PROVINCES.find(([, province, fullName]) => value === province || value === fullName);
        if (!match) throw new Error(`Unknown province: ${value}`);
        return match[0];
      });
      continue;
    }
    if (arg === "--years" || arg === "--year") {
      args.years = String(argv[++i] || "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value));
      for (const year of args.years) {
        if (!YEARS.includes(year)) throw new Error(`Unsupported year: ${year}`);
      }
      continue;
    }
    if (arg === "--page-size") {
      args.pageSize = Number(argv[++i]);
      if (!Number.isInteger(args.pageSize) || args.pageSize < 1) throw new Error("Invalid --page-size");
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
    throw new Error("Refusing to run the importer from /Volumes/mac_2T; use the internal APFS project copy.");
  }
}

function projectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

function ensureDir(relOrAbs) {
  fs.mkdirSync(path.isAbsolute(relOrAbs) ? relOrAbs : projectPath(relOrAbs), { recursive: true });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 18);
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  const text = normalizeText(value).replace(/[,，]/g, "");
  if (!text || text === "-" || text === "—" || text === "--" || /^无$/.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseInteger(value) {
  const number = parseNumber(value);
  return number == null ? null : Math.trunc(number);
}

function normalizeBatch(rawBatch) {
  const text = normalizeText(rawBatch);
  if (/本科二批/.test(text)) return "本科二批";
  if (/本科一批|一批本科/.test(text)) return "本科一批";
  if (/本科批|普通本科/.test(text)) return "本科批";
  if (/专科|高职/.test(text)) return "专科批";
  if (/国家专项/.test(text)) return "国家专项";
  if (/艺术/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  return text || "官网未列批次";
}

function normalizeSubject(rawSubject, rawBatch, province) {
  const text = `${rawSubject || ""} ${rawBatch || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计学|视觉传达|环境设计|艺术设计|产品设计|动画/.test(text)) return "艺术类";
  if (/体育|运动训练|单考单招|单独招生|单独考试|本科单招/.test(text)) return "体育类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|不分文理|改革/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  return normalizeText(rawSubject) || "官网未列科类";
}

function classifyAdmission(rawBatch, rawSubject, majorName) {
  const text = `${rawBatch || ""} ${rawSubject || ""} ${majorName || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计学|视觉传达|环境设计|艺术设计|产品设计|动画/.test(text)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|单考单招|单独招生|单独考试|本科单招/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项|贫困专项/.test(text)) {
    return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  }
  if (/高校专项/.test(text)) {
    return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  }
  if (/少数民族|民族|预科|内高班|西藏班|单列|南疆|定向|优师|公费/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(rawBatch, rawSubject, majorName) {
  const text = `${rawBatch || ""} ${rawSubject || ""} ${majorName || ""}`;
  const values = [];
  for (const [pattern, label] of [
    [/中外合作|合作办学/, "中外合作办学"],
    [/国家专项|贫困专项/, "国家专项"],
    [/高校专项/, "高校专项"],
    [/少数民族|民族/, "民族/民族班"],
    [/预科/, "预科"],
    [/定向/, "定向"],
    [/内高班|西藏班/, "内地班/西藏班"],
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计学|视觉传达|环境设计|艺术设计|产品设计|动画/, "艺术类"],
    [/体育|运动训练|单考单招|单独招生|单独考试|本科单招/, "体育类"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  return values.join("/") || "普通";
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs || 60_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "application/json,text/html,*/*;q=0.9",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      referer: INDEX_URL,
      ...(options.headers || {}),
    },
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = buffer.toString("utf8").replace(/\0/g, "");
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  return text;
}

async function getAuthHeaders() {
  const r = Math.random();
  const [session, token] = await Promise.all([
    fetchText(`${SESSION_URL}?r=${r}`).then((text) => text.replace(/\s+/g, "")),
    fetchText(`${TOKEN_URL}&r=${r + 0.000001}`).then((text) => text.replace(/\s+/g, "")),
  ]);
  return {
    session,
    Authorization: token || "tourist",
    owner: "1556152128",
  };
}

async function postJson(url, body) {
  const authHeaders = await getAuthHeaders();
  const text = await fetchText(url, {
    method: "POST",
    headers: {
      ...authHeaders,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return JSON.parse(text);
}

async function getJson(url) {
  const authHeaders = await getAuthHeaders();
  const text = await fetchText(url, {
    headers: {
      ...authHeaders,
      "content-type": "application/json",
    },
  });
  return JSON.parse(text);
}

function rawRelFor(provinceInfo, year) {
  return `neepu-${provinceInfo.code}-${year}.json`;
}

async function loadQuery(provinceInfo, year, rawRoot, useCache, pageSize) {
  const rawRel = rawRelFor(provinceInfo, year);
  const rawPath = path.join(rawRoot, rawRel);
  if (useCache && fs.existsSync(rawPath)) {
    return { json: JSON.parse(fs.readFileSync(rawPath, "utf8")), rawRel, downloaded: false };
  }

  const body = {
    owner: "1556152128",
    randomCode: "",
    randomKey: "",
    datas: {
      [FIELDS.province]: provinceInfo.province,
      [FIELDS.year]: String(year),
      [FIELDS.batch]: "",
      [FIELDS.subject]: "",
      [FIELDS.group]: "",
    },
    templateCode: "Form-1718611824115-7316",
    current: 1,
    size: pageSize,
    pageCode: "",
    ifRandomCode: true,
  };
  let json = await postJson(DATA_URL, body);
  if (json.code === "0000" && json.data?.total > (json.data?.dataList?.length || 0)) {
    json = await postJson(DATA_URL, { ...body, size: json.data.total });
  }
  const output = {
    requestUrl: DATA_URL,
    requestBody: body,
    response: json,
  };
  fs.writeFileSync(rawPath, `${JSON.stringify(output, null, 2)}\n`);
  return { json: output, rawRel, downloaded: true };
}

function value(row, code) {
  return normalizeText(row?.[`${code}-value`]);
}

function name(row, code) {
  return normalizeText(row?.[`${code}-name`]);
}

function parseQuery(rawQuery, provinceInfo, year, rawRel, pageIndex) {
  const payload = rawQuery.response || rawQuery;
  const records = [];
  const warnings = [];
  if (payload.code !== "0000") {
    return {
      records,
      summary: {
        pageKey: `neepu-${provinceInfo.code}-${year}`,
        year,
        province: provinceInfo.province,
        url: INDEX_URL,
        rawFile: `${RAW_DIR}/${rawRel}`,
        sha256: sha256(fs.readFileSync(projectPath(`${RAW_DIR}/${rawRel}`))),
        total: null,
        dataRows: 0,
        parsedRecords: 0,
        warnings: [{ issue: "query_failed", code: payload.code, msg: payload.msg || null }],
        pageIndex,
      },
    };
  }

  const dataList = payload.data?.dataList || [];
  const total = payload.data?.total ?? dataList.length;
  if (total > dataList.length) warnings.push({ issue: "partial_page", total, dataList: dataList.length });

  let rowIndex = 0;
  for (const row of dataList) {
    rowIndex += 1;
    const rawProvince = value(row, FIELDS.province);
    const rawYear = parseInteger(value(row, FIELDS.year)) || year;
    const rawBatch = value(row, FIELDS.batch);
    const rawSubject = value(row, FIELDS.subject);
    const rawGroup = value(row, FIELDS.group);
    const majorName = value(row, FIELDS.major);
    const minScore = parseNumber(value(row, FIELDS.minScore));
    const maxScore = parseNumber(value(row, FIELDS.maxScore));
    const avgScore = parseNumber(value(row, FIELDS.avgScore));
    const rawMinRankNumber = parseInteger(value(row, FIELDS.minRank));
    const rawMaxRankNumber = parseInteger(value(row, FIELDS.maxRank));
    const minRank = rawMinRankNumber != null && rawMinRankNumber > 0 ? rawMinRankNumber : null;
    const maxRank = rawMaxRankNumber != null && rawMaxRankNumber > 0 ? rawMaxRankNumber : null;
    const admissionCount = parseInteger(value(row, FIELDS.count));

    if (!majorName || minScore == null || minScore <= 0) {
      warnings.push({
        issue: minScore === 0 ? "skipped_zero_score_placeholder" : "skipped_missing_major_or_min_score",
        rowIndex,
        row,
      });
      continue;
    }
    if (maxScore != null && maxScore < minScore) {
      warnings.push({ issue: "maxScore_lt_minScore", rowIndex, maxScore, minScore });
    }

    const subjectType = normalizeSubject(rawSubject, rawBatch, provinceInfo.province);
    const classification = classifyAdmission(rawBatch, rawSubject, majorName);
    const subtype = admissionSubtype(rawBatch, rawSubject, majorName);
    const rankUnavailable = minRank == null;
    const sourcePageKey = `neepu-${provinceInfo.code}-${year}`;
    const record = {
      id: `neepu-${stableId([rawYear, provinceInfo.code, rawBatch, rawSubject, rawGroup, majorName, minScore, minRank, rowIndex])}`,
      year: rawYear,
      province: provinceInfo.province,
      city: SOURCE.city,
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      schoolTags: SOURCE.tags,
      batch: normalizeBatch(rawBatch),
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
      minRank,
      minRankStart: minRank,
      minRankEnd: minRank,
      rankUnavailable,
      scoreOnly: rankUnavailable,
      scoreMetric: classification.admissionType === "艺术类" || classification.admissionType === "体育类"
        ? "综合/专业或文化分，按官网原表口径"
        : "高考文化分，按官网原表口径",
      sourceId: SOURCE.id,
      sourceQuality: SOURCE.quality,
      sourceUrl: INDEX_URL,
      sourcePageUrl: INDEX_URL,
      sourceIndexUrl: INDEX_URL,
      sourcePageKey,
      sourcePageTitle: `${year}年${provinceInfo.fullName}东北电力大学历年录取分数`,
      officialEvidencePath: `${RAW_DIR}/${rawRel}`,
      sourceProvinceRaw: rawProvince || provinceInfo.province,
      sourceBatchRaw: rawBatch,
      sourceSubjectRaw: rawSubject,
      sourceGroupRaw: rawGroup,
      sourceMajorRaw: majorName,
      sourceMaxScoreRaw: value(row, FIELDS.maxScore),
      sourceMinScoreRaw: value(row, FIELDS.minScore),
      sourceAverageScoreRaw: value(row, FIELDS.avgScore),
      sourceMaxRankRaw: value(row, FIELDS.maxRank),
      sourceMinRankRaw: value(row, FIELDS.minRank),
      sourceAdmissionCountRaw: value(row, FIELDS.count),
      sourceColumnNames: Object.fromEntries(Object.entries(FIELDS).map(([key, code]) => [key, name(row, code)])),
      rawRow: row,
      cautions: [
        "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
        rankUnavailable ? "源行未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。" : "源行公开最低分位次，但仍为单校专业边界，不能替代省级全量投档线。",
      ],
    };
    if (admissionCount != null) record.admissionCount = admissionCount;
    if (maxRank != null) record.sourceMaxRank = maxRank;
    if (provinceInfo.province === "西藏") {
      record.cautions.push("西藏行仅为东北电力大学官网单校分数；少数民族/普通科类边界分层保留，不参与省级全量闭合。");
    }
    if (/中外合作|合作办学/.test(`${rawBatch} ${majorName}`)) {
      record.cautions.push("中外合作办学或高收费方向需结合学费、校区和培养模式复核。");
    }
    records.push(record);
  }

  return {
    records,
    summary: {
      pageKey: `neepu-${provinceInfo.code}-${year}`,
      year,
      province: provinceInfo.province,
      url: INDEX_URL,
      rawFile: `${RAW_DIR}/${rawRel}`,
      sha256: sha256(fs.readFileSync(projectPath(`${RAW_DIR}/${rawRel}`))),
      responseCode: payload.code,
      total,
      dataRows: dataList.length,
      parsedRecords: records.length,
      warnings,
      pageIndex,
    },
  };
}

function incrementCounter(target, key, by = 1) {
  target[key] = (target[key] || 0) + by;
}

function range(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric.length) return null;
  return [Math.min(...numeric), Math.max(...numeric)];
}

function writeJson(rel, value) {
  fs.writeFileSync(projectPath(rel), `${JSON.stringify(value, null, 2)}\n`);
}

async function writeReferenceFiles(rawRoot, useCache) {
  const refs = [
    ["neepu-lnfs.html", INDEX_URL, "text"],
    ["neepu-items-lnfs.json", ITEMS_URL, "post-items"],
    ["neepu-result-show-lnfs.json", RESULT_SHOW_URL, "get-json"],
  ];
  for (const [fileName, url, type] of refs) {
    const abs = path.join(rawRoot, fileName);
    if (useCache && fs.existsSync(abs)) continue;
    if (type === "text") {
      const text = await fetchText(url, { headers: { accept: "text/html,*/*;q=0.9" } });
      fs.writeFileSync(abs, text);
    } else if (type === "post-items") {
      const json = await postJson(url, { owner: "1556152128", templateCode: "Form-1718611824115-7316" });
      fs.writeFileSync(abs, `${JSON.stringify(json, null, 2)}\n`);
    } else if (type === "get-json") {
      const json = await getJson(url);
      fs.writeFileSync(abs, `${JSON.stringify(json, null, 2)}\n`);
    }
  }
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));
  await writeReferenceFiles(rawRoot, args.useCache);

  const rawRecords = [];
  const pageSummaries = [];
  const skippedPages = [];
  const selectedProvinces = args.provinceCodes.map((code) => PROVINCE_BY_CODE.get(code));
  let pageIndex = 0;

  for (const year of args.years) {
    for (const provinceInfo of selectedProvinces) {
      pageIndex += 1;
      try {
        const { json, rawRel } = await loadQuery(provinceInfo, year, rawRoot, args.useCache, args.pageSize);
        const parsed = parseQuery(json, provinceInfo, year, rawRel, pageIndex);
        rawRecords.push(...parsed.records);
        pageSummaries.push(parsed.summary);
      } catch (error) {
        skippedPages.push({
          year,
          province: provinceInfo.province,
          code: provinceInfo.code,
          url: INDEX_URL,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const duplicateRecords = [];
  const records = [];
  const seenRecordKeys = new Set();
  for (const record of rawRecords) {
    const key = [
      record.year,
      record.province,
      record.schoolName,
      record.batch,
      record.subjectType,
      record.sourceGroupRaw,
      record.majorName,
      record.minScore,
      record.minRank,
      record.formalScoreScope,
    ].join("\t");
    if (seenRecordKeys.has(key)) {
      duplicateRecords.push(record);
      continue;
    }
    seenRecordKeys.add(key);
    records.push(record);
  }

  const formalScoreScopeCounts = {};
  const subjectTypeCounts = {};
  const provinceCounts = {};
  const yearCounts = {};
  const admissionTypeCounts = {};
  const admissionSubtypeCounts = {};
  const recordTypeCounts = {};
  for (const record of records) {
    incrementCounter(formalScoreScopeCounts, record.formalScoreScope);
    incrementCounter(subjectTypeCounts, record.subjectType);
    incrementCounter(provinceCounts, record.province);
    incrementCounter(yearCounts, String(record.year));
    incrementCounter(admissionTypeCounts, record.admissionType);
    incrementCounter(admissionSubtypeCounts, record.admissionSubtype);
    incrementCounter(recordTypeCounts, record.dataType);
  }

  const rawFiles = [
    `${RAW_DIR}/neepu-lnfs.html`,
    `${RAW_DIR}/neepu-items-lnfs.json`,
    `${RAW_DIR}/neepu-result-show-lnfs.json`,
    ...pageSummaries.map((summary) => summary.rawFile),
  ];

  const sourceNotes = [
    {
      id: SOURCE.id,
      publisher: SOURCE.publisher,
      title: "东北电力大学招生信息网历年分数 OpenApp 查询（2021-2025）",
      url: INDEX_URL,
      quality: SOURCE.quality,
      usage:
        "学校官网单校分专业录取分数和位次边界；可用于东北电力大学候选边界复核、低中高分段趋势、工科/电力类专业参考和西藏单校分数加厚，不替代任何省级教育考试院全量投档/录取表。",
      rawDir: RAW_DIR,
      rawFiles,
      parsedRecords: records.length,
      pageCount: pageSummaries.length,
      skippedPages,
      duplicateRecordsSkipped: duplicateRecords.length,
      pageSummaries,
      provincesWithRecords: Object.keys(provinceCounts).sort(),
      provinceCount: Object.keys(provinceCounts).length,
      years: Object.keys(yearCounts).sort(),
      yearCounts,
      subjectTypeCounts,
      formalScoreScopeCounts,
      admissionTypeCounts,
      admissionSubtypeCounts,
      recordTypeCounts,
      scoreRange: range(records.map((record) => record.minScore)),
      rankRange: range(records.map((record) => record.minRank)),
      recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
      recordsWithRank: records.filter((record) => record.minRank != null).length,
      boundaryNotes: [
        "源表部分省份公开最低分位次；位次仅作为东北电力大学单校专业边界，不替代省级全量投档线。",
        "rankUnavailable=true 的行不生成假位次。",
        "school-official-only 只作单校候选边界复核，不参与 formalScoreMissingProvinces 省级全量闭合。",
        "艺术、体育、专项、民族/预科、定向、内高班等行按 special-path-only 隔离。",
        "西藏少数民族/普通科类按源表保留，不拆成省级全量概率闭合。",
      ],
    },
  ];

  const output = {
    dataset: "official-national-school-admission-2021-2025-v3230-neepu",
    generatedAt: new Date().toISOString(),
    scope: {
      years: args.years,
      provinceCodes: args.provinceCodes,
      school: SOURCE.schoolName,
    },
    notes: sourceNotes[0].boundaryNotes,
    sourceNotes,
    records,
    audit: {
      totalRecords: records.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      duplicateRecords: duplicateRecords.slice(0, 50),
      pageCount: pageSummaries.length,
      skippedPages,
      formalScoreScopeCounts,
      subjectTypeCounts,
      provinceCounts,
      yearCounts,
      admissionTypeCounts,
      admissionSubtypeCounts,
      recordTypeCounts,
      scoreRange: sourceNotes[0].scoreRange,
      rankRange: sourceNotes[0].rankRange,
      recordsRankUnavailable: sourceNotes[0].recordsRankUnavailable,
      recordsWithRank: sourceNotes[0].recordsWithRank,
      pageWarnings: pageSummaries.flatMap((summary) => summary.warnings || []),
    },
  };

  writeJson(args.out, output);
  console.log(
    JSON.stringify(
      {
        out: args.out,
        records: records.length,
        rawRecords: rawRecords.length,
        pageCount: pageSummaries.length,
        skippedPages: skippedPages.length,
        duplicateRecordsSkipped: duplicateRecords.length,
        formalScoreScopeCounts,
        subjectTypeCounts,
        provinceCount: Object.keys(provinceCounts).length,
        yearCounts,
        scoreRange: sourceNotes[0].scoreRange,
        rankRange: sourceNotes[0].rankRange,
        recordsWithRank: sourceNotes[0].recordsWithRank,
        recordsRankUnavailable: sourceNotes[0].recordsRankUnavailable,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
