#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2025;
const INDEX_URL = "https://admission.bnu.edu.cn/zsjhlnfs/b411741c050f4fa6a6c4e206e2053d14.html";
const SOURCE_ID = "official-bnu-national-2025-school-major-admission";
const SOURCE_QUALITY = "official-school-bnu-2025-national-pdf-transfer-rank-major-score";
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2025-v3268-bnu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2025-v3268-bnu";
const EXCLUDED_RECORD_PROVINCES = new Set(["西藏"]);
const COMPREHENSIVE_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
  "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);
const ADMISSION_TYPES = [
  "普通类", "公费师范生", "优师计划", "国家专项计划", "高校专项计划", "艺术类", "体育类",
  "少数民族预科", "预科", "强基计划", "特殊类型",
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2025-v3268-bnu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2025-v3268-bnu.mjs --use-cache",
    "",
    "Downloads and parses BNU's official 2025 province PDFs. Xizang records are excluded because the",
    "same attachment was already imported by official-bnu-xizang-2025-school-admission.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false, pdftotext: process.env.PDFTOTEXT_BIN || "pdftotext" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--use-cache") args.useCache = true;
    else if (arg === "--pdftotext") args.pdftotext = argv[++i];
    else throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

function guardProjectRoot() {
  if (PROJECT_ROOT.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing to run the BNU importer from /Volumes/mac_2T; use internal APFS staging.");
  }
}

function projectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function hash(value, length = 18) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeText(value) {
  return decodeHtml(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n\f\v]+/g, " ")
    .replace(/\s+([，。；：、）〉》])/g, "$1")
    .replace(/([（〈《])\s+/g, "$1")
    .trim();
}

function stripTags(value) {
  return normalizeText(String(value || "").replace(/<[^>]+>/g, " "));
}

function parseNumber(value) {
  const text = normalizeText(value).replace(/[,，]/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseInteger(value) {
  const number = parseNumber(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item) || "(blank)";
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function numericRange(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers) } : null;
}

async function fetchBuffer(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-bnu-v3268/1.0",
          accept: options.accept || "*/*",
          referer: options.referer || INDEX_URL,
        },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }
  throw lastError;
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
}

function extractPdfLinks(html) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const province = stripTags(match[2]).replace(/\.pdf$/i, "").trim();
    if (!MAINLAND_PROVINCES.has(province)) continue;
    links.push({ province, url: new URL(match[1], INDEX_URL).href });
  }
  const unique = [...new Map(links.map((item) => [item.province, item])).values()].sort((a, b) => a.province.localeCompare(b.province, "zh-CN"));
  if (unique.length !== 31) throw new Error(`Expected 31 mainland province PDFs, found ${unique.length}`);
  return unique;
}

async function ensureSourceFiles(rawRoot, useCache, pdftotext) {
  ensureDir(rawRoot);
  ensureDir(path.join(rawRoot, "text"));
  const indexFile = path.join(rawRoot, "bnu-national-2025-index.html");
  if (!useCache || !fs.existsSync(indexFile) || fs.statSync(indexFile).size < 10_000) {
    fs.writeFileSync(indexFile, await fetchBuffer(INDEX_URL, { accept: "text/html,application/xhtml+xml,*/*;q=0.8" }));
  }
  const html = fs.readFileSync(indexFile, "utf8");
  if (!/2025年各省份录取分数线及招生计划情况/.test(html)) throw new Error("BNU index identity check failed");
  const attachments = extractPdfLinks(html);
  for (const item of attachments) {
    const key = hash(item.url, 14);
    item.pdfRel = `${RAW_DIR}/bnu-${key}.pdf`;
    item.textRel = `${RAW_DIR}/text/bnu-${key}-layout.txt`;
    const pdfFile = projectPath(item.pdfRel);
    const textFile = projectPath(item.textRel);
    if (!useCache || !fs.existsSync(pdfFile) || fs.statSync(pdfFile).size < 80_000) {
      fs.writeFileSync(pdfFile, await fetchBuffer(item.url, { accept: "application/pdf,*/*;q=0.8" }));
    }
    const pdfHead = fs.readFileSync(pdfFile, { encoding: null, flag: "r" }).subarray(0, 4).toString("ascii");
    if (pdfHead !== "%PDF" || fs.statSync(pdfFile).size < 80_000) throw new Error(`Invalid PDF for ${item.province}: ${pdfFile}`);
    if (!useCache || !fs.existsSync(textFile) || fs.statSync(textFile).size < 1_000) {
      run(pdftotext, ["-layout", pdfFile, textFile]);
    }
    if (!fs.existsSync(textFile) || fs.statSync(textFile).size < 1_000) throw new Error(`No extracted text for ${item.province}`);
  }
  return { indexFile, attachments };
}

