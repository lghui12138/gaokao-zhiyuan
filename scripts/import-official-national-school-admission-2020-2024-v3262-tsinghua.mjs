#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2020-2024-v3262-tsinghua-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2020-2024-v3262-tsinghua";
const LIST_URL = "https://join-tsinghua.edu.cn/xxgk/lnlqfsx.htm";
const SOURCE = {
  id: "official-tsinghua-national-2020-2024-school-admission",
  quality: "official-school-tsinghua-2020-2024-national-html-score-only",
  schoolCode: "10003",
  schoolName: "清华大学",
  city: "北京",
  publisher: "清华大学招生办公室",
  tags: ["综合", "985", "211", "双一流", "强基", "北京"],
};
const YEARS = new Set([2024, 2023, 2022, 2021, 2020]);

const PROVINCE_ALIASES = [
  ["黑龙江", "黑龙江"],
  ["内蒙古", "内蒙古"],
  ["内蒙", "内蒙古"],
  ["吉林省", "吉林"],
  ["安徽", "安徽"],
  ["北京", "北京"],
  ["福建", "福建"],
  ["甘肃", "甘肃"],
  ["广东", "广东"],
  ["广西", "广西"],
  ["贵州", "贵州"],
  ["海南", "海南"],
  ["河北", "河北"],
  ["河南", "河南"],
  ["湖北", "湖北"],
  ["湖南", "湖南"],
  ["吉林", "吉林"],
  ["江苏", "江苏"],
  ["江西", "江西"],
  ["辽宁", "辽宁"],
  ["宁夏", "宁夏"],
  ["青海", "青海"],
  ["山东", "山东"],
  ["山西", "山西"],
  ["陕西", "陕西"],
  ["上海", "上海"],
  ["四川", "四川"],
  ["天津", "天津"],
  ["西藏", "西藏"],
  ["新疆", "新疆"],
  ["云南", "云南"],
  ["浙江", "浙江"],
  ["重庆", "重庆"],
];

