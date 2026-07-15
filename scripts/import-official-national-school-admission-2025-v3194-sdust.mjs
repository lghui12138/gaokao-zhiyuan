#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3194-sdust-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3194-sdust";
const SITE_BASE = "https://zs.sdust.edu.cn";
const LIST_URL = `${SITE_BASE}/lnfs.htm`;
const OUTSIDE_URL = `${SITE_BASE}/info/1059/4475.htm`;
const SHANDONG_URL = `${SITE_BASE}/info/1059/4474.htm`;
const SOURCE = {
  id: "official-sdust-national-2025-school-admission",
  quality: "official-school-sdust-2025-national-pdf-major-score-rank",
  schoolCode: "10424",
  schoolName: "山东科技大学",
  city: "青岛",
  tags: ["理工"],
};

const EXPECTED_PDFS = [
  {
    key: "outside",
    pageUrl: OUTSIDE_URL,
    pageRaw: "sdust-2025-outside.html",
    pdfRaw: "pdf/sdust-2025-outside-province-major-score.pdf",
    textRaw: "text/sdust-2025-outside-province-major-score.txt",
    title: "山东科技大学2025年本科录取情况统计表（省外）",
    parser: "outside",
  },
  {
    key: "shandong-ordinary",
    pageUrl: SHANDONG_URL,
    pageRaw: "sdust-2025-shandong.html",
    pdfRaw: "pdf/sdust-2025-shandong-ordinary-major-score-rank.pdf",
    textRaw: "text/sdust-2025-shandong-ordinary-major-score-rank.txt",
    title: "2025年普通类常规批第1次志愿录取情况表（山东省）",
    parser: "shandongOrdinary",
  },
  {
    key: "shandong-comprehensive",
    pageUrl: SHANDONG_URL,
    pageRaw: "sdust-2025-shandong.html",
    pdfRaw: "pdf/sdust-2025-shandong-comprehensive-evaluation.pdf",
    textRaw: "text/sdust-2025-shandong-comprehensive-evaluation.txt",
    title: "2025年综合评价本科录取情况统计表（山东省）",
    parser: "shandongComprehensive",
  },
  {
    key: "shandong-art",
    pageUrl: SHANDONG_URL,
    pageRaw: "sdust-2025-shandong.html",
    pdfRaw: "pdf/sdust-2025-shandong-art-composite-score.pdf",
    textRaw: "text/sdust-2025-shandong-art-composite-score.txt",
    title: "2025年艺术类本科录取情况统计表（山东省）",
    parser: "shandongArt",
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3194-sdust.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3194-sdust.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source HTML/PDF and generated pdftotext output",
    "",
    "Imports Shandong University of Science and Technology official 2025 national PDF major score tables.",
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
    throw new Error("Refusing to run PDF/text extraction from /Volumes/mac_2T; run this importer from the internal APFS project copy.");
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveProjectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 16);
}

async function fetchBuffer(url, referer = LIST_URL) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "text/html,application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
      referer,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function downloadText(rawRoot, relPath, url, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const buffer = await fetchBuffer(url);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, buffer);
  return buffer.toString("utf8");
}

async function downloadFile(rawRoot, relPath, url, referer, useCache) {
  const file = path.join(rawRoot, relPath);
  if (useCache && fs.existsSync(file)) return file;
  const buffer = await fetchBuffer(url, referer);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, buffer);
  return file;
}

function absoluteUrl(href, baseUrl) {
  return new URL(href, baseUrl).href;
}

function extractPdfUrls(html, pageUrl) {
  const urls = [];
  for (const match of String(html).matchAll(/showVsbpdfIframe\("([^"]+\.pdf)"/g)) {
    urls.push(absoluteUrl(match[1], pageUrl));
  }
  return urls;
}

function pdftotext(pdfFile, textFile, useCache) {
  if (useCache && fs.existsSync(textFile)) return fs.readFileSync(textFile, "utf8");
  ensureDir(path.dirname(textFile));
  execFileSync("pdftotext", ["-layout", pdfFile, textFile], { stdio: "pipe" });
  return fs.readFileSync(textFile, "utf8");
}

