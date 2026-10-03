import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  Cpu,
  Eye,
  EyeOff,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  X,
  RefreshCw,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import type { ProviderMetaDTO, ConnectionDTO } from "../shared/contracts";

type VerifyResult = {
  ok: boolean;
  models?: string[];
  error?: { code: string; message: string };
};

const CONNECTION_EVENT = "ai-connection-changed";
export const notifyConnectionChanged = () =>
  window.dispatchEvent(new Event(CONNECTION_EVENT));

const dismissKey = "veridict.ai.setup.dismissed";
export function wasDismissed(): boolean {
  try {
    return sessionStorage.getItem(dismissKey) === "1";
  } catch {
    return false;
  }
}
function markDismissed() {
  try {
    sessionStorage.setItem(dismissKey, "1");
  } catch {
    /* storage may be unavailable; non-fatal */
  }
}

// Fetches the caller's own connection metadata; reloads on the shared event so
// the setup gate, the sidebar action and the settings view stay in sync.
export function useConnection() {
  const [conn, setConn] = useState<ConnectionDTO | null | undefined>(undefined);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<ConnectionDTO | null>("/ai/connection")
      .then((c) => {
        setConn(c);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener(CONNECTION_EVENT, on);
    return () => window.removeEventListener(CONNECTION_EVENT, on);
  }, [load]);
  return { conn, error, reload: load };
}

