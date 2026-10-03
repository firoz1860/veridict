import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import type { SQL } from "./db.js";
import { one } from "./db.js";
const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString("hex");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return (
    salt + ":" + ((await derive(password, salt, 64)) as Buffer).toString("hex")
  );
}
export async function checkPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  const computed = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return (
    expected.length === computed.length && timingSafeEqual(expected, computed)
  );
}
export async function newSession(q: SQL, userId: string | null) {
  const raw = token(),
    csrf = token();
  await q.query(
    "INSERT INTO sessions(token,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
    [hash(raw), userId, csrf],
  );
  return { raw, csrf };
}
export async function throttle(
  q: SQL,
  key: string,
  max: number,
  seconds: number,
) {
  const r = await one(
    q,
    `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+($2||' seconds')::interval) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING count`,
    [key, String(seconds)],
  );
  return r!.count <= max;
}
