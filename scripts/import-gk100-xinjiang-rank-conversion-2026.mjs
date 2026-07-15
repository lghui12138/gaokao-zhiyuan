#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_PAGE_URL = "https://www.gk100.com/read_43876017.htm";
const DEFAULT_OUT = "data/admissions/gk100-xinjiang-rank-conversion-2026-import.json";
const TMP_ROOT = path.join(os.homedir(), ".codex", "tmp", "gaokao-xinjiang-rank-2026-gk100-import");
const VISION_SCRIPT = path.join(PROJECT_ROOT, "scripts", "vision-grid-cell-ocr.swift");
const PROVINCE = "新疆";
const YEAR = 2026;
const MAX_PLAUSIBLE_SAME_COUNT = 5000;
const SHARP_CANDIDATES = [
  process.env.SHARP_MODULE_PATH,
  "sharp",
  "/Users/kili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp",
].filter(Boolean);

const SUBJECTS = [
  {
    key: "history",
    subjectType: "历史类",
    sourceSubjectRaw: "文科",
    imageUrl: "https://p1.gk100.com/article/20260629/399c379c0e205d57.png",
    topScore: 624,
    minScore: 174,
    rowCount: 451,
    expectedWidth: 669,
    expectedHeight: 13577,
    xLines: [0, 133, 266, 365],
    firstRowTop: 46,
    rowPitch: 30,
    topCumulative: 38,
    finalCumulative: 20509,
    benchmarks: {
      600: 143,
      550: 754,
      500: 2064,
      450: 4298,
      400: 7394,
      350: 11460,
      300: 15207,
      250: 18329,
      200: 20059,
      174: 20509,
    },
  },
  {
    key: "physics",
    subjectType: "物理类",
    sourceSubjectRaw: "理科",
    imageUrl: "https://p1.gk100.com/article/20260629/831f972f74cf1df7.png",
    topScore: 693,
    minScore: 165,
    rowCount: 529,
    expectedWidth: 669,
    expectedHeight: 15917,
    xLines: [0, 133, 266, 365],
    firstRowTop: 46,
    rowPitch: 30,
    topCumulative: 47,
    finalCumulative: 55211,
    benchmarks: {
      650: 825,
      600: 3450,
      550: 7831,
      500: 13967,
      450: 21203,
      400: 29642,
      350: 38744,
      300: 47016,
      250: 52339,
      200: 54669,
      165: 55211,
    },
  },
];

const CANVAS_WIDTH = 28;
const CANVAS_HEIGHT = 40;

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    pageUrl: DEFAULT_PAGE_URL,
    imagePaths: new Map(),
    visionScale: 8,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") args.out = argv[++i];
    else if (item === "--page-url") args.pageUrl = argv[++i];
    else if (item === "--html") args.html = argv[++i];
    else if (item === "--image-dir") args.imageDir = argv[++i];
    else if (item === "--history-image") args.imagePaths.set("history", argv[++i]);
    else if (item === "--physics-image") args.imagePaths.set("physics", argv[++i]);
    else if (item === "--vision-scale") args.visionScale = Number(argv[++i]);
    else if (item === "--help" || item === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    `  node scripts/import-gk100-xinjiang-rank-conversion-2026.mjs --out ${DEFAULT_OUT}`,
    "  node scripts/import-gk100-xinjiang-rank-conversion-2026.mjs --history-image /path/history.png --physics-image /path/physics.png",
    "",
    "Imports GK100 mirrored Xinjiang 2026 liberal-arts/science one-score-one-rank image tables as rank-conversion seed records.",
  ].join("\n");
}

