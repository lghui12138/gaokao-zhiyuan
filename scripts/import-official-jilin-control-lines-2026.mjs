#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_ID = "202728";
const DEFAULT_OUT = "data/admissions/official-jilin-control-lines-2026-import.json";
const TMP_ROOT = path.join(PROJECT_ROOT, "tmp", "official-jilin-control-lines-2026");
const YEAR = 2026;
const PROVINCE = "吉林";
const SOURCE_ID = "official-jilin-control-lines-2026";
const SOURCE_QUALITY = "official-jilin-control-line-api-verified";
const OFFICIAL_PAGE_URL = "https://www.jleea.com.cn/front/content/202728";

const TEXT_ASSERTIONS = [
  "吉林省2026年普通高考本、专科各科类录取最低控制分数线",
  "一、本科最低控制线",
  "历史学科组：最低控制线343分",
  "物理学科组：最低控制线321分",
  "特殊类型控制分数线",
  "历史学科组：最低控制线478分",
  "物理学科组：最低控制线473分",
  "体育类",
  "历史学科组：最低控制线269分",
  "物理学科组：最低控制线266分",
  "艺术类",
  "历史学科组：最低控制线257分",
  "物理学科组：最低控制线240分",
  "戏曲类历史学科组：最低控制线171分",
  "戏曲类物理学科组：最低控制线160分",
  "二、专科最低控制线",
  "普通专科（历史学科组、物理学科组）",
  "最低控制线为160分",
  "体育类专科（历史学科组、物理学科组）",
  "最低控制线为140分",
  "艺术类专科（历史学科组、物理学科组）",
  "最低控制线为112分",
];

const CONTROL_LINES = [
  ["本科", "普通类", "历史类", "普通类本科最低控制线", 343, []],
  ["本科", "普通类", "物理类", "普通类本科最低控制线", 321, []],
  ["本科", "特殊类型", "历史类", "特殊类型招生控制线", 478, []],
  ["本科", "特殊类型", "物理类", "特殊类型招生控制线", 473, []],
  ["本科", "体育类", "历史类", "体育类本科最低控制线", 269, ["04"]],
  ["本科", "体育类", "物理类", "体育类本科最低控制线", 266, ["04"]],
  ["本科", "艺术类", "历史类", "艺术类本科最低控制线", 257, ["13"]],
  ["本科", "艺术类", "物理类", "艺术类本科最低控制线", 240, ["13"]],
  ["本科", "戏曲类", "历史类", "戏曲类本科最低控制线", 171, ["13"]],
  ["本科", "戏曲类", "物理类", "戏曲类本科最低控制线", 160, ["13"]],
  ["专科", "普通类", "历史类", "普通类专科最低控制线", 160, []],
  ["专科", "普通类", "物理类", "普通类专科最低控制线", 160, []],
  ["专科", "体育类", "历史类", "体育类专科最低控制线", 140, ["04"]],
  ["专科", "体育类", "物理类", "体育类专科最低控制线", 140, ["04"]],
  ["专科", "艺术类", "历史类", "艺术类专科最低控制线", 112, ["13"]],
  ["专科", "艺术类", "物理类", "艺术类专科最低控制线", 112, ["13"]],
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-jilin-control-lines-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-jilin-control-lines-2026.mjs --use-cache",
    "",
    "Options:",
    `  --id ID     official Jilin content id, default ${DEFAULT_ID}`,
    "  --json PATH use an already downloaded official API JSON response",
    "  --out PATH  output JSON path",
    "  --use-cache reuse tmp official JSON if present",
    "",
    "Notes:",
    "  - Imports official Jilin 2026 ordinary/special/art/sports score-control lines.",
    "  - Control lines are batch/category eligibility boundaries, not filing/admission records.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { id: DEFAULT_ID, out: DEFAULT_OUT, useCache: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--id") args.id = argv[++i];
    else if (item === "--json") args.json = argv[++i];
    else if (item === "--out") args.out = argv[++i];
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
    .replace(/\s+/g, "")
    .trim();
}

function apiUrl(id) {
  return `https://www.jleea.com.cn/server-front/front/content/detail?id=${encodeURIComponent(id)}&isStatic=false`;
}

async function downloadText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-jilin-control-importer/1.0",
      accept: "application/json,text/plain,*/*",
      "anonymity-header": "Gaokao",
      "site-path": "",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

function instanceValue(detail, field) {
  return detail?.data?.instance?.instanceItems?.find((item) => item.field === field)?.value;
}