function normalizeSubject(raw, province, elective = "") {
  const value = normalizeText(raw);
  if (/历史|文史|文科/.test(value)) return "历史类";
  if (/物理|理工|理科/.test(value)) return "物理类";
  if (/艺术/.test(value)) return "艺术类";
  if (/体育/.test(value)) return "体育类";
  if (/综合|不分科目|不分文理/.test(value)) return "综合";
  if (COMPREHENSIVE_PROVINCES.has(province)) return "综合";
  if (/物理/.test(elective)) return "物理类";
  return "";
}

function normalizeElective(raw) {
  const text = normalizeText(raw).replace(/[＋]/g, "+").replace(/\s*\+\s*/g, "+");
  if (!text) return "";
  if (/物理.*化学|物化/.test(text)) return "物理+化学";
  if (/思想政治|政治/.test(text)) return "思想政治";
  if (/不限/.test(text)) return "不限";
  if (/^物理$/.test(text)) return "物理";
  if (/^化学$/.test(text)) return "化学";
  return "";
}

function formalScope(admissionType, batch) {
  return /专项|公费|优师|艺术|体育|提前|预科|强基|特殊/.test(`${admissionType}${batch}`)
    ? "special-path-only"
    : "school-official-only";
}

function normalizeBatch(raw, scope) {
  const value = normalizeText(raw);
  if (value) return value;
  return scope === "school-official-only" ? "本科批" : "特殊类型批";
}

function schoolName(campus) {
  return campus === "珠海校区" ? "北京师范大学（珠海校区）" : "北京师范大学";
}

function baseRecord(item) {
  return {
    province: item.province,
    year: YEAR,
    city: item.campus === "珠海校区" ? "珠海" : "北京",
    schoolCode: "10027",
    schoolName: schoolName(item.campus),
    schoolTags: ["985", "211", "双一流", "师范"],
    campus: item.campus,
    subjectType: item.subjectType,
    sourceSubjectRaw: item.sourceSubjectRaw,
    batch: item.batch,
    admissionType: item.admissionType,
    admissionSubtype: item.formalScoreScope === "special-path-only" ? item.admissionType : "普通录取",
    formalScoreScope: item.formalScoreScope,
    schoolOfficialScope: item.formalScoreScope === "school-official-only" ? "single-school-admission-score" : undefined,
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    sourceUrl: item.pdfUrl,
    sourcePageUrl: item.pdfUrl,
    sourceIndexUrl: INDEX_URL,
    officialEvidencePath: item.textRel,
    sourceAttachmentUrl: item.pdfUrl,
    scoreOnly: item.minRank == null,
    rankUnavailable: item.minRank == null,
  };
}

