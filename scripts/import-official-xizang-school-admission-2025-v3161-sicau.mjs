#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-school-admission-2025-v3161-sicau-import.json";
const RAW_DIR = "data/admissions/raw/official-xizang-school-admission-2025-v3161-sicau";
const PROVINCE = "西藏";

const SOURCE = {
  id: "official-sicau-xizang-2025-school-admission",
  quality: "official-school-sicau-2025-xizang-dynamic-query-score-only",
  schoolCode: "10626",
  schoolName: "四川农业大学",
  city: "雅安",
  tags: ["农林", "双一流"],
  staticPageUrl: "https://zs.sicau.edu.cn/info/1025/1005.htm",
  queryUrl: "https://zsdata.sicau.edu.cn/zsdata/lqxx/#/lnfs",
  queryRootUrl: "https://zsdata.sicau.edu.cn/zsdata/lqxx/",
  apiBase: "https://zsdata.sicau.edu.cn/lqxx/s",
};

const RAW_FILES = {
  staticPage: "sicau/static-page.html",
  queryRoot: "sicau/query-root.html",
  appJs: "sicau/app.js",
  lqcxjgJs: "sicau/lqcxjg.js",
  vendorsJs: "sicau/vendors.js",
  typeMap: "sicau/api-type-map.json",
  fields: "sicau/api-fields.json",
  ordinaryLigong: "sicau/api-list-xizang-2025-ordinary-ligong.json",
  ordinaryAll: "sicau/api-list-xizang-2025-ordinary-all.json",
  xizangbanAll: "sicau/api-list-xizang-2025-xizangban-all.json",
};

const SUBJECT_MAP = {
  "理工": "物理类",
  "文史": "历史类",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-school-admission-2025-v3161-sicau.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-school-admission-2025-v3161-sicau.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source pages/API payloads",
    "",
    "Imports Sichuan Agricultural University official Xizang 2025 admission scores from its dynamic query system.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
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

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&nbsp;|\u00a0|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function textFromHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(html, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return textFromHtml(match[1]);
  }
  return "";
}

