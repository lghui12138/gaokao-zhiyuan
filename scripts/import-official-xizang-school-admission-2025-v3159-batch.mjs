#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-school-admission-2025-v3159-batch-import.json";
const RAW_DIR = "data/admissions/raw/official-xizang-school-admission-2025-v3159-batch";
const PROVINCE = "西藏";

const SOURCES = {
  xzmu: {
    id: "official-xzmu-xizang-2025-school-admission",
    quality: "official-school-xzmu-2025-xizang-major-html-score-only",
    url: "https://zscx.xzmu.edu.cn/public/chaxun/lnlq2/%E8%A5%BF%E8%97%8F/2025/0/0",
    rawFile: "xzmu/xzmu-xizang-2025-major-admission.html",
    schoolCode: "10695",
    schoolName: "西藏民族大学",
    city: "咸阳",
    tags: ["民族", "综合"],
    expectedToken: "分专业录取情况",
  },
  hhxy: {
    id: "official-hhxy-xizang-2025-school-admission",
    quality: "official-school-hhxy-2025-xizang-major-html-score-only",
    schoolCode: "13744",
    schoolName: "黑河学院",
    city: "黑河",
    tags: ["综合"],
    notices: [
      {
        url: "https://zsxx.hhxy.edu.cn/info/1072/2286.htm",
        rawFile: "hhxy/hhxy-xizang-2025-wenshi-major-admission.html",
        subjectRaw: "文史类",
        subjectType: "历史类",
      },
      {
        url: "https://zsxx.hhxy.edu.cn/info/1072/2284.htm",
        rawFile: "hhxy/hhxy-xizang-2025-ligong-major-admission.html",
        subjectRaw: "理工类",
        subjectType: "物理类",
      },
    ],
    expectedToken: "各专业录取分数统计表",
  },
  jnu: {
    id: "official-jnu-xizang-2025-neidi-high-school-class-admission",
    quality: "official-school-jnu-2025-xizang-neidi-high-school-class-html-score-only",
    url: "https://zsb.jnu.edu.cn/2026/0331/c33879a852786/page.htm",
    rawFile: "jnu/jnu-xizang-2025-neidi-high-school-class.html",
    schoolCode: "10559",
    schoolName: "暨南大学",
    city: "广州",
    tags: ["211", "双一流", "综合"],
    expectedToken: "西藏内地高中班录取分数线",
  },
  xjtlu: {
    id: "official-xjtlu-xizang-2025-school-admission",
    quality: "official-school-xjtlu-2025-xizang-province-html-score-only",
    url: "https://www.xjtlu.edu.cn/zh/admissions/domestic/ug/2023luqushuju",
    rawFile: "xjtlu/xjtlu-xizang-2025-province-admission.html",
    schoolCode: "16403",
    schoolName: "西交利物浦大学",
    city: "苏州",
    tags: ["中外合作"],
    expectedToken: "2025年分省录取数据",
  },
};