function parseTransferRecords(text, context, warnings) {
  const marker = "调档线与位次情况";
  const start = text.indexOf(marker);
  const tableStart = text.search(/北京师范大学（(?:北京校区|珠海校区)）2025\s*年招生计划/);
  if (start < 0 || tableStart < 0 || tableStart <= start) {
    warnings.push({ province: context.province, issue: "transfer_preamble_not_found" });
    return [];
  }
  const paragraph = normalizeText(text.slice(start + marker.length, tableStart));
  const records = [];
  let currentCampus = "北京校区";
  let currentAdmissionType = "普通类";
  const transferClauses = paragraph
    .replace(/分，(?=(?:理工类|物理类|历史类|文史类|文科|理科|不限组|物化组).*?调档线)/g, "分；")
    .split(/[；。]/);
  for (const clauseRaw of transferClauses) {
      const clause = normalizeText(clauseRaw);
      if (!/\d+(?:\.\d+)?\s*分/.test(clause)) continue;
      currentCampus = clause.match(/(北京校区|珠海校区)/)?.[1] || currentCampus;
      currentAdmissionType = ADMISSION_TYPES.find((value) => clause.includes(value)) || currentAdmissionType;
      const campus = currentCampus;
      const admissionType = currentAdmissionType;
      const scoreMatch = clause.match(/(\d+(?:\.\d+)?)\s*分/);
      if (!scoreMatch) continue;
      const minScore = Number(scoreMatch[1]);
      const descriptorRaw = clause.slice(0, scoreMatch.index)
        .replace(/^.*?(?=北京校区|珠海校区)/, "")
        .replace(/^(北京校区|珠海校区)/, "")
        .replace(new RegExp(`^${admissionType}`), "")
        .replace(/调档线[：:]?/g, "")
        .replace(/^[：:，,]+/, "")
        .trim();
      const minRank = parseInteger(clause.match(/(?:全省|全市|全区)位次\s*([\d,，]+)\s*名/)?.[1] || "");
      const elective = normalizeElective(descriptorRaw);
      const subjectType = normalizeSubject(descriptorRaw, context.province, elective);
      if (!subjectType) {
        warnings.push({ province: context.province, issue: "transfer_subject_unresolved", clause });
        continue;
      }
      const maxAllowed = context.province === "海南" ? 900 : 750;
      if (!(minScore >= 100 && minScore <= maxAllowed)) {
        warnings.push({ province: context.province, issue: "transfer_score_out_of_range", clause, minScore });
        continue;
      }
      const scope = formalScope(admissionType, "调档线");
      const sourceSubjectRaw = descriptorRaw || subjectType;
      const item = {
        ...context,
        campus,
        admissionType,
        formalScoreScope: scope,
        batch: scope === "school-official-only" ? "本科批" : `${admissionType}批`,
        subjectType,
        sourceSubjectRaw,
        minScore,
        minRank,
      };
      const record = {
        ...baseRecord(item),
        id: `bnu-2025-transfer-${hash([context.province, campus, admissionType, sourceSubjectRaw, minScore, minRank].join("|"))}`,
        dataType: "institution-admission",
        majorName: `${schoolName(campus)}${admissionType}调档线`,
        minScore,
        minRank,
        minRankStart: minRank,
        minRankEnd: minRank,
        rankRangeText: minRank == null ? "" : String(minRank),
        scoreOnly: minRank == null,
        rankUnavailable: minRank == null,
        scoreMetric: "院校调档最低分，按学校官网原表口径",
        sourceMajorRaw: `${admissionType}调档线`,
        sourceMinScoreRaw: String(minScore),
        sourceMinRankRaw: minRank == null ? "" : String(minRank),
        rawText: clause,
        cautions: [
          "本记录来自北京师范大学本科生招生网官方分省 PDF，是单校调档边界，不是省级考试院全量投档表。",
          minRank == null ? "原句未公开位次；不生成假位次。" : "位次按学校官方 PDF 原句保留，仍需以省考试院当年一分一段和招生计划复核。",
          scope === "special-path-only" ? "公费师范、优师、专项等资格路径隔离为 special-path-only。" : "普通类单校分数只作北京师范大学候选边界。",
        ],
      };
      if (elective) {
        record.electiveRequirement = elective;
        record.majorGroup = `${schoolName(campus)}|${admissionType}|${elective}`;
      }
      records.push(record);
  }
  return records;
}

function nearestAnchor(anchors, lineIndex, maxDistance = 18) {
  let best = null;
  for (const anchor of anchors) {
    const distance = Math.abs(anchor.lineIndex - lineIndex);
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance || (distance === best.distance && anchor.lineIndex <= lineIndex && best.lineIndex > lineIndex)) {
      best = { ...anchor, distance };
    }
  }
  return best;
}

function joinFragments(fragments) {
  return normalizeText(fragments.filter(Boolean).join(" "))
    .replace(/\s*<\s*/g, "<")
    .replace(/\s*>\s*/g, ">")
    .replace(/\s*\+\s*/g, "+");
}

