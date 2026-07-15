#!/usr/bin/env node

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const YEAR = 2022;
const DEFAULT_OUT = "data/admissions/official-national-school-admission-2022-v3214-sqnu-import.json";
const RAW_DIR = "data/admissions/raw/official-national-school-admission-2022-v3214-sqnu";
const BASE_URL = "https://zhaoban.sqnu.edu.cn";
const INDEX_URL = `${BASE_URL}/lqfs.htm`;
const PDFTOTEXT_BIN = process.env.PDFTOTEXT_BIN || "/opt/homebrew/bin/pdftotext";

const PAGES = [
  {
    key: "outside-ordinary-sports-art-2022",
    title: "商丘师范学院2022年外省（普通本科，体育，艺术类本科）录取情况",
    url: `${BASE_URL}/info/1005/3256.htm`,
    rawBase: "2022-outside-ordinary-sports-art",
    parser: "outsideUnranked2022",
  },
  {
    key: "henan-preparatory-2022",
    title: "商丘师范学院2022年河南省预科录取情况",
    url: `${BASE_URL}/info/1005/3252.htm`,
    rawBase: "2022-henan-preparatory",
    parser: "henanRankedMajorNoMajor",
  },
  {
    key: "henan-software-2022",
    title: "商丘师范学院2022年软件学院各专业录取情况",
    url: `${BASE_URL}/info/1005/3251.htm`,
    rawBase: "2022-henan-software",
    parser: "henanRankedMajorNoCount",
  },
  {
    key: "henan-joint-sqvtc-2022",
    title: "商丘师范学院2022年与商丘职业技术学院联办录取情况（6058）",
    url: `${BASE_URL}/info/1005/3250.htm`,
    rawBase: "2022-henan-joint-sqvtc",
    parser: "henanRankedMajor",
  },
  {
    key: "henan-coop-2022",
    title: "商丘师范学院2022年中外合作办学本、专科录取情况（6057）",
    url: `${BASE_URL}/info/1005/3249.htm`,
    rawBase: "2022-henan-coop",
    parser: "henanRankedMajor",
  },
  {
    key: "henan-major-2022",
    title: "商丘师范学院2022年本科二批各专业录取情况（6055）",
    url: `${BASE_URL}/info/1005/3248.htm`,
    rawBase: "2022-henan-major",
    parser: "henanRankedMajorNoCount",
  },
  {
    key: "henan-subject-public-funded-teacher-2022",
    title: "商丘师范学院2022年学科教师公费师范生录取情况",
    url: `${BASE_URL}/info/1005/3247.htm`,
    rawBase: "2022-henan-subject-public-funded-teacher",
    parser: "henanPublicTeacher",
  },
  {
    key: "henan-primary-public-funded-teacher-2022",
    title: "商丘师范学院2022年小学全科公费师范生录取情况",
    url: `${BASE_URL}/info/1005/3246.htm`,
    rawBase: "2022-henan-primary-public-funded-teacher",
    parser: "henanPublicTeacher",
  },
  {
    key: "henan-art-2022",
    title: "商丘师范学院2022年艺术本科及艺术专科录取情况",
    url: `${BASE_URL}/info/1005/3245.htm`,
    rawBase: "2022-henan-art",
    parser: "henanArtSports2023",
  },
  {
    key: "henan-sports-2022",
    title: "商丘师范学院2022年河南省体育本科录取情况",
    url: `${BASE_URL}/info/1005/3244.htm`,
    rawBase: "2022-henan-sports",
    parser: "henanSportsMinOnly",
  },
  {
    key: "henan-upgrade-2022",
    title: "商丘师范学院2022年专升本录取情况",
    url: `${BASE_URL}/info/1005/3243.htm`,
    rawBase: "2022-henan-upgrade",
    parser: "henanUpgrade",
  },
];

const SOURCE = {
  id: "official-sqnu-national-2022-school-major-admission",
  quality: "official-school-sqnu-2022-national-pdf-score-rank",
  schoolCode: "10483",
  schoolName: "商丘师范学院",
  city: "商丘",
  tags: ["师范", "河南", "商丘", "商丘师范学院"],
};

const PROVINCE_ALIASES = new Map([
  ["北京市", "北京"],
  ["天津市", "天津"],
  ["河北省", "河北"],
  ["山西省", "山西"],
  ["内蒙古自治区", "内蒙古"],
  ["辽宁省", "辽宁"],
  ["吉林省", "吉林"],
  ["黑龙江省", "黑龙江"],
  ["上海市", "上海"],
  ["江苏省", "江苏"],
  ["浙江省", "浙江"],
  ["安徽省", "安徽"],
  ["福建省", "福建"],
  ["江西省", "江西"],
  ["山东省", "山东"],
  ["河南省", "河南"],
  ["湖北省", "湖北"],
  ["湖南省", "湖南"],
  ["广东省", "广东"],
  ["广西壮族自治区", "广西"],
  ["海南省", "海南"],
  ["重庆市", "重庆"],
  ["四川省", "四川"],
  ["贵州省", "贵州"],
  ["云南省", "云南"],
  ["西藏自治区", "西藏"],
  ["陕西省", "陕西"],
  ["甘肃省", "甘肃"],
  ["青海省", "青海"],
  ["宁夏回族自治区", "宁夏"],
  ["新疆维吾尔自治区", "新疆"],
  ["新疆维吾尔族自治区", "新疆"],
]);

