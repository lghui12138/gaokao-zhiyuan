#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3231-ncepu-baoding-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3231-ncepu-baoding";
const BASE_URL = "https://zhaosheng.ncepu.edu.cn";
const INDEX_URL = `${BASE_URL}/lqfs/index.htm`;
const AII_URL = `${BASE_URL}/common/aii_bd_json.json`;
const MAJOR_URL = `${BASE_URL}/common/major_bd_json.json`;
const LIST_JS_URL = `${BASE_URL}/g_style/g_list.js`;
const TLS_CHAIN_EXCEPTION_HOSTS = new Set(["zhaosheng.ncepu.edu.cn"]);

const SOURCE = {
  id: "official-ncepu-baoding-national-2025-school-admission",
  quality: "official-school-ncepu-baoding-2025-national-static-json-score-rank",
  schoolCode: "10079",
  schoolName: "华北电力大学（保定）",
  city: "河北保定",
  publisher: "华电（保定）招生信息网",
  tags: ["河北", "保定", "华北电力大学", "电力", "双一流", "211"],
};

const DATASETS = [
  {
    key: "aii",
    title: "总体录取分数",
    url: AII_URL,
    rawFile: "ncepu-baoding-aii.json",
    dataType: "institution-admission",
    majorName: "总体录取分数",
  },
  {
    key: "major",
    title: "各专业录取分数",
    url: MAJOR_URL,
    rawFile: "ncepu-baoding-major.json",
    dataType: "major-admission",
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3231-ncepu-baoding.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3231-ncepu-baoding.mjs --use-cache",
    "",
    "Imports 华电（保定）招生信息网 2025 年历年录取分数 static JSON data.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    useCache: false,
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

function parseScoreParts(value) {
  const text = normalizeText(value).replace(/[,，]/g, "");
  if (!text || text === "-" || text === "—" || text === "--") return [];
  const parts = [];
  const pattern = /(-?\d+(?:\.\d+)?)(?:\s*[（(]\s*([^）)]+?)\s*[）)])?/g;
  let match;
  while ((match = pattern.exec(text))) {
    parts.push({
      score: Number(match[1]),
      label: normalizeText(match[2] || ""),
      raw: match[0],
    });
  }
  return parts.filter((part) => Number.isFinite(part.score));
}

function scoreVariants(minScoreRaw, maxScoreRaw) {
  const minParts = parseScoreParts(minScoreRaw);
  const maxParts = parseScoreParts(maxScoreRaw);
  if (!minParts.length) return [];

  return minParts.map((minPart, index) => {
    let maxPart = null;
    if (minPart.label) {
      maxPart = maxParts.find((candidate) => candidate.label === minPart.label) || null;
    }
    if (!maxPart) maxPart = maxParts[index] || maxParts[0] || null;
    return {
      minScore: minPart.score,
      maxScore: maxPart?.score ?? null,
      label: minPart.label || maxPart?.label || "",
      minScoreRawPart: minPart.raw,
      maxScoreRawPart: maxPart?.raw || "",
      variantIndex: index + 1,
      variantCount: minParts.length,
    };
  });
}

function normalizeBatch(rawType) {
  const text = normalizeText(rawType);
  if (/国家专项/.test(text)) return "国家专项";
  if (/高校专项/.test(text)) return "高校专项";
  if (/专项/.test(text)) return "专项计划";
  if (/普通/.test(text)) return "本科批";
  return text || "官网未列批次";
}

function normalizeSubject(rawSubject, province) {
  const text = normalizeText(rawSubject);
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|不分文理|改革/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  return text || "官网未列科类";
}

function classifyAdmission(rawType, rawSubject, majorName) {
  const text = `${rawType || ""} ${rawSubject || ""} ${majorName || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/.test(text)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|单考单招|单独招生|单独考试|本科单招/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/定向/.test(text)) return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  if (/预科|民族|少数民族|单列|内高班|西藏班|南疆|优师|公费/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(rawType, rawSubject, majorName, variantLabel) {
  const text = `${rawType || ""} ${rawSubject || ""} ${majorName || ""}`;
  const values = [];
  for (const [pattern, label] of [
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/, "艺术类"],
    [/体育|运动训练|单考单招|单独招生|单独考试|本科单招/, "体育类"],
    [/国家专项/, "国家专项"],
    [/高校专项/, "高校专项"],
    [/定向/, "定向就业"],
    [/预科/, "预科"],
    [/民族|少数民族/, "民族/民族班"],
    [/单列|南疆/, "单列/南疆"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  if (variantLabel) values.push(`${variantLabel}口径`);
  return values.join("/") || "普通";
}

function normalizeRecordUrl(value) {
  const text = normalizeText(value);
  if (!text) return INDEX_URL;
  return text.replace("https://goto.ncepu.edu.cn//", "https://goto.ncepu.edu.cn/");
}

function requestText(url, options = {}, redirectCount = 0) {
  const target = new URL(url);
  const transport = target.protocol === "http:" ? http : https;
  const requestOptions = {
    method: "GET",
    timeout: options.timeoutMs || 60_000,
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: options.accept || "application/json,text/html,*/*;q=0.9",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      referer: INDEX_URL,
      ...(options.headers || {}),
    },
  };
  if (target.protocol === "https:" && TLS_CHAIN_EXCEPTION_HOSTS.has(target.hostname)) {
    requestOptions.rejectUnauthorized = false;
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(target, requestOptions, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects for ${url}`));
          return;
        }
        const nextUrl = new URL(res.headers.location, target).toString();
        requestText(nextUrl, options, redirectCount + 1).then(resolve, reject);
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "");
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status} for ${url}: ${text.slice(0, 200)}`));
          return;
        }
        resolve(text);
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Timeout fetching ${url}`)));
    req.on("error", reject);
    req.end();
  });
}