function classifyTableSegment(segment) {
  const text = normalizeText(segment);
  const admissionType = ADMISSION_TYPES.find((value) => text === value || (text.includes(value) && text.length <= value.length + 2));
  if (admissionType) return { kind: "admission", value: admissionType };
  if (/^(?:本科|本科批|本科批次|普通本科批|本科普通批|本科普通批次|普通批|提前本科|本科提前批|本科提前批次|普通本科提前批|国家专项(?:计划|本科)?|高校专项(?:计划|本科)?|艺术统考本科批|本科提前批艺术类|特殊类型招生|体育本科批|预科)$/u.test(text)) {
    return { kind: "batch", value: text };
  }
  if (/^(?:历史类|物理类|文史|理工|文科|理科|综合|不分科目类|艺术(?:\s*\([^)]*\))?|体育(?:\s*\([^)]*\))?)$/u.test(text)) {
    return { kind: "subject", value: text };
  }
  const elective = normalizeElective(text);
  if (elective && text.length <= 12) return { kind: "elective", value: text };
  return { kind: "text", value: text };
}

function isCompleteMajorName(value) {
  const text = normalizeText(value);
  if (text.length < 2 || text.length > 90) return false;
  if (/^(?:招生专业|院（系）|最高分|最低分|计划|说明)/.test(text)) return false;
  if (/(?:学院|学部|研究院|书院)$/.test(text)) return false;
  if (/^[、，。）》〉+>]/.test(text) || /[、（<+\-]$/.test(text)) return false;
  if (/^(?:班>|项目>|方向>|学位复合型人才培养项目|用统计学）|养项目）)$/.test(text)) return false;
  return /[\u4e00-\u9fff]/.test(text);
}

