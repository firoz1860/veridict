import type { SQL } from "./db.js";
import { one } from "./db.js";
import { decryptKey } from "./crypto.js";
import { ensure } from "./domain.js";
import type { ConnectionDTO, AiProvider } from "../shared/contracts.js";

// Row shape for ai_credentials. Secret material (ciphertext/nonce) stays on the
// server; it is never placed on a ConnectionDTO.
export type CredentialRow = {
  id: string;
  user_id: string;
  provider: string;
  model: string;
  base_url: string | null;
  ciphertext: string;
  nonce: string;
  key_suffix: string;
  status: string;
  verified_at: string | null;
  version: number;
  active: boolean;
  created_at: string;
  revoked_at: string | null;
};

// Safe metadata returned to the browser — never ciphertext, nonce or plaintext.
export const metadata = (row: CredentialRow): ConnectionDTO => ({
  id: row.id,
  provider: row.provider as AiProvider,
  model: row.model,
  baseUrl: row.base_url,
  keySuffix: row.key_suffix,
  status: row.status,
  verifiedAt: row.verified_at,
  version: row.version,
  createdAt: row.created_at,
});

// The caller's own currently-active credential, or undefined.
export const activeCredential = (q: SQL, userId: string) =>
  one<CredentialRow>(
    q,
    "SELECT * FROM ai_credentials WHERE user_id=$1 AND active=true ORDER BY version DESC LIMIT 1",
    [userId],
  );

// Resolve + decrypt a specific credential version for the worker at execution
// time, confirming it is still active and owned by the expected user. AAD
// binding means a wrong owner/version cannot decrypt. Returns plaintext key.
export async function resolveCredential(
  q: SQL,
  credentialId: string,
  version: number,
  userId: string,
): Promise<{
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string | null;
}> {
  const row = await one<CredentialRow>(
    q,
    "SELECT * FROM ai_credentials WHERE id=$1 AND user_id=$2 AND version=$3 AND active=true",
    [credentialId, userId, version],
  );
  ensure(
    row,
    409,
    "CREDENTIAL_UNAVAILABLE",
    "The connection is no longer active for this request",
  );
  const apiKey = decryptKey(row.ciphertext, row.nonce, {
    userId,
    credentialId,
    version,
  });
  return {
    provider: row.provider as AiProvider,
    apiKey,
    model: row.model,
    baseUrl: row.base_url,
  };
}
