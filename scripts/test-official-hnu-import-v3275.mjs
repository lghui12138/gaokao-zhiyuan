#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const importFile = path.join(projectRoot, "data/admissions/official-national-school-admission-2024-v3275-hnu-import.json");
const rawRoot = "data/admissions/raw/official-national-school-admission-2024-v3275-hnu";
const payload = JSON.parse(fs.readFileSync(importFile, "utf8"));
const records = payload.records;
const note = payload.sourceNotes?.[0];
const parseIndex = JSON.parse(fs.readFileSync(path.join(projectRoot, rawRoot, "hnu-national-2025-parse-index.json"), "utf8"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function findRecord(province, majorName, admissionType = "普通类") {
  const record = records.find((item) => item.province === province && item.majorName === majorName && item.admissionType === admissionType);
  assert.ok(record, `missing ${province} ${admissionType} ${majorName}`);
  return record;
}

assert.equal(payload.dataset, "official-national-school-admission-2024-v3275-hnu");
assert.deepEqual(payload.scope, { school: "湖南大学", scoreYear: 2024, planYear: 2025, officialAttachments: 28 });
assert.ok(note, "official source note is required");
assert.equal(note.id, "official-hnu-national-2024-major-admission");
assert.equal(note.publisher, "湖南大学本科生招生信息网");
assert.equal(note.provinceCount, 28);
assert.deepEqual(note.unavailableAtVerifiedRoute, ["重庆", "西藏", "陕西"]);
assert.equal(records.length, 901);
assert.equal(payload.audit.recordsWithRank, 874);
assert.equal(payload.audit.rankUnavailableRecords, 27);
assert.equal(Object.keys(payload.audit.byProvince).length, 28);
assert.equal(records.filter((record) => record.formalScoreScope === "school-official-only").length, 839);
assert.equal(records.filter((record) => record.formalScoreScope === "special-path-only").length, 62);
assert.deepEqual([...new Set(records.map((record) => record.id))].length, records.length, "record IDs must be unique");
assert.ok(records.every((record) => record.schoolName === "湖南大学" && record.schoolCode === "10532"));
assert.ok(records.every((record) => record.year === 2024 && record.sourcePlanYear === 2025));
assert.ok(records.every((record) => record.dataType === "major-admission"));
assert.ok(records.every((record) => Number.isFinite(record.minScore) && record.minScore >= 419 && record.minScore <= 750));
assert.ok(records.every((record) => ["school-official-only", "special-path-only"].includes(record.formalScoreScope)));
assert.ok(records.filter((record) => record.minRankEnd != null).every((record) => record.rankUnavailable === false && record.scoreOnly === false));
assert.ok(records.filter((record) => record.minRankEnd == null).every((record) => record.rankUnavailable === true && record.scoreOnly === true));
assert.ok(records.every((record) => !["重庆", "西藏", "陕西"].includes(record.province)));

const jiangxiCs = findRecord("江西", "计算机科学与技术");
assert.equal(jiangxiCs.minScore, 627);
assert.equal(jiangxiCs.minRankEnd, 3880);
assert.equal(jiangxiCs.planCount, 8);
assert.equal(jiangxiCs.formalScoreScope, "school-official-only");

const jiangxiAi = findRecord("江西", "人工智能");
assert.equal(jiangxiAi.minScore, 626);
assert.equal(jiangxiAi.minRankEnd, 4052);
assert.equal(jiangxiAi.planCount, 7);

const jiangxiSpecial = findRecord("江西", "英语", "高校专项");
assert.equal(jiangxiSpecial.formalScoreScope, "special-path-only");
assert.equal(jiangxiSpecial.minScore, 610);
assert.equal(jiangxiSpecial.minRankEnd, 1287);

const xinjiangCs = findRecord("新疆", "计算机科学与技术");
assert.equal(xinjiangCs.minScore, 568);
assert.equal(xinjiangCs.minRankEnd, undefined);
assert.equal(xinjiangCs.rankUnavailable, true);
assert.equal(xinjiangCs.scoreOnly, true);
assert.equal(records.filter((record) => record.province === "新疆").length, 25);
assert.ok(records.filter((record) => record.province === "新疆").every((record) => record.rankUnavailable));

assert.equal(parseIndex.attachments.length, 28);
assert.deepEqual(parseIndex.unavailableAtVerifiedRoute, ["重庆", "西藏", "陕西"]);
for (const attachment of parseIndex.attachments) {
  for (const [pathKey, hashKey] of [["pdfRel", "pdfSha256"], ["textRel", "textSha256"], ["bboxRel", "bboxSha256"]]) {
    const file = path.join(projectRoot, attachment[pathKey]);
    assert.ok(fs.existsSync(file), `raw evidence missing: ${attachment[pathKey]}`);
    assert.equal(sha256(file), attachment[hashKey], `raw SHA mismatch: ${attachment[pathKey]}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  records: records.length,
  provinces: Object.keys(payload.audit.byProvince).length,
  recordsWithRank: payload.audit.recordsWithRank,
  rankUnavailableRecords: payload.audit.rankUnavailableRecords,
  ordinaryRecords: payload.audit.byFormalScoreScope["school-official-only"],
  specialPathRecords: payload.audit.byFormalScoreScope["special-path-only"],
  jiangxiCs: { score: jiangxiCs.minScore, rank: jiangxiCs.minRankEnd },
  xinjiangScoreOnlyRecords: records.filter((record) => record.province === "新疆").length,
}, null, 2));