const PROVINCE_RE = "(?:北京|天津|河北|山西|内蒙古|辽宁|吉林|黑龙江|上海|江苏|浙江|安徽|福建|江西|山东|河南省?|湖北|湖南|广东|广西|海南|重庆|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆)";
const SUBJECT_RE = "(?:综合改革|普通类|历史类|物理类|文史|理工|文科综合|理科综合|艺术类|艺术|体育类|文艺|文理综合|专升本|书法学校际联考|书法类统考|书法类|播音与主持类统考|播音与主持类|美术与设计类统考|美术与设计类|美术统考|舞蹈类统考|舞蹈类|舞蹈统考|器乐统考|声乐统考|音乐表演类（器乐）统考|音乐表演类（声乐）统考|体育（历史科目组合）|体育（物理科目组合）|体育\\(不分文理\\)|体育\\(不分科目类\\)|体育（不分科目类）|艺术\\(不分文理\\)|艺术（不分文理）|艺术\\(历史类\\)|艺术\\(不分科目类\\)|体育类（历史等科目类）|美术（历史等科目类）|声乐（历史等科目类）|器乐（历史等科目类）|美术与设计（历史等科目类）|体育类（历史科目组）|体育类（不分历史物理）|艺术类（不分历史物理）)";
const BATCH_RE = "(?:艺术第二批\\(统考本科批\\)\\(B段\\)|体育类第一批\\(统考本科批\\)|本科提前批艺术类本科第二批|艺术类体育类本科一批|艺术类本科批书法类|艺术类本科批播音与主持类|艺术类本科批美术与设计类|艺术类本科批舞蹈类|艺术类本科批音乐类|艺术类本科批统考|艺术体育统考本科批|艺术二批\\(B段\\)|艺术类本科二批|本科征集志愿批|体育艺术本一U段|本提前艺本二批|本科A电编类|本科A美术类|本科A音乐类|艺术本科B|艺术本科统考批|艺术类本科批|艺术本科2小批|艺术本科A段|艺术本科批|艺术专科批|提前批体育本科|体育类本科批|体育本科批|体育本科|本科提前批|提前批公费师范生|专升本批|普通本科批|普通类平行|本科第二批B类|本科一批|本科二批|本科批B段|本科批|专科批|普通类|常规批|二本)";
const NUM_RE = "-?\\d+(?:\\.\\d+)?|-";

const ART_PATTERN = /艺术|美术|音乐|舞蹈|播音|编导|表演|戏剧|影视|动画|视觉传达|环境设计|书法|摄影|器乐|声乐|设计/;
const SPORTS_PATTERN = /体育|社会体育|运动训练/;
const SPECIAL_PATTERN = /公费师范|定向|西藏|专项|预科|专升本|单列|地方公费|优师|对口|民族|内高班|南疆|哈密/;
const COOP_PATTERN = /中外合作|合作办学|联合办学|软件学院|嵌入式|商丘职业技术学院|联办/;

