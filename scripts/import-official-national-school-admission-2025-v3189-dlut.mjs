#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3189-dlut-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3189-dlut";
const PAGE_URL = "https://zs.dlut.edu.cn/admissionScore";
const API_BASE = "https://zs.dlut.edu.cn/apiV2025";
const ENDPOINTS = {
  provinces: "/portal/common/provinceList",
  campus: "/portal/common/getDictData/zs_campus_type",
  subjectTypes: "/portal/common/getDictData/recruitment_subject_type",
  recruitmentTypes: "/portal/common/getDictData/recruitment_type",
  years: "/portal/recruitmentInfo/admissionScore/admissionScoreYearList",
  institutionScores: "/portal/recruitmentInfo/admissionScore/admissionScoreStaList",
  majorScores: "/portal/recruitmentInfo/admissionScore/admissionScoreList",
};
const SOURCE = {
  id: "official-dlut-national-2025-school-admission",
  quality: "official-school-dlut-2025-national-dynamic-query-score-only",
  schoolCode: "10141",
  schoolName: "大连理工大学",
  city: "大连",
  tags: ["理工", "985", "211", "双一流"],
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3189-dlut.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3189-dlut.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/JS/API JSON",
    "",
    "Imports Dalian University of Technology official 2025 national admission score query rows.",
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
    if (key == null || key === "") continue;
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

function optionalNumber(value) {
  const text = normalizeText(value);
  if (!text || text === "-" || text === "--") return null;
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function optionalRank(value) {
  const text = normalizeText(value).replace(/,/g, "");
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function download(url, options = {}) {
  const attempts = options.attempts || 4;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-dlut-v3189-importer/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,application/json,text/javascript,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || PAGE_URL,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(800 * attempt);
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

async function ensureJsonFile(file, useCache, url) {
  const buffer = await ensureFile(file, useCache, () => download(url, {
    accept: "application/json,text/javascript,*/*;q=0.8",
  }));
  return { buffer, json: JSON.parse(buffer.toString("utf8")) };
}

function endpointUrl(endpointPath) {
  return `${API_BASE}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
}

function assetUrlFromPage(pageHtml) {
  const match = String(pageHtml).match(/<script\b[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)
    || String(pageHtml).match(/<script\b[^>]+src=["']([^"']*assets\/index-[^"']+\.js)["']/i);
  return match ? new URL(match[1], PAGE_URL).toString() : null;
}

function admissionScoreChunkUrl(mainJs, mainBundleUrl) {
  const index = String(mainJs).indexOf('path:"/admissionScore"');
  if (index < 0) return null;
  const segment = mainJs.slice(Math.max(0, index - 500), index + 1200);
  const match = segment.match(/import\("\.\/([^"]+\.js)"\)/)
    || segment.match(/assets\/([^",]+\.js)/);
  if (!match) return null;
  const chunkPath = match[1].startsWith("assets/") ? `/${match[1]}` : match[1];
  return new URL(chunkPath, mainBundleUrl).toString();
}

async function ensureRaw(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const pageFile = path.join(rawDir, "dlut-admission-score-page.html");
  const pageHtml = (await ensureFile(pageFile, useCache, () => download(PAGE_URL))).toString("utf8");
  const mainBundleUrl = assetUrlFromPage(pageHtml);
  const optionalRawFiles = [];
  const warnings = [];

  if (mainBundleUrl) {
    const mainBundleFile = path.join(rawDir, "dlut-main-bundle.js");
    const mainJs = (await ensureFile(mainBundleFile, useCache, () => download(mainBundleUrl, {
      accept: "text/javascript,application/javascript,*/*;q=0.8",
    }))).toString("utf8");
    optionalRawFiles.push(mainBundleFile);
    const chunkUrl = admissionScoreChunkUrl(mainJs, mainBundleUrl);
    if (chunkUrl) {
      const chunkFile = path.join(rawDir, "dlut-admission-score-route.js");
      await ensureFile(chunkFile, useCache, () => download(chunkUrl, {
        accept: "text/javascript,application/javascript,*/*;q=0.8",
        referer: mainBundleUrl,
      }));
      optionalRawFiles.push(chunkFile);
    } else {
      warnings.push("未能从前端主 bundle 定位 admissionScore 分块；API 原始 JSON 仍已保存。");
    }
  } else {
    warnings.push("未能从页面 HTML 定位前端主 bundle；API 原始 JSON 仍已保存。");
  }

  const jsonFiles = {
    provinces: path.join(rawDir, "province-list.json"),
    campus: path.join(rawDir, "dict-zs-campus-type.json"),
    subjectTypes: path.join(rawDir, "dict-recruitment-subject-type.json"),
    recruitmentTypes: path.join(rawDir, "dict-recruitment-type.json"),
    years: path.join(rawDir, "admission-score-years.json"),
    institutionScores: path.join(rawDir, "admission-score-sta-list.json"),
    majorScores: path.join(rawDir, "admission-score-major-list.json"),
  };
  const payloads = {};
  for (const [key, endpoint] of Object.entries(ENDPOINTS)) {
    const payload = await ensureJsonFile(jsonFiles[key], useCache, endpointUrl(endpoint));
    payloads[key] = payload.json;
    if (!useCache) await sleep(40);
  }

  return {
    pageFile,
    optionalRawFiles,
    jsonFiles,
    payloads,
    warnings,
    mainBundleUrl,
  };
}

function dictMap(dictRows) {
  const map = new Map();
  for (const row of dictRows || []) {
    map.set(String(row.dictValue), normalizeText(row.dictLabel));
    map.set(Number(row.dictValue), normalizeText(row.dictLabel));
  }
  return map;
}

function normalizedSubjectType(raw) {
  const text = normalizeText(raw);
  if (/艺术|美术|音乐|设计/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/综合|普通类|不分文理|改革/.test(text)) return "综合";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  return text || "综合";
}

function subjectMappingNote(raw, normalized) {
  const text = normalizeText(raw);
  if (!text || text === normalized) return undefined;
  if (text === "普通类") return "大连理工大学源站将 3+3 综合改革省份显示为普通类，运行层归一为综合。";
  if (text === "不分文理") return "源站不分文理归一为站内综合科类。";
  if (/理工（单列）/.test(text)) return "源站理工（单列）保留为 sourceSubjectRaw，运行层按物理类大类检索且按特殊路径隔离。";
  if (/文史（单列）/.test(text)) return "源站文史（单列）保留为 sourceSubjectRaw，运行层按历史类大类检索且按特殊路径隔离。";
  if (text === "理工") return "源站旧文理理工口径归一为站内物理类。";
  if (text === "文史") return "源站旧文理文史口径归一为站内历史类。";
  return `源站科类 ${text} 归一为站内 ${normalized}。`;
}

function admissionKinds(text) {
  const kinds = [];
  if (/国家专项/.test(text)) kinds.push("国家专项");
  if (/高校专项/.test(text)) kinds.push("高校专项");
  if (/民族|少数民族/.test(text)) kinds.push("民族/少数民族");
  if (/预科/.test(text)) kinds.push("少数民族预科");
  if (/内高班|内地班|西藏班|新疆班/.test(text)) kinds.push("内高班/内地班");
  if (/南疆单列|单列/.test(text)) kinds.push("单列计划");
  if (/定向/.test(text)) kinds.push("定向");
  if (/提前批|航海|轮机/.test(text)) kinds.push("提前批/航海类");
  if (/艺术|美术|音乐|体育|设计|运动训练/.test(text)) kinds.push("艺术/体育类");
  if (/中外合作|中英|中白|中日|中美|中澳|中俄/.test(text)) kinds.push("中外合作办学");
  if (/强基/.test(text)) kinds.push("强基计划");
  if (/保送|学测|港澳台|澳门|香港|第二学士|预升本/.test(text)) kinds.push("特殊招生");
  return kinds;
}

function admissionTypeFor(...parts) {
  const kinds = admissionKinds(parts.map((part) => normalizeText(part)).join(" "));
  return kinds.length ? kinds.join("；") : "普通录取";
}

function formalScoreScopeFor(...parts) {
  const text = parts.map((part) => normalizeText(part)).join(" ");
  return /国家专项|高校专项|民族|少数民族|预科|内高班|内地班|西藏班|新疆班|南疆单列|单列|定向|提前批|航海|轮机|艺术|美术|音乐|体育|运动训练|强基|保送|学测|港澳台|澳门|香港|第二学士|预升本/.test(text)
    ? "special-path-only"
    : "school-official-only";
}

function batchFor(scope, admissionType) {
  if (scope !== "special-path-only") return "本科批";
  if (admissionType.includes("国家专项")) return "国家专项本科";
  if (admissionType.includes("高校专项")) return "高校专项";
  if (admissionType.includes("预科")) return "少数民族预科";
  if (admissionType.includes("内高班")) return "内高班/内地班";
  if (admissionType.includes("艺术") || admissionType.includes("体育")) return "艺术/体育类本科";
  if (admissionType.includes("强基")) return "强基计划";
  if (admissionType.includes("提前批") || admissionType.includes("航海")) return "提前批本科";
  if (admissionType.includes("单列")) return "单列计划本科";
  if (admissionType.includes("民族")) return "民族/少数民族本科";
  return "特殊类型本科";
}

function cautionsFor(record) {
  const cautions = [
    "本记录来自大连理工大学本科生招生网官方录取分数动态查询系统，是单校分省/校区/类型/专业最低分边界，不是省级教育考试院全量投档/录取分数表。",
    "源系统未公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
  ];
  if (record.formalScoreScope === "school-official-only") {
    cautions.push("普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于大连理工大学候选边界复核，但不得替代同省省级正式投档表。");
  } else {
    cautions.push("该行属于专项、民族/预科、内高班/单列、艺术体育或其他特殊入口，按 formalScoreScope=special-path-only 隔离，不与普通本科批文化分边界混用。");
  }
  if (/中外合作/.test(record.admissionType || "")) {
    cautions.push("中外合作办学需额外复核学费、培养模式、外语要求、校区和转专业限制。");
  }
  if (record.campusName) {
    cautions.push(`源站区分校区为${record.campusName}，正式填报需核对当年招生计划、专业所在校区和培养地点。`);
  }
  return cautions;
}

function buildRecord({ row, dataType, dictionaries, sourceApiPath }) {
  const province = normalizeText(row.provinceName);
  const year = Number(row.recruitmentYear);
  const campusLabel = dictionaries.campus.get(row.zsCampusType) || String(row.zsCampusType ?? "");
  const sourceSubjectRaw = dictionaries.subjectTypes.get(row.recruitmentSubjectType) || String(row.recruitmentSubjectType ?? "");
  const sourceTypeRaw = dictionaries.recruitmentTypes.get(row.recruitmentType) || String(row.recruitmentType ?? "");
  const subjectType = normalizedSubjectType(sourceSubjectRaw);
  const institutionTypeTitle = sourceTypeRaw || admissionTypeFor(sourceSubjectRaw);
  const majorName = dataType === "institution-admission"
    ? `${SOURCE.schoolName}${campusLabel ? `（${campusLabel}）` : ""}${institutionTypeTitle}录取最低分（${sourceSubjectRaw || subjectType}）`
    : normalizeText(row.recruitmentMajorName || row.admissionMajorName);
  if (!province || !year || !majorName) return null;
  const minScore = optionalNumber(row.minScore);
  if (!Number.isFinite(minScore)) return null;
  const minRank = optionalRank(row.minScoreRank);
  const admissionType = admissionTypeFor(sourceTypeRaw, sourceSubjectRaw, majorName);
  const formalScoreScope = formalScoreScopeFor(sourceTypeRaw, sourceSubjectRaw, majorName);
  const record = {
    id: `${year}-dlut-national-school-${hash([
      dataType,
      row.admissionScoreIdentifyName,
      row.recruitmentInfoId,
      province,
      row.provinceCode,
      row.zsCampusType,
      row.recruitmentSubjectType,
      row.recruitmentType,
      majorName,
      row.minScore,
    ].join("|"))}`,
    province,
    sourceProvinceRaw: province,
    sourceProvinceCode: normalizeText(row.provinceCode),
    year,
    subjectType,
    sourceSubjectRaw,
    batch: batchFor(formalScoreScope, admissionType),
    sourceBatchRaw: sourceTypeRaw || admissionType,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    campusName: campusLabel,
    campusCode: row.zsCampusType == null ? undefined : String(row.zsCampusType),
    sourceCampusRaw: campusLabel,
    schoolTags: [...SOURCE.tags, ...admissionKinds(`${sourceTypeRaw} ${sourceSubjectRaw} ${majorName}`)],
    dataType,
    majorName,
    majorGroup: `${SOURCE.schoolName}${campusLabel ? `-${campusLabel}` : ""}-${province}-${sourceSubjectRaw || subjectType}-${sourceTypeRaw || admissionType}`,
    admissionType,
    admissionSubtype: sourceTypeRaw || admissionType,
    formalScoreScope,
    minScore,
    scoreOnly: !minRank,
    rankUnavailable: !minRank,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: PAGE_URL,
    sourcePageUrl: PAGE_URL,
    sourceApiUrl: dataType === "institution-admission"
      ? endpointUrl(ENDPOINTS.institutionScores)
      : endpointUrl(ENDPOINTS.majorScores),
    officialEvidencePath: path.relative(PROJECT_ROOT, sourceApiPath),
    sourceApiPath: path.relative(PROJECT_ROOT, sourceApiPath),
    sourceMinScoreRaw: normalizeText(row.minScore),
    sourceRankRaw: normalizeText(row.minScoreRank),
    rawRow: row,
  };
  if (minRank) {
    record.minRankStart = minRank;
    record.minRankEnd = minRank;
    record.rankRangeText = String(row.minScoreRank);
  }
  const mappingNote = subjectMappingNote(sourceSubjectRaw, subjectType);
  if (mappingNote) record.subjectMappingNote = mappingNote;
  if (row.admissionScoreRemark != null && normalizeText(row.admissionScoreRemark)) {
    record.remarks = normalizeText(row.admissionScoreRemark);
  }
  record.cautions = cautionsFor(record);
  return record;
}

function buildRecords(raw) {
  const dictionaries = {
    campus: dictMap(raw.payloads.campus?.data || []),
    subjectTypes: dictMap(raw.payloads.subjectTypes?.data || []),
    recruitmentTypes: dictMap(raw.payloads.recruitmentTypes?.data || []),
  };
  const institutionRows = raw.payloads.institutionScores?.data || [];
  const majorRows = raw.payloads.majorScores?.data || [];
  const records = [];
  for (const row of institutionRows) {
    const record = buildRecord({
      row,
      dataType: "institution-admission",
      dictionaries,
      sourceApiPath: raw.jsonFiles.institutionScores,
    });
    if (record) records.push(record);
  }
  for (const row of majorRows) {
    const record = buildRecord({
      row,
      dataType: "major-admission",
      dictionaries,
      sourceApiPath: raw.jsonFiles.majorScores,
    });
    if (record) records.push(record);
  }
  return records;
}

function buildSourceNote(raw, records) {
  const years = [...new Set(records.map((record) => record.year).filter(Boolean))].sort((a, b) => a - b);
  const provinces = [...new Set(records.map((record) => record.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const rawPaths = [
    raw.pageFile,
    ...raw.optionalRawFiles,
    ...Object.values(raw.jsonFiles),
  ];
  const scoreValues = records.map((record) => record.minScore).filter(Number.isFinite);
  return {
    id: SOURCE.id,
    title: "大连理工大学本科生招生网：2025年全国分省分校区录取分数",
    publisher: "大连理工大学",
    url: PAGE_URL,
    pageUrl: PAGE_URL,
    apiBase: API_BASE,
    apiUrls: Object.fromEntries(Object.entries(ENDPOINTS).map(([key, value]) => [key, endpointUrl(value)])),
    frontEndBundleUrl: raw.mainBundleUrl || "",
    quality: SOURCE.quality,
    usage: "抽取大连理工大学本科生招生网官方录取分数动态查询接口；保留 2025 年全国分省、校区、科类、招生类型和专业最低分。普通单校行作候选边界复核，专项、民族/预科、内高班/单列、艺术体育等隔离为特殊路径。",
    parsedRecords: records.length,
    provinceCount: provinces.length,
    years,
    institutionRecords: records.filter((record) => record.dataType === "institution-admission").length,
    majorRecords: records.filter((record) => record.dataType === "major-admission").length,
    recordsWithRank: records.filter((record) => record.minRankEnd).length,
    recordsWithoutRank: records.filter((record) => !record.minRankEnd).length,
    ordinarySchoolOfficialRecords: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRecords: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    byYear: countBy(records, (record) => record.year),
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    bySourceSubjectRaw: countBy(records, (record) => record.sourceSubjectRaw),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byDataType: countBy(records, (record) => record.dataType),
    byCampus: countBy(records, (record) => record.campusName),
    scoreRange: numericRange(scoreValues),
    rawPaths: rawPaths.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: rawPaths.map((file) => ({
      path: path.relative(PROJECT_ROOT, file),
      sha256: sha256File(file),
    })),
    warnings: raw.warnings,
    transcriptionMethod: "official-dynamic-query-json",
    cautions: [
      "本源为大连理工大学官方单校录取分数查询系统，不是任何省级教育考试院全量投档/录取分数表。",
      "源系统当前年份接口只返回 2025 年；运行层不补造往年行。",
      "源系统未公开最低位次；运行层不生成假位次，推荐层不得仅凭单校行输出录取概率。",
      "普通学校官网单校行按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "国家专项、高校专项、民族/预科、内高班、单列计划、艺术体育等按 formalScoreScope=special-path-only 隔离。",
      "中外合作办学虽保留为学校官网单校边界，但需单独复核学费、培养模式、校区、外语要求和转专业限制。",
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
  const records = buildRecords(raw);
  const sourceNote = buildSourceNote(raw, records);
  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes: [sourceNote], records }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, outPath),
    sourceId: SOURCE.id,
    records: records.length,
    institutionRecords: sourceNote.institutionRecords,
    majorRecords: sourceNote.majorRecords,
    recordsWithoutRank: sourceNote.recordsWithoutRank,
    provinces: sourceNote.provinceCount,
    years: sourceNote.years,
    byFormalScoreScope: sourceNote.byFormalScoreScope,
    byCampus: sourceNote.byCampus,
    warnings: sourceNote.warnings.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
