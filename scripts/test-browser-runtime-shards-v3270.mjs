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

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const core = JSON.parse(fs.readFileSync(coreFile, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
assert.equal(core.admissionScoreLayer.records.length, 0);
assert.equal(core.admissionScoreLayer.rankConversions.length, 0);
assert.equal(core.browserRuntime.mode, "province-sharded");
assert.equal(manifest.provinceCount, 31);
assert.equal(manifest.modelVersion, "local-deterministic-v3.270-xizang-ctgu-plan-correction2026-841776records");
assert.equal(manifest.recordCount, 841776);
assert.equal(manifest.rankConversionCount, 116309);
assert.equal(manifest.recordCount, core.admissionScoreLayer.structuredRecords);
assert.equal(manifest.rankConversionCount, core.admissionScoreLayer.coverage.rankConversionRecords);
assert.equal(manifest.unknownRecords, 0);
assert.equal(manifest.unknownRankConversions, 0);
assert.equal(manifest.core.sha256, sha256(coreFile));
assert.deepEqual(core.admissionScoreLayer.coverage.formalScoreMissingProvinces, ["西藏"]);
assert.ok(core.admissionScoreLayer.sourceNotes.some((note) => note.id === "official-xizang-military-interview-medical-control-line-2026-v3269"));
assert.ok(core.admissionScoreLayer.sourceNotes.some((note) => note.id === "official-xizang-three-gorges-plan-correction-2026-v3270"));

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
  classifyScoreBand, scoreCandidate, CANDIDATE_POOLS, isSpecialPathRecord,
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

console.log(JSON.stringify({
  ok: true,
  modelVersion: manifest.modelVersion,
  provinceCount: manifest.provinceCount,
  recordCount: manifest.recordCount,
  rankConversionCount: manifest.rankConversionCount,
  coreBytes: manifest.core.bytes,
  jiangxi: jiangxiEntry,
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