function usage() {
  return [
    "Usage:",
    `  node scripts/import-official-national-school-admission-2022-v3214-sqnu.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-official-national-school-admission-2022-v3214-sqnu.mjs --use-cache",
    "",
    "Imports 商丘师范学院招生信息网 official 2022 PDF admission score tables.",
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
    throw new Error("Refusing to run PDF ingestion from /Volumes/mac_2T; run this importer from the internal APFS project copy.");
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveProjectPath(rel) {
  return path.resolve(PROJECT_ROOT, rel);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function stableId(parts) {
  return sha256(parts.map((part) => String(part ?? "")).join("|")).slice(0, 18);
}

async function fetchBuffer(url, referer) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
          "user-agent": "Mozilla/5.0 gaokao-zhiyuan-site-data-ingest/1.0",
          accept: "text/html,application/pdf,application/xhtml+xml,application/xml,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          referer,
        },
      });
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${buffer.toString("utf8", 0, 200)}`);
      if (buffer.length < 1000) throw new Error(`Unexpectedly short source (${buffer.length} bytes) for ${url}`);
      return buffer;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function downloadHtml(page, rawRoot, useCache) {
  const htmlRel = `${page.rawBase}.html`;
  const htmlPath = path.join(rawRoot, htmlRel);
  if (useCache && fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, "utf8");
  const html = (await fetchBuffer(page.url, INDEX_URL)).toString("utf8").replace(/\0/g, "");
  if (!/showVsbpdfIframe/.test(html)) throw new Error(`No official PDF iframe found in ${page.url}`);
  fs.writeFileSync(htmlPath, html);
  return html;
}

function extractOfficialTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractPdfUrl(html, pageUrl) {
  const match = html.match(/showVsbpdfIframe\("([^"]+?\.pdf)"/i);
  if (!match) throw new Error(`Could not locate PDF URL in ${pageUrl}`);
  return new URL(match[1], pageUrl).href;
}

async function downloadPdf(page, html, rawRoot, useCache) {
  const pdfUrl = extractPdfUrl(html, page.url);
  const pdfRel = `${page.rawBase}.pdf`;
  const pdfPath = path.join(rawRoot, pdfRel);
  if (!useCache || !fs.existsSync(pdfPath)) {
    const pdf = await fetchBuffer(pdfUrl, page.url);
    if (!pdf.subarray(0, 5).toString("latin1").startsWith("%PDF")) {
      throw new Error(`Downloaded source is not a PDF for ${page.url}`);
    }
    fs.writeFileSync(pdfPath, pdf);
  }
  return { pdfUrl, pdfRel, pdfPath };
}

function extractTextFromPdf(page, pdfPath, rawRoot, useCache) {
  const txtRel = `${page.rawBase}.txt`;
  const txtPath = path.join(rawRoot, txtRel);
  if (useCache && fs.existsSync(txtPath)) return { txtRel, text: fs.readFileSync(txtPath, "utf8") };

  const candidates = [PDFTOTEXT_BIN, "pdftotext"];
  let lastError = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      childProcess.execFileSync(candidate, ["-layout", pdfPath, txtPath], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      });
      const text = fs.readFileSync(txtPath, "utf8");
      if (text.trim().length < 100) throw new Error(`pdftotext output too short for ${pdfPath}`);
      return { txtRel, text };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Failed to extract text from ${pdfPath}; install poppler pdftotext or set PDFTOTEXT_BIN. Last error: ${lastError?.message || lastError}`);
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function clean(value) {
  return decodeHtml(value)
    .replace(/\u00a0/g, " ")
    .replace(/[　]/g, " ")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return clean(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function parseNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text || text === "/" || text === "-" || text === "—" || text === "--") return null;
  const match = text.match(/^-?\d+(?:\.\d+)?$/);
  return match ? Number(match[0]) : null;
}

function integerNumber(value) {
  const n = parseNumber(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeProvince(raw) {
  const text = clean(raw).replace(/\s+/g, "");
  const withoutCategory = text.replace(/[（(].*?[）)]/g, "");
  return PROVINCE_ALIASES.get(text)
    || PROVINCE_ALIASES.get(withoutCategory)
    || withoutCategory.replace(/省$|市$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/g, "");
}

function normalizeSubject(raw, context = "", province = "") {
  const text = [raw, context].map(clean).join(" ");
  if (ART_PATTERN.test(text)) return "艺术类";
  if (SPORTS_PATTERN.test(text)) return "体育类";
  if (/专升本/.test(text)) return "专升本";
  if (/历史|文史|文科|历史科目|历史等科目/.test(text)) return "历史类";
  if (/物理|理工|理科|物理科目|物理等科目/.test(text)) return "物理类";
  if (/普通类|综合/.test(text) && ["北京", "天津", "上海", "浙江", "山东", "海南"].includes(province)) return "综合改革";
  if (/普通类|综合/.test(text)) return "官网未列科类";
  return clean(raw) || "官网未列科类";
}

function normalizeBatch(raw) {
  const text = clean(raw);
  if (/专升本/.test(text)) return "专升本批";
  if (/专科|高职/.test(text)) return "高职（专科）批";
  if (/提前批公费师范生/.test(text)) return "提前批公费师范生";
  if (/公费师范/.test(text)) return "公费师范生";
  if (/体育/.test(text)) return text;
  if (/艺术/.test(text)) return text;
  if (/普通类平行|常规批/.test(text)) return text;
  if (/本科第二批|本科二批/.test(text)) return "本科二批";
  if (/本科第一批|本科一批/.test(text)) return "本科一批";
  if (/普通本科批/.test(text)) return "本科批";
  if (/本科/.test(text)) return "本科批";
  return text || "官网未列批次";
}

function classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName, extraText = "") {
  const text = [sourceSubjectRaw, sourceBatchRaw, majorName, extraText].map(clean).join(" ");
  if (SPORTS_PATTERN.test(text)) {
    return { admissionType: "体育类录取", admissionSubtype: "体育类", formalScoreScope: "special-path-only" };
  }
  if (ART_PATTERN.test(text)) {
    return { admissionType: "艺术类录取", admissionSubtype: "艺术类", formalScoreScope: "special-path-only" };
  }
  if (SPECIAL_PATTERN.test(text)) {
    return { admissionType: "特殊类型录取", admissionSubtype: "公费师范/定向西藏等", formalScoreScope: "special-path-only" };
  }
  if (COOP_PATTERN.test(text)) {
    return { admissionType: "普通录取", admissionSubtype: "中外合作/联办/软件学院", formalScoreScope: "school-official-only" };
  }
  return { admissionType: "普通录取", admissionSubtype: "普通类", formalScoreScope: "school-official-only" };
}

function dataTypeFor(batch, majorName) {
  const text = [batch, majorName].map(clean).join(" ");
  if (/专科|高职/.test(text)) return "vocational-admission";
  return "major-admission";
}

function scoreMetric(classification, dataType) {
  if (classification.admissionType === "艺术类录取") return "艺术类综合分或学校源表计分";
  if (classification.admissionType === "体育类录取") return "体育类综合分或学校源表计分";
  if (classification.formalScoreScope === "special-path-only") return "特殊路径学校源表计分";
  if (dataType === "vocational-admission") return "高职专科学校官网录取分";
  return "高考文化分或学校官网投档成绩";
}

function parseTail(line, count) {
  const regex = new RegExp(`^\\s*(.*?)\\s+${Array(count).fill(`(${NUM_RE})`).join("\\s+")}\\s*$`);
  const match = String(line).replace(/\f/g, "").match(regex);
  if (!match) return null;
  return { left: clean(match[1]).replace(/^\d+\s+/, ""), nums: match.slice(2).map(clean) };
}

function shouldSkipTextLine(line) {
  const text = clean(line);
  if (!text) return true;
  return /省份|最高分|分数情况|录取情况|录取数|最低分位次|最低分\s+位次|注：|高考文化|统考成绩|绩×|序号/.test(text);
}

function startsWithProvince(line) {
  return new RegExp(`^\\s*(?:\\d+\\s+)?${PROVINCE_RE}`).test(line);
}

function makeRecord({
  page,
  rawPdfRel,
  rawTxtRel,
  rowIndex,
  province,
  sourceProvinceRaw,
  subjectType,
  sourceSubjectRaw,
  batch,
  sourceBatchRaw,
  majorName,
  college,
  candidateCounty,
  minScore,
  minScoreRaw,
  maxScore,
  maxScoreRaw,
  avgScore,
  avgScoreRaw,
  minRank,
  minRankRaw,
  controlLine,
  controlLineRaw,
  admissionCount,
  admissionCountRaw,
  classification,
  sourceLine,
  extra = {},
}) {
  const dataType = dataTypeFor(batch, majorName);
  const rankUnavailable = !Number.isFinite(minRank);
  const majorGroup = [SOURCE.schoolName, province, subjectType, batch, majorName, candidateCounty].filter(Boolean).join("-");
  const record = {
    id: `${YEAR}-sqnu-${dataType.replace(/-admission$/, "")}-${stableId([
      page.key,
      province,
      sourceSubjectRaw,
      sourceBatchRaw,
      majorName,
      candidateCounty,
      minScoreRaw,
      minRankRaw,
      rowIndex,
    ])}`,
    province,
    sourceProvinceRaw,
    year: YEAR,
    subjectType,
    sourceSubjectRaw,
    batch,
    sourceBatchRaw,
    schoolCode: SOURCE.schoolCode,
    schoolName: SOURCE.schoolName,
    city: SOURCE.city,
    schoolTags: SOURCE.tags,
    dataType,
    majorName,
    majorGroup,
    admissionType: classification.admissionType,
    admissionSubtype: classification.admissionSubtype,
    formalScoreScope: classification.formalScoreScope,
    minScore,
    scoreMetric: scoreMetric(classification, dataType),
    scoreOnly: rankUnavailable,
    rankUnavailable,
    sourceId: SOURCE.id,
    sourceQuality: SOURCE.quality,
    schoolOfficialScope: rankUnavailable ? "single-school-score" : "single-school-score-rank",
    sourceUrl: page.url,
    sourcePageUrl: page.url,
    sourceIndexUrl: INDEX_URL,
    officialEvidencePath: rawPdfRel,
    sourcePdfPath: rawPdfRel,
    sourceTextPath: rawTxtRel,
    sourcePageKey: page.key,
    sourcePageTitle: page.title,
    sourceMinScoreRaw: minScoreRaw,
    sourceMaxScoreRaw: maxScoreRaw,
    sourceAverageScoreRaw: avgScoreRaw,
    rawRow: {
      source: `sqnu-${YEAR}-official-pdf-pdftotext-line`,
      pageKey: page.key,
      rowIndex,
      sourceLine,
    },
    cautions: [
      `本记录来自商丘师范学院招生信息网官方 ${YEAR} 年录取分数 PDF，是单校分省/分专业录取边界，不是省级教育考试院全量投档/录取分数表。`,
      rankUnavailable
        ? "源表本行未公开最低分位次；运行层不生成假位次，推荐层不得仅凭本行分数单独输出录取概率。"
        : "本行含学校官网公布的最低分位次，但仍是单校来源；推荐层只能用于商丘师范学院候选边界复核。",
      classification.formalScoreScope === "special-path-only"
        ? "本行属于艺术、体育、公费师范、定向西藏等特殊路径，运行层按 special-path-only 隔离，不与普通批文化分边界混用。"
        : "普通学校官网单校分数按 formalScoreScope=school-official-only 保留，不替代同省省级正式投档表。",
      "正式填报前必须回到省级考试院投档表、当年招生计划、学校招生章程、专业选科、体检限制、学费校区、调剂规则和公费师范生/定向就业协议要求复核。",
    ],
    ...extra,
  };
  if (college) record.college = college;
  if (candidateCounty) record.candidateCounty = candidateCounty;
  if (Number.isFinite(maxScore)) record.maxScore = maxScore;
  if (Number.isFinite(avgScore)) record.avgScore = avgScore;
  if (Number.isFinite(minRank)) {
    record.minRank = minRank;
    record.minRankStart = minRank;
    record.minRankEnd = minRank;
    record.rankRangeText = String(minRank);
  }
  if (Number.isFinite(controlLine)) record.controlLine = controlLine;
  if (Number.isFinite(admissionCount)) record.admissionCount = admissionCount;
  if (minRankRaw) record.sourceRankRaw = minRankRaw;
  if (controlLineRaw) record.sourceControlLineRaw = controlLineRaw;
  if (admissionCountRaw) record.sourceAdmissionCountRaw = admissionCountRaw;
  return record;
}

function parseHenanRankedMajor(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})\\s+(.+)$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    const tail = parseTail(line, 5);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = tail.left.match(leftRegex);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw, majorNameRaw] = left;
    const [admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw, minRankRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(majorNameRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: integerNumber(minRankRaw),
      minRankRaw,
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
    }));
  });
  return { records, skippedRows };
}

function parseHenanRankedMajorNoCount(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})\\s+(.+)$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    const tail = parseTail(line, 4);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = tail.left.match(leftRegex);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw, majorNameRaw] = left;
    const [maxScoreRaw, minScoreRaw, avgScoreRaw, minRankRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(majorNameRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: integerNumber(minRankRaw),
      minRankRaw,
      admissionCount: null,
      admissionCountRaw: "",
      classification,
      sourceLine: clean(line),
    }));
  });
  return { records, skippedRows };
}

function parseHenanRankedMajorNoMajor(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    const tail = parseTail(line, 5);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = tail.left.match(leftRegex);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw] = left;
    const [admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw, minRankRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = "预科";
    const minScore = parseNumber(minScoreRaw);
    if (!Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName, "预科");
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: integerNumber(minRankRaw),
      minRankRaw,
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
      extra: { candidateCategory: "预科" },
    }));
  });
  return { records, skippedRows };
}

function parseHenanUnrankedMajor(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})\\s+(.+)$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    const tail = parseTail(line, 4);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = tail.left.match(leftRegex);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw, majorNameRaw] = left;
    const [admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(majorNameRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: null,
      minRankRaw: "",
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
    }));
  });
  return { records, skippedRows };
}

function parseOutsideUnranked2022(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  logicalOutsideLines(text, 4).forEach(({ line, rowIndex }) => {
    if (shouldSkipTextLine(line)) return;
    const tail = parseTail(line, 4);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = parseOutsideLeft(tail.left);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const { sourceProvinceRaw, sourceSubjectRaw, sourceBatchRaw, middleRaw } = left;
    const [admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(middleRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: null,
      minRankRaw: "",
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
    }));
  });
  return { records, skippedRows };
}

function parseHenanSportsMinOnly(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})\\s+(.+)$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    const tail = parseTail(line, 2);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = tail.left.match(leftRegex);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw, majorNameRaw] = left;
    const [admissionCountRaw, minScoreRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(majorNameRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: null,
      maxScoreRaw: "",
      avgScore: null,
      avgScoreRaw: "",
      minRank: null,
      minRankRaw: "",
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
    }));
  });
  return { records, skippedRows };
}

function parseHenanPublicTeacher(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})\\s+(\\S+)\\s+(.+)$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    const tail = parseTail(line, 4);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = tail.left.match(leftRegex);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw, candidateCounty, majorNameRaw] = left;
    const [admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(majorNameRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName, candidateCounty);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      candidateCounty,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: null,
      minRankRaw: "",
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
      extra: { candidateCategory: "学科教师公费师范生" },
    }));
  });
  return { records, skippedRows };
}

function parseHenanPreparatoryDirected(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegexWithMajor = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})\\s+(.+)$`);
  const leftRegexNoMajor = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    const tail = parseTail(line, 5);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    let left = tail.left.match(leftRegexWithMajor);
    let sourceProvinceRaw;
    let sourceBatchRaw;
    let sourceSubjectRaw;
    let majorNameRaw;
    let candidateCategory = "";
    if (left) {
      [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw, majorNameRaw] = left;
    } else {
      left = tail.left.match(leftRegexNoMajor);
      if (!left) {
        skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
        return;
      }
      [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw] = left;
      majorNameRaw = "预科";
      candidateCategory = "预科";
    }
    const [admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw, minRankRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(majorNameRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName, candidateCategory);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: integerNumber(minRankRaw),
      minRankRaw,
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
      extra: candidateCategory ? { candidateCategory } : {},
    }));
  });
  return { records, skippedRows };
}

