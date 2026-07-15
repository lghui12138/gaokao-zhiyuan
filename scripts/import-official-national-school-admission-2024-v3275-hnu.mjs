#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2024-v3275-hnu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2024-v3275-hnu";
const SOURCE_ROOT = "https://admi.hnu.edu.cn/2025fs/";
const YEAR = 2024;
const PLAN_YEAR = 2025;
const SOURCE = {
  id: "official-hnu-national-2024-major-admission",
  quality: "official-school-hnu-2025-province-pdf-2024-major-score-rank",
  schoolCode: "10532",
  schoolName: "湖南大学",
  city: "长沙",
  publisher: "湖南大学本科生招生信息网",
  tags: ["985", "211", "双一流", "综合类", "工程与信息类特色"],
};

// The school publishes these province PDFs directly. Chongqing, Xizang, and
// Shaanxi files were not present at the official 2025fs route when verified.
const ATTACHMENTS = [
  ["北京", "beijing.pdf"], ["天津", "tianjin.pdf"], ["河北", "hebeisheng.pdf"],
  ["山西", "shanxisheng.pdf"], ["内蒙古", "neimenggusheng.pdf"], ["辽宁", "liaoningsheng.pdf"],
  ["吉林", "jilinsheng.pdf"], ["黑龙江", "heilongjiangsheng.pdf"], ["上海", "shanghai.pdf"],
  ["江苏", "jiangsusheng.pdf"], ["浙江", "zhejiangsheng.pdf"], ["安徽", "anhuisheng.pdf"],
  ["福建", "fujian.pdf"], ["江西", "jiangxisheng.pdf"], ["山东", "shandongsheng.pdf"],
  ["河南", "henansheng.pdf"], ["湖北", "hubeisheng.pdf"], ["湖南", "hunansheng.pdf"],
  ["广东", "guangdongsheng.pdf"], ["广西", "guangxisheng.pdf"], ["海南", "hainansheng.pdf"],
  ["四川", "sichuansheng.pdf"], ["贵州", "guizhousheng.pdf"], ["云南", "yunnansheng.pdf"],
  ["甘肃", "gansusheng.pdf"], ["青海", "qinghaisheng.pdf"], ["宁夏", "ningxia.pdf"], ["新疆", "xinjiangsheng.pdf"],
].map(([province, fileName]) => ({ province, fileName, url: new URL(fileName, SOURCE_ROOT).href }));
const UNPUBLISHED_PROVINCES = ["重庆", "西藏", "陕西"];
const COMPREHENSIVE_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const PDFTOTEXT = process.env.PDFTOTEXT_BIN || "pdftotext";
const PDFINFO = process.env.PDFINFO_BIN || "pdfinfo";

const DEFAULT_PANELS = [
  { name: "left", start: 29, end: 208, majorEnd: 137, plan: [137, 167], score: [167, 193], rank: [193, 222] },
  { name: "middle", start: 208, end: 386, majorEnd: 316, plan: [316, 345], score: [345, 371], rank: [371, 400] },
  { name: "right", start: 386, end: 584, majorEnd: 500, plan: [500, 526], score: [526, 553], rank: [553, 586] },
];

// These official PDFs have two distinct page-2 table variants.  The table
// coordinates are deliberately explicit instead of inferring columns from
// text order, which would conflate a blank 2024 rank column with a score.
const WIDE_TWO_PANEL = [
  { name: "left", start: 29, end: 318, majorEnd: 174, plan: [174, 216], score: [216, 258], rank: [258, 318] },
  { name: "right", start: 318, end: 584, majorEnd: 438, plan: [438, 486], score: [486, 528], rank: [528, 584] },
];
const SHANGHAI_TWO_PANEL = [
  { name: "left", start: 29, end: 292, majorEnd: 176, plan: [176, 214], score: [214, 251], rank: [251, 292] },
  { name: "right", start: 292, end: 584, majorEnd: 460, plan: [460, 499], score: [499, 539], rank: [539, 584] },
];
const XINJIANG_SCORE_ONLY_PANELS = [
  { name: "left", start: 29, end: 233, majorEnd: 144, plan: [144, 177], score: [177, 233] },
  { name: "middle", start: 233, end: 403, majorEnd: 326, plan: [326, 356], score: [356, 403] },
  { name: "right", start: 403, end: 584, majorEnd: 505, plan: [505, 535], score: [535, 584] },
];

