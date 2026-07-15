#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-sichuan-control-lines-2026-import.json";
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-sichuan-control-lines-2026");
const YEAR = 2026;
const PROVINCE = "四川";
const SOURCE_ID = "official-sichuan-control-lines-2026";
const SOURCE_QUALITY = "official-sichuan-control-line-html-verified";

const PAGES = [
  {
    id: "ordinary",
    url: "https://www.sceea.cn/Html/202606/Newsdetail_4853.html",
    title: "官方发布！四川省2026年普通高校招生录取控制分数线",
    publishedAt: "2026/6/25 17:26:34",
    assertions: ["历史类", "本科批次：455分", "高职（专科）批次：150分", "特殊类型招生录取控制分数线：525分", "物理类", "本科批次：435 分", "特殊类型招生录取控制分数线：519分"],
  },
  {
    id: "counterpart",
    url: "https://www.sceea.cn/Html/202606/Newsdetail_4854.html",
    title: "官方发布！四川省2026年普通高校对口招生录取控制分数线",
    publishedAt: "2026/6/25 17:39:12",
    assertions: ["农林牧渔类 503分", "财经商贸类 535分", "计算机类 535分", "医药类 539分", "各专业类别（不含文化艺术类）均为 140分"],
  },
  {
    id: "minority-language",
    url: "https://www.sceea.cn/Html/202606/Newsdetail_4855.html",
    title: "官方发布！四川省2026年原“少数民族语言授课为主”招生录取控制分数线",
    publishedAt: "2026/6/25 17:41:57",
    assertions: ["藏文类：历史类 320分", "物理类305分", "彝文类：历史类 365分", "物理类315分", "历史类 150分", "物理类150分"],
  },
  {
    id: "art-sports",
    url: "https://www.sceea.cn/Html/202606/Newsdetail_4856.html",
    title: "官方发布！四川省2026年普通高等学校艺术体育类招生录取控制分数线",
    publishedAt: "2026/6/25 18:02:27",
    assertions: ["音乐教育类", "文化：335分；专业：170分", "体育类", "文化：320分；专业：70分", "戏曲类省际联考本科专业高考文化课录取控制分数线：218分"],
  },
];

const COUNTERPART_CATEGORIES = [
  ["农林牧渔类", 503],
  ["土木水利类", 525],
  ["财经商贸类", 535],
  ["计算机类", 535],
  ["电子信息类", 482],
  ["智能制造类", 445],
  ["公共管理与服务类", 503],
  ["旅游类", 469],
  ["餐饮类", 532],
  ["纺织服装类", 510],
  ["医药类", 539],
  ["护理类", 532],
  ["交通技术与服务类", 494],
  ["材料化工与资源环境类", 528],
  ["教育类", 492],
  ["汽车类", 491],
];

const ART_SPORTS_LINES = [
  ["本科", "音乐教育类", 335, 170, ["13"]],
  ["本科", "音乐表演类", 305, 190, ["13"]],
  ["本科", "舞蹈类", 265, 180, ["13"]],
  ["本科", "表（导）演类（戏剧影视表演方向）", 340, 210, ["13"]],
  ["本科", "表（导）演类（服装表演方向）", 335, 170, ["13"]],
  ["本科", "表（导）演类（戏剧影视导演方向）", 410, 220, ["13"]],
  ["本科", "播音与主持类", 350, 200, ["13"]],
  ["本科", "美术与设计类", 330, 205, ["13"]],
  ["本科", "书法类", 365, 205, ["13"]],
  ["本科", "美术与设计类（对口招生）", 210, 205, ["13"]],
  ["本科", "体育类", 320, 70, ["04"]],
  ["高职（专科）", "音乐教育类", 140, 135, ["13"]],
  ["高职（专科）", "音乐表演类", 140, 150, ["13"]],
  ["高职（专科）", "舞蹈类", 140, 165, ["13"]],
  ["高职（专科）", "表（导）演类（戏剧影视表演方向）", 140, 175, ["13"]],
  ["高职（专科）", "表（导）演类（服装表演方向）", 140, 120, ["13"]],
  ["高职（专科）", "表（导）演类（戏剧影视导演方向）", 140, 180, ["13"]],
  ["高职（专科）", "播音与主持类", 140, 185, ["13"]],
  ["高职（专科）", "美术与设计类", 140, 165, ["13"]],
  ["高职（专科）", "书法类", 140, 195, ["13"]],
  ["高职（专科）", "美术与设计类（对口招生）", 120, 165, ["13"]],
  ["高职（专科）", "体育类", 140, 60, ["04"], "三州考生专业控制线 50 分。"],
  ["本科", "戏曲类省际联考", 218, 180, ["13"], "省际联考本科专业高考文化课录取控制分数线 218 分，专业课成绩合格线 180 分。"],
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-sichuan-control-lines-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-sichuan-control-lines-2026.mjs --use-cache",
    "",
    "Options:",
    "  --out PATH   output JSON path",
    "  --use-cache  reuse tmp official HTML pages if present",
    "",
    "Notes:",
    "  - Imports official Sichuan 2026 ordinary/counterpart/minority-language/art/sports score-control lines.",
    "  - Control lines are batch/category eligibility boundaries, not filing/admission records.",
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&#32;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/\u00a0/g, " ");
}

