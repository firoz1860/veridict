import { useEffect, useState, useCallback } from "react";
import type { Envelope } from "../shared/contracts";
let csrf = "";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  key?: string,
): Promise<T> {
  if (method !== "GET" && !csrf) {
    const r = await fetch("/api/v1/auth/csrf", { credentials: "include" });
    if (!r.ok) throw new ApiError(r.status, "Could not establish a session");
    csrf = (await r.json()).data.csrf;
  }
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET"
        ? {
            "X-CSRF-Token": csrf,
            "Idempotency-Key": key || crypto.randomUUID(),
          }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const b = await r
    .json()
    .catch(() => ({
      error: {
        message: "The API is unreachable. Check the deployment connection.",
      },
    }));
  if (!r.ok) {
    if (r.status === 401 && path !== "/auth/login")
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      r.status,
      b.error?.message || "Request failed",
      b.requestId,
    );
  }
  if (b.data?.csrf) csrf = b.data.csrf;
  return b.data as T;
}
export function clearSession() {
  csrf = "";
}
export async function listApi<T>(path: string): Promise<Envelope<T[]>> {
  const r = await fetch("/api/v1" + path, { credentials: "include" });
  const b = await r.json();
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      r.status,
      b.error?.message || "Request failed",
      b.requestId,
    );
  }
  return b;
}
export function useData<T>(path: string, poll = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = () =>
      api<T>(path)
        .then((d) => {
          if (active) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    load();
    const interval = poll
      ? setInterval(() => {
          if (document.visibilityState === "visible") load();
        }, poll)
      : null;
    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [path, tick, poll]);
  return { data, error, loading, reload };
}
