#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = "data/admissions/official-xizang-current-notices-2026-import.json";
const RAW_DIR = path.join(PROJECT_ROOT, "data", "admissions", "raw", "official-xizang-current-notices-2026");
const PROVINCE = "西藏";
const YEAR = 2026;
const PUBLISHER = "西藏自治区教育考试院";

const NOTICES = [
  {
    key: "art-qualified-line",
    id: "7531",
    url: "http://zsks.edu.xizang.gov.cn/71/74/7531.html",
    fileName: "art-qualified-line.html",
    sourceId: "official-xizang-art-qualified-line-2026",
    quality: "official-xizang-2026-art-qualified-line-html",
  },
  {
    key: "police-process-notice",
    id: "7704",
    url: "http://zsks.edu.xizang.gov.cn/71/74/7704.html",
    fileName: "police-process-notice.html",
    sourceId: "official-xizang-police-process-notice-2026",
    quality: "official-xizang-2026-police-process-notice-html",
  },
  {
    key: "police-judicial-minzu-campus-notice",
    id: "7818",
    url: "http://zsks.edu.xizang.gov.cn/71/74/7818.html",
    fileName: "police-judicial-minzu-campus-notice.html",
    sourceId: "official-xizang-police-judicial-minzu-campus-notice-2026",
    quality: "official-xizang-2026-police-judicial-minzu-campus-notice-html",
  },
  {
    key: "fire-rescue-admission-notice",
    id: "7827",
    url: "http://zsks.edu.xizang.gov.cn/71/74/7827.html",
    fileName: "fire-rescue-admission-notice.html",
    sourceId: "official-xizang-fire-rescue-admission-notice-2026",
    quality: "official-xizang-2026-fire-rescue-admission-notice-html",
  },
  {
    key: "beijing-electronic-charter",
    id: "7849",
    url: "http://zsks.edu.xizang.gov.cn/71/74/7849.html",
    fileName: "beijing-electronic-charter.html",
    sourceId: "official-xizang-beijing-electronic-charter-2026",
    quality: "official-xizang-2026-beijing-electronic-charter-html",
  },
  {
    key: "volunteer-filling-notice",
    id: "7883",
    url: "http://zsks.edu.xizang.gov.cn/71/74/7883.html",
    fileName: "volunteer-filling-notice.html",
    sourceId: "official-xizang-volunteer-filling-notice-2026",
    quality: "official-xizang-2026-volunteer-filling-notice-html",
  },
  {
    key: "sports-qualified-line",
    id: "7891",
    url: "http://zsks.edu.xizang.gov.cn/71/74/7891.html",
    fileName: "sports-qualified-line.html",
    sourceId: "official-xizang-sports-qualified-line-2026",
    quality: "official-xizang-2026-sports-qualified-line-html",
  },
  {
    key: "military-interview-medical-notice",
    id: "7899",
    url: "http://zsks.edu.xizang.gov.cn/71/74/7899.html",
    fileName: "military-interview-medical-notice.html",
    sourceId: "official-xizang-military-interview-medical-notice-2026",
    quality: "official-xizang-2026-military-interview-medical-notice-html",
  },
  {
    key: "sergeant-process-notice",
    id: "7900",
    url: "http://zsks.edu.xizang.gov.cn/71/74/7900.html",
    fileName: "sergeant-process-notice.html",
    sourceId: "official-xizang-sergeant-process-notice-2026",
    quality: "official-xizang-2026-sergeant-process-notice-html",
  },
];

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-current-notices-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-current-notices-2026.mjs --use-cache",
    "",
    "Imports current Tibet/Xizang 2026 official notice layers:",
    "  - art unified-exam qualified lines as special control-line records",
    "  - sports unified-exam qualified line as special control-line records",
    "  - police, judicial, fire-rescue, Beijing Electronic, military academy, sergeant, and volunteer notices as source notes only",
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hash(value, length = 18) {
  return sha256(String(value)).slice(0, length);
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
    .replace(/&apos;/g, "'")
    .replace(/\u00a0/g, " ");
}

function cleanHtmlText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function download(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 gaokao-xizang-current-notices-importer/1.0",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureHtml(notice, useCache) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, notice.fileName);
  if (!useCache || !fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.writeFileSync(file, await download(notice.url));
  }
  return {
    file,
    html: fs.readFileSync(file, "utf8"),
  };
}

