import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, listApi, clearSession, ApiError } from "../web/api.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearSession();
});

test("CSRF rejection permits a fresh session on the next explicit submission", async () => {
  let currentToken = "first-session";
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    if (url === "/api/v1/auth/csrf")
      return Response.json({ data: { csrf: currentToken }, requestId: "csrf" });
    writes++;
    const token = new Headers(init?.headers).get("X-CSRF-Token");
    if (token !== currentToken || writes === 1) {
      currentToken = "replacement-session";
      return Response.json(
        {
          error: { code: "CSRF", message: "Session verification failed" },
          requestId: "rejected",
        },
        { status: 403 },
      );
    }
    return Response.json({ data: { id: "saved" }, requestId: "saved" });
  };
  await assert.rejects(api("/contents", { text: "Draft" }), ApiError);
  assert.equal(writes, 1, "a rejected write must not be retried automatically");
  assert.deepEqual(await api("/contents", { text: "Draft" }), { id: "saved" });
});

for (const [name, request] of [
  ["detail", () => api("/contents/item")],
  ["list", () => listApi("/contents")],
] as const) {
  test(`${name} request rejects an HTML deployment fallback with a useful API error`, async () => {
    globalThis.fetch = async () =>
      new Response("<!doctype html><html>App</html>", { status: 200 });
    await assert.rejects(
      request(),
      (error: unknown) =>
        error instanceof ApiError &&
        /API|response|connection/i.test(error.message),
    );
  });
}
