#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const coreFile = path.join(projectRoot, "site/data/knowledge-core.json");
const shardDir = path.join(projectRoot, "site/data/provinces");
const manifestFile = path.join(shardDir, "manifest.json");
const appFile = path.join(projectRoot, "site/assets/app.js");
const importFile = path.join(projectRoot, "data/admissions/official-xizang-vacancy-plans-2025-v3272-import.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const core = JSON.parse(fs.readFileSync(coreFile, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const imported = JSON.parse(fs.readFileSync(importFile, "utf8"));

assert.equal(core.modelVersion, "local-deterministic-v3.272-xizang-vacancy2025-843963records");
assert.equal(core.modelPolicy.version, core.modelVersion);
assert.equal(core.admissionScoreLayer.records.length, 0);
assert.equal(core.admissionScoreLayer.rankConversions.length, 0);
assert.equal(core.admissionScoreLayer.structuredRecords, 843963);
assert.equal(core.admissionScoreLayer.rankConversionRecords, 116656);
assert.equal(core.admissionScoreLayer.admissionPlanRecords, 71877);
assert.equal(core.admissionScoreLayer.admissionPlanCount, 358294, "vacancy snapshots must not inflate annual plan count");
assert.equal(core.admissionScoreLayer.vacancyPlanRecords, 2187);
assert.equal(core.admissionScoreLayer.vacancyPlanSnapshotCount, 6099);
assert.equal(core.admissionScoreLayer.ordinaryVocationalVacancyRecords, 926);
assert.equal(core.admissionScoreLayer.sourceNotes.length, 5084);
assert.ok(core.admissionScoreLayer.sourceNotes.some((note) => note.id === "official-xizang-vacancy-plans-2025-v3272"));
assert.ok(core.admissionScoreLayer.sourceNotes.some((note) => note.id === "official-xizang-admission-schedule-2026-v3272"));
assert.deepEqual(core.admissionScoreLayer.coverage.formalScoreMissingProvinces, ["西藏"]);
assert.equal(core.admissionScoreLayer.rankSourceCoverage.parsedRecords, 116656);
assert.equal(core.admissionScoreLayer.rankSourceCoverage.parsedSources, 137);
assert.equal(core.admissionScoreLayer.rankSourceCoverage.queuedSources, 66);

assert.equal(manifest.modelVersion, core.modelVersion);
assert.equal(manifest.provinceCount, 31);
assert.equal(manifest.recordCount, 843963);
assert.equal(manifest.rankConversionCount, 116656);
assert.equal(manifest.unknownRecords, 0);
assert.equal(manifest.unknownRankConversions, 0);
assert.equal(manifest.core.sha256, sha256(coreFile));
assert.equal(manifest.core.bytes, fs.statSync(coreFile).size);

for (const entry of Object.values(manifest.shards)) {
  const file = path.join(shardDir, entry.file);
  assert.equal(fs.statSync(file).size, entry.bytes, `${entry.file} byte count mismatch`);
  assert.equal(sha256(file), entry.sha256, `${entry.file} SHA-256 mismatch`);
}

assert.equal(manifest.shards["北京"].records, 6442);
assert.equal(manifest.shards["北京"].rankConversions, 688);
const xizangEntry = manifest.shards["西藏"];
assert.equal(xizangEntry.records, 28298);
assert.equal(xizangEntry.rankConversions, 0);
const xizang = JSON.parse(fs.readFileSync(path.join(shardDir, xizangEntry.file), "utf8"));
const vacancyRecords = xizang.records.filter((record) => record.sourceId === "official-xizang-vacancy-plans-2025-v3272");
assert.equal(vacancyRecords.length, 2187);
assert.equal(vacancyRecords.reduce((sum, record) => sum + record.planCount, 0), 6099);
assert.equal(vacancyRecords.filter((record) => record.formalScoreScope === "vacancy-plan-only").length, 2157);
assert.equal(vacancyRecords.filter((record) => record.formalScoreScope === "special-path-only").length, 30);
assert.equal(vacancyRecords.filter((record) => /专科|高职/.test(record.batch) && record.formalScoreScope === "vacancy-plan-only").length, 926);
assert.ok(vacancyRecords.every((record) => record.planOnly === true && record.planStage === "征集志愿"));
assert.ok(vacancyRecords.every((record) => !Object.hasOwn(record, "minScore")));
assert.ok(vacancyRecords.every((record) => !Object.hasOwn(record, "minRank") && !Object.hasOwn(record, "minRankEnd")));
assert.ok(vacancyRecords.every((record) => record.sourceAttachment));

const vacancyById = new Map(vacancyRecords.map((record) => [record.id, record]));
for (const importedRecord of imported.records) {
  const expectedShardRecord = Object.fromEntries(Object.entries(importedRecord).filter(([, value]) =>
    value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)
  ));
  assert.deepEqual(vacancyById.get(importedRecord.id), expectedShardRecord, `import-to-shard field drift for ${importedRecord.id}`);
}
const borderSpecialRecords = vacancyRecords.filter((record) => record.specialPathReason === "边境专项计划");
assert.equal(borderSpecialRecords.length, 3);
assert.ok(borderSpecialRecords.every((record) => record.formalScoreScope === "special-path-only"));

