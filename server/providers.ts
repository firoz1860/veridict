import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// ---------------------------------------------------------------------------
// Server-controlled provider registry.
//
// The browser never supplies endpoints, auth headers or key-management URLs;
// it only names a provider id. Everything operational lives here. Endpoints and
// key URLs were verified against official provider documentation (see the PR
// report for the exact sources and dates).
// ---------------------------------------------------------------------------

export type ProviderId =
  | "openai"
  | "anthropic"
  | "xai"
  | "gemini"
  | "openrouter"
  | "custom";

export type ProviderMeta = {
  id: ProviderId;
  label: string;
  keyUrl: string;
  docsUrl: string;
  capabilities: string;
  supportsModelList: boolean;
  requiresBaseUrl: boolean;
};

export const REGISTRY: Record<ProviderId, ProviderMeta & { baseUrl?: string }> =
  {
    openai: {
      id: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      keyUrl: "https://platform.openai.com/api-keys",
      docsUrl: "https://platform.openai.com/docs/api-reference/chat",
      capabilities:
        "Chat-completion text models (e.g. gpt-4o, gpt-4.1, o-series). Used for JSON moderation assessments. Image, audio and embedding models are not supported here.",
      supportsModelList: true,
      requiresBaseUrl: false,
    },
    anthropic: {
      id: "anthropic",
      label: "Anthropic Claude",
      baseUrl: "https://api.anthropic.com",
      keyUrl: "https://console.anthropic.com/settings/keys",
      docsUrl: "https://docs.anthropic.com/en/api/messages",
      capabilities:
        "Claude text models via the Messages API (e.g. claude-3-5-sonnet, claude-3-5-haiku). Returns JSON moderation assessments. Non-text capabilities are not supported here.",
      supportsModelList: true,
      requiresBaseUrl: false,
    },
    xai: {
      id: "xai",
      label: "xAI Grok",
      baseUrl: "https://api.x.ai/v1",
      keyUrl: "https://console.x.ai",
      docsUrl: "https://docs.x.ai/docs/api-reference",
      capabilities:
        "Grok text models via the OpenAI-compatible chat API (e.g. grok-3, grok-3-mini). Returns JSON moderation assessments.",
      supportsModelList: true,
      requiresBaseUrl: false,
    },
    gemini: {
      id: "gemini",
      label: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      keyUrl: "https://aistudio.google.com/apikey",
      docsUrl: "https://ai.google.dev/gemini-api/docs",
      capabilities:
        "Gemini text models via generateContent (e.g. gemini-1.5-pro, gemini-2.0-flash). Returns JSON moderation assessments. Access/billing differs from a consumer Gemini subscription.",
      supportsModelList: true,
      requiresBaseUrl: false,
    },
    openrouter: {
      id: "openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      keyUrl: "https://openrouter.ai/keys",
      docsUrl: "https://openrouter.ai/docs/api-reference/overview",
      capabilities:
        "A broad catalog of text models via an OpenAI-compatible API. Only text-generation models that return valid JSON moderation output are supported; model availability and pricing vary per model.",
      supportsModelList: true,
      requiresBaseUrl: false,
    },
    custom: {
      id: "custom",
      label: "Custom OpenAI-compatible",
      keyUrl: "",
      docsUrl: "https://platform.openai.com/docs/api-reference/chat",
      capabilities:
        "Any OpenAI-compatible chat endpoint on a server-approved host (HTTPS only). You must enter the base URL and a model id. Compatibility is validated with a bounded check; non-compatible endpoints are rejected.",
      supportsModelList: true,
      requiresBaseUrl: true,
    },
  };

export const publicRegistry = (): ProviderMeta[] =>
  (Object.keys(REGISTRY) as ProviderId[]).map((id) => {
    const { baseUrl: _omit, ...meta } = REGISTRY[id];
    return meta;
  });

export const isProvider = (v: unknown): v is ProviderId =>
  typeof v === "string" && v in REGISTRY;

