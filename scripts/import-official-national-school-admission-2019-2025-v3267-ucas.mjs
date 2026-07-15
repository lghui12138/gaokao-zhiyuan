#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2019-2025-v3267-ucas-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2019-2025-v3267-ucas";
const OFFICIAL_HOME_URL = "https://admission.ucas.ac.cn/";
const FRACTIONAL_PATH = "/info/FractionalLine/b68c5086-59cb-413f-8edf-5723f2902baa";
const INDEX_PAGE_URL = `${OFFICIAL_HOME_URL.replace(/\/$/, "")}${FRACTIONAL_PATH}`;

const SOURCE = {
  id: "official-ucas-national-2019-2025-institution-admission",
  quality: "official-school-ucas-2019-2025-national-html-institution-score-only",
  schoolCode: "14430",
  schoolName: "中国科学院大学",
  city: "北京石景山",
  publisher: "中国科学院大学招生信息网",
  tags: ["北京", "石景山", "中国科学院大学", "双一流"],
};

const PROVINCE_MAP = new Map([
  ["北京市", "北京"], ["北京", "北京"],
  ["天津市", "天津"], ["天津", "天津"],
  ["河北省", "河北"], ["河北", "河北"],
  ["山西省", "山西"], ["山西", "山西"],
  ["内蒙古自治区", "内蒙古"], ["内蒙古", "内蒙古"],
  ["辽宁省", "辽宁"], ["辽宁", "辽宁"],
  ["吉林省", "吉林"], ["吉林", "吉林"],
  ["黑龙江省", "黑龙江"], ["黑龙江", "黑龙江"],
  ["上海市", "上海"], ["上海", "上海"],
  ["江苏省", "江苏"], ["江苏", "江苏"],
  ["浙江省", "浙江"], ["浙江", "浙江"],
  ["安徽省", "安徽"], ["安徽", "安徽"],
  ["福建省", "福建"], ["福建", "福建"],
  ["江西省", "江西"], ["江西", "江西"],
  ["山东省", "山东"], ["山东", "山东"],
  ["河南省", "河南"], ["河南", "河南"],
  ["湖北省", "湖北"], ["湖北", "湖北"],
  ["湖南省", "湖南"], ["湖南", "湖南"],
  ["广东省", "广东"], ["广东", "广东"],
  ["广西壮族自治区", "广西"], ["广西", "广西"],
  ["海南省", "海南"], ["海南", "海南"],
  ["重庆市", "重庆"], ["重庆", "重庆"],
  ["四川省", "四川"], ["四川", "四川"],
  ["贵州省", "贵州"], ["贵州", "贵州"],
  ["云南省", "云南"], ["云南", "云南"],
  ["西藏自治区", "西藏"], ["西藏", "西藏"],
  ["陕西省", "陕西"], ["陕西", "陕西"],
  ["甘肃省", "甘肃"], ["甘肃", "甘肃"],
  ["青海省", "青海"], ["青海", "青海"],
  ["宁夏回族自治区", "宁夏"], ["宁夏", "宁夏"],
  ["新疆维吾尔自治区", "新疆"], ["新疆", "新疆"],
]);

const MAINLAND_PROVINCES = new Set(PROVINCE_MAP.values());

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2019-2025-v3267-ucas.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2019-2025-v3267-ucas.mjs --use-cache",
    "",
    "Imports 中国科学院大学招生信息网 official 2019-2025 historical institution admission lines.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false, maxPages: 1200 };
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
    if (arg === "--max-pages") {
      args.maxPages = Number(argv[++i]);
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

function projectPath(relPath) {
  return path.resolve(PROJECT_ROOT, relPath);
}

function ensureDir(relOrAbs) {
  fs.mkdirSync(path.isAbsolute(relOrAbs) ? relOrAbs : projectPath(relOrAbs), { recursive: true });
}

function writeJson(relPath, value) {
  fs.writeFileSync(projectPath(relPath), `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(absPath) {
  return sha256(fs.readFileSync(absPath));
}

function stableId(parts, length = 18) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, length);
}

function normalizeText(value) {
  return htmlDecode(String(value ?? ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n\f\v]+/g, " ")
    .trim();
}

function htmlDecode(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&ensp;|&emsp;/gi, " ")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&mdash;|&ndash;/gi, "-")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripTags(value) {
  return normalizeText(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " "));
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

async function requestText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || INDEX_PAGE_URL,
        },
        signal: AbortSignal.timeout(options.timeoutMs || 180_000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 240)}`);
      return text.replace(/\0/g, "");
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
    }
  }
  throw lastError;
}

