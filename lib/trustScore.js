// Trust score: "a numeric reliability metric assigned to each student user,
// updated based on exchange history and platform conduct" (SRD glossary).
// Stored as a whole-number percentage in Users.trust_score.

const TRUST_SCORE_DEFAULT = 100; // FUNC-002 REQT-007: new accounts start here
const TRUST_SCORE_MIN = 0;
const TRUST_SCORE_MAX = 100;

// FUNC-011 REQT-011 and platform conduct. An admin can also set the score
// directly (FUNC-018 REQT-007); later events move it from that value.
const TRUST_CHANGE = {
  // A SWAPP completes when its chat is ended. Both students gain.
  swappCompleted: 2,
  // Cancelling an accepted SWAPP. Only the student who cancels loses.
  swappCancelled: -10,
  // An admin warning (a notebook removed as unsafe).
  warning: -15,
};

function clampTrustScore(score) {
  const value = Number.isFinite(Number(score)) ? Math.round(Number(score)) : TRUST_SCORE_DEFAULT;
  return Math.min(TRUST_SCORE_MAX, Math.max(TRUST_SCORE_MIN, value));
}

function applyTrustChange(score, change) {
  const current = score === null || score === undefined ? TRUST_SCORE_DEFAULT : score;
  return clampTrustScore(Number(current) + change);
}

module.exports = {
  TRUST_CHANGE,
  TRUST_SCORE_DEFAULT,
  TRUST_SCORE_MAX,
  TRUST_SCORE_MIN,
  applyTrustChange,
  clampTrustScore,
};
