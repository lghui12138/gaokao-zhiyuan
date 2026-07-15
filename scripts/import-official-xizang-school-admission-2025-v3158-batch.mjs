#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-school-admission-2025-v3158-batch-import.json";
const RAW_DIR = "data/admissions/raw/official-xizang-school-admission-2025-v3158-batch";
const PROVINCE = "西藏";

const SOURCES = {
  nepu: {
    id: "official-nepu-xizang-2025-school-admission",
    quality: "official-school-nepu-2025-xizang-undergraduate-first-batch-html-score-only",
    url: "https://zsxxw.nepu.edu.cn/info/1164/8976.htm",
    rawFile: "nepu/nepu-xizang-2025-undergraduate-first-batch.html",
    schoolCode: "10220",
    schoolName: "东北石油大学",
    city: "大庆",
    tags: ["理工", "石油"],
    kind: "html",
  },
  lnu: {
    id: "official-lnu-xizang-2025-school-admission",
    quality: "official-school-lnu-2025-xizang-admission-pdf-score-only",
    url: "https://zs.lnu.edu.cn/__local/2/43/F9/787E7C7F306174CE43BAF7ED3D2_DE9E0306_E253.pdf",
    rawFile: "lnu/lnu-xizang-2025-admission.pdf",
    schoolCode: "10140",
    schoolName: "辽宁大学",
    city: "沈阳",
    tags: ["211", "双一流", "综合"],
    kind: "pdf",
  },
  xaut: {
    id: "official-xaut-xizang-2025-school-admission",
    quality: "official-school-xaut-2025-xizang-province-score-html-score-only",
    url: "https://zhaosheng.xaut.edu.cn/xinxichaxun/liniangeshengfenshuxianchaxun/740.html",
    rawFile: "xaut/xaut-2025-province-scores.html",
    schoolCode: "10700",
    schoolName: "西安理工大学",
    city: "西安",
    tags: ["理工"],
    kind: "html",
  },
  sjzu: {
    id: "official-sjzu-xizang-2025-school-admission-notices",
    quality: "official-school-sjzu-2025-xizang-admission-notices-score-only",
    schoolCode: "10153",
    schoolName: "沈阳建筑大学",
    city: "沈阳",
    tags: ["建筑", "理工"],
    kind: "noticeSet",
    notices: [
      {
        url: "https://zs.sjzu.edu.cn/info/1801/18231.htm",
        rawFile: "sjzu/sjzu-xizang-2025-undergraduate-first-batch.html",
        subjectRaw: "理工类",
        subjectType: "物理类",
        batch: "本科一批",
        dataType: "institution-admission",
        majorName: "理工类本科一批录取最低分",
        admissionType: "普通类",
        admissionSubtype: "本科一批录取结果（仍有缺额计划征集）",
        formalScoreScope: "school-official-only",
      },
      {
        url: "https://zs.sjzu.edu.cn/info/1801/18361.htm",
        rawFile: "sjzu/sjzu-xizang-2025-undergraduate-first-batch-collection.html",
        subjectRaw: "理工类",
        subjectType: "物理类",
        batch: "本科一批征集",
        dataType: "institution-admission",
        majorName: "理工类本科一批征集录取最低分",
        admissionType: "征集志愿",
        admissionSubtype: "本科一批征集",
        formalScoreScope: "special-path-only",
      },
    ],
  },
  henauSummary: {
    id: "official-henau-xizang-2025-province-summary",
    quality: "official-school-henau-2025-xizang-province-summary-html-score-only",
    url: "https://zs.henau.edu.cn/html/detail/historical_scores/202603161740.html",
    rawFile: "henau/henau-2025-province-summary.html",
    schoolCode: "10466",
    schoolName: "河南农业大学",
    city: "郑州",
    tags: ["农林"],
    kind: "html",
  },
  henauMajor: {
    id: "official-henau-xizang-2025-major-admission",
    quality: "official-school-henau-2025-xizang-major-html-score-only",
    url: "https://zs.henau.edu.cn/html/detail/historical_scores/202603181741.html",
    rawFile: "henau/henau-2025-major-admission.html",
    schoolCode: "10466",
    schoolName: "河南农业大学",
    city: "郑州",
    tags: ["农林"],
    kind: "html",
  },
};