function clean(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lines(text) {
  return String(text)
    .split(/\n/)
    .map((line) => clean(line.replace(/\f/g, "")))
    .filter(Boolean);
}

function normalizeProvince(value) {
  return clean(value).replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
}

function normalizeSubject(sourceSubjectRaw, remark = "") {
  const text = `${clean(sourceSubjectRaw)} ${clean(remark)}`;
  if (/艺术|美术|音乐|设计/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/历史|文史/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合改革|综合/.test(text)) return "综合";
  return "官网未列科类";
}

function admissionType(majorName, subjectRaw, remark) {
  const text = [majorName, subjectRaw, remark].map(clean).join(" ");
  if (/艺术|美术|音乐|设计/.test(text)) return "艺术/体育类";
  if (/国家专项/.test(text)) return "专项计划";
  if (/中外合作/.test(text)) return "中外合作办学";
  return "普通录取";
}

function admissionSubtype(majorName, subjectRaw, remark) {
  const text = [majorName, subjectRaw, remark].map(clean).join(" ");
  if (/国家专项/.test(text)) return "国家专项";
  if (/艺术|美术|音乐|设计/.test(text)) return "艺术类";
  if (/中外合作/.test(text)) return "中外合作办学";
  return "普通类";
}

function formalScoreScope(majorName, subjectRaw, remark) {
  const text = [majorName, subjectRaw, remark].map(clean).join(" ");
  if (/国家专项|艺术|美术|音乐|设计/.test(text)) return "special-path-only";
  return "school-official-only";
}

function makeMajorRecord(base) {
  const id = `2025-sdust-national-school-${stableId([
    base.province,
    base.year,
    base.majorName,
    base.subjectType,
    base.admissionSubtype,
    base.minScore,
    base.minRank ?? "",
    base.sourcePdfPath,
    base.ordinal,
  ])}`;
  const record = {
    id,
    province: base.province,
    sourceProvinceRaw: base.sourceProvinceRaw || base.province,
    year: 2025,
    subjectType: base.subjectType,
    sourceSubjectRaw: base.sourceSubjectRaw,
    batch: base.batch || "本科批",
    sourceBatchRaw: base.sourceBatchRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType: "major-admission",
    majorName: base.majorName,
    majorGroup: [SOURCE.schoolName, base.campusName, base.province, base.subjectType, base.admissionSubtype, base.majorName].filter(Boolean).join("-"),
    admissionType: base.admissionType,
    admissionSubtype: base.admissionSubtype,
    formalScoreScope: base.formalScoreScope,
    minScore: base.minScore,
    scoreOnly: base.scoreOnly,
    rankUnavailable: base.rankUnavailable,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: base.rankUnavailable ? "single-school-major-score" : "single-school-major-score-rank",
    sourceUrl: base.sourceUrl,
    sourcePageUrl: base.sourcePageUrl,
    sourceListUrl: LIST_URL,
    sourcePdfUrl: base.sourcePdfUrl,
    officialEvidencePath: base.sourcePdfPath,
    sourcePdfPath: base.sourcePdfPath,
    sourceTextPath: base.sourceTextPath,
    sourceMinScoreRaw: String(base.minScore),
    rawRow: base.rawRow,
    cautions: base.cautions,
  };
  if (Number.isFinite(base.admitCount)) {
    record.admitCount = base.admitCount;
    record.sourceAdmitCountRaw = String(base.admitCount);
  }
  if (Number.isFinite(base.planCount)) {
    record.planCount = base.planCount;
    record.sourcePlanCountRaw = String(base.planCount);
  }
  if (Number.isFinite(base.minRank)) {
    record.minRank = base.minRank;
    record.sourceRankRaw = String(base.minRank);
  }
  if (base.campusName) {
    record.campusName = base.campusName;
    record.sourceCampusRaw = base.campusName;
  }
  if (base.scoreType) record.scoreType = base.scoreType;
  if (base.scoreUnit) record.scoreUnit = base.scoreUnit;
  if (base.maxScore != null) {
    record.maxScore = base.maxScore;
    record.sourceMaxScoreRaw = String(base.maxScore);
  }
  if (base.compositeMinScore != null) {
    record.compositeMinScore = base.compositeMinScore;
    record.sourceCompositeMinScoreRaw = String(base.compositeMinScore);
  }
  if (base.compositeMaxScore != null) {
    record.compositeMaxScore = base.compositeMaxScore;
    record.sourceCompositeMaxScoreRaw = String(base.compositeMaxScore);
  }
  if (base.remark) record.sourceRemarkRaw = base.remark;
  return record;
}

function parseOutside(text, meta) {
  const records = [];
  const bad = [];
  let ordinal = 0;
  for (const line of lines(text)) {
    if (/山东科技大学2025年本科录取情况统计表|生源省\s+录取专业/.test(line)) continue;
    const match = line.match(/^(\S+)\s+(.+?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+?)(?:\s{2,}(.+))?$/);
    if (!match) {
      bad.push(line);
      continue;
    }
    const [, provinceRaw, majorNameRaw, countRaw, scoreRaw, subjectRaw, remarkRaw = ""] = match;
    const province = normalizeProvince(provinceRaw);
    const majorName = clean(majorNameRaw);
    const remark = clean(remarkRaw);
    const sourceSubjectRaw = clean(subjectRaw);
    const subjectType = normalizeSubject(sourceSubjectRaw, remark);
    const type = admissionType(majorName, sourceSubjectRaw, remark);
    const subtype = admissionSubtype(majorName, sourceSubjectRaw, remark);
    const scope = formalScoreScope(majorName, sourceSubjectRaw, remark);
    records.push(makeMajorRecord({
      province,
      sourceProvinceRaw: provinceRaw,
      sourceSubjectRaw,
      sourceBatchRaw: meta.title,
      majorName,
      admissionType: type,
      admissionSubtype: subtype,
      formalScoreScope: scope,
      subjectType,
      minScore: Number(scoreRaw),
      admitCount: Number(countRaw),
      scoreOnly: true,
      rankUnavailable: true,
      sourceUrl: meta.pageUrl,
      sourcePageUrl: meta.pageUrl,
      sourcePdfUrl: meta.pdfUrl,
      sourcePdfPath: meta.pdfPath,
      sourceTextPath: meta.textPath,
      remark,
      ordinal,
      rawRow: {
        source: "province-outside-pdf",
        text: line,
        province: provinceRaw,
        majorName,
        admitCount: Number(countRaw),
        minScore: Number(scoreRaw),
        subjectRaw: sourceSubjectRaw,
        remark,
      },
      cautions: [
        "本记录来自山东科技大学本科招生网官方2025年省外本科录取情况PDF，是单校分省/专业录取边界，不是省级教育考试院全量投档/录取分数表。",
        "省外PDF未公开最低位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。",
        scope === "special-path-only"
          ? "本行属于艺术类或国家专项等特殊路径，运行层按 special-path-only 隔离，不与普通批次边界混用。"
          : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于山东科技大学候选边界复核，但不得替代同省省级正式投档表。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    }));
    ordinal += 1;
  }
  return { records, bad };
}

function parseShandongOrdinary(text, meta) {
  const records = [];
  const bad = [];
  let ordinal = 0;
  for (const line of lines(text)) {
    if (/2025年普通类常规批|校区\s+专业名称/.test(line)) continue;
    const match = line.match(/^(\S+校区)\s+(.+?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+)$/);
    if (!match) {
      bad.push(line);
      continue;
    }
    const [, campusName, majorNameRaw, planRaw, scoreRaw, rankRaw] = match;
    const majorName = clean(majorNameRaw);
    const type = /中外合作/.test(majorName) ? "中外合作办学" : "普通录取";
    const subtype = /中外合作/.test(majorName) ? "中外合作办学" : "普通类";
    records.push(makeMajorRecord({
      province: "山东",
      sourceProvinceRaw: "山东",
      sourceSubjectRaw: "山东普通类常规批未分科类",
      sourceBatchRaw: meta.title,
      batch: "普通类常规批第1次志愿",
      majorName,
      campusName,
      admissionType: type,
      admissionSubtype: subtype,
      formalScoreScope: "school-official-only",
      subjectType: "综合",
      minScore: Number(scoreRaw),
      minRank: Number(rankRaw),
      planCount: Number(planRaw),
      scoreOnly: false,
      rankUnavailable: false,
      sourceUrl: meta.pageUrl,
      sourcePageUrl: meta.pageUrl,
      sourcePdfUrl: meta.pdfUrl,
      sourcePdfPath: meta.pdfPath,
      sourceTextPath: meta.textPath,
      ordinal,
      rawRow: {
        source: "shandong-ordinary-pdf",
        text: line,
        campusName,
        majorName,
        planCount: Number(planRaw),
        minScore: Number(scoreRaw),
        minRank: Number(rankRaw),
      },
      cautions: [
        "本记录来自山东科技大学本科招生网官方2025年山东省普通类常规批PDF，是单校山东省专业录取分数/位次边界，不是山东省教育招生考试院全量投档表。",
        "本行含学校官网公布的录取最低位次，但仍是单校来源；推荐层可用于山东科技大学候选边界复核，不得替代省级正式投档表和当年计划约束。",
        "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
      ],
    }));
    ordinal += 1;
  }
  return { records, bad };
}

function parseShandongComprehensive(text, meta) {
  const records = [];
  const bad = [];
  let ordinal = 0;
  for (const line of lines(text)) {
    if (/2025年综合评价本科|专业名称\s+计划数/.test(line)) continue;
    const match = line.match(/^(.+?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\S+校区)$/);
    if (!match) {
      bad.push(line);
      continue;
    }
    const [, majorNameRaw, planRaw, compositeRaw, gaokaoRaw, campusName] = match;
    const majorName = clean(majorNameRaw);
    records.push(makeMajorRecord({
      province: "山东",
      sourceProvinceRaw: "山东",
      sourceSubjectRaw: "综合评价本科，官网未分科类",
      sourceBatchRaw: meta.title,
      batch: "综合评价本科",
      majorName,
      campusName,
      admissionType: "综合评价",
      admissionSubtype: "综合评价",
      formalScoreScope: "special-path-only",
      subjectType: "综合",
      minScore: Number(gaokaoRaw),
      compositeMinScore: Number(compositeRaw),
      planCount: Number(planRaw),
      scoreOnly: true,
      rankUnavailable: true,
      scoreType: "gaokao-min-score-with-comprehensive-evaluation",
      scoreUnit: "高考分；综合评价综合分另存 compositeMinScore",
      sourceUrl: meta.pageUrl,
      sourcePageUrl: meta.pageUrl,
      sourcePdfUrl: meta.pdfUrl,
      sourcePdfPath: meta.pdfPath,
      sourceTextPath: meta.textPath,
      ordinal,
      rawRow: {
        source: "shandong-comprehensive-evaluation-pdf",
        text: line,
        majorName,
        planCount: Number(planRaw),
        compositeMinScore: Number(compositeRaw),
        gaokaoMinScore: Number(gaokaoRaw),
        campusName,
      },
      cautions: [
        "本记录来自山东科技大学本科招生网官方2025年山东省综合评价本科PDF，属于综合评价特殊路径，不是普通高考批次边界。",
        "运行层按 special-path-only 隔离；minScore 保存高考分最低分，综合评价综合分另存 compositeMinScore，不得与普通批次分数线直接混用。",
        "源PDF未公开最低位次；运行层不生成假位次。",
      ],
    }));
    ordinal += 1;
  }
  return { records, bad };
}

function parseShandongArt(text, meta) {
  const records = [];
  const bad = [];
  let ordinal = 0;
  for (const line of lines(text)) {
    if (/2025年艺术类本科|专业名称\s+计划数/.test(line)) continue;
    const match = line.match(/^(.+?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
    if (!match) {
      bad.push(line);
      continue;
    }
    const [, majorNameRaw, planRaw, maxRaw, minRaw] = match;
    const majorName = clean(majorNameRaw);
    records.push(makeMajorRecord({
      province: "山东",
      sourceProvinceRaw: "山东",
      sourceSubjectRaw: "艺术类综合成绩",
      sourceBatchRaw: meta.title,
      batch: "艺术类本科",
      majorName,
      admissionType: "艺术/体育类",
      admissionSubtype: "艺术类",
      formalScoreScope: "special-path-only",
      subjectType: "艺术类",
      minScore: Number(minRaw),
      maxScore: Number(maxRaw),
      compositeMinScore: Number(minRaw),
      compositeMaxScore: Number(maxRaw),
      planCount: Number(planRaw),
      scoreOnly: true,
      rankUnavailable: true,
      scoreType: "art-composite-score",
      scoreUnit: "艺术类综合成绩",
      sourceUrl: meta.pageUrl,
      sourcePageUrl: meta.pageUrl,
      sourcePdfUrl: meta.pdfUrl,
      sourcePdfPath: meta.pdfPath,
      sourceTextPath: meta.textPath,
      ordinal,
      rawRow: {
        source: "shandong-art-pdf",
        text: line,
        majorName,
        planCount: Number(planRaw),
        compositeMaxScore: Number(maxRaw),
        compositeMinScore: Number(minRaw),
      },
      cautions: [
        "本记录来自山东科技大学本科招生网官方2025年山东省艺术类本科PDF，分数为艺术类综合成绩，不是普通高考文化课最低分。",
        "运行层按 special-path-only 隔离；minScore/compositeMinScore 保存源PDF综合成绩最低分，不得与普通批次高考分直接混用。",
        "源PDF未公开最低位次；运行层不生成假位次。",
      ],
    }));
    ordinal += 1;
  }
  return { records, bad };
}

function parsePdfText(text, meta) {
  if (meta.parser === "outside") return parseOutside(text, meta);
  if (meta.parser === "shandongOrdinary") return parseShandongOrdinary(text, meta);
  if (meta.parser === "shandongComprehensive") return parseShandongComprehensive(text, meta);
  if (meta.parser === "shandongArt") return parseShandongArt(text, meta);
  throw new Error(`Unknown parser: ${meta.parser}`);
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || "";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const outPath = resolveProjectPath(args.out);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const listHtml = await downloadText(rawRoot, "sdust-score-list.html", LIST_URL, args.useCache);
  if (!/山东科技大学2025年本科录取情况统计表（省外）/.test(listHtml) || !/山东科技大学2025年本科录取情况统计表（山东省）/.test(listHtml)) {
    throw new Error("Score list page did not contain the expected 2025 SDUST source links");
  }

  const pageHtmlByUrl = new Map();
  for (const page of [OUTSIDE_URL, SHANDONG_URL]) {
    const rawRel = page === OUTSIDE_URL ? "sdust-2025-outside.html" : "sdust-2025-shandong.html";
    pageHtmlByUrl.set(page, await downloadText(rawRoot, rawRel, page, args.useCache));
  }

  const outsidePdfUrls = extractPdfUrls(pageHtmlByUrl.get(OUTSIDE_URL), OUTSIDE_URL);
  const shandongPdfUrls = extractPdfUrls(pageHtmlByUrl.get(SHANDONG_URL), SHANDONG_URL);
  if (outsidePdfUrls.length !== 1) throw new Error(`Expected 1 outside PDF, found ${outsidePdfUrls.length}`);
  if (shandongPdfUrls.length !== 3) throw new Error(`Expected 3 Shandong PDFs, found ${shandongPdfUrls.length}`);
  const pdfUrlByKey = new Map([
    ["outside", outsidePdfUrls[0]],
    ["shandong-ordinary", shandongPdfUrls[0]],
    ["shandong-comprehensive", shandongPdfUrls[1]],
    ["shandong-art", shandongPdfUrls[2]],
  ]);

  const records = [];
  const warnings = [];
  const pdfSummaries = [];
  const rawPaths = [
    path.posix.join(RAW_DIR, "sdust-score-list.html"),
    path.posix.join(RAW_DIR, "sdust-2025-outside.html"),
    path.posix.join(RAW_DIR, "sdust-2025-shandong.html"),
  ];

  for (const item of EXPECTED_PDFS) {
    const pdfUrl = pdfUrlByKey.get(item.key);
    const pdfFile = await downloadFile(rawRoot, item.pdfRaw, pdfUrl, item.pageUrl, args.useCache);
    const textFile = path.join(rawRoot, item.textRaw);
    const text = pdftotext(pdfFile, textFile, args.useCache);
    const meta = {
      ...item,
      pdfUrl,
      pdfPath: path.posix.join(RAW_DIR, item.pdfRaw),
      textPath: path.posix.join(RAW_DIR, item.textRaw),
    };
    const parsed = parsePdfText(text, meta);
    records.push(...parsed.records);
    if (parsed.bad.length) warnings.push(`${item.key}: unparsed lines=${parsed.bad.length}: ${parsed.bad.slice(0, 5).join(" | ")}`);
    pdfSummaries.push({
      key: item.key,
      title: item.title,
      pageUrl: item.pageUrl,
      pdfUrl,
      pdfPath: meta.pdfPath,
      textPath: meta.textPath,
      records: parsed.records.length,
      unparsedLines: parsed.bad.length,
      sha256Pdf: sha256File(pdfFile),
      sha256Text: sha256File(textFile),
    });
    rawPaths.push(meta.pdfPath, meta.textPath);
  }

  const uniqueIds = new Set(records.map((record) => record.id));
  if (uniqueIds.size !== records.length) {
    throw new Error(`Duplicate record ids: ${records.length - uniqueIds.size}`);
  }
  if (warnings.length) throw new Error(`Parser warnings:\n${warnings.join("\n")}`);

  const scoreValues = records.map((record) => Number(record.minScore)).filter(Number.isFinite);
  const sourceNotes = [{
    id: SOURCE.id,
    title: "山东科技大学本科招生网：2025年本科录取情况统计表（省外、山东省）",
    publisher: "山东科技大学本科招生网",
    url: LIST_URL,
    outsideUrl: OUTSIDE_URL,
    shandongUrl: SHANDONG_URL,
    quality: SOURCE.quality,
    usage: "抽取山东科技大学本科招生网官方2025年本科录取情况PDF。省外PDF按生源省/专业/录取人数/最低分/科类/备注解析；山东省普通类PDF按校区/专业/计划数/最低分/最低位次解析；山东综合评价和艺术类PDF按特殊路径解析并隔离。",
    parsedRecords: records.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    years: [2025],
    recordsWithRank: records.filter((record) => record.rankUnavailable === false).length,
    recordsWithoutRank: records.filter((record) => record.rankUnavailable !== false).length,
    ordinarySchoolOfficialRecords: records.filter((record) => record.formalScoreScope === "school-official-only").length,
    specialPathRecords: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    byDataType: countBy(records, (record) => record.dataType),
    scoreRange: { min: Math.min(...scoreValues), max: Math.max(...scoreValues) },
    pdfSummaries,
    rawPaths,
    sha256: rawPaths.map((rel) => ({ path: rel, sha256: sha256File(resolveProjectPath(rel)) })),
    warnings,
    transcriptionMethod: "official-pdf-pdftotext-layout",
    cautions: [
      "本源为山东科技大学官方单校PDF统计表，不是任何省级教育考试院全量投档/录取分数表。",
      "山东省普通类PDF公开学校官网最低位次；省外PDF、山东综合评价和山东艺术类PDF未公开最低位次，运行层不生成假位次。",
      "综合评价、艺术类、国家专项等特殊路径按 special-path-only 隔离，不参与普通正式分数闭合统计。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区和调剂规则复核。",
    ],
  }];

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${JSON.stringify({ sourceNotes, records }, null, 2)}\n`);
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    sourceNotes: sourceNotes.length,
    records: records.length,
    provinceCount: sourceNotes[0].provinceCount,
    years: sourceNotes[0].years,
    recordsWithRank: sourceNotes[0].recordsWithRank,
    recordsWithoutRank: sourceNotes[0].recordsWithoutRank,
    ordinarySchoolOfficialRecords: sourceNotes[0].ordinarySchoolOfficialRecords,
    specialPathRecords: sourceNotes[0].specialPathRecords,
    bySubjectType: sourceNotes[0].bySubjectType,
    byFormalScoreScope: sourceNotes[0].byFormalScoreScope,
    byAdmissionType: sourceNotes[0].byAdmissionType,
    scoreRange: sourceNotes[0].scoreRange,
    pdfSummaries: sourceNotes[0].pdfSummaries.map((item) => ({
      key: item.key,
      records: item.records,
      unparsedLines: item.unparsedLines,
    })),
    warnings,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