// ---------------------------------------------------------------------------
// Error taxonomy — provider responses are sanitized into these stable codes so
// raw provider text (which may echo the key or internal detail) never leaks.
// ---------------------------------------------------------------------------
export type ErrorCode =
  | "INVALID_KEY"
  | "MODEL_UNAVAILABLE"
  | "UNSUPPORTED"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMIT"
  | "OUTAGE"
  | "TIMEOUT"
  | "INVALID_OUTPUT";

const MESSAGES: Record<ErrorCode, string> = {
  INVALID_KEY: "The API key was rejected as invalid or revoked.",
  MODEL_UNAVAILABLE: "The selected model is not available to this account.",
  UNSUPPORTED: "This model or capability is not supported for moderation.",
  INSUFFICIENT_CREDITS: "The account has insufficient credits or quota.",
  RATE_LIMIT: "The provider is rate limiting requests. Try again shortly.",
  OUTAGE: "The provider reported a temporary outage.",
  TIMEOUT: "The provider did not respond in time.",
  INVALID_OUTPUT: "The model did not return valid moderation output.",
};

export class ProviderError extends Error {
  constructor(public code: ErrorCode) {
    super(MESSAGES[code]);
  }
}

export const errorMessage = (code: ErrorCode) => MESSAGES[code];

function classify(status: number): ErrorCode {
  if (status === 401 || status === 403) return "INVALID_KEY";
  if (status === 402) return "INSUFFICIENT_CREDITS";
  if (status === 404) return "MODEL_UNAVAILABLE";
  if (status === 400 || status === 422) return "UNSUPPORTED";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "OUTAGE";
  return "OUTAGE";
}

function asProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
    return new ProviderError("TIMEOUT");
  return new ProviderError("OUTAGE");
}

// ---------------------------------------------------------------------------
// SSRF protection for Custom OpenAI-compatible base URLs.
// ---------------------------------------------------------------------------
const allowedHosts = (): Set<string> =>
  new Set(
    (process.env.AI_CUSTOM_ALLOWED_HOSTS || "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );

function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true; // 10.0.0.0/8
    if (p[0] === 127) return true; // loopback
    if (p[0] === 0) return true; // 0.0.0.0/8
    if (p[0] === 169 && p[1] === 254) return true; // link-local + metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true; // 192.168/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("::ffff:")) return isBlockedIp(lower.slice(7)); // mapped v4
    return false;
  }
  return false;
}

