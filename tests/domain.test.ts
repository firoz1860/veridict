import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAnalysis,
  canResolve,
  resolveAction,
} from "../server/domain.js";
const policy = {
  id: "p",
  clauses: [
    {
      key: "R1",
      text: "Do not post scam.invalid links.",
      severity: "HIGH" as const,
      term: "scam.invalid",
    },
  ],
};
const input = { text: "Visit scam.invalid now", reports: [], history: [] };
const valid = {
  findings: [
    {
      clauseKey: "R1",
      policyQuote: "Do not post scam.invalid links.",
      quote: "scam.invalid",
      start: 6,
      end: 18,
      interpretation: "Prohibited domain",
      certainty: "SUPPORTED",
      severity: "HIGH",
      confidence: 0.9,
    },
  ],
  proposedAction: "REMOVE",
  summary: "A prohibited domain appears.",
  requiresHumanJudgment: true,
};
test("validates exact pinned citations and content offsets", () =>
  assert.equal(validateAnalysis(valid, policy, input).findings.length, 1));
test("rejects fabricated policy citations", () =>
  assert.throws(() =>
    validateAnalysis(
      { ...valid, findings: [{ ...valid.findings[0], clauseKey: "R9" }] },
      policy,
      input,
    ),
  ));
test("rejects incorrect evidence offsets", () =>
  assert.throws(() =>
    validateAnalysis(
      { ...valid, findings: [{ ...valid.findings[0], start: 5 }] },
      policy,
      input,
    ),
  ));
test("independent reviewer can review; original actor cannot", () => {
  assert.equal(canResolve("REVIEWER", "b", "a", "c", []), true);
  assert.equal(canResolve("REVIEWER", "a", "a", "c", []), false);
  assert.equal(canResolve("MODERATOR", "b", "a", "c", []), false);
  assert.equal(canResolve("REVIEWER", "b", "a", "c", ["b"]), false);
});
test("overturn restores allow and invalid modified outcome is rejected", () => {
  assert.equal(resolveAction("OVERTURNED", "REMOVE", "ALLOW"), "ALLOW");
  assert.throws(() => resolveAction("MODIFIED", "REMOVE", "REMOVE"));
  assert.throws(() => resolveAction("UPHELD", "REMOVE", "ALLOW"));
});
test("rejects evidence ranges beyond the source boundary", () =>
  assert.throws(() =>
    validateAnalysis(
      {
        ...valid,
        findings: [
          { ...valid.findings[0], quote: "scam.invalid now", end: 999 },
        ],
      },
      policy,
      input,
    ),
  ));