function extractMeta(html) {
  const title = cleanHtmlText(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
  const publishedAt = cleanHtmlText(/<span class="date">([^<]+)<\/span>/i.exec(html)?.[1] || "");
  const publisher = cleanHtmlText(/<span class="from">来源：([^<]+)<\/span>/i.exec(html)?.[1] || PUBLISHER);
  const body = cleanHtmlText(/<div class="content">([\s\S]*?)<\/div>\s*<\/div>/i.exec(html)?.[1] || html);
  return { title, publishedAt, publisher, body };
}

function sportsRecords(meta, notice, htmlFile, html) {
  if (!/体育类专业统考合格分数线/.test(meta.title)) {
    throw new Error(`Unexpected Xizang sports title: ${meta.title}`);
  }
  const pairs = [
    ["文史类", "历史类"],
    ["理工类", "物理类"],
  ];
  return pairs.map(([rawSubject, subjectType]) => {
    const pattern = new RegExp(`${rawSubject}\\s*(\\d+)\\s*分?`);
    const score = Number(pattern.exec(meta.body)?.[1] || 0);
    if (!score) throw new Error(`Could not parse ${rawSubject} sports qualified line from ${notice.url}`);
    return {
      id: `${YEAR}-xz-sports-qualified-${hash(`${rawSubject}|${score}`)}`,
      province: PROVINCE,
      year: YEAR,
      subjectType,
      batch: "体育类专业统考合格线",
      schoolName: "西藏自治区2026年普通高校招生体育类专业统考合格分数线",
      schoolCode: null,
      schoolTags: ["西藏官方资格线", "体育类", "特殊路径"],
      dataType: "control-line",
      majorName: "体育类专业统考合格线",
      majorCode: null,
      majorGroup: rawSubject,
      electiveRequirement: "体育类专业统考",
      disciplineCodes: ["04"],
      planCount: null,
      minScore: score,
      minRankStart: null,
      minRankEnd: null,
      rankRangeText: "",
      sourceId: notice.sourceId,
      sourceQuality: notice.quality,
      sourceUrl: notice.url,
      sourceFile: rel(htmlFile),
      sourcePublishedAt: meta.publishedAt,
      thresholdType: "体育类专业统考合格线",
      rawSubject,
      formalScoreScope: "special-path-only",
      cautions: [
        "本记录是体育类专业统考合格线，不是普通类批次控制线、院校投档线、录取最低分或最低位次。",
        "专业统考合格不等于录取；体育类志愿还需同时达到文化课控制线、专业成绩排序、招生计划和院校规则。",
        "普通考生不得填报体育类志愿；未参加西藏体育统考的考生不得填报以该统考成绩作为录取依据的体育院校或专业。",
      ],
      htmlSha256: sha256(html),
    };
  });
}

function compactBody(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/：/g, ":");
}

