#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2024-2025-v3182-hit-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2024-2025-v3182-hit";
const SCORE_PAGE_URL = "https://zsb.hit.edu.cn/information/score";
const SCORE_LIST_URL = "https://zsb.hit.edu.cn/information/score-list";
const YEARS = [2025, 2024];
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

const SOURCE = {
  id: "official-hit-national-2024-2025-school-admission",
  quality: "official-school-hit-2024-2025-national-dynamic-query-score-only",
  schoolCode: "10213",
  schoolName: "哈尔滨工业大学",
  city: "哈尔滨",
  tags: ["理工", "985", "211", "双一流"],
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2024-2025-v3182-hit.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2024-2025-v3182-hit.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/API JSON",
    "",
    "Imports Harbin Institute of Technology official 2024/2025 national major admission score query rows.",
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

function numericRange(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function pageUrl(province, year) {
  const params = new URLSearchParams({ province, year: String(year) });
  return `${SCORE_PAGE_URL}?${params.toString()}`;
}

function parseSetCookie(headers) {
  const raw = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (headers.get("set-cookie") || "").split(/,(?=\s*[^;,]+=)/g);
  return raw.map((item) => item.split(";")[0]).filter(Boolean).join("; ");
}

function tokenFromHtml(html, province, year) {
  const match = html.match(/<input[^>]*id=["']token["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']+)["']/i);
  if (!match) throw new Error(`HIT token not found for ${province} ${year}`);
  return { token_key: match[1], token_value: match[2] };
}

async function downloadPage(province, year) {
  const url = pageUrl(province, year);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-hit-v3182-importer/1.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const cookie = parseSetCookie(response.headers);
  const html = Buffer.from(await response.arrayBuffer());
  return { html, cookie };
}

async function downloadScoreList(province, year, html, cookie) {
  const token = tokenFromHtml(html.toString("utf8"), province, year);
  const body = new URLSearchParams({
    year: String(year),
    province,
    token_key: token.token_key,
    token_value: token.token_value,
  });
  const response = await fetch(SCORE_LIST_URL, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-hit-v3182-importer/1.0",
      accept: "application/json,text/javascript,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer: pageUrl(province, year),
      cookie,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${SCORE_LIST_URL} ${province} ${year}`);
  return Buffer.from(await response.arrayBuffer());
}

function slugFor(province, year, suffix) {
  const slug = PROVINCE_SLUGS.get(province);
  if (!slug) throw new Error(`No slug for ${province}`);
  return `${year}-${slug}-${suffix}`;
}

async function ensureRaw(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const pairs = [];
  for (const year of YEARS) {
    for (const province of PROVINCES) {
      const pageFile = path.join(rawDir, slugFor(province, year, "score-page.html"));
      const apiFile = path.join(rawDir, slugFor(province, year, "score-list.json"));
      if (!useCache || !fs.existsSync(pageFile) || !fs.existsSync(apiFile)) {
        const page = await downloadPage(province, year);
        fs.writeFileSync(pageFile, page.html);
        fs.writeFileSync(apiFile, await downloadScoreList(province, year, page.html, page.cookie));
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      pairs.push({ province, year, pageFile, apiFile });
    }
  }
  return pairs;
}

function numberField(value, label) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`Invalid ${label}: ${text}`);
  return Number(text);
}

function subjectType(raw, speciality) {
  const text = String(raw || "").trim();
  const fullText = `${text} ${speciality || ""}`;
  if (/艺术|美术|音乐|体育/.test(fullText)) return "艺术类";
  if (/综合|不分文理|3\+3/.test(text)) return "综合";
  if (/不限/.test(text)) return "综合";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  throw new Error(`Unsupported HIT subject/category: ${raw}`);
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
  if (/艺术|美术|音乐|体育/.test(text)) kinds.push("艺术/体育类");
  if (/中外合作|中俄|中法/.test(text)) kinds.push("中外合作办学");
  return kinds;
}

function formalScoreScope(speciality, category) {
  const text = `${speciality} ${category}`;
  return /国家专项|高校专项|民族|预科|内高班|内地班|西藏班|新疆班|南疆单列|单列|定向|艺术|美术|音乐|体育/.test(text)
    ? "special-path-only"
    : "school-official-only";
}

function admissionTypeFor(speciality, category) {
  const kinds = admissionKinds(`${speciality} ${category}`);
  return kinds.length ? kinds.join("；") : "普通录取";
}

function batchFor(scope, admissionType) {
  if (scope !== "special-path-only") return "本科批";
  if (admissionType.includes("国家专项")) return "国家专项本科";
  if (admissionType.includes("高校专项")) return "高校专项";
  if (admissionType.includes("预科")) return "少数民族预科";
  if (admissionType.includes("内高班")) return "内高班/内地班";
  if (admissionType.includes("艺术") || admissionType.includes("体育")) return "艺术/体育类本科";
  if (admissionType.includes("单列")) return "单列计划本科";
  return "特殊类型本科";
}

function dataTypeFor(speciality) {
  return /^录取分数/.test(String(speciality || "").trim()) ? "institution-admission" : "major-admission";
}

function cautionsFor(record) {
  const cautions = [
    "本记录来自哈尔滨工业大学本科招生网官方录取分数动态查询系统，是单校分省专业录取分数边界，不是省级教育考试院全量投档/录取分数表。",
    "源系统未公开最低位次；不得生成假位次或仅凭本行分数单独输出录取概率。",
  ];
  if (record.formalScoreScope === "school-official-only") {
    cautions.push("普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于哈尔滨工业大学候选边界复核，但不得替代同省省级正式投档表。");
  } else {
    cautions.push(`${record.admissionType}按 formalScoreScope=special-path-only 隔离，只用于对应资格入口复核，不与普通本科批混用。`);
  }
  if (record.admissionType.includes("中外合作办学")) {
    cautions.push("中外合作办学口径需额外核对学费、校区、培养模式、外语要求和家庭预算红线。");
  }
  return cautions;
}

function buildRecords(rawPairs) {
  const records = [];
  for (const pair of rawPairs) {
    const payload = JSON.parse(fs.readFileSync(pair.apiFile, "utf8"));
    if (payload.success !== 1) throw new Error(`HIT score-list failed for ${pair.province} ${pair.year}: ${payload.errmsg || ""}`);
    const rows = payload.data?.score || [];
    for (const row of rows) {
      const speciality = String(row.speciality || "").trim();
      const category = String(row.category || "").trim();
      const scope = formalScoreScope(speciality, category);
      const admissionType = admissionTypeFor(speciality, category);
      const minScore = numberField(row.min, "minScore");
      const maxScore = numberField(row.max, "maxScore");
      const avgScore = numberField(row.avg, "avgScore");
      if (minScore > maxScore) throw new Error(`minScore > maxScore for ${pair.province} ${pair.year} ${speciality}`);
      const sourceSubjectRaw = category;
      const idBase = [pair.year, SOURCE.schoolCode, pair.province, sourceSubjectRaw, row.campus, speciality, minScore, maxScore, avgScore].join("|");
      const record = {
        id: `${pair.year}-hit-national-major-${hash(idBase, 16)}`,
        province: pair.province,
        sourceProvinceRaw: String(row.province || pair.province).trim(),
        year: pair.year,
        subjectType: subjectType(sourceSubjectRaw, speciality),
        sourceSubjectRaw,
        batch: batchFor(scope, admissionType),
        sourceBatchRaw: admissionType,
        schoolCode: SOURCE.schoolCode,
        schoolName: SOURCE.schoolName,
        city: SOURCE.city,
        schoolTags: SOURCE.tags,
        dataType: dataTypeFor(speciality),
        majorName: speciality,
        campus: String(row.campus || "").trim(),
        majorGroup: `${SOURCE.schoolName}${pair.year}${pair.province}${sourceSubjectRaw}|${String(row.campus || "").trim()}|${admissionType}`,
        admissionType,
        admissionSubtype: admissionType,
        formalScoreScope: scope,
        minScore,
        maxScore,
        avgScore,
        scoreOnly: true,
        rankUnavailable: true,
        sourceId: SOURCE.id,
        sourceQuality: SOURCE.quality,
        schoolOfficialScope: "single-school-admission-score",
        sourceUrl: SCORE_PAGE_URL,
        sourcePageUrl: pageUrl(pair.province, pair.year),
        sourceApiUrl: SCORE_LIST_URL,
        sourceMinScoreRaw: String(row.min || ""),
        sourceMaxScoreRaw: String(row.max || ""),
        sourceAvgScoreRaw: String(row.avg || ""),
        rawRow: row,
      };
      record.cautions = cautionsFor(record);
      records.push(record);
    }
  }
  return records;
}

function buildSourceNote(records, rawPairs) {
  const ordinary = records.filter((record) => record.formalScoreScope === "school-official-only");
  const special = records.filter((record) => record.formalScoreScope === "special-path-only");
  const rawFiles = rawPairs.flatMap((pair) => [pair.pageFile, pair.apiFile]);
  return {
    id: SOURCE.id,
    title: "哈尔滨工业大学本科招生网：2024-2025年全国分省专业录取分数",
    publisher: SOURCE.schoolName,
    url: SCORE_PAGE_URL,
    apiUrl: SCORE_LIST_URL,
    query: {
      years: YEARS,
      provinces: PROVINCES,
    },
    quality: SOURCE.quality,
    usage: "抽取哈尔滨工业大学官方录取分数动态查询系统中2024、2025年31个省级口径的专业最高分、最低分、平均分；普通行作单校候选边界，国家专项、民族、预科、内高班/内地班和定向等隔离为特殊路径。",
    parsedRecords: records.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    ordinarySchoolOfficialRecords: ordinary.length,
    specialPathRecords: special.length,
    byYear: countBy(records, (record) => record.year),
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    scoreRange: numericRange(records.map((record) => record.minScore)),
    rawPaths: rawFiles.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: rawFiles.map((file) => ({
      path: path.relative(PROJECT_ROOT, file),
      sha256: sha256File(file),
    })),
    transcriptionMethod: "official-dynamic-query-api-json-with-session-token",
    cautions: [
      "本源为高校官方单校录取数据，不是任何省级教育考试院全量投档/录取分数表。",
      "全部记录无最低位次，推荐层不得生成假位次或仅凭该单校分数输出录取概率。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "国家专项、民族、预科、内高班/内地班和定向等记录按 formalScoreScope=special-path-only 隔离。",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const rawDir = path.join(PROJECT_ROOT, RAW_DIR);
  const rawPairs = await ensureRaw(rawDir, args.useCache);
  const records = buildRecords(rawPairs);
  const sourceNotes = [buildSourceNote(records, rawPairs)];
  const outPath = path.join(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes, records }, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    out: args.out,
    records: records.length,
    provinceCount: sourceNotes[0].provinceCount,
    ordinarySchoolOfficialRecords: sourceNotes[0].ordinarySchoolOfficialRecords,
    specialPathRecords: sourceNotes[0].specialPathRecords,
    byYear: sourceNotes[0].byYear,
    bySubjectType: sourceNotes[0].bySubjectType,
    scoreRange: sourceNotes[0].scoreRange,
    sha256: sha256File(outPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
