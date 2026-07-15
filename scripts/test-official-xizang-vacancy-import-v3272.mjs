#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_DERIVED_HASHES,
  EXPECTED_RAW_HASHES,
  assertPinnedHash,
  assertSourceUrl,
  download,
} from "./import-official-xizang-vacancy-plans-2025-v3272.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const importFile = path.join(projectRoot, "data/admissions/official-xizang-vacancy-plans-2025-v3272-import.json");
const rawDir = path.join(projectRoot, "data/admissions/raw/official-xizang-vacancy-plans-2025-v3272");

function fileSha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runImporter() {
  const result = spawnSync(process.execPath, [
    "scripts/import-official-xizang-vacancy-plans-2025-v3272.mjs",
    "--use-cache",
  ], { cwd: projectRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

assert.equal(Object.keys(EXPECTED_RAW_HASHES).length, 37);
assert.throws(() => assertSourceUrl("https://example.com/fake.html", "page"), /outside the CHSI\/CHEI source allowlist/);
assert.throws(() => assertSourceUrl("http://gaokao.chsi.com.cn/fake.html", "page"), /must use HTTPS/);
await assert.rejects(
  () => download(
    "https://gaokao.chsi.com.cn/fake.html",
    "page",
    "text/html",
    async () => ({
      ok: true,
      status: 200,
      url: "https://example.com/redirected.html",
      arrayBuffer: async () => Buffer.from("fake"),
    }),
    1,
  ),
  /outside the CHSI\/CHEI source allowlist/,
);

const initialReplay = runImporter();
assert.equal(initialReplay.ok, true);
const firstHash = fileSha(importFile);
const replay = runImporter();
const secondHash = fileSha(importFile);
assert.equal(replay.ok, true);
assert.equal(replay.hashCaptureMode, false);
assert.equal(replay.expectedHashCoverage, 37);
assert.equal(firstHash, secondHash, "--use-cache replay must be byte-stable");

const derivedCsvFile = path.join(rawDir, "vacancy-counterpart-counterpart.csv");
const pristineDerivedCsv = fs.readFileSync(derivedCsvFile);
assert.equal(fileSha(derivedCsvFile), EXPECTED_DERIVED_HASHES[path.basename(derivedCsvFile)]);
try {
  fs.writeFileSync(derivedCsvFile, "tampered cached derivative\n", "utf8");
  const tamperReplay = runImporter();
  assert.equal(tamperReplay.ok, true);
  assert.equal(fileSha(derivedCsvFile), EXPECTED_DERIVED_HASHES[path.basename(derivedCsvFile)], "cached CSV must be regenerated from the pinned XLS");
  assert.equal(fileSha(importFile), secondHash, "tampered derived CSV must not change the import payload");
} finally {
  if (fileSha(derivedCsvFile) !== EXPECTED_DERIVED_HASHES[path.basename(derivedCsvFile)]) {
    fs.writeFileSync(derivedCsvFile, pristineDerivedCsv);
  }
}

const payload = JSON.parse(fs.readFileSync(importFile, "utf8"));
assert.equal(payload.dataset, "official-xizang-vacancy-plans-2025-v3272");
assert.equal(payload.sourceNotes.length, 2);
assert.deepEqual(payload.audit, {
  hashCaptureMode: false,
  expectedHashCoverage: 37,
  vacancyPageCount: 12,
  attachmentCount: 23,
  docxAttachmentCount: 22,
  xlsAttachmentCount: 1,
  recordCount: 2187,
  ordinaryRecordCount: 2157,
  specialPathRecordCount: 30,
  vocationalRecordCount: 944,
  ordinaryVocationalRecordCount: 926,
  planSnapshotCount: 6099,
  repeatedRecordCount: 1560,
  repeatedGroupCount: 742,
  eligibilityRecordCount: 510,
  digitalMediaTechnologyRecords: 23,
  scheduleRows: 6,
  minScoreFieldCount: 0,
  minRankFieldCount: 0,
});

const [vacancySource, scheduleSource] = payload.sourceNotes;
assert.equal(vacancySource.id, "official-xizang-vacancy-plans-2025-v3272");
assert.equal(vacancySource.announcementCount, 12);
assert.equal(vacancySource.attachmentCount, 23);
assert.equal(vacancySource.rawFiles.length, 35);
assert.equal(scheduleSource.id, "official-xizang-admission-schedule-2026-v3272");
assert.equal(scheduleSource.rawFiles.length, 2);
assert.deepEqual(scheduleSource.schedule, [
  { batch: "提前单独录取本科批", start: "2026-07-11", end: "2026-07-18" },
  { batch: "专项批次", start: "2026-07-19", end: "2026-07-22" },
  { batch: "本科一批（含预科班）", start: "2026-07-23", end: "2026-07-31" },
  { batch: "本科二批（含预科班）", start: "2026-08-01", end: "2026-08-09" },
  { batch: "专科批（含提前单独录取专科、艺体类专科）", start: "2026-08-10", end: "2026-08-20" },
  { batch: "对口高职专科批", start: "2026-08-21", end: "2026-08-25" },
]);

for (const raw of [...vacancySource.rawFiles, ...scheduleSource.rawFiles]) {
  const fileName = path.basename(raw.path);
  const file = path.join(projectRoot, raw.path);
  assert.equal(fs.statSync(file).size, raw.bytes, `${fileName} byte count mismatch`);
  assert.equal(fileSha(file), raw.sha256, `${fileName} payload hash mismatch`);
  assert.equal(assertPinnedHash(fileName, fs.readFileSync(file)), EXPECTED_RAW_HASHES[fileName]);
  assert.equal(raw.sha256, EXPECTED_RAW_HASHES[fileName]);
  assertSourceUrl(raw.url, raw.kind === "page" ? "page" : "asset");
  assertSourceUrl(raw.finalUrl, raw.kind === "page" ? "page" : "asset");
}
assert.throws(
  () => assertPinnedHash("schedule-2026.png", Buffer.from("tampered")),
  /SHA-256 mismatch/,
);

assert.equal(payload.records.length, 2187);
assert.equal(new Set(payload.records.map((record) => record.id)).size, 2187);
assert.equal(payload.records.reduce((sum, record) => sum + record.planCount, 0), 6099);
assert.ok(payload.records.every((record) => record.dataType === "admission-plan"));
assert.ok(payload.records.every((record) => record.planOnly === true && record.planStage === "征集志愿"));
assert.ok(payload.records.every((record) => !Object.hasOwn(record, "minScore")));
assert.ok(payload.records.every((record) => !Object.hasOwn(record, "minRank") && !Object.hasOwn(record, "minRankEnd")));
assert.equal(payload.records.filter((record) => record.formalScoreScope === "vacancy-plan-only").length, 2157);
assert.equal(payload.records.filter((record) => record.formalScoreScope === "special-path-only").length, 30);
assert.equal(payload.records.filter((record) => record.vacancyRepeatCount > 1).length, 1560);

const borderSpecialRecords = payload.records.filter((record) => record.specialPathReason === "边境专项计划");
assert.equal(borderSpecialRecords.length, 3);
assert.ok(borderSpecialRecords.every((record) => record.formalScoreScope === "special-path-only"));
assert.deepEqual(
  borderSpecialRecords.map((record) => `${record.vacancyRound}|${record.schoolCode}|${record.majorCode}`).sort(),
  ["5|1202|12", "6|1202|12", "9|1207|33"],
);

for (const attachment of vacancySource.attachmentAudits) {
  assert.equal(attachment.parsedPlanCount, attachment.expectedPlanCount, `${attachment.file} heading total mismatch`);
  if (attachment.schoolPlanCount !== null) {
    assert.equal(attachment.parsedPlanCount, attachment.schoolPlanCount, `${attachment.file} school total mismatch`);
  }
}
const xlsAudit = vacancySource.attachmentAudits.find((item) => item.file.endsWith(".xls"));
assert.equal(xlsAudit.records, 13);
assert.equal(xlsAudit.parsedPlanCount, 24);
assert.equal(fileSha(path.join(projectRoot, xlsAudit.csvFile)), xlsAudit.csvSha256);
assert.equal(xlsAudit.csvSha256, EXPECTED_DERIVED_HASHES[path.basename(xlsAudit.csvFile)]);

const huanggang = payload.records.find((record) =>
  record.schoolName === "黄冈职业技术学院" && record.majorName === "园林技术" && record.vacancyRound === "17"
);
assert.deepEqual(huanggang.eligibilityThresholds, { A: 202, B: 202 });
assert.match(huanggang.planRestrictionText, /A类考生不低于202分/);
assert.equal(Object.hasOwn(huanggang, "minScore"), false);

const digitalMedia = payload.records.filter((record) => record.majorName === "数字媒体技术");
assert.equal(digitalMedia.length, 23);
assert.ok(digitalMedia.every((record) => record.disciplineCodes.includes("08")));
const dongying = digitalMedia.find((record) => record.schoolName === "东营职业学院" && record.vacancyRound === "17");
assert.equal(dongying.planCount, 3);
assert.deepEqual(dongying.eligibilityThresholds, { A: 202, B: 202 });
assert.equal(dongying.vacancyRepeatCount, 2);
assert.equal(dongying.vacancyOccurrence, 2);

const englishRecords = payload.records.filter((record) => record.schoolName === "西藏民族大学" && record.majorName === "英语");
assert.equal(englishRecords.length, 6);
for (const majorCode of ["29", "31"]) {
  const codeRecords = englishRecords
    .filter((record) => record.majorCode === majorCode)
    .sort((left, right) => Number(left.vacancyRound) - Number(right.vacancyRound));
  assert.deepEqual(codeRecords.map((record) => record.vacancyRound), ["5", "6", "7"]);
  assert.ok(codeRecords.every((record) => record.vacancyRepeatCount === 3));
  assert.deepEqual(codeRecords.map((record) => record.vacancyOccurrence), [1, 2, 3]);
}
assert.notEqual(
  englishRecords.find((record) => record.majorCode === "29").vacancyKey,
  englishRecords.find((record) => record.majorCode === "31").vacancyKey,
);

console.log(JSON.stringify({
  ok: true,
  importSha256: secondHash,
  records: payload.audit.recordCount,
  ordinaryRecords: payload.audit.ordinaryRecordCount,
  specialPathRecords: payload.audit.specialPathRecordCount,
  planSnapshots: payload.audit.planSnapshotCount,
  digitalMediaTechnologyRecords: digitalMedia.length,
  repeatedGroups: payload.audit.repeatedGroupCount,
  rawFiles: Object.keys(EXPECTED_RAW_HASHES).length,
}, null, 2));
