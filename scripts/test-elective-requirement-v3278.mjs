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
globalThis.__gaokaoTest = { state, electiveRequirementForProfile, profileAdmissionRecords, profilePlanRecords };`;
const context = vm.createContext({ console, Intl, Date });
vm.runInContext(instrumented, context, { filename: appFile });
const api = context.__gaokaoTest;

const physicsBio = { province: "江西", subject: "物理类", electives: "生物 地理" };
const physicsChemBio = { ...physicsBio, electives: "化学 生物" };
const chemicalOnly = { id: "chemical-only", province: "江西", subjectType: "物理类", dataType: "major-admission", electiveRequirement: "首选物理，再选化学" };
const bothRequired = { id: "both-required", province: "江西", subjectType: "物理类", dataType: "major-admission", electiveRequirement: "化学、生物（2门科目考生均须选考方可报考）" };
const eitherRequired = { id: "either-required", province: "江西", subjectType: "物理类", dataType: "major-admission", electiveRequirement: "化学或生物（1门科目考生必须选考方可报考）" };
const politicsRequired = { id: "politics-required", province: "江西", subjectType: "物理类", dataType: "major-admission", electiveRequirement: "政治（1门科目考生必须选考方可报考）" };
const ambiguous = { id: "ambiguous", province: "江西", subjectType: "物理类", dataType: "major-admission", electiveRequirement: "化学、生物" };
const planChemical = { ...chemicalOnly, id: "plan-chemical", dataType: "admission-plan", planOnly: true };

assert.equal(api.electiveRequirementForProfile(chemicalOnly, physicsBio).state, "unmatched");
assert.equal(api.electiveRequirementForProfile(chemicalOnly, physicsChemBio).state, "matched");
assert.equal(api.electiveRequirementForProfile(bothRequired, physicsChemBio).state, "matched");
assert.equal(api.electiveRequirementForProfile(bothRequired, { ...physicsBio, electives: "化学 地理" }).state, "unmatched");
assert.equal(api.electiveRequirementForProfile(eitherRequired, physicsBio).state, "matched");
assert.equal(api.electiveRequirementForProfile(politicsRequired, { ...physicsBio, electives: "思想政治 地理" }).state, "matched");
assert.equal(api.electiveRequirementForProfile(ambiguous, physicsBio).state, "needs-check");

api.state.data = { admissionScoreLayer: { records: [chemicalOnly, ambiguous, planChemical] } };
assert.deepEqual(Array.from(api.profileAdmissionRecords(physicsBio)).map((record) => record.id), ["ambiguous"], "clear elective mismatches must not enter admissions recommendations");
assert.deepEqual(Array.from(api.profilePlanRecords(physicsBio)).map((record) => record.id), [], "clear elective mismatches must not enter plan recommendations");

console.log(JSON.stringify({
  status: "ok",
  unmatchedAdmissionExcluded: true,
  ambiguousRequirementRetainedForReview: true,
  unmatchedPlanExcluded: true,
}, null, 2));