function cleanHtmlText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

function compactText(value) {
  return cleanHtmlText(value).replace(/\s+/g, "");
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-sichuan-control-importer/1.0",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

function pageTitle(html) {
  return cleanHtmlText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
}

function pagePublishedAt(html) {
  return cleanHtmlText(/日期:([^|]+)\|/.exec(html)?.[1] || "");
}

function assertPage(page, html) {
  const title = pageTitle(html);
  const publishedAt = pagePublishedAt(html);
  const text = compactText(html);
  if (title !== page.title) {
    throw new Error(`Unexpected Sichuan page title for ${page.id}: ${title}`);
  }
  if (publishedAt !== page.publishedAt) {
    throw new Error(`Unexpected Sichuan page publish time for ${page.id}: ${publishedAt}`);
  }
  const missing = page.assertions.filter((expected) => !text.includes(expected.replace(/\s+/g, "")));
  if (missing.length) {
    throw new Error(`Sichuan control-line page ${page.id} missing expected values: ${missing.join(", ")}`);
  }
  return { title, publishedAt, text };
}

function baseRecord({ sourcePageId, subjectType, batch, majorName, majorGroup, minScore, disciplineCodes = [], extra = {} }) {
  const idBase = [YEAR, PROVINCE, subjectType, batch, majorName, majorGroup, minScore, sourcePageId].join("|");
  return {
    id: `${YEAR}-${hash(idBase, 16)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType,
    batch,
    schoolName: "四川省2026年普通高校招生录取控制分数线",
    schoolTags: ["批次控制线", majorGroup],
    city: "四川",
    dataType: "control-line",
    majorName,
    majorCode: "",
    majorGroup,
    disciplineCodes,
    minScore,
    cultureScoreLine: minScore,
    rankRangeText: "",
    sourceId: SOURCE_ID,
    sourceQuality: SOURCE_QUALITY,
    controlLineKind: majorGroup,
    sourcePageId,
    cautions: [
      "这是四川省教育考试院公布的 2026 年招生录取控制分数线，只能作为批次/类别资格边界。",
      "该记录不是院校投档线、专业录取最低分或最低位次，不能单独生成录取概率。",
      "艺术、体育、对口招生和原少数民族语言授课为主类别需要同时核对招生计划、专业规则、专业成绩和院校章程。",
    ],
    ...extra,
  };
}

function recordsFor() {
  const records = [];
  for (const [subjectType, score, specialScore] of [["历史类", 455, 525], ["物理类", 435, 519]]) {
    records.push(baseRecord({
      sourcePageId: "ordinary",
      subjectType,
      batch: "普通类本科批次控制线",
      majorName: `${subjectType}普通类本科批次控制线`,
      majorGroup: "普通类",
      minScore: score,
    }));
    records.push(baseRecord({
      sourcePageId: "ordinary",
      subjectType,
      batch: "普通类高职（专科）批次控制线",
      majorName: `${subjectType}普通类高职（专科）批次控制线`,
      majorGroup: "普通类",
      minScore: 150,
    }));
    records.push(baseRecord({
      sourcePageId: "ordinary",
      subjectType,
      batch: "特殊类型招生录取控制分数线",
      majorName: `${subjectType}特殊类型招生录取控制分数线`,
      majorGroup: "特殊类型",
      minScore: specialScore,
    }));
  }

  for (const [category, score] of COUNTERPART_CATEGORIES) {
    records.push(baseRecord({
      sourcePageId: "counterpart",
      subjectType: "职教高考",
      batch: "对口招生本科批控制线",
      majorName: `${category}对口招生本科批控制线`,
      majorGroup: category,
      minScore: score,
      extra: { counterpartCategory: category },
    }));
    records.push(baseRecord({
      sourcePageId: "counterpart",
      subjectType: "职教高考",
      batch: "对口招生专科批控制线",
      majorName: `${category}对口招生专科批控制线`,
      majorGroup: category,
      minScore: 140,
      extra: {
        counterpartCategory: category,
        controlLineNote: "四川官方原文为各专业类别（不含文化艺术类）均为 140 分，本地按本科列明类别拆分为同类别专科资格边界。",
      },
    }));
  }

  for (const [category, subjectType, score] of [
    ["藏文类", "历史类", 320],
    ["藏文类", "物理类", 305],
    ["彝文类", "历史类", 365],
    ["彝文类", "物理类", 315],
  ]) {
    records.push(baseRecord({
      sourcePageId: "minority-language",
      subjectType,
      batch: "原少数民族语言授课为主本科批控制线",
      majorName: `${category}${subjectType}本科批控制线`,
      majorGroup: category,
      minScore: score,
      extra: { minorityLanguageCategory: category },
    }));
  }
  for (const subjectType of ["历史类", "物理类"]) {
    records.push(baseRecord({
      sourcePageId: "minority-language",
      subjectType,
      batch: "原少数民族语言授课为主高职（专科）批控制线",
      majorName: `${subjectType}原少数民族语言授课为主高职（专科）批控制线`,
      majorGroup: "原少数民族语言授课为主",
      minScore: 150,
    }));
  }

  for (const [section, category, cultureScore, professionalScore, disciplineCodes, note] of ART_SPORTS_LINES) {
    records.push(baseRecord({
      sourcePageId: "art-sports",
      subjectType: category === "体育类" ? "体育类" : "艺术类",
      batch: `${category}${section}录取控制线`,
      majorName: `${category}${section}文化/专业控制线`,
      majorGroup: category,
      minScore: cultureScore,
      disciplineCodes,
      extra: {
        cultureScoreLine: cultureScore,
        professionalScoreLine: professionalScore,
        artSportsCategory: category,
        controlLineSection: section,
        controlLineNote: note || "",
      },
    }));
  }
  return records;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const pages = [];
  for (const page of PAGES) {
    const rawPath = path.join(TMP_ROOT, `${page.id}.html`);
    const html = args.useCache && fs.existsSync(rawPath)
      ? fs.readFileSync(rawPath, "utf8")
      : await fetchText(page.url);
    fs.writeFileSync(rawPath, html, "utf8");
    const parsed = assertPage(page, html);
    pages.push({
      id: page.id,
      title: parsed.title,
      publishedAt: parsed.publishedAt,
      url: page.url,
      rawHtmlFile: path.relative(PROJECT_ROOT, rawPath),
      rawHtmlSha256: sha256(html),
      textSha256: sha256(parsed.text),
    });
  }

  const records = recordsFor();
  const duplicateIds = records.map((record) => record.id).filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate Sichuan control-line record ids: ${duplicateIds.slice(0, 10).join(", ")}`);
  }
  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const payload = {
    dataset: "official-sichuan-control-lines-2026-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "official-control-lines",
    },
    notes: [
      "本文件由 scripts/import-official-sichuan-control-lines-2026.mjs 自动生成。",
      "来源为四川省教育考试院 2026 年普通类、对口招生、原少数民族语言授课为主、艺术体育类招生录取控制分数线官方 HTML 页面。",
      "本批记录为 control-line 批次/类别资格边界，不是院校投档线、录取最低分或录取概率证据。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: "四川省2026年普通高校招生录取控制分数线汇总",
        publisher: "四川省教育考试院",
        publishedAt: "2026/6/25",
        url: PAGES[0].url,
        pageUrls: PAGES.map((page) => page.url),
        quality: SOURCE_QUALITY,
        usage: `抽取四川 2026 普通类、对口招生、原少数民族语言授课为主、艺术体育类录取控制分数线 ${records.length} 条，作为批次/类别资格边界。`,
        parsedRecords: records.length,
        pages,
        caution: "控制线只表示批次/类别资格边界，不能替代四川 2026 院校投档线、专业录取分、最低位次或录取概率。",
      },
    ],
    importAudit: {
      script: "scripts/import-official-sichuan-control-lines-2026.mjs",
      pages: pages.map((page) => ({
        id: page.id,
        url: page.url,
        rawHtmlFile: page.rawHtmlFile,
        rawHtmlSha256: page.rawHtmlSha256,
      })),
      recordCounts: {
        total: records.length,
        ordinary: records.filter((record) => record.sourcePageId === "ordinary").length,
        counterpart: records.filter((record) => record.sourcePageId === "counterpart").length,
        minorityLanguage: records.filter((record) => record.sourcePageId === "minority-language").length,
        artSports: records.filter((record) => record.sourcePageId === "art-sports").length,
      },
    },
    records,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: path.relative(PROJECT_ROOT, outPath),
    records: records.length,
    pages: pages.length,
    recordCounts: payload.importAudit.recordCounts,
    rawSha256: Object.fromEntries(pages.map((page) => [page.id, page.rawHtmlSha256])),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