function parseTableSection(sectionText, campus, context, warnings) {
  const lines = sectionText.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.includes("招生类型") && line.includes("招生专业"));
  if (headerIndex < 0) {
    warnings.push({ province: context.province, campus, issue: "major_table_header_not_found" });
    return [];
  }
  const scoreHeaderIndex = lines.findIndex((line, index) => index >= headerIndex && index <= headerIndex + 6 && line.includes("最高分") && line.includes("最低分"));
  if (scoreHeaderIndex < 0) {
    warnings.push({ province: context.province, campus, issue: "major_table_score_header_not_found" });
    return [];
  }
  const anchors = { admission: [], batch: [], subject: [], elective: [] };
  const candidates = [];

  for (let lineIndex = scoreHeaderIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (/^\s*说明[：:]?/.test(line) || line.includes("本科招生办")) break;
    const numeric = line.match(/\s(\d{1,3})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/);
    const prefix = numeric ? line.slice(0, numeric.index) : line;
    const segments = prefix.trim().split(/\s{2,}/).map(normalizeText).filter(Boolean);
    const textSegments = [];
    const current = {};
    for (const segment of segments) {
      const classified = classifyTableSegment(segment);
      if (classified.kind === "text") textSegments.push(classified.value);
      else {
        anchors[classified.kind].push({ lineIndex, value: classified.value });
        if (classified.kind !== "admission" || !current.admission) current[classified.kind] = classified.value;
      }
    }
    if (!numeric) continue;
    const majorName = textSegments.at(-1) || "";
    const departmentCandidate = textSegments.length >= 2 ? textSegments.at(-2) : "";
    const department = /(?:学院|学部|研究院|书院)$/.test(departmentCandidate) ? departmentCandidate : "";
    candidates.push({
      lineIndex,
      planCount: Number(numeric[1]),
      maxScore: Number(numeric[2]),
      minScore: Number(numeric[3]),
      currentAdmissionRaw: current.admission || "",
      currentBatchRaw: current.batch || "",
      currentSubjectRaw: current.subject || "",
      currentElectiveRaw: current.elective || "",
      department,
      majorName,
      rawText: normalizeText(line),
      rawSegments: segments,
    });
  }

  const records = [];
  for (const row of candidates) {
    const admissionAnchor = row.currentAdmissionRaw ? { value: row.currentAdmissionRaw, distance: 0 } : null;
    const batchAnchor = row.currentBatchRaw ? { value: row.currentBatchRaw, distance: 0 } : null;
    const subjectAnchor = row.currentSubjectRaw ? { value: row.currentSubjectRaw, distance: 0 } : null;
    const electiveAnchor = row.currentElectiveRaw ? { value: row.currentElectiveRaw, distance: 0 } : null;
    const admissionType = ADMISSION_TYPES.find((value) => admissionAnchor?.value?.includes(value)) || "";
    const elective = normalizeElective(electiveAnchor?.value || "");
    const subjectType = normalizeSubject(subjectAnchor?.value || "", context.province, elective);
    const scope = formalScope(admissionType, batchAnchor?.value || "");
    const maxAllowed = context.province === "海南" ? 900 : 750;
    const hasStrictSubjectEvidence = COMPREHENSIVE_PROVINCES.has(context.province) || subjectAnchor != null || /物理/.test(elective);
    const issue = !admissionType ? "major_admission_type_unresolved"
      : !hasStrictSubjectEvidence ? "major_subject_not_on_score_line"
      : !subjectType ? "major_subject_unresolved"
        : admissionType === "普通类" && !batchAnchor ? "ordinary_major_batch_not_on_score_line"
        : !isCompleteMajorName(row.majorName) ? "major_name_unresolved"
          : row.planCount == null || row.planCount < 1 || row.planCount > 500 ? "major_plan_invalid"
            : row.maxScore == null || row.maxScore < row.minScore ? "major_score_order_invalid"
              : row.minScore <= 0 || row.maxScore > maxAllowed ? "major_score_out_of_range"
                : scope === "school-official-only" && row.minScore < 150 ? "ordinary_major_score_too_low"
                  : "";
    if (issue) {
      warnings.push({ province: context.province, campus, lineIndex: row.lineIndex, issue, row, admissionAnchor, batchAnchor, subjectAnchor, electiveAnchor });
      continue;
    }
    const batch = normalizeBatch(batchAnchor?.value || "", scope);
    const sourceSubjectRaw = subjectAnchor?.value || (subjectType === "综合" ? elective || "综合" : subjectType);
    const item = {
      ...context,
      campus,
      admissionType,
      formalScoreScope: scope,
      batch,
      subjectType,
      sourceSubjectRaw,
      minRank: null,
    };
    const record = {
      ...baseRecord(item),
      id: `bnu-2025-major-${hash([context.province, campus, admissionType, batch, subjectType, elective, row.department, row.majorName, row.minScore].join("|"))}`,
      dataType: "major-admission",
      collegeName: row.department,
      department: row.department,
      majorName: row.majorName,
      planCount: row.planCount,
      maxScore: row.maxScore,
      minScore: row.minScore,
      scoreMetric: /艺术|体育/.test(`${admissionType}${subjectType}${batch}`)
        ? "艺术/体育投档或专业成绩，按学校官网原表口径"
        : "专业录取最低分，按学校官网原表口径",
      sourceCategoryRaw: admissionAnchor.value,
      sourceBatchRaw: batchAnchor?.value || "",
      sourceMajorRaw: row.majorName,
      sourceCollegeRaw: row.department,
      sourceElectiveRequirementRaw: electiveAnchor?.value || "",
      sourceMinScoreRaw: String(row.minScore),
      sourceMinRankRaw: "",
      parseMeta: {
        lineIndex: row.lineIndex,
        mergedCellInference: "nearest-visible-label-within-table",
        admissionAnchorDistance: admissionAnchor.distance,
        batchAnchorDistance: batchAnchor?.distance ?? null,
        subjectAnchorDistance: subjectAnchor?.distance ?? null,
        electiveAnchorDistance: electiveAnchor?.distance ?? null,
        rawSegments: row.rawSegments,
      },
      rawText: row.rawText,
      cautions: [
        "本记录来自北京师范大学本科生招生网官方分省 PDF，是单校专业录取分，不是省级考试院全量专业录取表。",
        "PDF 合并单元格通过同一表内最近可见标签恢复招生类型、批次、科类和选科；原始行号与锚点距离保留在 parseMeta，正式填报需回看原 PDF。",
        "专业行未公开最低位次；不生成假位次或单独输出录取概率。",
        scope === "special-path-only" ? "公费师范、优师、专项、艺体等资格路径隔离为 special-path-only。" : "普通类单校专业分只作北京师范大学专业候选边界。",
      ],
    };
    if (elective) {
      record.electiveRequirement = elective;
      record.majorGroup = `${schoolName(campus)}|${admissionType}|${subjectType}|${elective}`;
    }
    records.push(record);
  }
  return records;
}