const englishRecords = vacancyRecords.filter((record) => record.schoolName === "西藏民族大学" && record.majorName === "英语");
assert.equal(englishRecords.length, 6);
for (const majorCode of ["29", "31"]) {
  const codeRecords = englishRecords.filter((record) => record.majorCode === majorCode);
  assert.equal(new Set(codeRecords.map((record) => record.vacancyKey)).size, 1);
  assert.ok(codeRecords.every((record) => record.vacancyRepeatCount === 3));
}
assert.notEqual(
  englishRecords.find((record) => record.majorCode === "29").vacancyKey,
  englishRecords.find((record) => record.majorCode === "31").vacancyKey,
);

const digitalMedia = vacancyRecords.filter((record) => record.majorName === "数字媒体技术");
assert.equal(digitalMedia.length, 23);
assert.ok(digitalMedia.every((record) => record.disciplineCodes.includes("08")));
const dongying = digitalMedia.find((record) => record.schoolName === "东营职业学院" && record.vacancyRound === "17");
assert.deepEqual(dongying.eligibilityThresholds, { A: 202, B: 202 });
assert.equal(dongying.vacancyRepeatCount, 2);
assert.equal(dongying.vacancyOccurrence, 2);
assert.equal(dongying.planCount, 3);
assert.equal(dongying.tuition, "5000");

const correctedPlan = xizang.records.find((record) => record.id === "2026-xizang-plan-0a1d8e04b447e164ed");
assert.equal(correctedPlan.schoolCode, "1466");
assert.equal(correctedPlan.schoolName, "三峡大学(中外合作办学)");
assert.equal(correctedPlan.originalSchoolCode, "0329");
const xizangReadiness = core.admissionScoreLayer.provinceReadiness.rows.find((row) => row.province === "西藏");
assert.equal(xizangReadiness.readinessScore, 66);
assert.equal(xizangReadiness.status, "usable");
assert.equal(xizangReadiness.vacancyPlanRecords, 2187);
assert.equal(xizangReadiness.vacancyPlanSnapshotCount, 6099);
assert.equal(xizangReadiness.ordinaryVocationalVacancyRecords, 926);
assert.equal(xizangReadiness.planCount, 87995, "readiness annual plan count must remain unchanged");
assert.ok(xizangReadiness.missing.includes("缺可计算一分一段"));
assert.ok(xizangReadiness.missing.includes("高职专科正式投档/录取数据待补（已有征集计划快照）"));

const source = fs.readFileSync(appFile, "utf8");
const bootIndex = source.lastIndexOf("\nboot().catch");
if (bootIndex < 0) throw new Error("Could not isolate app.js boot call");
const instrumented = `${source.slice(0, bootIndex)}
globalThis.__gaokaoShardTest = {
  state,
  profilePlanRecords,
  buildPlanOptions,
  candidatePoolsForProfile,
  scoreCandidate,
  classifyScoreBand,
  admissionDataFreshness,
  isSpecialPathRecord,
  isVocationalPlanRecord,
  vacancyEligibilityForProfile,
  CANDIDATE_POOLS,
};`;
const context = vm.createContext({ console });
vm.runInContext(instrumented, context, { filename: appFile });
const api = context.__gaokaoShardTest;
api.state.data = core;
api.state.data.admissionScoreLayer.records = xizang.records;
api.state.data.admissionScoreLayer.rankConversions = xizang.rankConversions;