function parseHenanArtSports(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${SUBJECT_RE})\\s+(${BATCH_RE})\\s+(.+)$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    let tail = parseTail(line, 5);
    let controlLineRaw = "";
    if (!tail) {
      tail = parseTail(line, 4);
    } else {
      controlLineRaw = tail.nums[4];
    }
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = tail.left.match(leftRegex);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const [, sourceProvinceRaw, sourceSubjectRaw, sourceBatchRaw, majorNameRaw] = left;
    const [admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(majorNameRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: null,
      minRankRaw: "",
      controlLine: parseNumber(controlLineRaw),
      controlLineRaw,
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
    }));
  });
  return { records, skippedRows };
}

function parseHenanArtSports2023(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})\\s+(.+)$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    const tail = parseTail(line, 4);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = tail.left.match(leftRegex);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw, majorNameRaw] = left;
    const [admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(majorNameRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: null,
      minRankRaw: "",
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
    }));
  });
  return { records, skippedRows };
}

function parseHenanUpgrade(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(${SUBJECT_RE})\\s+(.+)$`);
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const rowIndex = lineIndex + 1;
    if (shouldSkipTextLine(line) || !startsWithProvince(line)) return;
    const tail = parseTail(line, 2);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = tail.left.match(leftRegex);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const [, sourceProvinceRaw, sourceBatchRaw, sourceSubjectRaw, majorNameRaw] = left;
    const [admissionCountRaw, minScoreRaw] = tail.nums;
    const province = normalizeProvince(sourceProvinceRaw);
    const majorName = clean(majorNameRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName, "专升本");
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      minScore,
      minScoreRaw,
      maxScore: null,
      maxScoreRaw: "",
      avgScore: null,
      avgScoreRaw: "",
      minRank: null,
      minRankRaw: "",
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
      extra: { candidateCategory: "专升本" },
    }));
  });
  return { records, skippedRows };
}

function logicalOutsideLines(text, tailCount = 5) {
  const lines = text.split(/\r?\n/);
  const result = [];
  const consumedIndexes = new Set();
  const startsWithSerialSubject = (line) => new RegExp(`^\\s*\\d+\\s+(?!${PROVINCE_RE}\\b).+`).test(line);

  for (let index = 0; index < lines.length; index += 1) {
    if (consumedIndexes.has(index)) continue;
    const line = lines[index];
    if (shouldSkipTextLine(line)) continue;
    if (parseTail(line, tailCount)) {
      result.push({ line, rowIndex: index + 1 });
      continue;
    }

    const current = clean(line);
    const next = clean(lines[index + 1] || "");
    const subjectFirst = current.match(/^(\d+)\s+(.+)$/);
    const nextProvince = next.match(new RegExp(`^(${PROVINCE_RE})\\s+(.+)$`));
    if (subjectFirst && startsWithSerialSubject(line) && nextProvince) {
      let combined = `${subjectFirst[1]} ${nextProvince[1]} ${subjectFirst[2]} ${nextProvince[2]}`;
      let consumed = index + 1;
      consumedIndexes.add(index + 1);
      for (let probe = index + 2; probe < Math.min(lines.length, index + 5); probe += 1) {
        if (parseTail(combined, tailCount)) break;
        combined = `${combined} ${clean(lines[probe])}`;
        consumed = probe;
        consumedIndexes.add(probe);
      }
      result.push({ line: combined, rowIndex: index + 1 });
      index = consumed;
      continue;
    }

    if (startsWithProvince(line)) {
      let combined = current;
      let consumed = index;
      for (let probe = index + 1; probe < Math.min(lines.length, index + 5); probe += 1) {
        if (parseTail(combined, tailCount)) break;
        const fragment = clean(lines[probe]);
        if (!fragment || shouldSkipTextLine(fragment)) continue;
        combined = `${combined} ${fragment}`;
        consumed = probe;
        consumedIndexes.add(probe);
      }
      result.push({ line: combined, rowIndex: index + 1 });
    }
  }

  return result;
}

function parseOutsideLeft(leftRaw) {
  const leftRegex = new RegExp(`^(${PROVINCE_RE})\\s+(.+?)\\s+(${BATCH_RE})\\s+(.+)$`);
  const noSubjectRegex = new RegExp(`^(${PROVINCE_RE})\\s+(${BATCH_RE})\\s+(.+)$`);
  const prepared = clean(leftRaw)
    .replace(new RegExp(`^(${PROVINCE_RE})(?=\\S)`), "$1 ")
    .replace(/(体育（历史科目组合）|体育（物理科目组合）)(本科提前批)/g, "$1 $2")
    .replace(/(声乐（历史等科目类）|美术（历史等科目类）)(艺术类本科批)/g, "$1 $2");
  const withSubject = prepared.match(leftRegex);
  if (withSubject) {
    const [, sourceProvinceRaw, sourceSubjectRaw, sourceBatchRaw, middleRaw] = withSubject;
    return { sourceProvinceRaw, sourceSubjectRaw, sourceBatchRaw, middleRaw };
  }
  const noSubject = prepared.match(noSubjectRegex);
  if (noSubject) {
    const [, sourceProvinceRaw, sourceBatchRaw, middleRaw] = noSubject;
    return { sourceProvinceRaw, sourceSubjectRaw: "官网未列科类", sourceBatchRaw, middleRaw };
  }
  return null;
}

function parseOutside(page, text, rawPdfRel, rawTxtRel) {
  const records = [];
  const skippedRows = [];
  logicalOutsideLines(text).forEach(({ line, rowIndex }) => {
    if (shouldSkipTextLine(line)) return;
    const tail = parseTail(line, 5);
    if (!tail) {
      skippedRows.push({ reason: "tail-parse-failed", page: page.key, rowIndex, line });
      return;
    }
    const left = parseOutsideLeft(tail.left);
    if (!left) {
      skippedRows.push({ reason: "left-parse-failed", page: page.key, rowIndex, left: tail.left, line });
      return;
    }
    const { sourceProvinceRaw, sourceSubjectRaw, sourceBatchRaw, middleRaw } = left;
    const [admissionCountRaw, maxScoreRaw, minScoreRaw, avgScoreRaw, controlLineRaw] = tail.nums;
    const middle = clean(middleRaw).split(/\s{2,}/).map(clean).filter(Boolean);
    const majorName = middle.at(-1) || clean(middleRaw);
    const college = middle.length > 1 ? middle.slice(0, -1).join(" ") : "";
    const province = normalizeProvince(sourceProvinceRaw);
    const minScore = parseNumber(minScoreRaw);
    if (!majorName || !Number.isFinite(minScore)) {
      skippedRows.push({ reason: "missing-required-field", page: page.key, rowIndex, line });
      return;
    }
    const classification = classifyAdmission(page, sourceSubjectRaw, sourceBatchRaw, majorName, college);
    records.push(makeRecord({
      page,
      rawPdfRel,
      rawTxtRel,
      rowIndex,
      province,
      sourceProvinceRaw,
      subjectType: normalizeSubject(sourceSubjectRaw, `${sourceBatchRaw} ${majorName}`, province),
      sourceSubjectRaw,
      batch: normalizeBatch(sourceBatchRaw),
      sourceBatchRaw,
      majorName,
      college,
      minScore,
      minScoreRaw,
      maxScore: parseNumber(maxScoreRaw),
      maxScoreRaw,
      avgScore: parseNumber(avgScoreRaw),
      avgScoreRaw,
      minRank: null,
      minRankRaw: "",
      controlLine: parseNumber(controlLineRaw),
      controlLineRaw,
      admissionCount: integerNumber(admissionCountRaw),
      admissionCountRaw,
      classification,
      sourceLine: clean(line),
    }));
  });
  return { records, skippedRows };
}

function countBy(records, key) {
  return records.reduce((acc, record) => {
    const value = record[key] ?? "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function uniqueSorted(records, key) {
  return [...new Set(records.map((record) => record[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN"));
}

function rangeOf(records, key) {
  const values = records.map((record) => record[key]).filter(Number.isFinite).sort((a, b) => a - b);
  return values.length ? { min: values[0], max: values[values.length - 1] } : null;
}

async function main() {
  guardProjectRoot();
  const args = parseArgs(process.argv);
  const rawRoot = resolveProjectPath(RAW_DIR);
  ensureDir(rawRoot);

  const records = [];
  const skippedRows = [];
  const pageSummaries = [];

  for (const page of PAGES) {
    const html = await downloadHtml(page, rawRoot, args.useCache);
    const officialTitle = extractOfficialTitle(html);
    const { pdfUrl, pdfRel, pdfPath } = await downloadPdf(page, html, rawRoot, args.useCache);
    const { txtRel, text } = extractTextFromPdf(page, pdfPath, rawRoot, args.useCache);
    const rawPdfRel = `${RAW_DIR}/${pdfRel}`;
    const rawTxtRel = `${RAW_DIR}/${txtRel}`;

    let parsed;
    if (page.parser === "henanRankedMajor") {
      parsed = parseHenanRankedMajor(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "henanRankedMajorNoCount") {
      parsed = parseHenanRankedMajorNoCount(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "henanRankedMajorNoMajor") {
      parsed = parseHenanRankedMajorNoMajor(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "henanUnrankedMajor") {
      parsed = parseHenanUnrankedMajor(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "outsideUnranked2022") {
      parsed = parseOutsideUnranked2022(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "henanPreparatoryDirected") {
      parsed = parseHenanPreparatoryDirected(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "outside") {
      parsed = parseOutside(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "henanPublicTeacher") {
      parsed = parseHenanPublicTeacher(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "henanArtSports") {
      parsed = parseHenanArtSports(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "henanArtSports2023") {
      parsed = parseHenanArtSports2023(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "henanSportsMinOnly") {
      parsed = parseHenanSportsMinOnly(page, text, rawPdfRel, rawTxtRel);
    } else if (page.parser === "henanUpgrade") {
      parsed = parseHenanUpgrade(page, text, rawPdfRel, rawTxtRel);
    } else {
      throw new Error(`Unknown parser ${page.parser}`);
    }

    records.push(...parsed.records);
    skippedRows.push(...parsed.skippedRows);
    pageSummaries.push({
      key: page.key,
      title: page.title,
      officialTitle,
      url: page.url,
      pdfUrl,
      rawHtmlPath: `${RAW_DIR}/${page.rawBase}.html`,
      rawPdfPath: rawPdfRel,
      rawTextPath: rawTxtRel,
      parsedRecords: parsed.records.length,
      skippedRows: parsed.skippedRows.length,
      sha256Html: sha256File(path.join(rawRoot, `${page.rawBase}.html`)),
      sha256Pdf: sha256File(pdfPath),
      sha256Text: sha256File(path.join(rawRoot, txtRel)),
    });
  }

  const duplicateIds = records.map((record) => record.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`Duplicate record IDs: ${[...new Set(duplicateIds)].slice(0, 5).join(", ")}`);
  }

  const sourceNote = {
    id: SOURCE.id,
    title: "商丘师范学院招生信息网：2022年录取分数官方 PDF 表",
    publisher: "商丘师范学院招生信息网",
    url: INDEX_URL,
    quality: SOURCE.quality,
    usage: "从商丘师范学院招生信息网官方“录取分数”栏目下载 2022 年河南本科二批、软件学院、联办、中外合作、预科、公费师范、河南艺术体育、河南专升本和外省普通/艺体本科 PDF 表，使用 pdftotext -layout 抽取单校分省分专业最高分、最低分、平均分、录取人数、最低分位次或学校源表计分。学校官网单校数据不关闭任何省级正式投档/录取分数表缺口。",
    parsedRecords: records.length,
    skippedOfficialRows: skippedRows.length,
    provinceCount: new Set(records.map((record) => record.province)).size,
    provincesWithRecords: uniqueSorted(records, "province"),
    pageSummaries,
    rawDir: RAW_DIR,
    rawFiles: pageSummaries.flatMap((page) => [
      { path: page.rawHtmlPath, url: page.url, sha256: page.sha256Html },
      { path: page.rawPdfPath, url: page.pdfUrl, sha256: page.sha256Pdf },
      { path: page.rawTextPath, url: page.pdfUrl, sha256: page.sha256Text },
    ]),
    recordTypeCounts: countBy(records, "dataType"),
    formalScoreScopeCounts: countBy(records, "formalScoreScope"),
    admissionTypeCounts: countBy(records, "admissionType"),
    admissionSubtypeCounts: countBy(records, "admissionSubtype"),
    subjectTypeCounts: countBy(records, "subjectType"),
    recordsWithRank: records.filter((record) => !record.rankUnavailable).length,
    recordsRankUnavailable: records.filter((record) => record.rankUnavailable).length,
    scoreRange: rangeOf(records, "minScore"),
    ordinarySchoolOfficialScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "school-official-only"), "minScore"),
    specialPathScoreRange: rangeOf(records.filter((record) => record.formalScoreScope === "special-path-only"), "minScore"),
    rankRange: rangeOf(records, "minRank"),
    boundaryNotes: [
      "商丘师范学院单校官网分数/位次只用于该校候选边界复核，不替代省级教育考试院全量投档/录取分数表。",
      "河南省预科记录是河南考生特殊路径，不是省级教育考试院全量投档/录取表；不关闭西藏正式省级缺口。",
      "2022 年部分河南本科/合作/联办/软件/预科表公开最低分位次；外省、艺体、公费师范和专升本表未列位次的行标记 rankUnavailable=true，不生成假位次。",
      "艺术、体育、公费师范、预科、专升本等按 special-path-only 隔离，不与普通高考文化分概率混算。",
    ],
  };

  const outPath = resolveProjectPath(args.out);
  ensureDir(path.dirname(outPath));
  const payload = {
    sourceNotes: [sourceNote],
    records,
    skippedRows,
    generatedAt: new Date().toISOString(),
    parserVersion: "v3214-sqnu-pdf-pdftotext-2022-01",
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${records.length} records -> ${args.out}`);
  console.log(`Skipped rows: ${skippedRows.length}`);
  console.log(`Provinces: ${sourceNote.provincesWithRecords.join(", ")}`);
  console.log(`Records with rank: ${sourceNote.recordsWithRank}; rank unavailable: ${sourceNote.recordsRankUnavailable}`);
  console.log(`Formal scope counts: ${JSON.stringify(sourceNote.formalScoreScopeCounts)}`);
  console.log(`Admission type counts: ${JSON.stringify(sourceNote.admissionTypeCounts)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