async function downloadRaw(rawRoot, rawFile, url, useCache, accept) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs)) {
    return fs.readFileSync(abs, "utf8");
  }
  const text = await requestText(url, { accept });
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
  return text;
}

function parseDataset(dataset, json, rawRel, pageIndex) {
  const data = Array.isArray(json.data) ? json.data : [];
  const records = [];
  const warnings = [];
  let rowIndex = 0;

  for (const row of data) {
    rowIndex += 1;
    const props = row.properties || {};
    const year = parseInteger(props.year);
    const province = normalizeText(props.province);
    const rawType = normalizeText(props.type);
    const rawSubject = normalizeText(props.scienceCategory);
    const rawMajor = normalizeText(props.major);
    const majorName = dataset.dataType === "major-admission" ? rawMajor : dataset.majorName;
    const minRank = parseInteger(props.lowestScoreRanking);
    const rankUnavailable = !(minRank != null && minRank > 0);
    const variants = scoreVariants(props.minimumScore, props.highestScore);

    if (!year || !province || !rawType || !rawSubject || !majorName || !variants.length) {
      warnings.push({ issue: "skipped_missing_required_fields", rowIndex, row });
      continue;
    }

    for (const variant of variants) {
      if (variant.minScore == null || variant.minScore <= 0) {
        warnings.push({ issue: "skipped_zero_or_invalid_min_score", rowIndex, variant, row });
        continue;
      }
      if (variant.maxScore != null && variant.maxScore < variant.minScore) {
        warnings.push({ issue: "maxScore_lt_minScore", rowIndex, variant, row });
      }

      const subjectType = normalizeSubject(rawSubject, province);
      let classification = classifyAdmission(rawType, rawSubject, majorName);
      if (variant.label && !/^汉/.test(variant.label)) {
        classification = {
          admissionType: classification.admissionType === "普通录取" ? "特殊路径" : classification.admissionType,
          formalScoreScope: "special-path-only",
        };
      }
      const subtype = admissionSubtype(rawType, rawSubject, majorName, variant.label);
      const sourcePageUrl = normalizeRecordUrl(row.url);
      const record = {
        id: `ncepubd-${stableId([dataset.key, row.id, year, province, rawType, rawSubject, majorName, variant.label, variant.minScore, minRank, rowIndex])}`,
        year,
        province,
        city: SOURCE.city,
        schoolCode: SOURCE.schoolCode,
        schoolName: SOURCE.schoolName,
        schoolTags: SOURCE.tags,
        batch: normalizeBatch(rawType),
        subjectType,
        majorName,
        dataType: dataset.dataType,
        admissionType: classification.admissionType,
        admissionSubtype: subtype,
        formalScoreScope: classification.formalScoreScope,
        schoolOfficialScope: true,
        minScore: variant.minScore,
        maxScore: variant.maxScore,
        minRank: rankUnavailable ? null : minRank,
        minRankStart: rankUnavailable ? null : minRank,
        minRankEnd: rankUnavailable ? null : minRank,
        rankUnavailable,
        scoreOnly: rankUnavailable,
        scoreMetric: classification.admissionType === "艺术类" || classification.admissionType === "体育类"
          ? "综合/专业或文化分，按官网原表口径"
          : "高考文化分，按官网原表口径",
        sourceId: SOURCE.id,
        sourceQuality: SOURCE.quality,
        sourceUrl: INDEX_URL,
        sourcePageUrl,
        sourceIndexUrl: INDEX_URL,
        sourcePageKey: `ncepu-baoding-${dataset.key}-2025`,
        sourcePageTitle: `2025年${province}${SOURCE.schoolName}${dataset.title}`,
        officialEvidencePath: `${RAW_DIR}/${rawRel}`,
        sourceRecordUrl: sourcePageUrl,
        sourceRecordId: normalizeText(row.id),
        sourceDataset: dataset.key,
        sourceDatasetTitle: dataset.title,
        sourceProvinceRaw: province,
        sourceTypeRaw: rawType,
        sourceSubjectRaw: rawSubject,
        sourceMajorRaw: rawMajor,
        sourceRequirementRaw: normalizeText(props.requirement),
        sourceMaxScoreRaw: normalizeText(props.highestScore),
        sourceMinScoreRaw: normalizeText(props.minimumScore),
        sourceMaxScoreVariantRaw: variant.maxScoreRawPart,
        sourceMinScoreVariantRaw: variant.minScoreRawPart,
        sourceScoreVariantIndex: variant.variantIndex,
        sourceScoreVariantCount: variant.variantCount,
        sourceLowestRankRaw: normalizeText(props.lowestScoreRanking),
        rawRow: row,
        cautions: [
          "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
          rankUnavailable ? "源行未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。" : "源行公开最低分位次，但仍为单校边界，不能替代省级全量投档线。",
        ],
      };

      if (variant.label) {
        record.sourceScoreVariantLabel = variant.label;
        record.cautions.push(`源行公开 ${variant.label} 口径分数，运行层只按源文显式口径拆分，不推断其他民族/类别边界。`);
      }
      if (normalizeText(props.requirement)) record.electiveRequirement = normalizeText(props.requirement);
      if (province === "西藏") {
        record.cautions.push("西藏行仅为华北电力大学（保定）官网单校分数；普通、专项、民族/显式口径分层保留，不参与省级全量闭合。");
      }
      if (province === "新疆") {
        record.cautions.push("新疆行按官网当前页面隐藏最低排名处理，保留分数边界但不生成假位次。");
      }
      records.push(record);
    }
  }

  return {
    records,
    summary: {
      pageKey: `ncepu-baoding-${dataset.key}-2025`,
      year: 2025,
      url: dataset.url,
      title: dataset.title,
      rawFile: `${RAW_DIR}/${rawRel}`,
      sha256: sha256(fs.readFileSync(projectPath(`${RAW_DIR}/${rawRel}`))),
      dataRows: data.length,
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

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));

  await downloadRaw(rawRoot, "ncepu-baoding-lndfs.html", INDEX_URL, args.useCache, "text/html,*/*;q=0.9");
  await downloadRaw(rawRoot, "ncepu-baoding-g-list.js", LIST_JS_URL, args.useCache, "application/javascript,text/plain,*/*;q=0.9");

  const rawRecords = [];
  const pageSummaries = [];
  let pageIndex = 0;
  for (const dataset of DATASETS) {
    pageIndex += 1;
    const text = await downloadRaw(rawRoot, dataset.rawFile, dataset.url, args.useCache, "application/json,*/*;q=0.9");
    const json = JSON.parse(text);
    const parsed = parseDataset(dataset, json, dataset.rawFile, pageIndex);
    rawRecords.push(...parsed.records);
    pageSummaries.push(parsed.summary);
  }

  const duplicateRecords = [];
  const records = [];
  const seenRecordKeys = new Set();
  for (const record of rawRecords) {
    const key = [
      record.sourceDataset,
      record.year,
      record.province,
      record.schoolName,
      record.batch,
      record.subjectType,
      record.majorName,
      record.sourceScoreVariantLabel,
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
  const datasetCounts = {};
  for (const record of records) {
    incrementCounter(formalScoreScopeCounts, record.formalScoreScope);
    incrementCounter(subjectTypeCounts, record.subjectType);
    incrementCounter(provinceCounts, record.province);
    incrementCounter(yearCounts, String(record.year));
    incrementCounter(admissionTypeCounts, record.admissionType);
    incrementCounter(admissionSubtypeCounts, record.admissionSubtype);
    incrementCounter(recordTypeCounts, record.dataType);
    incrementCounter(datasetCounts, record.sourceDataset);
  }

  const rawFiles = [
    `${RAW_DIR}/ncepu-baoding-lndfs.html`,
    `${RAW_DIR}/ncepu-baoding-g-list.js`,
    ...DATASETS.map((dataset) => `${RAW_DIR}/${dataset.rawFile}`),
  ];

  const sourceNotes = [
    {
      id: SOURCE.id,
      publisher: SOURCE.publisher,
      title: "华电（保定）招生信息网历年录取分数 JSON（2025）",
      url: INDEX_URL,
      quality: SOURCE.quality,
      usage:
        "学校官网 2025 年全国总体录取分数和各专业录取分数；可用于华北电力大学（保定）候选边界复核、低中高分段趋势、电力/工科专业参考和西藏/新疆单校分数加厚，不替代任何省级教育考试院全量投档/录取表。",
      rawDir: RAW_DIR,
      rawFiles,
      parsedRecords: records.length,
      rawDataRows: pageSummaries.reduce((sum, summary) => sum + summary.dataRows, 0),
      pageCount: pageSummaries.length,
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
      datasetCounts,
      scoreRange: range(records.map((record) => record.minScore)),
      rankRange: range(records.map((record) => record.minRank)),
      recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
      recordsWithRank: records.filter((record) => record.minRank != null).length,
      xizangRecords: records.filter((record) => record.province === "西藏").length,
      xinjiangRecords: records.filter((record) => record.province === "新疆").length,
      sourceTransportNotes: [
        "官方站点当前 HTTPS 证书链对 Node 默认 CA 校验不完整；脚本只对 zhaosheng.ncepu.edu.cn 使用 TLS 链例外读取，并保存原始 HTML/JSON SHA256。",
      ],
      boundaryNotes: [
        "源表公开最低分位次的行保留 minRank；西藏、新疆页面当前隐藏排名的行统一标记 rankUnavailable=true。",
        "rankUnavailable=true 的行不生成假位次。",
        "school-official-only 只作单校候选边界复核，不参与 formalScoreMissingProvinces 省级全量闭合。",
        "高校专项、国家专项、定向就业和显式民族/口径行按 special-path-only 隔离。",
        "形如 469（汉）/412（藏）的源行只按官网显式标签拆分，不推断未公开的省级全量民族线或录取概率。",
      ],
    },
  ];

  const output = {
    dataset: "official-national-school-admission-2025-v3231-ncepu-baoding",
    generatedAt: new Date().toISOString(),
    scope: {
      years: [2025],
      provinceCount: Object.keys(provinceCounts).length,
      school: SOURCE.schoolName,
      datasets: DATASETS.map((dataset) => dataset.key),
    },
    notes: sourceNotes[0].boundaryNotes,
    sourceNotes,
    records,
    audit: {
      totalRecords: records.length,
      rawRecords: rawRecords.length,
      rawDataRows: sourceNotes[0].rawDataRows,
      duplicateRecordsSkipped: duplicateRecords.length,
      duplicateRecords: duplicateRecords.slice(0, 50),
      pageCount: pageSummaries.length,
      formalScoreScopeCounts,
      subjectTypeCounts,
      provinceCounts,
      yearCounts,
      admissionTypeCounts,
      admissionSubtypeCounts,
      recordTypeCounts,
      datasetCounts,
      scoreRange: sourceNotes[0].scoreRange,
      rankRange: sourceNotes[0].rankRange,
      recordsRankUnavailable: sourceNotes[0].recordsRankUnavailable,
      recordsWithRank: sourceNotes[0].recordsWithRank,
      xizangRecords: sourceNotes[0].xizangRecords,
      xinjiangRecords: sourceNotes[0].xinjiangRecords,
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
        rawDataRows: sourceNotes[0].rawDataRows,
        pageCount: pageSummaries.length,
        duplicateRecordsSkipped: duplicateRecords.length,
        formalScoreScopeCounts,
        subjectTypeCounts,
        provinceCount: Object.keys(provinceCounts).length,
        yearCounts,
        recordTypeCounts,
        datasetCounts,
        scoreRange: sourceNotes[0].scoreRange,
        rankRange: sourceNotes[0].rankRange,
        recordsWithRank: sourceNotes[0].recordsWithRank,
        recordsRankUnavailable: sourceNotes[0].recordsRankUnavailable,
        xizangRecords: sourceNotes[0].xizangRecords,
        xinjiangRecords: sourceNotes[0].xinjiangRecords,
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
