#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2022-2025-v3232-xidian-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2022-2025-v3232-xidian";
const INDEX_URL = "https://zsxc.xidian.edu.cn/auth/zsdata/lqxx/";
const BASE_API_URL = "https://zsxc.xidian.edu.cn/lqxx/s";
const GET_TYPE_URL = `${BASE_API_URL}/api/front/lqxx/getType`;
const GET_LIST_URL = `${BASE_API_URL}/api/front/lqxx/getList`;
const GLOBAL_CFG_URL = `${BASE_API_URL}/api/front/infoconfig/getGlobalCfg`;
const DISPLAY_CFG_URL = `${BASE_API_URL}/api/front/infoconfig/getlqxsgz`;
const APP_JS_URL = "https://zsxc.xidian.edu.cn/auth/zsdata/lqxx/js/app.c9746a4c.js";
const CHUNK_JS_URL = "https://zsxc.xidian.edu.cn/auth/zsdata/lqxx/js/lqcxjg.13a6cba5.js";

const SOURCE = {
  id: "official-xidian-national-2022-2025-school-admission",
  quality: "official-school-xidian-2022-2025-national-api-score-rank",
  schoolCode: "10701",
  schoolName: "西安电子科技大学",
  city: "陕西西安",
  publisher: "西安电子科技大学本科招生办公室",
  tags: ["陕西", "西安", "西安电子科技大学", "电子信息", "双一流", "211"],
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2022-2025-v3232-xidian.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2022-2025-v3232-xidian.mjs --use-cache --concurrency 4",
    "",
    "Imports 西安电子科技大学本科招生网 2022-2025 历年分数 official API data.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    useCache: false,
    concurrency: 4,
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
    if (arg === "--concurrency") {
      args.concurrency = Number(argv[++i]);
      if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 12) {
        throw new Error("Invalid --concurrency; expected 1..12");
      }
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
  if (!text || text === "/" || text === "-" || text === "—" || text === "--" || /^无$/.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseInteger(value) {
  const number = parseNumber(value);
  return number == null ? null : Math.trunc(number);
}

function slugify(value) {
  const text = normalizeText(value) || "blank";
  const ascii = text
    .replace(/[()（）/\\\s]+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "");
  return (ascii || sha256(text).slice(0, 10)).slice(0, 32);
}

function normalizeBatch(row) {
  const batch = normalizeText(row.pcmc);
  if (/本科二批/.test(batch)) return "本科二批";
  if (/本科一批|一批本科/.test(batch)) return "本科一批";
  if (/专科|高职/.test(batch)) return "专科批";
  if (/国家专项/.test(batch)) return "国家专项";
  if (/高校专项/.test(batch)) return "高校专项";
  if (/本科/.test(normalizeText(row.cclx))) return "本科批";
  return batch || normalizeText(row.cclx) || "官网未列批次";
}

function normalizeSubject(rawSubject, province) {
  const text = normalizeText(rawSubject);
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|不分文理|改革/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  return text || "官网未列科类";
}

function classifyAdmission(row) {
  const text = `${row.zslb || ""} ${row.pcmc || ""} ${row.klmc || ""} ${row.zymc || ""} ${row.zdf || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/.test(text)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练|单考单招|单独招生|单独考试|本科单招/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/藏族|少数民族|民族|预科|内高班|西藏班|区内|单列|南疆|定向|优师|公费/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function admissionSubtype(row) {
  const text = `${row.zslb || ""} ${row.pcmc || ""} ${row.klmc || ""} ${row.zymc || ""} ${row.zdf || ""}`;
  const values = [];
  for (const [pattern, label] of [
    [/中外合作|合作办学/, "中外合作办学"],
    [/国家专项/, "国家专项"],
    [/高校专项/, "高校专项"],
    [/藏族|少数民族|民族/, "民族/藏族"],
    [/区内/, "区内"],
    [/预科/, "预科"],
    [/定向/, "定向"],
    [/单列|南疆/, "单列/南疆"],
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|设计/, "艺术类"],
    [/体育|运动训练|单考单招|单独招生|单独考试|本科单招/, "体育类"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  return values.join("/") || "普通";
}

function requestText(url, options = {}, redirectCount = 0) {
  const target = new URL(url);
  const transport = target.protocol === "http:" ? http : https;
  const body = options.body == null ? null : Buffer.from(options.body);
  const headers = {
    "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
    accept: options.accept || "application/json,text/html,*/*;q=0.9",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
    referer: INDEX_URL,
    ...(options.headers || {}),
  };
  if (body) headers["content-length"] = String(body.length);
  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method: options.method || "GET",
        timeout: options.timeoutMs || 60_000,
        headers,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectCount >= 5) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          requestText(new URL(res.headers.location, target).toString(), options, redirectCount + 1).then(resolve, reject);
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
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout fetching ${url}`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getTextRaw(rawRoot, rawFile, url, useCache, accept) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs)) return fs.readFileSync(abs, "utf8");
  const text = await requestText(url, { accept });
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
  return text;
}

