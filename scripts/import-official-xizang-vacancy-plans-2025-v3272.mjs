#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const RAW_DIR = path.join(PROJECT_ROOT, "data/admissions/raw/official-xizang-vacancy-plans-2025-v3272");
const DEFAULT_OUT = "data/admissions/official-xizang-vacancy-plans-2025-v3272-import.json";
const SOURCE_ID = "official-xizang-vacancy-plans-2025-v3272";
const SCHEDULE_SOURCE_ID = "official-xizang-admission-schedule-2026-v3272";
const SOURCE_QUALITY = "official-province-xizang-2025-vacancy-plan-chsi-mirror";
const SCHEDULE_URL = "https://gaokao.chsi.com.cn/gkxx/zc/ss/202607/20260713/2293870888.html";
const SCHEDULE_IMAGE_URL = "https://t3.chei.com.cn/news/img/2293870889.png";
const CAPTURE_HASHES = process.env.GAOKAO_CAPTURE_HASHES === "1";

const ANNOUNCEMENTS = Object.freeze([
  {
    id: "counterpart", round: "对口高职", title: "西藏：对口高职征集志愿公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250824/2293397462.html",
    publishedAt: "2025-08-24", batch: "对口高职专科批", special: true,
    attachments: [{ subject: "对口高职", ext: "xls" }],
  },
  {
    id: "17", round: "17", title: "西藏：征集志愿第17号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250820/2293395380.html",
    publishedAt: "2025-08-20", batch: "专科批", special: false,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
  {
    id: "16", round: "16", title: "西藏：征集志愿第16号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250817/2293395308.html",
    publishedAt: "2025-08-17", batch: "专科批", special: false,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
  {
    id: "15", round: "15", title: "西藏：征集志愿第15号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250815/2293395263.html",
    publishedAt: "2025-08-15", batch: "提前批艺体类专科", special: true,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
  {
    id: "14", round: "14", title: "西藏：征集志愿第14号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250811/2293396213.html",
    publishedAt: "2025-08-11", batch: "本科二批（民族预科班）", special: true,
    attachments: [{ subject: "文史类", ext: "docx" }, { subject: "理工类", ext: "docx" }],
  },
  {
    id: "12", round: "12", title: "西藏：征集志愿第12号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250807/2293395109.html",
    publishedAt: "2025-08-07", batch: "部队生源本科批", special: true,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
  {
    id: "11", round: "11", title: "西藏：征集志愿第11号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250807/2293395104.html",
    publishedAt: "2025-08-07", batch: "本科二批", special: false,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
  {
    id: "10", round: "10", title: "西藏：征集志愿第10号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250805/2293396148.html",
    publishedAt: "2025-08-05", batch: "部队生源本科批", special: true,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
  {
    id: "9", round: "9", title: "西藏：征集志愿第9号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250805/2293396142.html",
    publishedAt: "2025-08-05", batch: "本科二批", special: false,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
  {
    id: "7", round: "7", title: "西藏：征集志愿第7号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202508/20250801/2293394958.html",
    publishedAt: "2025-08-01", batch: "本科一批", special: false,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
  {
    id: "6", round: "6", title: "西藏：征集志愿第6号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202507/20250731/2293394908.html",
    publishedAt: "2025-07-31", batch: "本科一批", special: false,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
  {
    id: "5", round: "5", title: "西藏：征集志愿第5号公告",
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202507/20250729/2293394740.html",
    publishedAt: "2025-07-29", batch: "本科一批", special: false,
    attachments: [{ subject: "理工类", ext: "docx" }, { subject: "文史类", ext: "docx" }],
  },
]);

export const EXPECTED_RAW_HASHES = Object.freeze({
  "page-vacancy-counterpart.html": "12b0d91f8bc6e3a6edcfd8d8ee72e9f60690ce35385fb1ff148da0e8455ebe99",
  "vacancy-counterpart-counterpart.xls": "4d42da893b993d025cc9590fcae009fa2abfe16164fc2d00479ba13ff90302c7",
  "page-vacancy-17.html": "9ec5ac296b6725dfd11a0a6352b92cb730b5eb3d85666a18352bff93393c512a",
  "vacancy-17-science.docx": "b1cb6822aae63ed003e110ff87e1de1b5bf82cb5a3338380109e1e554f502cea",
  "vacancy-17-humanities.docx": "790eebecb47972dd01fd5ee9cf840dc0c774500d3dadffe2040e2907a6d318f7",
  "page-vacancy-16.html": "349cf9d02dc3e0afc4de633b8dee532337671a14ed37ed8d93214a2ab574c14f",
  "vacancy-16-science.docx": "6337f3827168b76572c4400415d111fc74d0a53e965efee407a28b4bd7efe267",
  "vacancy-16-humanities.docx": "eadb6a0668681a55fb810daa7a01fdd03b8b15332a9f53609e8d4158824ffdf0",
  "page-vacancy-15.html": "be1bbc95d69ac336977ff637ce5d8d75f8767f463a038110dadf32b051ed68ea",
  "vacancy-15-science.docx": "3e0345e95af11294cc8150af0ef961877f79a528b5d85774a81440b23abc90da",
  "vacancy-15-humanities.docx": "769db295636c8dba22ac858c8589d2082f7f7709628accbe411887523fed1464",
  "page-vacancy-14.html": "0fb5f4d29139d48b3a95546dc6409aeb67409ece439e81e893869a777aba0ff6",
  "vacancy-14-humanities.docx": "f0c74187934949e0dbe68c1e4e30c131f7eeecfb929eb77d5725e528cce782fe",
  "vacancy-14-science.docx": "913fcc0c2184349f057c84fec8c1a8a50750f36d01fef20d122aa521dfad877f",
  "page-vacancy-12.html": "dcb8eb9ab6b8a131824ddbc8473276a28aaa5f604008bebb604254e460aeda25",
  "vacancy-12-science.docx": "a07059076a27493b7d608b111ad9d88ba548c80d78a557eef4d9ae8d6818ec37",
  "vacancy-12-humanities.docx": "d8a94ea5b48d1f2690d276bc1baf6c20a50640884a9353391fe5002262e21b89",
  "page-vacancy-11.html": "0c6895489eb183c1739e5953b0f0cbd2f9b2fa5aca13b7ad1790c65960b973fe",
  "vacancy-11-science.docx": "665aa41d7c78f069fae620b947ecf32b0e0dbed76b6f549d65cc955983ce4e4c",
  "vacancy-11-humanities.docx": "bd3673c23d481c713f2c816171d980bfefb48939798a1d30dc53a0ee6c8c0c4b",
  "page-vacancy-10.html": "325c772f591a3d330211e6c1e1d3a61acf7cd163069e5061152e0b83ab510b9d",
  "vacancy-10-science.docx": "a07059076a27493b7d608b111ad9d88ba548c80d78a557eef4d9ae8d6818ec37",
  "vacancy-10-humanities.docx": "001c4f9ac21f6db07def550d0139e463c18578b007cdcafd6b5048f063ac7af1",
  "page-vacancy-9.html": "cfdb03ab197d0bc9709cd20f77f8126c639e48dd720818d5193e8beaf251cb65",
  "vacancy-9-science.docx": "ebe6deac7f21be8121f9d41b651d6d5b58360d42e351e16d98d6ddc81e2ab111",
  "vacancy-9-humanities.docx": "9f9ab7f34045a7efb7f85ea2a416818266e9f0d26e7ff00dd279e2114bdda51c",
  "page-vacancy-7.html": "e7deeca0918a558141c8af9e9785696af21b43285eceb18dd35c389a74787af9",
  "vacancy-7-science.docx": "9bec0909be29f353127ef6b6887cee145db0dc5b89f21fcb2d3984b1c0f2c2c5",
  "vacancy-7-humanities.docx": "d563f8b185097b369c9c5c81bc800285844f33794bd16212cd05d993d1acd07f",
  "page-vacancy-6.html": "fdd805b083e825be376a6cc3273c1214f9439815dfac02c9524aed3b7acc13b7",
  "vacancy-6-science.docx": "e8dfc965b6b3e53d13e38f2050849aa10e651fafb6928820ee12cf8128115132",
  "vacancy-6-humanities.docx": "523ac6f73c12680c649bc70bafc5721795265dbbe292af03f1987dd8cc56f5a3",
  "page-vacancy-5.html": "5d85d3b6fb2ebef4f9d3b054c6cd66ccb99747882ef61be2928d3f20cd090c00",
  "vacancy-5-science.docx": "99f0ce2d0826fa69e55ca4bccbc9515e4e5b1347b53b7e0e6e0ab63ee676a598",
  "vacancy-5-humanities.docx": "4efe7feacea8a31c3229f8d62f2464d4f181da19f3dd4463fd45f3bf5313c753",
  "page-schedule-2026.html": "4f948fc841e70f799ceaa5d30eb76fe392c96d6cb50debaf550b7feb2df885ef",
  "schedule-2026.png": "9851301b1ee9e6baa1b6764c8d463b840bc12d036a3d96bc2bc99bce615177c3",
});

export const EXPECTED_DERIVED_HASHES = Object.freeze({
  "vacancy-counterpart-counterpart.csv": "e9b672cc242392af90e7169f83bb00a7cfd200797b94577377c01caf2f97983b",
});

const ADMISSION_SCHEDULE = Object.freeze([
  { batch: "提前单独录取本科批", start: "2026-07-11", end: "2026-07-18" },
  { batch: "专项批次", start: "2026-07-19", end: "2026-07-22" },
  { batch: "本科一批（含预科班）", start: "2026-07-23", end: "2026-07-31" },
  { batch: "本科二批（含预科班）", start: "2026-08-01", end: "2026-08-09" },
  { batch: "专科批（含提前单独录取专科、艺体类专科）", start: "2026-08-10", end: "2026-08-20" },
  { batch: "对口高职专科批", start: "2026-08-21", end: "2026-08-25" },
]);

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, useCache: false, scheduleUrl: SCHEDULE_URL };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--out") args.out = argv[++index];
    else if (item === "--use-cache") args.useCache = true;
    else if (item === "--schedule-url") args.scheduleUrl = argv[++index];
    else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-xizang-vacancy-plans-2025-v3272.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-xizang-vacancy-plans-2025-v3272.mjs --use-cache",
    "",
    "Imports official-attributed Xizang 2025 vacancy-plan attachments and the 2026 admission schedule.",
  ].join("\n");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function shortHash(value, length = 18) {
  return sha256(String(value)).slice(0, length);
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'");
}

function cleanText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  const match = /(\d{4})年(\d{2})月(\d{2})日/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

export function assertSourceUrl(value, kind = "page") {
  const url = new URL(value);
  const pageAllowed = url.hostname === "gaokao.chsi.com.cn";
  const assetAllowed = /^t[1-4]\.chei\.com\.cn$/.test(url.hostname);
  if ((kind === "page" && !pageAllowed) || (kind === "asset" && !assetAllowed)) {
    throw new Error(`${kind} URL is outside the CHSI/CHEI source allowlist: ${value}`);
  }
  if (url.protocol !== "https:") throw new Error(`${kind} URL must use HTTPS: ${value}`);
  return url.href;
}

export function assertPinnedHash(fileName, buffer) {
  const actual = sha256(buffer);
  const expected = EXPECTED_RAW_HASHES[fileName];
  if (!expected && !CAPTURE_HASHES) throw new Error(`No pinned SHA-256 for ${fileName}`);
  if (expected && actual !== expected) {
    throw new Error(`${fileName} SHA-256 mismatch: expected ${expected}, got ${actual}`);
  }
  return actual;
}

export async function download(url, kind, accept, fetchImpl = fetch, maxAttempts = 3) {
  assertSourceUrl(url, kind);
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "user-agent": "Mozilla/5.0 gaokao-xizang-vacancy-importer/1.0", accept },
        redirect: "follow",
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      assertSourceUrl(response.url || url, kind);
      return { buffer: Buffer.from(await response.arrayBuffer()), finalUrl: response.url || url };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([`${command} ${args.join(" ")} failed`, result.stderr, result.stdout].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function parsePage(html, config) {
  const title = cleanText(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] || "");
  const newsBlock = /<div class="news-msg">([\s\S]*?)<\/div>/i.exec(html)?.[1] || "";
  const publishedAt = normalizeDate(cleanText(newsBlock));
  const publisher = cleanText(newsBlock).replace(/^\d{4}年\d{2}月\d{2}日\s{0,}/, "").replace(/^来源：/, "");
  if (title !== config.title) throw new Error(`Unexpected title for ${config.id}: ${title}`);
  if (publishedAt !== config.publishedAt) throw new Error(`Unexpected publication date for ${config.id}: ${publishedAt}`);
  if (!publisher.includes("西藏自治区教育考试院")) throw new Error(`Unexpected publisher for ${config.id}: ${publisher}`);
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ url: new URL(match[1], config.url).href, text: cleanText(match[2]) }))
    .filter((item) => /\.(?:docx|xls)(?:$|\?)/i.test(item.url));
  if (links.length !== config.attachments.length) {
    throw new Error(`${config.id} expected ${config.attachments.length} attachments, got ${links.length}`);
  }
  return { title, publishedAt, publisher, links };
}

function parseSchedulePage(html) {
  const title = cleanText(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] || "");
  const newsBlock = /<div class="news-msg">([\s\S]*?)<\/div>/i.exec(html)?.[1] || "";
  const publishedAt = normalizeDate(cleanText(newsBlock));
  const publisher = cleanText(newsBlock).replace(/^\d{4}年\d{2}月\d{2}日\s{0,}/, "").replace(/^来源：/, "");
  if (title !== "西藏：2026年普通高校招生录取工作进度计划"
    || publishedAt !== "2026-07-13"
    || !publisher.includes("西藏自治区教育考试院")) {
    throw new Error(`Unexpected schedule metadata: ${JSON.stringify({ title, publishedAt, publisher })}`);
  }
  const imageUrl = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], SCHEDULE_URL).href)
    .find((url) => /2293870889\.png(?:$|\?)/.test(url));
  if (!imageUrl || imageUrl !== SCHEDULE_IMAGE_URL) throw new Error(`Unexpected schedule image URL: ${imageUrl}`);
  return { title, publishedAt, publisher, imageUrl };
}

