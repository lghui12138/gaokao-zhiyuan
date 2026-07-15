#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const INPUT = path.join(PROJECT_ROOT, "site/data/knowledge.json");
const CORE = path.join(PROJECT_ROOT, "site/data/knowledge-core.json");
const SHARD_DIR = path.join(PROJECT_ROOT, "site/data/provinces");

if (PROJECT_ROOT.startsWith("/Volumes/mac_2T/")) {
  throw new Error("Refusing to run the browser shard builder directly on mac_2T; use internal APFS staging.");
}

const PROVINCES = {
  "北京": "beijing", "天津": "tianjin", "河北": "hebei", "山西": "shanxi",
  "内蒙古": "inner-mongolia", "辽宁": "liaoning", "吉林": "jilin", "黑龙江": "heilongjiang",
  "上海": "shanghai", "江苏": "jiangsu", "浙江": "zhejiang", "安徽": "anhui",
  "福建": "fujian", "江西": "jiangxi", "山东": "shandong", "河南": "henan",
  "湖北": "hubei", "湖南": "hunan", "广东": "guangdong", "广西": "guangxi",
  "海南": "hainan", "重庆": "chongqing", "四川": "sichuan", "贵州": "guizhou",
  "云南": "yunnan", "西藏": "xizang", "陕西": "shaanxi", "甘肃": "gansu",
  "青海": "qinghai", "宁夏": "ningxia", "新疆": "xinjiang",
};

const RECORD_FIELDS = [
  "id", "province", "year", "subjectType", "batch", "schoolName", "schoolCode", "schoolTags",
  "city", "campus", "dataType", "majorName", "majorCode", "majorGroup", "electiveRequirement", "sourcePlanYear",
  "disciplineCodes", "cautions", "planCount", "tuition", "minScore", "minRank", "minRankStart",
  "minRankEnd", "rankRangeText", "sourceQuality", "sourceId", "sourceSubjectRaw", "formalScoreScope",
  "rankUnavailable", "scoreOnly", "candidateCategory", "candidateGender", "candidateClass", "thresholdType", "sourcePublishedAt",
  "admissionType", "admissionSubtype", "sourceTableTitle", "sourceFirstChoice",
  "planCorrectionNote", "planRestrictionText", "correctionSourceId", "originalSourceId", "originalSourceQuality",
  "originalSchoolCode", "originalSchoolName", "programDuration", "planRemark", "sourceUrl",
  "rankUsage", "rankUsageLabel", "rankCategory", "rankLevelUsage", "rankLevelUsageLabel", "scoreRange",
  "score", "rankStart", "rankEnd", "sameRankScore", "planOnly", "planStage", "vacancyRound",
  "vacancyAnnouncement", "vacancyRepeatCount", "vacancyOccurrence", "vacancyKey",
  "eligibilityThresholds", "specialPathReason", "sourceAttachment",
];

const RANK_FIELDS = [
  "id", "province", "year", "subjectType", "dataType", "score", "scoreRange", "rankStart", "rankEnd",
  "sameRankScore", "sourceId", "sourceQuality", "rankUsage", "rankUsageLabel", "rankCategory", "rankLevelUsage",
  "rankLevelUsageLabel",
];

function normalizeProvince(value) {
  const text = String(value || "").trim();
  if (text === "内蒙") return "内蒙古";
  return Object.keys(PROVINCES).find((province) => text.includes(province) || province.includes(text)) || text;
}

function compactObject(source, fields) {
  const target = {};
  for (const field of fields) {
    const value = source[field];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    target[field] = field === "province" ? normalizeProvince(value) : value;
  }
  if (Array.isArray(target.cautions) && target.cautions.length > 3) target.cautions = target.cautions.slice(0, 3);
  return target;
}

