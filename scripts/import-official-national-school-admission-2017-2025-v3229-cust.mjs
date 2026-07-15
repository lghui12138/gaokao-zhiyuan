#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2017-2025-v3229-cust-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2017-2025-v3229-cust";
const BASE_URL = "https://zsb.cust.edu.cn/lnlqfscx";
const INDEX_URL = `${BASE_URL}/index.htm`;

const SOURCE = {
  id: "official-cust-national-2017-2025-school-admission",
  quality: "official-school-cust-2017-2025-national-html-score-only",
  schoolCode: "10186",
  schoolName: "长春理工大学",
  city: "长春",
  tags: ["吉林", "长春", "长春理工大学", "理工"],
};

const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

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

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2017-2025-v3229-cust.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2017-2025-v3229-cust.mjs --province xz --years 2025 --use-cache",
    "",
    "Imports 长春理工大学本科招生网 2017-2025 历年录取分数查询 static HTML pages.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    useCache: false,
    provinceCodes: PROVINCES.map(([code]) => code),
    years: YEARS,
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

function ensureDir(relOrAbs) {
  fs.mkdirSync(path.isAbsolute(relOrAbs) ? relOrAbs : path.join(PROJECT_ROOT, relOrAbs), { recursive: true });
}

function projectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 18);
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(value) {
  return htmlDecode(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>\s*<p[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCells(rowHtml) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => stripTags(match[1]))
    .filter((cell) => cell.length > 0);
}

function normalizeHeader(header) {
  return header
    .replace(/[（）()]/g, "")
    .replace(/类名称/g, "")
    .replace(/名称/g, "")
    .trim();
}

function indexOfHeader(headers, patterns) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(normalizeHeader(header))));
}