const SUBJECT_MAP = {
  "理": "物理类",
  "理工": "物理类",
  "理工类": "物理类",
  "物理类": "物理类",
  "文": "历史类",
  "文史": "历史类",
  "文史类": "历史类",
  "历史类": "历史类",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-school-admission-2025-v3158-batch.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-school-admission-2025-v3158-batch.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source pages/files",
    "",
    "Imports a v3.158 batch of official school-level Xizang admission pages.",
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
    title: firstText(html, [/<meta\s+name=["']pageTitle["']\s+content=["']([\s\S]*?)["']/i, /<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]),
    publishedAt: firstText(html, [/发布时间\s*[:：]?\s*([0-9]{4}[-年][0-9]{1,2}[-月][0-9]{1,2}日?(?:\s+[0-9:]+)?)/i, /发表于\s*[:：]?\s*([0-9]{4}[-年][0-9]{1,2}[-月][0-9]{1,2}日?)/i]),
  };
}

function tablesFromHtml(html) {
  return [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function rowsFromTable(table) {
  return [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map((row) => [...row[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => textFromHtml(cell[1])))
    .filter((cells) => cells.length > 0);
}

function rowsFromHtml(html) {
  return tablesFromHtml(html).flatMap((table) => rowsFromTable(table));
}

function numberValue(value, label) {
  if (value === "" || value === null || value === undefined || value === "-" || value === "/" || value === "\\") return undefined;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric value for ${label}: ${value}`);
  return number;
}

function integerValue(value, label) {
  const number = numberValue(value, label);
  if (!Number.isInteger(number)) throw new Error(`Expected integer for ${label}: ${value}`);
  return number;
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
    `本记录来自${schoolName}官方招生页面，但属于专项、征集或其他限制入口边界。`,
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
  };
}

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-xizang-school-v3158-importer/1.0",
          accept: "text/html,application/xhtml+xml,application/xml,application/pdf;q=0.9,*/*;q=0.8",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }
  throw lastError;
}

async function ensureOneRawFile(rawDir, source, useCache) {
  const file = path.join(rawDir, source.rawFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!useCache || !fs.existsSync(file)) {
    fs.writeFileSync(file, await download(source.url));
  }
  const bytes = fs.readFileSync(file);
  if (source.kind === "pdf") {
    if (bytes.length < 10 * 1024 || !bytes.subarray(0, 4).equals(Buffer.from("%PDF"))) {
      throw new Error(`${source.id} PDF source is too small or invalid: ${file}`);
    }
  } else {
    const html = bytes.toString("utf8");
    if (html.length < 5 * 1024 || !html.includes("西藏")) {
      throw new Error(`${source.id} source page is too small or missing Xizang token: ${file}`);
    }
  }
  return file;
}

async function ensureRawFiles(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const files = {};
  for (const [key, source] of Object.entries(SOURCES)) {
    if (source.kind === "noticeSet") {
      files[key] = [];
      for (const notice of source.notices) {
        files[key].push(await ensureOneRawFile(rawDir, { ...source, ...notice }, useCache));
      }
    } else {
      files[key] = await ensureOneRawFile(rawDir, source, useCache);
    }
  }
  return files;
}

function pdfText(file) {
  const result = spawnSync("pdftotext", ["-layout", file, "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([`pdftotext failed for ${file}`, result.stderr?.trim()].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function buildNepuRecords(html) {
  const records = [];
  const table = tablesFromHtml(html).find((item) => item.includes("专业名称") && item.includes("省控线") && item.includes("西藏"));
  if (!table) throw new Error("Could not locate NEPU Xizang table");
  for (const row of rowsFromTable(table).slice(1)) {
    if (row[0] !== PROVINCE) throw new Error(`Unexpected NEPU row province: ${JSON.stringify(row)}`);
    const [province, subjectRaw, batch, planType, majorName, planCountRaw, admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw, controlLineRaw] = row;
    const subject = subjectType(subjectRaw);
    const minScore = integerValue(minScoreRaw, "NEPU min score");
    const formalScoreScope = planType.includes("专项") ? "special-path-only" : "school-official-only";
    const idBase = [2025, "nepu", subject, batch, planType, majorName, minScore].join("|");
    records.push({
      id: `2025-nepu-xizang-major-${hash(idBase, 16)}`,
      province,
      year: 2025,
      subjectType: subject,
      sourceSubjectRaw: subjectRaw,
      batch,
      ...baseSchoolFields("nepu"),
      dataType: "major-admission",
      majorName,
      admissionType: planType,
      formalScoreScope,
      planCount: integerValue(planCountRaw, "NEPU plan count"),
      admissionCount: integerValue(admissionCountRaw, "NEPU admission count"),
      minScore,
      maxScore: integerValue(maxScoreRaw, "NEPU max score"),
      avgScore: numberValue(avgScoreRaw, "NEPU avg score"),
      controlLineRaw,
      scoreOnly: true,
      rankUnavailable: true,
      cautions: formalScoreScope === "special-path-only"
        ? specialPathCautions(SOURCES.nepu.schoolName)
        : schoolOfficialCautions(SOURCES.nepu.schoolName, ["东北石油大学源表按 A类/B类省控线备注，需按考生类别单独复核。"]),
      rawText: row.join(" / "),
    });
  }
  if (records.length !== 16) throw new Error(`Unexpected NEPU record count: ${records.length}`);
  return records;
}

function buildLnuRecords(file) {
  const text = pdfText(file);
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    const compact = line.replace(/\s+/g, " ").trim();
    if (!compact.startsWith("西藏 ")) continue;
    const match = /^西藏\s+(\S+)\s+(\S+)\s+(.+?)\s+(\d+)\s+(-|\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(compact);
    if (!match) throw new Error(`Could not parse LNU line: ${compact}`);
    const [, planType, subjectRaw, majorName, minScoreRaw, minRankRaw, maxScoreRaw, avgScoreRaw, admissionCountRaw, college, campus] = match;
    const subject = subjectType(subjectRaw);
    const minScore = integerValue(minScoreRaw, "LNU min score");
    const formalScoreScope = planType.includes("专项") ? "special-path-only" : "school-official-only";
    const idBase = [2025, "lnu", subject, planType, majorName, minScore].join("|");
    const record = {
      id: `2025-lnu-xizang-major-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: 2025,
      subjectType: subject,
      sourceSubjectRaw: subjectRaw,
      batch: planType.includes("专项") ? "国家专项本科" : "本科批",
      ...baseSchoolFields("lnu"),
      dataType: "major-admission",
      college,
      campus,
      majorName,
      admissionType: planType,
      formalScoreScope,
      admissionCount: integerValue(admissionCountRaw, "LNU admission count"),
      minScore,
      maxScore: integerValue(maxScoreRaw, "LNU max score"),
      avgScore: numberValue(avgScoreRaw, "LNU avg score"),
      scoreOnly: minRankRaw === "-",
      rankUnavailable: minRankRaw === "-",
      cautions: formalScoreScope === "special-path-only"
        ? specialPathCautions(SOURCES.lnu.schoolName)
        : schoolOfficialCautions(SOURCES.lnu.schoolName),
      rawText: compact,
    };
    if (minRankRaw !== "-") {
      record.minRank = integerValue(minRankRaw, "LNU min rank");
      record.minRankEnd = record.minRank;
      record.scoreOnly = false;
      record.rankUnavailable = false;
    }
    records.push(record);
  }
  if (records.length !== 5) throw new Error(`Unexpected LNU record count: ${records.length}`);
  return records;
}

function isProvinceCell(value) {
  return /省$|市$|区$|自治区$|内蒙古|西藏区/.test(String(value || ""));
}

function buildXautRecords(html) {
  const tables = tablesFromHtml(html).filter((table) => table.includes("最低参考位次") && table.includes("最低分"));
  const records = [];
  for (const table of tables) {
    let currentProvince = "";
    for (const row of rowsFromTable(table).slice(1)) {
      if (isProvinceCell(row[0])) currentProvince = row[0];
      if (!currentProvince.includes("西藏")) continue;
      const cells = row[0].includes("西藏") ? row : [currentProvince, ...row];
      if (cells.length < 9) throw new Error(`Unexpected XAUT row: ${JSON.stringify(row)}`);
      const [provinceRaw, batch, subjectRaw, controlLineRaw, maxScoreRaw, minScoreRaw, avgScoreRaw, minRankRaw, categoryRaw] = cells;
      const subject = subjectType(subjectRaw);
      const minScore = integerValue(minScoreRaw, "XAUT min score");
      const category = categoryRaw || undefined;
      const idBase = [2025, "xaut", subject, batch, category, minScore].join("|");
      const record = {
        id: `2025-xaut-xizang-summary-${hash(idBase, 16)}`,
        province: PROVINCE,
        sourceProvinceRaw: provinceRaw,
        year: 2025,
        subjectType: subject,
        sourceSubjectRaw: subjectRaw,
        batch,
        ...baseSchoolFields("xaut"),
        dataType: "institution-admission",
        majorName: `${category ? `${category}` : ""}${subjectRaw}录取最低分`,
        admissionType: "普通类",
        admissionSubtype: category,
        xizangCandidateCategory: category,
        formalScoreScope: "school-official-only",
        controlLine: integerValue(controlLineRaw, "XAUT control line"),
        minScore,
        maxScore: integerValue(maxScoreRaw, "XAUT max score"),
        avgScore: numberValue(avgScoreRaw, "XAUT avg score"),
        scoreOnly: true,
        rankUnavailable: true,
        cautions: schoolOfficialCautions(SOURCES.xaut.schoolName, ["西安理工大学源表按西藏 A类/B类列示，最低参考位次为空，需按考生类别单独复核。"]),
        rawText: cells.join(" / "),
      };
      const minRank = numberValue(minRankRaw, "XAUT min rank");
      if (Number.isInteger(minRank)) {
        record.minRank = minRank;
        record.minRankEnd = minRank;
        record.scoreOnly = false;
        record.rankUnavailable = false;
      }
      records.push(record);
    }
  }
  if (records.length !== 4) throw new Error(`Unexpected XAUT record count: ${records.length}`);
  return records;
}

function buildSjzuRecords(files) {
  const records = [];
  for (let i = 0; i < SOURCES.sjzu.notices.length; i += 1) {
    const notice = SOURCES.sjzu.notices[i];
    const file = files[i];
    const html = fs.readFileSync(file, "utf8");
    const title = pageMeta(html).title || textFromHtml(html).slice(0, 120);
    const pageText = textFromHtml(html);
    const match = /(?:征集)?录取最低分（投档成绩）为(\d+)分/.exec(pageText);
    if (!match) throw new Error(`Could not parse SJZU notice score: ${file}`);
    const minScore = integerValue(match[1], "SJZU min score");
    const idBase = [2025, "sjzu", notice.batch, notice.majorName, minScore].join("|");
    records.push({
      id: `2025-sjzu-xizang-notice-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: 2025,
      subjectType: notice.subjectType,
      sourceSubjectRaw: notice.subjectRaw,
      batch: notice.batch,
      ...baseSchoolFields("sjzu"),
      dataType: notice.dataType,
      majorName: notice.majorName,
      admissionType: notice.admissionType,
      admissionSubtype: notice.admissionSubtype,
      formalScoreScope: notice.formalScoreScope,
      minScore,
      scoreOnly: true,
      rankUnavailable: true,
      cautions: notice.formalScoreScope === "special-path-only"
        ? specialPathCautions(SOURCES.sjzu.schoolName, ["该记录为征集志愿结果，不与首轮普通批边界混用。"])
        : schoolOfficialCautions(SOURCES.sjzu.schoolName, ["源页提示该批次仍有缺额计划进入征集，需与后续征集记录分开使用。"]),
      rawText: title,
    });
  }
  if (records.length !== 2) throw new Error(`Unexpected SJZU record count: ${records.length}`);
  return records;
}

function buildHenauSummaryRecords(html) {
  const row = rowsFromHtml(html).find((item) => item[0] === "西藏区" && item[2] === "本科二批");
  if (!row) throw new Error("Could not locate HENAU Xizang summary row");
  const [provinceRaw, subjectRaw, batch, admissionCountRaw, planCountRaw, controlLineRaw, minScoreRaw, scoreDiffRaw, minRankRaw, maxScoreRaw, maxDiffRaw, maxRankRaw, avgScoreRaw, avgDiffRaw, avgRankRaw] = row;
  const subject = subjectType(subjectRaw);
  const minScore = integerValue(minScoreRaw, "HENAU summary min score");
  const idBase = [2025, "henau-summary", subject, batch, minScore].join("|");
  const record = {
    id: `2025-henau-xizang-summary-${hash(idBase, 16)}`,
    province: PROVINCE,
    sourceProvinceRaw: provinceRaw,
    year: 2025,
    subjectType: subject,
    sourceSubjectRaw: subjectRaw,
    batch,
    ...baseSchoolFields("henauSummary"),
    dataType: "institution-admission",
    majorName: "本科二批录取概况",
    admissionType: "普通类",
    formalScoreScope: "school-official-only",
    admissionCount: integerValue(admissionCountRaw, "HENAU summary admission count"),
    planCount: integerValue(planCountRaw, "HENAU summary plan count"),
    controlLine: integerValue(controlLineRaw, "HENAU summary control line"),
    minScore,
    maxScore: integerValue(maxScoreRaw, "HENAU summary max score"),
    avgScore: numberValue(avgScoreRaw, "HENAU summary avg score"),
    scoreDiffFromControlLine: integerValue(scoreDiffRaw, "HENAU summary score diff"),
    scoreOnly: !minRankRaw,
    rankUnavailable: !minRankRaw,
    cautions: schoolOfficialCautions(SOURCES.henauSummary.schoolName, ["河南农业大学汇总表西藏行未公开最低分排名，不能生成假位次。"]),
    rawText: row.join(" / "),
  };
  if (minRankRaw) {
    record.minRank = integerValue(minRankRaw, "HENAU summary min rank");
    record.minRankEnd = record.minRank;
    record.maxRank = integerValue(maxRankRaw, "HENAU summary max rank");
    record.avgRank = numberValue(avgRankRaw, "HENAU summary avg rank");
    record.scoreOnly = false;
    record.rankUnavailable = false;
  }
  return [record];
}

function buildHenauMajorRecords(html) {
  const row = rowsFromHtml(html).find((item) => item[0] === "西藏区" && item[3] === "本科二批");
  if (!row) throw new Error("Could not locate HENAU Xizang major row");
  const [provinceRaw, subjectRaw, majorName, batch, admissionCountRaw, planCountRaw, controlLineRaw, minScoreRaw, scoreDiffRaw, minRankRaw, maxScoreRaw, maxDiffRaw, maxRankRaw, avgScoreRaw, avgDiffRaw, avgRankRaw] = row;
  const subject = subjectType(subjectRaw);
  const minScore = integerValue(minScoreRaw, "HENAU major min score");
  const idBase = [2025, "henau-major", subject, batch, majorName, minScore].join("|");
  const record = {
    id: `2025-henau-xizang-major-${hash(idBase, 16)}`,
    province: PROVINCE,
    sourceProvinceRaw: provinceRaw,
    year: 2025,
    subjectType: subject,
    sourceSubjectRaw: subjectRaw,
    batch,
    ...baseSchoolFields("henauMajor"),
    dataType: "major-admission",
    majorName,
    admissionType: "普通类",
    formalScoreScope: "school-official-only",
    admissionCount: integerValue(admissionCountRaw, "HENAU major admission count"),
    planCount: integerValue(planCountRaw, "HENAU major plan count"),
    controlLine: integerValue(controlLineRaw, "HENAU major control line"),
    minScore,
    maxScore: integerValue(maxScoreRaw, "HENAU major max score"),
    avgScore: numberValue(avgScoreRaw, "HENAU major avg score"),
    scoreDiffFromControlLine: integerValue(scoreDiffRaw, "HENAU major score diff"),
    scoreOnly: !minRankRaw,
    rankUnavailable: !minRankRaw,
    cautions: schoolOfficialCautions(SOURCES.henauMajor.schoolName, ["河南农业大学分专业表西藏行未公开最低分排名，不能生成假位次。"]),
    rawText: row.join(" / "),
  };
  if (minRankRaw) {
    record.minRank = integerValue(minRankRaw, "HENAU major min rank");
    record.minRankEnd = record.minRank;
    record.maxRank = integerValue(maxRankRaw, "HENAU major max rank");
    record.avgRank = numberValue(avgRankRaw, "HENAU major avg rank");
    record.scoreOnly = false;
    record.rankUnavailable = false;
  }
  return [record];
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
    scoreRange: numericRange(records.map((record) => Number(record.minScore))),
    rankRows: records.filter((record) => Number.isFinite(record.minRank)).length,
  };
}

function sourceNoteFor(sourceKey, records, rawFiles) {
  const source = SOURCES[sourceKey];
  const files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
  const htmlFile = files.find((file) => file.endsWith(".html") || file.endsWith(".htm"));
  const meta = htmlFile ? pageMeta(fs.readFileSync(htmlFile, "utf8")) : {};
  return {
    id: source.id,
    title: meta.title || source.schoolName,
    publisher: source.schoolName,
    publishedAt: meta.publishedAt || undefined,
    url: source.url || source.notices?.map((notice) => notice.url).join(" ; "),
    quality: source.quality,
    usage: `抽取${source.schoolName}官方页面中西藏录取分数，生成单校 score-only 边界。`,
    parsedRecords: records.length,
    rawPaths: files.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: files.map((file) => ({ path: path.relative(PROJECT_ROOT, file), sha256: sha256File(file) })),
    cautions: [
      "本源为高校官方单校录取数据，不是西藏自治区教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "专项、征集或限制入口记录按 formalScoreScope=special-path-only 隔离。",
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
  const html = (key) => fs.readFileSync(files[key], "utf8");
  const grouped = {
    nepu: buildNepuRecords(html("nepu")),
    lnu: buildLnuRecords(files.lnu),
    xaut: buildXautRecords(html("xaut")),
    sjzu: buildSjzuRecords(files.sjzu),
    henauSummary: buildHenauSummaryRecords(html("henauSummary")),
    henauMajor: buildHenauMajorRecords(html("henauMajor")),
  };
  const records = Object.values(grouped).flat();
  const diagnostics = diagnosticsFor(records);
  if (records.length !== 29 || diagnostics.rankRows !== 0 || diagnostics.specialPathRows !== 2) {
    throw new Error(`Unexpected v3.158 Xizang school batch diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const sourceNotes = Object.entries(grouped).map(([key, items]) => sourceNoteFor(key, items, files[key]));
  const payload = {
    dataset: "official-xizang-school-admission-2025-v3158-batch-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      sourceKind: "school-official-single-university-score-batch",
      schools: [...new Set(records.map((record) => record.schoolName))],
    },
    notes: [
      "本文件由 scripts/import-official-xizang-school-admission-2025-v3158-batch.mjs 自动生成。",
      "来源为东北石油大学、辽宁大学、西安理工大学、沈阳建筑大学、河南农业大学官方招生页面或官方 PDF。",
      "学校官网单校分数只作候选边界复核，不能替代西藏考试院全量投档/录取分数表。",
      "专项和征集记录按 special-path-only 隔离；未公开最低位次的记录不生成假位次或录取概率。",
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
