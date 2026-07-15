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
globalThis.__gaokaoTest = { buildApplicationPlan, applicationPlanDetail };`;
const context = vm.createContext({ console, Intl, Date });
vm.runInContext(instrumented, context, { filename: appFile });
const { buildApplicationPlan, applicationPlanDetail } = context.__gaokaoTest;

const freshFit = {
  score: 88,
  zone: "稳妥",
  text: "位次比近年最低位次靠前2,000名；2025年录取边界，时效性较好",
  recency: { fresh: true, label: "近1年" },
};
const reachFit = {
  score: 57,
  zone: "冲",
  text: "位次落后近年最低位次约1,800名；2024年历史录取边界，模型已降权",
  recency: { fresh: false, label: "近2年" },
};
const majorRecord = {
  id: "jiangxi-cs-1",
  dataType: "major-admission",
  schoolName: "示例大学",
  majorName: "计算机科学与技术",
  province: "江西",
  subjectType: "物理类",
  year: 2025,
  minScore: 610,
  sourceUrl: "https://example.edu.cn/admission/jiangxi",
};
const results = [
  {
    title: "08 工学产业就业院校池",
    total: 82,
    schoolOptions: [
      { name: "示例大学", role: "稳妥", optionScore: 93, admissionFit: freshFit, record: majorRecord },
      { name: "历史大学", role: "冲", optionScore: 68, admissionFit: reachFit, record: { ...majorRecord, id: "jiangxi-cs-2", schoolName: "历史大学", year: 2024 } },
      { name: "计划大学", role: "计划核验", optionScore: 99, record: { id: "jiangxi-plan-1", dataType: "admission-plan", schoolName: "计划大学", majorName: "软件工程", province: "江西", year: 2026, planOnly: true } },
    ],
  },
  {
    title: "区域稳妥院校池",
    total: 76,
    schoolOptions: [
      { name: "示例大学", role: "首选", optionScore: 88, admissionFit: freshFit, record: majorRecord },
      { name: "无数据学校", role: "备选核验", optionScore: 99 },
    ],
  },
];

const tiers = buildApplicationPlan(results);
const priority = tiers.find((tier) => tier.id === "priority");
const reach = tiers.find((tier) => tier.id === "reach");
const plan = tiers.find((tier) => tier.id === "plan");
assert.ok(priority, "high-fit admission records must enter the priority tier");
assert.equal(priority.options.length, 1, "the same school-major record must be deduplicated across candidate pools");
assert.deepEqual(Array.from(priority.options[0].matchingPools), ["08 工学产业就业院校池", "区域稳妥院校池"]);
assert.ok(reach && reach.options.some((option) => option.name === "历史大学"), "low-fit historical evidence must remain a reach candidate");
assert.ok(plan && plan.options.every((option) => option.record.dataType === "admission-plan"), "plan records must remain isolated from admission tiers");
assert.equal(tiers.flatMap((tier) => tier.options).some((option) => option.name === "无数据学校"), false, "generic schools without a structured record must not enter the executable plan");
const detail = applicationPlanDetail(priority.options[0]);
assert.equal(detail.sourceUrl, "https://example.edu.cn/admission/jiangxi");
assert.equal(detail.sourceLabel, "官方投档/录取来源");

console.log(JSON.stringify({
  status: "ok",
  tiers: tiers.map((tier) => ({ id: tier.id, count: tier.options.length, schools: tier.options.map((option) => option.name) })),
}, null, 2));