// Accessible modal shell: focus trap, Escape, scroll lock and focus restore.
function Modal({
  title,
  onClose,
  children,
  labelId = "ai-modal-title",
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  labelId?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), textarea, select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        );
        if (!nodes || !nodes.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        ref={panelRef}
        style={{ maxWidth: 520 }}
      >
        <h2 id={labelId} style={{ justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Cpu size={20} />
            {title}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </h2>
        {children}
      </div>
    </div>
  );
}

// Shared provider/key/verify/model editor used by both the first-login modal
// and the settings "replace key" flow.
function ConnectionEditor({
  providers,
  onSaved,
  submitLabel,
  initialProvider,
}: {
  providers: ProviderMetaDTO[];
  onSaved: (c: ConnectionDTO) => void;
  submitLabel: string;
  initialProvider?: string;
}) {
  const [provider, setProvider] = useState(initialProvider || "openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [show, setShow] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [model, setModel] = useState("");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [switchTo, setSwitchTo] = useState<string | null>(null);

  const meta = providers.find((p) => p.id === provider);

  // Clear the plaintext key from state on unmount — never persisted or prefilled.
  useEffect(() => () => setApiKey(""), []);

  function resetVerification() {
    setVerified(false);
    setModels(null);
    setModel("");
    setError("");
  }

  function requestProvider(next: string) {
    if (next === provider) return;
    // Require explicit confirmation before switching providers if a key was
    // entered — the key is only ever sent to the explicitly selected provider.
    if (apiKey) {
      setSwitchTo(next);
      return;
    }
    setProvider(next);
    setBaseUrl("");
    resetVerification();
  }
  function confirmSwitch() {
    if (!switchTo) return;
    setProvider(switchTo);
    setApiKey("");
    setBaseUrl("");
    resetVerification();
    setSwitchTo(null);
  }

  async function verify() {
    setVerifying(true);
    setError("");
    try {
      const r = await api<VerifyResult>("/ai/connection/verify", {
        provider,
        apiKey,
        model: model || undefined,
        baseUrl: meta?.requiresBaseUrl ? baseUrl : undefined,
      });
      if (!r.ok) {
        setVerified(false);
        setError(r.error?.message || "Verification failed.");
        return;
      }
      setVerified(true);
      setModels(r.models || []);
      // Do not silently pick a model; leave selection to the user.
      if (r.models && r.models.length === 1) setModel(r.models[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  async function save() {
    if (!model) {
      setError("Select or enter a model first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api<ConnectionDTO>("/ai/connection", {
        provider,
        apiKey,
        model,
        baseUrl: meta?.requiresBaseUrl ? baseUrl : undefined,
      });
      setApiKey(""); // clear plaintext immediately after save
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = (models || []).filter((m) =>
    m.toLowerCase().includes(modelFilter.toLowerCase()),
  );

  return (
    <div className="ai-editor">
      <label>
        Provider
        <select
          value={provider}
          onChange={(e) => requestProvider(e.target.value)}
          disabled={busy}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {meta && <p className="ai-capabilities">{meta.capabilities}</p>}

      {switchTo && (
        <div className="notice warning" role="alert">
          Switching to{" "}
          <strong>{providers.find((p) => p.id === switchTo)?.label}</strong>{" "}
          will clear the entered key and verification. Keys are only ever sent to
          the provider you explicitly select.
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setSwitchTo(null)}
            >
              Keep current
            </button>
            <button type="button" className="button" onClick={confirmSwitch}>
              Switch provider
            </button>
          </div>
        </div>
      )}

      {meta?.requiresBaseUrl && (
        <label>
          Base URL (HTTPS, approved host)
          <input
            type="url"
            value={baseUrl}
            placeholder="https://your-approved-host/v1"
            onChange={(e) => {
              setBaseUrl(e.target.value);
              resetVerification();
            }}
            disabled={busy}
          />
        </label>
      )}

      <label>
        API key
        <div className="password-field">
          <input
            type={show ? "text" : "password"}
            value={apiKey}
            autoComplete="off"
            placeholder="Paste your provider API key"
            onChange={(e) => {
              setApiKey(e.target.value);
              resetVerification();
            }}
            disabled={busy}
          />
          <button
            type="button"
            className="reveal"
            aria-label={show ? "Hide API key" : "Show API key"}
            aria-pressed={show}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>

      {meta && meta.keyUrl ? (
        <a
          className="text-link"
          href={meta.keyUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Get an API key for {meta.label} <ExternalLink size={14} />
        </a>
      ) : (
        <span className="muted" style={{ fontSize: 13 }}>
          Enter the base URL and key for your approved endpoint.
        </span>
      )}
      <p className="muted" style={{ fontSize: 12.5 }}>
        API access and billing may differ from a consumer chat subscription.
      </p>

      <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
        <button
          type="button"
          className="button secondary"
          onClick={verify}
          disabled={!apiKey || verifying || busy || (meta?.requiresBaseUrl && !baseUrl)}
        >
          {verifying ? "Verifying…" : "Verify connection"}
        </button>
        {verified && (
          <span className="ai-verified">
            <CheckCircle2 size={16} /> Verified
          </span>
        )}
      </div>

      {verified && (
        <label>
          Model
          {models && models.length > 0 && (
            <>
              <input
                type="text"
                placeholder="Search models…"
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                aria-label="Search models"
              />
              <select
                value={filtered.includes(model) ? model : ""}
                onChange={(e) => setModel(e.target.value)}
                size={Math.min(6, Math.max(2, filtered.length))}
                style={{ marginTop: 8 }}
              >
                {filtered.slice(0, 200).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </>
          )}
          <input
            type="text"
            placeholder={
              models && models.length
                ? "…or enter a model ID manually"
                : "Enter a model ID"
            }
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model ID"
            style={{ marginTop: 8 }}
          />
          <small className="muted">
            A verified key does not guarantee a given model produces valid
            moderation output; the first analysis confirms compatibility.
          </small>
        </label>
      )}

      {error && (
        <div className="error" role="alert">
          <AlertTriangle size={17} />
          {error}
        </div>
      )}

      <div className="dialog-actions">
        <button
          type="button"
          className="button"
          onClick={save}
          disabled={!verified || !model || busy}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

function AiActionsNote() {
  return (
    <div className="notice">
      <ShieldCheck size={16} />
      <span>
        AI-assisted analysis and re-running an assessment use your connected
        provider. You can still open permitted screens and complete manual
        reviews without a key — nothing is auto-decided.
      </span>
    </div>
  );
}

// First-login setup modal. Shown over the workspace when no connection exists
// and the user has not dismissed it this browser session.
export function SetupModal({
  providers,
  onClose,
  onSaved,
}: {
  providers: ProviderMetaDTO[];
  onClose: () => void;
  onSaved: (c: ConnectionDTO) => void;
}) {
  return (
    <Modal title="Connect your AI provider" onClose={onClose}>
      <p>
        Bring your own AI provider key to enable AI-assisted moderation. Your key
        is encrypted on our server, never shown again, and only used for AI work
        you explicitly request.
      </p>
      <AiActionsNote />
      <ConnectionEditor
        providers={providers}
        submitLabel="Save and continue"
        onSaved={(c) => {
          notifyConnectionChanged();
          onSaved(c);
        }}
      />
      <div className="dialog-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="button text"
          onClick={() => {
            markDismissed();
            onClose();
          }}
        >
          Set up later
        </button>
      </div>
    </Modal>
  );
}

function ProviderLabel({
  providers,
  id,
}: {
  providers: ProviderMetaDTO[];
  id: string;
}) {
  return <>{providers.find((p) => p.id === id)?.label || id}</>;
}

// Settings view: manage the existing connection (reverify, change model,
// replace key, disconnect) or create one.
export function AiConnectionSettings() {
  const [providers, setProviders] = useState<ProviderMetaDTO[]>([]);
  const { conn, error, reload } = useConnection();
  const [replace, setReplace] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [opError, setOpError] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [newModel, setNewModel] = useState("");

  useEffect(() => {
    api<ProviderMetaDTO[]>("/ai/providers")
      .then(setProviders)
      .catch(() => {});
  }, []);

  async function reverify() {
    setBusy(true);
    setOpError("");
    setNotice("");
    try {
      const r = await api<VerifyResult>("/ai/connection/models");
      if (r.ok) {
        setModels(r.models || []);
        setNotice("Connection re-verified. Models refreshed.");
      } else {
        setOpError(r.error?.message || "Re-verification failed.");
      }
    } catch (e) {
      setOpError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeModel() {
    if (!newModel) return;
    setBusy(true);
    setOpError("");
    try {
      await api<ConnectionDTO>("/ai/connection", { model: newModel }, "PATCH");
      setNewModel("");
      setNotice("Model updated.");
      notifyConnectionChanged();
      reload();
    } catch (e) {
      setOpError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setOpError("");
    try {
      await api<{ ok: boolean }>("/ai/connection", {}, "DELETE");
      setConfirmDisconnect(false);
      setNotice("Disconnected. Secret material was removed.");
      notifyConnectionChanged();
      reload();
    } catch (e) {
      setOpError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACCOUNT</div>
          <h1>AI connection</h1>
          <p>
            Connect your own AI provider key for AI-assisted moderation. Manual
            review always works without a key.
          </p>
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          <AlertTriangle size={17} />
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}
      {opError && (
        <div className="error" role="alert">
          <AlertTriangle size={17} />
          {opError}
        </div>
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Current connection</h2>
            <p>Your key is encrypted at rest and never displayed again.</p>
          </div>
        </div>
        <div className="panel-body">
          {conn === undefined ? (
            <p className="muted">Loading…</p>
          ) : conn ? (
            <div className="ai-connection-card">
              <dl className="ai-meta">
                <div>
                  <dt>Provider</dt>
                  <dd>
                    <ProviderLabel providers={providers} id={conn.provider} />
                  </dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{conn.model}</dd>
                </div>
                <div>
                  <dt>API key</dt>
                  <dd>{conn.keySuffix}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={"badge " + conn.status.toLowerCase()}>
                      {conn.status.toLowerCase()}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Verified</dt>
                  <dd>
                    {conn.verifiedAt
                      ? new Date(conn.verifiedAt).toLocaleString()
                      : "—"}
                  </dd>
                </div>
                {conn.baseUrl && (
                  <div>
                    <dt>Base URL</dt>
                    <dd>{conn.baseUrl}</dd>
                  </div>
                )}
                <div>
                  <dt>Version</dt>
                  <dd>v{conn.version}</dd>
                </div>
              </dl>

              <div className="dialog-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={reverify}
                  disabled={busy}
                >
                  <RefreshCw size={16} /> Reverify
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setReplace((v) => !v)}
                  disabled={busy}
                >
                  {replace ? "Cancel replace" : "Replace key"}
                </button>
                <button
                  type="button"
                  className="button danger"
                  onClick={() => setConfirmDisconnect(true)}
                  disabled={busy}
                >
                  <Trash2 size={16} /> Disconnect
                </button>
              </div>

              <div className="ai-change-model">
                <label>
                  Change model
                  {models && models.length > 0 && (
                    <select
                      value={models.includes(newModel) ? newModel : ""}
                      onChange={(e) => setNewModel(e.target.value)}
                    >
                      <option value="">Select a model…</option>
                      {models.slice(0, 200).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="text"
                    placeholder="Enter a model ID"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    aria-label="New model ID"
                    style={{ marginTop: 8 }}
                  />
                </label>
                <button
                  type="button"
                  className="button secondary"
                  onClick={changeModel}
                  disabled={busy || !newModel}
                >
                  Update model
                </button>
                {!models && (
                  <small className="muted">
                    Use “Reverify” to load the available model list.
                  </small>
                )}
              </div>
            </div>
          ) : (
            <div className="ai-connection-empty">
              <AiActionsNote />
              <p className="muted">No AI provider is connected.</p>
            </div>
          )}
        </div>
      </section>

      {(replace || conn === null) && providers.length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{conn ? "Replace key" : "Connect a provider"}</h2>
              <p>
                {conn
                  ? "Saving creates a new credential version and revokes the previous one."
                  : "Verify and save to enable AI-assisted moderation."}
              </p>
            </div>
          </div>
          <div className="panel-body">
            <ConnectionEditor
              providers={providers}
              initialProvider={conn?.provider}
              submitLabel={conn ? "Save new key" : "Save and connect"}
              onSaved={() => {
                setReplace(false);
                setNotice(
                  conn
                    ? "Key replaced. A new version is active; the previous key was revoked."
                    : "Connected.",
                );
                notifyConnectionChanged();
                reload();
              }}
            />
          </div>
        </section>
      )}

      {confirmDisconnect && (
        <Modal
          title="Disconnect AI provider?"
          onClose={() => setConfirmDisconnect(false)}
          labelId="ai-disconnect-title"
        >
          <p>
            This removes the usable secret material and prevents queued jobs from
            starting with this credential. An analysis request already submitted
            to the provider may still finish — we cannot promise cancellation.
          </p>
          {opError && (
            <div className="error" role="alert">
              <AlertTriangle size={17} />
              {opError}
            </div>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirmDisconnect(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button danger"
              onClick={disconnect}
              disabled={busy}
            >
              {busy ? "Working…" : "Disconnect"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// Gate shown over the workspace after login. Auto-opens once per session when no
// connection exists; after dismissal it stays closed and the sidebar action
// reopens it on demand.
export function SetupGate() {
  const [providers, setProviders] = useState<ProviderMetaDTO[]>([]);
  const { conn } = useConnection();
  const [open, setOpen] = useState(false);
  const autoOpened = useRef(false);

  useEffect(() => {
    api<ProviderMetaDTO[]>("/ai/providers")
      .then(setProviders)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (conn === null && !wasDismissed() && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [conn]);

  useEffect(() => {
    const onReopen = () => setOpen(true);
    window.addEventListener("ai-open-setup", onReopen);
    return () => window.removeEventListener("ai-open-setup", onReopen);
  }, []);

  if (!open || !providers.length) return null;
  return (
    <SetupModal
      providers={providers}
      onClose={() => setOpen(false)}
      onSaved={() => setOpen(false)}
    />
  );
}

export const openSetup = () =>
  window.dispatchEvent(new Event("ai-open-setup"));
