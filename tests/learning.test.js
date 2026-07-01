const assert = require("node:assert/strict");
const test = require("node:test");
const { computeMastery, xpLevel, MASTERY_TIERS } = require("../apps/gateway/lib/learning");

test("xpLevel: 100 XP per level, starts at 1", () => {
  assert.equal(xpLevel(0), 1);
  assert.equal(xpLevel(99), 1);
  assert.equal(xpLevel(100), 2);
  assert.equal(xpLevel(550), 6);
  assert.equal(xpLevel(undefined), 1);
  assert.equal(xpLevel(null), 1);
});

test("computeMastery: Starter with no practice", () => {
  const m = computeMastery(0, 0);
  assert.equal(m.name, "Starter");
  assert.equal(m.index, 0);
  assert.equal(m.isMax, false);
  assert.equal(m.next.name, "Bronze");
});

test("computeMastery: high accuracy but low volume can NOT skip tiers", () => {
  // 100% on only 3 questions -> still Starter (Bronze needs 5 questions).
  assert.equal(computeMastery(3, 100).name, "Starter");
});

test("computeMastery: Bronze at exactly 5 questions / 50%", () => {
  const m = computeMastery(5, 50);
  assert.equal(m.name, "Bronze");
  assert.equal(m.index, 1);
});

test("computeMastery: Master is the top tier (no next, 100%)", () => {
  const m = computeMastery(40, 95);
  assert.equal(m.name, "Master");
  assert.equal(m.isMax, true);
  assert.equal(m.next, null);
  assert.equal(m.progressPct, 100);
});

test("computeMastery: progress to next reflects the binding constraint, capped <100", () => {
  // Bronze heading to Silver (12q, 68%): 8 questions, 60% accuracy.
  const m = computeMastery(8, 60);
  assert.equal(m.name, "Bronze");
  // qRatio 8/12=0.67, aRatio 60/68=0.88 -> min -> ~67
  assert.ok(m.progressPct >= 60 && m.progressPct <= 70, `progressPct=${m.progressPct}`);
  assert.ok(m.progressPct < 100);
});

test("MASTERY_TIERS: requirements strictly non-decreasing", () => {
  for (let i = 1; i < MASTERY_TIERS.length; i += 1) {
    assert.ok(MASTERY_TIERS[i].minQuestions >= MASTERY_TIERS[i - 1].minQuestions);
    assert.ok(MASTERY_TIERS[i].minAccuracy >= MASTERY_TIERS[i - 1].minAccuracy);
  }
});
