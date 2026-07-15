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
  profileAdmissionRecords,
  profilePlanRecords,
  scoreCandidate,
  classifyScoreBand,
  admissionRecordLimitWarning,
  CANDIDATE_POOLS,
  isSpecialPathRecord,
};`;

const context = vm.createContext({ console });
vm.runInContext(instrumented, context, { filename: appFile });
const api = context.__gaokaoTest;

const profile = {
  childType: "学术深造型",
  score: "650",
  rank: "1000",
  province: "江西",
  subject: "物理/理科",
  disciplineFocus: "08",
  interest: "计算机 人工智能 数学",
  cities: "北京 上海",
  abilityProfile: "数学物理基础较强",
  redLines: "",
  budget: "不敏感",
  strategy: "均衡",
};

const schoolOfficial = {
  id: "school-official-bnu-test",
  year: 2025,
  province: "江西",
  subjectType: "物理类",
  batch: "本科批",
  schoolName: "北京师范大学",
  schoolTags: ["985", "211", "双一流", "师范"],
  city: "北京",
  dataType: "institution-admission",
  majorName: "北京师范大学普通类调档线",
  disciplineCodes: ["08"],
  minScore: 595,
  minRankEnd: 10400,
  rankRangeText: "10400",
  formalScoreScope: "school-official-only",
  sourceQuality: "official-school-bnu-2025-national-pdf-transfer-rank-major-score",
};

const specialPath = {
  ...schoolOfficial,
  id: "special-bnu-test",
  majorName: "北京师范大学公费师范生调档线",
  minScore: 618,
  minRankEnd: 4087,
  formalScoreScope: "special-path-only",
  admissionType: "公费师范生",
};

const specialPlan = {
  id: "special-plan-test",
  year: 2026,
  province: "江西",
  subjectType: "物理类",
  schoolName: "示例高校",
  dataType: "admission-plan",
  planOnly: true,
  formalScoreScope: "special-path-only",
  majorName: "专项专业",
  planCount: 2,
};

const xizangMilitaryControl = {
  id: "2026-xizang-military-control-test",
  year: 2026,
  province: "西藏",
  subjectType: "物理类",
  batch: "提前批军队院校面试体检资格线",
  schoolName: "西藏自治区2026年军队院校招生面试体检控制分数线",
  dataType: "control-line",
  majorName: "军队院校面试体检控制分数线",
  minScore: 638,
  formalScoreScope: "special-path-only",
  rankUnavailable: true,
};

api.state.data = {
  admissionScoreLayer: {
    structuredRecords: 4,
    records: [schoolOfficial, specialPath, specialPlan, xizangMilitaryControl],
    rankConversions: [],
    sourceNotes: [],
    statusLabel: "test",
  },
  sourceFiles: Array.from({ length: 6 }, (_value, index) => ({
    title: `计算机 人工智能 985 双一流 证据${index}`,
    relativePath: `evidence-${index}.txt`,
    excerpt: "计算机 人工智能 北京 高平台",
    domains: [{ label: "院校层次与城市选择" }],
    disciplines: [{ code: "08", name: "工学" }],
    textLength: 1000 - index,
  })),
};

const profileRecords = api.profileAdmissionRecords(profile);
assert.deepEqual(profileRecords.map((record) => record.id), [schoolOfficial.id], "ordinary recommendation must exclude special-path-only records");
assert.equal(api.profilePlanRecords(profile).length, 0, "ordinary recommendation must exclude special-path-only plans");
assert.equal(api.isSpecialPathRecord(xizangMilitaryControl), true, "Xizang military control line lost its special-path boundary");
assert.equal(api.profileAdmissionRecords({ ...profile, province: "西藏" }).length, 0, "Xizang military eligibility line leaked into ordinary recommendation");

const candidate = api.CANDIDATE_POOLS.find((item) => item.id === "elite-platform");
const result = api.scoreCandidate(candidate, profile, api.classifyScoreBand(profile.score, profile.rank));
assert.equal(result.confidence, "A-", "school-official-only evidence must never reach A confidence");
assert.ok(result.schoolOptions.some((option) => option.record?.id === schoolOfficial.id), "school official record should remain a visible candidate");
assert.ok(!result.schoolOptions.some((option) => option.record?.id === specialPath.id), "special path record leaked into ordinary options");
assert.match(api.admissionRecordLimitWarning(schoolOfficial), /学校官网单校录取边界/);
assert.ok(result.warnings.some((warning) => /学校官网单校录取边界/.test(warning)), "school official boundary warning is missing");

console.log(JSON.stringify({
  ok: true,
  profileAdmissionRecordIds: profileRecords.map((record) => record.id),
  confidence: result.confidence,
  selectedRecordIds: result.schoolOptions.map((option) => option.record?.id).filter(Boolean),
  warning: result.warnings.find((warning) => /学校官网单校录取边界/.test(warning)),
}, null, 2));