function pageMeta(html) {
  return {
    title: firstText(html, [/<meta\s+property=["']og:title["']\s+content=["']([\s\S]*?)["']/i, /<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]),
    publishedAt: firstText(html, [/发布时间\s*[:：]?\s*([0-9]{4}[-年][0-9]{1,2}[-月][0-9]{1,2}日?(?:\s+[0-9:]+)?)/i]),
    modifiedAt: firstText(html, [/更新时间\s*[:：]?\s*([0-9]{4}[-年][0-9]{1,2}[-月][0-9]{1,2}日?(?:\s+[0-9:]+)?)/i]),
  };
}

async function download(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-xizang-sicau-v3161-importer/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          ...(options.referer ? { referer: options.referer } : {}),
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }
  const curlArgs = [
    "-L",
    "--compressed",
    "--fail",
    "--silent",
    "--show-error",
    "--max-time",
    "90",
    "-A",
    "Mozilla/5.0 gaokao-xizang-sicau-v3161-importer/1.0",
    "-H",
    `Accept: ${options.accept || "*/*"}`,
  ];
  if (options.referer) curlArgs.push("-e", options.referer);
  curlArgs.push(url);
  const curl = spawnSync("curl", curlArgs, {
    encoding: "buffer",
    maxBuffer: 48 * 1024 * 1024,
  });
  if (!curl.error && curl.status === 0 && curl.stdout?.length > 0) return Buffer.from(curl.stdout);
  throw new Error([
    `fetch and curl failed for ${url}`,
    String(lastError),
    curl.error ? String(curl.error) : "",
    curl.stderr?.toString("utf8").trim(),
  ].filter(Boolean).join("\n"));
}

async function postJson(url, body) {
  const text = JSON.stringify(body);
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-xizang-sicau-v3161-importer/1.0",
      "content-type": "application/json;charset=utf-8",
      accept: "application/json, text/plain, */*",
      origin: "https://zsdata.sicau.edu.cn",
      referer: SOURCE.queryUrl,
    },
    body: text,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureGet(rawDir, relative, url, useCache, options = {}) {
  const file = path.join(rawDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!useCache || !fs.existsSync(file)) {
    fs.writeFileSync(file, await download(url, options));
  }
  return file;
}

async function ensurePost(rawDir, relative, endpoint, body, useCache) {
  const file = path.join(rawDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!useCache || !fs.existsSync(file)) {
    fs.writeFileSync(file, await postJson(`${SOURCE.apiBase}${endpoint}`, body));
  }
  return file;
}

function scriptUrlFromRoot(rootHtml, token) {
  const scripts = [...rootHtml.matchAll(/(?:src|href)=(?:"([^"]+\.js)"|'([^']+\.js)'|([^\s>]+\.js))/gi)]
    .map((match) => new URL(decodeHtmlEntities(match[1] || match[2] || match[3]), SOURCE.queryRootUrl).toString());
  return scripts.find((url) => url.includes(token));
}

async function ensureRawFiles(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const staticPage = await ensureGet(rawDir, RAW_FILES.staticPage, SOURCE.staticPageUrl, useCache);
  const queryRoot = await ensureGet(rawDir, RAW_FILES.queryRoot, SOURCE.queryRootUrl, useCache);
  const rootHtml = fs.readFileSync(queryRoot, "utf8");
  const appUrl = scriptUrlFromRoot(rootHtml, "/app.");
  const lqcxjgUrl = scriptUrlFromRoot(rootHtml, "/lqcxjg.");
  const vendorsUrl = scriptUrlFromRoot(rootHtml, "/chunk-vendors.");
  if (!appUrl || !lqcxjgUrl || !vendorsUrl) {
    throw new Error("Could not locate expected SICAU query-system JS assets.");
  }
  const appJs = await ensureGet(rawDir, RAW_FILES.appJs, appUrl, useCache, { accept: "application/javascript,*/*;q=0.8", referer: SOURCE.queryUrl });
  const lqcxjgJs = await ensureGet(rawDir, RAW_FILES.lqcxjgJs, lqcxjgUrl, useCache, { accept: "application/javascript,*/*;q=0.8", referer: SOURCE.queryUrl });
  const vendorsJs = await ensureGet(rawDir, RAW_FILES.vendorsJs, vendorsUrl, useCache, { accept: "application/javascript,*/*;q=0.8", referer: SOURCE.queryUrl });
  const typeMap = await ensurePost(rawDir, RAW_FILES.typeMap, "/api/front/lqxx/getType", { type: "lnfs" }, useCache);
  const fields = await ensurePost(rawDir, RAW_FILES.fields, "/api/front/infoconfig/getlqxsgz", { type: "lnfs" }, useCache);
  const ordinaryLigong = await ensurePost(rawDir, RAW_FILES.ordinaryLigong, "/api/front/lqxx/getList", { type: "lnfs", sf: PROVINCE, nf: "2025", zslb: "普通类", klmc: "理工", xqmc: "" }, useCache);
  const ordinaryAll = await ensurePost(rawDir, RAW_FILES.ordinaryAll, "/api/front/lqxx/getList", { type: "lnfs", sf: PROVINCE, nf: "2025", zslb: "普通类", klmc: "全部", xqmc: "" }, useCache);
  const xizangbanAll = await ensurePost(rawDir, RAW_FILES.xizangbanAll, "/api/front/lqxx/getList", { type: "lnfs", sf: PROVINCE, nf: "2025", zslb: "西藏班", klmc: "全部", xqmc: "" }, useCache);
  return {
    staticPage,
    queryRoot,
    appJs,
    lqcxjgJs,
    vendorsJs,
    typeMap,
    fields,
    ordinaryLigong,
    ordinaryAll,
    xizangbanAll,
    assetUrls: { appUrl, lqcxjgUrl, vendorsUrl },
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function numeric(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "\\" || raw === "/" || raw === "--") return undefined;
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return undefined;
  return Number(raw);
}

function subjectType(raw) {
  if (!SUBJECT_MAP[raw]) throw new Error(`Unknown subject: ${raw}`);
  return SUBJECT_MAP[raw];
}

function splitHanZangScores(raw) {
  const result = [];
  for (const match of String(raw || "").matchAll(/(汉|藏)\s*(\d+(?:\.\d+)?)/g)) {
    result.push({ category: match[1], score: Number(match[2]) });
  }
  return result;
}

function schoolOfficialCautions(extra = []) {
  return [
    `本记录来自${SOURCE.schoolName}官方历年分数查询系统，是单校分省录取分数边界，不是西藏自治区教育考试院全量投档/录取分数表。`,
    "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得清除西藏省级全量正式分数表缺口。",
    "源系统未公开最低位次的记录不得生成假位次或单独输出录取概率。",
    ...extra,
  ];
}

function specialPathCautions(extra = []) {
  return [
    `本记录来自${SOURCE.schoolName}官方历年分数查询系统，但属于西藏班等限制入口边界。`,
    "本记录按 formalScoreScope=special-path-only 隔离，只用于对应入口复核，不替代普通批全量投档/录取分数表。",
    "源系统未公开最低位次的记录不得生成假位次或普通批录取概率。",
    ...extra,
  ];
}

function baseFields() {
  return {
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: SOURCE.queryUrl,
  };
}

function rowText(row) {
  return [
    row.nf,
    row.sf,
    row.xqlx,
    row.zslb,
    row.pcmc,
    row.klmc,
    row.zymc,
    `省控线${row.fskzx}`,
    `最高分${row.zgf}`,
    `平均分${row.pjf}`,
    `最低分${row.zdf}`,
    row.zdfwc ? `最低分位次${row.zdfwc}` : "",
  ].filter(Boolean).join(" / ");
}

function buildOrdinaryMajorRecords(rows) {
  return rows.map((row) => {
    const minScore = numeric(row.zdf);
    const maxScore = numeric(row.zgf);
    const avgScore = numeric(row.pjf);
    const controlLine = numeric(row.fskzx);
    const idBase = [row.nf, "sicau", row.sf, row.zslb, row.klmc, row.xqlx, row.pcmc, row.zymc, row.zdf].join("|");
    return {
      id: `2025-sicau-xizang-major-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: 2025,
      subjectType: subjectType(row.klmc),
      sourceSubjectRaw: row.klmc,
      batch: row.pcmc || "本科一批",
      ...baseFields(),
      dataType: "major-admission",
      campus: row.xqlx || undefined,
      majorName: row.zymc,
      majorGroup: row.xqlx || "校区未列",
      admissionType: row.zslb,
      formalScoreScope: "school-official-only",
      xizangCandidateCategory: "汉/藏未拆分",
      controlLine,
      minScore,
      maxScore,
      avgScore,
      scoreOnly: true,
      rankUnavailable: true,
      sourceControlLineRaw: row.fskzx,
      sourceMinScoreRaw: row.zdf,
      sourceMaxScoreRaw: row.zgf,
      sourceAvgScoreRaw: row.pjf,
      sourceScoreScale: "source-declared-admission-score",
      transcriptionMethod: "official-dynamic-query-api-json",
      cautions: schoolOfficialCautions(["四川农业大学源系统专业行未拆分汉/藏考生类别；普通类理工汇总行另保留汉/藏最低分，使用专业最低分时需回看考生类别口径。"]),
      rawText: rowText(row),
    };
  });
}

function buildOrdinarySummaryRecords(sumRows) {
  const records = [];
  for (const row of sumRows.filter((item) => item.zslb === "普通类" && item.klmc === "理工")) {
    const scores = splitHanZangScores(row.zdf);
    const controls = new Map(splitHanZangScores(row.fskzx).map((item) => [item.category, item.score]));
    for (const item of scores) {
      const idBase = [row.nf, "sicau", "ordinary-summary", row.klmc, item.category, item.score].join("|");
      records.push({
        id: `2025-sicau-xizang-institution-${hash(idBase, 16)}`,
        province: PROVINCE,
        year: 2025,
        subjectType: subjectType(row.klmc),
        sourceSubjectRaw: row.klmc,
        batch: row.pcmc || "本科一批",
        ...baseFields(),
        dataType: "institution-admission",
        majorGroup: `普通类|${row.klmc}|${item.category}`,
        admissionType: row.zslb,
        admissionSubtype: item.category,
        formalScoreScope: "school-official-only",
        xizangCandidateCategory: item.category,
        controlLine: controls.get(item.category),
        minScore: item.score,
        scoreOnly: true,
        rankUnavailable: true,
        sourceControlLineRaw: row.fskzx,
        sourceMinScoreRaw: row.zdf,
        sourceScoreScale: "source-declared-admission-score",
        transcriptionMethod: "official-dynamic-query-api-json",
        cautions: schoolOfficialCautions(["本汇总行来自四川农业大学源系统 sumList，按汉/藏拆分最低分；只作该校普通类理工整体边界，不代表具体专业最低分。"]),
        rawText: rowText(row),
      });
    }
  }
  return records;
}

function buildXizangbanRecords(sumRows) {
  return sumRows.map((row) => {
    const minScore = numeric(row.zdf);
    const idBase = [row.nf, "sicau", "xizangban", row.klmc, row.zdf].join("|");
    return {
      id: `2025-sicau-xizang-special-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: 2025,
      subjectType: subjectType(row.klmc),
      sourceSubjectRaw: row.klmc,
      batch: row.pcmc || "本科一批",
      ...baseFields(),
      dataType: "institution-admission",
      majorGroup: `西藏班|${row.klmc}`,
      admissionType: row.zslb,
      admissionSubtype: "西藏班",
      formalScoreScope: "special-path-only",
      minScore,
      scoreOnly: true,
      rankUnavailable: true,
      sourceControlLineRaw: row.fskzx,
      sourceMinScoreRaw: row.zdf,
      sourceScoreScale: "source-declared-admission-score",
      transcriptionMethod: "official-dynamic-query-api-json",
      cautions: specialPathCautions(["四川农业大学源系统仅给出西藏班分科类汇总最低分，没有专业明细、控制线、最高分、平均分或最低位次。"]),
      rawText: rowText(row),
    };
  });
}

function validateApiPayloads(files) {
  const typeMap = readJson(files.typeMap);
  const fields = readJson(files.fields);
  const ordinary = readJson(files.ordinaryLigong);
  const ordinaryAll = readJson(files.ordinaryAll);
  const xizangban = readJson(files.xizangbanAll);
  if (!typeMap.success || !typeMap.typeMap?.["西藏_2025_理工_"]?.includes("普通类") || !typeMap.typeMap?.["西藏_2025_文史_"]?.includes("西藏班")) {
    throw new Error("SICAU typeMap no longer exposes expected Xizang 2025 categories.");
  }
  const fieldNames = new Set((fields.lqxsgz || []).map((item) => item.field));
  for (const required of ["nf", "sf", "xqlx", "zslb", "klmc", "zymc", "fskzx", "zgf", "pjf", "zdf", "zdfwc"]) {
    if (!fieldNames.has(required)) throw new Error(`SICAU field config missing ${required}`);
  }
  if (!ordinary.success || !Array.isArray(ordinary.list) || ordinary.list.length !== 12) {
    throw new Error(`Unexpected SICAU ordinary Xizang 2025 record count: ${ordinary.list?.length}`);
  }
  for (const row of ordinary.list) {
    if (row.sf !== PROVINCE || row.nf !== "2025" || row.zslb !== "普通类" || row.klmc !== "理工" || !row.zymc || !Number.isFinite(numeric(row.zdf))) {
      throw new Error(`Unexpected ordinary row: ${JSON.stringify(row)}`);
    }
  }
  const ordinarySummary = ordinaryAll.sumList || [];
  if (!ordinarySummary.some((row) => row.zdf === "汉444，藏324" && row.fskzx === "汉400，藏300")) {
    throw new Error("SICAU ordinary summary row changed; refusing to parse han/zang minimum scores.");
  }
  if (!xizangban.success || !Array.isArray(xizangban.sumList) || xizangban.sumList.length !== 2) {
    throw new Error(`Unexpected SICAU Xizangban summary count: ${xizangban.sumList?.length}`);
  }
  for (const row of xizangban.sumList) {
    if (row.zslb !== "西藏班" || !["理工", "文史"].includes(row.klmc) || !Number.isFinite(numeric(row.zdf))) {
      throw new Error(`Unexpected Xizangban row: ${JSON.stringify(row)}`);
    }
  }
  return { ordinary, ordinaryAll, xizangban };
}

function diagnosticsFor(records) {
  const schoolOfficial = records.filter((record) => record.formalScoreScope === "school-official-only");
  const specialPath = records.filter((record) => record.formalScoreScope === "special-path-only");
  return {
    totalRows: records.length,
    schoolOfficialRows: schoolOfficial.length,
    specialPathRows: specialPath.length,
    bySourceId: countBy(records, (record) => record.sourceId),
    bySchool: countBy(records, (record) => record.schoolName),
    byDataType: countBy(records, (record) => record.dataType),
    bySubject: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
    ordinarySchoolOfficialScoreRange: numericRange(schoolOfficial.map((record) => Number(record.minScore))),
    rankRows: records.filter((record) => Number.isFinite(record.minRank)).length,
  };
}

function sourceNoteFor(records, files) {
  const staticHtml = fs.readFileSync(files.staticPage, "utf8");
  const meta = pageMeta(staticHtml);
  const rawPaths = [
    files.staticPage,
    files.queryRoot,
    files.appJs,
    files.lqcxjgJs,
    files.vendorsJs,
    files.typeMap,
    files.fields,
    files.ordinaryLigong,
    files.ordinaryAll,
    files.xizangbanAll,
  ].map((file) => path.relative(PROJECT_ROOT, file));
  return {
    id: SOURCE.id,
    title: "四川农业大学历年分数查询系统：西藏 2025 录取分数",
    publisher: SOURCE.schoolName,
    publishedAt: meta.publishedAt || undefined,
    modifiedAt: meta.modifiedAt || undefined,
    url: SOURCE.queryUrl,
    landingPageUrl: SOURCE.staticPageUrl,
    apiBase: SOURCE.apiBase,
    assetUrls: files.assetUrls,
    quality: SOURCE.quality,
    usage: `抽取${SOURCE.schoolName}官方历年分数查询系统中西藏2025普通类理工专业分、普通类汉/藏汇总最低分和西藏班汇总最低分。`,
    parsedRecords: records.length,
    rawPaths,
    sha256: rawPaths.map((relative) => ({ path: relative, sha256: sha256File(path.join(PROJECT_ROOT, relative)) })),
    apiQueries: [
      { endpoint: "/api/front/lqxx/getType", body: { type: "lnfs" } },
      { endpoint: "/api/front/infoconfig/getlqxsgz", body: { type: "lnfs" } },
      { endpoint: "/api/front/lqxx/getList", body: { type: "lnfs", sf: PROVINCE, nf: "2025", zslb: "普通类", klmc: "理工", xqmc: "" } },
      { endpoint: "/api/front/lqxx/getList", body: { type: "lnfs", sf: PROVINCE, nf: "2025", zslb: "普通类", klmc: "全部", xqmc: "" } },
      { endpoint: "/api/front/lqxx/getList", body: { type: "lnfs", sf: PROVINCE, nf: "2025", zslb: "西藏班", klmc: "全部", xqmc: "" } },
    ],
    transcriptionMethod: "official-dynamic-query-api-json",
    cautions: [
      "本源为高校官方单校录取数据，不是西藏自治区教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "西藏班汇总最低分按 formalScoreScope=special-path-only 隔离。",
      "源系统未公开最低位次，不生成假位次或录取概率。",
      "专业行未拆分汉/藏考生类别；普通类理工汇总行另保留汉/藏最低分。",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const rawDir = path.resolve(PROJECT_ROOT, RAW_DIR);
  const files = await ensureRawFiles(rawDir, args.useCache);
  const payloads = validateApiPayloads(files);
  const records = [
    ...buildOrdinaryMajorRecords(payloads.ordinary.list),
    ...buildOrdinarySummaryRecords(payloads.ordinaryAll.sumList || []),
    ...buildXizangbanRecords(payloads.xizangban.sumList || []),
  ];
  const diagnostics = diagnosticsFor(records);
  if (diagnostics.totalRows !== 16 || diagnostics.rankRows !== 0 || diagnostics.schoolOfficialRows !== 14 || diagnostics.specialPathRows !== 2) {
    throw new Error(`Unexpected v3.161 SICAU diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const output = {
    dataset: "official-xizang-school-admission-2025-v3161-sicau-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      sourceKind: "school-official-single-university-dynamic-query-score",
      schools: [SOURCE.schoolName],
    },
    notes: [
      "本文件由 scripts/import-official-xizang-school-admission-2025-v3161-sicau.mjs 自动生成。",
      "来源为四川农业大学官方历年分数查询系统；入口 HTML、前端 JS、字段配置、typeMap 和 API JSON 已保留在 raw provenance pack。",
      "普通类理工专业行保留 12 条，源系统未拆分汉/藏考生类别；普通类汇总行另按汉/藏拆分为 2 条学校层边界。",
      "西藏班理工/文史汇总最低分按 special-path-only 隔离，不进入普通批文化分边界。",
      "学校官网单校分数只作候选边界复核，不能替代西藏考试院全量投档/录取分数表。",
      "源系统未公开最低位次；所有记录均不生成假位次或录取概率。",
    ],
    sourceNotes: [sourceNoteFor(records, files)],
    diagnostics,
    records,
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    schoolOfficialRows: diagnostics.schoolOfficialRows,
    specialPathRows: diagnostics.specialPathRows,
    rankRows: diagnostics.rankRows,
    byDataType: diagnostics.byDataType,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
