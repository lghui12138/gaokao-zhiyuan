#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-plan-score-2021-2022-v3233-xupt-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-plan-score-2021-2022-v3233-xupt";
const INDEX_URL = "https://zhaosheng.xupt.edu.cn/lqcx.htm";
const PAGE_BASE = "https://zhaosheng.xupt.edu.cn/";

const SOURCE = {
  id: "official-xupt-national-2021-2022-school-plan-score",
  quality: "official-school-xupt-2021-admission-2022-plan-national-html",
  schoolCode: "11664",
  schoolName: "西安邮电大学",
  city: "陕西西安",
  publisher: "西安邮电大学本科招生办公室",
  tags: ["陕西", "西安", "西安邮电大学", "邮电", "电子信息", "通信", "计算机"],
};

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-plan-score-2021-2022-v3233-xupt.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-plan-score-2021-2022-v3233-xupt.mjs --use-cache",
    "",
    "Imports 西安邮电大学本科招生信息网 2022 招生计划 + 2021 录取分数 official province pages.",
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

function projectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

function ensureDir(relOrAbs) {
  fs.mkdirSync(path.isAbsolute(relOrAbs) ? relOrAbs : projectPath(relOrAbs), { recursive: true });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 18);
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  return normalizeText(value)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)));
}

function parseNumber(value) {
  const text = normalizeText(value).replace(/[,，]/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseInteger(value) {
  const number = parseNumber(value);
  return number == null ? null : Math.trunc(number);
}

function subjectType(raw) {
  const text = normalizeText(raw);
  if (/文史|文科|历史/.test(text)) return "历史类";
  if (/理工|理科|物理/.test(text)) return "物理类";
  if (/综合|改革|不分/.test(text)) return "综合";
  if (/艺术/.test(text)) return "艺术类";
  if (/体育/.test(text)) return "体育类";
  return text || "官网未列科类";
}

function classify(row) {
  const text = `${row.majorName} ${row.batch} ${row.subjectRaw}`;
  if (/艺术|美术|音乐|舞蹈|播音|书法|表演|设计/.test(text)) {
    return { admissionType: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (/体育|运动训练/.test(text)) {
    return { admissionType: "体育类", formalScoreScope: "special-path-only" };
  }
  if (/国家专项/.test(text)) return { admissionType: "国家专项", formalScoreScope: "special-path-only" };
  if (/地方专项/.test(text)) return { admissionType: "地方专项", formalScoreScope: "special-path-only" };
  if (/高校专项/.test(text)) return { admissionType: "高校专项", formalScoreScope: "special-path-only" };
  if (/预科|少数民族|民族|内高班|西藏班|区内|单列|南疆|定向|公费|优师/.test(text)) {
    return { admissionType: "特殊路径", formalScoreScope: "special-path-only" };
  }
  return { admissionType: "普通录取", formalScoreScope: "school-official-only" };
}

function subtype(row) {
  const text = `${row.majorName} ${row.batch} ${row.subjectRaw}`;
  const values = [];
  for (const [pattern, label] of [
    [/中外合作|合作办学/, "中外合作办学"],
    [/国家专项/, "国家专项"],
    [/地方专项/, "地方专项"],
    [/高校专项/, "高校专项"],
    [/预科/, "预科"],
    [/少数民族|民族|藏族/, "民族/藏族"],
    [/区内/, "区内"],
    [/单列|南疆/, "单列/南疆"],
    [/定向/, "定向"],
    [/艺术|美术|音乐|舞蹈|播音|书法|表演|设计/, "艺术类"],
    [/体育|运动训练/, "体育类"],
  ]) {
    if (pattern.test(text)) values.push(label);
  }
  return values.join("/") || "普通";
}

function slugify(value) {
  const text = normalizeText(value) || "blank";
  const ascii = text.replace(/[()（）/\\\s.]+/g, "-").replace(/[^A-Za-z0-9_-]/g, "");
  return (ascii || sha256(text).slice(0, 10)).slice(0, 42);
}

function requestText(url, redirectCount = 0) {
  const target = new URL(url);
  const transport = target.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method: "GET",
        timeout: 60_000,
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "text/html,application/xhtml+xml,*/*;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer: INDEX_URL,
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectCount >= 5) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          requestText(new URL(res.headers.location, target).toString(), redirectCount + 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString("utf8").replace(/\0/g, "");
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status} for ${url}: ${text.slice(0, 200)}`));
            return;
          }
          resolve(text);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout fetching ${url}`)));
    req.on("error", reject);
    req.end();
  });
}

