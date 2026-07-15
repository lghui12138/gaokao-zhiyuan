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
  candidatePoolsForProfile,
  dedupePlanOptions,
  scoreCandidate,
  classifyScoreBand,
  admissionDataFreshness,
  renderDataFreshnessPanel,
  eligibilityThresholdLabel,
  vacancyEligibilityForProfile,
  isVacancyPlanRecord,
  isVocationalPlanRecord,
  isSpecialPathRecord,
  CANDIDATE_POOLS,
};`;
const context = vm.createContext({ console });
vm.runInContext(instrumented, context, { filename: appFile });
const api = context.__gaokaoTest;

const vocationalVacancy = {
  id: "2025-xz-vacancy-digital-media-test",
  province: "西藏",
  year: 2025,
  subjectType: "理工类",
  batch: "专科批",
  schoolName: "东营职业学院",
  schoolCode: "0429",
  dataType: "admission-plan",
  majorName: "数字媒体技术",
  majorCode: "03",
  disciplineCodes: ["08"],
  planCount: 3,
  tuition: "5000",
  planOnly: true,
  planStage: "征集志愿",
  vacancyRound: "17",
  vacancyRepeatCount: 2,
  vacancyOccurrence: 2,
  eligibilityThresholds: { A: 202, B: 202 },
  planRestrictionText: "A类考生不低于202分，B类考生不低于202分。",
  sourceId: "official-xizang-vacancy-plans-2025-v3272",
  formalScoreScope: "vacancy-plan-only",
};
const bachelorVacancy = {
  ...vocationalVacancy,
  id: "2025-xz-vacancy-bachelor-test",
  batch: "本科二批",
  schoolName: "闽南理工学院(民办)",
  schoolCode: "0715",
  majorCode: "03",
  planCount: 1,
  tuition: "27880",
  eligibilityThresholds: { A: 246, B: 700 },
  planRestrictionText: "A类考生不低于246分，B类考生不低于700分。",
  vacancyRound: "11",
};
const specialVacancy = {
  ...vocationalVacancy,
  id: "2025-xz-vacancy-special-test",
  batch: "提前批艺体类专科",
  schoolName: "特殊入口学院",
  formalScoreScope: "special-path-only",
};
const currentPlan = {
  id: "2026-xz-current-plan-test",
  province: "西藏",
  year: 2026,
  subjectType: "理工类",
  batch: "本科一批",
  schoolName: "示例大学",
  dataType: "admission-plan",
  majorName: "计算机科学与技术",
  disciplineCodes: ["08"],
  planCount: 2,
  planOnly: true,
  formalScoreScope: "school-official-only",
};
const oldAdmission = {
  id: "2024-xz-admission-test",
  province: "西藏",
  year: 2024,
  subjectType: "理工类",
  batch: "本科一批",
  schoolName: "示例大学",
  dataType: "institution-admission",
  majorName: "计算机科学与技术",
  disciplineCodes: ["08"],
  minScore: 500,
  minRankEnd: 10000,
  formalScoreScope: "school-official-only",
  sourceQuality: "official-school-test",
};
const scheduleSource = {
  id: "official-xizang-admission-schedule-2026-v3272",
  province: "西藏",
  year: 2026,
  url: "https://gaokao.chsi.com.cn/gkxx/zc/ss/202607/20260713/2293870888.html",
  schedule: [
    { batch: "提前单独录取本科批", start: "2026-07-11", end: "2026-07-18" },
    { batch: "专项批次", start: "2026-07-19", end: "2026-07-22" },
    { batch: "本科一批（含预科班）", start: "2026-07-23", end: "2026-07-31" },
    { batch: "本科二批（含预科班）", start: "2026-08-01", end: "2026-08-09" },
    { batch: "专科批（含提前单独录取专科、艺体类专科）", start: "2026-08-10", end: "2026-08-20" },
    { batch: "对口高职专科批", start: "2026-08-21", end: "2026-08-25" },
  ],
};

api.state.data = {
  admissionScoreLayer: {
    structuredRecords: 5,
    records: [vocationalVacancy, bachelorVacancy, specialVacancy, currentPlan, oldAdmission],
    rankConversions: [],
    sourceNotes: [scheduleSource],
    statusLabel: "test",
    downgradeReason: "test downgrade",
    provinceReadiness: {
      rows: [{
        province: "西藏",
        readinessScore: 66,
        status: "usable",
        statusLabel: "可用",
        recommendationUse: "位次和专业分需人工核验。",
      }],
    },
  },
  sourceFiles: Array.from({ length: 6 }, (_value, index) => ({
    title: `数字媒体 计算机 工学 证据${index}`,
    relativePath: `evidence-${index}.txt`,
    excerpt: "数字媒体技术 计算机 高职 专升本",
    domains: [{ label: "专业门类与学科理解" }],
    disciplines: [{ code: "08", name: "工学" }],
    textLength: 1000 - index,
  })),
};

const lowProfile = {
  childType: "均衡探索型",
  score: "250",
  rank: "",
  province: "西藏",
  subject: "物理/理科",
  disciplineFocus: "08",
  interest: "数字媒体技术 计算机",
  cities: "",
  abilityProfile: "喜欢数字内容和计算机实践",
  redLines: "",
  budget: "中等敏感",
  strategy: "稳健",
};
const highProfile = { ...lowProfile, score: "650", rank: "3000" };
const belowAllThresholdProfile = { ...lowProfile, score: "180" };
const engineering = api.CANDIDATE_POOLS.find((item) => item.id === "engineering-industry");
const vocational = api.CANDIDATE_POOLS.find((item) => item.id === "vocational-dual");
const regional = api.CANDIDATE_POOLS.find((item) => item.id === "regional-safe");

assert.equal(api.isVacancyPlanRecord(vocationalVacancy), true);
assert.equal(api.isVocationalPlanRecord(vocationalVacancy), true);
assert.equal(api.isSpecialPathRecord(specialVacancy), true);
assert.deepEqual(
  api.profilePlanRecords(lowProfile).map((record) => record.id),
  [vocationalVacancy.id],
  "a vocational profile must only receive ordinary vocational plan candidates",
);
assert.equal(api.eligibilityThresholdLabel(vocationalVacancy), "A类不低于202分、B类不低于202分");

const lowOptions = api.buildPlanOptions(engineering, lowProfile, api.classifyScoreBand(lowProfile.score, lowProfile.rank));
const digitalOption = lowOptions.find((option) => option.record.id === vocationalVacancy.id);
assert.ok(digitalOption, "low-score engineering profile should surface the official digital-media vacancy");
assert.equal(digitalOption.role, "专科征集");
assert.equal(digitalOption.scoreStatus, "官方征集剩余计划：只作历史低需求/补录机会信号");
assert.equal(digitalOption.admissionFit.zone, "征集机会");
assert.equal(digitalOption.admissionFit.score, 46);
assert.ok(digitalOption.tags.includes("征集志愿"));
assert.ok(digitalOption.tags.includes("第17号"));
assert.ok(digitalOption.tags.includes("跨2轮出现"));
assert.ok(digitalOption.tags.includes("A类不低于202分、B类不低于202分"));
assert.match(digitalOption.focus, /历史时点快照/);
assert.match(digitalOption.focus, /不是投档线、录取最低分、录取位次或下一年计划/);
assert.match(digitalOption.focus, /跨2轮出现/);
assert.doesNotMatch(digitalOption.focus, /。。|。；|；。/, "vacancy explanation punctuation must be normalized");

assert.equal(api.vacancyEligibilityForProfile(vocationalVacancy, belowAllThresholdProfile).state, "below-all");
const belowAllOptions = api.buildPlanOptions(
  engineering,
  belowAllThresholdProfile,
  api.classifyScoreBand(belowAllThresholdProfile.score, belowAllThresholdProfile.rank),
);
assert.ok(belowAllOptions.every((option) => option.record.id !== vocationalVacancy.id), "a score below every published threshold must not surface as a vacancy opportunity");

const classDependent = api.vacancyEligibilityForProfile(bachelorVacancy, highProfile);
assert.equal(classDependent.state, "class-dependent");
assert.match(classDependent.text, /未确认A\/B类别/);
const classDependentOption = api.buildPlanOptions(
  regional,
  highProfile,
  api.classifyScoreBand(highProfile.score, highProfile.rank),
).find((option) => option.record.id === bachelorVacancy.id);
assert.ok(classDependentOption, "class-dependent vacancy should remain visible only for qualification verification");
assert.equal(classDependentOption.role, "资格待核验");
assert.equal(classDependentOption.admissionFit.zone, "资格待核验");
assert.match(classDependentOption.scoreStatus, /不是可报结论或录取概率/);
assert.match(classDependentOption.focus, /不能判断是否具备填报资格/);
assert.doesNotMatch(classDependentOption.focus, /。。|。；|；。/, "class-dependent explanation punctuation must be normalized");

const highOptions = api.buildPlanOptions(engineering, highProfile, api.classifyScoreBand(highProfile.score, highProfile.rank));
assert.ok(highOptions.every((option) => !api.isVocationalPlanRecord(option.record)), "650-point profile must exclude vocational vacancy plans");
assert.ok(highOptions.some((option) => option.record.id === bachelorVacancy.id), "undergraduate vacancy should remain a high-profile verification candidate");

const adversarialHighProfile = { ...highProfile, interest: "高职 专升本 数字媒体技术" };
const highRecommendations = api.candidatePoolsForProfile(adversarialHighProfile)
  .map((candidate) => api.scoreCandidate(candidate, adversarialHighProfile, api.classifyScoreBand(adversarialHighProfile.score, adversarialHighProfile.rank)))
  .sort((left, right) => right.total - left.total || right.evidence.length - left.evidence.length)
  .slice(0, 8);
assert.ok(highRecommendations.every((item) => item.id !== "vocational-dual"), "high-score top candidates must exclude the vocational pool even when interest keywords request it");
assert.ok(highRecommendations.every((item) => item.schoolOptions.every((option) => !option.record || !api.isVocationalPlanRecord(option.record))), "high-score top candidates must not contain vocational plan records");

const sameNamePlans = api.dedupePlanOptions([
  { record: { ...bachelorVacancy, id: "english-29", schoolName: "西藏民族大学", schoolCode: "0803", majorName: "英语", majorCode: "29" } },
  { record: { ...bachelorVacancy, id: "english-31", schoolName: "西藏民族大学", schoolCode: "0803", majorName: "英语", majorCode: "31" } },
]);
assert.equal(sameNamePlans.length, 2, "same-name programs with different major codes must not be folded together");

const freshness = api.admissionDataFreshness(lowProfile, "2026-07-15");
assert.equal(freshness.latestPlanYear, 2026);
assert.equal(freshness.latestAdmissionYear, 2024);
assert.equal(freshness.latestRankYear, null);
assert.equal(freshness.latestVacancyYear, 2025);
assert.equal(freshness.scheduleStage.state, "active");
assert.match(freshness.scheduleStage.text, /提前单独录取本科批进行中/);
assert.ok(freshness.warnings.some((warning) => /2026年招生计划已发布.*普通录取数据最新到2024年/.test(warning)));
assert.ok(freshness.warnings.some((warning) => /没有可计算的一分一段/.test(warning)));
assert.ok(freshness.warnings.some((warning) => /2025年征集志愿仅是各轮剩余计划快照/.test(warning)));

const panel = api.renderDataFreshnessPanel(lowProfile);
assert.match(panel, /西藏数据发布时间/);
assert.match(panel, /一分一段最新：未接入/);
assert.match(panel, /提前单独录取本科批进行中/);
assert.match(panel, /查看考试院转载日程/);

const result = api.scoreCandidate(vocational, lowProfile, api.classifyScoreBand(lowProfile.score, lowProfile.rank));
assert.notEqual(result.confidence, "A");
assert.notEqual(result.confidence, "A-");
assert.ok(result.schoolOptions.some((option) => option.record?.id === vocationalVacancy.id));
assert.ok(result.warnings.some((warning) => /没有可计算的一分一段/.test(warning)));
assert.ok(result.warnings.some((warning) => /考试院录取日程/.test(warning)));
assert.ok(result.schoolOptions.every((option) => !option.record || !api.isSpecialPathRecord(option.record)));

console.log(JSON.stringify({
  ok: true,
  lowOption: {
    school: digitalOption.name,
    role: digitalOption.role,
    tags: digitalOption.tags,
    status: digitalOption.scoreStatus,
  },
  highOptionIds: highOptions.map((option) => option.record.id),
  highCandidateIds: highRecommendations.map((item) => item.id),
  classDependentRole: classDependentOption.role,
  freshness: {
    latestPlanYear: freshness.latestPlanYear,
    latestAdmissionYear: freshness.latestAdmissionYear,
    latestRankYear: freshness.latestRankYear,
    stage: freshness.scheduleStage.text,
  },
  confidence: result.confidence,
  warnings: result.warnings,
}, null, 2));