function normalizeUrl(value, baseUrl = INDEX_PAGE_URL) {
  const url = new URL(value || "", baseUrl);
  url.hash = "";
  url.search = "";
  const href = url.href.replace(/\/$/, "");
  return href;
}

function isFractionalLineUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === OFFICIAL_HOME_URL.replace(/\/$/, "") && url.pathname.startsWith(FRACTIONAL_PATH);
  } catch {
    return false;
  }
}

function extractFractionalLinks(html, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = normalizeUrl(match[1], baseUrl);
    if (isFractionalLineUrl(href)) links.push(href);
  }
  return [...new Set(links)].sort();
}

function rawFileForUrl(url) {
  const parsed = new URL(url);
  if (parsed.pathname === FRACTIONAL_PATH) return "ucas-index.html";
  return `ucas-${stableId([normalizeUrl(url)], 14)}.html`;
}

async function getRawPage(rawRoot, url, useCache) {
  const rawFile = rawFileForUrl(url);
  const absPath = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(absPath) && fs.statSync(absPath).size > 0) {
    return { rawFile, html: fs.readFileSync(absPath, "utf8"), fromCache: true };
  }
  const html = await requestText(url);
  fs.writeFileSync(absPath, html.endsWith("\n") ? html : `${html}\n`);
  return { rawFile, html, fromCache: false };
}

function extractTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractRows(html) {
  const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || "";
  const rows = [];
  for (const tr of tbody.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1]));
    if (cells.length >= 6) rows.push(cells.slice(0, 6));
  }
  return rows;
}

function normalizeProvince(rawProvince) {
  const province = normalizeText(rawProvince);
  return PROVINCE_MAP.get(province) || province;
}

function normalizeSubject(rawSubject) {
  const text = normalizeText(rawSubject);
  if (/文科|文史|历史/.test(text)) return "历史类";
  if (/理科|理工|物理/.test(text)) return "物理类";
  if (/综合|改革|不分文理|不限/.test(text)) return "综合";
  return text || "官网未列科类";
}

function normalizeBatch(planType) {
  const text = normalizeText(planType);
  if (/国家专项/.test(text)) return "国家专项批";
  if (/综合评价/.test(text)) return "综合评价";
  return "本科批";
}