function panelsForProvince(province) {
  if (province === "上海") return SHANGHAI_TWO_PANEL;
  if (["北京", "天津"].includes(province)) return WIDE_TWO_PANEL;
  if (province === "新疆") return XINJIANG_SCORE_ONLY_PANELS;
  return DEFAULT_PANELS;
}

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2024-v3275-hnu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2024-v3275-hnu.mjs --use-cache",
    "",
    "Imports Hunan University official 2025 province PDFs: 2025 plans plus 2024 major minimum score/rank.",
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
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--use-cache") args.useCache = true;
    else throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

function guardProjectRoot() {
  if (PROJECT_ROOT.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing direct mac_2T processing; run from the internal APFS project copy.");
  }
}

function projectPath(relativePath) {
  return path.resolve(PROJECT_ROOT, relativePath);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  const digest = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      digest.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 20);
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInteger(value) {
  const text = cleanText(value).replace(/[,，]/g, "");
  if (!text || /^(?:\/|--?|—|无)$/.test(text)) return null;
  const match = text.match(/^\d+$/);
  return match ? Number(match[0]) : null;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([`${command} ${args.join(" ")} failed (${result.status})`, result.stderr, result.stdout].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

async function fetchBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-hnu-v3275/1.0",
          accept: "application/pdf,*/*;q=0.8",
          referer: "https://admi.hnu.edu.cn/",
        },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }
  throw lastError;
}

function parsePdfMetadata(file) {
  const output = run(PDFINFO, [file]);
  const pages = Number(/^Pages:\s*(\d+)/m.exec(output)?.[1]);
  const creationDate = /^CreationDate:\s*(.+)$/m.exec(output)?.[1]?.trim() || "";
  if (pages !== 2) throw new Error(`Expected a two-page HNU PDF: ${file}; got ${pages}`);
  return { pages, creationDate };
}

async function ensureSourceFiles(rawRoot, useCache) {
  ensureDir(rawRoot);
  ensureDir(path.join(rawRoot, "text"));
  ensureDir(path.join(rawRoot, "bbox"));
  const files = [];
  for (const attachment of ATTACHMENTS) {
    const stem = `hnu-2025-${attachment.fileName.replace(/\.pdf$/i, "")}`;
    const pdfRel = `${RAW_DIR}/${stem}.pdf`;
    const textRel = `${RAW_DIR}/text/${stem}-layout.txt`;
    const bboxRel = `${RAW_DIR}/bbox/${stem}-page2.html`;
    const pdfFile = projectPath(pdfRel);
    const textFile = projectPath(textRel);
    const bboxFile = projectPath(bboxRel);
    if (!useCache || !fs.existsSync(pdfFile) || fs.statSync(pdfFile).size < 100_000) {
      fs.writeFileSync(pdfFile, await fetchBuffer(attachment.url));
    }
    if (fs.readFileSync(pdfFile, { encoding: null }).subarray(0, 4).toString("ascii") !== "%PDF") {
      throw new Error(`Not a PDF: ${attachment.url}`);
    }
    const meta = parsePdfMetadata(pdfFile);
    if (!useCache || !fs.existsSync(textFile) || fs.statSync(textFile).size < 300) {
      run(PDFTOTEXT, ["-layout", pdfFile, textFile]);
    }
    if (!useCache || !fs.existsSync(bboxFile) || fs.statSync(bboxFile).size < 3_000) {
      run(PDFTOTEXT, ["-f", "2", "-l", "2", "-bbox-layout", pdfFile, bboxFile]);
    }
    const text = fs.readFileSync(textFile, "utf8");
    if (!new RegExp(`2025\\s*年在${attachment.province}(?:市|省|自治区)?招生情况及往年录取分数`).test(text)) {
      throw new Error(`PDF identity mismatch for ${attachment.province}: ${attachment.url}`);
    }
    files.push({ ...attachment, pdfRel, textRel, bboxRel, meta });
  }
  return files;
}