function parseDetail(jsonText, id) {
  const detail = JSON.parse(jsonText);
  if (detail.code !== "00000 00000") {
    throw new Error(`Official Jilin API returned unexpected code: ${detail.code}`);
  }
  if (String(detail.data?.id) !== String(id)) {
    throw new Error(`Official Jilin API returned id ${detail.data?.id}, expected ${id}`);
  }
  const title = instanceValue(detail, "title") || detail.data?.title || "";
  const publishedAt = instanceValue(detail, "publishTime") || "";
  const contents = instanceValue(detail, "contents") || {};
  const contentHtml = contents["正文"] || "";
  const contentText = `${title}${cleanHtmlText(contentHtml)}`;
  if (title !== "吉林省2026年普通高考本、专科各科类录取最低控制分数线") {
    throw new Error(`Unexpected Jilin control-line title: ${title}`);
  }
  const missing = TEXT_ASSERTIONS.filter((expected) => !contentText.includes(expected.replace(/\s+/g, "")));
  if (missing.length) {
    throw new Error(`Official Jilin control-line text missing expected values: ${missing.join(", ")}`);
  }
  return {
    detail,
    title,
    publishedAt,
    publisher: "吉林省教育考试院",
    contentHtml,
    contentText,
    pageUrl: detail.data?.url || OFFICIAL_PAGE_URL,
  };
}

function controlLineKind(section, category) {
  if (category === "特殊类型") return "特殊类型招生控制线";
  return `${category}${section}控制线`;
}

function recordsFor() {
  return CONTROL_LINES.map(([section, category, subjectType, batch, minScore, disciplineCodes]) => {
    const idBase = [YEAR, PROVINCE, section, category, subjectType, batch, minScore].join("|");
    return {
      id: `${YEAR}-${hash(idBase, 16)}`,
      province: PROVINCE,
      year: YEAR,
      subjectType,
      batch,
      schoolName: "吉林省2026年普通高考本、专科各科类录取最低控制分数线",
      schoolTags: ["批次控制线", category, section],
      city: "吉林",
      dataType: "control-line",
      majorName: `${category}${subjectType}${section}最低控制线`,
      majorCode: "",
      majorGroup: category,
      disciplineCodes,
      minScore,
      cultureScoreLine: minScore,
      rankRangeText: "",
      sourceId: SOURCE_ID,
      sourceQuality: SOURCE_QUALITY,
      controlLineKind: controlLineKind(section, category),
      controlLineSection: section,
      cautions: [
        "这是吉林省教育考试院公布的普通高考本、专科各科类录取最低控制分数线，只能作为批次/类别资格边界。",
        "该记录不是院校投档线、专业录取最低分或最低位次，不能单独生成录取概率。",
        "吉林 2026 已有招生计划、一分段和控制线层，仍需等待正式投档/录取最低分表才能闭合 official minScore。",
      ],
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const jsonPath = args.json ? path.resolve(args.json) : path.join(TMP_ROOT, `content-${args.id}.json`);
  const jsonText = args.json
    ? fs.readFileSync(jsonPath, "utf8")
    : args.useCache && fs.existsSync(jsonPath)
      ? fs.readFileSync(jsonPath, "utf8")
      : await downloadText(apiUrl(args.id));
  fs.writeFileSync(jsonPath, jsonText, "utf8");

  const parsed = parseDetail(jsonText, args.id);
  const records = recordsFor();
  const payload = {
    dataset: "official-jilin-control-lines-2026-import",
    generatedAt: new Date().toISOString(),
    scope: {
      province: PROVINCE,
      year: YEAR,
      sourceKind: "official-control-lines",
    },
    notes: [
      "本文件由 scripts/import-official-jilin-control-lines-2026.mjs 自动生成。",
      "来源为吉林省教育考试院内容 API 对应的官方普通高考最低控制分数线文章。",
      "本批记录为 control-line 批次/类别资格边界，不是院校投档线、录取最低分或录取概率证据。",
    ],
    sourceNotes: [
      {
        id: SOURCE_ID,
        title: parsed.title,
        publisher: parsed.publisher,
        publishedAt: parsed.publishedAt,
        url: parsed.pageUrl,
        apiUrl: apiUrl(args.id),
        quality: SOURCE_QUALITY,
        usage: "抽取吉林 2026 普通类、特殊类型、体育类、艺术类、戏曲类和专科最低控制线 16 条，作为批次/类别资格边界。",
        parsedRecords: records.length,
        detailJsonSha256: sha256(jsonText),
        contentHtmlSha256: sha256(parsed.contentHtml),
        contentTextSha256: sha256(parsed.contentText),
      },
    ],
    diagnostics: {
      contentId: args.id,
      recordCount: records.length,
      textAssertions: TEXT_ASSERTIONS,
      breakdown: {
        undergraduate: CONTROL_LINES.filter((line) => line[0] === "本科").length,
        vocational: CONTROL_LINES.filter((line) => line[0] === "专科").length,
      },
    },
    records,
  };

  const out = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    out: path.relative(PROJECT_ROOT, out),
    records: payload.records.length,
    sourceId: SOURCE_ID,
    pageTitle: parsed.title,
    publishedAt: parsed.publishedAt,
    pageUrl: parsed.pageUrl,
    detailJsonSha256: payload.sourceNotes[0].detailJsonSha256,
    breakdown: payload.diagnostics.breakdown,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