async function postJsonRaw(rawRoot, rawFile, url, body, useCache) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs)) {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  }
  const text = await requestText(url, {
    method: "POST",
    accept: "application/json,*/*;q=0.9",
    headers: {
      "content-type": "application/json;charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = JSON.parse(text);
  fs.writeFileSync(abs, `${JSON.stringify({ requestUrl: url, requestBody: body, response: json }, null, 2)}\n`);
  return { requestUrl: url, requestBody: body, response: json };
}

function bodyFromRaw(raw) {
  return raw.response || raw;
}

function queryRawRel(query, index) {
  const hash = stableId([query.sf, query.nf, query.klmc, query.xqmc, query.zslb]);
  return `xidian-${query.nf}-${slugify(query.sf)}-${slugify(query.klmc)}-${slugify(query.zslb)}-${index}-${hash}.json`;
}

function buildQueries(typeMap) {
  const keys = Object.keys(typeMap || {});
  const hasSpecificSubject = new Set();
  for (const key of keys) {
    const [sf, nf, klmc, xqmc] = key.split("_");
    if (klmc && klmc !== "全部") hasSpecificSubject.add([sf, nf, xqmc].join("\t"));
  }

  const queries = [];
  const skippedAllQueries = [];
  for (const key of keys) {
    const [sf, nf, klmc, xqmc] = key.split("_");
    if (!sf || !nf || !klmc || !xqmc) {
      skippedAllQueries.push({ key, issue: "bad_typeMap_key" });
      continue;
    }
    if (klmc === "全部" && hasSpecificSubject.has([sf, nf, xqmc].join("\t"))) {
      skippedAllQueries.push({ key, issue: "skip_all_subject_duplicate" });
      continue;
    }
    const categories = typeMap[key] || [];
    const concreteCategories = categories.filter((value) => value && value !== "全部");
    const selectedCategories = concreteCategories.length ? concreteCategories : categories;
    for (const zslb of selectedCategories) {
      queries.push({
        type: "lnfs",
        sf,
        nf,
        zslb,
        klmc,
        xqmc,
      });
    }
  }
  return { queries, skippedAllQueries };
}

function parseQuery(raw, rawRel, query, pageIndex) {
  const payload = bodyFromRaw(raw);
  const list = Array.isArray(payload.list) ? payload.list : [];
  const records = [];
  const warnings = [];
  if (payload.code !== 200 && payload.code !== "200") {
    return {
      records,
      summary: {
        pageKey: `xidian-${query.nf}-${query.sf}-${query.klmc}-${query.zslb}`,
        rawFile: `${RAW_DIR}/${rawRel}`,
        query,
        responseCode: payload.code,
        dataRows: 0,
        parsedRecords: 0,
        warnings: [{ issue: "query_failed", msg: payload.msg || null }],
        pageIndex,
      },
    };
  }

  let rowIndex = 0;
  for (const row of list) {
    rowIndex += 1;
    const year = parseInteger(row.nf);
    const province = normalizeText(row.sf);
    const subjectType = normalizeSubject(row.klmc, province);
    const majorName = normalizeText(row.zymc);
    const minScore = parseNumber(row.zdf);
    const maxScore = parseNumber(row.zgf);
    const avgScore = parseNumber(row.pjf);
    const minRank = parseInteger(row.zdfwc);
    const maxRank = parseInteger(row.zgfwc);

    if (!year || !province || !majorName || minScore == null || minScore <= 0) {
      warnings.push({ issue: minScore === 0 ? "skipped_zero_score_placeholder" : "skipped_missing_required_fields", rowIndex, row });
      continue;
    }
    if (maxScore != null && maxScore < minScore) {
      warnings.push({ issue: "maxScore_lt_minScore", rowIndex, maxScore, minScore, row });
    }

    const classification = classifyAdmission(row);
    const subtype = admissionSubtype(row);
    const rankUnavailable = !(minRank != null && minRank > 0);
    const record = {
      id: `xidian-${stableId([year, province, row.xqlx, row.zslb, row.klmc, row.xkkm, majorName, minScore, minRank, rowIndex])}`,
      year,
      province,
      city: SOURCE.city,
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      schoolTags: SOURCE.tags,
      campus: normalizeText(row.xqlx),
      batch: normalizeBatch(row),
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
      sourcePageUrl: INDEX_URL,
      sourceIndexUrl: INDEX_URL,
      sourcePageKey: `xidian-${query.nf}-${query.sf}-${query.klmc}-${query.zslb}`,
      sourcePageTitle: `${year}年${province}${SOURCE.schoolName}历年录取分数`,
      officialEvidencePath: `${RAW_DIR}/${rawRel}`,
      sourceProvinceRaw: normalizeText(row.sf),
      sourceCategoryRaw: normalizeText(row.zslb),
      sourceSubjectRaw: normalizeText(row.klmc),
      sourceCampusRaw: normalizeText(row.xqlx),
      sourceBatchRaw: normalizeText(row.pcmc),
      sourceLevelRaw: normalizeText(row.cclx),
      sourceMajorRaw: majorName,
      sourceElectiveRequirementRaw: normalizeText(row.xkkm),
      sourceMaxScoreRaw: normalizeText(row.zgf),
      sourceMinScoreRaw: normalizeText(row.zdf),
      sourceAverageScoreRaw: normalizeText(row.pjf),
      sourceMaxRankRaw: normalizeText(row.zgfwc),
      sourceMinRankRaw: normalizeText(row.zdfwc),
      rawRow: row,
      cautions: [
        "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
        rankUnavailable ? "源行未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。" : "源行公开最低分位次，但仍为单校专业边界，不能替代省级全量投档线。",
      ],
    };
    if (maxRank != null && maxRank > 0) record.sourceMaxRank = maxRank;
    if (normalizeText(row.xkkm) && normalizeText(row.xkkm) !== "/") record.electiveRequirement = normalizeText(row.xkkm);
    if (/中外合作|合作办学/.test(`${row.zslb || ""} ${majorName}`)) {
      record.cautions.push("中外合作办学方向需结合学费、校区和培养模式复核。");
    }
    if (province === "西藏") {
      record.cautions.push("西藏行仅为西安电子科技大学官网单校分数；普通、专项、藏族区内等类别分层保留，不参与省级全量闭合。");
    }
    records.push(record);
  }

  return {
    records,
    summary: {
      pageKey: `xidian-${query.nf}-${query.sf}-${query.klmc}-${query.zslb}`,
      year: parseInteger(query.nf),
      province: query.sf,
      subject: query.klmc,
      category: query.zslb,
      campus: query.xqmc,
      rawFile: `${RAW_DIR}/${rawRel}`,
      sha256: sha256(fs.readFileSync(projectPath(`${RAW_DIR}/${rawRel}`))),
      responseCode: payload.code,
      dataRows: list.length,
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

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));

  await getTextRaw(rawRoot, "xidian-lqxx-index.html", INDEX_URL, args.useCache, "text/html,*/*;q=0.9");
  await getTextRaw(rawRoot, "xidian-app.c9746a4c.js", APP_JS_URL, args.useCache, "application/javascript,text/plain,*/*;q=0.9");
  await getTextRaw(rawRoot, "xidian-lqcxjg.13a6cba5.js", CHUNK_JS_URL, args.useCache, "application/javascript,text/plain,*/*;q=0.9");

  const getTypeRaw = await postJsonRaw(rawRoot, "xidian-getType-lnfs.json", GET_TYPE_URL, { type: "lnfs" }, args.useCache);
  const globalCfgRaw = await postJsonRaw(rawRoot, "xidian-getGlobalCfg.json", GLOBAL_CFG_URL, {}, args.useCache);
  const displayCfgRaw = await postJsonRaw(rawRoot, "xidian-getlqxsgz-lnfs.json", DISPLAY_CFG_URL, { type: "lnfs" }, args.useCache);
  const typeMap = bodyFromRaw(getTypeRaw).typeMap || {};
  const { queries, skippedAllQueries } = buildQueries(typeMap);

  const rawRecords = [];
  const pageSummaries = [];
  const skippedPages = [];
  const pageResults = await mapLimit(queries, args.concurrency, async (query, index) => {
    const rawRel = queryRawRel(query, index + 1);
    try {
      const raw = await postJsonRaw(rawRoot, rawRel, GET_LIST_URL, query, args.useCache);
      const parsed = parseQuery(raw, rawRel, query, index + 1);
      return { parsed };
    } catch (error) {
      return {
        skipped: {
          pageIndex: index + 1,
          query,
          rawFile: `${RAW_DIR}/${rawRel}`,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
  for (let resultIndex = 0; resultIndex < pageResults.length; resultIndex += 1) {
    const result = pageResults[resultIndex];
    if (result?.parsed) {
      rawRecords.push(...result.parsed.records);
      pageSummaries.push(result.parsed.summary);
    } else if (result?.skipped) {
      skippedPages.push(result.skipped);
    } else {
      skippedPages.push({
        issue: "missing_page_result",
        query: queries[resultIndex] || null,
        rawFile: null,
        error: "Importer worker returned no result.",
      });
    }
  }

  const duplicateRecords = [];
  const records = [];
  const seenRecordKeys = new Set();
  for (const record of rawRecords) {
    const key = [
      record.year,
      record.province,
      record.campus,
      record.sourceCategoryRaw,
      record.subjectType,
      record.sourceElectiveRequirementRaw,
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
  const campusCounts = {};
  for (const record of records) {
    incrementCounter(formalScoreScopeCounts, record.formalScoreScope);
    incrementCounter(subjectTypeCounts, record.subjectType);
    incrementCounter(provinceCounts, record.province);
    incrementCounter(yearCounts, String(record.year));
    incrementCounter(admissionTypeCounts, record.admissionType);
    incrementCounter(admissionSubtypeCounts, record.admissionSubtype);
    incrementCounter(recordTypeCounts, record.dataType);
    incrementCounter(campusCounts, record.campus || "官网未列校区");
  }

  const rawFiles = [
    `${RAW_DIR}/xidian-lqxx-index.html`,
    `${RAW_DIR}/xidian-app.c9746a4c.js`,
    `${RAW_DIR}/xidian-lqcxjg.13a6cba5.js`,
    `${RAW_DIR}/xidian-getType-lnfs.json`,
    `${RAW_DIR}/xidian-getGlobalCfg.json`,
    `${RAW_DIR}/xidian-getlqxsgz-lnfs.json`,
    ...pageSummaries.map((summary) => summary.rawFile),
  ];

  const sourceNotes = [
    {
      id: SOURCE.id,
      publisher: SOURCE.publisher,
      title: "西安电子科技大学本科招生网历年分数 API（2022-2025）",
      url: INDEX_URL,
      quality: SOURCE.quality,
      usage:
        "学校官网单校分专业录取分数和位次边界；可用于西安电子科技大学候选边界复核、电子信息/计算机方向低中高分段趋势和西藏/新疆单校分数加厚，不替代任何省级教育考试院全量投档/录取表。",
      rawDir: RAW_DIR,
      rawFiles,
      parsedRecords: records.length,
      rawRecords: rawRecords.length,
      queryCount: queries.length,
      skippedAllQueries,
      skippedPages,
      duplicateRecordsSkipped: duplicateRecords.length,
      pageCount: pageSummaries.length,
      pageSummaries,
      configSha256: {
        index: sha256(fs.readFileSync(path.join(rawRoot, "xidian-lqxx-index.html"))),
        appJs: sha256(fs.readFileSync(path.join(rawRoot, "xidian-app.c9746a4c.js"))),
        chunkJs: sha256(fs.readFileSync(path.join(rawRoot, "xidian-lqcxjg.13a6cba5.js"))),
        getType: sha256(fs.readFileSync(path.join(rawRoot, "xidian-getType-lnfs.json"))),
        globalCfg: sha256(fs.readFileSync(path.join(rawRoot, "xidian-getGlobalCfg.json"))),
        displayCfg: sha256(fs.readFileSync(path.join(rawRoot, "xidian-getlqxsgz-lnfs.json"))),
      },
      globalCfg: bodyFromRaw(globalCfgRaw).globalCfg || null,
      displayFields: bodyFromRaw(displayCfgRaw).lqxsgz || [],
      provincesWithRecords: Object.keys(provinceCounts).sort(),
      provinceCount: Object.keys(provinceCounts).length,
      years: Object.keys(yearCounts).sort(),
      yearCounts,
      subjectTypeCounts,
      formalScoreScopeCounts,
      admissionTypeCounts,
      admissionSubtypeCounts,
      recordTypeCounts,
      campusCounts,
      scoreRange: range(records.map((record) => record.minScore)),
      rankRange: range(records.map((record) => record.minRank)),
      recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
      recordsWithRank: records.filter((record) => record.minRank != null).length,
      xizangRecords: records.filter((record) => record.province === "西藏").length,
      xinjiangRecords: records.filter((record) => record.province === "新疆").length,
      boundaryNotes: [
        "源表公开最低分位次的行保留 minRank；源表用 / 表示位次未公开的行统一标记 rankUnavailable=true。",
        "rankUnavailable=true 的行不生成假位次。",
        "school-official-only 只作单校候选边界复核，不参与 formalScoreMissingProvinces 省级全量闭合。",
        "国家专项、高校专项、藏族区内、艺术体育、定向等特殊路径按 special-path-only 隔离。",
      ],
    },
  ];

  const output = {
    dataset: "official-national-school-admission-2022-2025-v3232-xidian",
    generatedAt: new Date().toISOString(),
    scope: {
      years: Object.keys(yearCounts).sort(),
      provinceCount: Object.keys(provinceCounts).length,
      school: SOURCE.schoolName,
      queryCount: queries.length,
    },
    notes: sourceNotes[0].boundaryNotes,
    sourceNotes,
    records,
    audit: {
      totalRecords: records.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      duplicateRecords: duplicateRecords.slice(0, 50),
      queryCount: queries.length,
      skippedAllQueries,
      skippedPages,
      pageCount: pageSummaries.length,
      formalScoreScopeCounts,
      subjectTypeCounts,
      provinceCounts,
      yearCounts,
      admissionTypeCounts,
      admissionSubtypeCounts,
      recordTypeCounts,
      campusCounts,
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
        queryCount: queries.length,
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
