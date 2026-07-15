#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2026;
const PROVINCE = "西藏";
const DEFAULT_URL = "http://zsks.edu.xizang.gov.cn/71/74/7901.html";
const DEFAULT_OUT = "data/admissions/official-xizang-art-unprovince-plan-2026-import.json";
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-xizang-art-unprovince-plan-2026");
const SOURCE_ID = "official-xizang-art-unprovince-plan-2026";
const SOURCE_QUALITY = "official-xizang-2026-art-unprovince-plan-docx-plan-only";

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-art-unprovince-plan-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-art-unprovince-plan-2026.mjs --docx tmp/official-xizang-art-unprovince-plan-2026/art-unprovince-plan.docx",
    "",
    "Imports the Tibet 2026 art no-province-plan DOCX as plan-only records.",
    "The source has no per-province plan counts or filing scores, so planCount and minScore remain null.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--url") args.url = argv[++i];
    else if (item === "--html") args.html = argv[++i];
    else if (item === "--docx") args.docx = argv[++i];
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function hash(value, length = 18) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function cleanText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHtmlText(value) {
  return cleanText(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

async function download(url, accept) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-xizang-art-unprovince-plan-importer/1.0",
      accept,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 160 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}`,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function extractPageMeta(html, pageUrl) {
  const title = cleanHtmlText(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
  const publishedAt = cleanHtmlText(/<span class="date">([^<]+)<\/span>/i.exec(html)?.[1] || "");
  const publisher = cleanHtmlText(/<span class="from">来源：([^<]+)<\/span>/i.exec(html)?.[1] || "西藏自治区教育考试院");
  if (!/西藏自治区2026年普通高等学校招生艺术类不分省计划填报志愿/.test(title)) {
    throw new Error(`Unexpected Tibet art no-province-plan page title: ${title}`);
  }
  const docxHref = /<a[^>]+href=["']([^"']+\.docx)["'][^>]*>/i.exec(html)?.[1];
  if (!docxHref) throw new Error("Could not find art no-province-plan DOCX link");
  return {
    title,
    publishedAt,
    publisher,
    docxUrl: new URL(docxHref, pageUrl).href,
  };
}

async function ensureInputs(args) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const htmlPath = path.join(TMP_ROOT, "page.html");
  let html = "";
  let pageMeta = {
    title: "关于西藏自治区2026年普通高等学校招生艺术类不分省计划填报志愿的通知",
    publishedAt: "",
    publisher: "西藏自治区教育考试院",
    docxUrl: "",
  };
  if (args.html) {
    html = fs.readFileSync(path.resolve(args.html), "utf8");
    pageMeta = extractPageMeta(html, args.url);
  } else if (!args.docx) {
    const htmlBuffer = await download(args.url, "text/html,application/xhtml+xml");
    html = htmlBuffer.toString("utf8");
    fs.writeFileSync(htmlPath, htmlBuffer);
    pageMeta = extractPageMeta(html, args.url);
  } else if (fs.existsSync(htmlPath)) {
    html = fs.readFileSync(htmlPath, "utf8");
    try {
      pageMeta = extractPageMeta(html, args.url);
    } catch {
      // Local DOCX reruns can still be deterministic without the page HTML.
    }
  }

  const docxPath = args.docx
    ? path.resolve(args.docx)
    : path.join(TMP_ROOT, "art-unprovince-plan.docx");
  if (!args.docx && (!fs.existsSync(docxPath) || fs.statSync(docxPath).size === 0)) {
    fs.writeFileSync(docxPath, await download(pageMeta.docxUrl, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
  }
  if (!fs.existsSync(docxPath) || fs.statSync(docxPath).size === 0) {
    throw new Error(`Art no-province-plan DOCX is missing: ${docxPath}`);
  }
  return {
    htmlPath: fs.existsSync(htmlPath) ? htmlPath : "",
    html,
    pageMeta,
    docxPath,
  };
}

function xmlText(element) {
  return cleanText([...String(element || "").matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join(" "));
}

function cellsForRow(rowXml) {
  return [...String(rowXml || "").matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
    .map((match) => xmlText(match[0]));
}

function normalizeHeading(value) {
  return cleanText(value).replace(/\s+/g, "");
}

function disciplineCodesForMajor(majorName, remark = "") {
  const text = `${majorName} ${remark}`;
  const pairs = [
    ["05", /播音|新闻|传播|戏剧影视文学|广播电视/],
    ["13", /艺术|设计|美术|音乐|舞蹈|表演|动画|影视|服装|绘画|雕塑|摄影|戏剧|导演|作曲|录音|书法|产品设计|环境设计|视觉传达|数字媒体/],
  ];
  return pairs.filter(([, pattern]) => pattern.test(text)).map(([code]) => code);
}

function parseDocxPlan(docxPath) {
  const xml = run("/usr/bin/unzip", ["-p", docxPath, "word/document.xml"]);
  const body = /<w:body[^>]*>([\s\S]*?)<\/w:body>/.exec(xml)?.[1];
  if (!body) throw new Error("Could not read word/document.xml body from DOCX");
  const tokens = [...body.matchAll(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g)]
    .map((match) => ({
      type: match[1],
      xml: match[0],
      text: match[1] === "p" ? xmlText(match[0]) : "",
    }));

  const records = [];
  const tableSummaries = [];
  let subjectType = "";
  let tableIndex = 0;

  for (const token of tokens) {
    if (token.type === "p") {
      const text = normalizeHeading(token.text);
      if (text === "文史类") subjectType = "历史类";
      if (text === "理工类") subjectType = "物理类";
      continue;
    }

    tableIndex += 1;
    let currentSchool = null;
    let recordCount = 0;
    const schoolKeys = new Set();
    const rows = [...token.xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((match) => match[0]);
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const cells = cellsForRow(rows[rowIndex]);
      const firstParts = (cells[0] || "").split(/\s+/).map((item) => item.trim()).filter(Boolean);
      if (firstParts.length >= 2 && /^\d{4}$/.test(firstParts[0])) {
        currentSchool = {
          code: firstParts[0],
          name: firstParts.slice(1).join(""),
        };
        schoolKeys.add(`${currentSchool.code}|${currentSchool.name}`);
        continue;
      }
      if (!currentSchool || firstParts.length < 2) continue;
      if (!/^[0-9A-Z]{2,3}$/.test(firstParts[0])) continue;
      const duration = cells[1] || "";
      if (!/年/.test(duration)) continue;
      const majorCode = firstParts[0];
      const majorName = firstParts.slice(1).join("");
      const tuition = cells[2] || "";
      const direction = cells[3] || "";
      const remark = cells[4] || "";
      const recordIdBase = [
        YEAR,
        PROVINCE,
        "艺术类不分省计划",
        subjectType,
        currentSchool.code,
        currentSchool.name,
        majorCode,
        majorName,
        direction,
        rowIndex,
      ].join("|");
      records.push({
        id: `${YEAR}-xizang-art-unprovince-plan-${hash(recordIdBase)}`,
        province: PROVINCE,
        year: YEAR,
        subjectType,
        sourceSubjectRaw: subjectType,
        batch: "全国计划自主本科",
        schoolName: currentSchool.name,
        schoolCode: currentSchool.code,
        schoolTags: [
          "招生计划",
          "艺术类",
          "不分省计划",
          "校考合格",
          ...(remark.includes("师范") ? ["师范教育"] : []),
        ],
        city: PROVINCE,
        dataType: "admission-plan",
        majorName,
        majorCode,
        majorGroup: `${currentSchool.code}-${majorCode}`,
        disciplineCodes: disciplineCodesForMajor(majorName, remark),
        planCount: null,
        minScore: null,
        minRankStart: null,
        minRankEnd: null,
        rankRangeText: "",
        tuition,
        duration,
        applicationDirection: direction,
        note: remark,
        planSourceType: "艺术类不分省计划",
        planOnly: true,
        sourceId: SOURCE_ID,
        sourceQuality: SOURCE_QUALITY,
        cautions: [
          "这是西藏自治区教育考试院公布的2026年艺术类不分省计划，只说明可填报院校专业、学制、学费、方向和备注。",
          "原表不公布分省计划数、投档线、录取最低分或位次；本记录不能用于普通批次录取概率。",
          "该计划要求艺术类统考合格且相应高校校考合格，正式填报还必须核对院校招生章程和西藏志愿填报系统。",
        ],
      });
      recordCount += 1;
    }
    tableSummaries.push({
      tableIndex,
      subjectType,
      batch: "全国计划自主本科",
      records: recordCount,
      schools: schoolKeys.size,
    });
  }

  return { records, tableSummaries };
}

function validate(records, tableSummaries) {
  const errors = [];
  if (records.length !== 950) errors.push({ type: "record-count", expected: 950, actual: records.length });
  const subjects = new Set(records.map((record) => record.subjectType));
  for (const subject of ["历史类", "物理类"]) {
    if (!subjects.has(subject)) errors.push({ type: "missing-subject", subject });
  }
  const duplicateIds = records.length - new Set(records.map((record) => record.id)).size;
  if (duplicateIds) errors.push({ type: "duplicate-ids", duplicateIds });
  const badCounts = records.filter((record) => record.planCount !== null || record.minScore !== null || record.minRankEnd !== null);
  if (badCounts.length) errors.push({ type: "unexpected-score-or-plan-count", samples: badCounts.slice(0, 3) });
  const missingContext = tableSummaries.filter((item) => !item.subjectType || !item.records);
  if (missingContext.length) errors.push({ type: "missing-table-context", samples: missingContext });
  return errors;
}

function summarize(records, tableSummaries) {
  const bySubject = Object.fromEntries(
    [...new Set(records.map((record) => record.subjectType))]
      .map((subjectType) => [subjectType, {
        records: records.filter((record) => record.subjectType === subjectType).length,
        schools: new Set(records.filter((record) => record.subjectType === subjectType).map((record) => `${record.schoolCode}|${record.schoolName}`)).size,
      }])
  );
  return {
    records: records.length,
    schools: new Set(records.map((record) => `${record.schoolCode}|${record.schoolName}`)).size,
    bySubject,
    byBatch: tableSummaries,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const { htmlPath, html, pageMeta, docxPath } = await ensureInputs(args);
  const parsed = parseDocxPlan(docxPath);
  const errors = validate(parsed.records, parsed.tableSummaries);
  if (errors.length) {
    throw new Error(`Tibet art no-province-plan validation failed:\n${JSON.stringify(errors, null, 2)}`);
  }
  const summary = summarize(parsed.records, parsed.tableSummaries);
  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    dataset: path.basename(args.out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "西藏 2026 艺术类不分省计划（官方 DOCX）",
    notes: [
      "本文件由 scripts/import-official-xizang-art-unprovince-plan-2026.mjs 自动生成。",
      "该 DOCX 是西藏自治区教育考试院 2026 年艺术类不分省计划，导入为 admission-plan 计划层。",
      "原表不含分省计划数、投档线、录取最低分或位次，因此 planCount、minScore、minRank 均保持为空。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: pageMeta.title,
        publisher: pageMeta.publisher,
        url: args.url,
        publishedAt: pageMeta.publishedAt,
        quality: SOURCE_QUALITY,
        usage: `官方 DOCX 抽取西藏${YEAR}艺术类不分省计划${summary.records}条专业约束、${summary.schools}所院校；只作艺术类校考候选专业池和资格提醒，不作录取分/位次预测。`,
        parsedRecords: summary.records,
        schoolCount: summary.schools,
        docxUrl: pageMeta.docxUrl || "",
        docxPath: rel(docxPath),
        docxBytes: fs.statSync(docxPath).size,
        docxSha256: sha256File(docxPath),
        htmlPath: htmlPath ? rel(htmlPath) : "",
        htmlBytes: html ? Buffer.byteLength(html) : 0,
        htmlSha256: html ? sha256(html) : "",
        bySubject: summary.bySubject,
        byBatch: summary.byBatch,
        caution: "艺术类不分省计划不是普通类投档线，也不计作西藏一分一段或正式投档/录取最低分闭合。",
      },
    ],
    records: parsed.records.sort((a, b) =>
      String(a.subjectType || "").localeCompare(String(b.subjectType || ""), "zh-Hans-CN") ||
      String(a.schoolCode || "").localeCompare(String(b.schoolCode || ""), "zh-Hans-CN") ||
      String(a.majorCode || "").localeCompare(String(b.majorCode || ""), "zh-Hans-CN") ||
      String(a.majorName || "").localeCompare(String(b.majorName || ""), "zh-Hans-CN")
    ),
    stats: summary,
  }, null, 2));
  console.log(JSON.stringify({
    ok: true,
    out: rel(outPath),
    records: summary.records,
    schools: summary.schools,
    bySubject: summary.bySubject,
    docxSha256: sha256File(docxPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
