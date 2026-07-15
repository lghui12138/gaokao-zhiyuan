#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-school-admission-2025-v3160-batch-import.json";
const RAW_DIR = "data/admissions/raw/official-xizang-school-admission-2025-v3160-batch";
const PROVINCE = "西藏";

const SOURCES = {
  mdjmu: {
    id: "official-mdjmu-xizang-2025-school-admission",
    quality: "official-school-mdjmu-2025-xizang-image-table-score-only",
    url: "https://www.mdjmu.cn/bkzsw/info/1044/1944.htm",
    rawFile: "mdjmu/mdjmu-xizang-2025.html",
    imageFile: "mdjmu/mdjmu-xizang-2025-table.png",
    title: "牡丹江医科大学2025年西藏自治区各专业录取分数公示（按投档分统计）",
    schoolCode: "10229",
    schoolName: "牡丹江医科大学",
    city: "牡丹江",
    tags: ["医药"],
    expectedToken: "西藏自治区各专业录取分数公示",
    expectedImage: { width: 553, height: 251, minBytes: 100_000 },
    captchaGatedAttachmentUrl: "https://www.mdjmu.cn/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=1919371311&wbfileid=14899325",
    imagePattern: /<img[^>]+src=["']([^"']*__local[^"']+\.png[^"']*)["']/i,
  },
  nuc: {
    id: "official-nuc-xizang-2025-school-admission",
    quality: "official-school-nuc-2025-xizang-image-table-score-only",
    url: "https://zbzs.nuc.edu.cn/info/1039/4147.htm",
    rawFile: "nuc/nuc-xizang-2025.html",
    imageFile: "nuc/nuc-xizang-2025-table.png",
    title: "西藏自治区2025年各专业录取分数情况",
    schoolCode: "10110",
    schoolName: "中北大学",
    city: "太原",
    tags: ["理工"],
    expectedToken: "西藏自治区2025年各专业录取分数情况",
    expectedImage: { width: 889, height: 201, minBytes: 20_000 },
    imagePattern: /<img[^>]+src=["']([^"']*virtual_attach_file\.vsb[^"']*e=\.png[^"']*)["']/i,
  },
};

const SUBJECT_MAP = {
  "理工": "物理类",
  "文史": "历史类",
};

const MDJMU_ROWS = [
  {
    majorName: "临床工程",
    duration: "四年",
    sourceSubjectRaw: "理工",
    sourceMajorPlanCount: 2,
    actualAdmissionRaw: "2（藏）",
    controlLine: 266,
    sourceOverallAvgScore: 293.5,
    entries: [
      { category: "藏", admissionSubtype: "征集/藏", admissionCount: 2, maxScore: 300, minScore: 287, maxScoreRaw: "300（藏）", minScoreRaw: "征集287（藏）", formalScoreScope: "special-path-only" },
    ],
  },
  {
    majorName: "临床医学",
    duration: "五年",
    sourceSubjectRaw: "理工",
    sourceMajorPlanCount: 14,
    actualAdmissionRaw: "8（汉）/1（单）/5（藏）",
    unscoredAdmissionCountBreakdown: "1（单）源表未列对应最高分/最低分，未生成分数记录",
    controlLine: 266,
    sourceOverallAvgScore: 331,
    entries: [
      { category: "汉", admissionCount: 8, maxScore: 369, minScore: 308, maxScoreRaw: "369（汉）", minScoreRaw: "308（汉）" },
      { category: "藏", admissionCount: 5, maxScore: 352, minScore: 310, maxScoreRaw: "352（藏）", minScoreRaw: "310（藏）" },
    ],
  },
  {
    majorName: "麻醉学",
    duration: "五年",
    sourceSubjectRaw: "理工",
    sourceMajorPlanCount: 5,
    actualAdmissionRaw: "1（汉）/4（藏）",
    controlLine: 266,
    sourceOverallAvgScore: 320.4,
    entries: [
      { category: "汉", admissionCount: 1, maxScore: 351, minScore: 351, maxScoreRaw: "351（汉）", minScoreRaw: "351（汉）" },
      { category: "藏", admissionCount: 4, maxScore: 324, minScore: 308, maxScoreRaw: "324（藏）", minScoreRaw: "308（藏）" },
    ],
  },
  {
    majorName: "医学影像学",
    duration: "五年",
    sourceSubjectRaw: "理工",
    sourceMajorPlanCount: 8,
    actualAdmissionRaw: "2（汉）/6（藏）",
    controlLine: 266,
    sourceOverallAvgScore: 323.1,
    entries: [
      { category: "汉", admissionCount: 2, maxScore: 368, minScore: 348, maxScoreRaw: "368（汉）", minScoreRaw: "348（汉）" },
      { category: "藏", admissionCount: 6, maxScore: 319, minScore: 307, maxScoreRaw: "319（藏）", minScoreRaw: "307（藏）" },
    ],
  },
  {
    majorName: "预防医学",
    duration: "五年",
    sourceSubjectRaw: "理工",
    sourceMajorPlanCount: 2,
    actualAdmissionRaw: "2（藏）",
    controlLine: 266,
    sourceOverallAvgScore: 305,
    entries: [
      { category: "藏", admissionCount: 2, maxScore: 307, minScore: 303, maxScoreRaw: "307（藏）", minScoreRaw: "303（藏）" },
    ],
  },
  {
    majorName: "医学检验技术",
    duration: "四年",
    sourceSubjectRaw: "理工",
    sourceMajorPlanCount: 5,
    actualAdmissionRaw: "5（藏）",
    controlLine: 266,
    sourceOverallAvgScore: 303.8,
    entries: [
      { category: "藏", admissionCount: 5, maxScore: 308, minScore: 301, maxScoreRaw: "308（藏）", minScoreRaw: "301（藏）" },
    ],
  },
  {
    majorName: "医学影像技术",
    duration: "四年",
    sourceSubjectRaw: "理工",
    sourceMajorPlanCount: 3,
    actualAdmissionRaw: "3（藏）",
    controlLine: 266,
    sourceOverallAvgScore: 303.3,
    entries: [
      { category: "藏", admissionCount: 3, maxScore: 306, minScore: 302, maxScoreRaw: "306（藏）", minScoreRaw: "302（藏）" },
    ],
  },
  {
    majorName: "护理学",
    duration: "四年",
    sourceSubjectRaw: "理工",
    sourceMajorPlanCount: 3,
    actualAdmissionRaw: "1（汉）/2（藏）",
    controlLine: 266,
    sourceOverallAvgScore: 306,
    entries: [
      { category: "汉", admissionCount: 1, maxScore: 307, minScore: 307, maxScoreRaw: "307（汉）", minScoreRaw: "307（汉）" },
      { category: "藏", admissionCount: 2, maxScore: 308, minScore: 303, maxScoreRaw: "308（藏）", minScoreRaw: "303（藏）" },
    ],
  },
];

const NUC_ROWS = [
  { collegeCode: "04", college: "化学与化工学院", majorName: "化学工程与工艺", sourceSubjectRaw: "理工", batch: "本科一批", sourceControlLineRaw: "300（A类）400（B类）", admissionCount: 2, maxScore: 396, minScore: 312, avgScore: 354 },
  { collegeCode: "05", college: "信息与通信工程学院", majorName: "电子信息工程", sourceSubjectRaw: "理工", batch: "本科一批", sourceControlLineRaw: "300（A类）400（B类）", admissionCount: 2, maxScore: 437, minScore: 423, avgScore: 430 },
  { collegeCode: "09", college: "经济与管理学院", majorName: "财务管理", sourceSubjectRaw: "文史", batch: "本科一批", sourceControlLineRaw: "338（A类）410（B类）", admissionCount: 2, maxScore: 362, minScore: 351, avgScore: 356.5 },
  { collegeCode: "10", college: "人文社会科学学院", majorName: "广播电视学", sourceSubjectRaw: "文史", batch: "本科一批", sourceControlLineRaw: "338（A类）410（B类）", admissionCount: 2, maxScore: 349, minScore: 347, avgScore: 348 },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-school-admission-2025-v3160-batch.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-school-admission-2025-v3160-batch.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source pages/files",
    "",
    "Imports a v3.160 batch of official school-level Xizang admission image tables.",
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
    title: firstText(html, [/<meta\s+property=["']og:title["']\s+content=["']([\s\S]*?)["']/i, /<meta\s+name=["']pageTitle["']\s+content=["']([\s\S]*?)["']/i, /<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]),
    publishedAt: firstText(html, [/datePublished["']?\s*:\s*["']([^"']+)/i, /发布时间\s*[:：]?\s*([0-9]{4}[-年][0-9]{1,2}[-月][0-9]{1,2}日?(?:\s+[0-9:]+)?)/i]),
    modifiedAt: firstText(html, [/dateModified["']?\s*:\s*["']([^"']+)/i]),
  };
}

function pngInfo(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Image is not a PNG file");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
  };
}

async function download(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-xizang-school-v3160-importer/1.0",
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
    "Mozilla/5.0 gaokao-xizang-school-v3160-importer/1.0",
    "-H",
    `Accept: ${options.accept || "*/*"}`,
  ];
  if (options.referer) curlArgs.push("-e", options.referer);
  curlArgs.push(url);
  const curl = spawnSync("curl", curlArgs, {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!curl.error && curl.status === 0 && curl.stdout?.length > 0) return Buffer.from(curl.stdout);
  throw new Error([
    `fetch and curl failed for ${url}`,
    String(lastError),
    curl.error ? String(curl.error) : "",
    curl.stderr?.toString("utf8").trim(),
  ].filter(Boolean).join("\n"));
}

function sourceImageUrl(source, html) {
  const match = source.imagePattern.exec(html);
  if (!match) throw new Error(`Could not locate embedded source image in ${source.id}`);
  return new URL(decodeHtmlEntities(match[1]), source.url).toString();
}

async function ensureSourceFiles(rawDir, sourceKey, useCache) {
  const source = SOURCES[sourceKey];
  const pageFile = path.join(rawDir, source.rawFile);
  const imageFile = path.join(rawDir, source.imageFile);
  fs.mkdirSync(path.dirname(pageFile), { recursive: true });
  fs.mkdirSync(path.dirname(imageFile), { recursive: true });
  if (!useCache || !fs.existsSync(pageFile)) {
    fs.writeFileSync(pageFile, await download(source.url));
  }
  const html = fs.readFileSync(pageFile, "utf8");
  if (html.length < 8 * 1024 || !html.includes(source.expectedToken) || !html.includes("西藏")) {
    throw new Error(`${source.id} source page is too small or missing expected tokens: ${pageFile}`);
  }
  const imageUrl = sourceImageUrl(source, html);
  if (!useCache || !fs.existsSync(imageFile)) {
    fs.writeFileSync(imageFile, await download(imageUrl, { accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8", referer: source.url }));
  }
  const image = fs.readFileSync(imageFile);
  const info = pngInfo(image);
  if (
    info.width !== source.expectedImage.width ||
    info.height !== source.expectedImage.height ||
    info.bytes < source.expectedImage.minBytes
  ) {
    throw new Error(`${source.id} source image dimensions/size changed: ${JSON.stringify(info)}`);
  }
  return { pageFile, imageFile, imageUrl, imageInfo: info };
}

async function ensureRawFiles(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  return {
    mdjmu: await ensureSourceFiles(rawDir, "mdjmu", useCache),
    nuc: await ensureSourceFiles(rawDir, "nuc", useCache),
  };
}

function subjectType(raw) {
  if (!SUBJECT_MAP[raw]) throw new Error(`Unknown subject: ${raw}`);
  return SUBJECT_MAP[raw];
}

function schoolOfficialCautions(schoolName, extra = []) {
  return [
    `本记录来自${schoolName}官方招生页面，是单校分省录取分数边界，不是西藏自治区教育考试院全量投档/录取分数表。`,
    "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，可用于该校候选边界复核，但不得清除西藏省级全量正式分数表缺口。",
    "未公开最低位次的记录不得生成假位次或单独输出录取概率。",
    ...extra,
  ];
}

function specialPathCautions(schoolName, extra = []) {
  return [
    `本记录来自${schoolName}官方招生页面，但属于征集、专项、内地班、艺体或其他限制入口边界。`,
    "本记录按 formalScoreScope=special-path-only 隔离，只用于对应入口复核，不替代普通批全量投档/录取分数表。",
    "未公开最低位次的记录不得生成假位次或单独输出普通批录取概率。",
    ...extra,
  ];
}

function baseSchoolFields(sourceKey) {
  const source = SOURCES[sourceKey];
  return {
    schoolCode: source.schoolCode,
    schoolName: source.schoolName,
    city: source.city,
    schoolTags: source.tags,
    sourceId: source.id,
    sourceQuality: source.quality,
    schoolOfficialScope: "single-school-admission-score",
    sourceUrl: source.url,
  };
}

function buildMdjmuRecords() {
  const source = SOURCES.mdjmu;
  const records = [];
  for (const row of MDJMU_ROWS) {
    for (const entry of row.entries) {
      const formalScoreScope = entry.formalScoreScope || "school-official-only";
      const majorGroup = `${entry.category}${entry.admissionSubtype ? `|${entry.admissionSubtype}` : ""}`;
      const idBase = [2025, "mdjmu", row.sourceSubjectRaw, row.majorName, majorGroup, entry.minScore].join("|");
      records.push({
        id: `2025-mdjmu-xizang-major-${hash(idBase, 16)}`,
        province: PROVINCE,
        year: 2025,
        subjectType: subjectType(row.sourceSubjectRaw),
        sourceSubjectRaw: row.sourceSubjectRaw,
        batch: "本科批",
        sourceBatchRaw: "源表未列批次",
        ...baseSchoolFields("mdjmu"),
        dataType: "major-admission",
        majorName: row.majorName,
        majorGroup,
        duration: row.duration,
        admissionType: "普通类",
        admissionSubtype: entry.admissionSubtype || entry.category,
        xizangCandidateCategory: entry.category,
        formalScoreScope,
        sourceMajorPlanCount: row.sourceMajorPlanCount,
        admissionCount: entry.admissionCount,
        sourceActualAdmissionRaw: row.actualAdmissionRaw,
        unscoredAdmissionCountBreakdown: row.unscoredAdmissionCountBreakdown,
        controlLine: row.controlLine,
        minScore: entry.minScore,
        maxScore: entry.maxScore,
        sourceOverallAvgScore: row.sourceOverallAvgScore,
        sourceMinScoreRaw: entry.minScoreRaw,
        sourceMaxScoreRaw: entry.maxScoreRaw,
        scoreOnly: true,
        rankUnavailable: true,
        sourceScoreScale: "source-declared-filing-score",
        transcriptionMethod: "official-embedded-image-table-manual-transcription-validated",
        cautions: formalScoreScope === "special-path-only"
          ? specialPathCautions(source.schoolName, ["牡丹江医科大学源表最低分单元格标注“征集287（藏）”，该记录按征集入口隔离。", "源表行平均分是同专业全体录取平均分，拆分汉/藏记录时保留为 sourceOverallAvgScore，不作为类别平均分。"])
          : schoolOfficialCautions(source.schoolName, ["牡丹江医科大学源表按汉/藏标注最高分和最低分；源表行平均分是同专业全体录取平均分，拆分记录时保留为 sourceOverallAvgScore。"]),
        rawText: [
          row.majorName,
          row.duration,
          row.sourceSubjectRaw,
          `计划${row.sourceMajorPlanCount}`,
          `实录${row.actualAdmissionRaw}`,
          `省控线${row.controlLine}`,
          `最高分${entry.maxScoreRaw}`,
          `最低分${entry.minScoreRaw}`,
          `平均分${row.sourceOverallAvgScore}`,
        ].join(" / "),
      });
    }
  }
  if (records.length !== 12) throw new Error(`Unexpected MDJMU record count: ${records.length}`);
  return records;
}

function buildNucRecords() {
  const source = SOURCES.nuc;
  const records = [];
  for (const row of NUC_ROWS) {
    const idBase = [2025, "nuc", row.collegeCode, row.sourceSubjectRaw, row.majorName, row.minScore].join("|");
    records.push({
      id: `2025-nuc-xizang-major-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: 2025,
      subjectType: subjectType(row.sourceSubjectRaw),
      sourceSubjectRaw: row.sourceSubjectRaw,
      batch: row.batch,
      ...baseSchoolFields("nuc"),
      dataType: "major-admission",
      collegeCode: row.collegeCode,
      college: row.college,
      majorName: row.majorName,
      admissionType: "普通类",
      formalScoreScope: "school-official-only",
      sourceControlLineRaw: row.sourceControlLineRaw,
      xizangControlLineGroups: row.sourceControlLineRaw.includes("A类") ? ["A类", "B类"] : [],
      admissionCount: row.admissionCount,
      minScore: row.minScore,
      maxScore: row.maxScore,
      avgScore: row.avgScore,
      scoreOnly: true,
      rankUnavailable: true,
      sourceScoreScale: "source-declared-filing-score",
      transcriptionMethod: "official-embedded-image-table-manual-transcription-validated",
      cautions: schoolOfficialCautions(source.schoolName, ["中北大学源表控制线同时列出 A 类/B 类，未按考生类别拆分最高分和最低分，使用前需回看源表口径。"]),
      rawText: [
        row.collegeCode,
        row.college,
        row.majorName,
        row.sourceSubjectRaw,
        row.batch,
        row.sourceControlLineRaw,
        `录取数${row.admissionCount}`,
        `最高分${row.maxScore}`,
        `最低分${row.minScore}`,
        `平均分${row.avgScore}`,
      ].join(" / "),
    });
  }
  if (records.length !== 4) throw new Error(`Unexpected NUC record count: ${records.length}`);
  return records;
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

function sourceNoteFor(sourceKey, records, files) {
  const source = SOURCES[sourceKey];
  const html = fs.readFileSync(files.pageFile, "utf8");
  const meta = pageMeta(html);
  return {
    id: source.id,
    title: meta.title || source.title,
    publisher: source.schoolName,
    publishedAt: meta.publishedAt || undefined,
    modifiedAt: meta.modifiedAt || undefined,
    url: source.url,
    imageUrl: files.imageUrl,
    captchaGatedAttachmentUrl: source.captchaGatedAttachmentUrl || undefined,
    quality: source.quality,
    usage: `抽取${source.schoolName}官方页面内嵌图片表中西藏2025录取分数，生成单校 score-only 边界。`,
    parsedRecords: records.length,
    rawPaths: [
      path.relative(PROJECT_ROOT, files.pageFile),
      path.relative(PROJECT_ROOT, files.imageFile),
    ],
    imageInfo: files.imageInfo,
    sha256: [
      { path: path.relative(PROJECT_ROOT, files.pageFile), sha256: sha256File(files.pageFile) },
      { path: path.relative(PROJECT_ROOT, files.imageFile), sha256: sha256File(files.imageFile) },
    ],
    transcriptionMethod: "official-embedded-image-table-manual-transcription-validated",
    cautions: [
      "本源为高校官方单校录取数据，不是西藏自治区教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "征集入口或其他限制入口记录按 formalScoreScope=special-path-only 隔离。",
      "未公开最低位次的记录不生成假位次或录取概率。",
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
  const grouped = {
    mdjmu: buildMdjmuRecords(),
    nuc: buildNucRecords(),
  };
  const records = Object.values(grouped).flat();
  const diagnostics = diagnosticsFor(records);
  if (diagnostics.totalRows !== 16 || diagnostics.rankRows !== 0 || diagnostics.schoolOfficialRows !== 15 || diagnostics.specialPathRows !== 1) {
    throw new Error(`Unexpected v3.160 Xizang school batch diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const sourceNotes = Object.entries(grouped).map(([key, items]) => sourceNoteFor(key, items, files[key]));
  const payload = {
    dataset: "official-xizang-school-admission-2025-v3160-batch-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      sourceKind: "school-official-single-university-image-table-score-batch",
      schools: [...new Set(records.map((record) => record.schoolName))],
    },
    notes: [
      "本文件由 scripts/import-official-xizang-school-admission-2025-v3160-batch.mjs 自动生成。",
      "来源为牡丹江医科大学和中北大学官方招生页面内嵌图片表；原始 HTML/PNG 已保留在 raw provenance pack。",
      "图片表按官方页面可见内容人工转写并由脚本校验源页、图片尺寸、PNG 签名与 SHA256；不使用 OCR 猜测缺失行。",
      "牡丹江医科大学源页的 XLSX 附件当前需要验证码下载，导入采用同一官方页面可直连查看的内嵌图片表。",
      "学校官网单校分数只作候选边界复核，不能替代西藏考试院全量投档/录取分数表。",
      "征集入口按 special-path-only 隔离；源表未公开最低位次的记录不生成假位次或录取概率。",
    ],
    sourceNotes,
    diagnostics,
    records,
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    schoolOfficialRows: diagnostics.schoolOfficialRows,
    specialPathRows: diagnostics.specialPathRows,
    rankRows: diagnostics.rankRows,
    bySourceId: diagnostics.bySourceId,
    rawDir: path.relative(PROJECT_ROOT, rawDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
