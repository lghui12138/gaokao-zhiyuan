#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const importFile = path.join(projectRoot, "data/admissions/official-national-school-admission-2024-2025-v3274-szu-import.json");
const payload = JSON.parse(fs.readFileSync(importFile, "utf8"));
const records = payload.records;
const note = payload.sourceNotes?.[0];

assert.equal(payload.dataset, "official-national-school-admission-2024-2025-v3274-szu");
assert.ok(note, "official source note is required");
assert.equal(note.id, "official-szu-national-2024-2025-school-admission");
assert.equal(note.publisher, "深圳大学本科招生网");
assert.equal(note.pageSummaries.length, 30, "the index must yield all 30 official province pages");
assert.equal(note.rawFiles.length, 32, "two index pages plus 30 province pages must be retained");
assert.ok(records.length >= 1500, "official pages must yield a substantial national professional record layer");
assert.deepEqual([...new Set(records.map((record) => record.id))].length, records.length, "record IDs must be unique");
assert.deepEqual(Object.keys(payload.audit.yearCounts).sort(), ["2024", "2025"]);
assert.equal(Object.keys(payload.audit.provinceCounts).length, 30);
assert.ok(records.every((record) => record.schoolName === "深圳大学"));
assert.ok(records.every((record) => record.dataType === "major-admission"));
assert.ok(records.every((record) => record.sourceFirstChoice === true));
assert.ok(records.every((record) => Number.isFinite(record.minScore) && record.minScore > 0));
assert.ok(records.every((record) => ["school-official-only", "special-path-only"].includes(record.formalScoreScope)));
assert.ok(records.filter((record) => record.minRankEnd != null).every((record) => record.rankUnavailable === false));
assert.ok(records.filter((record) => record.minRankEnd == null).every((record) => record.rankUnavailable === true));

const guangdongSpecial = records.filter((record) => record.province === "广东" && /地方专项/.test(record.sourceTableTitle || ""));
assert.ok(guangdongSpecial.length > 0, "Guangdong local-special tables must be parsed");
assert.ok(guangdongSpecial.every((record) => record.formalScoreScope === "special-path-only"));
assert.ok(records.filter((record) => record.formalScoreScope === "school-official-only").every((record) => !/地方专项/.test(record.sourceTableTitle || "")));

const xizang = records.filter((record) => record.province === "西藏");
assert.ok(xizang.length > 0, "the Shenzhen University source must retain its Xizang rows");
assert.ok(xizang.every((record) => ["A类考生", "B类考生"].includes(record.candidateCategory)));
assert.ok(xizang.every((record) => record.rankUnavailable === true && record.minRankEnd == null));
assert.ok(xizang.some((record) => record.majorName === "计算机科学与技术" && record.candidateCategory === "A类考生"));
assert.ok(xizang.some((record) => record.majorName === "计算机科学与技术" && record.candidateCategory === "B类考生"));

for (const rawFile of note.rawFiles) {
  const file = path.join(projectRoot, rawFile);
  assert.ok(fs.existsSync(file), `raw evidence missing: ${rawFile}`);
  const actualHash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(note.rawSha256[path.basename(rawFile)], actualHash, `raw SHA mismatch: ${rawFile}`);
}

console.log(JSON.stringify({
  ok: true,
  records: records.length,
  provinces: Object.keys(payload.audit.provinceCounts).length,
  years: payload.audit.yearCounts,
  recordsWithRank: payload.audit.recordsWithRank,
  rankUnavailable: payload.audit.recordsRankUnavailable,
  specialPathRecords: payload.audit.specialPathRecords,
  xizangRecords: xizang.length,
  guangdongSpecialRecords: guangdongSpecial.length,
}, null, 2));
