#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { splitAdmissionPayloadRecords } from "./admission-payload-records.mjs";
import {
  EXPECTED_RAW_HASHES,
  assertExpectedSha,
  download,
} from "./import-official-beijing-rank-conversion-2025-v3271.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const coreFile = path.join(projectRoot, "site/data/knowledge-core.json");
const shardDir = path.join(projectRoot, "site/data/provinces");
const manifestFile = path.join(shardDir, "manifest.json");
const appFile = path.join(projectRoot, "site/assets/app.js");
const buildFile = path.join(projectRoot, "scripts/build.mjs");
const beijingImportFile = path.join(projectRoot, "data/admissions/official-beijing-rank-conversion-2025-v3271-import.json");
const beijingRawDir = path.join(projectRoot, "data/admissions/raw/official-beijing-rank-conversion-2025-v3271");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const core = JSON.parse(fs.readFileSync(coreFile, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const beijingImport = JSON.parse(fs.readFileSync(beijingImportFile, "utf8"));
const splitBeijingImport = splitAdmissionPayloadRecords(beijingImport);
assert.equal(splitBeijingImport.admissionRecords.length, 0);
assert.equal(splitBeijingImport.rankRecords.length, 347, "build ingestion must retain dedicated rankConversions arrays");
assert.ok(splitBeijingImport.rankRecords.every((record) => record.dataType === "rank-conversion"));
assert.ok(splitBeijingImport.rankRecords.every((record) => String(record.sourceQuality || "").includes("official")));
assert.match(fs.readFileSync(buildFile, "utf8"), /splitAdmissionPayloadRecords\(payload\)/);
assert.equal(
  assertExpectedSha(fs.readFileSync(path.join(beijingRawDir, "page-87165.html")), EXPECTED_RAW_HASHES.page, "Official page"),
  EXPECTED_RAW_HASHES.page,
);
assert.equal(
  assertExpectedSha(fs.readFileSync(path.join(beijingRawDir, "beijing-2025-score-distribution.pdf")), EXPECTED_RAW_HASHES.pdf, "Official PDF"),
  EXPECTED_RAW_HASHES.pdf,
);
assert.throws(() => assertExpectedSha(Buffer.from("tampered"), EXPECTED_RAW_HASHES.pdf, "Official PDF"), /SHA-256 mismatch/);
await assert.rejects(
  () => download(
    "https://www.bjeea.cn/fake.pdf",
    "application/pdf",
    async () => ({
      ok: true,
      status: 200,
      url: "https://example.com/redirected.pdf",
      arrayBuffer: async () => new Uint8Array([37, 80, 68, 70, 45]).buffer,
    }),
    1,
  ),
  /Final response URL must use the official bjeea\.cn host/,
);
assert.equal(core.admissionScoreLayer.records.length, 0);
assert.equal(core.admissionScoreLayer.rankConversions.length, 0);
assert.equal(core.browserRuntime.mode, "province-sharded");
assert.equal(manifest.provinceCount, 31);
assert.equal(manifest.modelVersion, "local-deterministic-v3.271-beijing-rank2025-841776records");
assert.equal(manifest.recordCount, 841776);
assert.equal(manifest.rankConversionCount, 116656);
assert.equal(manifest.recordCount, core.admissionScoreLayer.structuredRecords);
assert.equal(manifest.rankConversionCount, core.admissionScoreLayer.coverage.rankConversionRecords);
assert.equal(manifest.unknownRecords, 0);
assert.equal(manifest.unknownRankConversions, 0);
assert.equal(manifest.core.sha256, sha256(coreFile));
assert.deepEqual(core.admissionScoreLayer.coverage.formalScoreMissingProvinces, ["西藏"]);
assert.ok(core.admissionScoreLayer.sourceNotes.some((note) => note.id === "official-xizang-military-interview-medical-control-line-2026-v3269"));
assert.ok(core.admissionScoreLayer.sourceNotes.some((note) => note.id === "official-xizang-three-gorges-plan-correction-2026-v3270"));
assert.ok(core.admissionScoreLayer.sourceNotes.some((note) => note.id === "official-beijing-rank-2025-v3271"));
const supersededBeijingQueue = core.admissionScoreLayer.sourceNotes.find((note) => note.id === "dxsbb-rank-8df9f3efff");
assert.equal(supersededBeijingQueue?.supersededBy, "official-beijing-rank-2025-v3271");
assert.equal(core.admissionScoreLayer.rankSourceCoverage.sources, 203);
assert.equal(core.admissionScoreLayer.rankSourceCoverage.parsedSources, 137);
assert.equal(core.admissionScoreLayer.rankSourceCoverage.queuedSources, 66);
assert.equal(core.admissionScoreLayer.rankSourceCoverage.imageQueuedSources, 66);
assert.equal(core.admissionScoreLayer.rankSourceCoverage.parsedRecords, 116656);
const rank2025Coverage = core.admissionScoreLayer.rankSourceCoverage.byYear.find((row) => row.year === 2025);
assert.equal(rank2025Coverage.parsedSources, 45);
assert.equal(rank2025Coverage.queuedSources, 24);
assert.equal(rank2025Coverage.parsedRecords, 13003);
assert.ok(rank2025Coverage.parsedProvinces.includes("北京"));
assert.ok(!rank2025Coverage.queuedProvinces.includes("北京"));
assert.ok(!core.admissionScoreLayer.rankSourceCoverage.sampleQueuedSources.some((row) => row.url === "https://www.dxsbb.com/news/148791.html"));
const beijingReadiness = core.admissionScoreLayer.coverage.provinceReadiness.rows.find((row) => row.province === "北京");
assert.equal(beijingReadiness.rankConversionRecords, 688);
assert.equal(beijingReadiness.officialRankRecords, 688);
assert.equal(beijingReadiness.officialEvidenceRecords, 4772);

for (const entry of Object.values(manifest.shards)) {
  const file = path.join(shardDir, entry.file);
  assert.equal(fs.statSync(file).size, entry.bytes, `${entry.file} byte count mismatch`);
  assert.equal(sha256(file), entry.sha256, `${entry.file} sha256 mismatch`);
}

const jiangxiEntry = manifest.shards["江西"];
const jiangxi = JSON.parse(fs.readFileSync(path.join(shardDir, jiangxiEntry.file), "utf8"));
assert.equal(jiangxi.province, "江西");
assert.equal(jiangxi.records.length, jiangxiEntry.records);
assert.equal(jiangxi.rankConversions.length, jiangxiEntry.rankConversions);
assert.ok(jiangxi.records.some((record) => record.schoolName && Number(record.minScore) > 0));

const beijingEntry = manifest.shards["北京"];
const beijing = JSON.parse(fs.readFileSync(path.join(shardDir, beijingEntry.file), "utf8"));
const beijing2025Ranks = beijing.rankConversions.filter((record) => record.sourceId === "official-beijing-rank-2025-v3271");
assert.equal(beijingEntry.records, 6442);
assert.equal(beijingEntry.rankConversions, 688);
assert.equal(beijing2025Ranks.length, 347);
assert.ok(beijing2025Ranks.every((record) => record.dataType === "rank-conversion"));
assert.ok(beijing2025Ranks.every((record) => String(record.sourceQuality || "").includes("official")));
assert.deepEqual(beijing2025Ranks[0], {
  id: "2025-bj-rank-98cff68f33570e1e50",
  province: "北京",
  year: 2025,
  subjectType: "综合",
  dataType: "rank-conversion",
  score: 698,
  scoreRange: { min: 698, max: 750 },
  rankStart: 1,
  rankEnd: 113,
  sameRankScore: 113,
  sourceId: "official-beijing-rank-2025-v3271",
  sourceQuality: "official-beijing-2025-rank-conversion-pdf-text-validated",
});
const beijing650 = beijing2025Ranks.find((record) => record.score === 650);
assert.equal(beijing650.rankStart, 3102);
assert.equal(beijing650.rankEnd, 3203);
assert.equal(beijing650.sameRankScore, 102);
assert.deepEqual(beijing2025Ranks.at(-1).scoreRange, { min: 100, max: 109 });
assert.equal(beijing2025Ranks.at(-1).rankStart, 65411);
assert.equal(beijing2025Ranks.at(-1).rankEnd, 65434);
for (let index = 1; index < beijing2025Ranks.length; index += 1) {
  assert.equal(beijing2025Ranks[index].rankStart, beijing2025Ranks[index - 1].rankEnd + 1, `Beijing rank gap at index ${index}`);
}

const xizangEntry = manifest.shards["西藏"];
const xizang = JSON.parse(fs.readFileSync(path.join(shardDir, xizangEntry.file), "utf8"));
const xizangMilitary = xizang.records.filter((record) => record.sourceId === "official-xizang-military-interview-medical-control-line-2026-v3269");
const correctedPlans = xizang.records.filter((record) => record.id === "2026-xizang-plan-0a1d8e04b447e164ed");
assert.equal(xizangEntry.records, 26111);
assert.equal(xizangEntry.rankConversions, 0);
assert.equal(xizangMilitary.length, 6);
assert.deepEqual(xizangMilitary.map((record) => record.minScore), [395, 460, 376, 591, 415, 638]);
assert.deepEqual(xizangMilitary.map((record) => record.subjectType), ["历史类", "历史类", "物理类", "物理类", "物理类", "物理类"]);
assert.deepEqual(xizangMilitary.map((record) => record.candidateGender), ["男", "男", "男", "男", "女", "女"]);
assert.deepEqual(xizangMilitary.map((record) => record.candidateClass), ["A类", "B类", "A类", "B类", "A类", "B类"]);
assert.ok(xizangMilitary.every((record) => record.dataType === "control-line"));
assert.ok(xizangMilitary.every((record) => record.formalScoreScope === "special-path-only"));
assert.ok(xizangMilitary.every((record) => record.rankUnavailable === true));
assert.ok(xizangMilitary.every((record) => record.scoreOnly === true));
assert.ok(xizangMilitary.every((record) => record.thresholdType === "军队院校面试体检控制分数线"));
assert.ok(xizangMilitary.every((record) => record.sourcePublishedAt === "2026-07-05 12:02"));
assert.equal(correctedPlans.length, 1, "corrected plan must remain a one-to-one replacement");
const correctedPlan = correctedPlans[0];
assert.equal(correctedPlan.schoolCode, "1466");
assert.equal(correctedPlan.schoolName, "三峡大学(中外合作办学)");
assert.equal(correctedPlan.originalSchoolCode, "0329");
assert.equal(correctedPlan.originalSchoolName, "三峡大学");
assert.equal(correctedPlan.majorCode, "04");
assert.equal(correctedPlan.majorName, "电气工程及其自动化(中外合作办学)");
assert.equal(correctedPlan.planCount, 2);
assert.equal(String(correctedPlan.tuition), "50000");
assert.equal(correctedPlan.programDuration, "四年");
assert.equal(correctedPlan.planRemark, "录取后不得调换专业，该专业教学外语为英语。");
assert.equal(correctedPlan.sourceId, "official-xizang-three-gorges-plan-correction-2026-v3270");
assert.equal(correctedPlan.correctionSourceId, "official-xizang-three-gorges-plan-correction-2026-v3270");
assert.match(correctedPlan.planCorrectionNote, /0329.*1466/);
assert.match(correctedPlan.planRestrictionText, /不得调换专业.*英语/);
assert.equal(xizang.records.filter((record) => record.id === correctedPlan.id && record.schoolCode === "0329").length, 0);

const source = fs.readFileSync(appFile, "utf8");
const bootIndex = source.lastIndexOf("\nboot().catch");
if (bootIndex < 0) throw new Error("Could not isolate app.js boot call");
const instrumented = `${source.slice(0, bootIndex)}
globalThis.__gaokaoShardTest = {
  state, loadProvinceData, admissionRecords, rankConversionRecords, profileAdmissionRecords,
  classifyScoreBand, scoreCandidate, CANDIDATE_POOLS, isSpecialPathRecord, isVocationalAdmissionRecord,
  estimateRankFromScore,
};`;
let fetchCount = 0;
const context = vm.createContext({
  console,
  fetch: async (url) => {
    fetchCount += 1;
    assert.equal(url, `./data/provinces/${jiangxiEntry.file}`);
    return { ok: true, status: 200, json: async () => jiangxi };
  },
});
vm.runInContext(instrumented, context, { filename: appFile });
const api = context.__gaokaoShardTest;
api.state.data = core;
api.state.provinceManifest = manifest;
await api.loadProvinceData("江西省");
assert.equal(api.state.loadedProvince, "江西");
assert.equal(api.admissionRecords().length, jiangxiEntry.records);
assert.equal(api.rankConversionRecords().length, jiangxiEntry.rankConversions);
await api.loadProvinceData("江西");
assert.equal(fetchCount, 1, "same province should use the in-memory shard cache");

const profile = {
  childType: "均衡探索型", score: "593", rank: "17798", province: "江西", subject: "物理/理科",
  disciplineFocus: "08", interest: "计算机 软件 数据 数字媒体 虚拟现实",
  cities: "南昌 武汉 长沙 重庆 西安 杭州", redLines: "不接受高学费中外合作",
  budget: "中等敏感", strategy: "均衡", abilityProfile: "语英较强，数理中等，化生基础较稳",
};
const eligible = api.profileAdmissionRecords(profile);
assert.ok(eligible.length > 0, "real Jiangxi shard did not produce ordinary same-subject candidates");
assert.ok(eligible.every((record) => record.province === "江西"));
assert.ok(eligible.every((record) => !api.isSpecialPathRecord(record)), "special path leaked into ordinary candidate pool");
const band = api.classifyScoreBand(profile.score, profile.rank);
const recommendations = api.CANDIDATE_POOLS
  .map((candidate) => api.scoreCandidate(candidate, profile, band))
  .sort((a, b) => b.total - a.total)
  .slice(0, 8);
assert.equal(recommendations.length, 8);
assert.ok(recommendations.some((item) => item.schoolOptions.some((option) => option.record)), "real Jiangxi run returned no school options");
assert.ok(recommendations.every((item) => item.schoolOptions.every((option) => !option.record || option.record.province === "江西")));
assert.ok(recommendations.every((item) => item.schoolOptions.every((option) => !option.record || !api.isSpecialPathRecord(option.record))));
const elite = recommendations.find((item) => item.id === "elite-platform");
assert.ok(elite.schoolOptions.every((option) => /985|211|双一流|C9/.test((option.record?.schoolTags || []).join(" "))));
const shanghai = recommendations.find((item) => item.id === "shanghai-city");
assert.ok(shanghai.schoolOptions.every((option) => /上海|杭州|南京|苏州|宁波|无锡|常州/.test(`${option.record?.schoolName || ""} ${option.record?.city || ""}`)));

api.state.data.admissionScoreLayer.rankConversions = beijing2025Ranks;
for (const score of [370, 379]) {
  const groupedEstimate = api.estimateRankFromScore({ score: String(score), province: "北京", subject: "综合" });
  assert.equal(groupedEstimate.rankStart, 60486);
  assert.equal(groupedEstimate.rankEnd, 61270);
  assert.match(groupedEstimate.text, /370-379分区间/);
  assert.match(groupedEstimate.text, /同区间785人/);
  assert.doesNotMatch(groupedEstimate.text, /同分785人/);
  assert.match(groupedEstimate.text, /为官方区间记录/);
}
for (const score of [698, 700]) {
  const groupedEstimate = api.estimateRankFromScore({ score: String(score), province: "北京", subject: "综合" });
  assert.equal(groupedEstimate.rankEnd, 113);
  assert.match(groupedEstimate.text, /698分及以上区间/);
  assert.match(groupedEstimate.text, /同区间113人/);
}
for (const score of [100, 109]) {
  const groupedEstimate = api.estimateRankFromScore({ score: String(score), province: "北京", subject: "综合" });
  assert.equal(groupedEstimate.rankStart, 65411);
  assert.equal(groupedEstimate.rankEnd, 65434);
  assert.match(groupedEstimate.text, /100-109分区间/);
  assert.match(groupedEstimate.text, /同区间24人/);
}
const exact650Estimate = api.estimateRankFromScore({ score: "650", province: "北京", subject: "综合" });
assert.equal(exact650Estimate.rankStart, 3102);
assert.equal(exact650Estimate.rankEnd, 3203);
assert.match(exact650Estimate.text, /650分/);
assert.match(exact650Estimate.text, /同分102人/);
assert.doesNotMatch(exact650Estimate.text, /同区间102人/);

api.state.data.admissionScoreLayer.records = beijing.records;
const beijingEliteEligible = api.profileAdmissionRecords({
  score: "650", rank: "3203", province: "北京", subject: "综合", redLines: "",
});
assert.ok(beijingEliteEligible.length > 0);
assert.ok(beijingEliteEligible.every((record) => !api.isVocationalAdmissionRecord(record)), "vocational records leaked into a Beijing elite profile");
const beijingVocationalEligible = api.profileAdmissionRecords({
  score: "200", rank: "", province: "北京", subject: "综合", redLines: "",
});
assert.ok(beijingVocationalEligible.length > 0);
assert.ok(beijingVocationalEligible.every((record) => api.isVocationalAdmissionRecord(record)), "undergraduate records leaked into a Beijing vocational profile");
const vocationalUniversityBachelorRecords = beijing.records.filter((record) => /职业技术大学/.test(record.schoolName || "") && /本科/.test(record.batch || ""));
const vocationalUniversityCollegeRecords = beijing.records.filter((record) => /职业技术大学/.test(record.schoolName || "") && /专科/.test(record.batch || ""));
assert.equal(vocationalUniversityBachelorRecords.length, 10);
assert.equal(vocationalUniversityCollegeRecords.length, 11);
assert.ok(vocationalUniversityBachelorRecords.every((record) => !api.isVocationalAdmissionRecord(record)), "职业技术大学本科批被误伤");
assert.ok(vocationalUniversityCollegeRecords.every((record) => api.isVocationalAdmissionRecord(record)), "职业技术大学专科批未隔离");

console.log(JSON.stringify({
  ok: true,
  modelVersion: manifest.modelVersion,
  provinceCount: manifest.provinceCount,
  recordCount: manifest.recordCount,
  rankConversionCount: manifest.rankConversionCount,
  coreBytes: manifest.core.bytes,
  jiangxi: jiangxiEntry,
  beijing: {
    ...beijingEntry,
    official2025RankRecords: beijing2025Ranks.length,
    score650RankEnd: beijing650.rankEnd,
    finalCumulativeRank: beijing2025Ranks.at(-1).rankEnd,
    groupedRangeTextVerified: true,
    fullBuildIngestionVerified: splitBeijingImport.rankRecords.length,
    eliteProfileVocationalRecords: beijingEliteEligible.filter((record) => api.isVocationalAdmissionRecord(record)).length,
    vocationalProfileRecords: beijingVocationalEligible.length,
    vocationalUniversityBachelorRecords: vocationalUniversityBachelorRecords.length,
    vocationalUniversityCollegeRecords: vocationalUniversityCollegeRecords.length,
  },
  xizang: {
    ...xizangEntry,
    newMilitaryControlRecords: xizangMilitary.length,
    scores: xizangMilitary.map((record) => record.minScore),
    correctedPlan: {
      id: correctedPlan.id,
      schoolCode: correctedPlan.schoolCode,
      schoolName: correctedPlan.schoolName,
      originalSchoolCode: correctedPlan.originalSchoolCode,
    },
  },
  fetchCount,
  eligibleOrdinaryRecords: eligible.length,
  topRecommendations: recommendations.slice(0, 3).map((item) => ({
    id: item.id, total: item.total, confidence: item.confidence,
    schools: item.schoolOptions.map((option) => option.record?.schoolName).filter(Boolean).slice(0, 3),
  })),
}, null, 2));