const SUBJECT_MAP = {
  "理": "物理类",
  "理工": "物理类",
  "理工类": "物理类",
  "文": "历史类",
  "文史": "历史类",
  "文史类": "历史类",
  "高职": "高职单招",
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-school-admission-2025-v3159-batch.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-school-admission-2025-v3159-batch.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH          output JSON path",
    "  --use-cache        reuse downloaded source pages/files",
    "",
    "Imports a v3.159 batch of official school-level Xizang admission pages.",
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

function tablesFromHtml(html) {
  return [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function attributeNumber(fragment, name) {
  const match = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i").exec(fragment);
  return match ? Number(match[1]) : 1;
}

function rowsFromTable(table) {
  return [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map((row) => [...row[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => textFromHtml(cell[1])))
    .filter((cells) => cells.length > 0);
}

function expandedRowsFromTable(table) {
  const pending = [];
  const rows = [];
  for (const rowMatch of table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const row = [];
    let col = 0;
    const flushPending = () => {
      while (pending[col]) {
        row[col] = pending[col].text;
        pending[col].remaining -= 1;
        if (pending[col].remaining <= 0) pending[col] = null;
        col += 1;
      }
    };
    flushPending();
    for (const cellMatch of rowMatch[0].matchAll(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      flushPending();
      const value = textFromHtml(cellMatch[3]);
      const rowSpan = attributeNumber(cellMatch[2], "rowspan");
      const colSpan = attributeNumber(cellMatch[2], "colspan");
      for (let i = 0; i < colSpan; i += 1) {
        row[col + i] = value;
        if (rowSpan > 1) pending[col + i] = { text: value, remaining: rowSpan - 1 };
      }
      col += colSpan;
    }
    flushPending();
    rows.push(row.map((value) => value || ""));
  }
  return rows.filter((row) => row.some(Boolean));
}

function numberValue(value, label) {
  if (value === "" || value === null || value === undefined || value === "-" || value === "/" || value === "\\" || value === "——") return undefined;
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
    `本记录来自${schoolName}官方招生页面，但属于专项、内地班、体育艺术、对口高职或其他限制入口边界。`,
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
          "user-agent": "Mozilla/5.0 gaokao-xizang-school-v3159-importer/1.0",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }
  const curl = spawnSync("curl", [
    "-L",
    "--compressed",
    "--fail",
    "--silent",
    "--show-error",
    "--max-time",
    "90",
    "-A",
    "Mozilla/5.0 gaokao-xizang-school-v3159-importer/1.0",
    url,
  ], {
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

async function ensureOneRawFile(rawDir, source, useCache) {
  const file = path.join(rawDir, source.rawFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!useCache || !fs.existsSync(file)) {
    fs.writeFileSync(file, await download(source.url));
  }
  const html = fs.readFileSync(file, "utf8");
  const expectedToken = source.expectedToken || "西藏";
  if (html.length < 5 * 1024 || !html.includes("西藏") || !html.includes(expectedToken)) {
    throw new Error(`${source.id} source page is too small or missing expected tokens: ${file}`);
  }
  return file;
}

async function ensureRawFiles(rawDir, useCache) {
  fs.mkdirSync(rawDir, { recursive: true });
  const files = {};
  for (const [key, source] of Object.entries(SOURCES)) {
    if (source.notices) {
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

function isSpecialXzmuRow(subjectRaw, majorName, controlLineRaw, minScore) {
  return subjectRaw === "高职" || !controlLineRaw || minScore < 100 || /体育|播音/.test(majorName);
}

function buildXzmuRecords(html) {
  const tables = tablesFromHtml(html);
  const table = tables.find((item) => item.includes("分专业录取情况") || (item.includes("专业名称") && item.includes("控制线")));
  if (!table) throw new Error("Could not locate XZMU major table");
  const rows = rowsFromTable(table).slice(1);
  const records = [];
  for (const row of rows) {
    if (row.length !== 9) throw new Error(`Unexpected XZMU row shape: ${JSON.stringify(row)}`);
    const [yearRaw, provinceRaw, admissionCategory, subjectRaw, majorName, maxScoreRaw, minScoreRaw, avgScoreRaw, controlLineRaw] = row;
    if (Number(yearRaw) !== 2025 || provinceRaw !== PROVINCE) throw new Error(`Unexpected XZMU row: ${JSON.stringify(row)}`);
    const minScore = integerValue(minScoreRaw, "XZMU min score");
    const maxScore = integerValue(maxScoreRaw, "XZMU max score");
    const special = isSpecialXzmuRow(subjectRaw, majorName, controlLineRaw, minScore);
    const controlLineLabel = controlLineRaw ? `控制线${controlLineRaw}` : "无控制线";
    const internalGroup = `${admissionCategory}|${controlLineLabel}`;
    const idBase = [2025, "xzmu", internalGroup, subjectRaw, majorName, minScore].join("|");
    const record = {
      id: `2025-xzmu-xizang-major-${hash(idBase, 16)}`,
      province: provinceRaw,
      year: 2025,
      subjectType: subjectType(subjectRaw),
      sourceSubjectRaw: subjectRaw,
      batch: subjectRaw === "高职" ? "高职（专科）批" : "本科批",
      ...baseSchoolFields("xzmu"),
      dataType: "major-admission",
      majorName,
      majorGroup: internalGroup,
      admissionType: "普招",
      admissionSubtype: internalGroup,
      xizangCandidateCategory: admissionCategory,
      sourceControlLineGroup: controlLineLabel,
      formalScoreScope: special ? "special-path-only" : "school-official-only",
      minScore,
      maxScore,
      avgScore: numberValue(avgScoreRaw, "XZMU avg score"),
      scoreOnly: true,
      rankUnavailable: true,
      sourceScoreScale: special ? "source-professional-or-special-path-score" : "source-cultural-score",
      cautions: special
        ? specialPathCautions(SOURCES.xzmu.schoolName, ["西藏民族大学源页同时包含汉族及区外少数民族、区内少数民族、体育艺术和对口高职口径；体育、播音、对口高职或无控制线记录不得与普通文化课批次混用。"])
        : schoolOfficialCautions(SOURCES.xzmu.schoolName, ["西藏民族大学源页按汉族及区外少数民族、区内少数民族拆分，必须按考生类别单独复核。"]),
      rawText: row.join(" / "),
    };
    const controlLine = numberValue(controlLineRaw, "XZMU control line");
    if (Number.isInteger(controlLine)) record.controlLine = controlLine;
    records.push(record);
  }
  if (records.length !== 96) throw new Error(`Unexpected XZMU record count: ${records.length}`);
  return records;
}

function buildHhxyRecords(files) {
  const records = [];
  for (let i = 0; i < SOURCES.hhxy.notices.length; i += 1) {
    const notice = SOURCES.hhxy.notices[i];
    const html = fs.readFileSync(files[i], "utf8");
    const table = tablesFromHtml(html).find((item) => item.includes("录取专业") && item.includes("最低分"));
    if (!table) throw new Error(`Could not locate HHXY table: ${files[i]}`);
    for (const row of expandedRowsFromTable(table).slice(2)) {
      if (!row[0].includes(notice.subjectRaw)) continue;
      const [subjectRaw, majorName, admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw] = row;
      const minScore = integerValue(minScoreRaw, "HHXY min score");
      const idBase = [2025, "hhxy", subjectRaw, majorName, minScore].join("|");
      records.push({
        id: `2025-hhxy-xizang-major-${hash(idBase, 16)}`,
        province: PROVINCE,
        year: 2025,
        subjectType: notice.subjectType,
        sourceSubjectRaw: subjectRaw,
        batch: "本科批",
        ...baseSchoolFields("hhxy"),
        dataType: "major-admission",
        majorName,
        admissionType: "普通类",
        formalScoreScope: "school-official-only",
        admissionCount: integerValue(admissionCountRaw, "HHXY admission count"),
        minScore,
        maxScore: integerValue(maxScoreRaw, "HHXY max score"),
        avgScore: numberValue(avgScoreRaw, "HHXY avg score"),
        scoreOnly: true,
        rankUnavailable: true,
        sourceScoreScale: "source-declared-comprehensive-score",
        cautions: schoolOfficialCautions(SOURCES.hhxy.schoolName, ["黑河学院源表表头为“综合分”，使用前需回看源表口径，不得与省级文化总分投档表混同。"]),
        rawText: row.join(" / "),
      });
    }
  }
  if (records.length !== 4) throw new Error(`Unexpected HHXY record count: ${records.length}`);
  return records;
}

function buildJnuRecords(html) {
  const table = tablesFromHtml(html).find((item) => item.includes("批次") && item.includes("专业名称") && item.includes("最低分"));
  if (!table) throw new Error("Could not locate JNU Xizang table");
  const records = [];
  for (const row of expandedRowsFromTable(table).slice(1)) {
    if (row[0].includes("汇总")) continue;
    if (row.length < 9) throw new Error(`Unexpected JNU row shape: ${JSON.stringify(row)}`);
    const [batch, subjectRaw, campus, college, majorName, admissionCountRaw, maxScoreRaw, avgScoreRaw, minScoreRaw] = row;
    const minScore = integerValue(minScoreRaw, "JNU min score");
    const idBase = [2025, "jnu-neidi", subjectRaw, campus, college, majorName, minScore].join("|");
    records.push({
      id: `2025-jnu-xizang-neidi-class-major-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: 2025,
      subjectType: subjectType(subjectRaw),
      sourceSubjectRaw: subjectRaw,
      batch,
      ...baseSchoolFields("jnu"),
      dataType: "major-admission",
      campus,
      college,
      majorName,
      admissionType: "西藏内地高中班",
      admissionSubtype: "西藏内地高中班",
      formalScoreScope: "special-path-only",
      admissionCount: integerValue(admissionCountRaw, "JNU admission count"),
      minScore,
      maxScore: integerValue(maxScoreRaw, "JNU max score"),
      avgScore: numberValue(avgScoreRaw, "JNU avg score"),
      scoreOnly: true,
      rankUnavailable: true,
      cautions: specialPathCautions(SOURCES.jnu.schoolName, ["暨南大学源页标题明确为西藏内地高中班录取分数线，不能与普通西藏考生本科一批边界混用。"]),
      rawText: row.join(" / "),
    });
  }
  if (records.length !== 8) throw new Error(`Unexpected JNU record count: ${records.length}`);
  return records;
}

function splitXjtluScoreCell(value, label) {
  const matches = [...String(value).matchAll(/(\d+)\s*（(藏线|汉线)）/g)];
  if (matches.length !== 2) throw new Error(`Could not parse XJTLU ${label}: ${value}`);
  return matches.map((match) => ({ score: integerValue(match[1], `XJTLU ${label}`), category: match[2] }));
}

function buildXjtluRecords(html) {
  const start = html.indexOf("<h4>西藏自治区</h4>");
  if (start < 0) throw new Error("Could not locate XJTLU Xizang section");
  const section = html.slice(start, html.indexOf("</table>", start) + "</table>".length);
  const table = tablesFromHtml(section)[0];
  if (!table) throw new Error("Could not locate XJTLU Xizang table");
  const records = [];
  for (const row of rowsFromTable(table).slice(1)) {
    if (row.length !== 5) throw new Error(`Unexpected XJTLU row shape: ${JSON.stringify(row)}`);
    const [subjectRaw, planCountRaw, admissionCountRaw, maxScoreCell, minScoreCell] = row;
    const maxScores = splitXjtluScoreCell(maxScoreCell, "max score");
    const minScores = splitXjtluScoreCell(minScoreCell, "min score");
    for (const minEntry of minScores) {
      const maxEntry = maxScores.find((item) => item.category === minEntry.category);
      if (!maxEntry) throw new Error(`Missing XJTLU max score category ${minEntry.category}`);
      const subject = subjectType(subjectRaw);
      const idBase = [2025, "xjtlu", subjectRaw, minEntry.category, minEntry.score].join("|");
      records.push({
        id: `2025-xjtlu-xizang-summary-${hash(idBase, 16)}`,
        province: PROVINCE,
        year: 2025,
        subjectType: subject,
        sourceSubjectRaw: subjectRaw,
        batch: "本科批",
        ...baseSchoolFields("xjtlu"),
        dataType: "institution-admission",
        majorName: `${subjectRaw}类分省录取边界（${minEntry.category}）`,
        majorGroup: minEntry.category,
        admissionType: "普通类",
        admissionSubtype: minEntry.category,
        xizangCandidateCategory: minEntry.category,
        formalScoreScope: "school-official-only",
        planCount: integerValue(planCountRaw, "XJTLU plan count"),
        admissionCount: integerValue(admissionCountRaw, "XJTLU admission count"),
        minScore: minEntry.score,
        maxScore: maxEntry.score,
        scoreOnly: true,
        rankUnavailable: true,
        cautions: schoolOfficialCautions(SOURCES.xjtlu.schoolName, ["西交利物浦大学源表按藏线/汉线拆分同一科类最高分和最低分，必须按考生类别单独复核。"]),
        rawText: row.join(" / "),
      });
    }
  }
  if (records.length !== 4) throw new Error(`Unexpected XJTLU record count: ${records.length}`);
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

function sourceNoteFor(sourceKey, records, rawFiles) {
  const source = SOURCES[sourceKey];
  const files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
  const metaFile = files.find((file) => file.endsWith(".html") || file.endsWith(".htm"));
  const meta = metaFile ? pageMeta(fs.readFileSync(metaFile, "utf8")) : {};
  const urls = source.notices ? source.notices.map((notice) => notice.url) : [source.url];
  return {
    id: source.id,
    title: meta.title || source.schoolName,
    publisher: source.schoolName,
    publishedAt: meta.publishedAt || undefined,
    modifiedAt: meta.modifiedAt || undefined,
    url: urls.join(" ; "),
    quality: source.quality,
    usage: `抽取${source.schoolName}官方页面中西藏录取分数，生成单校 score-only 边界。`,
    parsedRecords: records.length,
    rawPaths: files.map((file) => path.relative(PROJECT_ROOT, file)),
    sha256: files.map((file) => ({ path: path.relative(PROJECT_ROOT, file), sha256: sha256File(file) })),
    cautions: [
      "本源为高校官方单校录取数据，不是西藏自治区教育考试院全量投档/录取分数表。",
      "普通单校分数按 formalScoreScope=school-official-only 保留，不参与 formalScoreMissingProvinces 闭合统计。",
      "内地班、体育艺术、对口高职或其他限制入口记录按 formalScoreScope=special-path-only 隔离。",
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
    xzmu: buildXzmuRecords(html("xzmu")),
    hhxy: buildHhxyRecords(files.hhxy),
    jnu: buildJnuRecords(html("jnu")),
    xjtlu: buildXjtluRecords(html("xjtlu")),
  };
  const records = Object.values(grouped).flat();
  const diagnostics = diagnosticsFor(records);
  if (diagnostics.totalRows !== 112 || diagnostics.rankRows !== 0 || diagnostics.specialPathRows !== 17) {
    throw new Error(`Unexpected v3.159 Xizang school batch diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const sourceNotes = Object.entries(grouped).map(([key, items]) => sourceNoteFor(key, items, files[key]));
  const payload = {
    dataset: "official-xizang-school-admission-2025-v3159-batch-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      sourceKind: "school-official-single-university-score-batch",
      schools: [...new Set(records.map((record) => record.schoolName))],
    },
    notes: [
      "本文件由 scripts/import-official-xizang-school-admission-2025-v3159-batch.mjs 自动生成。",
      "来源为西藏民族大学、黑河学院、暨南大学和西交利物浦大学官方招生页面。",
      "学校官网单校分数只作候选边界复核，不能替代西藏考试院全量投档/录取分数表。",
      "内地班、体育艺术、对口高职等记录按 special-path-only 隔离；未公开最低位次的记录不生成假位次或录取概率。",
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
