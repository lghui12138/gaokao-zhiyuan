#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refreshKnowledge } from "./refresh-xizang-vacancy-records-v3272.mjs";

const SOURCE_ID = "official-xizang-vacancy-plans-2025-v3272";
const SCHEDULE_SOURCE_ID = "official-xizang-admission-schedule-2026-v3272";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gaokao-v3272-refresh-"));

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tempArtifacts() {
  return fs.readdirSync(tempDir).filter((name) => name.includes(".tmp-"));
}

try {
  const inputFile = path.join(tempDir, "input.json");
  const importFile = path.join(tempDir, "import.json");
  const outputFile = path.join(tempDir, "output.json");
  const failureOutput = path.join(tempDir, "failure-output.json");
  const malformedImportFile = path.join(tempDir, "malformed-import.json");
  const malformedOutput = path.join(tempDir, "malformed-output.json");
  const recordId = "xz-v3272-test-record";

  writeJson(inputFile, {
    meta: { version: "test-old" },
    admissionScoreLayer: {
      currentFinding: "old finding",
      records: [{ id: recordId, sourceId: SOURCE_ID, marker: "old" }],
      sourceNotes: [
        { id: SOURCE_ID, marker: "old vacancy note" },
        { id: SCHEDULE_SOURCE_ID, marker: "old schedule note" },
      ],
    },
  });
  const importPayload = {
    dataset: SOURCE_ID,
    audit: { ordinaryRecordCount: 1, specialPathRecordCount: 0 },
    records: [{ id: recordId, sourceId: SOURCE_ID, marker: "new" }],
    sourceNotes: [
      { id: SOURCE_ID, marker: "new vacancy note" },
      { id: SCHEDULE_SOURCE_ID, marker: "new schedule note" },
    ],
  };
  writeJson(importFile, importPayload);

  fs.writeFileSync(outputFile, "existing output\n", "utf8");
  const result = await refreshKnowledge(
    { input: inputFile, import: importFile, out: outputFile },
    { totalRecords: 1, replacements: 1 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.totalRecords, 1);
  assert.equal(result.replacedRecords, 1);
  assert.equal(result.replacedSourceNotes, 2);
  const refreshed = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(refreshed.admissionScoreLayer.records[0].marker, "new");
  assert.equal(refreshed.admissionScoreLayer.sourceNotes[0].marker, "new vacancy note");
  assert.equal(refreshed.admissionScoreLayer.sourceNotes[1].marker, "new schedule note");
  assert.match(refreshed.admissionScoreLayer.currentFinding, /2187条专业级剩余计划快照/);
  assert.deepEqual(tempArtifacts(), []);

  fs.writeFileSync(failureOutput, "preserve me\n", "utf8");
  await assert.rejects(
    () => refreshKnowledge(
      { input: inputFile, import: importFile, out: failureOutput },
      { totalRecords: 2, replacements: 1 },
    ),
    /Expected 2 total records, got 1/,
  );
  assert.equal(fs.readFileSync(failureOutput, "utf8"), "preserve me\n");
  assert.deepEqual(tempArtifacts(), []);

  const { audit: omittedAudit, ...malformedImport } = importPayload;
  assert.ok(omittedAudit);
  writeJson(malformedImportFile, malformedImport);
  fs.writeFileSync(malformedOutput, "preserve malformed output\n", "utf8");
  await assert.rejects(
    () => refreshKnowledge(
      { input: inputFile, import: malformedImportFile, out: malformedOutput },
      { totalRecords: 1, replacements: 1 },
    ),
    /Unexpected import audit/,
  );
  assert.equal(fs.readFileSync(malformedOutput, "utf8"), "preserve malformed output\n");
  assert.deepEqual(tempArtifacts(), []);

  await assert.rejects(
    () => refreshKnowledge(
      { input: inputFile, import: inputFile, out: failureOutput },
      { totalRecords: 1, replacements: 1 },
    ),
    /--input and --import must differ/,
  );
  await assert.rejects(
    () => refreshKnowledge(
      { input: inputFile, import: importFile, out: inputFile },
      { totalRecords: 1, replacements: 1 },
    ),
    /--input and --out must differ/,
  );
  await assert.rejects(
    () => refreshKnowledge(
      { input: inputFile, import: importFile, out: importFile },
      { totalRecords: 1, replacements: 1 },
    ),
    /--import and --out must differ/,
  );
  assert.equal(fs.readFileSync(failureOutput, "utf8"), "preserve me\n");
  assert.deepEqual(tempArtifacts(), []);

  const inputAlias = path.join(tempDir, "input-alias.json");
  fs.symlinkSync(inputFile, inputAlias);
  await assert.rejects(
    () => refreshKnowledge(
      { input: inputFile, import: importFile, out: inputAlias },
      { totalRecords: 1, replacements: 1 },
    ),
    /--input and --out must differ/,
  );

  console.log(JSON.stringify({
    ok: true,
    successPath: "atomic replacement verified",
    failurePath: "existing output preserved",
    malformedAuditPath: "existing output preserved",
    pairwisePathConflicts: 3,
    symlinkAliasConflict: true,
    leftoverTempArtifacts: tempArtifacts().length,
  }, null, 2));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