function artRecords(meta, notice, htmlFile, html) {
  if (!/艺术类专业统考合格分数线/.test(meta.title)) {
    throw new Error(`Unexpected Xizang art title: ${meta.title}`);
  }
  const compact = compactBody(meta.body);
  const specs = [
    {
      category: "音乐表演",
      disciplineCodes: ["13"],
      pattern: /音乐表演本科合格线:?(\d+)分专科合格线:?(\d+)分/,
      levels: ["本科", "专科"],
    },
    {
      category: "音乐教育",
      disciplineCodes: ["04", "13"],
      pattern: /音乐教育本科合格线:?(\d+)分专科合格线:?(\d+)分/,
      levels: ["本科", "专科"],
    },
    {
      category: "舞蹈类",
      disciplineCodes: ["13"],
      pattern: /舞蹈类本科合格线:?(\d+)分专科合格线:?(\d+)分/,
      levels: ["本科", "专科"],
    },
    {
      category: "表(导)演类",
      disciplineCodes: ["13"],
      pattern: /表\(导\)演类本专科合格线:?(\d+)分/,
      levels: ["本专科"],
    },
    {
      category: "播音与主持类",
      disciplineCodes: ["05", "13"],
      pattern: /播音与主持类本科合格线:?(\d+)分专科合格线:?(\d+)分/,
      levels: ["本科", "专科"],
    },
    {
      category: "美术与设计类",
      disciplineCodes: ["13"],
      pattern: /美术与设计类本科合格线:?(\d+)分专科合格线:?(\d+)分/,
      levels: ["本科", "专科"],
    },
    {
      category: "书法类",
      disciplineCodes: ["05", "13"],
      pattern: /书法类本专科合格线:?(\d+)分/,
      levels: ["本专科"],
    },
  ];
  const records = [];
  for (const spec of specs) {
    const match = spec.pattern.exec(compact);
    if (!match) throw new Error(`Could not parse ${spec.category} art qualified lines from ${notice.url}`);
    spec.levels.forEach((level, index) => {
      const score = Number(match[index + 1] || 0);
      if (!score) throw new Error(`Invalid ${spec.category} ${level} score from ${notice.url}`);
      records.push({
        id: `${YEAR}-xz-art-qualified-${hash(`${spec.category}|${level}|${score}`)}`,
        province: PROVINCE,
        year: YEAR,
        subjectType: "艺术类",
        batch: "艺术类专业统考校考资格线",
        schoolName: "西藏自治区2026年普通高校招生艺术类专业统考合格分数线",
        schoolCode: null,
        schoolTags: ["西藏官方资格线", "艺术类", "特殊路径", spec.category, level],
        dataType: "control-line",
        majorName: `${spec.category}${level}合格线`,
        majorCode: null,
        majorGroup: spec.category,
        electiveRequirement: "艺术类专业省级统考",
        disciplineCodes: spec.disciplineCodes,
        planCount: null,
        minScore: score,
        minRankStart: null,
        minRankEnd: null,
        rankRangeText: "",
        sourceId: notice.sourceId,
        sourceQuality: notice.quality,
        sourceUrl: notice.url,
        sourceFile: rel(htmlFile),
        sourcePublishedAt: meta.publishedAt,
        thresholdType: "艺术类专业统考合格线（校考资格线）",
        artCategory: spec.category,
        artLevel: level,
        formalScoreScope: "special-path-only",
        cautions: [
          "本记录是艺术类专业省级统考合格分数线（校考资格线），不是普通类批次控制线、院校投档线、录取最低分或最低位次。",
          "艺术统考合格不等于录取；艺术类录取还需同时达到文化课控制线、专业/综合成绩排序、招生计划和院校规则。",
          "该线只用于相应艺术类别校考资格或统考合格资格提醒，不能与普通类文化成绩一分一段混用。",
        ],
        htmlSha256: sha256(html),
      });
    });
  }
  if (records.length !== 12) {
    throw new Error(`Expected 12 Xizang art qualified records, got ${records.length}`);
  }
  return records;
}

function sourceNoteFor(notice, meta, htmlFile, html, extra = {}) {
  return {
    id: notice.sourceId,
    title: meta.title,
    publisher: meta.publisher || PUBLISHER,
    url: notice.url,
    publishedAt: meta.publishedAt,
    quality: notice.quality,
    htmlPath: rel(htmlFile),
    htmlBytes: Buffer.byteLength(html),
    htmlSha256: sha256(html),
    ...extra,
  };
}