function parseMajorRecords(text, context, warnings) {
  const sectionPattern = /北京师范大学（(北京校区|珠海校区)）2025\s*年招生计划[^\n]*\n/g;
  const matches = [...text.matchAll(sectionPattern)];
  const records = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index;
    const end = matches[index + 1]?.index ?? text.indexOf("说明：", start);
    const sectionEnd = end > start ? end : text.length;
    records.push(...parseTableSection(text.slice(start, sectionEnd), matches[index][1], context, warnings));
  }
  if (!matches.length) warnings.push({ province: context.province, issue: "major_sections_not_found" });
  return records;
}

function dedupeRecords(records) {
  const seenIds = new Set();
  const seenKeys = new Set();
  const output = [];
  const duplicates = [];
  for (const record of records) {
    const key = [record.dataType, record.province, record.schoolName, record.campus, record.admissionType, record.batch, record.subjectType, record.majorName, record.minScore, record.minRank ?? ""].join("\t");
    if (seenIds.has(record.id) || seenKeys.has(key)) {
      duplicates.push({ id: record.id, key });
      continue;
    }
    seenIds.add(record.id);
    seenKeys.add(key);
    output.push(record);
  }
  return { records: output, duplicates };
}

function buildCounters(records) {
  return {
    byProvince: countBy(records, (record) => record.province),
    bySubjectType: countBy(records, (record) => record.subjectType),
    byDataType: countBy(records, (record) => record.dataType),
    byFormalScoreScope: countBy(records, (record) => record.formalScoreScope),
    byAdmissionType: countBy(records, (record) => record.admissionType),
    byCampus: countBy(records, (record) => record.campus),
  };
}