function parseBboxWords(html) {
  const words = [];
  for (const match of html.matchAll(/<word\s+([^>]+)>([\s\S]*?)<\/word>/g)) {
    const attrs = match[1];
    const xMin = Number(/xMin="([\d.]+)"/.exec(attrs)?.[1]);
    const yMin = Number(/yMin="([\d.]+)"/.exec(attrs)?.[1]);
    const xMax = Number(/xMax="([\d.]+)"/.exec(attrs)?.[1]);
    const yMax = Number(/yMax="([\d.]+)"/.exec(attrs)?.[1]);
    const text = cleanText(match[2]);
    if (text && [xMin, yMin, xMax, yMax].every(Number.isFinite)) words.push({ xMin, yMin, xMax, yMax, text });
  }
  return words;
}

function groupByY(words, tolerance = 2.5) {
  const sorted = [...words].sort((left, right) => left.yMin - right.yMin || left.xMin - right.xMin);
  const groups = [];
  for (const word of sorted) {
    const last = groups.at(-1);
    if (!last || Math.abs(last.y - word.yMin) > tolerance) {
      groups.push({ y: word.yMin, words: [word] });
    } else {
      last.words.push(word);
      last.y = Math.min(last.y, word.yMin);
    }
  }
  return groups.map((group) => ({
    ...group,
    words: group.words.sort((left, right) => left.xMin - right.xMin),
    text: group.words.sort((left, right) => left.xMin - right.xMin).map((word) => word.text).join(""),
  }));
}

function inRange(value, range) {
  return value >= range[0] && value < range[1];
}

function nearestValue(words, y, range) {
  if (!range) return null;
  const candidates = words
    .filter((word) => inRange((word.xMin + word.xMax) / 2, range))
    .map((word) => ({ word, distance: Math.abs(word.yMin - y), value: parseInteger(word.text) }))
    .filter((item) => item.value != null && item.distance <= 8)
    .sort((left, right) => left.distance - right.distance || left.word.xMin - right.word.xMin);
  return candidates[0]?.value ?? null;
}

function subjectFromLabel(label, province) {
  const text = cleanText(label);
  if (/艺术/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|不分科目|不分文理/.test(text) || COMPREHENSIVE_PROVINCES.has(province)) return "综合";
  return "官网未列科类";
}

function electiveFromLabel(label) {
  const text = cleanText(label);
  const match = text.match(/首选[^\s]+(?:，再选[^\s]+)?/);
  return match ? match[0] : "";
}