function parseNumber(value) {
  const text = String(value ?? "").replace(/[,，]/g, "").trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeSubject(rawSubject, rawBatch, province) {
  const text = `${rawSubject || ""} ${rawBatch || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|视觉传达|环境设计|设计学|动画|摄影/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/历史|文史|文科|(^|[-－—\s])文($|[-－—\s])|本科文|批本科文/.test(text)) return "历史类";
  if (/物理|理工|理科|(^|[-－—\s])理($|[-－—\s])|本科理|批本科理/.test(text)) return "物理类";
  if (/综合|不分文理|普通类/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) {
    return "综合";
  }
  return rawSubject || "官网未列科类";
}

function classifyAdmission(rawBatch, rawSubject, majorName) {
  const text = `${rawBatch || ""} ${rawSubject || ""} ${majorName || ""}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧|视觉传达|环境设计|设计学|动画|摄影/.test(text)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项|国家贫困专项|贫困专项/.test(text)) {
    return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  }
  if (/高校专项/.test(text)) {
    return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  }
  if (/民族|预科|内高班|西藏班|单列|南疆|定向|优师|公费师范|对口/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function normalizeBatch(rawBatch) {
  const text = String(rawBatch || "").trim();
  if (/^国家贫困专项[-－—]?[文理]?$/.test(text)) return "国家专项";
  if (/^国家专项[-－—]?[文理]?$/.test(text)) return "国家专项";
  return text
    .replace(/(第一批本科|一批本科|本科一批|第二批本科|二批本科|本科二批)(文|理)$/, "$1")
    .replace(/(本科批|普通本科批)(文|理)$/, "$1");
}

function admissionSubtype(rawBatch, majorName) {
  const text = `${rawBatch || ""} ${majorName || ""}`;
  const values = [];
  for (const [pattern, label] of [
    [/中外合作|合作办学/, "中外合作办学"],
    [/国家专项/, "国家专项"],
    [/高校专项/, "高校专项"],
    [/民族/, "民族/民族班"],
    [/预科/, "预科"],
    [/定向/, "定向"],
    [/内高班|西藏班/, "内地班/西藏班"],
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|戏剧/, "艺术类"],
    [/体育/, "体育类"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  return values.join("/") || "普通";
}

function sourcePageUrl(code, year) {
  return `${BASE_URL}/${code}/${year}/`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "text/html,application/xhtml+xml,application/xml,*/*;q=0.9",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      referer: INDEX_URL,
    },
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${buffer.toString("utf8", 0, 200)}`);
  return buffer.toString("utf8").replace(/\0/g, "");
}

async function loadPage(provinceInfo, year, rawRoot, useCache) {
  const rawRel = `cust-${provinceInfo.code}-${year}.html`;
  const rawPath = path.join(rawRoot, rawRel);
  const url = sourcePageUrl(provinceInfo.code, year);
  if (useCache && fs.existsSync(rawPath)) {
    const html = fs.readFileSync(rawPath, "utf8");
    return { html, rawRel, url, downloaded: false };
  }
  const html = await fetchText(url);
  if (html.length < 1000 || !/录取分数|最低分|专业/.test(html)) {
    throw new Error(`Unexpected CUST page content for ${url}`);
  }
  fs.writeFileSync(rawPath, html);
  return { html, rawRel, url, downloaded: true };
}

function parsePage(html, provinceInfo, year, rawRel, url, pageIndex) {
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => parseCells(match[0]));
  const records = [];
  const warnings = [];
  let header = null;
  let headerIndexes = null;
  let dataRows = 0;
  let skippedRows = 0;

  for (const cells of rows) {
    if (cells.length === 0) continue;
    if (cells.some((cell) => /最低分/.test(cell)) && cells.some((cell) => /最高分/.test(cell))) {
      header = cells;
      headerIndexes = {
        batch: indexOfHeader(header, [/批次|类别/]),
        subject: indexOfHeader(header, [/科类|科目|文理|类别/]),
        major: indexOfHeader(header, [/专业/]),
        control: indexOfHeader(header, [/省控线|控制线/]),
        max: indexOfHeader(header, [/最高分/]),
        min: indexOfHeader(header, [/最低分/]),
        avg: indexOfHeader(header, [/平均分|平均/]),
        count: indexOfHeader(header, [/录取人数|人数|计划数/]),
        time: indexOfHeader(header, [/录取时间|时间/]),
      };
      continue;
    }
    if (!header || !headerIndexes || cells.length < Math.min(header.length, 4)) {
      skippedRows += 1;
      continue;
    }
    const rawBatch = cells[headerIndexes.batch] || "";
    const rawSubject = headerIndexes.subject >= 0 ? cells[headerIndexes.subject] || "" : "";
    const majorName = headerIndexes.major >= 0 ? cells[headerIndexes.major] || "" : "";
    const rawMinScore = cells[headerIndexes.min] || "";
    const minScore = parseNumber(rawMinScore);
    const maxScore = headerIndexes.max >= 0 ? parseNumber(cells[headerIndexes.max]) : null;
    const avgScore = headerIndexes.avg >= 0 ? parseNumber(cells[headerIndexes.avg]) : null;
    const admissionCount = headerIndexes.count >= 0 ? parseNumber(cells[headerIndexes.count]) : null;
    if (!majorName || minScore == null) {
      skippedRows += 1;
      continue;
    }
    dataRows += 1;
    if (maxScore != null && maxScore < minScore) {
      warnings.push({ year, province: provinceInfo.province, row: cells, issue: "maxScore_lt_minScore" });
    }
    const subjectType = normalizeSubject(rawSubject, rawBatch, provinceInfo.province);
    const classification = classifyAdmission(rawBatch, rawSubject, majorName);
    const subtype = admissionSubtype(rawBatch, majorName);
    const sourceControlLineRaw = headerIndexes.control >= 0 ? cells[headerIndexes.control] || "" : "";
    const sourceAdmissionTimeRaw = headerIndexes.time >= 0 ? cells[headerIndexes.time] || "" : "";
    const record = {
      id: `cust-${stableId([year, provinceInfo.code, rawBatch, rawSubject, majorName, minScore, records.length])}`,
      year,
      province: provinceInfo.province,
      city: SOURCE.city,
      schoolCode: SOURCE.schoolCode,
      schoolName: SOURCE.schoolName,
      schoolTags: SOURCE.tags,
      batch: normalizeBatch(rawBatch) || "官网未列批次",
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
      minRank: null,
      minRankStart: null,
      minRankEnd: null,
      rankUnavailable: true,
      scoreOnly: true,
      scoreMetric: classification.admissionType === "艺术类" || classification.admissionType === "体育类" ? "综合/专业或文化分，按官网原表口径" : "高考文化分，按官网原表口径",
      sourceId: SOURCE.id,
      sourceQuality: SOURCE.quality,
      sourceUrl: url,
      sourcePageUrl: url,
      sourceIndexUrl: INDEX_URL,
      sourcePageKey: `cust-${provinceInfo.code}-${year}`,
      sourcePageTitle: `${year}年${provinceInfo.fullName}录取分数线`,
      officialEvidencePath: `${RAW_DIR}/${rawRel}`,
      sourceProvinceRaw: provinceInfo.fullName,
      sourceBatchRaw: rawBatch,
      sourceSubjectRaw: rawSubject,
      sourceMajorRaw: majorName,
      sourceControlLineRaw,
      sourceAdmissionTimeRaw,
      sourceMaxScoreRaw: headerIndexes.max >= 0 ? cells[headerIndexes.max] || "" : "",
      sourceMinScoreRaw: rawMinScore,
      sourceAverageScoreRaw: headerIndexes.avg >= 0 ? cells[headerIndexes.avg] || "" : "",
      sourceAdmissionCountRaw: headerIndexes.count >= 0 ? cells[headerIndexes.count] || "" : "",
      rawRow: cells,
      cautions: [
        "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
        "源表未公开最低位次，运行层不生成假位次或仅凭单校行输出录取概率。",
      ],
    };
    if (provinceInfo.province === "西藏") {
      record.cautions.push("西藏行仅为长春理工大学官网单校分数；A/B 类省控线保留为 sourceControlLineRaw，不参与省级全量闭合。");
    }
    if (/中外合作|合作办学/.test(`${rawBatch} ${majorName}`)) {
      record.cautions.push("中外合作办学或高收费方向需结合学费、校区和培养模式复核。");
    }
    records.push(record);
  }

  return {
    records,
    summary: {
      pageKey: `cust-${provinceInfo.code}-${year}`,
      year,
      province: provinceInfo.province,
      url,
      rawFile: `${RAW_DIR}/${rawRel}`,
      sha256: sha256(fs.readFileSync(projectPath(`${RAW_DIR}/${rawRel}`))),
      header,
      dataRows,
      parsedRecords: records.length,
      skippedRows,
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

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));

  const rawRecords = [];
  const pageSummaries = [];
  const skippedPages = [];
  const selectedProvinces = args.provinceCodes.map((code) => PROVINCE_BY_CODE.get(code));
  let pageIndex = 0;

  for (const year of args.years) {
    for (const provinceInfo of selectedProvinces) {
      pageIndex += 1;
      try {
        const { html, rawRel, url } = await loadPage(provinceInfo, year, rawRoot, args.useCache);
        const parsed = parsePage(html, provinceInfo, year, rawRel, url, pageIndex);
        rawRecords.push(...parsed.records);
        pageSummaries.push(parsed.summary);
      } catch (error) {
        skippedPages.push({
          year,
          province: provinceInfo.province,
          code: provinceInfo.code,
          url: sourcePageUrl(provinceInfo.code, year),
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
      record.majorName,
      record.minScore,
      record.maxScore,
      record.formalScoreScope,
      record.sourceControlLineRaw,
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

  const sourceNotes = [
    {
      id: SOURCE.id,
      publisher: "长春理工大学本科生招生办公室",
      title: "长春理工大学本科招生网历年录取分数查询（2017-2025）",
      url: INDEX_URL,
      quality: SOURCE.quality,
      usage:
        "学校官网单校分专业录取分数边界；可用于长春理工大学候选边界复核、跨年趋势和西藏单校分数加厚，不替代任何省级教育考试院全量投档/录取表。",
      rawDir: RAW_DIR,
      rawFiles: pageSummaries.map((summary) => summary.rawFile),
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
      recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
      recordsWithRank: records.filter((record) => record.minRank != null).length,
      boundaryNotes: [
        "源表未列最低位次，全部 rankUnavailable=true；不生成假位次。",
        "school-official-only 只作单校候选边界复核，不参与 formalScoreMissingProvinces 省级全量闭合。",
        "艺术、体育、专项、民族/预科、定向、内高班等行按 special-path-only 隔离。",
        "西藏 A/B 类控制线只保留 sourceControlLineRaw，不拆成考生类别录取概率。",
      ],
    },
  ];

  const output = {
    dataset: "official-national-school-admission-2017-2025-v3229-cust",
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
      pageWarnings: pageSummaries.flatMap((summary) => summary.warnings || []),
    },
  };

  fs.writeFileSync(projectPath(args.out), `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        out: args.out,
        records: records.length,
        pageCount: pageSummaries.length,
        skippedPages: skippedPages.length,
        formalScoreScopeCounts,
        subjectTypeCounts,
        provinceCount: Object.keys(provinceCounts).length,
        yearCounts,
        scoreRange: sourceNotes[0].scoreRange,
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
