#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const appFile = path.join(projectRoot, "site/assets/app.js");
const rootAppFile = path.join(projectRoot, "app.js");
const source = fs.readFileSync(appFile, "utf8");
const bootIndex = source.lastIndexOf("\nboot().catch");
if (bootIndex < 0) throw new Error("Could not isolate app.js boot call");

const instrumented = `${source.slice(0, bootIndex)}
globalThis.__gaokaoTest = {
  state,
  profileAdmissionRecords,
  profilePlanRecords,
  buildPlanOptions,
  recordConflictsWithRedLines,
  scoreCandidate,
  classifyScoreBand,
  admissionRecordLimitWarning,
  CANDIDATE_POOLS,
  isSpecialPathRecord,
};`;

const context = vm.createContext({ console });
vm.runInContext(instrumented, context, { filename: appFile });
const api = context.__gaokaoTest;

const rootSource = fs.readFileSync(rootAppFile, "utf8");
const rootBootIndex = rootSource.lastIndexOf("\nboot().catch");
if (rootBootIndex < 0) throw new Error("Could not isolate root app.js boot call");
const rootContext = vm.createContext({ console });
vm.runInContext(`${rootSource.slice(0, rootBootIndex)}\nglobalThis.__gaokaoRootTest = { recordConflictsWithRedLines };`, rootContext, { filename: rootAppFile });

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

const correctedCooperativePlan = {
  id: "2026-xizang-plan-0a1d8e04b447e164ed",
  year: 2026,
  province: "西藏",
  subjectType: "物理类",
  batch: "本科一批",
  schoolName: "三峡大学(中外合作办学)",
  schoolCode: "1466",
  schoolTags: ["中外合作办学", "官方计划更正"],
  dataType: "admission-plan",
  planOnly: true,
  majorName: "电气工程及其自动化(中外合作办学)",
  majorCode: "04",
  disciplineCodes: ["08"],
  planCount: 2,
  tuition: "50000",
  planCorrectionNote: "西藏教育考试院公告：院校代码/名称由0329 三峡大学更正为1466 三峡大学(中外合作办学)。",
  planRestrictionText: "录取后不得调换专业，该专业教学外语为英语。",
};

const ordinaryThreeGorgesPlan = {
  ...correctedCooperativePlan,
  id: "2026-xizang-plan-ctgu-ordinary-test",
  schoolName: "三峡大学",
  schoolCode: "0329",
  schoolTags: [],
  majorName: "计算机科学与技术",
  majorCode: "05",
  planCount: 3,
  tuition: "5850",
  planCorrectionNote: "",
  planRestrictionText: "",
};

api.state.data = {
  admissionScoreLayer: {
    structuredRecords: 6,
    records: [schoolOfficial, specialPath, specialPlan, xizangMilitaryControl, correctedCooperativePlan, ordinaryThreeGorgesPlan],
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

const xizangProfile = {
  ...profile,
  province: "西藏",
  score: "500",
  rank: "",
  redLines: "",
};
assert.deepEqual(
  api.profilePlanRecords(xizangProfile).map((record) => record.id),
  [correctedCooperativePlan.id, ordinaryThreeGorgesPlan.id],
  "both corrected cooperative and ordinary plans should remain eligible without a family red line",
);
assert.equal(api.recordConflictsWithRedLines(correctedCooperativePlan, xizangProfile), false);
const strictProfile = { ...xizangProfile, redLines: "不接受高学费中外合作" };
assert.equal(api.recordConflictsWithRedLines(correctedCooperativePlan, strictProfile), true);
assert.equal(api.recordConflictsWithRedLines(ordinaryThreeGorgesPlan, strictProfile), false);
assert.equal(api.recordConflictsWithRedLines({ ...correctedCooperativePlan, tuition: null }, strictProfile), true);
assert.equal(api.recordConflictsWithRedLines({ ...correctedCooperativePlan, tuition: "12000" }, strictProfile), false);
assert.equal(api.recordConflictsWithRedLines({ ...correctedCooperativePlan, tuition: "12000" }, { ...xizangProfile, redLines: "拒绝中外合作" }), true);
assert.equal(api.recordConflictsWithRedLines({ ...ordinaryThreeGorgesPlan, tuition: "50000" }, { ...xizangProfile, redLines: "不接受高学费" }), true);
assert.equal(api.recordConflictsWithRedLines({ ...ordinaryThreeGorgesPlan, tuition: "50000" }, strictProfile), false);
assert.equal(rootContext.__gaokaoRootTest.recordConflictsWithRedLines(correctedCooperativePlan, strictProfile), true);
assert.equal(rootContext.__gaokaoRootTest.recordConflictsWithRedLines({ ...correctedCooperativePlan, tuition: null }, strictProfile), true);
assert.equal(rootContext.__gaokaoRootTest.recordConflictsWithRedLines({ ...correctedCooperativePlan, tuition: "12000" }, strictProfile), false);
assert.equal(rootContext.__gaokaoRootTest.recordConflictsWithRedLines(ordinaryThreeGorgesPlan, strictProfile), false);
assert.deepEqual(
  api.profilePlanRecords(strictProfile).map((record) => record.id),
  [ordinaryThreeGorgesPlan.id],
  "high-cost cooperative red line must exclude only the conflicting plan",
);
const regionalCandidate = api.CANDIDATE_POOLS.find((item) => item.id === "regional-safe");
const correctedOption = api.buildPlanOptions(regionalCandidate, xizangProfile, api.classifyScoreBand(xizangProfile.score, xizangProfile.rank))
  .find((option) => option.record?.id === correctedCooperativePlan.id);
assert.ok(correctedOption, "corrected plan should be visible when no red line conflicts");
assert.equal(correctedOption.name, "三峡大学(中外合作办学)");
assert.ok(correctedOption.tags.includes("官方计划更正"));
assert.match(correctedOption.focus, /0329.*1466/);
assert.match(correctedOption.focus, /不得调换专业.*英语/);

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
  correctedPlanVisibleWithoutRedLine: Boolean(correctedOption),
  strictPlanRecordIds: api.profilePlanRecords(strictProfile).map((record) => record.id),
}, null, 2));