function xmlCellText(xml) {
  return decodeEntities(xml
    .replace(/<w:tab\b[^>]*\/>/gi, "\t")
    .replace(/<w:br\b[^>]*\/>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseCodeName(value) {
  const lines = String(value || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
  if (lines.length >= 2 && /^[0-9A-Z]{2,4}$/.test(lines[0])) {
    return { code: lines[0], name: lines.slice(1).join(" ") };
  }
  const match = /^([0-9A-Z]{2,4})\s+(.+)$/.exec(lines.join(" "));
  return match ? { code: match[1], name: match[2].trim() } : null;
}

function numberFromCell(value) {
  const text = String(value || "").replace(/[,，]/g, "").trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

function extractEligibilityThresholds(remark) {
  const thresholds = {};
  for (const className of ["A", "B"]) {
    const match = new RegExp(`${className}类(?:考生)?[^。；;]{0,20}?不低于\\s*(\\d+)\\s*分`, "i").exec(remark);
    if (match) thresholds[className] = Number(match[1]);
  }
  return Object.keys(thresholds).length ? thresholds : undefined;
}

function disciplineCodesForMajor(majorName) {
  const text = String(majorName || "");
  const rules = [
    ["01", /哲学|逻辑学|宗教学|伦理学/],
    ["02", /经济|金融|财政|税收|保险|投资|国际贸易|商务经济/],
    ["03", /法学|法律|政治|社会工作|社会学|民族学|公安|治安|侦查|边防/],
    ["04", /教育|学前|小学教育|体育|运动训练/],
    ["05", /汉语言|新闻|传播|广告|外语|英语|日语|翻译|秘书/],
    ["06", /历史|考古|文物|文化遗产/],
    ["07", /数学|物理学|化学|天文|地理科学|大气科学|海洋科学|地球物理|地质学|生物科学|心理学|统计学/],
    ["09", /农学|园艺|植物保护|种子|茶学|动物科学|动物医学|林学|园林|水产|草业|畜牧|兽医/],
    ["10", /临床医学|口腔|医学|护理|药学|中药|康复|卫生|健康管理|助产|针灸|推拿/],
    ["12", /管理|会计|审计|财务|市场营销|电子商务|物流|旅游|酒店|人力资源|公共事业/],
    ["13", /艺术|音乐|舞蹈|美术|设计|戏剧|影视|动画|播音|书法/],
    ["08", /计算机|软件|数字媒体技术|数据|人工智能|电子|电气|自动化|机械|材料|土木|建筑|能源|交通|航空|航海|船舶|测绘|环境|食品|化工|生物工程|工程|技术|网络|通信|信息安全|物联网|虚拟现实|智能/],
  ];
  const matched = rules.find(([, pattern]) => pattern.test(text));
  return matched ? [matched[0]] : [];
}

function recordSpecialPathReason(config, parsed) {
  if (config.special) return config.batch;
  const text = `${parsed.schoolName || ""} ${parsed.majorName || ""} ${parsed.remark || ""}`;
  if (/边境专项(?:计划)?|[（(]边境[）)]/.test(text)) return "边境专项计划";
  return "";
}

function commonRecord(config, attachment, parsed) {
  const thresholds = extractEligibilityThresholds(parsed.remark || "");
  const specialPathReason = recordSpecialPathReason(config, parsed);
  const record = {
    province: "西藏",
    year: 2025,
    subjectType: parsed.subjectType || attachment.subject,
    batch: config.batch,
    schoolName: parsed.schoolName,
    schoolCode: parsed.schoolCode,
    dataType: "admission-plan",
    majorName: parsed.majorName,
    majorCode: parsed.majorCode,
    majorGroup: parsed.majorGroup || `${parsed.schoolName}|${config.batch}|${parsed.subjectType || attachment.subject}`,
    disciplineCodes: disciplineCodesForMajor(parsed.majorName),
    planCount: parsed.planCount,
    tuition: parsed.tuition || "",
    programDuration: parsed.programDuration || "",
    planRemark: parsed.remark || "",
    planRestrictionText: parsed.remark || "",
    sourceQuality: SOURCE_QUALITY,
    sourceId: SOURCE_ID,
    sourceSubjectRaw: parsed.subjectType || attachment.subject,
    formalScoreScope: specialPathReason ? "special-path-only" : "vacancy-plan-only",
    sourcePublishedAt: config.publishedAt,
    sourceUrl: config.url,
    sourceAttachment: attachment.url,
    planOnly: true,
    planStage: "征集志愿",
    vacancyRound: config.round,
    vacancyAnnouncement: config.title,
    cautions: [
      "本记录是2025年该轮征集志愿填报前的剩余计划快照，只用于识别历史补录机会和核验专业池，不是录取最低分、最低位次或下一年计划。",
      "同一专业可能跨多轮重复出现，各轮剩余计划不得相加为年度招生计划或录取人数。",
    ],
  };
  if (thresholds) record.eligibilityThresholds = thresholds;
  if (specialPathReason) {
    record.specialPathReason = specialPathReason;
    record.cautions.push(`该记录属于${specialPathReason}等特殊入口，必须另行核验报考资格。`);
  }
  return record;
}

function parseDocx(file, config, attachment) {
  const xml = run("unzip", ["-p", file, "word/document.xml"]);
  if (!xml.includes("<w:document")) throw new Error(`${path.basename(file)} has no Word document XML`);
  const bodyText = xmlCellText(xml);
  const headingMatch = new RegExp(`${attachment.subject.replace("类", "")}类?[（(](\\d+)名[）)]`).exec(bodyText)
    || /[（(](\d+)名[）)]/.exec(bodyText);
  const expectedPlanCount = headingMatch ? Number(headingMatch[1]) : null;
  const records = [];
  const schoolTotals = [];
  let currentSchool = null;
  let tableCount = 0;
  for (const tableMatch of xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/gi)) {
    const rows = [...tableMatch[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gi)]
      .map((rowMatch) => [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gi)].map((cell) => xmlCellText(cell[0])));
    if (!rows.some((row) => /院校及专业代号/.test(row[0] || ""))) continue;
    tableCount += 1;
    for (const row of rows) {
      if (/院校及专业代号/.test(row[0] || "")) continue;
      const codeName = parseCodeName(row[0]);
      if (!codeName) continue;
      const duration = row[1] || "";
      const planCount = numberFromCell(row[2]);
      const tuition = row[3] || "";
      const remark = row.slice(4).filter(Boolean).join("；");
      if (codeName.code.length === 4) {
        currentSchool = { schoolCode: codeName.code, schoolName: codeName.name };
        if (planCount !== null) schoolTotals.push({ ...currentSchool, planCount });
        continue;
      }
      if (codeName.code.length !== 2 || !currentSchool) continue;
      if (!Number.isInteger(planCount) || planCount <= 0) {
        throw new Error(`${path.basename(file)} invalid plan count for ${currentSchool.schoolName} ${codeName.name}: ${row[2]}`);
      }
      records.push(commonRecord(config, attachment, {
        ...currentSchool,
        majorCode: codeName.code,
        majorName: codeName.name,
        subjectType: attachment.subject,
        programDuration: duration,
        planCount,
        tuition,
        remark,
      }));
    }
  }
  if (!tableCount || !records.length) throw new Error(`${path.basename(file)} yielded no vacancy-plan records`);
  const parsedPlanCount = records.reduce((sum, record) => sum + record.planCount, 0);
  const schoolPlanCount = schoolTotals.reduce((sum, row) => sum + row.planCount, 0);
  if (expectedPlanCount !== null && parsedPlanCount !== expectedPlanCount) {
    throw new Error(`${path.basename(file)} heading plan ${expectedPlanCount} != parsed ${parsedPlanCount}`);
  }
  if (schoolPlanCount && parsedPlanCount !== schoolPlanCount) {
    throw new Error(`${path.basename(file)} school totals ${schoolPlanCount} != parsed ${parsedPlanCount}`);
  }
  return { records, tableCount, expectedPlanCount, parsedPlanCount, schoolPlanCount };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") quoted = false;
      else cell += char;
      continue;
    }
    if (char === "\"") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseXls(file, config, attachment) {
  const csvFile = file.replace(/\.xls$/i, ".csv");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gaokao-xizang-xls-"));
  let csvBuffer;
  try {
    run("/opt/homebrew/bin/soffice", ["--headless", "--convert-to", "csv", "--outdir", tempDir, file]);
    const convertedCsv = path.join(tempDir, path.basename(csvFile));
    if (!fs.existsSync(convertedCsv)) throw new Error(`LibreOffice did not create ${convertedCsv}`);
    csvBuffer = fs.readFileSync(convertedCsv);
    const expectedDerivedHash = EXPECTED_DERIVED_HASHES[path.basename(csvFile)];
    const actualDerivedHash = sha256(csvBuffer);
    if (!expectedDerivedHash || actualDerivedHash !== expectedDerivedHash) {
      throw new Error(`${path.basename(csvFile)} derived SHA-256 mismatch: expected ${expectedDerivedHash || "missing"}, got ${actualDerivedHash}`);
    }
    fs.writeFileSync(csvFile, csvBuffer);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const rows = parseCsv(csvBuffer.toString("utf8")).filter((row) => row.some((cell) => String(cell).trim()));
  const headerIndex = rows.findIndex((row) => row.some((cell) => cleanText(cell) === "院校代号"));
  if (headerIndex < 0) throw new Error(`${path.basename(file)} missing expected XLS header`);
  const headers = rows[headerIndex].map((item) => cleanText(item));
  const value = (row, name) => cleanText(row[headers.indexOf(name)] || "");
  const records = [];
  let candidateClass = "";
  let majorCategory = "";
  for (const row of rows.slice(headerIndex + 1)) {
    candidateClass = value(row, "考生类别") || candidateClass;
    majorCategory = value(row, "专业大类") || majorCategory;
    const schoolCode = value(row, "院校代号");
    const schoolName = value(row, "院校名称");
    const majorCode = value(row, "专业代号");
    const majorName = value(row, "专业名称");
    const planCount = numberFromCell(value(row, "计划数"));
    if (!schoolCode && !schoolName && !majorCode && !majorName) continue;
    if (!schoolCode || !schoolName || !majorCode || !majorName || !Number.isInteger(planCount) || planCount <= 0) {
      throw new Error(`${path.basename(file)} invalid XLS row: ${JSON.stringify(row)}`);
    }
    const parsed = {
      schoolCode,
      schoolName,
      majorCode,
      majorName,
      subjectType: candidateClass ? `对口高职-${candidateClass}` : "对口高职",
      majorGroup: majorCategory || `${schoolName}|对口高职`,
      programDuration: value(row, "学制"),
      tuition: value(row, "学费"),
      planCount,
      remark: value(row, "备注"),
    };
    const record = commonRecord(config, attachment, parsed);
    record.candidateClass = candidateClass;
    records.push(record);
  }
  const parsedPlanCount = records.reduce((sum, record) => sum + record.planCount, 0);
  if (records.length !== 13 || parsedPlanCount !== 24) {
    throw new Error(`${path.basename(file)} expected 13 records/24 plans, got ${records.length}/${parsedPlanCount}`);
  }
  return {
    records,
    tableCount: 1,
    expectedPlanCount: 24,
    parsedPlanCount,
    schoolPlanCount: null,
    csvFile,
    csvBytes: csvBuffer.length,
    csvSha256: sha256(csvBuffer),
  };
}

function assignStableIdsAndRepeatCounts(records) {
  const groups = new Map();
  for (const record of records) {
    const key = [
      record.subjectType,
      record.batch,
      record.schoolCode || record.schoolName,
      record.majorCode || record.majorName,
    ].join("|");
    record.vacancyKey = key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.sourcePublishedAt.localeCompare(b.sourcePublishedAt)
      || String(a.vacancyRound).localeCompare(String(b.vacancyRound), "zh-Hans-CN", { numeric: true }));
    const rounds = [...new Set(group.map((record) => String(record.vacancyRound)))]
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
    const occurrenceByRound = new Map(rounds.map((round, index) => [round, index + 1]));
    group.forEach((record, index) => {
      record.vacancyRepeatCount = rounds.length;
      record.vacancyOccurrence = occurrenceByRound.get(String(record.vacancyRound));
      record.id = `2025-xz-vacancy-${shortHash([
        SOURCE_ID,
        record.vacancyRound,
        record.subjectType,
        record.batch,
        record.schoolCode,
        record.majorCode,
        record.planCount,
        record.planRemark,
      ].join("|"))}`;
    });
  }
  const ids = records.map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate vacancy record IDs detected");
}

function rawFileDescriptor(file, buffer, extra = {}) {
  return { path: rel(file), bytes: buffer.length, sha256: sha256(buffer), ...extra };
}

async function ensureRawFile(fileName, url, kind, accept, useCache) {
  const file = path.join(RAW_DIR, fileName);
  let finalUrl = url;
  if (!useCache || !fs.existsSync(file)) {
    const downloaded = await download(url, kind, accept);
    fs.writeFileSync(file, downloaded.buffer);
    finalUrl = downloaded.finalUrl;
  }
  const buffer = fs.readFileSync(file);
  assertPinnedHash(fileName, buffer);
  return { file, buffer, finalUrl };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (PROJECT_ROOT.startsWith("/Volumes/mac_2T/")) {
    throw new Error("Refusing to run the importer directly on mac_2T; use internal APFS staging.");
  }
  args.scheduleUrl = assertSourceUrl(args.scheduleUrl, "page");
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const outFile = path.resolve(PROJECT_ROOT, args.out);
  const records = [];
  const rawFiles = [];
  const attachmentAudits = [];
  const pageAudits = [];

  for (const config of ANNOUNCEMENTS) {
    const pageName = `page-vacancy-${config.id}.html`;
    const page = await ensureRawFile(pageName, config.url, "page", "text/html,application/xhtml+xml", args.useCache);
    const meta = parsePage(page.buffer.toString("utf8"), config);
    rawFiles.push(rawFileDescriptor(page.file, page.buffer, { url: config.url, finalUrl: page.finalUrl, kind: "page" }));
    pageAudits.push({ id: config.id, title: meta.title, publishedAt: meta.publishedAt, publisher: meta.publisher, url: config.url });
    const unmatchedLinks = [...meta.links];
    for (const expected of config.attachments) {
      const subjectPattern = expected.subject === "对口高职" ? /对口高职/ : new RegExp(expected.subject.replace("类", ""));
      const extensionPattern = new RegExp(`\\.${expected.ext}(?:$|\\?)`, "i");
      const linkIndex = unmatchedLinks.findIndex((link) => subjectPattern.test(link.text) && extensionPattern.test(link.url));
      if (linkIndex < 0) throw new Error(`${config.id} missing ${expected.subject} ${expected.ext} attachment`);
      const link = unmatchedLinks.splice(linkIndex, 1)[0];
      const subjectSlug = expected.subject === "理工类" ? "science" : expected.subject === "文史类" ? "humanities" : "counterpart";
      const fileName = `vacancy-${config.id}-${subjectSlug}.${expected.ext}`;
      const asset = await ensureRawFile(
        fileName,
        assertSourceUrl(link.url, "asset"),
        "asset",
        expected.ext === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.ms-excel",
        args.useCache,
      );
      if (expected.ext === "docx" && asset.buffer.subarray(0, 2).toString("ascii") !== "PK") {
        throw new Error(`${fileName} is not an OOXML ZIP`);
      }
      const attachment = { ...expected, url: link.url, linkText: link.text, file: asset.file };
      const parsed = expected.ext === "docx"
        ? parseDocx(asset.file, config, attachment)
        : parseXls(asset.file, config, attachment);
      records.push(...parsed.records);
      rawFiles.push(rawFileDescriptor(asset.file, asset.buffer, {
        url: link.url,
        finalUrl: asset.finalUrl,
        kind: expected.ext,
      }));
      attachmentAudits.push({
        announcement: config.id,
        vacancyRound: config.round,
        batch: config.batch,
        formalScoreScope: config.special ? "special-path-only" : "vacancy-plan-only",
        subjectType: expected.subject,
        file: rel(asset.file),
        sourceUrl: link.url,
        records: parsed.records.length,
        parsedPlanCount: parsed.parsedPlanCount,
        expectedPlanCount: parsed.expectedPlanCount,
        schoolPlanCount: parsed.schoolPlanCount,
        tableCount: parsed.tableCount,
        ...(parsed.csvFile ? { csvFile: rel(parsed.csvFile), csvBytes: parsed.csvBytes, csvSha256: parsed.csvSha256 } : {}),
      });
    }
    if (unmatchedLinks.length) throw new Error(`${config.id} has unmatched attachments: ${JSON.stringify(unmatchedLinks)}`);
  }

  assignStableIdsAndRepeatCounts(records);
  if (records.some((record) => "minScore" in record || "minRank" in record || "minRankEnd" in record)) {
    throw new Error("Vacancy-plan records must not contain admission score/rank fields");
  }

  const schedulePage = await ensureRawFile("page-schedule-2026.html", args.scheduleUrl, "page", "text/html,application/xhtml+xml", args.useCache);
  const scheduleMeta = parseSchedulePage(schedulePage.buffer.toString("utf8"));
  const scheduleImage = await ensureRawFile("schedule-2026.png", scheduleMeta.imageUrl, "asset", "image/png", args.useCache);
  if (scheduleImage.buffer.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("Schedule image is not a PNG");
  const scheduleRawFiles = [
    rawFileDescriptor(schedulePage.file, schedulePage.buffer, { url: args.scheduleUrl, finalUrl: schedulePage.finalUrl, kind: "page" }),
    rawFileDescriptor(scheduleImage.file, scheduleImage.buffer, { url: scheduleMeta.imageUrl, finalUrl: scheduleImage.finalUrl, kind: "image" }),
  ];

  const ordinaryRecords = records.filter((record) => record.formalScoreScope === "vacancy-plan-only");
  const specialRecords = records.filter((record) => record.formalScoreScope === "special-path-only");
  const vocationalRecords = records.filter((record) => /专科|高职/.test(record.batch));
  const ordinaryVocationalRecords = ordinaryRecords.filter((record) => /专科|高职/.test(record.batch));
  const repeatedRecords = records.filter((record) => record.vacancyRepeatCount > 1);
  const eligibilityRecords = records.filter((record) => record.eligibilityThresholds);
  const digitalMediaRecords = records.filter((record) => /数字媒体技术/.test(record.majorName));

  let generatedAt = new Date().toISOString();
  if (args.useCache && fs.existsSync(outFile)) {
    const existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
    if (existing.dataset === "official-xizang-vacancy-plans-2025-v3272" && existing.generatedAt) {
      generatedAt = existing.generatedAt;
    }
  }
  const vacancySourceNote = {
    id: SOURCE_ID,
    title: "西藏自治区2025年普通高校招生征集志愿计划（第5、6、7、9、10、11、12、14、15、16、17号及对口高职）",
    publisher: "西藏自治区教育考试院（阳光高考转载）",
    province: "西藏",
    year: 2025,
    url: "https://gaokao.chsi.com.cn/gkxx/zc/ss?regionId=086540000",
    quality: SOURCE_QUALITY,
    usage: "用于识别2025年各轮征集志愿填报前的院校专业池、当轮剩余计划、学费和资格限制；普通与特殊入口分开消费。",
    parsedRecords: records.length,
    announcementCount: ANNOUNCEMENTS.length,
    attachmentCount: attachmentAudits.length,
    ordinaryRecords: ordinaryRecords.length,
    specialPathRecords: specialRecords.length,
    ordinaryVocationalRecords: ordinaryVocationalRecords.length,
    planSnapshotCount: records.reduce((sum, record) => sum + record.planCount, 0),
    announcementPages: pageAudits,
    attachmentAudits,
    rawFiles,
    cautions: [
      "征集计划是各轮填报前的时点剩余计划，同一专业可跨轮重复出现；不得把多轮计划相加为年度计划或录取人数。",
      "备注中的A/B类资格分数只表示可填报门槛，不是院校或专业投档/录取最低分。",
      "该数据不包含普通类一分一段、全量投档/录取表或专业最低位次，不能据此闭合西藏录取概率。",
    ],
  };
  const scheduleSourceNote = {
    id: SCHEDULE_SOURCE_ID,
    title: scheduleMeta.title,
    publisher: "西藏自治区教育考试院（阳光高考转载）",
    province: "西藏",
    year: 2026,
    url: args.scheduleUrl,
    imageUrl: scheduleMeta.imageUrl,
    publishedAt: scheduleMeta.publishedAt,
    quality: "official-province-xizang-2026-admission-schedule-chsi-mirror",
    usage: "用于解释2026年各批次录取结果的发布时间窗口；未进入或未结束的批次不得声称全量结果已经发布。",
    schedule: ADMISSION_SCHEDULE,
    rawFiles: scheduleRawFiles,
    cautions: [
      "录取进度计划只说明工作时间窗，不是投档线、录取分、位次或录取结果。",
      "页面应按当前日期显示进行中、未开始或已结束，不得以计划表替代正式结果公告。",
    ],
  };
  const payload = {
    dataset: "official-xizang-vacancy-plans-2025-v3272",
    generatedAt,
    scope: "province-official-vacancy-plan-snapshots-and-admission-schedule",
    sourceNotes: [vacancySourceNote, scheduleSourceNote],
    records,
    audit: {
      hashCaptureMode: CAPTURE_HASHES,
      expectedHashCoverage: Object.keys(EXPECTED_RAW_HASHES).length,
      vacancyPageCount: pageAudits.length,
      attachmentCount: attachmentAudits.length,
      docxAttachmentCount: attachmentAudits.filter((item) => item.file.endsWith(".docx")).length,
      xlsAttachmentCount: attachmentAudits.filter((item) => item.file.endsWith(".xls")).length,
      recordCount: records.length,
      ordinaryRecordCount: ordinaryRecords.length,
      specialPathRecordCount: specialRecords.length,
      vocationalRecordCount: vocationalRecords.length,
      ordinaryVocationalRecordCount: ordinaryVocationalRecords.length,
      planSnapshotCount: records.reduce((sum, record) => sum + record.planCount, 0),
      repeatedRecordCount: repeatedRecords.length,
      repeatedGroupCount: new Set(repeatedRecords.map((record) => record.vacancyKey)).size,
      eligibilityRecordCount: eligibilityRecords.length,
      digitalMediaTechnologyRecords: digitalMediaRecords.length,
      scheduleRows: ADMISSION_SCHEDULE.length,
      minScoreFieldCount: records.filter((record) => "minScore" in record).length,
      minRankFieldCount: records.filter((record) => "minRank" in record || "minRankEnd" in record).length,
    },
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: rel(outFile),
    ...payload.audit,
    rawHashMap: Object.fromEntries([...rawFiles, ...scheduleRawFiles].map((item) => [path.basename(item.path), item.sha256])),
  }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
