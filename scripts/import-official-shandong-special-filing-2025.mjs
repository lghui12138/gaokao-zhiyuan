#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-shandong-special-filing-2025-import.json";
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-shandong-special-filing-2025");
const SOFFICE = process.env.SOFFICE || "/opt/homebrew/bin/soffice";
const SOURCE_ID = "official-shandong-special-filing-2025";
const SOURCE_QUALITY = "official-shandong-2025-art-sports-special-filing-xls-score-rank";
const YEAR = 2025;
const PAGE_CONFIGS = [
  { id: 6985, subjectType: "体育类", batch: "体育类常规批第1次志愿", expectedLinks: 1, defaultLayer: "本科" },
  { id: 6986, subjectType: "艺术类", batch: "艺术类本科批第1次志愿", expectedLinks: 6 },
  { id: 7001, subjectType: "艺术类", batch: "艺术类本科批第2次志愿", expectedLinks: 6 },
  { id: 7008, subjectType: "体育类", batch: "体育类常规批第2次志愿", expectedLinks: 1 },
  { id: 7009, subjectType: "艺术类", batch: "艺术类专科批第1次志愿", expectedLinks: 6, defaultLayer: "专科" },
  { id: 7017, subjectType: "体育类", batch: "体育类常规批第3次志愿", expectedLinks: 1, defaultLayer: "专科" },
  { id: 7018, subjectType: "艺术类", batch: "艺术类专科批第2次志愿", expectedLinks: 4, defaultLayer: "专科" },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-shandong-special-filing-2025.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-shandong-special-filing-2025.mjs --use-cache",
    "",
    "Imports Shandong 2025 art/sports special-category filing XLS files.",
    "These are composite-score filing boundaries; ordinary regular-batch Shandong rows remain rank-only.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stderr?.trim(),
      result.stdout?.slice(0, 2000)?.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function hash(value, length = 16) {
  return sha256(String(value)).slice(0, length);
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function cleanHtmlText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(content) {
  return String(content)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(parseCsvLine);
}

function cleanNumberText(value) {
  return String(value ?? "").replace(/[,，]/g, "").trim();
}

function parseInteger(value) {
  const text = cleanNumberText(value);
  return /^\d+$/.test(text) ? Number(text) : null;
}

function parseScore(value) {
  const text = cleanNumberText(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function parseRank(value) {
  const text = cleanNumberText(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const rank = Number(text);
    return { minRankStart: rank, minRankEnd: rank, rankRangeText: text };
  }
  return null;
}

function splitCodeName(value, codePattern) {
  const text = String(value ?? "").trim();
  const match = codePattern.exec(text);
  if (!match) return { code: "", name: text };
  return { code: match[1], name: match[2].trim() };
}

function splitMajor(value) {
  return splitCodeName(value, /^([A-Z0-9]{1,3})(.+)$/i);
}

function splitSchool(value) {
  return splitCodeName(value, /^([A-Z][A-Z0-9]{3})(.+)$/i);
}

function categoryFromTitle(title, subjectType) {
  if (subjectType === "体育类") return "体育类";
  const text = String(title ?? "");
  const categories = [
    "美术与设计类",
    "书法类",
    "舞蹈类",
    "音乐类",
    "播音与主持类",
    "表(导)演类",
    "表（导）演类",
  ];
  const category = categories.find((item) => text.includes(item));
  return category ? category.replace("表(导)演类", "表（导）演类") : "艺术类";
}

function disciplineCodes(majorName) {
  const text = String(majorName ?? "");
  const out = new Set();
  if (/体育|运动|体能|休闲/.test(text)) out.add("04");
  if (/音乐|美术|设计|书法|舞蹈|表演|戏剧|影视|播音|主持|动画|摄影|艺术|绘画|雕塑/.test(text)) out.add("13");
  if (/教育|师范/.test(text)) out.add("04");
  if (/数字媒体|新媒体|视觉传达|环境设计|产品设计|艺术科技/.test(text)) out.add("13");
  return [...out];
}

function isVocationalSchool(schoolName) {
  return /职业|高等专科学校|专科学校|高专|职院|技师|职业大学|职业学院/.test(String(schoolName ?? "")) &&
    !/职业技术师范大学/.test(String(schoolName ?? ""));
}

function dataTypeFor({ batch, layer, schoolName }) {
  if (/专科/.test(batch) || layer === "专科" || isVocationalSchool(schoolName)) return "vocational-admission";
  return "major-admission";
}

function schoolTagsFor({ subjectType, batch, category, layer, schoolName, majorName }) {
  const text = `${schoolName} ${majorName}`;
  const tags = ["官方投档线", "山东省考试院", subjectType, batch, category].filter(Boolean);
  if (layer) tags.push(layer);
  if (dataTypeFor({ batch, layer, schoolName }) === "vocational-admission") tags.push("高职/专科");
  if (/山东|济南|青岛|烟台|潍坊|淄博|威海|临沂|泰安|日照|德州|聊城|滨州|枣庄|菏泽|东营/.test(text)) tags.push("山东省内");
  if (/体育|运动|体能|休闲/.test(text)) tags.push("体育类");
  if (/音乐|美术|设计|书法|舞蹈|表演|戏剧|影视|播音|主持|动画|摄影|绘画|雕塑|艺术/.test(text)) tags.push("艺术类");
  if (/师范|教育/.test(text)) tags.push("师范教育");
  if (/中外合作|合作办学|高收费/.test(text)) tags.push("高成本/合作办学");
  return [...new Set(tags)];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-shandong-special-filing-importer/1.0",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

async function download(url, out) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-shandong-special-filing-importer/1.0",
      accept: "application/vnd.ms-excel,application/octet-stream,*/*",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  fs.writeFileSync(out, Buffer.from(await response.arrayBuffer()));
}

function extractLinks(html, pageUrl) {
  return [...html.matchAll(/<a[^>]+href=["']([^"']+\.(?:xls|xlsx))["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
    url: new URL(match[1], pageUrl).href,
    title: cleanHtmlText(match[2]),
  }));
}

function extractPageDate(html) {
  const candidates = [
    /(\d{4}-\d{2}-\d{2})/.exec(html)?.[1],
    /(\d{4}年\d{1,2}月\d{1,2}日)/.exec(html)?.[1],
  ].filter(Boolean);
  return candidates[0] || "";
}

function slugForAttachment(pageId, index, title) {
  const category = categoryFromTitle(title, title.includes("体育") ? "体育类" : "艺术类")
    .replace(/[（）()]/g, "")
    .replace(/类/g, "")
    .replace(/与/g, "")
    .replace(/主持/g, "zhuchi")
    .replace(/播音/g, "boyin")
    .replace(/美术/g, "meishu")
    .replace(/设计/g, "sheji")
    .replace(/书法/g, "shufa")
    .replace(/舞蹈/g, "wudao")
    .replace(/音乐/g, "yinyue")
    .replace(/表导演/g, "biaoyan")
    .replace(/体育/g, "sports")
    .replace(/[^\w-]+/g, "");
  return `${pageId}-${String(index + 1).padStart(2, "0")}-${category || "table"}`;
}

function ensurePageAndFiles(config, args) {
  const pageUrl = `https://www.sdzk.cn/NewsInfo.aspx?NewsID=${config.id}`;
  const pagePath = path.join(TMP_ROOT, `page-${config.id}.html`);
  return { pageUrl, pagePath };
}

function convertToCsv(xlsPath, csvDir) {
  fs.mkdirSync(csvDir, { recursive: true });
  const before = new Set(fs.readdirSync(csvDir));
  run(SOFFICE, ["--headless", "--convert-to", "csv", "--outdir", csvDir, xlsPath]);
  const after = fs.readdirSync(csvDir).filter((name) => name.endsWith(".csv") && !before.has(name));
  if (after.length !== 1) {
    const expected = path.basename(xlsPath).replace(/\.(?:xls|xlsx)$/i, ".csv");
    if (fs.existsSync(path.join(csvDir, expected))) return path.join(csvDir, expected);
    throw new Error(`Expected one converted CSV for ${xlsPath}, got ${after.length}`);
  }
  return path.join(csvDir, after[0]);
}

function parseRows({ csvPath, pageConfig, attachment, pageTitle }) {
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const headerIndex = rows.findIndex((row) => row.join("").includes("投档最低"));
  if (headerIndex < 0) throw new Error(`No filing-score header found in ${csvPath}`);
  const header = rows[headerIndex].map((cell) => cell.replace(/\s+/g, ""));
  const hasLayer = header.includes("层次");
  const category = categoryFromTitle(attachment.title, pageConfig.subjectType);
  const records = [];
  const unparsedRows = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    let cells = rows[index].map((cell) => String(cell ?? "").trim());
    if (!cells.join("")) continue;
    if (!cells[0]) cells = cells.slice(1);
    if (cells.length < 4) continue;
    if (/专业代号|院校代号|投档计划|投档最低|山东省\d{4}年/.test(cells.join(""))) continue;
    let layer = pageConfig.defaultLayer || "";
    let majorText;
    let schoolText;
    let planText;
    let scoreText;
    let rankText = "";
    if (hasLayer) {
      [layer, majorText, schoolText, planText, scoreText, rankText = ""] = cells;
    } else {
      [majorText, schoolText, planText, scoreText, rankText = ""] = cells;
    }
    const major = splitMajor(majorText);
    const school = splitSchool(schoolText);
    const planCount = parseInteger(planText);
    const minScore = parseScore(scoreText);
    const rank = parseRank(rankText);
    if (!major.name || !school.name || !Number.isFinite(planCount) || !Number.isFinite(minScore)) {
      unparsedRows.push({ line: index + 1, cells });
      continue;
    }
    const dataType = dataTypeFor({ batch: pageConfig.batch, layer, schoolName: school.name });
    const scoreKind = pageConfig.subjectType === "体育类" ? "体育类综合分" : "艺术类综合分";
    const rankUsage = pageConfig.subjectType === "体育类" ? "sports" : "art";
    const idBase = [
      YEAR,
      "山东",
      pageConfig.subjectType,
      pageConfig.batch,
      category,
      layer,
      school.code,
      school.name,
      major.code,
      major.name,
      scoreText,
      rank?.rankRangeText || "",
    ].join("|");
    const cautions = [
      `本记录来自山东省教育招生考试院${pageConfig.batch}投档情况表，按${scoreKind}和${category}使用，不是普通类文化成绩投档线。`,
      "艺术/体育综合分、双达线位次和普通类文化成绩位次不得互相混用。",
      "院校专业投档边界不能替代最终专业录取结果；正式填报仍需核验当年招生计划、招生章程、专业备注和省考试院后续公告。",
    ];
    if (!rank) cautions.push("原表本轮未提供最低双达线位次，本记录不生成假位次。");
    records.push({
      id: `${YEAR}-shandong-special-${hash(idBase, 18)}`,
      province: "山东",
      year: YEAR,
      subjectType: pageConfig.subjectType,
      batch: pageConfig.batch,
      schoolName: school.name,
      schoolCode: school.code,
      schoolTags: schoolTagsFor({
        subjectType: pageConfig.subjectType,
        batch: pageConfig.batch,
        category,
        layer,
        schoolName: school.name,
        majorName: major.name,
      }),
      dataType,
      majorName: major.name,
      majorCode: major.code,
      majorGroup: category,
      disciplineCodes: disciplineCodes(major.name),
      planCount,
      minScore,
      minRankStart: rank?.minRankStart ?? null,
      minRankEnd: rank?.minRankEnd ?? null,
      rankRangeText: rank?.rankRangeText ?? "",
      scoreKind,
      rankUsage,
      rankCategory: category,
      rankLevelUsage: layer || "",
      sourceId: SOURCE_ID,
      sourceQuality: SOURCE_QUALITY,
      sourceAttachmentTitle: attachment.title,
      sourceAttachmentUrl: attachment.url,
      sourcePageTitle: pageTitle,
      cautions,
    });
  }
  return { records, unparsedRows, header, hasLayer, category };
}

function dedupeRecords(records) {
  const map = new Map();
  for (const record of records) {
    const key = [
      record.province,
      record.year,
      record.subjectType,
      record.batch,
      record.rankCategory,
      record.rankLevelUsage,
      record.schoolCode,
      record.schoolName,
      record.majorCode,
      record.majorName,
    ].join("|");
    const existing = map.get(key);
    if (!existing || (record.minRankEnd && !existing.minRankEnd)) map.set(key, record);
  }
  return [...map.values()].sort((a, b) =>
    String(a.subjectType).localeCompare(String(b.subjectType), "zh-Hans-CN") ||
    String(a.batch).localeCompare(String(b.batch), "zh-Hans-CN") ||
    String(a.rankCategory).localeCompare(String(b.rankCategory), "zh-Hans-CN") ||
    String(a.schoolName).localeCompare(String(b.schoolName), "zh-Hans-CN") ||
    String(a.majorName).localeCompare(String(b.majorName), "zh-Hans-CN")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const csvDir = path.join(TMP_ROOT, "csv");
  fs.mkdirSync(csvDir, { recursive: true });
  const allRecords = [];
  const pages = [];
  const files = [];
  const parseWarnings = [];

  for (const pageConfig of PAGE_CONFIGS) {
    const { pageUrl, pagePath } = ensurePageAndFiles(pageConfig, args);
    let html;
    if (args.useCache && fs.existsSync(pagePath)) {
      html = fs.readFileSync(pagePath, "utf8");
    } else {
      html = await fetchText(pageUrl);
      fs.writeFileSync(pagePath, html);
    }
    const pageTitle = cleanHtmlText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
    if (!pageTitle.includes(`山东省${YEAR}年`) || !pageTitle.includes("投档情况表")) {
      throw new Error(`Unexpected Shandong page title for ${pageConfig.id}: ${pageTitle}`);
    }
    const links = extractLinks(html, pageUrl);
    if (links.length !== pageConfig.expectedLinks) {
      throw new Error(`Expected ${pageConfig.expectedLinks} XLS links on page ${pageConfig.id}, found ${links.length}`);
    }
    pages.push({
      id: pageConfig.id,
      url: pageUrl,
      title: pageTitle,
      publishedAt: extractPageDate(html),
      htmlPath: rel(pagePath),
      htmlBytes: fs.statSync(pagePath).size,
      htmlSha256: sha256File(pagePath),
      subjectType: pageConfig.subjectType,
      batch: pageConfig.batch,
      linkCount: links.length,
    });

    for (let index = 0; index < links.length; index += 1) {
      const attachment = links[index];
      const slug = slugForAttachment(pageConfig.id, index, attachment.title);
      const xlsPath = path.join(TMP_ROOT, `${slug}.xls`);
      if (!args.useCache || !fs.existsSync(xlsPath)) {
        await download(attachment.url, xlsPath);
      }
      const csvPath = convertToCsv(xlsPath, csvDir);
      const parsed = parseRows({ csvPath, pageConfig, attachment, pageTitle });
      if (parsed.unparsedRows.length) {
        parseWarnings.push({
          attachmentTitle: attachment.title,
          xlsPath: rel(xlsPath),
          unparsedRows: parsed.unparsedRows.slice(0, 10),
          unparsedRowCount: parsed.unparsedRows.length,
        });
      }
      allRecords.push(...parsed.records);
      const scores = parsed.records.map((record) => record.minScore).filter(Number.isFinite);
      const ranks = parsed.records.map((record) => record.minRankEnd).filter(Number.isFinite);
      files.push({
        pageId: pageConfig.id,
        pageUrl,
        pageTitle,
        attachmentTitle: attachment.title,
        attachmentUrl: attachment.url,
        subjectType: pageConfig.subjectType,
        batch: pageConfig.batch,
        category: parsed.category,
        hasLayerColumn: parsed.hasLayer,
        xlsPath: rel(xlsPath),
        xlsBytes: fs.statSync(xlsPath).size,
        xlsSha256: sha256File(xlsPath),
        csvPath: rel(csvPath),
        csvBytes: fs.statSync(csvPath).size,
        csvSha256: sha256File(csvPath),
        records: parsed.records.length,
        planCount: parsed.records.reduce((sum, record) => sum + (Number(record.planCount) || 0), 0),
        rankedRecords: ranks.length,
        scoreRange: scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : null,
        rankRange: ranks.length ? { min: Math.min(...ranks), max: Math.max(...ranks) } : null,
      });
    }
  }

  const records = dedupeRecords(allRecords);
  const duplicateCount = allRecords.length - records.length;
  const scores = records.map((record) => record.minScore).filter(Number.isFinite);
  const ranks = records.map((record) => record.minRankEnd).filter(Number.isFinite);
  const planCount = records.reduce((sum, record) => sum + (Number(record.planCount) || 0), 0);
  const bySubject = Object.fromEntries(["艺术类", "体育类"].map((subject) => [subject, records.filter((record) => record.subjectType === subject).length]));
  const byDataType = records.reduce((acc, record) => {
    acc[record.dataType] = (acc[record.dataType] || 0) + 1;
    return acc;
  }, {});
  const byBatch = records.reduce((acc, record) => {
    acc[record.batch] = (acc[record.batch] || 0) + 1;
    return acc;
  }, {});
  const byCategory = records.reduce((acc, record) => {
    const key = `${record.subjectType}:${record.rankCategory}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const out = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    dataset: path.basename(out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "山东省2025年艺术/体育特殊类别投档综合分",
    notes: [
      "本文件由 scripts/import-official-shandong-special-filing-2025.mjs 自动生成。",
      "来源为山东省教育招生考试院 2025 年艺术类本科批、艺术类专科批、体育类常规批投档情况表 XLS。",
      "原表包含投档最低分（综合分）；部分批次还包含最低双达线位次。本导入只保存官方给出的分数和位次，不生成假位次。",
      "艺术类、体育类综合分按 rankUsage/rankCategory/rankLevelUsage 隔离，不能与普通类文化成绩或普通类常规批 rank-only 表混用。",
      "山东普通类常规批官方投档表仍是 rank-only，不能因本文件而宣称山东普通类已有 native minScore。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: "山东省2025年艺术类/体育类投档情况表",
        publisher: "山东省教育招生考试院",
        url: "https://www.sdzk.cn/NewsList.aspx?BCID=1198&CID=47",
        quality: SOURCE_QUALITY,
        usage: `自动抽取山东省2025年艺术/体育特殊类别投档综合分${records.length}条，投档计划数${planCount}名；按特殊类别综合分进档边界使用，不替代普通类最低分或最终专业录取结果。`,
        parsedRecords: records.length,
        parsedFiles: files,
        pages,
        fileCount: files.length,
        pageCount: pages.length,
        duplicateCount,
        parseWarningCount: parseWarnings.length,
        bySubject,
        byDataType,
        byBatch,
        byCategory,
        scoreRange: scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : null,
        rankRange: ranks.length ? { min: Math.min(...ranks), max: Math.max(...ranks) } : null,
        caution: "Special-category composite-score filing boundaries only. Shandong ordinary regular-batch filing rows remain rank-only.",
      },
    ],
    stats: {
      records: records.length,
      allParsedBeforeDedupe: allRecords.length,
      duplicateCount,
      planCount,
      schools: new Set(records.map((record) => record.schoolName)).size,
      scoreRange: scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : null,
      rankedRecords: ranks.length,
      rankRange: ranks.length ? { min: Math.min(...ranks), max: Math.max(...ranks) } : null,
      bySubject,
      byDataType,
      byBatch,
      byCategory,
      fileCount: files.length,
      pageCount: pages.length,
      parseWarnings,
    },
    records,
  }, null, 2), "utf8");

  if (parseWarnings.length) {
    throw new Error(`Unexpected unparsed Shandong special filing rows: ${JSON.stringify(parseWarnings.slice(0, 3), null, 2)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    out: rel(out),
    records: records.length,
    allParsedBeforeDedupe: allRecords.length,
    duplicateCount,
    planCount,
    schools: new Set(records.map((record) => record.schoolName)).size,
    scoreRange: scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : null,
    rankedRecords: ranks.length,
    rankRange: ranks.length ? { min: Math.min(...ranks), max: Math.max(...ranks) } : null,
    bySubject,
    byDataType,
    byBatch,
    byCategory,
    fileCount: files.length,
    pageCount: pages.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
