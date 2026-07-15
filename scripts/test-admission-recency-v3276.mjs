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
globalThis.__gaokaoTest = { admissionRecency, admissionFit };`;
const context = vm.createContext({ console, Intl, Date });
vm.runInContext(instrumented, context, { filename: appFile });
const api = context.__gaokaoTest;
const profile = { rank: "12000", score: "600" };
const freshRecord = { year: 2025, minRankEnd: 14000, minScore: 585 };
const historicalRecord = { year: 2021, minRankEnd: 14000, minScore: 585 };

const fresh = api.admissionFit(freshRecord, profile, "2026-07-15");
const historical = api.admissionFit(historicalRecord, profile, "2026-07-15");
assert.equal(fresh.recency.fresh, true, "a prior-year boundary should remain fresh");
assert.equal(historical.recency.fresh, false, "a five-year-old boundary must be marked historical");
assert.equal(historical.recency.age, 5);
assert.ok(historical.recency.penalty > fresh.recency.penalty, "historical evidence must receive a larger penalty");
assert.ok(historical.score < fresh.score, "the same score/rank gap must not receive the same fit score across years");
assert.match(historical.zone, /年前稳妥/);
assert.match(historical.text, /模型已降权/);

console.log(JSON.stringify({
  status: "ok",
  fresh: { zone: fresh.zone, score: fresh.score, recency: fresh.recency },
  historical: { zone: historical.zone, score: historical.score, recency: historical.recency },
}, null, 2));
