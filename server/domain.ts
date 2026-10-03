import { AnalysisOutput, type Policy } from "../shared/contracts.js";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(
  value: unknown,
  status: number,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new AppError(status, code, message);
}
export function validateAnalysis(
  raw: unknown,
  policy: Pick<Policy, "id" | "clauses">,
  input: { text: string },
) {
  const parsed = AnalysisOutput.parse(raw);
  for (const f of parsed.findings) {
    const clause = policy.clauses.find((c) => c.key === f.clauseKey);
    ensure(
      clause && clause.text.includes(f.policyQuote),
      422,
      "INVALID_CITATION",
      "Policy citation does not match the pinned policy",
    );
    ensure(
      f.end > f.start &&
        f.end <= input.text.length &&
        input.text.slice(f.start, f.end) === f.quote,
      422,
      "INVALID_EVIDENCE",
      "Evidence must match the exact content snapshot",
    );
  }
  ensure(
    parsed.findings.length > 0 ||
      ["ALLOW", "ESCALATE"].includes(parsed.proposedAction),
    422,
    "UNSUPPORTED_ACTION",
    "An adverse proposal requires evidence",
  );
  return parsed;
}
export function canResolve(
  role: string,
  id: string,
  originalActor: string,
  author: string,
  reporters: string[],
) {
  return (
    role === "REVIEWER" &&
    id !== originalActor &&
    id !== author &&
    !reporters.includes(id)
  );
}
export function resolveAction(
  outcome: string,
  original: string,
  action: string,
) {
  ensure(
    ["ALLOW", "WARN", "REMOVE"].includes(action),
    400,
    "ACTION",
    "Invalid action",
  );
  if (outcome === "UPHELD")
    ensure(
      action === original,
      400,
      "OUTCOME",
      "Uphold must retain the original action",
    );
  else if (outcome === "OVERTURNED")
    ensure(action === "ALLOW", 400, "OUTCOME", "Overturn must allow content");
  else
    ensure(
      outcome === "MODIFIED" && action !== original,
      400,
      "OUTCOME",
      "Modify must change the original action",
    );
  return action;
}
export function revision(actual: number, expected: number) {
  ensure(
    actual === expected,
    409,
    "STALE_REVISION",
    "This item changed. Refresh and review before submitting again.",
  );
}