const lowProfile = {
  childType: "均衡探索型",
  score: "250",
  rank: "",
  province: "西藏",
  subject: "物理/理科",
  disciplineFocus: "08",
  interest: "数字媒体技术",
  cities: "",
  abilityProfile: "喜欢数字媒体技术和计算机实践",
  redLines: "",
  budget: "中等敏感",
  strategy: "稳健",
};
const highProfile = { ...lowProfile, score: "650", rank: "3000" };
const engineering = api.CANDIDATE_POOLS.find((item) => item.id === "engineering-industry");
const lowOptions = api.buildPlanOptions(engineering, lowProfile, api.classifyScoreBand(lowProfile.score, lowProfile.rank));
assert.ok(lowOptions.some((option) => option.record.majorName === "数字媒体技术"), "real Xizang shard did not surface digital-media vacancy");
const lowVacancyOptions = lowOptions.filter((option) => option.record.formalScoreScope === "vacancy-plan-only");
assert.ok(lowVacancyOptions.length > 0, "historical vacancy signal was crowded out by annual plans");
assert.ok(lowVacancyOptions.some((option) => option.record.majorName === "数字媒体技术"));
assert.ok(lowVacancyOptions.every((option) => /历史时点快照/.test(option.focus)));
assert.ok(lowVacancyOptions.every((option) => option.scoreStatus.includes("历史低需求/补录机会信号")));
const highOptions = api.buildPlanOptions(engineering, highProfile, api.classifyScoreBand(highProfile.score, highProfile.rank));
assert.ok(highOptions.every((option) => !api.isVocationalPlanRecord(option.record)), "high-score profile leaked vocational plans");
const adversarialHighProfile = { ...highProfile, interest: "高职 专升本 数字媒体技术" };
const highRecommendations = api.candidatePoolsForProfile(adversarialHighProfile)
  .map((candidate) => api.scoreCandidate(candidate, adversarialHighProfile, api.classifyScoreBand(adversarialHighProfile.score, adversarialHighProfile.rank)))
  .sort((left, right) => right.total - left.total || right.evidence.length - left.evidence.length)
  .slice(0, 8);
assert.ok(highRecommendations.every((item) => item.id !== "vocational-dual"));
assert.ok(highRecommendations.every((item) => item.schoolOptions.every((option) => !option.record || !api.isVocationalPlanRecord(option.record))));
assert.equal(api.vacancyEligibilityForProfile(dongying, { ...lowProfile, score: "180" }).state, "below-all");

const freshness = api.admissionDataFreshness(lowProfile, "2026-07-15");
assert.equal(freshness.latestPlanYear, 2026);
assert.equal(freshness.latestAdmissionYear, 2025);
assert.equal(freshness.latestRankYear, null);
assert.equal(freshness.latestVacancyYear, 2025);
assert.equal(freshness.scheduleStage.state, "active");
assert.ok(freshness.warnings.some((warning) => /没有可计算的一分一段/.test(warning)));
assert.ok(freshness.warnings.some((warning) => /征集志愿仅是各轮剩余计划快照/.test(warning)));
assert.ok(api.profilePlanRecords(lowProfile).every((record) => !api.isSpecialPathRecord(record)));

const recommendations = api.CANDIDATE_POOLS
  .map((candidate) => api.scoreCandidate(candidate, lowProfile, api.classifyScoreBand(lowProfile.score, lowProfile.rank)))
  .sort((a, b) => b.total - a.total)
  .slice(0, 8);
assert.ok(recommendations.some((item) => item.schoolOptions.some((option) => option.record?.sourceId === "official-xizang-vacancy-plans-2025-v3272")));
assert.ok(recommendations.every((item) => item.schoolOptions.every((option) => !option.record || !api.isSpecialPathRecord(option.record))));

assert.equal(imported.audit.recordCount, vacancyRecords.length);
assert.equal(imported.audit.planSnapshotCount, vacancyRecords.reduce((sum, record) => sum + record.planCount, 0));

console.log(JSON.stringify({
  ok: true,
  modelVersion: manifest.modelVersion,
  provinceCount: manifest.provinceCount,
  recordCount: manifest.recordCount,
  rankConversionCount: manifest.rankConversionCount,
  xizang: {
    ...xizangEntry,
    vacancyRecords: vacancyRecords.length,
    vacancyPlanSnapshots: vacancyRecords.reduce((sum, record) => sum + record.planCount, 0),
    digitalMediaTechnologyRecords: digitalMedia.length,
    lowOptionSchools: lowOptions.map((option) => `${option.name}-${option.record.majorName}`),
    highVocationalOptions: highOptions.filter((option) => api.isVocationalPlanRecord(option.record)).length,
    highCandidateIds: highRecommendations.map((item) => item.id),
  },
  freshness: {
    latestPlanYear: freshness.latestPlanYear,
    latestAdmissionYear: freshness.latestAdmissionYear,
    latestRankYear: freshness.latestRankYear,
    stage: freshness.scheduleStage.text,
  },
}, null, 2));
