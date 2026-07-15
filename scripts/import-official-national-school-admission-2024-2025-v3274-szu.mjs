#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2024-2025-v3274-szu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2024-2025-v3274-szu";
const INDEX_URLS = [
  "https://zs.szu.edu.cn/index/lnfs/lnfs2.htm",
  "https://zs.szu.edu.cn/index/lnfs/lnfs2/2.htm",
];
const SOURCE = {
  id: "official-szu-national-2024-2025-school-admission",
  quality: "official-school-szu-2024-2025-first-choice-major-admission",
  schoolCode: "10590",
  schoolName: "深圳大学",
  city: "深圳",
  publisher: "深圳大学本科招生网",
  tags: ["广东", "深圳大学", "综合类", "省属重点", "信息类特色"],
};
const MAINLAND_PROVINCES = new Set([
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
]);

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2024-2025-v3274-szu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2024-2025-v3274-szu.mjs --use-cache",
    "",
    "Imports Shenzhen University official 2024-2025 province-level major admission pages.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--out") {
      args.out = argv[++index];
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
    throw new Error("Refusing direct mac_2T processing; run from the internal APFS project copy.");
  }
}

function projectPath(relativePath) {
  return path.resolve(PROJECT_ROOT, relativePath);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
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
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(html) {
  return cleanText(String(html ?? "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<\/p>/gi, " ").replace(/<[^>]+>/g, ""));
}

function parseNumber(value) {
  const text = cleanText(value).replace(/[,，]/g, "");
  if (!text || /^(?:--?|—|\/|无)$/.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function attrNumber(attrs, key, fallback = 1) {
  const match = String(attrs ?? "").match(new RegExp(`${key}\\s*=\\s*["']?(\\d+)`, "i"));
  return match ? Number(match[1]) : fallback;
}

function extractTables(html) {
  const tables = [];
  for (const match of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    tables.push({ html: match[0], offset: match.index ?? 0 });
  }
  return tables;
}

function expandTableRows(tableHtml) {
  const active = new Map();
  const rows = [];
  for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => ({
      text: cellText(cell[2]),
      colspan: attrNumber(cell[1], "colspan"),
      rowspan: attrNumber(cell[1], "rowspan"),
    }));
    if (!cells.length && !active.size) continue;
    const row = [];
    let cellIndex = 0;
    let column = 0;
    while (cellIndex < cells.length || active.size) {
      if (active.has(column)) {
        const slot = active.get(column);
        row[column] = slot.text;
        if (slot.rowsLeft <= 1) active.delete(column);
        else active.set(column, { ...slot, rowsLeft: slot.rowsLeft - 1 });
        column += 1;
        continue;
      }
      if (cellIndex >= cells.length) {
        const nextActive = [...active.keys()].filter((key) => key > column).sort((left, right) => left - right)[0];
        if (nextActive == null) break;
        column = nextActive;
        continue;
      }
      const cell = cells[cellIndex++];
      for (let offset = 0; offset < cell.colspan; offset += 1) {
        row[column + offset] = cell.text;
        if (cell.rowspan > 1) active.set(column + offset, { text: cell.text, rowsLeft: cell.rowspan - 1 });
      }
      column += cell.colspan;
    }
    rows.push(row);
  }
  return rows;
}

function tableTitle(rows) {
  const cells = rows.slice(0, 4).flat().map(cleanText).filter(Boolean);
  const explicitTitle = cells.find((cell) => /深圳大学.*(?:录取情况|录取分数|分数)/.test(cell));
  if (explicitTitle) return explicitTitle;
  return cells.join(" ").slice(0, 220);
}

function normalizeProvince(value) {
  const text = cleanText(value);
  for (const province of MAINLAND_PROVINCES) {
    if (text.startsWith(province) || text.includes(province)) return province;
  }
  return "";
}

function normalizeSubject(value, province) {
  const text = cleanText(value);
  if (/体育/.test(text)) return "体育类";
  if (/艺术|美术|音乐|舞蹈|表演|播音/.test(text)) return "艺术类";
  if (/历史|文史|文科/.test(text)) return "历史类";
  if (/物理|理工|理科/.test(text)) return "物理类";
  if (/综合|改革/.test(text) || ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合";
  return text || "官网未列科类";
}

function categoryForXizang(rawProvince) {
  const text = cleanText(rawProvince);
  if (/A类/.test(text)) return "A类考生";
  if (/B类/.test(text)) return "B类考生";
  return null;
}

function classifyPath(recordText) {
  if (/地方专项|国家专项|高校专项|边境专项/.test(recordText)) return { scope: "special-path-only", type: "专项计划", subtype: "专项计划" };
  if (/艺术|体育|美术|音乐|舞蹈|表演|播音/.test(recordText)) return { scope: "special-path-only", type: "艺术体育", subtype: "艺术体育" };
  if (/提前批|预科|定向|公费师范|优师|军校|公安|警察|军士/.test(recordText)) return { scope: "special-path-only", type: "限定路径", subtype: "限定路径" };
  if (/中外合作/.test(recordText)) return { scope: "special-path-only", type: "中外合作办学", subtype: "中外合作办学" };
  return { scope: "school-official-only", type: "普通录取", subtype: "普通类" };
}

function parseMajorTable(rows, page) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /专业/.test(cell)) && row.some((cell) => /2025/.test(cell)) && row.some((cell) => /2024/.test(cell)));
  if (headerIndex < 0 || !rows[headerIndex + 1]) return [];
  const header = rows[headerIndex].map(cleanText);
  const title = tableTitle(rows.slice(0, headerIndex + 1));
  const hasProvinceAndSubject = header.some((cell) => /区域|省市/.test(cell)) && header.some((cell) => /科类/.test(cell));
  const hasCollege = header.some((cell) => /学院|部/.test(cell));
  const metadataColumns = hasProvinceAndSubject ? 3 : hasCollege ? 3 : 3;
  // Rowspan cells from the first header are expanded into the second header row.
  // Only the trailing cells describe the repeated year statistics.
  const stats = rows[headerIndex + 1].slice(metadataColumns).map(cleanText);
  const statCount = Math.floor(stats.length / 2);
  const minScoreOffset = stats.slice(0, statCount).findIndex((cell) => /最低分/.test(cell));
  const minRankOffset = stats.slice(0, statCount).findIndex((cell) => /最低排位|最低位次/.test(cell));
  if (statCount < 4 || minScoreOffset < 0) return [];

  const titleProvince = normalizeProvince(title) || page.province;
  const titleSubject = normalizeSubject(title, titleProvince);
  const records = [];
  for (const row of rows.slice(headerIndex + 2)) {
    const values = row.map(cleanText);
    if (values.length < metadataColumns + statCount || !values.some(Boolean)) continue;
    const rawProvince = hasProvinceAndSubject ? values[0] : titleProvince;
    const province = normalizeProvince(rawProvince) || titleProvince;
    if (!MAINLAND_PROVINCES.has(province)) continue;
    const rawSubject = hasProvinceAndSubject ? values[1] : titleSubject;
    const subjectType = normalizeSubject(rawSubject, province);
    const majorName = hasProvinceAndSubject ? values[2] : values[2];
    if (!majorName || /招生专业|专业名称/.test(majorName)) continue;
    const programGroup = hasCollege ? `专业组${values[0] || "未列"}` : "";
    const college = hasCollege ? values[1] : "";
    const sourceContext = `${title} ${rawProvince} ${rawSubject} ${majorName} ${programGroup} ${college}`;
    const pathMeta = classifyPath(sourceContext);

    for (const [yearOffset, year] of [[0, 2025], [statCount, 2024]]) {
      const start = metadataColumns + yearOffset;
      const minScore = parseNumber(values[start + minScoreOffset]);
      if (minScore == null) continue;
      const maxScore = parseNumber(values[start + 1]);
      const avgScore = parseNumber(values[start + 2]);
      const minRank = minRankOffset >= 0 ? parseNumber(values[start + minRankOffset]) : null;
      const candidateCategory = province === "西藏" ? categoryForXizang(rawProvince) : null;
      const id = `${year}-szu-${stableId([province, rawProvince, rawSubject, majorName, programGroup, pathMeta.scope, year])}`;
      records.push({
        id,
        province,
        sourceProvinceRaw: rawProvince,
        year,
        subjectType,
        sourceSubjectRaw: rawSubject,
        candidateCategory,
        batch: "本科批",
        schoolName: SOURCE.schoolName,
        schoolCode: SOURCE.schoolCode,
        schoolTags: SOURCE.tags,
        city: SOURCE.city,
        dataType: "major-admission",
        majorName,
        majorGroup: programGroup || undefined,
        college: college || undefined,
        maxScore: maxScore ?? undefined,
        avgScore: avgScore ?? undefined,
        minScore,
        minRankStart: minRank ?? undefined,
        minRankEnd: minRank ?? undefined,
        rankUnavailable: minRank == null,
        sourceQuality: SOURCE.quality,
        sourceId: SOURCE.id,
        sourceUrl: page.url,
        sourcePublishedAt: page.publishedAt || undefined,
        sourceTableTitle: title,
        sourceFirstChoice: true,
        admissionType: pathMeta.type,
        admissionSubtype: pathMeta.subtype,
        formalScoreScope: pathMeta.scope,
        cautions: [
          "来源为深圳大学本科招生网单校录取记录，不能替代省级教育考试院全量投档/录取表。",
          minRank == null ? "官网未公开该行最低位次，不能估造位次或仅凭分数生成录取概率。" : "官网公开最低位次，可用于深圳大学单校专业候选复核。",
        ],
      });
    }
  }
  return records;
}

function extractPublishedAt(html) {
  const match = html.match(/时间：\s*(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}` : null;
}

function sourcePagesFromIndex(html) {
  const pages = [];
  for (const match of html.matchAll(/href="(?:\.\.\/){2,3}(info\/1153\/(\d+)\.htm)"[^>]*title="([^"]+)"/g)) {
    const province = normalizeProvince(match[3]);
    if (province) pages.push({ province, url: new URL(match[1], "https://zs.szu.edu.cn/").href, sourceId: match[2] });
  }
  return pages;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function getRaw(rawRoot, fileName, url, useCache) {
  const file = path.join(rawRoot, fileName);
  if (useCache && fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file, "utf8");
  const html = await fetchText(url);
  fs.writeFileSync(file, html.endsWith("\n") ? html : `${html}\n`);
  return html;
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function range(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return numeric.length ? { min: Math.min(...numeric), max: Math.max(...numeric) } : null;
}

function dedupe(records) {
  const seen = new Set();
  const duplicateIds = [];
  const result = [];
  for (const record of records) {
    if (seen.has(record.id)) duplicateIds.push(record.id);
    else {
      seen.add(record.id);
      result.push(record);
    }
  }
  return { records: result, duplicateIds };
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = projectPath(RAW_DIR);
  fs.mkdirSync(rawRoot, { recursive: true });
  fs.mkdirSync(path.dirname(projectPath(args.out)), { recursive: true });

  const indexPages = [];
  const pageMap = new Map();
  for (const [index, url] of INDEX_URLS.entries()) {
    const fileName = `szu-index-${index + 1}.html`;
    const html = await getRaw(rawRoot, fileName, url, args.useCache);
    if (!/深圳大学本科招生网|历年分数/.test(html)) throw new Error(`Official index identity check failed for ${url}`);
    indexPages.push({ url, rawFile: `${RAW_DIR}/${fileName}` });
    for (const page of sourcePagesFromIndex(html)) pageMap.set(page.province, page);
  }
  const pages = [...pageMap.values()].sort((left, right) => left.province.localeCompare(right.province, "zh-CN"));
  if (pages.length !== 30) throw new Error(`Expected 30 official province pages, found ${pages.length}`);
  if (pages.some((page) => !MAINLAND_PROVINCES.has(page.province))) throw new Error("Index returned an invalid province");

  const rawRecords = [];
  const pageSummaries = [];
  for (const page of pages) {
    const fileName = `szu-${page.sourceId}-${page.province}.html`;
    const html = await getRaw(rawRoot, fileName, page.url, args.useCache);
    if (!/深圳大学|录取/.test(html)) throw new Error(`Official province identity check failed for ${page.province}`);
    const pageInfo = { ...page, rawFile: `${RAW_DIR}/${fileName}`, publishedAt: extractPublishedAt(html) };
    const tables = extractTables(html);
    const tableRecords = tables.flatMap((table) => parseMajorTable(expandTableRows(table.html), pageInfo));
    rawRecords.push(...tableRecords);
    pageSummaries.push({
      province: page.province,
      url: page.url,
      rawFile: pageInfo.rawFile,
      sha256: sha256File(projectPath(pageInfo.rawFile)),
      publishedAt: pageInfo.publishedAt,
      tables: tables.length,
      records: tableRecords.length,
      years: [...new Set(tableRecords.map((record) => record.year))].sort(),
    });
  }

  const { records, duplicateIds } = dedupe(rawRecords);
  if (!records.length) throw new Error("No Shenzhen University admission records parsed");
  const provinces = {};
  const years = {};
  const subjects = {};
  const scopes = {};
  for (const record of records) {
    increment(provinces, record.province);
    increment(years, String(record.year));
    increment(subjects, record.subjectType);
    increment(scopes, record.formalScoreScope);
  }
  const rawFiles = [...indexPages.map((page) => page.rawFile), ...pageSummaries.map((page) => page.rawFile)];
  const sourceNote = {
    id: SOURCE.id,
    publisher: SOURCE.publisher,
    title: "深圳大学本科招生网历年分数（2024-2025）",
    url: INDEX_URLS[0],
    indexUrls: INDEX_URLS,
    quality: SOURCE.quality,
    usage: "深圳大学官网分省分专业录取最低分与公开最低位次，只用于深圳大学单校候选边界、专业趋势和全国候选加厚；不替代省级教育考试院全量投档/录取表，也不单独生成录取概率。",
    rawDir: RAW_DIR,
    rawFiles,
    rawSha256: Object.fromEntries(rawFiles.map((file) => [path.basename(file), sha256File(projectPath(file))])),
    parsedRecords: records.length,
    rawRecords: rawRecords.length,
    duplicateRecordsSkipped: duplicateIds.length,
    pageSummaries,
    provinceCount: Object.keys(provinces).length,
    provincesWithRecords: Object.keys(provinces).sort(),
    yearCounts: years,
    subjectTypeCounts: subjects,
    formalScoreScopeCounts: scopes,
    recordsWithRank: records.filter((record) => record.minRankEnd != null).length,
    recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
    xizangRecords: records.filter((record) => record.province === "西藏").length,
    specialPathRecords: records.filter((record) => record.formalScoreScope === "special-path-only").length,
    boundaryNotes: [
      "页面声明录取分数按第一次投档情况统计，但这是深圳大学单校官网数据，不是省级教育考试院全量投档/录取表。",
      "官网未公开最低位次的行保持rankUnavailable=true，不估造位次或录取概率。",
      "地方专项、艺术体育、提前、预科、定向、中外合作等限定路径按special-path-only隔离。",
      "西藏A/B类别保留candidateCategory，不能跨类别或跨省混用。",
    ],
  };
  const output = {
    dataset: "official-national-school-admission-2024-2025-v3274-szu",
    generatedAt: new Date().toISOString(),
    scope: { school: SOURCE.schoolName, provinceCount: Object.keys(provinces).length, years: Object.keys(years).sort(), pageCount: pages.length },
    notes: sourceNote.boundaryNotes,
    sourceNotes: [sourceNote],
    records,
    audit: {
      totalRecords: records.length,
      rawRecords: rawRecords.length,
      duplicateRecordsSkipped: duplicateIds.length,
      duplicateIds: duplicateIds.slice(0, 50),
      provinceCounts: provinces,
      yearCounts: years,
      subjectTypeCounts: subjects,
      formalScoreScopeCounts: scopes,
      scoreRange: range(records.map((record) => record.minScore)),
      rankRange: range(records.map((record) => record.minRankEnd)),
      recordsWithRank: sourceNote.recordsWithRank,
      recordsRankUnavailable: sourceNote.recordsRankUnavailable,
      xizangRecords: sourceNote.xizangRecords,
      specialPathRecords: sourceNote.specialPathRecords,
      pageSummaries,
    },
  };
  fs.writeFileSync(projectPath(args.out), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: args.out,
    records: records.length,
    rawRecords: rawRecords.length,
    duplicateRecordsSkipped: duplicateIds.length,
    provinces: Object.keys(provinces).length,
    yearCounts: years,
    scopes,
    recordsWithRank: sourceNote.recordsWithRank,
    rankUnavailable: sourceNote.recordsRankUnavailable,
    xizangRecords: sourceNote.xizangRecords,
    specialPathRecords: sourceNote.specialPathRecords,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