function classifyAdmission(planType) {
  const text = normalizeText(planType);
  if (/综合评价/.test(text)) {
    return { admissionType: "综合评价", admissionSubtype: "综合评价", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) {
    return { admissionType: "国家专项", admissionSubtype: "国家专项", formalScoreScope: "special-path-only" };
  }
  if (/港澳台|内地|西藏班|新疆高中班|专项|提前|强基|特殊/.test(text)) {
    return { admissionType: "特殊路径", admissionSubtype: text || "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: text || "统考", formalScoreScope: "school-official-only" };
}

function scoreMetric(planType) {
  const text = normalizeText(planType);
  if (/综合评价/.test(text)) return "综合评价折算分，按官网原表口径";
  return "高考文化分，按官网原表口径";
}

function electiveRequirement(rawElective) {
  const text = normalizeText(rawElective).replace(/＋/g, "+");
  return text || null;
}

function buildRecord(row, context) {
  const [yearRaw, provinceRaw, subjectRaw, planTypeRaw, electiveRaw, minScoreRaw] = row;
  const year = parseInteger(yearRaw);
  const province = normalizeProvince(provinceRaw);
  const minScore = parseNumber(minScoreRaw);
  if (!year || !MAINLAND_PROVINCES.has(province)) {
    return { record: null, warning: { issue: "skip_non_mainland_or_missing_year", sourcePageUrl: context.url, rawFile: context.rawRel, row } };
  }
  if (minScore == null || minScore <= 0) {
    return { record: null, warning: { issue: "skipped_missing_required_score", sourcePageUrl: context.url, rawFile: context.rawRel, row } };
  }
  const planType = normalizeText(planTypeRaw);
  const elective = electiveRequirement(electiveRaw);
  const subjectType = normalizeSubject(subjectRaw);
  const classification = classifyAdmission(planType);
  const majorName = `${SOURCE.schoolName}录取最低分`;
  const record = {
    id: `ucas-line-${stableId([year, province, subjectRaw, planType, elective, minScore])}`,
    year,
    province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    campus: "",
    batch: normalizeBatch(planType),
    subjectType,
    collegeName: "",
    majorName,
    dataType: "institution-admission",
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    schoolOfficialScope: true,
    minScore,
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    rankUnavailable: true,
    scoreOnly: true,
    scoreMetric: scoreMetric(planType),
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: context.url,
    sourcePageUrl: context.url,
    sourceIndexUrl: INDEX_PAGE_URL,
    sourcePageKey: `ucas-${year}-${province}-${subjectRaw}-${planType}-${elective || "no-elective"}`,
    sourcePageTitle: `${year}年${province}${SOURCE.schoolName}${planType || "录取"}最低分`,
    officialEvidencePath: `${RAW_DIR}/${context.rawRel}`,
    sourceProvinceRaw: normalizeText(provinceRaw),
    sourceProvinceNormalized: province,
    sourceCategoryRaw: planType,
    sourceSubjectRaw: normalizeText(subjectRaw),
    sourceBatchRaw: planType,
    sourceMajorRaw: majorName,
    sourceMajorGroupRaw: elective || "",
    sourceElectiveRequirementRaw: elective || "",
    sourceMinScoreRaw: normalizeText(minScoreRaw),
    sourceMinRankRaw: "",
    rawRow: {
      year: normalizeText(yearRaw),
      province: normalizeText(provinceRaw),
      subject: normalizeText(subjectRaw),
      planType,
      electiveRequirement: elective || "",
      minScore: normalizeText(minScoreRaw),
      sourcePageUrl: context.url,
      rawFile: context.rawRel,
    },
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      "源行未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。",
    ],
  };
  if (elective) {
    record.electiveRequirement = elective;
    record.majorGroup = `${SOURCE.schoolName}${province}|${planType || "统考"}|${elective}`;
  }
  if (classification.formalScoreScope === "special-path-only") {
    record.candidateCategory = classification.admissionSubtype;
    record.cautions.push("综合评价、国家专项等路径已隔离为 special-path-only，填报前必须核对当年资格、批次和招生章程。");
  }
  return { record, warning: null };
}

function incrementCounter(target, key, by = 1) {
  target[key] = (target[key] || 0) + by;
}

function range(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric.length) return null;
  return { min: Math.min(...numeric), max: Math.max(...numeric) };
}

function countRecords(records) {
  const counters = {
    formalScoreScopeCounts: {},
    subjectTypeCounts: {},
    provinceCounts: {},
    yearCounts: {},
    admissionTypeCounts: {},
    admissionSubtypeCounts: {},
    recordTypeCounts: {},
    batchCounts: {},
  };
  for (const record of records) {
    incrementCounter(counters.formalScoreScopeCounts, record.formalScoreScope);
    incrementCounter(counters.subjectTypeCounts, record.subjectType);
    incrementCounter(counters.provinceCounts, record.province);
    incrementCounter(counters.yearCounts, String(record.year));
    incrementCounter(counters.admissionTypeCounts, record.admissionType);
    incrementCounter(counters.admissionSubtypeCounts, record.admissionSubtype);
    incrementCounter(counters.recordTypeCounts, record.dataType);
    incrementCounter(counters.batchCounts, record.batch);
  }
  return counters;
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];
  const duplicates = [];
  for (const record of records) {
    const key = [
      record.year,
      record.province,
      record.sourceSubjectRaw,
      record.sourceCategoryRaw,
      record.sourceElectiveRequirementRaw,
      record.minScore,
    ].join("\t");
    if (seen.has(key)) {
      duplicates.push(record);
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return { deduped, duplicates };
}

function rawTextSummary(records, counters, crawlStats) {
  const lines = [
    "中国科学院大学招生信息网历年分数线",
    `records=${records.length}`,
    `crawledPages=${crawlStats.crawledPages}`,
    `pagesWithRows=${crawlStats.pagesWithRows}`,
    `years=${Object.keys(counters.yearCounts).sort().join(",")}`,
    `provinces=${Object.keys(counters.provinceCounts).sort().join(",")}`,
    `subjects=${Object.keys(counters.subjectTypeCounts).sort().join(",")}`,
    `formalScoreScope=${JSON.stringify(counters.formalScoreScopeCounts)}`,
  ];
  for (const record of records.slice(0, 180)) {
    lines.push([record.year, record.province, record.subjectType, record.sourceCategoryRaw, record.sourceElectiveRequirementRaw, record.minScore, record.formalScoreScope, record.sourcePageUrl].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

async function crawlOfficialPages(rawRoot, useCache, maxPages) {
  const queue = [normalizeUrl(INDEX_PAGE_URL)];
  const queued = new Set(queue);
  const seen = new Set();
  const pages = [];
  const rows = [];
  const failures = [];
  while (queue.length) {
    if (seen.size >= maxPages) throw new Error(`Reached max page guard (${maxPages}) while crawling ${INDEX_PAGE_URL}`);
    const url = queue.shift();
    queued.delete(url);
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const { rawFile, html, fromCache } = await getRawPage(rawRoot, url, useCache);
      if (!/中国科学院大学招生信息网/.test(html) || !/历年分数线/.test(html)) {
        failures.push({ url, rawFile, issue: "unexpected_page_identity", title: extractTitle(html) });
        continue;
      }
      const pageRows = extractRows(html);
      const rawRel = rawFile;
      pages.push({
        url,
        rawRel: `${RAW_DIR}/${rawRel}`,
        rawFile,
        title: extractTitle(html),
        rows: pageRows.length,
        fromCache,
      });
      for (const row of pageRows) rows.push({ row, url, rawRel });
      for (const link of extractFractionalLinks(html, url)) {
        if (!seen.has(link) && !queued.has(link)) {
          queue.push(link);
          queued.add(link);
        }
      }
    } catch (error) {
      failures.push({ url, issue: "fetch_failed", message: error.message });
    }
  }
  return { pages, rows, failures };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));
  ensureDir(path.join(rawRoot, "text"));

  const crawl = await crawlOfficialPages(rawRoot, args.useCache, args.maxPages);
  if (!crawl.rows.length) {
    throw new Error("No official UCAS table rows were found; refusing to import an empty source.");
  }

  const warnings = [];
  const rawRecords = [];
  for (const item of crawl.rows) {
    const { record, warning } = buildRecord(item.row, { url: item.url, rawRel: item.rawRel.replace(`${RAW_DIR}/`, "") });
    if (record) rawRecords.push(record);
    if (warning) warnings.push(warning);
  }

  const { deduped: records, duplicates } = dedupeRecords(rawRecords);
  if (!records.length) throw new Error("No valid UCAS records after filtering; refusing to write import.");

  const counters = countRecords(records);
  const crawlStats = {
    crawledPages: crawl.pages.length,
    pagesWithRows: crawl.pages.filter((page) => page.rows > 0).length,
    totalSourceRows: crawl.rows.length,
    validRawRecords: rawRecords.length,
    duplicateRecordsSkipped: duplicates.length,
    skippedRows: warnings.length,
    fetchFailures: crawl.failures.length,
  };

  const crawlIndexRel = `${RAW_DIR}/ucas-fractional-line-crawl-index.json`;
  writeJson(crawlIndexRel, {
    generatedAt: new Date().toISOString(),
    source: INDEX_PAGE_URL,
    pages: crawl.pages,
    failures: crawl.failures,
    stats: crawlStats,
  });

  const textRel = `${RAW_DIR}/text/ucas-fractional-line-2019-2025.txt`;
  fs.writeFileSync(projectPath(textRel), rawTextSummary(records, counters, crawlStats));

  const rawFiles = [
    ...crawl.pages.map((page) => page.rawRel),
    crawlIndexRel,
    textRel,
  ].sort();
  const rawSha256 = Object.fromEntries(rawFiles.map((file) => [path.basename(file), sha256File(projectPath(file))]));
  const years = Object.keys(counters.yearCounts).sort();
  const sourceNote = {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "中国科学院大学招生信息网：2019-2025年历年分数线",
    url: INDEX_PAGE_URL,
    indexUrl: INDEX_PAGE_URL,
    officialNavigationUrl: OFFICIAL_HOME_URL,
    quality: SOURCE.quality,
    usage:
      "抽取中国科学院大学招生信息网官方历年分数线服务端渲染 HTML 表，字段包括显示年份、省份、科类、计划类型、选考科目和最低分；统考行作为 school-official-only 单校候选边界，国家专项和综合评价隔离为 special-path-only；源页未公开最低位次。",
    rawDir: RAW_DIR,
    rawFiles,
    rawSha256,
    parsedRecords: records.length,
    crawledPages: crawlStats.crawledPages,
    pagesWithRows: crawlStats.pagesWithRows,
    sourceRows: crawl.rows.length,
    rawRecords: rawRecords.length,
    duplicateRecordsSkipped: duplicates.length,
    skippedRows: warnings,
    fetchFailures: crawl.failures,
    provinceCount: Object.keys(counters.provinceCounts).length,
    provincesWithRecords: Object.keys(counters.provinceCounts).sort(),
    years,
    byYear: counters.yearCounts,
    byProvince: counters.provinceCounts,
    bySubjectType: counters.subjectTypeCounts,
    byBatch: counters.batchCounts,
    byFormalScoreScope: counters.formalScoreScopeCounts,
    byAdmissionType: counters.admissionTypeCounts,
    byAdmissionSubtype: counters.admissionSubtypeCounts,
    byRecordType: counters.recordTypeCounts,
    scoreRange: range(records.map((record) => record.minScore)),
    recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
    recordsWithRank: records.filter((record) => record.minRank != null).length,
    lowScoreRecordsUnder150: records.filter((record) => record.minScore < 150).length,
    lowScoreRecordsUnder200: records.filter((record) => record.minScore < 200).length,
    ordinaryOutlierRecords: records.filter((record) => record.formalScoreScope === "school-official-only" && record.minScore > 750 && record.province !== "海南").length,
    cautions: [
      "学校官网单校最低分不替代省级教育考试院全量投档/录取表。",
      "源行未公开最低位次；缺位次行不生成假位次。",
      "国家专项、综合评价等路径保持 special-path-only。",
      "官网筛选页中无可用最低分的空页只进入 crawl index 审计，不补造分数。",
    ],
  };

  const output = {
    dataset: "official-national-school-admission-2019-2025-v3267-ucas",
    generatedAt: new Date().toISOString(),
    scope: {
      years,
      provinceCount: sourceNote.provinceCount,
      school: SOURCE.schoolName,
      crawledPages: crawlStats.crawledPages,
      pagesWithRows: crawlStats.pagesWithRows,
      sourceRows: crawl.rows.length,
    },
    notes: sourceNote.cautions,
    sourceNotes: [sourceNote],
    records,
    audit: {
      totalRecords: records.length,
      crawledPages: crawlStats.crawledPages,
      pagesWithRows: crawlStats.pagesWithRows,
      sourceRows: crawl.rows.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicates.length,
      duplicateRecords: duplicates.slice(0, 50),
      skippedRows: warnings,
      fetchFailures: crawl.failures,
      ...counters,
      scoreRange: sourceNote.scoreRange,
      recordsRankUnavailable: sourceNote.recordsRankUnavailable,
      recordsWithRank: sourceNote.recordsWithRank,
      lowScoreRecordsUnder150: sourceNote.lowScoreRecordsUnder150,
      lowScoreRecordsUnder200: sourceNote.lowScoreRecordsUnder200,
      ordinaryOutlierRecords: sourceNote.ordinaryOutlierRecords,
    },
  };

  writeJson(args.out, output);
  console.log(
    JSON.stringify(
      {
        out: args.out,
        sourceId: SOURCE.id,
        records: records.length,
        crawledPages: crawlStats.crawledPages,
        pagesWithRows: crawlStats.pagesWithRows,
        sourceRows: crawl.rows.length,
        rawRecords: rawRecords.length,
        duplicateRecordsSkipped: duplicates.length,
        skippedRows: warnings.length,
        fetchFailures: crawl.failures.length,
        rawFiles: rawFiles.length,
        years: sourceNote.years,
        provinceCount: sourceNote.provinceCount,
        formalScoreScopeCounts: counters.formalScoreScopeCounts,
        subjectTypeCounts: counters.subjectTypeCounts,
        admissionTypeCounts: counters.admissionTypeCounts,
        scoreRange: sourceNote.scoreRange,
        recordsWithRank: sourceNote.recordsWithRank,
        recordsRankUnavailable: sourceNote.recordsRankUnavailable,
        lowScoreRecordsUnder150: sourceNote.lowScoreRecordsUnder150,
        ordinaryOutlierRecords: sourceNote.ordinaryOutlierRecords,
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
