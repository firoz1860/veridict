import { z } from "zod";
export const Role = z.enum(["AUTHOR", "MODERATOR", "REVIEWER", "ADMIN"]);
export type Role = z.infer<typeof Role>;
export const Action = z.enum(["ALLOW", "WARN", "REMOVE"]);
export const Severity = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const Clause = z.object({
  key: z.string().regex(/^[A-Z0-9_-]{1,30}$/),
  text: z.string().trim().min(10).max(3000),
  severity: Severity,
  term: z.string().max(100).default(""),
});
export const PolicyInput = z
  .object({
    title: z.string().trim().min(3).max(120),
    clauses: z.array(Clause).min(1).max(30),
  })
  .refine(
    (x) => new Set(x.clauses.map((c) => c.key)).size === x.clauses.length,
    "Clause keys must be unique",
  );
export type Policy = {
  id: string;
  version: number;
  title: string;
  clauses: z.infer<typeof Clause>[];
  created_at: string;
};
export const Finding = z.object({
  clauseKey: z.string(),
  policyQuote: z.string().min(1).max(3000),
  quote: z.string().min(1).max(5000),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  interpretation: z.string().min(1).max(2000),
  certainty: z.enum(["SUPPORTED", "UNCERTAIN"]),
  severity: Severity,
  confidence: z.number().min(0).max(1),
  source: z.enum(["AI", "DETERMINISTIC"]).optional(),
});
export const AnalysisOutput = z.object({
  findings: z.array(Finding).max(30),
  proposedAction: z.enum(["ALLOW", "WARN", "REMOVE", "ESCALATE"]),
  summary: z.string().min(1).max(3000),
  requiresHumanJudgment: z.boolean(),
});
export type AnalysisOutput = z.infer<typeof AnalysisOutput>;
export type User = { id: string; name: string; email: string; role: Role };
export const Login = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
export const ContentInput = z.object({
  text: z.string().trim().min(1).max(5000),
  type: z.enum(["POST", "COMMENT"]).default("POST"),
  parentId: z.string().uuid().nullable().optional(),
});
export const Revision = z.object({
  expectedRevision: z.number().int().positive(),
});
export const DecisionInput = Revision.extend({
  action: Action,
  disposition: z.enum(["APPROVE", "REJECT", "MODIFY"]),
  rationale: z.string().trim().min(10).max(3000),
  clauseKeys: z.array(z.string()).max(30),
  manualReview: z.boolean().default(false),
});
export const AppealInput = z.object({
  reason: z.string().trim().min(10).max(3000),
  evidence: z.string().max(5000).default(""),
});
export const ResolutionInput = Revision.extend({
  outcome: z.enum(["UPHELD", "OVERTURNED", "MODIFIED"]),
  action: Action,
  rationale: z.string().trim().min(10).max(3000),
  policyId: z.string().uuid(),
  manualReview: z.boolean().default(false),
});
export const AiProvider = z.enum([
  "openai",
  "anthropic",
  "xai",
  "gemini",
  "openrouter",
  "custom",
]);
export type AiProvider = z.infer<typeof AiProvider>;
const ApiKey = z.string().trim().min(8).max(400);
const ModelId = z.string().trim().min(1).max(200);
const BaseUrl = z.string().trim().url().max(500);
export const AiVerifyInput = z.object({
  provider: AiProvider,
  apiKey: ApiKey,
  model: ModelId.optional(),
  baseUrl: BaseUrl.optional(),
});
export const AiConnectInput = z.object({
  provider: AiProvider,
  apiKey: ApiKey,
  model: ModelId,
  baseUrl: BaseUrl.optional(),
});
export const AiModelsQuery = z.object({
  provider: AiProvider.optional(),
  apiKey: ApiKey.optional(),
  baseUrl: BaseUrl.optional(),
});
export const AiModelPatch = z.object({ model: ModelId });
export type ProviderMetaDTO = {
  id: AiProvider;
  label: string;
  keyUrl: string;
  docsUrl: string;
  capabilities: string;
  supportsModelList: boolean;
  requiresBaseUrl: boolean;
};
export type ConnectionDTO = {
  id: string;
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  keySuffix: string;
  status: string;
  verifiedAt: string | null;
  version: number;
  createdAt: string;
};
export type Analysis = {
  id: string;
  output: AnalysisOutput;
  policy_id: string;
  version_id: string;
  mode: string;
  model: string;
  created_at: string;
};
export type ContentRow = {
  id: string;
  author_id: string;
  author_name: string;
  type: string;
  text: string;
  visibility: string;
  revision: number;
  created_at: string;
  parent_id: string | null;
};
export type Decision = {
  id: string;
  case_id: string;
  actor_id: string;
  action: string;
  rationale: string;
  policy_id: string;
  created_at: string;
  clause_keys: string[];
  appeal_id?: string;
};
export type CaseRow = {
  id: string;
  content_id: string;
  version_id: string;
  policy_id: string;
  status: string;
  revision: number;
  assignee: string | null;
  text: string;
  author_id: string;
  author_name: string;
  type: string;
  created_at: string;
  policy_version: number;
  analysis: Analysis | null;
  isStale: boolean;
  severity: string;
};
export type CaseDetail = CaseRow & {
  policy: Policy;
  parent_text: string | null;
  reports: { id: string; reason: string; reporter_id: string }[];
  history: Decision[];
  analyses: Analysis[];
  decision: Decision | null;
  permittedActions: string[];
};
export type AppealRow = {
  id: string;
  decision_id: string;
  status: string;
  revision: number;
  assignee: string | null;
  reason: string;
  evidence: string;
  created_at: string;
  action: string;
  author_id: string;
  policy_id: string;
};
export type AppealDetail = AppealRow & {
  original: Decision;
  text: string;
  originalPolicy: Policy;
  currentPolicy: Policy;
  analysis: Analysis | null;
  resolution: {
    outcome: string;
    action: string;
    rationale: string;
    policy_id: string;
    created_at: string;
  } | null;
  permittedActions: string[];
};
export type Envelope<T> = {
  data: T;
  requestId: string;
  nextCursor?: string | null;
};