function pathFromLabel(label) {
  const text = cleanText(label);
  if (/国家专项/.test(text)) return "国家专项";
  if (/高校专项/.test(text)) return "高校专项";
  if (/少数民族预科|预科/.test(text)) return "预科";
  if (/艺术/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  if (/中外合作/.test(text)) return "中外合作办学";
  return "普通类";
}

function formalScope(pathType, subjectType, majorName) {
  return /专项|预科|艺术|体育|中外合作/.test(`${pathType}${subjectType}${majorName}`)
    ? "special-path-only"
    : "school-official-only";
}

function contextBefore(lines, rowY, panel, province) {
  const preceding = lines.filter((line) => line.y < rowY - 4 && line.words.some((word) => word.xMax >= panel.start && word.xMin <= panel.end));
  let admissionType = "普通类";
  let sourceSubjectRaw = "";
  let electiveRequirement = "";
  for (const line of preceding) {
    const text = cleanText(line.words
      .filter((word) => word.xMax >= panel.start && word.xMin <= panel.end)
      .map((word) => word.text)
      .join(""));
    if (!text || /专业名称|年计划数|年最低分|年排名/.test(text)) continue;
    const pathType = pathFromLabel(text);
    if (pathType !== "普通类" || /^普通类$/.test(text)) admissionType = pathType;
    if (/首选|历史|物理|理工|文史|文科|理科|综合|不分科目/.test(text)) {
      sourceSubjectRaw = text;
      electiveRequirement = electiveFromLabel(text);
    }
  }
  return {
    admissionType,
    sourceSubjectRaw: sourceSubjectRaw || (COMPREHENSIVE_PROVINCES.has(province) ? "综合改革" : "官网未列科类"),
    electiveRequirement,
  };
}

function majorTextForRow(words, panel, currentY, previousY, nextY) {
  const lower = previousY == null ? currentY - 17 : (previousY + currentY) / 2;
  const upper = nextY == null ? currentY + 17 : (currentY + nextY) / 2;
  return words
    .filter((word) => word.xMin >= panel.start && word.xMax <= panel.majorEnd && word.yMin >= lower && word.yMin < upper)
    .sort((left, right) => left.yMin - right.yMin || left.xMin - right.xMin)
    .map((word) => word.text)
    .join("")
    .replace(/\s+/g, "")
    .trim();
}

function validMajorName(value) {
  if (!value || value.length < 2 || value.length > 80) return false;
  if (/^(?:普通类|国家专项|高校专项|少数民族预科|首选|专业名称|年计划数|年最低分|年排名)/.test(value)) return false;
  return /[\u4e00-\u9fff]/.test(value);
}

function parseProvinceRecords(attachment) {
  const bbox = fs.readFileSync(projectPath(attachment.bboxRel), "utf8");
  const words = parseBboxWords(bbox);
  const lines = groupByY(words);
  const records = [];
  const skipped = [];
  for (const panel of panelsForProvince(attachment.province)) {
    const planCells = words
      .filter((word) => word.yMin > 165 && inRange((word.xMin + word.xMax) / 2, panel.plan))
      .map((word) => ({ word, value: parseInteger(word.text) }))
      .filter((item) => item.value != null && item.value >= 1 && item.value <= 500)
      .sort((left, right) => left.word.yMin - right.word.yMin);
    const rowYs = [...new Set(planCells.map((item) => item.word.yMin.toFixed(2)))].map(Number).sort((left, right) => left - right);
    for (let index = 0; index < rowYs.length; index += 1) {
      const y = rowYs[index];
      const planCount = nearestValue(words, y, panel.plan);
      const minScore = nearestValue(words, y, panel.score);
      const minRank = nearestValue(words, y, panel.rank);
      const majorName = majorTextForRow(words, panel, y, rowYs[index - 1], rowYs[index + 1]);
      const context = contextBefore(lines, y, panel, attachment.province);
      const subjectType = subjectFromLabel(context.sourceSubjectRaw, attachment.province);
      const scope = formalScope(context.admissionType, subjectType, majorName);
      if (minScore == null || minScore < 100 || minScore > (attachment.province === "海南" ? 900 : 750)) {
        skipped.push({ panel: panel.name, y, issue: "no-valid-2024-min-score", planCount, minScore, minRank, majorName, context });
        continue;
      }
      if (!validMajorName(majorName)) {
        skipped.push({ panel: panel.name, y, issue: "major-name-unresolved", planCount, minScore, minRank, majorName, context });
        continue;
      }
      records.push({
        id: `2024-hnu-${stableId([attachment.province, panel.name, context.admissionType, context.sourceSubjectRaw, majorName, minScore, minRank ?? ""])}`,
        province: attachment.province,
        year: YEAR,
        subjectType,
        sourceSubjectRaw: context.sourceSubjectRaw,
        electiveRequirement: context.electiveRequirement || undefined,
        batch: scope === "school-official-only" ? "本科批" : `${context.admissionType}专项/特殊类型`,
        schoolName: SOURCE.schoolName,
        schoolCode: SOURCE.schoolCode,
        schoolTags: SOURCE.tags,
        city: SOURCE.city,
        dataType: "major-admission",
        majorName,
        planCount,
        sourcePlanYear: PLAN_YEAR,
        minScore,
        minRankStart: minRank ?? undefined,
        minRankEnd: minRank ?? undefined,
        rankUnavailable: minRank == null,
        scoreOnly: minRank == null,
        sourceId: SOURCE.id,
        sourceQuality: SOURCE.quality,
        sourceUrl: attachment.url,
        sourceAttachmentUrl: attachment.url,
        officialEvidencePath: attachment.bboxRel,
        sourcePdfTextPath: attachment.textRel,
        sourceTableTitle: `2025年在${attachment.province}招生情况及往年录取分数（最终以省招办公布为准）`,
        admissionType: context.admissionType,
        admissionSubtype: scope === "school-official-only" ? "普通类" : context.admissionType,
        formalScoreScope: scope,
        parseMeta: {
          method: "official-pdf-page2-bbox-column-parser",
          panel: panel.name,
          y: Number(y.toFixed(2)),
          sourcePlanYear: PLAN_YEAR,
          sourceScoreYear: YEAR,
        },
        cautions: [
          "来源为湖南大学本科生招生信息网分省官方 PDF，2025年计划列与2024年专业最低分/最低位次列必须按各自年份使用。",
          "这是学校官网单校专业录取边界，不能替代省教育考试院全量投档/录取表或单独生成录取概率。",
          minRank == null ? "原 PDF 未公开该行2024年最低位次，保持rankUnavailable=true，不估造位次。" : "2024年最低位次按学校官网原 PDF 保留，正式填报仍需回省考试院计划和位次资料复核。",
          scope === "special-path-only" ? "国家专项、高校专项、预科、艺术体育等限定入口保持special-path-only，不进入普通自动推荐。" : "普通类单校专业分只作湖南大学候选边界。",
        ],
      });
    }
  }
  return { records, skipped };
}

function dedupe(records) {
  const seen = new Set();
  const duplicates = [];
  const output = [];
  for (const record of records) {
    const key = [record.province, record.year, record.schoolName, record.admissionType, record.subjectType, record.majorName, record.minScore, record.minRankEnd ?? ""].join("\t");
    if (seen.has(key)) duplicates.push({ key, id: record.id });
    else {
      seen.add(key);
      output.push(record);
    }
  }
  return { records: output, duplicates };
}

function countBy(records, selector) {
  return records.reduce((result, record) => {
    const key = selector(record) || "(blank)";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function numericRange(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers) } : null;
}

function writeJson(relativePath, value) {
  const file = projectPath(relativePath);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const attachments = await ensureSourceFiles(projectPath(RAW_DIR), args.useCache);
  const rawRecords = [];
  const skippedRows = [];
  const perProvince = [];
  for (const attachment of attachments) {
    const parsed = parseProvinceRecords(attachment);
    rawRecords.push(...parsed.records);
    skippedRows.push(...parsed.skipped.map((row) => ({ province: attachment.province, ...row })));
    perProvince.push({ province: attachment.province, records: parsed.records.length, skippedRows: parsed.skipped.length });
  }
  const { records, duplicates } = dedupe(rawRecords);
  const counters = {
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byAdmissionType: countBy(records, (record) => record.admissionType),
  };
  const ordinary = records.filter((record) => record.formalScoreScope === "school-official-only");
  const withRank = records.filter((record) => record.minRankEnd != null);
  const badRanks = records.filter((record) => (record.minRankEnd == null) !== Boolean(record.rankUnavailable));
  const ordinaryOutliers = ordinary.filter((record) => record.minScore < 150 || record.minScore > (record.province === "海南" ? 900 : 750));
  if (Object.keys(counters.byProvince).length !== ATTACHMENTS.length) {
    const emptyProvinces = perProvince.filter((item) => item.records === 0);
    throw new Error(`At least one official HNU province PDF produced no records: ${JSON.stringify(emptyProvinces)}`);
  }
  if (records.length < 850) throw new Error(`Too few HNU major records: ${records.length}`);
  if (withRank.length < 500) throw new Error(`Too few HNU rank-bearing records: ${withRank.length}`);
  if (badRanks.length) throw new Error(`Rank flag mismatch: ${badRanks.length}`);
  if (ordinaryOutliers.length) throw new Error(`Ordinary score outliers: ${ordinaryOutliers.length}`);
  if (records.some((record) => UNPUBLISHED_PROVINCES.includes(record.province))) throw new Error("Unexpected unpublished province record");

  const parseIndexRel = `${RAW_DIR}/hnu-national-2025-parse-index.json`;
  writeJson(parseIndexRel, {
    generatedAt: new Date().toISOString(),
    sourceRoot: SOURCE_ROOT,
    attachments: attachments.map((item) => ({
      province: item.province,
      url: item.url,
      pdfRel: item.pdfRel,
      textRel: item.textRel,
      bboxRel: item.bboxRel,
      pdfSha256: sha256File(projectPath(item.pdfRel)),
      textSha256: sha256File(projectPath(item.textRel)),
      bboxSha256: sha256File(projectPath(item.bboxRel)),
      ...item.meta,
    })),
    unavailableAtVerifiedRoute: UNPUBLISHED_PROVINCES,
    perProvince,
    skippedRows,
    duplicateRecordsSkipped: duplicates,
  });
  const rawFiles = [parseIndexRel, ...attachments.flatMap((item) => [item.pdfRel, item.textRel, item.bboxRel])];
  const sourceNote = {
    id: SOURCE.id,
    title: "湖南大学2025年各省招生情况及往年录取分数",
    publisher: SOURCE.publisher,
    url: SOURCE_ROOT,
    attachmentUrls: attachments.map((item) => item.url),
    quality: SOURCE.quality,
    usage: "解析湖南大学官方分省PDF中2025年计划数及2024年分专业最低分/公开最低位次。2024年普通类记录仅作school-official-only单校候选边界；国家专项、高校专项、预科、艺术体育等隔离为special-path-only。",
    rawDir: RAW_DIR,
    rawFiles,
    provinceCount: Object.keys(counters.byProvince).length,
    provincesWithRecords: Object.keys(counters.byProvince).sort((left, right) => left.localeCompare(right, "zh-CN")),
    unavailableAtVerifiedRoute: UNPUBLISHED_PROVINCES,
    parsedRecords: records.length,
    recordsWithRank: withRank.length,
    rankUnavailableRecords: records.length - withRank.length,
    duplicateRecordsSkipped: duplicates.length,
    skippedRows,
    scoreRange: numericRange(records.map((record) => record.minScore)),
    ...counters,
    cautions: [
      "各 PDF 明确标注最终以省招办公布为准；学校官网单校专业线不替代省教育考试院全量投档/录取表。",
      "2025年计划数与2024年最低分/最低位次是不同年份字段，不可把2025计划解释为2024录取结果。",
      "未公开最低位次的行保持rankUnavailable=true，不估造位次或录取概率。",
      "国家专项、高校专项、少数民族预科、艺术体育和中外合作等限定入口保持special-path-only。",
      "重庆、西藏、陕西在本轮核验的官方2025fs目录未找到对应PDF，明确列为未覆盖，不能用相邻省份或第三方数据替代。",
    ],
  };
  writeJson(args.out, {
    dataset: "official-national-school-admission-2024-v3275-hnu",
    generatedAt: new Date().toISOString(),
    scope: { school: SOURCE.schoolName, scoreYear: YEAR, planYear: PLAN_YEAR, officialAttachments: attachments.length },
    notes: sourceNote.cautions,
    sourceNotes: [sourceNote],
    records,
    audit: {
      totalRecords: records.length,
      recordsWithRank: withRank.length,
      rankUnavailableRecords: records.length - withRank.length,
      duplicateRecordsSkipped: duplicates.length,
      duplicates,
      skippedRows,
      ordinaryOutliers,
      badRanks,
      perProvince,
      ...counters,
    },
  });
  console.log(JSON.stringify({
    out: args.out,
    sourceId: SOURCE.id,
    records: records.length,
    recordsWithRank: withRank.length,
    rankUnavailableRecords: records.length - withRank.length,
    provinces: Object.keys(counters.byProvince).length,
    unavailableAtVerifiedRoute: UNPUBLISHED_PROVINCES,
    skippedRows: skippedRows.length,
    duplicateRecordsSkipped: duplicates.length,
    formalScoreScopeCounts: counters.byFormalScoreScope,
    scoreRange: sourceNote.scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
