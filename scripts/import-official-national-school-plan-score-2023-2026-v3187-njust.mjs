#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-plan-score-2023-2026-v3187-njust-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-plan-score-2023-2026-v3187-njust";
const PAGE_URL = "https://zsb.njust.edu.cn/lqjh_fsx";
const SCORE_URL = "https://zsb.njust.edu.cn/lqScore/initDateWebCon";
const PLAN_URL = "https://zsb.njust.edu.cn/lqPain/initDateCon";
const SCORE_YEAR_FIELDS = new Map([
  ["year1", 2023],
  ["year2", 2024],
  ["year3", 2025],
]);
const SOURCE = {
  id: "official-njust-national-2023-2026-school-plan-score",
  quality: "official-school-njust-2023-2026-national-dynamic-query-plan-score-only",
  schoolCode: "10288",
  schoolName: "南京理工大学",
  city: "南京",
  tags: ["理工", "211", "双一流"],
};
const PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
  "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
];
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

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-plan-score-2023-2026-v3187-njust.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-plan-score-2023-2026-v3187-njust.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/API JSON",
    "",
    "Imports Nanjing University of Science and Technology official 2026 plans and 2023-2025 recent admission scores.",
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

function provinceSlug(province) {
  return PROVINCE_SLUGS.get(province) || hash(province, 10);
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
        method: options.method || "GET",
        body: options.body,
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-njust-v3187-importer/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,application/json,text/javascript,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: PAGE_URL,
          ...(options.body ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
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

async function downloadJson(url, data) {
  const body = new URLSearchParams(Object.entries(data).map(([key, value]) => [key, String(value)]));
  const buffer = await download(url, {
    method: "POST",
    body,
    accept: "application/json,text/javascript,*/*;q=0.8",
  });
  return { buffer, json: JSON.parse(buffer.toString("utf8")) };
}

async function ensureFile(file, useCache, fetcher) {
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file);
  const buffer = await fetcher();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return buffer;
}

async function ensureJsonFile(file, useCache, fetcher) {
  const buffer = await ensureFile(file, useCache, async () => (await fetcher()).buffer);
  return { buffer, json: JSON.parse(buffer.toString("utf8")) };
}

async function ensureRaw(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const pageFile = path.join(rawDir, "njust-plan-score-page.html");
  await ensureFile(pageFile, useCache, () => download(PAGE_URL));
  const queries = [];
  for (const province of PROVINCES) {
    const scoreFile = path.join(rawDir, `${provinceSlug(province)}-score-2023-2025.json`);
    const scorePayload = await ensureJsonFile(scoreFile, useCache, () =>
      downloadJson(SCORE_URL, { pageSize: 5000, rowoffset: 0, val1: province })
    );
    queries.push({ kind: "score", province, file: scoreFile, payload: scorePayload.json });
    const planFile = path.join(rawDir, `${provinceSlug(province)}-plan-2026.json`);
    const planPayload = await ensureJsonFile(planFile, useCache, () =>
      downloadJson(PLAN_URL, { pageSize: 5000, rowoffset: 0, val1: 2026, val2: "全部", val3: province })
    );
    queries.push({ kind: "plan", province, file: planFile, payload: planPayload.json });
    if (!useCache) await sleep(40);
  }
  return { pageFile, queries };
}

function optionalNumber(value) {
  const text = normalizeText(value);
  if (!text || text === "-" || text === "--") return null;
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function scoreVariants(value) {
  const text = normalizeText(value);
  const direct = optionalNumber(text);
  if (Number.isFinite(direct)) return [{ value: direct, raw: text, label: "" }];
  if (/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(text)) {
    return text.split("/").map((part, index) => ({
      value: Number(part),
      raw: text,
      label: `源表斜线分数第${index + 1}项（含义未公开）`,
      slashIndex: index + 1,
    }));
  }
  return [];
}

function optionalInteger(value) {
  const text = normalizeText(value);
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function subjectTypeFromPlan(raw) {
  const text = normalizeText(raw);
  if (/艺术|美术|设计|音乐/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科|化学|生物|技术/.test(text)) return "物理类";
  if (/综合|不限|不提/.test(text)) return "综合";
  return "综合";
}

function admissionKinds(text) {
  const kinds = [];
  if (/国家专项/.test(text)) kinds.push("国家专项");
  if (/高校专项/.test(text)) kinds.push("高校专项");
  if (/民族/.test(text)) kinds.push("民族/少数民族");
  if (/预科/.test(text)) kinds.push("少数民族预科");
  if (/内高班|内地班|西藏班|新疆班/.test(text)) kinds.push("内高班/内地班");
  if (/南疆单列|单列/.test(text)) kinds.push("单列计划");
  if (/定向/.test(text)) kinds.push("定向");
  if (/艺术|美术|音乐|体育|设计/.test(text)) kinds.push("艺术/体育类");
  if (/中外合作|中英|中法|中澳|中俄/.test(text)) kinds.push("中外合作办学");
  return kinds;
}

function admissionTypeFor(...parts) {
  const kinds = admissionKinds(parts.map((part) => normalizeText(part)).join(" "));
  return kinds.length ? kinds.join("；") : "普通录取";
}

function formalScoreScopeFor(...parts) {
  const text = parts.map((part) => normalizeText(part)).join(" ");
  return /国家专项|高校专项|民族|少数民族|预科|内高班|内地班|西藏班|新疆班|南疆单列|单列|定向|艺术|美术|音乐|体育/.test(text)
    ? "special-path-only"
    : "school-official-only";
}

function batchFor(className, scope) {
  const text = normalizeText(className);
  if (scope === "school-official-only") return text || "本科批";
  if (/国家专项/.test(text)) return "国家专项本科";
  if (/高校专项/.test(text)) return "高校专项";
  if (/预科/.test(text)) return "少数民族预科";
  if (/内高班|内地班/.test(text)) return "内高班/内地班";
  if (/艺术|美术|设计|音乐|体育/.test(text)) return "艺术/体育类本科";
  if (/单列/.test(text)) return "单列计划本科";
  if (/民族/.test(text)) return "民族/少数民族本科";
  return text || "特殊类型本科";
}

function scoreCautions(record) {
  const cautions = [
    "本记录来自南京理工大学本科招生网官方近三年录取分数线查询接口，是单校分省分专业最低分边界，不是省级教育考试院全量投档/录取分数表。",
    "源接口未公开最低位次，也未在往年分数线表公开科类/选科；运行层不生成假位次，不把本行作为精确选科匹配依据。",
  ];
  if (record.formalScoreScope === "school-official-only") {
    cautions.push("普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于南京理工大学候选边界复核，但不得替代同省省级正式投档表。");
  } else {
    cautions.push("该行属于专项、民族/预科、艺术体育、内高班/单列等特殊入口，按 formalScoreScope=special-path-only 隔离。");
  }
  if (record.candidateCategory && /斜线分数/.test(record.candidateCategory)) {
    cautions.push("源表以斜线形式给出两个分数但未在接口字段中释义；运行层拆成两个候选类别边界并按 special-path-only 隔离，正式填报必须回源站/招生章程/省级规则核验。");
  }
  if (/中外合作/.test(record.admissionType || "")) {
    cautions.push("中外合作办学需额外复核学费、培养模式、外语要求和转专业限制。");
  }
  return cautions;
}

function planCautions(record) {
  const cautions = [
    "本记录来自南京理工大学本科招生网官方 2026 年招生计划查询接口，只作当年专业池、计划数、选科和学费约束，不是投档线、录取最低分或录取概率。",
  ];
  if (record.formalScoreScope === "special-path-only") {
    cautions.push("该计划属于专项、民族/预科、艺术体育、内高班/单列等特殊入口，必须按资格条件单独复核。");
  }
  if (/中外合作/.test(record.admissionType || "")) {
    cautions.push("中外合作办学需额外复核学费、培养模式、外语要求和转专业限制。");
  }
  return cautions;
}

function recordsFromScoreQuery(query) {
  const rows = query.payload?.rows || query.payload?.data?.list || [];
  const records = [];
  const skippedCells = [];
  for (const row of rows) {
    const province = normalizeText(row.province || query.province);
    const className = normalizeText(row.class_name);
    const majorName = normalizeText(row.professional_name);
    const admissionType = admissionTypeFor(className, majorName);
    for (const [field, year] of SCORE_YEAR_FIELDS) {
      const variants = scoreVariants(row[field]);
      if (!variants.length) {
        skippedCells.push({ province, className, majorName, year, raw: normalizeText(row[field]) });
        continue;
      }
      for (const variant of variants) {
        const formalScoreScope = variant.slashIndex
          ? "special-path-only"
          : formalScoreScopeFor(className, majorName);
        const record = {
        id: `${year}-njust-national-score-${hash([row.id, province, className, majorName, field, variant.slashIndex || "", row[field]].join("|"))}`,
        province,
        sourceProvinceRaw: province,
        year,
        subjectType: "综合",
        sourceSubjectRaw: "未公开",
        subjectPrecision: "not-published-in-score-table",
        subjectMappingNote: "源站往年分数线表未公开科类/选科；运行层仅按单校专业分数边界保存，不作为精确选科匹配依据。",
        batch: batchFor(className, formalScoreScope),
        sourceBatchRaw: className,
        schoolCode: SOURCE.schoolCode,
        schoolName: SOURCE.schoolName,
        city: SOURCE.city,
        schoolTags: [...SOURCE.tags, ...admissionKinds(`${className} ${majorName}`).filter((kind) => kind !== "中外合作办学")],
        dataType: "major-admission",
        majorName: variant.label ? `${majorName}（${variant.label}）` : majorName,
        majorGroup: `${SOURCE.schoolName}${province}|${className || "录取"}|科类未公开`,
        admissionType,
        admissionSubtype: variant.label ? `${className || admissionType}|${variant.label}` : className || admissionType,
        formalScoreScope,
        minScore: variant.value,
        scoreOnly: true,
        rankUnavailable: true,
        sourceId: SOURCE.id,
        sourceQuality: SOURCE.quality,
        schoolOfficialScope: "single-school-admission-score",
        sourceUrl: PAGE_URL,
        sourcePageUrl: PAGE_URL,
        sourceApiUrl: SCORE_URL,
        officialEvidencePath: path.relative(PROJECT_ROOT, query.file),
        sourceApiPath: path.relative(PROJECT_ROOT, query.file),
        sourceMinScoreRaw: normalizeText(row[field]),
        rawScoreField: field,
        rawRow: row,
      };
      if (variant.label) {
        record.candidateCategory = variant.label;
        record.rawSlashScore = true;
        record.rawSlashScoreIndex = variant.slashIndex;
      }
      record.cautions = scoreCautions(record);
      records.push(record);
      }
    }
  }
  return { records, skippedCells };
}

function recordsFromPlanQuery(query) {
  const rows = query.payload?.rows || query.payload?.data?.list || [];
  const records = [];
  const skippedRows = [];
  for (const row of rows) {
    const province = normalizeText(row.province || query.province);
    const className = normalizeText(row.class_name);
    const majorName = normalizeText(row.professional_name);
    const planCount = optionalInteger(row.pain_num);
    if (!Number.isFinite(planCount)) {
      skippedRows.push({ province, className, majorName, rawPlanCount: normalizeText(row.pain_num) });
      continue;
    }
    const sourceSubjectRaw = normalizeText(row.subject);
    const subjectType = subjectTypeFromPlan(sourceSubjectRaw);
    const admissionType = admissionTypeFor(className, majorName, sourceSubjectRaw);
    const formalScoreScope = formalScoreScopeFor(className, majorName, sourceSubjectRaw);
    const record = {
      id: `2026-njust-national-plan-${hash([row.id, province, className, majorName, sourceSubjectRaw, row.pain_num].join("|"))}`,
      province,
      sourceProvinceRaw: province,
      year: Number(row.year) || 2026,
      subjectType,
      sourceSubjectRaw,
      batch: batchFor(className, formalScoreScope),
      sourceBatchRaw: className,
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      city: SOURCE.city,
      schoolTags: [...SOURCE.tags, ...admissionKinds(`${className} ${majorName} ${sourceSubjectRaw}`).filter((kind) => kind !== "中外合作办学")],
      dataType: "admission-plan",
      majorName,
      majorGroup: `${SOURCE.schoolName}${province}|${className || "计划"}|${sourceSubjectRaw || "科类未公开"}`,
      admissionType,
      admissionSubtype: className || admissionType,
      formalScoreScope,
      planCount,
      electiveRequirement: sourceSubjectRaw || undefined,
      tuition: normalizeText(row.tuition) || undefined,
      sourceId: SOURCE.id,
      sourceQuality: SOURCE.quality,
      schoolOfficialScope: "single-school-admission-plan",
      sourceUrl: PAGE_URL,
      sourcePageUrl: PAGE_URL,
      sourceApiUrl: PLAN_URL,
      officialEvidencePath: path.relative(PROJECT_ROOT, query.file),
      sourceApiPath: path.relative(PROJECT_ROOT, query.file),
      rawPlanCount: normalizeText(row.pain_num),
      rawRow: row,
    };
    record.cautions = planCautions(record);
    records.push(record);
  }
  return { records, skippedRows };
}

function buildSourceNote(raw, records, skippedScoreCells, skippedPlanRows) {
  const sourceFiles = [raw.pageFile, ...raw.queries.map((query) => query.file)];
  const scoreRecords = records.filter((record) => record.dataType === "major-admission");
  const planRecords = records.filter((record) => record.dataType === "admission-plan");
  const scoreValues = scoreRecords.map((record) => record.minScore).filter(Number.isFinite);
  const provinces = [...new Set(records.map((record) => record.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  return {
    id: SOURCE.id,
    title: "南京理工大学本科招生信息网：2026年招生计划及近三年录取分数线查询",
    publisher: "南京理工大学",
    url: PAGE_URL,
    pageUrl: PAGE_URL,
    apiUrls: {
      recentScores: SCORE_URL,
      admissionPlans: PLAN_URL,
    },
    quality: SOURCE.quality,
    usage: "抽取南京理工大学本科招生信息网官方 2026 年招生计划和 2023-2025 年往年分数线接口；招生计划用于专业池/选科/计划数/学费约束，往年分数线用于单校专业最低分候选边界复核。",
    parsedRecords: records.length,
    scoreRecords: scoreRecords.length,
    planRecords: planRecords.length,
    provinceCount: provinces.length,
    queryCount: raw.queries.length,
    years: [...new Set(records.map((record) => record.year).filter(Boolean))].sort((a, b) => a - b),
    byYear: countBy(records, (record) => record.year),
    byProvince: countBy(records, (record) => record.province),
    byDataType: countBy(records, (record) => record.dataType),
    byClassName: countBy(records, (record) => record.sourceBatchRaw),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope || "plan-only"),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    scoreRange: numericRange(scoreValues),
    skippedScoreCells: skippedScoreCells.filter((cell) => cell.raw && cell.raw !== "-").slice(0, 80),
    skippedDashScoreCells: skippedScoreCells.filter((cell) => !cell.raw || cell.raw === "-").length,
    skippedPlanRows,
    rawPaths: sourceFiles.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: sourceFiles.map((file) => ({
      path: path.relative(PROJECT_ROOT, file),
      sha256: sha256File(file),
    })),
    transcriptionMethod: "official-dynamic-query-json",
    cautions: [
      "本源为南京理工大学官方单校招生计划/分数查询系统，不是任何省级教育考试院全量投档/录取分数表。",
      "往年分数线表未公开最低位次，也未公开科类/选科；运行层不生成假位次，不把分数线行作为精确选科匹配依据。",
      "2026 招生计划只作专业池、计划数、学费和选科约束，不是投档线、录取最低分或录取概率。",
      "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "国家专项、高校专项、民族/预科、内高班、南疆单列、艺术类等按 formalScoreScope=special-path-only 隔离。",
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
  const records = [];
  const skippedScoreCells = [];
  const skippedPlanRows = [];
  for (const query of raw.queries) {
    if (query.kind === "score") {
      const result = recordsFromScoreQuery(query);
      records.push(...result.records);
      skippedScoreCells.push(...result.skippedCells);
    } else if (query.kind === "plan") {
      const result = recordsFromPlanQuery(query);
      records.push(...result.records);
      skippedPlanRows.push(...result.skippedRows);
    }
  }
  const sourceNote = buildSourceNote(raw, records, skippedScoreCells, skippedPlanRows);
  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes: [sourceNote], records }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, outPath),
    sourceId: SOURCE.id,
    records: records.length,
    scoreRecords: sourceNote.scoreRecords,
    planRecords: sourceNote.planRecords,
    provinces: sourceNote.provinceCount,
    years: sourceNote.years,
    byDataType: sourceNote.byDataType,
    byFormalScoreScope: sourceNote.byFormalScoreScope,
    skippedDashScoreCells: sourceNote.skippedDashScoreCells,
    skippedPlanRows: skippedPlanRows.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