// Returns a normalized base URL (no trailing slash) or throws a ProviderError.
export async function validateCustomBaseUrl(
  raw: string,
  resolver: (host: string) => Promise<string[]> = async (h) =>
    (await lookup(h, { all: true })).map((a) => a.address),
): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError("UNSUPPORTED");
  }
  if (url.protocol !== "https:") throw new ProviderError("UNSUPPORTED");
  if (url.username || url.password) throw new ProviderError("UNSUPPORTED"); // userinfo
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    throw new ProviderError("UNSUPPORTED");
  // Literal IP hosts are checked directly.
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new ProviderError("UNSUPPORTED");
  }
  if (!allowedHosts().has(host)) throw new ProviderError("UNSUPPORTED");
  // Hostnames must resolve only to public addresses (DNS-rebinding defense).
  if (!isIP(host)) {
    let ips: string[];
    try {
      ips = await resolver(host);
    } catch {
      throw new ProviderError("OUTAGE");
    }
    if (!ips.length || ips.some(isBlockedIp))
      throw new ProviderError("UNSUPPORTED");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

const TIMEOUT = 15000;

async function resolveBase(
  provider: ProviderId,
  baseUrl?: string,
): Promise<string> {
  if (provider === "custom") {
    if (!baseUrl) throw new ProviderError("UNSUPPORTED");
    return validateCustomBaseUrl(baseUrl);
  }
  return REGISTRY[provider].baseUrl!;
}

// Reject redirects to keep a validated host from bouncing to a private one.
function guardRedirect(res: Response) {
  if (res.status >= 300 && res.status < 400) throw new ProviderError("OUTAGE");
}

// ---------------------------------------------------------------------------
// Model listing (non-generating credential check where possible).
// ---------------------------------------------------------------------------
export async function listModels(
  provider: ProviderId,
  apiKey: string,
  baseUrl?: string,
): Promise<string[]> {
  const base = await resolveBase(provider, baseUrl);
  try {
    if (provider === "gemini") {
      const res = await fetch(`${base}/models`, {
        headers: { "x-goog-api-key": apiKey },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT),
      });
      guardRedirect(res);
      if (!res.ok) throw new ProviderError(classify(res.status));
      const body = (await res.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[];
      };
      return (body.models || [])
        .filter(
          (m) =>
            !m.supportedGenerationMethods ||
            m.supportedGenerationMethods.includes("generateContent"),
        )
        .map((m) => (m.name || "").replace(/^models\//, ""))
        .filter(Boolean);
    }
    if (provider === "anthropic") {
      const res = await fetch(`${base}/v1/models`, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT),
      });
      guardRedirect(res);
      if (!res.ok) throw new ProviderError(classify(res.status));
      const body = (await res.json()) as { data?: { id: string }[] };
      return (body.data || []).map((m) => m.id);
    }
    // openai / xai / openrouter / custom are OpenAI-compatible: GET {base}/models
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    guardRedirect(res);
    if (!res.ok) throw new ProviderError(classify(res.status));
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data || []).map((m) => m.id).filter(Boolean);
  } catch (e) {
    throw asProviderError(e);
  }
}

// Non-generating verification. Returns the available model list when the
// provider supports listing; an empty array means verified-but-unlisted.
export async function verify(
  provider: ProviderId,
  apiKey: string,
  baseUrl?: string,
): Promise<string[]> {
  return listModels(provider, apiKey, baseUrl);
}

export type ChatMessage = { role: "system" | "user"; content: string };

// Provider-native chat call returning raw assistant text (expected JSON).
export async function chat(
  provider: ProviderId,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  baseUrl?: string,
  maxTokens = 3000,
): Promise<string> {
  const base = await resolveBase(provider, baseUrl);
  const system = messages.find((m) => m.role === "system")?.content || "";
  const user = messages.find((m) => m.role === "user")?.content || "";
  try {
    if (provider === "anthropic") {
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        redirect: "manual",
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      guardRedirect(res);
      if (!res.ok) throw new ProviderError(classify(res.status));
      const body = (await res.json()) as {
        stop_reason?: string;
        content?: { type: string; text?: string }[];
      };
      const text = (body.content || [])
        .filter((p) => p.type === "text")
        .map((p) => p.text || "")
        .join("");
      if (!text) throw new ProviderError("INVALID_OUTPUT");
      return text;
    }
    if (provider === "gemini") {
      const res = await fetch(
        `${base}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          redirect: "manual",
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: {
              responseMimeType: "application/json",
              maxOutputTokens: maxTokens,
            },
          }),
          signal: AbortSignal.timeout(25000),
        },
      );
      guardRedirect(res);
      if (!res.ok) throw new ProviderError(classify(res.status));
      const body = (await res.json()) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          finishReason?: string;
        }[];
      };
      const text = (body.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || "")
        .join("");
      if (!text) throw new ProviderError("INVALID_OUTPUT");
      return text;
    }
    // openai / xai / openrouter / custom — OpenAI-compatible chat completions.
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      redirect: "manual",
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(25000),
    });
    guardRedirect(res);
    if (!res.ok) throw new ProviderError(classify(res.status));
    const body = (await res.json()) as {
      choices?: { finish_reason?: string; message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError("INVALID_OUTPUT");
    return text;
  } catch (e) {
    throw asProviderError(e);
  }
}