function writeJson(rel, value) {
  const file = projectPath(rel);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  const { indexFile, attachments } = await ensureSourceFiles(rawRoot, args.useCache, args.pdftotext);
  const rawRecords = [];
  const warnings = [];
  const perProvince = [];

  for (const attachment of attachments) {
    const text = fs.readFileSync(projectPath(attachment.textRel), "utf8");
    if (!text.includes(`北京师范大学 2025 年在${attachment.province}`)) {
      warnings.push({ province: attachment.province, issue: "pdf_identity_mismatch", textRel: attachment.textRel });
      continue;
    }
    const context = {
      province: attachment.province,
      pdfUrl: attachment.url,
      pdfRel: attachment.pdfRel,
      textRel: attachment.textRel,
    };
    const transfer = parseTransferRecords(text, context, warnings);
    const majors = parseMajorRecords(text, context, warnings);
    perProvince.push({ province: attachment.province, transferRecords: transfer.length, majorRecords: majors.length, excludedExistingSourceOverlap: EXCLUDED_RECORD_PROVINCES.has(attachment.province) });
    if (!EXCLUDED_RECORD_PROVINCES.has(attachment.province)) rawRecords.push(...transfer, ...majors);
  }

  const { records, duplicates } = dedupeRecords(rawRecords);
  const counters = buildCounters(records);
  const provincesWithRecords = Object.keys(counters.byProvince).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const transferRecords = records.filter((record) => record.dataType === "institution-admission");
  const majorRecords = records.filter((record) => record.dataType === "major-admission");
  const recordsWithRank = records.filter((record) => record.minRank != null);
  const badRankFlags = records.filter((record) => (record.minRank == null) !== Boolean(record.rankUnavailable));
  const ordinaryOutliers = records.filter((record) => record.formalScoreScope === "school-official-only" && (record.minScore < 150 || record.minScore > (record.province === "海南" ? 900 : 750)));
  if (provincesWithRecords.length < 28) throw new Error(`Too few provinces parsed: ${provincesWithRecords.length}`);
  if (transferRecords.length < 150 || transferRecords.length > 170) throw new Error(`Unexpected transfer record count: ${transferRecords.length}`);
  if (majorRecords.length < 20) throw new Error(`Too few major records parsed: ${majorRecords.length}`);
  if (recordsWithRank.length < 145) throw new Error(`Too few official rank records parsed: ${recordsWithRank.length}`);
  if (records.some((record) => record.province === "西藏")) throw new Error("Xizang overlap records were not excluded");
  if (badRankFlags.length) throw new Error(`Bad rank flags: ${badRankFlags.length}`);
  if (ordinaryOutliers.length) throw new Error(`Ordinary score outliers: ${ordinaryOutliers.length}`);

  const indexRel = `${RAW_DIR}/bnu-national-2025-parse-index.json`;
  writeJson(indexRel, {
    generatedAt: new Date().toISOString(),
    indexUrl: INDEX_URL,
    attachments: attachments.map((item) => ({ ...item, pdfSha256: sha256File(projectPath(item.pdfRel)), textSha256: sha256File(projectPath(item.textRel)) })),
    perProvince,
    excludedRecordProvinces: [...EXCLUDED_RECORD_PROVINCES],
    warnings,
  });

  const rawFiles = [
    path.relative(PROJECT_ROOT, indexFile),
    indexRel,
    ...attachments.flatMap((item) => [item.pdfRel, item.textRel]),
  ];
  const sourceNote = {
    id: SOURCE_ID,
    title: "北京师范大学2025年全国各省录取分数线及招生计划",
    publisher: "北京师范大学本科招生办",
    publishedAt: "2026-03-25",
    url: INDEX_URL,
    indexUrl: INDEX_URL,
    attachmentUrls: attachments.map((item) => item.url),
    quality: SOURCE_QUALITY,
    usage: "解析北京师范大学官方31省PDF中的院校调档最低分/位次和分专业最高分、最低分、计划数；普通类只作school-official-only单校候选边界，公费师范、优师、专项、艺体等隔离为special-path-only。西藏附件已由既有同源导入器覆盖，本源不重复追加西藏记录。",
    rawDir: RAW_DIR,
    rawFiles,
    parsedRecords: records.length,
    transferRecords: transferRecords.length,
    majorRecords: majorRecords.length,
    recordsWithRank: recordsWithRank.length,
    rankUnavailableRecords: records.length - recordsWithRank.length,
    provinceCount: provincesWithRecords.length,
    provincesWithRecords,
    excludedRecordProvinces: [...EXCLUDED_RECORD_PROVINCES],
    duplicateRecordsSkipped: duplicates.length,
    skippedRows: warnings,
    scoreRange: numericRange(records.map((record) => record.minScore)),
    ...counters,
    cautions: [
      "学校官网单校调档分/专业分不替代省级教育考试院全量投档或最终录取表。",
      "只有调档线原句明确给出位次的记录保留位次；专业行和无位次调档行保持rankUnavailable=true。",
      "PDF合并单元格按同一表最近可见标签恢复，锚点距离写入parseMeta；正式填报必须回原PDF核对。",
      "公费师范、优师、国家专项、高校专项、艺体等保持special-path-only。",
      "西藏附件已在official-bnu-xizang-2025-school-admission中导入，本轮只保留原始附件证据，不重复计数。",
    ],
  };
  const payload = {
    dataset: "official-national-school-admission-2025-v3268-bnu",
    generatedAt: new Date().toISOString(),
    scope: {
      year: YEAR,
      school: "北京师范大学",
      officialAttachments: attachments.length,
      provinceCount: provincesWithRecords.length,
      excludedExistingSourceOverlap: [...EXCLUDED_RECORD_PROVINCES],
    },
    notes: sourceNote.cautions,
    sourceNotes: [sourceNote],
    records,
    audit: {
      totalRecords: records.length,
      transferRecords: transferRecords.length,
      majorRecords: majorRecords.length,
      recordsWithRank: recordsWithRank.length,
      rankUnavailableRecords: records.length - recordsWithRank.length,
      duplicateRecordsSkipped: duplicates.length,
      duplicates,
      skippedRows: warnings,
      ordinaryOutliers,
      badRankFlags,
      scoreRange: sourceNote.scoreRange,
      perProvince,
      ...counters,
    },
  };
  writeJson(args.out, payload);
  console.log(JSON.stringify({
    out: args.out,
    sourceId: SOURCE_ID,
    records: records.length,
    transferRecords: transferRecords.length,
    majorRecords: majorRecords.length,
    recordsWithRank: recordsWithRank.length,
    rankUnavailableRecords: records.length - recordsWithRank.length,
    provinceCount: provincesWithRecords.length,
    attachmentCount: attachments.length,
    warningCount: warnings.length,
    duplicateRecordsSkipped: duplicates.length,
    formalScoreScopeCounts: counters.byFormalScoreScope,
    scoreRange: sourceNote.scoreRange,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