const MAINLAND_PROVINCES = new Set(PROVINCE_ALIASES.map(([, province]) => province));
const INTEGRATED_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const PROVINCE_PATTERN = PROVINCE_ALIASES.map(([raw]) => raw).join("|");
const SECTION_PATTERNS = [
  /【[^】]*(?:统招|一批|本科|国家专项|定向|提前批|高考)[^】]*录取分数线[^】]*】/g,
  /提前批次录取分数线/g,
  /国家专项计划批次录取分数线/g,
  /本科一批次录取分数线/g,
  /提前批（[^）]+）录取分数线/g,
  /国家专项计划录取分数线/g,
  /本科一批次录取分数线/g,
  /提前批（[^）]+）/g,
  /国家专项计划/g,
  /高考统招/g,
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2020-2024-v3262-tsinghua.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2020-2024-v3262-tsinghua.mjs --use-cache",
    "",
    "Imports 清华大学本科招生网 2020-2024 official historical admission lines.",
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

function projectPath(relPath) {
  return path.resolve(PROJECT_ROOT, relPath);
}

function ensureDir(relOrAbs) {
  fs.mkdirSync(path.isAbsolute(relOrAbs) ? relOrAbs : projectPath(relOrAbs), { recursive: true });
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
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function htmlDecode(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&ensp;|&emsp;/gi, " ")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&mdash;/gi, "-")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function articleTextFromHtml(html) {
  const content = html.match(/<div[^>]*class=["'][^"']*v_news_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const article = content ? content[1] : html;
  return normalizeText(htmlDecode(article
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")));
}

async function requestText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: options.accept || "text/html,application/xhtml+xml,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: options.referer || LIST_URL,
        },
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 160)}`);
      }
      return body;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function getRaw(rawRoot, rawFile, url, useCache, options = {}) {
  const absPath = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(absPath)) return fs.readFileSync(absPath, "utf8");
  const text = await requestText(url, options);
  fs.writeFileSync(absPath, text);
  return text;
}

function pageLinksFromIndex(html) {
  const links = [];
  const anchorPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const text = normalizeText(htmlDecode(match[2].replace(/<[^>]+>/g, " ")));
    if (!/清华大学.*20\d{2}年.*录取分数线/.test(text)) continue;
    const year = Number(text.match(/20\d{2}/)?.[0]);
    if (!YEARS.has(year)) continue;
    links.push({
      year,
      text,
      url: new URL(match[1], LIST_URL).href,
    });
  }
  links.sort((a, b) => b.year - a.year);
  return links;
}

function cleanSectionLabel(value) {
  return normalizeText(String(value ?? "")
    .replace(/[【】]/g, "")
    .replace(/[：:]\s*$/g, ""));
}

function sectionSpans(text, year) {
  const matchesByIndex = new Map();
  for (const pattern of SECTION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const label = cleanSectionLabel(match[0]);
      const current = matchesByIndex.get(match.index);
      if (!current || match[0].length > current.length) {
        matchesByIndex.set(match.index, { index: match.index, length: match[0].length, label });
      }
    }
  }
  const markers = [...matchesByIndex.values()]
    .sort((a, b) => a.index - b.index)
    .filter((marker, index, all) => index === 0 || marker.index >= all[index - 1].index + all[index - 1].length);

  if (!markers.length) {
    return [{ section: year === 2020 ? "统招批录取分数线" : "官网未分节录取分数线", body: text }];
  }
  return markers.map((marker, index) => ({
    section: marker.label,
    body: text.slice(marker.index + marker.length, markers[index + 1]?.index ?? text.length),
  })).filter((section) => normalizeText(section.body));
}

function normalizeProvince(rawValue) {
  const cleaned = normalizeText(rawValue).replace(/省$/, "").replace(/[（(].*?[）)]/g, "");
  const hit = PROVINCE_ALIASES.find(([alias]) => cleaned === alias);
  return hit?.[1] ?? null;
}

function provinceSegments(body) {
  const cleaned = normalizeText(body).replace(/\n/g, "；");
  const colonPattern = new RegExp(`(?:^|[；;\\s])(${PROVINCE_PATTERN})(?:[（(][^）)]*[）)])?[：:]`, "g");
  const anchors = [...cleaned.matchAll(colonPattern)].map((match) => ({
    index: match.index + match[0].indexOf(match[1]),
    label: match[1],
    contentStart: match.index + match[0].length,
  }));
  if (anchors.length) {
    return anchors.map((anchor, index) => ({
      provinceRaw: anchor.label,
      province: normalizeProvince(anchor.label),
      text: cleaned.slice(anchor.contentStart, anchors[index + 1]?.index ?? cleaned.length),
    }));
  }

  const statementPattern = new RegExp(`^(${PROVINCE_PATTERN})(.+)$`);
  return cleaned.split(/[；;\n]+/).map((item) => normalizeText(item)).filter(Boolean).map((item) => {
    const match = item.match(statementPattern);
    if (!match) return null;
    return {
      provinceRaw: match[1],
      province: normalizeProvince(match[1]),
      text: match[2],
    };
  }).filter(Boolean);
}

function parseScore(value) {
  const match = normalizeText(value).match(/\d{2,3}(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeSubject(rawSubject, section, province) {
  const text = `${rawSubject} ${section}`;
  if (/艺术|美术|史论/.test(text)) return "艺术类";
  if (/历史|文科|文史/.test(text)) return "历史类";
  if (/理科|物理|物化|医学|临床|化学|医药/.test(text)) return "物理类";
  if (/不限|通用|综合/.test(text)) return "综合";
  if (/马克思主义理论/.test(text)) return "官网未列科类";
  if (INTEGRATED_PROVINCES.has(province)) return "综合";
  return "官网未列科类";
}

function defaultSubjectForSection(section) {
  if (/理科定向/.test(section)) return "理科定向";
  if (/马克思主义理论/.test(section)) return "马克思主义理论";
  if (/定向/.test(section)) return "定向";
  return "官网未列科类";
}

function mergeInheritedSubject(rawLabel, previousSubject) {
  const label = normalizeText(rawLabel).replace(/^[、,，;；]+/, "");
  if (!label && previousSubject) return previousSubject;
  if (/^[（(][^）)]*[）)]$/.test(label) && previousSubject) {
    const base = previousSubject.replace(/[（(][^）)]*[）)]/g, "");
    return `${base}${label}`;
  }
  return label;
}

function entriesFromSegment(segment, section) {
  const text = normalizeText(segment.text)
    .replace(/、/g, "；")
    .replace(/，(?=(?:文科|理科|物理|物化|历史|不限|通用|医学|临床|化学|艺术|马克思|定向|（|\(|$))/g, "；");
  const parts = text.split(/[；;]+/).map((item) => normalizeText(item)).filter(Boolean);
  const entries = [];
  let previousSubject = null;
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];
    const scoreMatches = [...part.matchAll(/(.*?)(\d{2,3}(?:\.\d+)?)\s*分/g)];
    for (let matchIndex = 0; matchIndex < scoreMatches.length; matchIndex += 1) {
      const match = scoreMatches[matchIndex];
      let rawSubject = mergeInheritedSubject(match[1], previousSubject);
      if (!rawSubject || rawSubject === "论") rawSubject = defaultSubjectForSection(section);
      if (/马克思主义理论/.test(section) && (rawSubject === "官网未列科类" || rawSubject === "论")) {
        rawSubject = "马克思主义理论";
      }
      const score = parseScore(match[2]);
      if (score == null) continue;
      previousSubject = rawSubject;
      entries.push({
        sourceSubjectRaw: rawSubject,
        sourceScoreRaw: match[0],
        minScore: score,
        part,
        partIndex,
        matchIndex,
      });
    }
  }
  return entries;
}

function normalizeBatch(section) {
  if (/国家专项/.test(section)) return "国家专项计划";
  if (/提前|定向|马克思|艺术史论/.test(section)) return "提前批";
  if (/统招|一批|本科|高考统招/.test(section)) return "本科一批/普通批";
  return section;
}

function classifyAdmission(section, subjectRaw) {
  const text = `${section} ${subjectRaw}`;
  if (/国家专项/.test(text)) return { admissionType: "国家专项", admissionSubtype: "国家专项", formalScoreScope: "special-path-only" };
  if (/马克思主义理论/.test(text)) return { admissionType: "马克思主义理论", admissionSubtype: "马克思主义理论", formalScoreScope: "special-path-only" };
  if (/艺术史论|艺术/.test(text)) return { admissionType: "艺术类", admissionSubtype: "艺术史论", formalScoreScope: "special-path-only" };
  if (/定向|提前/.test(text)) return { admissionType: "提前批/定向", admissionSubtype: /理科/.test(text) ? "理科定向" : "定向", formalScoreScope: "special-path-only" };
  if (/医学|临床|医药/.test(text)) return { admissionType: "医学类", admissionSubtype: "医学类", formalScoreScope: "school-official-only" };
  return { admissionType: "普通录取", admissionSubtype: "普通录取", formalScoreScope: "school-official-only" };
}

function scoreMetric(record) {
  if (record.province === "海南") return "海南高考转换分/标准分，按官网原文口径";
  if (record.province === "江苏" && record.year <= 2020) return "江苏旧高考总分口径，按官网原文口径";
  if (record.minScore > 750) return "高考省份特殊总分/转换分口径，按官网原文口径";
  return "高考文化分，按官网原文口径";
}

function baseCautions(record) {
  const cautions = [
    "本记录来自清华大学本科招生网官方历年录取分数线，是单校分省分批次最低分边界，不是省级教育考试院全量投档/录取分数表。",
    "源页未公开最低位次；推荐层不得生成假位次或仅凭本行分数单独输出录取概率。",
    "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，可用于清华大学候选边界复核，不替代同省省级正式投档表。",
  ];
  if (record.formalScoreScope === "special-path-only") {
    cautions.push("提前批、定向、国家专项、马克思主义理论、艺术史论等路径已隔离为 special-path-only，填报前必须核对当年省级批次、资格和招生章程。");
  }
  if (record.province === "海南" || record.minScore > 750) {
    cautions.push("高于750分的行保留海南等特殊总分/转换分口径，不与750满分省份直接横向比较。");
  }
  if (record.province === "江苏" && record.year <= 2020) {
    cautions.push("江苏2020及以前为旧高考总分口径，不能直接同750满分省份比较。");
  }
  if (/官网未列科类/.test(record.subjectType)) {
    cautions.push("源文未给出可安全归并的科类/专业组，本记录保留官网未列科类。");
  }
  return cautions;
}

function buildRecord({ year, pageUrl, pageTitle, rawRel, textRel, section, sectionIndex, segment, segmentIndex, entry }) {
  const batch = normalizeBatch(section);
  const classification = classifyAdmission(section, entry.sourceSubjectRaw);
  const subjectType = normalizeSubject(entry.sourceSubjectRaw, section, segment.province);
  const sourceSubjectRaw = entry.sourceSubjectRaw;
  const record = {
    id: `tsinghua-${stableId([year, segment.province, section, sourceSubjectRaw, entry.minScore, segmentIndex, entry.partIndex, entry.matchIndex])}`,
    province: segment.province,
    sourceProvinceRaw: segment.provinceRaw,
    year,
    subjectType,
    sourceSubjectRaw,
    batch,
    sourceBatchRaw: section,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "institution-admission",
    majorName: `${SOURCE.schoolName}${batch}录取分数（${sourceSubjectRaw}）`,
    majorGroup: `${SOURCE.schoolName}${year}${segment.province}${batch}|${sourceSubjectRaw}`,
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    minScore: entry.minScore,
    scoreOnly: true,
    rankUnavailable: true,
    minRank: null,
    minRankStart: null,
    minRankEnd: null,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: pageUrl,
    sourcePageUrl: pageUrl,
    sourceIndexUrl: LIST_URL,
    sourcePageTitle: pageTitle,
    sourcePageKey: `tsinghua-${year}`,
    officialEvidencePath: rawRel,
    officialTextEvidencePath: textRel,
    sourceMinScoreRaw: entry.sourceScoreRaw,
    rawTableSection: section,
    rawRow: {
      section,
      sectionIndex,
      segmentIndex,
      partIndex: entry.partIndex,
      matchIndex: entry.matchIndex,
      sourceProvinceRaw: segment.provinceRaw,
      sourceSubjectRaw,
      sourceScoreRaw: entry.sourceScoreRaw,
      sourceSegmentRaw: segment.text,
      sourcePartRaw: entry.part,
    },
  };
  record.scoreMetric = scoreMetric(record);
  record.cautions = baseCautions(record);
  return record;
}

function incrementCounter(target, key, by = 1) {
  target[key] = (target[key] || 0) + by;
}

function countRecords(records) {
  const counters = {
    byYear: {},
    byProvince: {},
    bySubjectType: {},
    byAdmissionType: {},
    byFormalScoreScope: {},
    byBatch: {},
  };
  for (const record of records) {
    incrementCounter(counters.byYear, String(record.year));
    incrementCounter(counters.byProvince, record.province);
    incrementCounter(counters.bySubjectType, record.subjectType);
    incrementCounter(counters.byAdmissionType, record.admissionType);
    incrementCounter(counters.byFormalScoreScope, record.formalScoreScope);
    incrementCounter(counters.byBatch, record.batch);
  }
  return counters;
}

function range(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric.length) return null;
  return { min: Math.min(...numeric), max: Math.max(...numeric) };
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];
  const skipped = [];
  for (const record of records) {
    const key = [
      record.year,
      record.province,
      record.batch,
      record.sourceBatchRaw,
      record.sourceSubjectRaw,
      record.minScore,
      record.sourcePageUrl,
    ].join("|");
    if (seen.has(key)) {
      skipped.push({ id: record.id, key, rawRow: record.rawRow });
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return { deduped, skipped };
}

function validate(records) {
  const ids = new Set();
  const duplicateIds = [];
  const badScores = [];
  const badRankFlags = [];
  const ordinaryOutliers = [];
  for (const record of records) {
    if (ids.has(record.id)) duplicateIds.push(record.id);
    ids.add(record.id);
    if (!MAINLAND_PROVINCES.has(record.province) || !(record.minScore > 0 && record.minScore <= 1000)) {
      badScores.push(record);
    }
    if (!(record.rankUnavailable === true && record.minRank == null && record.scoreOnly === true)) {
      badRankFlags.push(record);
    }
    if (record.formalScoreScope === "school-official-only" && record.minScore > 750 && record.province !== "海南") {
      ordinaryOutliers.push(record);
    }
  }
  return { duplicateIds, badScores, badRankFlags, ordinaryOutliers };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.join(rawRoot, "text"));
  ensureDir(path.dirname(projectPath(args.out)));

  const rawFiles = [];
  const indexHtml = await getRaw(rawRoot, "tsinghua-admission-lines-index.html", LIST_URL, args.useCache, { referer: "https://join-tsinghua.edu.cn/" });
  rawFiles.push(`${RAW_DIR}/tsinghua-admission-lines-index.html`);
  const pageLinks = pageLinksFromIndex(indexHtml);
  if (pageLinks.length !== YEARS.size) {
    throw new Error(`Expected ${YEARS.size} year pages, found ${pageLinks.length}: ${pageLinks.map((item) => item.year).join(",")}`);
  }

  const records = [];
  const pageSummaries = [];
  const skippedSegments = [];
  for (const page of pageLinks) {
    const rawFile = `tsinghua-admission-lines-${page.year}.html`;
    const rawRel = `${RAW_DIR}/${rawFile}`;
    const html = await getRaw(rawRoot, rawFile, page.url, args.useCache, { referer: LIST_URL });
    rawFiles.push(rawRel);
    const text = articleTextFromHtml(html);
    const textFile = `text/tsinghua-admission-lines-${page.year}.txt`;
    const textRel = `${RAW_DIR}/${textFile}`;
    fs.writeFileSync(path.join(rawRoot, textFile), `${text}\n`);
    rawFiles.push(textRel);

    const sections = sectionSpans(text, page.year);
    let pageRecordCount = 0;
    sections.forEach((section, sectionIndex) => {
      const segments = provinceSegments(section.body);
      segments.forEach((segment, segmentIndex) => {
        if (!segment.province) {
          skippedSegments.push({ year: page.year, section: section.section, reason: "province_not_mainland_or_unmapped", segment });
          return;
        }
        const entries = entriesFromSegment(segment, section.section);
        if (!entries.length) {
          skippedSegments.push({ year: page.year, section: section.section, reason: "no_score_entries", segment });
          return;
        }
        for (const entry of entries) {
          const record = buildRecord({
            year: page.year,
            pageUrl: page.url,
            pageTitle: page.text,
            rawRel,
            textRel,
            section: section.section,
            sectionIndex,
            segment,
            segmentIndex,
            entry,
          });
          records.push(record);
          pageRecordCount += 1;
        }
      });
    });
    pageSummaries.push({
      year: page.year,
      title: page.text,
      url: page.url,
      rawFile: rawRel,
      textFile: textRel,
      sha256: sha256File(path.join(rawRoot, rawFile)),
      textSha256: sha256File(path.join(rawRoot, textFile)),
      textLength: text.length,
      sections: sections.map((section) => section.section),
      records: pageRecordCount,
    });
  }

  const { deduped, skipped } = dedupeRecords(records);
  const validation = validate(deduped);
  if (validation.duplicateIds.length || validation.badScores.length || validation.badRankFlags.length || validation.ordinaryOutliers.length) {
    throw new Error(`Validation failed: ${JSON.stringify({
      duplicateIds: validation.duplicateIds.slice(0, 5),
      badScores: validation.badScores.slice(0, 5),
      badRankFlags: validation.badRankFlags.slice(0, 5),
      ordinaryOutliers: validation.ordinaryOutliers.slice(0, 5),
    }, null, 2)}`);
  }

  const counters = countRecords(deduped);
  const sourceNote = {
    id: SOURCE.id,
    title: "清华大学本科招生网：2020-2024年各省各批次录取分数线",
    publisher: SOURCE.publisher,
    url: LIST_URL,
    pageUrls: Object.fromEntries(pageLinks.map((page) => [String(page.year), page.url])),
    quality: SOURCE.quality,
    usage: "抽取清华大学本科招生网官方历年录取分数线中2020-2024年本科一批/普通批、统招、提前批/定向、国家专项、马克思主义理论、艺术史论等分省最低分；全部为学校官网单校分数线，源页未公开最低位次，普通统招仅作 school-official-only 候选边界，专项和提前等路径隔离为 special-path-only。",
    rawDir: RAW_DIR,
    rawFiles,
    parsedRecords: deduped.length,
    sourceRows: records.length,
    skippedSemanticDuplicates: skipped.length,
    skippedSegments: skippedSegments.length,
    provinceCount: Object.keys(counters.byProvince).length,
    ordinarySchoolOfficialRecords: counters.byFormalScoreScope["school-official-only"] || 0,
    specialPathRecords: counters.byFormalScoreScope["special-path-only"] || 0,
    rankUnavailableRecords: deduped.length,
    scoreRange: range(deduped.map((record) => record.minScore)),
    ...counters,
    pageSummaries,
    skippedSemanticDuplicatesDetail: skipped.slice(0, 20),
    skippedSegmentsDetail: skippedSegments.slice(0, 20),
    cautions: [
      "学校官网单校分数线不替代省级教育考试院全量投档/录取表。",
      "源页未公开最低位次；所有记录保持 rankUnavailable=true，不生成假位次。",
      "2020及以前江苏、海南等特殊总分/转换分口径按官网原文保留，不与750满分省份直接比较。",
      "提前批、定向、国家专项、马克思主义理论、艺术史论等路径保持 special-path-only。",
    ],
  };

  const payload = {
    dataset: "gaokao-zhiyuan-site-admission-score-layer",
    generatedAt: new Date().toISOString(),
    records: deduped,
    sourceNotes: [sourceNote],
    qa: {
      duplicateIds: validation.duplicateIds.length,
      badScores: validation.badScores.length,
      badRankFlags: validation.badRankFlags.length,
      ordinaryOutliers: validation.ordinaryOutliers.length,
      skippedSemanticDuplicates: skipped.length,
      skippedSegments: skippedSegments.length,
      notes: [
        "All records are score-only school-official historical admission lines.",
        "No rank values are fabricated; rankUnavailable=true for every record.",
        "High Hainan conversion-score rows are preserved with scoreMetric cautions.",
      ],
    },
  };

  fs.writeFileSync(projectPath(args.out), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    out: args.out,
    sourceId: SOURCE.id,
    records: deduped.length,
    sourceRows: records.length,
    skippedSemanticDuplicates: skipped.length,
    skippedSegments: skippedSegments.length,
    rawFiles: rawFiles.length,
    years: Object.keys(counters.byYear).sort(),
    provinces: Object.keys(counters.byProvince).length,
    formalScoreScope: counters.byFormalScoreScope,
    subjectTypes: counters.bySubjectType,
    admissionTypes: counters.byAdmissionType,
    scoreRange: sourceNote.scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
