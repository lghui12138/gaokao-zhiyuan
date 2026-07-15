#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const appFile = path.join(projectRoot, "site/assets/app.js");
const source = fs.readFileSync(appFile, "utf8");
const bootIndex = source.lastIndexOf("\nboot().catch");
if (bootIndex < 0) throw new Error("Could not isolate app.js boot call");

const instrumented = `${source.slice(0, bootIndex)}
globalThis.__gaokaoTest = {
  state,
  profilePlanRecords,
  buildPlanOptions,
  classifyScoreBand,
  admissionDataFreshness,
  planRestrictedEligibilityReason,
  CANDIDATE_POOLS,
};`;
const context = vm.createContext({ console });
vm.runInContext(instrumented, context, { filename: appFile });
const api = context.__gaokaoTest;

const shardFile = path.join(projectRoot, "site/data/provinces/xizang.json");
const shard = JSON.parse(fs.readFileSync(shardFile, "utf8"));
const officialPlans = shard.records.filter((record) => record.sourceId === "official-xizang-admission-plan-2026");
assert.equal(officialPlans.length, 7300, "the v3.273 safety test must exercise the full existing official plan source");

api.state.data = {
  admissionScoreLayer: {
    structuredRecords: officialPlans.length,
    records: officialPlans,
    rankConversions: [],
    sourceNotes: [],
  },
};

const ordinaryPhysicsProfile = {
  childType: "均衡探索型",
  score: "430",
  rank: "",
  province: "西藏",
  subject: "物理/理科",
  disciplineFocus: "08",
  interest: "计算机 数字媒体 软件",
  cities: "",
  abilityProfile: "喜欢数字内容和计算机实践",
  redLines: "",
  budget: "中等敏感",
  strategy: "稳健",
};

const restricted = officialPlans.filter((record) => api.planRestrictedEligibilityReason(record));
const physicsRestricted = restricted.filter((record) => /理工|物理/.test(String(record.subjectType || "")));
assert.ok(restricted.length >= 1109, "the official source must retain the observed restricted-path plan population");
assert.ok(restricted.some((record) => record.batch === "提前录取军校批"));
assert.ok(restricted.some((record) => record.batch === "国家专项本科"));
assert.ok(restricted.some((record) => record.batch === "本科一批（预科班）"));
assert.ok(restricted.some((record) => record.batch === "对口高职专科批"));

const ordinaryRecords = api.profilePlanRecords(ordinaryPhysicsProfile);
assert.ok(ordinaryRecords.length > 0, "ordinary physics profiles must retain ordinary official plans");
assert.ok(ordinaryRecords.some((record) => record.batch === "本科二批"));
assert.ok(ordinaryRecords.every((record) => !api.planRestrictedEligibilityReason(record)), "restricted plans must never enter ordinary automatic candidates");

const engineering = api.CANDIDATE_POOLS.find((candidate) => candidate.id === "engineering-industry");
const options = api.buildPlanOptions(
  engineering,
  ordinaryPhysicsProfile,
  api.classifyScoreBand(ordinaryPhysicsProfile.score, ordinaryPhysicsProfile.rank),
);
assert.ok(options.length > 0, "an ordinary engineering profile must retain plan-layer options");
assert.ok(options.every((option) => !api.planRestrictedEligibilityReason(option.record)));
assert.ok(options.every((option) => option.scoreStatus === "官方计划层：需等投档/录取分闭合"));

const freshness = api.admissionDataFreshness(ordinaryPhysicsProfile, "2026-07-15");
assert.equal(freshness.restrictedPlanCount, physicsRestricted.length);
assert.ok(freshness.warnings.some((warning) => warning.includes(`${physicsRestricted.length}条计划属于军警、专项、预科、艺体、定向、部队或对口`)));

console.log(JSON.stringify({
  status: "ok",
  officialPlanRecords: officialPlans.length,
  restrictedPlanRecords: restricted.length,
  physicsRestrictedPlanRecords: physicsRestricted.length,
  ordinaryCandidateRecords: ordinaryRecords.length,
  returnedEngineeringOptions: options.length,
  restrictedPlanWarning: freshness.warnings.find((warning) => warning.includes("限定路径")),
}, null, 2));