async function getRaw(rawRoot, rawFile, url, useCache) {
  const abs = path.join(rawRoot, rawFile);
  if (useCache && fs.existsSync(abs)) return fs.readFileSync(abs, "utf8");
  const text = await requestText(url);
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
  return text;
}

function stripTags(value) {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function extractRows(tableHtml) {
  const rows = [];
  for (const tr of tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = [];
    for (const td of tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []) {
      cells.push(stripTags(td));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function isHeaderRow(cells) {
  return /专业名称|生源地|学院名称|招生计划|录取情况|最低位次|在陕专业代号/.test(cells.join(" "));
}

function parseIndexLinks(indexHtml) {
  const links = [];
  for (const match of indexHtml.matchAll(/href="([^"]*lqcx\/fsfzycx\/[^"]+)"[^>]*>([^<]+)<\/a>/g)) {
    const href = decodeEntities(match[1]);
    const province = stripTags(match[2]);
    if (!province || links.some((link) => link.province === province)) continue;
    links.push({ province, href, url: new URL(href, INDEX_URL).toString() });
  }
  return links;
}

function parseProvincePage(html, link, rawFile) {
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [null, ""])[1]);
  const tableMatch = html.match(/西安邮电大学2022年[\s\S]*?(<table[\s\S]*?<\/table>)/i);
  const warnings = [];
  if (!tableMatch) {
    return { rows: [], title, warnings: [{ issue: "main_table_not_found", province: link.province }] };
  }

  const parsedRows = [];
  for (const cells of extractRows(tableMatch[1])) {
    if (isHeaderRow(cells)) continue;
    let row = null;
    if (cells.length === 11) {
      const [province, majorName, collegeName, subjectRaw, batch, planCountRaw, maxScoreRaw, avgScoreRaw, minScoreRaw, controlLineRaw, lineDiffRaw] = cells;
      if (province !== link.province) continue;
      row = {
        province,
        majorName,
        collegeName,
        subjectRaw,
        batch,
        planCount: parseInteger(planCountRaw),
        planCountRaw,
        maxScore: parseNumber(maxScoreRaw),
        avgScore: parseNumber(avgScoreRaw),
        minScore: parseNumber(minScoreRaw),
        minRank: null,
        minRankRaw: null,
        controlLine: parseNumber(controlLineRaw),
        lineDiff: parseNumber(lineDiffRaw),
        maxScoreRaw,
        avgScoreRaw,
        minScoreRaw,
        controlLineRaw,
        lineDiffRaw,
        remarkRaw: null,
      };
    } else if (link.province === "陕西" && cells.length === 10) {
      const [batch, subjectRaw, collegeName, localMajorCodeRaw, majorName, planCountRaw, maxScoreRaw, minScoreRaw, minRankRaw, remarkRaw] = cells;
      row = {
        province: link.province,
        majorName,
        collegeName,
        subjectRaw,
        batch,
        planCount: parseInteger(planCountRaw),
        planCountRaw,
        maxScore: parseNumber(maxScoreRaw),
        avgScore: null,
        minScore: parseNumber(minScoreRaw),
        minRank: parseInteger(minRankRaw),
        minRankRaw,
        controlLine: null,
        lineDiff: null,
        maxScoreRaw,
        avgScoreRaw: null,
        minScoreRaw,
        controlLineRaw: null,
        lineDiffRaw: null,
        localMajorCodeRaw,
        remarkRaw,
      };
    } else {
      continue;
    }
    if (!row.majorName || !row.subjectRaw || !row.batch || row.planCount == null) {
      warnings.push({ issue: "bad_data_row", cells });
      continue;
    }
    parsedRows.push(row);
  }

  if (!parsedRows.length) warnings.push({ issue: "no_data_rows", province: link.province });
  return { rows: parsedRows, title, warnings, rawFile };
}

function planRecord(row, page, rawFile, rowIndex) {
  const st = subjectType(row.subjectRaw);
  const cls = classify(row);
  return {
    id: `xupt-plan-${stableId([2022, row.province, row.subjectRaw, row.batch, row.majorName, row.planCount, rowIndex])}`,
    year: 2022,
    province: row.province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    collegeName: row.collegeName,
    batch: row.batch,
    subjectType: st,
    majorName: row.majorName,
    dataType: "admission-plan",
    admissionType: cls.admissionType,
    admissionSubtype: subtype(row),
    planCount: row.planCount,
    minScore: null,
    minRank: null,
    schoolOfficialScope: true,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: page.url,
    sourcePageUrl: page.url,
    sourceIndexUrl: INDEX_URL,
    sourcePageTitle: page.title || `${row.province}${SOURCE.schoolName}2022年招生计划`,
    sourcePageKey: `xupt-${row.province}-2022-plan-2021-score`,
    officialEvidencePath: `${RAW_DIR}/${rawFile}`,
    sourceProvinceRaw: row.province,
    sourceSubjectRaw: row.subjectRaw,
    sourceBatchRaw: row.batch,
    sourceMajorRaw: row.majorName,
    sourcePlanCountRaw: row.planCountRaw,
    rawRow: row,
    cautions: [
      "该行来自西安邮电大学本科招生信息网 2022 年分省分专业招生来源计划表，只表示 2022 年单校招生专业池和计划数约束。",
      "招生计划不是投档线、录取最低分、最低位次或录取概率；正式填报需回到当年省级考试院计划、院校招生章程和最新投档/录取结果复核。",
    ],
  };
}

function admissionRecord(row, page, rawFile, rowIndex) {
  const st = subjectType(row.subjectRaw);
  const cls = classify(row);
  const record = {
    id: `xupt-score-${stableId([2021, row.province, row.subjectRaw, row.batch, row.majorName, row.minScore, row.maxScore, rowIndex])}`,
    year: 2021,
    province: row.province,
    city: SOURCE.city,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    schoolTags: SOURCE.tags,
    collegeName: row.collegeName,
    batch: row.batch,
    subjectType: st,
    majorName: row.majorName,
    dataType: "major-admission",
    admissionType: cls.admissionType,
    admissionSubtype: subtype(row),
    formalScoreScope: cls.formalScoreScope,
    schoolOfficialScope: true,
    minScore: row.minScore,
    maxScore: row.maxScore,
    avgScore: row.avgScore,
    controlLine: row.controlLine,
    lineDiff: row.lineDiff,
    minRank: row.minRank,
    minRankStart: row.minRank,
    minRankEnd: row.minRank,
    rankUnavailable: row.minRank == null,
    scoreOnly: row.minRank == null,
    scoreMetric: cls.admissionType === "艺术类" || cls.admissionType === "体育类"
      ? "综合/专业或文化分，按官网原表口径"
      : "高考文化分，按官网原表口径",
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    sourceUrl: page.url,
    sourcePageUrl: page.url,
    sourceIndexUrl: INDEX_URL,
    sourcePageTitle: page.title || `${row.province}${SOURCE.schoolName}2021年录取情况`,
    sourcePageKey: `xupt-${row.province}-2022-plan-2021-score`,
    officialEvidencePath: `${RAW_DIR}/${rawFile}`,
    sourceProvinceRaw: row.province,
    sourceSubjectRaw: row.subjectRaw,
    sourceBatchRaw: row.batch,
    sourceMajorRaw: row.majorName,
    sourceMaxScoreRaw: row.maxScoreRaw,
    sourceAverageScoreRaw: row.avgScoreRaw,
    sourceMinScoreRaw: row.minScoreRaw,
    sourceMinRankRaw: row.minRankRaw,
    sourceControlLineRaw: row.controlLineRaw,
    sourceLineDiffRaw: row.lineDiffRaw,
    sourceRemarkRaw: row.remarkRaw,
    rawRow: row,
    cautions: [
      "学校官网单校分数按 formalScoreScope=school-official-only 或 special-path-only 保留，不替代省级考试院全量投档/录取表。",
      row.minRank == null
        ? "源行未公开最低位次；运行层不生成假位次或仅凭单校行输出录取概率。"
        : "源行公开最低位次；该位次仅按西安邮电大学官网单校行保留，不替代省级考试院全量投档位次表。",
    ],
  };
  if (row.province === "西藏") {
    record.cautions.push("西藏行仅为西安邮电大学官网单校分数；源表未细分汉族/少数民族或区内类别时，不参与省级全量闭合。");
  }
  return record;
}

function incrementCounter(target, key, by = 1) {
  target[key] = (target[key] || 0) + by;
}

function range(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric.length) return null;
  return [Math.min(...numeric), Math.max(...numeric)];
}

function writeJson(rel, value) {
  fs.writeFileSync(projectPath(rel), `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  ensureDir(rawRoot);
  ensureDir(path.dirname(projectPath(args.out)));

  const indexHtml = await getRaw(rawRoot, "xupt-lqcx-index.html", INDEX_URL, args.useCache);
  const links = parseIndexLinks(indexHtml);
  const pageSummaries = [];
  const skippedPages = [];
  const records = [];

  for (const [pageIndex, link] of links.entries()) {
    const rawFile = `xupt-${slugify(link.province)}-${path.basename(link.href)}`;
    try {
      const html = await getRaw(rawRoot, rawFile, link.url, args.useCache);
      const page = parseProvincePage(html, link, rawFile);
      page.url = link.url;
      let parsedPlan = 0;
      let parsedAdmission = 0;
      for (const [rowIndex, row] of page.rows.entries()) {
        if (row.planCount != null && row.planCount > 0) {
          records.push(planRecord(row, page, rawFile, rowIndex + 1));
          parsedPlan += 1;
        }
        if (row.minScore != null && row.minScore > 0) {
          records.push(admissionRecord(row, page, rawFile, rowIndex + 1));
          parsedAdmission += 1;
        }
      }
      pageSummaries.push({
        pageIndex: pageIndex + 1,
        province: link.province,
        url: link.url,
        rawFile: `${RAW_DIR}/${rawFile}`,
        sha256: sha256(fs.readFileSync(path.join(rawRoot, rawFile))),
        dataRows: page.rows.length,
        parsedPlanRecords: parsedPlan,
        parsedAdmissionRecords: parsedAdmission,
        warnings: page.warnings || [],
      });
    } catch (error) {
      skippedPages.push({
        province: link.province,
        url: link.url,
        rawFile: `${RAW_DIR}/${rawFile}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const duplicateRecords = [];
  const deduped = [];
  const seen = new Set();
  for (const record of records) {
    const key = [
      record.dataType,
      record.year,
      record.province,
      record.subjectType,
      record.batch,
      record.majorName,
      record.planCount,
      record.minScore,
      record.formalScoreScope,
      record.minRank,
    ].join("\t");
    if (seen.has(key)) {
      duplicateRecords.push(record);
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }

  const formalScoreScopeCounts = {};
  const subjectTypeCounts = {};
  const provinceCounts = {};
  const yearCounts = {};
  const admissionTypeCounts = {};
  const admissionSubtypeCounts = {};
  const recordTypeCounts = {};
  for (const record of deduped) {
    incrementCounter(formalScoreScopeCounts, record.formalScoreScope || "plan-only");
    incrementCounter(subjectTypeCounts, record.subjectType);
    incrementCounter(provinceCounts, record.province);
    incrementCounter(yearCounts, String(record.year));
    incrementCounter(admissionTypeCounts, record.admissionType);
    incrementCounter(admissionSubtypeCounts, record.admissionSubtype || "普通");
    incrementCounter(recordTypeCounts, record.dataType);
  }

  const rawFiles = [
    `${RAW_DIR}/xupt-lqcx-index.html`,
    ...pageSummaries.map((summary) => summary.rawFile),
  ];
  const admissionRecords = deduped.filter((record) => record.dataType === "major-admission");
  const planRecords = deduped.filter((record) => record.dataType === "admission-plan");
  const sourceNote = {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "西安邮电大学本科招生信息网 2022 年分省分专业招生计划与 2021 年录取情况",
    url: INDEX_URL,
    quality: SOURCE.quality,
    usage:
      "学校官网单校 2022 招生计划和 2021 专业录取分数；可用于西安邮电大学候选专业池、通信/电子信息方向历史边界和西藏/新疆单校分数加厚，不替代任何省级考试院全量投档/录取表。",
    rawDir: RAW_DIR,
    rawFiles,
    parsedRecords: deduped.length,
    planRecords: planRecords.length,
    admissionRecords: admissionRecords.length,
    duplicateRecordsSkipped: duplicateRecords.length,
    skippedPages,
    pageCount: pageSummaries.length,
    pageSummaries,
    indexSha256: sha256(fs.readFileSync(path.join(rawRoot, "xupt-lqcx-index.html"))),
    provincesWithRecords: Object.keys(provinceCounts).sort(),
    provinceCount: Object.keys(provinceCounts).length,
    years: Object.keys(yearCounts).sort(),
    yearCounts,
    subjectTypeCounts,
    formalScoreScopeCounts,
    admissionTypeCounts,
    admissionSubtypeCounts,
    recordTypeCounts,
    scoreRange: range(admissionRecords.map((record) => record.minScore)),
    recordsRankUnavailable: admissionRecords.filter((record) => record.rankUnavailable).length,
    recordsWithMinRank: admissionRecords.filter((record) => record.minRank != null).length,
    xizangRecords: deduped.filter((record) => record.province === "西藏").length,
    xizangAdmissionRecords: admissionRecords.filter((record) => record.province === "西藏").length,
    xinjiangRecords: deduped.filter((record) => record.province === "新疆").length,
    xinjiangAdmissionRecords: admissionRecords.filter((record) => record.province === "新疆").length,
    boundaryNotes: [
      "2022 招生计划记录只作专业池和计划数约束，不参与录取最低分、投档线或概率计算。",
      "2021 录取分数记录为学校官网单校分数；陕西页公开最低位次则保留位次，其余未公开最低位次的源行统一 rankUnavailable=true。",
      "school-official-only 只作单校候选边界复核，不参与 formalScoreMissingProvinces 省级全量闭合。",
      "专项、民族、区内、艺术体育、定向等特殊路径按 special-path-only 隔离。",
    ],
  };

  const output = {
    dataset: "official-national-school-plan-score-2021-2022-v3233-xupt",
    generatedAt: new Date().toISOString(),
    scope: {
      school: SOURCE.schoolName,
      years: Object.keys(yearCounts).sort(),
      provinceCount: Object.keys(provinceCounts).length,
      pageCount: pageSummaries.length,
    },
    notes: sourceNote.boundaryNotes,
    sourceNotes: [sourceNote],
    records: deduped,
    audit: {
      totalRecords: deduped.length,
      planRecords: planRecords.length,
      admissionRecords: admissionRecords.length,
      duplicateRecordsSkipped: duplicateRecords.length,
      duplicateRecords: duplicateRecords.slice(0, 50),
      skippedPages,
      pageCount: pageSummaries.length,
      pageWarnings: pageSummaries.flatMap((summary) => summary.warnings || []),
      formalScoreScopeCounts,
      subjectTypeCounts,
      provinceCounts,
      yearCounts,
      admissionTypeCounts,
      admissionSubtypeCounts,
      recordTypeCounts,
      scoreRange: sourceNote.scoreRange,
      recordsRankUnavailable: sourceNote.recordsRankUnavailable,
      recordsWithMinRank: sourceNote.recordsWithMinRank,
      xizangRecords: sourceNote.xizangRecords,
      xizangAdmissionRecords: sourceNote.xizangAdmissionRecords,
      xinjiangRecords: sourceNote.xinjiangRecords,
      xinjiangAdmissionRecords: sourceNote.xinjiangAdmissionRecords,
    },
  };

  writeJson(args.out, output);
  console.log(
    JSON.stringify(
      {
        out: args.out,
        records: deduped.length,
        planRecords: planRecords.length,
        admissionRecords: admissionRecords.length,
        pageCount: pageSummaries.length,
        skippedPages: skippedPages.length,
        pageWarnings: output.audit.pageWarnings.length,
        duplicateRecordsSkipped: duplicateRecords.length,
        provinceCount: Object.keys(provinceCounts).length,
        yearCounts,
        recordTypeCounts,
        formalScoreScopeCounts,
        subjectTypeCounts,
        scoreRange: sourceNote.scoreRange,
        recordsRankUnavailable: sourceNote.recordsRankUnavailable,
        recordsWithMinRank: sourceNote.recordsWithMinRank,
        xizangRecords: sourceNote.xizangRecords,
        xizangAdmissionRecords: sourceNote.xizangAdmissionRecords,
        xinjiangRecords: sourceNote.xinjiangRecords,
        xinjiangAdmissionRecords: sourceNote.xinjiangAdmissionRecords,
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