async function writeWithBackpressure(stream, text) {
  if (!stream.write(text)) await once(stream, "drain");
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  if (!fs.existsSync(INPUT)) throw new Error(`Missing source knowledge file: ${INPUT}`);
  fs.rmSync(SHARD_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHARD_DIR, { recursive: true });

  const generatedAt = new Date().toISOString();
  const shardState = new Map();
  for (const [province, slug] of Object.entries(PROVINCES)) {
    const file = path.join(SHARD_DIR, `${slug}.json`);
    const stream = fs.createWriteStream(file, { encoding: "utf8" });
    stream.write(`{"generatedAt":${JSON.stringify(generatedAt)},"province":${JSON.stringify(province)},"records":[`);
    shardState.set(province, { province, slug, file, stream, records: 0, ranks: 0, firstRecord: true, firstRank: true });
  }

  const coreTemp = `${CORE}.tmp`;
  const coreStream = fs.createWriteStream(coreTemp, { encoding: "utf8" });
  const input = fs.createReadStream(INPUT, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  let section = "core";
  let collecting = false;
  let objectLines = [];
  let unknownRecords = 0;
  let unknownRanks = 0;

  async function emitObject(rawLines, kind) {
    const raw = rawLines.join("\n").replace(/,\s*$/, "");
    const parsed = JSON.parse(raw);
    const province = normalizeProvince(parsed.province);
    const target = shardState.get(province);
    if (!target) {
      if (kind === "records") unknownRecords += 1;
      else unknownRanks += 1;
      return;
    }
    const compact = compactObject(parsed, kind === "records" ? RECORD_FIELDS : RANK_FIELDS);
    const firstKey = kind === "records" ? "firstRecord" : "firstRank";
    await writeWithBackpressure(target.stream, `${target[firstKey] ? "" : ","}${JSON.stringify(compact)}`);
    target[firstKey] = false;
    if (kind === "records") target.records += 1;
    else target.ranks += 1;
  }

  for await (const line of lines) {
    if (section === "core" && /^    "records": \[$/.test(line)) {
      await writeWithBackpressure(coreStream, `${line}\n`);
      section = "records";
      continue;
    }
    if (section === "records") {
      if (!collecting && /^    \],?$/.test(line)) {
        await writeWithBackpressure(coreStream, `${line}\n`);
        for (const target of shardState.values()) await writeWithBackpressure(target.stream, `],"rankConversions":[`);
        section = "between";
        continue;
      }
      if (!collecting && /^      \{$/.test(line)) {
        collecting = true;
        objectLines = [line];
        continue;
      }
      if (collecting) {
        objectLines.push(line);
        if (/^      \},?$/.test(line)) {
          await emitObject(objectLines, "records");
          collecting = false;
          objectLines = [];
        }
      }
      continue;
    }
    if (section === "between" && /^    "rankConversions": \[$/.test(line)) {
      await writeWithBackpressure(coreStream, `${line}\n`);
      section = "rankConversions";
      continue;
    }
    if (section === "rankConversions") {
      if (!collecting && /^    \],?$/.test(line)) {
        await writeWithBackpressure(coreStream, `${line}\n`);
        section = "tail";
        continue;
      }
      if (!collecting && /^      \{$/.test(line)) {
        collecting = true;
        objectLines = [line];
        continue;
      }
      if (collecting) {
        objectLines.push(line);
        if (/^      \},?$/.test(line)) {
          await emitObject(objectLines, "rankConversions");
          collecting = false;
          objectLines = [];
        }
      }
      continue;
    }
    await writeWithBackpressure(coreStream, `${line}\n`);
  }

  if (collecting || section !== "tail") throw new Error(`Incomplete stream parse: section=${section}, collecting=${collecting}`);
  coreStream.end();
  await once(coreStream, "finish");

  for (const target of shardState.values()) target.stream.end("]}\n");
  await Promise.all([...shardState.values()].map((target) => once(target.stream, "finish")));

  const coreData = JSON.parse(fs.readFileSync(coreTemp, "utf8"));
  coreData.sourceFiles = (coreData.sourceFiles || [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({ ...item, domains: item.domains || [], disciplines: item.disciplines || [] }));
  coreData.browserRuntime = {
    mode: "province-sharded",
    manifest: "./provinces/manifest.json",
    fullMasterRecords: coreData.admissionScoreLayer?.structuredRecords || 0,
  };
  fs.writeFileSync(CORE, JSON.stringify(coreData), "utf8");
  fs.rmSync(coreTemp, { force: true });

  const shards = {};
  for (const target of shardState.values()) {
    const stat = fs.statSync(target.file);
    shards[target.province] = {
      file: `${target.slug}.json`, records: target.records, rankConversions: target.ranks,
      bytes: stat.size, sha256: await sha256(target.file),
    };
  }
  const manifest = {
    generatedAt,
    modelVersion: coreData.modelPolicy?.version || coreData.modelVersion || "",
    provinceCount: Object.keys(shards).length,
    recordCount: Object.values(shards).reduce((sum, item) => sum + item.records, 0),
    rankConversionCount: Object.values(shards).reduce((sum, item) => sum + item.rankConversions, 0),
    unknownRecords,
    unknownRankConversions: unknownRanks,
    core: { file: "../knowledge-core.json", bytes: fs.statSync(CORE).size, sha256: await sha256(CORE) },
    shards,
  };
  fs.writeFileSync(path.join(SHARD_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  console.log(JSON.stringify({ ok: true, core: manifest.core, provinceCount: manifest.provinceCount,
    recordCount: manifest.recordCount, rankConversionCount: manifest.rankConversionCount,
    unknownRecords, unknownRankConversions: unknownRanks,
    largestShards: Object.entries(shards).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 5),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