function attachmentUrls(html, baseUrl) {
  return [...html.matchAll(/<a[^>]+href=["']([^"']+\.(?:docx?|xlsx?|xls|pdf|zip))["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      url: new URL(decodeEntities(match[1]), baseUrl).href,
      text: cleanHtmlText(match[2]),
    }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const records = [];
  const sourceNotes = [];
  for (const notice of NOTICES) {
    const { file, html } = await ensureHtml(notice, args.useCache);
    const meta = extractMeta(html);
    if (notice.key === "art-qualified-line") {
      const parsed = artRecords(meta, notice, file, html);
      records.push(...parsed);
      sourceNotes.push(sourceNoteFor(notice, meta, file, html, {
        usage: "官方 HTML 表抽取西藏 2026 艺术类专业统考合格分数线（校考资格线）12 条；仅作艺术类统考/校考资格边界，不作普通类投档或录取概率。",
        parsedRecords: parsed.length,
        scoreRange: { min: 150, max: 200 },
        categories: [...new Set(parsed.map((record) => record.artCategory))],
        caution: "艺术统考合格线不是普通批次投档线，也不计作西藏正式投档/录取最低分闭合。",
      }));
    } else if (notice.key === "sports-qualified-line") {
      const parsed = sportsRecords(meta, notice, file, html);
      records.push(...parsed);
      sourceNotes.push(sourceNoteFor(notice, meta, file, html, {
        usage: "官方 HTML 表抽取西藏 2026 体育类专业统考合格线 2 条；仅作体育类专业统考资格边界，不作普通类投档或录取概率。",
        parsedRecords: parsed.length,
        scoreRange: { min: 45, max: 45 },
        caution: "体育统考合格线不是普通批次投档线，也不计作西藏正式投档/录取最低分闭合。",
      }));
    } else if (notice.key === "police-process-notice") {
      sourceNotes.push(sourceNoteFor(notice, meta, file, html, {
        usage: "公安院校公安专业西藏招生体检、面试、体能测评和政治考察工作公告；只作特殊路径报考条件、院校范围、组织单位、时间和官方复核提醒。",
        parsedRecords: 0,
        schoolCount: 9,
        caution: "该公告未公布公安院校投档线、录取最低分或最低位次，不能生成录取概率或正式分数闭合。",
      }));
    } else if (notice.key === "police-judicial-minzu-campus-notice") {
      sourceNotes.push(sourceNoteFor(notice, meta, file, html, {
        usage: "西藏民族大学考区公安和司法体检、体测、面试公告；只作公安/司法特殊路径现场安排、时间地点、材料报送和复核提醒。",
        parsedRecords: 0,
        caution: "该公告未公布公安或司法投档线、录取最低分或最低位次，不能生成录取概率或正式分数闭合。",
      }));
    } else if (notice.key === "fire-rescue-admission-notice") {
      sourceNotes.push(sourceNoteFor(notice, meta, file, html, {
        usage: "中国消防救援学院在西藏招收青年学生公告；招生计划已由西藏 2026 招生计划 DOCX 入库，本页只补政治考核、体检、面试、心理测试和附件复核来源。",
        parsedRecords: 0,
        planCountMentioned: 6,
        attachmentUrls: attachmentUrls(html, notice.url),
        caution: "该公告未公布投档线、录取最低分或最低位次；计划数不能单独生成录取概率。",
      }));
    } else if (notice.key === "beijing-electronic-charter") {
      sourceNotes.push(sourceNoteFor(notice, meta, file, html, {
        usage: "北京电子科技学院 2026 年本科招生章程；只作提前批、面试政审、英语语种、身体条件、调档与专业录取规则复核来源。",
        parsedRecords: 0,
        caution: "招生章程不是投档线、录取最低分或最低位次，不能生成正式分数闭合。",
      }));
    } else if (notice.key === "volunteer-filling-notice") {
      sourceNotes.push(sourceNoteFor(notice, meta, file, html, {
        usage: "西藏 2026 普通高等学校招生志愿填报工作通知；只作正式填报时间、批次一次性填报、辅助系统边界、复核清单和流程提醒。",
        parsedRecords: 0,
        attachmentUrls: attachmentUrls(html, notice.url),
        caution: "志愿填报通知不是投档线、录取最低分或最低位次；辅助系统结果仅供参考，不承诺录取结果。",
      }));
    } else if (notice.key === "military-interview-medical-notice") {
      sourceNotes.push(sourceNoteFor(notice, meta, file, html, {
        usage: "军队院校在藏招生面试体检工作公告；当前页说明面试体检分数线将在志愿填报结束后另行公布，本轮只作特殊路径流程、条件、时间和复核提醒。",
        parsedRecords: 0,
        imageUrls: [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
          .map((match) => new URL(decodeEntities(match[1]), notice.url).href)
          .filter((url) => /20260628/.test(url)),
        caution: "该公告尚未给出军队院校面试体检划线分数，不能生成录取分数记录。",
      }));
    } else if (notice.key === "sergeant-process-notice") {
      sourceNotes.push(sourceNoteFor(notice, meta, file, html, {
        usage: "定向培养军士工作公告；当前页提供报考条件、流程、体检/政治考核和表格附件，只作特殊路径流程提醒，不生成投档/录取分数记录。",
        parsedRecords: 0,
        attachmentUrls: [...html.matchAll(/<a[^>]+href=["']([^"']+\.docx)["'][^>]*>([\s\S]*?)<\/a>/gi)]
          .map((match) => ({
            url: new URL(decodeEntities(match[1]), notice.url).href,
            text: cleanHtmlText(match[2]),
          })),
        caution: "该公告未公布定向培养军士体检/投档/录取最低分，不能生成录取概率或正式分数闭合。",
      }));
    }
  }

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({
    dataset: path.basename(args.out, ".json"),
    generatedAt: new Date().toISOString(),
    scope: "西藏 2026 当前官方公告：艺术/体育统考合格线、公安司法消防北电军队院校/定向培养军士/志愿填报流程提醒",
    notes: [
      "本文件由 scripts/import-official-xizang-current-notices-2026.mjs 自动生成。",
      "艺术类专业统考合格分数线（校考资格线）按 control-line 特殊资格边界导入。",
      "体育类专业统考合格线按 control-line 特殊资格边界导入。",
      "公安、司法、消防、北京电子科技学院、军队院校、定向培养军士和志愿填报公告当前不含可导入正式投档/录取分数线，只保留 sourceNotes 和流程提醒。",
    ],
    sourceNotes,
    records,
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: rel(outPath),
    records: records.length,
    sourceNotes: sourceNotes.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