function loadSharp() {
  const errors = [];
  for (const candidate of SHARP_CANDIDATES) {
    try {
      return require(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`Could not load sharp. Tried:\n${errors.join("\n")}`);
}

const sharp = loadSharp();

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function shortHash(value, length = 16) {
  return sha256(String(value)).slice(0, length);
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

function rel(file) {
  return path.relative(PROJECT_ROOT, file).replaceAll(path.sep, "/");
}

function run(command, runArgs, options = {}) {
  const result = spawnSync(command, runArgs, {
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    timeout: options.timeout ?? 180_000,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${runArgs.join(" ")} failed with status ${result.status}`,
      result.stderr?.trim(),
      result.stdout?.slice(0, 1000)?.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function curlToFile(url, out) {
  run("curl", [
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--compressed",
    "-A",
    "Mozilla/5.0 gaokao-xinjiang-rank-importer/1.0",
    url,
    "-o",
    out,
  ], { timeout: 180_000 });
  if (fs.statSync(out).size < 10 * 1024) throw new Error(`Downloaded file is too small: ${out}`);
}

function cleanHtmlText(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  return cleanHtmlText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "") ||
    cleanHtmlText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") ||
    "2026年新疆高考成绩一分一段表";
}

function extractPublishedAt(html) {
  return /([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(cleanHtmlText(html))?.[1] ?? "";
}

function ensurePageHtml(args) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  if (args.html) return fs.readFileSync(path.resolve(args.html), "utf8");
  const htmlFile = path.join(TMP_ROOT, "gk100-xinjiang-rank-2026.html");
  curlToFile(args.pageUrl, htmlFile);
  return fs.readFileSync(htmlFile, "utf8");
}

function ensureImage(args, subject) {
  if (args.imagePaths.has(subject.key)) return path.resolve(args.imagePaths.get(subject.key));
  if (args.imageDir) {
    const expected = path.join(path.resolve(args.imageDir), `${subject.key}.png`);
    if (fs.existsSync(expected)) return expected;
  }
  const file = path.join(TMP_ROOT, `${subject.key}.png`);
  curlToFile(subject.imageUrl, file);
  return file;
}

function isDark(data, width, x, y) {
  const offset = (y * width + x) * 3;
  return data[offset] < 120 && data[offset + 1] < 120 && data[offset + 2] < 120;
}

function components(image, x0, y0, width, height) {
  const dark = new Uint8Array(width * height);
  const seen = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isDark(image.data, image.info.width, x0 + x, y0 + y)) dark[y * width + x] = 1;
    }
  }
  const found = [];
  for (let sy = 0; sy < height; sy += 1) {
    for (let sx = 0; sx < width; sx += 1) {
      const startIndex = sy * width + sx;
      if (!dark[startIndex] || seen[startIndex]) continue;
      const queue = [[sx, sy]];
      seen[startIndex] = 1;
      let queueIndex = 0;
      let minX = sx;
      let maxX = sx;
      let minY = sy;
      let maxY = sy;
      const pixels = [];
      while (queueIndex < queue.length) {
        const [x, y] = queue[queueIndex];
        queueIndex += 1;
        pixels.push([x, y]);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nextIndex = ny * width + nx;
          if (dark[nextIndex] && !seen[nextIndex]) {
            seen[nextIndex] = 1;
            queue.push([nx, ny]);
          }
        }
      }
      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      if (pixels.length >= 8 && boxHeight >= 10 && boxWidth >= 1) {
        found.push({ minX, maxX, minY, maxY, boxWidth, boxHeight, pixels });
      }
    }
  }
  return found.sort((a, b) => a.minX - b.minX);
}

function normalize(component) {
  const normalized = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  const scale = Math.min(
    (CANVAS_WIDTH - 4) / component.boxWidth,
    (CANVAS_HEIGHT - 4) / component.boxHeight
  );
  const normalizedWidth = Math.max(1, Math.round(component.boxWidth * scale));
  const normalizedHeight = Math.max(1, Math.round(component.boxHeight * scale));
  const offsetX = Math.floor((CANVAS_WIDTH - normalizedWidth) / 2);
  const offsetY = Math.floor((CANVAS_HEIGHT - normalizedHeight) / 2);
  for (const [x, y] of component.pixels) {
    const targetX = Math.min(
      CANVAS_WIDTH - 1,
      Math.max(0, offsetX + Math.floor(((x - component.minX + 0.5) / component.boxWidth) * normalizedWidth))
    );
    const targetY = Math.min(
      CANVAS_HEIGHT - 1,
      Math.max(0, offsetY + Math.floor(((y - component.minY + 0.5) / component.boxHeight) * normalizedHeight))
    );
    normalized[targetY * CANVAS_WIDTH + targetX] = 1;
  }
  return normalized;
}

function glyphDistance(a, b) {
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance;
}

function buildTemplates(loadedSubjects) {
  const templates = {};
  const skipped = [];
  for (const { subject, image } of loadedSubjects) {
    for (let row = 0; row < subject.rowCount; row += 1) {
      const expected = String(subject.topScore - row);
      const x0 = subject.xLines[0] + 4;
      const y0 = subject.firstRowTop + row * subject.rowPitch + 3;
      const width = subject.xLines[1] - subject.xLines[0] - 8;
      const glyphs = components(image, x0, y0, width, subject.rowPitch - 6);
      if (glyphs.length !== expected.length) {
        skipped.push({ subject: subject.key, row, expected, components: glyphs.length });
        continue;
      }
      for (let i = 0; i < expected.length; i += 1) {
        const digit = expected[i];
        if (!templates[digit]) templates[digit] = [];
        templates[digit].push(normalize(glyphs[i]));
      }
    }
  }
  for (const digit of "0123456789") {
    if (!templates[digit]?.length) throw new Error(`Missing digit template for ${digit}`);
  }
  return { templates, skipped };
}

function readTemplateCell(image, subject, row, colIndex, templates) {
  const x0 = subject.xLines[colIndex] + 4;
  const y0 = subject.firstRowTop + row * subject.rowPitch + 3;
  const width = subject.xLines[colIndex + 1] - subject.xLines[colIndex] - 8;
  const glyphs = components(image, x0, y0, width, subject.rowPitch - 6);
  if (!glyphs.length) return { text: "0", number: 0 };
  let text = "";
  const distances = [];
  for (const glyph of glyphs) {
    const normalized = normalize(glyph);
    let best = null;
    for (const [digit, samples] of Object.entries(templates)) {
      for (const sample of samples) {
        const distance = glyphDistance(normalized, sample);
        if (!best || distance < best.distance) best = { digit, distance };
      }
    }
    text += best.digit;
    distances.push(best.distance);
  }
  return { text, number: Number(text), distances };
}

function runVision(subject, imageFile, args) {
  const out = path.join(TMP_ROOT, `${subject.key}-vision-cells.json`);
  const stdout = run("swift", [
    VISION_SCRIPT,
    imageFile,
    String(subject.rowCount),
    String(subject.firstRowTop),
    String(subject.rowPitch),
    String(subject.xLines[1]),
    String(subject.xLines[2]),
    String(subject.xLines[3]),
    String(args.visionScale || 8),
  ], { timeout: 240_000 });
  fs.writeFileSync(out, stdout, "utf8");
  const parsed = JSON.parse(stdout);
  return {
    out,
    map: new Map(parsed.cells.map((cell) => [
      `${cell.row}|${cell.col}`,
      cell.text === "" ? null : Number(cell.text),
    ])),
  };
}

function chooseRow(subject, image, templates, visionMap, row, previousCumulative) {
  const score = subject.topScore - row;
  const templatePeople = readTemplateCell(image, subject, row, 1, templates).number;
  const templateCumulative = readTemplateCell(image, subject, row, 2, templates).number;
  const visionPeople = visionMap.get(`${row}|people`);
  const visionCumulative = visionMap.get(`${row}|cumulative`);
  const peopleCandidates = [
    { value: visionPeople, source: "vision" },
    { value: templatePeople, source: "template" },
  ].filter((candidate) => Number.isFinite(candidate.value));
  const cumulativeCandidates = [
    { value: visionCumulative, source: "vision" },
    { value: templateCumulative, source: "template" },
  ].filter((candidate) => Number.isFinite(candidate.value));

  for (const preferSameSource of [true, false]) {
    for (const cumulative of cumulativeCandidates) {
      for (const people of peopleCandidates) {
        if (preferSameSource && cumulative.source !== people.source) continue;
        if (!preferSameSource && cumulative.source === people.source) continue;
        const sameRankScore = cumulative.value - previousCumulative;
        if (
          sameRankScore >= 0 &&
          sameRankScore <= MAX_PLAUSIBLE_SAME_COUNT &&
          people.value === sameRankScore
        ) {
          return {
            score,
            sameRankScore,
            cumulative: cumulative.value,
            source: `${cumulative.source}-cum+${people.source}-people`,
            templatePeople,
            templateCumulative,
            visionPeople,
            visionCumulative,
          };
        }
      }
    }
  }

  for (const people of peopleCandidates.filter((candidate) => candidate.value > 0)) {
    const validCumulativeDiffs = cumulativeCandidates
      .map((candidate) => candidate.value - previousCumulative)
      .filter((diff) => diff >= 0 && diff <= MAX_PLAUSIBLE_SAME_COUNT);
    const suspiciousJump = validCumulativeDiffs.length > 0 &&
      validCumulativeDiffs.every((diff) => diff > Math.max(250, people.value * 3));
    if (!validCumulativeDiffs.length || suspiciousJump) {
      return {
        score,
        sameRankScore: people.value,
        cumulative: previousCumulative + people.value,
        source: `${people.source}-people-derived-cumulative-after-suspicious-cum`,
        templatePeople,
        templateCumulative,
        visionPeople,
        visionCumulative,
      };
    }
  }

  for (const cumulative of cumulativeCandidates) {
    const sameRankScore = cumulative.value - previousCumulative;
    if (sameRankScore >= 0 && sameRankScore <= MAX_PLAUSIBLE_SAME_COUNT) {
      return {
        score,
        sameRankScore,
        cumulative: cumulative.value,
        source: `${cumulative.source}-cum-derived-people`,
        templatePeople,
        templateCumulative,
        visionPeople,
        visionCumulative,
      };
    }
  }

  for (const people of peopleCandidates) {
    if (people.value < 0 || people.value > MAX_PLAUSIBLE_SAME_COUNT) continue;
    return {
      score,
      sameRankScore: people.value,
      cumulative: previousCumulative + people.value,
      source: `${people.source}-people-derived-cumulative`,
      templatePeople,
      templateCumulative,
      visionPeople,
      visionCumulative,
    };
  }

  throw new Error(`Could not resolve ${subject.key} row ${row} score ${score}: ${JSON.stringify({
    previousCumulative,
    templatePeople,
    templateCumulative,
    visionPeople,
    visionCumulative,
  })}`);
}

async function loadImage(file) {
  return sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function parseSubject(subject, imageFile, templates, args) {
  const image = await loadImage(imageFile);
  const metadata = await sharp(imageFile).metadata();
  if (metadata.width !== subject.expectedWidth || metadata.height !== subject.expectedHeight) {
    throw new Error(`${subject.key} image dimension mismatch: expected ${subject.expectedWidth}x${subject.expectedHeight}, got ${metadata.width}x${metadata.height}`);
  }

  const vision = runVision(subject, imageFile, args);
  const rows = [];
  const corrections = [];
  let previousCumulative = 0;
  for (let row = 0; row < subject.rowCount; row += 1) {
    const resolved = chooseRow(subject, image, templates, vision.map, row, previousCumulative);
    if (
      resolved.templatePeople !== resolved.sameRankScore ||
      resolved.templateCumulative !== resolved.cumulative
    ) {
      corrections.push({
        row,
        score: resolved.score,
        templatePeople: resolved.templatePeople,
        templateCumulative: resolved.templateCumulative,
        visionPeople: resolved.visionPeople,
        visionCumulative: resolved.visionCumulative,
        chosenPeople: resolved.sameRankScore,
        chosenCumulative: resolved.cumulative,
        source: resolved.source,
      });
    }
    rows.push({
      score: resolved.score,
      sameRankScore: resolved.sameRankScore,
      cumulative: resolved.cumulative,
    });
    previousCumulative = resolved.cumulative;
  }

  validateRows(subject, rows);
  return {
    rows,
    visionPath: vision.out,
    corrections,
    imageSha256: fileSha256(imageFile),
  };
}

function validateRows(subject, rows) {
  const errors = [];
  if (rows.length !== subject.rowCount) {
    errors.push({ type: "row-count", expected: subject.rowCount, actual: rows.length });
  }
  if (rows[0]?.score !== subject.topScore || rows.at(-1)?.score !== subject.minScore) {
    errors.push({ type: "score-range", expected: [subject.topScore, subject.minScore], actual: [rows[0]?.score, rows.at(-1)?.score] });
  }
  let previous = 0;
  for (const row of rows) {
    if (row.cumulative - previous !== row.sameRankScore) {
      errors.push({ type: "same-count", row, previous, diff: row.cumulative - previous });
    }
    if (row.cumulative < previous) {
      errors.push({ type: "cumulative-order", row, previous });
    }
    previous = row.cumulative;
  }
  if (rows[0]?.cumulative !== subject.topCumulative) {
    errors.push({ type: "top-cumulative", expected: subject.topCumulative, actual: rows[0]?.cumulative });
  }
  if (rows.at(-1)?.cumulative !== subject.finalCumulative) {
    errors.push({ type: "final-cumulative", expected: subject.finalCumulative, actual: rows.at(-1)?.cumulative });
  }
  for (const [scoreText, expectedCumulative] of Object.entries(subject.benchmarks)) {
    const score = Number(scoreText);
    const row = rows.find((item) => item.score === score);
    if (!row || row.cumulative !== expectedCumulative) {
      errors.push({ type: "benchmark", score, expected: expectedCumulative, actual: row?.cumulative ?? null });
    }
  }
  if (errors.length) {
    throw new Error(`Xinjiang ${subject.subjectType} rank table validation failed:\n${JSON.stringify(errors.slice(0, 40), null, 2)}`);
  }
}

function cautions(record) {
  return [
    "该表为高考100第三方图片镜像，页面称数据来自新疆教育考试院公布数据；本轮未取得新疆教育考试院原始附件直连闭合。",
    "2026年新疆图表仍以文科/理科展示；本地推荐接口映射为历史类/物理类，并在 sourceSubjectRaw 中保留原始口径。",
    "一分一段只能用于同省同科类同年份分数到位次估算，不等同于录取线或录取概率。",
    "同分人数由相邻累计人数差值推导，并与图中人数列 OCR 交叉校验；正式填报必须回新疆教育考试院、招生计划和院校招生章程复核。",
    record.sameRankScore === 0
      ? "该分数累计人数与上一分数相同，表示零人数分数；本记录只作为到该分数累计人数边界，不表示存在同分考生。"
      : "导入器已校验累计人数单调递增和关键分数累计位次。",
  ];
}

function buildRecord(row, subject, sourceId) {
  const idBase = [YEAR, PROVINCE, subject.subjectType, row.score, row.cumulative, row.sameRankScore].join("|");
  const zeroPersonScore = row.sameRankScore === 0;
  return {
    id: `2026-xinjiang-rank-${subject.key}-${shortHash(idBase)}`,
    province: PROVINCE,
    year: YEAR,
    subjectType: subject.subjectType,
    sourceSubjectRaw: subject.sourceSubjectRaw,
    batch: "一分一段（第三方图片镜像）",
    schoolName: "一分一段表",
    dataType: "rank-conversion",
    majorName: zeroPersonScore ? "分数位次换算（零人数分数边界）" : "分数位次换算",
    score: row.score,
    rankStart: zeroPersonScore ? row.cumulative : row.cumulative - row.sameRankScore + 1,
    rankEnd: row.cumulative,
    sameRankScore: row.sameRankScore,
    ...(zeroPersonScore ? { zeroPersonScore: true } : {}),
    sourceId,
    sourceQuality: "third-party-gk100-xinjiang-rank-image-table-validated",
    sourceUrl: DEFAULT_PAGE_URL,
    sourceRowNumber: subject.topScore - row.score + 2,
    cautions: cautions(row),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const html = ensurePageHtml(args);
  if (!html.includes("新疆2026") || !html.includes("一分一段") || !html.includes("新疆教育考试院")) {
    throw new Error("GK100 page does not look like the Xinjiang 2026 rank mirror page.");
  }
  const pageFile = args.html
    ? path.resolve(args.html)
    : path.join(TMP_ROOT, "gk100-xinjiang-rank-2026.html");
  if (!fs.existsSync(pageFile)) fs.writeFileSync(pageFile, html, "utf8");
  const pageBuffer = fs.readFileSync(pageFile);
  const pageTitle = extractTitle(html);
  const title = "新疆2026年高考文科理科一分一段表（高考100第三方图片镜像）";
  const publishedAt = extractPublishedAt(html);

  const imageFiles = new Map();
  const loadedSubjects = [];
  for (const subject of SUBJECTS) {
    const imageFile = ensureImage(args, subject);
    imageFiles.set(subject.key, imageFile);
    loadedSubjects.push({ subject, image: await loadImage(imageFile) });
  }
  const { templates, skipped } = buildTemplates(loadedSubjects);

  const records = [];
  const subjects = [];
  const imageNotes = [];
  let correctionCount = 0;
  for (const subject of SUBJECTS) {
    const parsed = await parseSubject(subject, imageFiles.get(subject.key), templates, args);
    correctionCount += parsed.corrections.length;
    subjects.push({
      subjectType: subject.subjectType,
      sourceSubjectRaw: subject.sourceSubjectRaw,
      records: parsed.rows.length,
      scoreRange: { min: subject.minScore, max: subject.topScore },
      rankRange: { min: parsed.rows[0].cumulative - parsed.rows[0].sameRankScore + 1, max: parsed.rows.at(-1).cumulative },
      topBoundary: parsed.rows[0],
      finalBoundary: parsed.rows.at(-1),
      benchmarks: Object.fromEntries(Object.keys(subject.benchmarks).map((score) => {
        const row = parsed.rows.find((item) => item.score === Number(score));
        return [score, row ? { cumulative: row.cumulative, sameRankScore: row.sameRankScore } : null];
      })),
      corrections: {
        count: parsed.corrections.length,
        sample: parsed.corrections.slice(0, 12),
      },
      visionPath: rel(parsed.visionPath),
    });
    imageNotes.push({
      subjectType: subject.subjectType,
      sourceSubjectRaw: subject.sourceSubjectRaw,
      url: subject.imageUrl,
      localPath: rel(imageFiles.get(subject.key)),
      sha256: parsed.imageSha256,
      dimensions: { width: subject.expectedWidth, height: subject.expectedHeight },
    });
    records.push(...parsed.rows.map((row) => buildRecord(row, subject, `gk100-xinjiang-rank-2026-${shortHash(args.pageUrl, 10)}`)));
  }

  const sourceId = `gk100-xinjiang-rank-2026-${shortHash(args.pageUrl, 10)}`;
  const payload = {
    dataset: "gk100-xinjiang-rank-conversion-2026-import",
    generatedAt: new Date().toISOString(),
    scope: "新疆2026年高考文科、理科一分一段表（高考100第三方图片镜像）",
    notes: [
      "本文件由 scripts/import-gk100-xinjiang-rank-conversion-2026.mjs 自动生成。",
      "来源为高考100页面中的 2026 新疆文科/理科一分一段长图；页面文字称根据 2026 年新疆教育考试院公布的数据整理，但本轮未取得新疆教育考试院原始附件直连闭合。",
      "导入器使用分数列自动构建数字字形模板，逐行抽取累计人数；对连写数字等模板冲突行使用 macOS Vision 批量 OCR 修正，并用相邻累计差值推导同分人数。",
      "硬校验包括行数、顶端/末端累计人数、相邻累计差值、单调递增和 600/550/500/450/400/350/300/250 分等关键累计位次。",
      "2026 年新疆图表仍以文科/理科展示；本地推荐接口映射为历史类/物理类时必须保留跨年口径风险提示。",
    ],
    sourceNotes: [
      {
        id: sourceId,
        title,
        pageTitle,
        publisher: "高考100",
        url: args.pageUrl,
        publishedAt,
        quality: "third-party-gk100-xinjiang-rank-image-table-validated",
        usage: `自动抽取新疆2026文科/理科一分一段记录${records.length}条；用于同省同科类分数到位次估算种子，不等同于录取线。`,
        parsedRecords: records.length,
        pageHtmlBytes: pageBuffer.length,
        pageHtmlSha256: sha256(pageBuffer),
        pageRawPath: rel(pageFile),
        images: imageNotes,
        subjects,
        templateTraining: {
          digitCounts: Object.fromEntries(Object.entries(templates).map(([digit, samples]) => [digit, samples.length])),
          skippedScoreCells: skipped.length,
          skippedScoreCellSample: skipped.slice(0, 12),
        },
        visionCorrectionCount: correctionCount,
        relatedUrls: [
          "https://www.xjzk.gov.cn/",
          "https://www.gk100.com/read_18012222.htm",
        ],
        caution: "第三方图片镜像，不计为新疆教育考试院原始一分一段官方闭合。",
      },
    ],
    records: records.sort((a, b) =>
      String(a.subjectType || "").localeCompare(String(b.subjectType || ""), "zh-Hans-CN") ||
      (Number(b.score) || 0) - (Number(a.score) || 0)
    ),
  };

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: rel(outPath),
    records: records.length,
    subjects: subjects.map((subject) => ({
      subjectType: subject.subjectType,
      records: subject.records,
      scoreRange: subject.scoreRange,
      rankRange: subject.rankRange,
      benchmarks: subject.benchmarks,
      corrections: subject.corrections.count,
    })),
    sourceId,
    sourceHtml: rel(pageFile),
    correctionCount,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
