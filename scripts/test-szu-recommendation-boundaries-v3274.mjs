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
globalThis.__gaokaoTest = { state, profileAdmissionRecords, admissionDataFreshness, recordMatchesCandidateCategory };`;
const context = vm.createContext({ console });
vm.runInContext(instrumented, context, { filename: appFile });
const api = context.__gaokaoTest;
const payload = JSON.parse(fs.readFileSync(path.join(projectRoot, "data/admissions/official-national-school-admission-2024-2025-v3274-szu-import.json"), "utf8"));

api.state.data = {
  admissionScoreLayer: {
    records: payload.records,
    rankConversions: [],
    sourceNotes: payload.sourceNotes,
  },
};

const baseXizang = {
  province: "西藏",
  subject: "物理/理科",
  score: "500",
  rank: "",
  disciplineFocus: "08",
  redLines: "",
};
const unspecified = api.profileAdmissionRecords(baseXizang);
assert.equal(unspecified.length, 0, "A/B-scoped records must not enter an unspecified Xizang profile");
const unspecifiedFreshness = api.admissionDataFreshness(baseXizang, "2026-07-15");
assert.ok(unspecifiedFreshness.categoryRestrictedAdmissionCount > 0);
assert.ok(unspecifiedFreshness.warnings.some((warning) => /要求A\/B等考生类别/.test(warning)));

const profileA = { ...baseXizang, candidateCategory: "A类考生" };
const recordsA = api.profileAdmissionRecords(profileA);
assert.ok(recordsA.length > 0);
assert.ok(recordsA.every((record) => record.candidateCategory === "A类考生"));
assert.ok(recordsA.some((record) => record.majorName === "计算机科学与技术"));

const profileB = { ...baseXizang, candidateCategory: "B类考生" };
const recordsB = api.profileAdmissionRecords(profileB);
assert.ok(recordsB.length > 0);
assert.ok(recordsB.every((record) => record.candidateCategory === "B类考生"));
assert.ok(recordsB.some((record) => record.majorName === "计算机科学与技术"));

const guangdong = api.profileAdmissionRecords({ ...baseXizang, province: "广东", subject: "物理", candidateCategory: "" });
assert.ok(guangdong.length > 0, "ordinary Guangdong records remain available without an A/B category");
assert.ok(guangdong.every((record) => record.formalScoreScope === "school-official-only"));

console.log(JSON.stringify({
  ok: true,
  xizangUnspecifiedCandidates: unspecified.length,
  xizangACandidates: recordsA.length,
  xizangBCandidates: recordsB.length,
  guangdongOrdinaryCandidates: guangdong.length,
  categoryWarning: unspecifiedFreshness.warnings.find((warning) => /要求A\/B等考生类别/.test(warning)),
}, null, 2));
