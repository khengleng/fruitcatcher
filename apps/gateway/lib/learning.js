"use strict";

// Pure learning/scoring logic, extracted so it can be unit-tested without
// booting the server or a database.

// Mastery levels are reached by BOTH accuracy and practice volume, so a student
// can't "master" a subject from one lucky answer — they grow the level by
// practising.
const MASTERY_TIERS = [
  { name: "Starter", badge: "🌱", minQuestions: 0, minAccuracy: 0 },
  { name: "Bronze", badge: "🥉", minQuestions: 5, minAccuracy: 50 },
  { name: "Silver", badge: "🥈", minQuestions: 12, minAccuracy: 68 },
  { name: "Gold", badge: "🥇", minQuestions: 22, minAccuracy: 82 },
  { name: "Master", badge: "🏆", minQuestions: 35, minAccuracy: 92 }
];

function computeMastery(questions, accuracy) {
  let index = 0;
  for (let i = 1; i < MASTERY_TIERS.length; i += 1) {
    const t = MASTERY_TIERS[i];
    if (questions >= t.minQuestions && accuracy >= t.minAccuracy) index = i;
    else break;
  }
  const tier = MASTERY_TIERS[index];
  const next = MASTERY_TIERS[index + 1] || null;
  let progressPct = 100;
  if (next) {
    // Progress toward the next level is limited by whichever requirement (more
    // practice or higher accuracy) is furthest away.
    const qRatio = next.minQuestions ? Math.min(1, questions / next.minQuestions) : 1;
    const aRatio = next.minAccuracy ? Math.min(1, accuracy / next.minAccuracy) : 1;
    progressPct = Math.max(0, Math.min(99, Math.round(Math.min(qRatio, aRatio) * 100)));
  }
  return {
    index,
    name: tier.name,
    badge: tier.badge,
    isMax: !next,
    next: next ? { name: next.name, badge: next.badge, minQuestions: next.minQuestions, minAccuracy: next.minAccuracy } : null,
    progressPct
  };
}

// XP → level curve: 100 XP per level, so it never plateaus.
function xpLevel(xp) {
  return Math.floor((Number(xp) || 0) / 100) + 1;
}

module.exports = { MASTERY_TIERS, computeMastery, xpLevel };
