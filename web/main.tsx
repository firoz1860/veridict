import React, {
  useState,
  useEffect,
  useRef,
  lazy,
  Suspense,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useNavigate,
  Link,
  useParams,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import {
  ShieldCheck,
  LayoutDashboard,
  ListFilter,
  Scale,
  BookOpen,
  History,
  Activity,
  LogOut,
  ArrowUpRight,
  Search,
  Plus,
  ChevronRight,
  Check,
  AlertTriangle,
  Menu,
  FileText,
  X,
  RefreshCw,
  MessageSquare,
  ArrowLeft,
  Eye,
  EyeOff,
  Cpu,
  UserCheck,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { api, useData, clearSession, listApi } from "./api";
import {
  SetupGate,
  AiConnectionSettings,
  useConnection,
  openSetup,
} from "./AiConnection";
import type {
  User,
  CaseRow,
  CaseDetail,
  AppealRow,
  AppealDetail,
  Policy,
  ContentRow,
  Decision,
  Analysis,
} from "../shared/contracts";
import "./styles.css";
// Lazy so the expressive public page is a separate chunk and does not
// inflate the authenticated workspace bundle.
const About = lazy(() => import("./pages/public/About"));
const Auth = createContext<{ user: User; logout: () => void }>(null!);
const fmt = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const human = (s: string) => s.toLowerCase().replaceAll("_", " ");
function Badge({ value }: { value: string }) {
  return <span className={"badge " + value.toLowerCase()}>{human(value)}</span>;
}
function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      <AlertTriangle size={17} />
      {message}
    </div>
  ) : null;
}
function Empty({ text = "Nothing here yet." }: { text?: string }) {
  return (
    <div className="empty">
      <ShieldCheck size={34} />
      <h3>All clear here</h3>
      <p>{text}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      Loading workspace…
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow || "TRUST & SAFETY"}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
function Button({
  children,
  onClick,
  disabled = false,
  kind = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={"button " + kind}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function ConfirmDialog({
  title,
  danger,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  danger?: boolean;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
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
        onCancel();
      } else if (e.key === "Tab") {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <h2 id="dialog-title">
          {danger && <AlertTriangle size={20} />}
          {title}
        </h2>
        {children}
        <div className="dialog-actions">
          <Button kind="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            kind={danger ? "danger" : ""}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="login">
      <section className="login-story">
        <div className="brand">
          <ShieldCheck /> Veridict<span>®</span>
        </div>
        <div className="story-center">
          <span className="pill">HUMAN JUDGMENT. AI ASSISTED.</span>
          <h1>
            Better decisions.
            <br />
            <em>Stronger communities.</em>
          </h1>
          <p>
            A thoughtful workspace for reviewing content, understanding context,
            and giving every appeal a fair hearing.
          </p>
          <div className="story-card">
            <ShieldCheck size={30} />
            <div>
              <strong>Accountability at every step</strong>
              <p>
                Evidence cited. Policies preserved.
                <br />
                People always in control.
              </p>
            </div>
          </div>
        </div>
        <small>Built for clarity. Designed for trust.</small>
      </section>
      <section className="login-form">
        <Link to="/about" className="login-top-link">
          About Veridict <ArrowUpRight size={15} />
        </Link>
        <div>
          <span className="eyebrow">YOUR REVIEW WORKSPACE</span>
          <h2>Welcome back.</h2>
          <p>Sign in to make your next decision count.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const r = await api<{ user: User }>("/auth/login", {
                  email,
                  password,
                });
                onLogin(r.user);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@veridict.local"
              />
            </label>
            <label>
              Password
              <div className="password-field">
                <input
                  type={show ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="reveal"
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <ErrorBox message={error} />
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in to workspace"}
              <ArrowUpRight size={18} />
            </Button>
          </form>
          <div className="login-note">
            <ShieldCheck size={16} /> Access is limited to invited team members.
          </div>
          <p className="login-about">
            New here? <Link to="/about">Learn how Veridict works →</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
function Shell({ user, logout }: { user: User; logout: () => void }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("veridict.sidebar.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const location = useLocation();
  const { conn } = useConnection();
  const staff = user.role !== "AUTHOR";
  const links = staff
    ? ([
        ["/", "Overview", LayoutDashboard],
        ["/queue", "Moderation queue", ListFilter],
        ["/appeals", "Appeals", Scale],
        ["/policies", "Policies", BookOpen],
        ["/audit", "Audit trail", History],
        ["/status", "Service status", Activity],
      ] as const)
    : ([
        ["/content", "My content", FileText],
        ["/community", "Community", MessageSquare],
        ["/appeals", "My appeals", Scale],
        ["/policies", "Policies", BookOpen],
      ] as const);
  // Index of the active nav item — drives the sliding indicator.
  const activeIndex = links.findIndex(([to]) =>
    to === "/"
      ? location.pathname === "/"
      : location.pathname === to || location.pathname.startsWith(to + "/"),
  );
  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("veridict.sidebar.collapsed", next ? "1" : "0");
      } catch {
        /* per-viewer convenience only */
      }
      return next;
    });
  }
  return (
    <Auth.Provider value={{ user, logout }}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SetupGate />
      <div className={"app-shell" + (collapsed ? " collapsed" : "")}>
        <div
          className={open ? "sidebar-scrim show" : "sidebar-scrim"}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        <aside id="app-sidebar" className={open ? "sidebar open" : "sidebar"}>
          <Link to="/" className="brand" title="Veridict">
            <ShieldCheck />
            <span className="brand-text">
              Veridict<span>®</span>
            </span>
          </Link>
          <div className="workspace-label">
            <span className="workspace-icon">V</span>
            <div className="nav-text">
              Community workspace<small>Trust & safety team</small>
            </div>
          </div>
          <div className="nav-label nav-text">WORKSPACE</div>
          <nav style={{ ["--active-index" as any]: activeIndex }}>
            <span
              className={"nav-indicator" + (activeIndex < 0 ? " hidden" : "")}
              aria-hidden="true"
            />
            {links.map(([to, label, Icon], i) => (
              <NavLink
                key={to}
                to={to}
                end
                title={label}
                onClick={() => setOpen(false)}
                style={{ animationDelay: `${i * 45}ms` }}
              >
                <Icon size={18} />
                <span className="nav-text">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="human-note">
              <ShieldCheck size={18} />
              <p className="nav-text">
                AI advises.
                <br />
                <strong>You decide.</strong>
              </p>
            </div>
            <div className="ai-connection-nav">
              {conn === null && (
                <button
                  type="button"
                  className="ai-connect-cta"
                  onClick={openSetup}
                  title="Connect AI provider"
                >
                  <Cpu size={17} />
                  <span className="nav-text">Connect AI provider</span>
                </button>
              )}
              <NavLink
                to="/settings"
                className="ai-settings-link"
                title="AI connection"
                onClick={() => setOpen(false)}
              >
                <Settings size={17} />
                <span className="nav-text">
                  AI connection
                  {conn ? (
                    <small
                      className="ai-dot connected"
                      aria-label="connected"
                    />
                  ) : null}
                </span>
              </NavLink>
            </div>
            <button
              type="button"
              className="collapse-toggle"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen size={17} />
              ) : (
                <PanelLeftClose size={17} />
              )}
              <span className="nav-text">Collapse</span>
            </button>
            <button className="user-account" onClick={logout} title="Sign out">
              <span className="avatar">
                {user.name
                  .split(" ")
                  .map((x) => x[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className="nav-text">
                {user.name}
                <small>{human(user.role)}</small>
              </span>
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={open}
              aria-controls="app-sidebar"
              onClick={() => setOpen(!open)}
            >
              <Menu />
            </button>
            <div className="breadcrumb">
              Workspace <ChevronRight size={14} />{" "}
              <strong>{staff ? "Moderation console" : "Author portal"}</strong>
            </div>
            <span className="topbar-right">
              <span className="dot" />{" "}
              <span className="label-text">Human-reviewed decisions</span>{" "}
              <span className="avatar small">{user.name[0]}</span>
            </span>
          </header>
          <main id="main">
            <Routes>
              <Route
                path="/about"
                element={
                  <Suspense fallback={<Loading />}>
                    <About user={user} />
                  </Suspense>
                }
              />
              <Route
                path="/"
                element={
                  staff ? <Overview /> : <Navigate to="/content" replace />
                }
              />
              <Route path="/queue" element={staff ? <Queue /> : <Denied />} />
              <Route
                path="/cases/:id"
                element={staff ? <CasePage /> : <Denied />}
              />
              <Route path="/appeals" element={<Appeals />} />
              <Route path="/appeals/:id" element={<AppealPage />} />
              <Route path="/policies" element={<Policies />} />
              <Route path="/audit" element={staff ? <Audit /> : <Denied />} />
              <Route path="/status" element={staff ? <Status /> : <Denied />} />
              <Route path="/content" element={<Content mine />} />
              <Route path="/community" element={<Content mine={false} />} />
              <Route path="/content/:id" element={<ContentDetail />} />
              <Route path="/settings" element={<AiConnectionSettings />} />
              <Route
                path="*"
                element={<Empty text="This page does not exist." />}
              />
            </Routes>
          </main>
          <footer>
            VERIDICT <span>Thoughtful moderation. Accountable decisions.</span>
          </footer>
        </div>
      </div>
    </Auth.Provider>
  );
}
function Denied() {
  return <ErrorBox message="Your role cannot access this page." />;
}
function Overview() {
  const { user } = useContext(Auth);
  const { data, error } = useData<{
    pending: number;
    appeals: number;
    stale: number;
    failed: number;
  }>("/dashboard", 10000);
  const cases = useData<CaseRow[]>("/cases", 10000);
  return (
    <>
      <Heading
        title={`Good to see you, ${user.name.split(" ")[0]}.`}
        description="A clear view of what needs your attention today."
      />
      <div className="overview-banner">
        <div>
          <span className="eyebrow">YOUR COMMUNITY, IN GOOD HANDS</span>
          <h2>Every decision starts with context.</h2>
          <p>Review the evidence. Hear the appeal. Keep the record.</p>
        </div>
        <div className="banner-symbol">
          <ShieldCheck size={66} />
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="stats">
        {[
          [
            "Awaiting review",
            data?.pending,
            "/queue",
            "Cases needing a human decision",
          ],
          [
            "Open appeals",
            data?.appeals,
            "/appeals",
            "A second perspective matters",
          ],
          [
            "Stale assessments",
            data?.stale,
            "/queue",
            "Policy or content has changed",
          ],
          ["Failed analyses", data?.failed, "/status", "Review service status"],
        ].map(([label, value, href, sub]) => (
          <Link className="stat" to={String(href)} key={label}>
            <div>
              {label}
              <ArrowUpRight size={17} />
            </div>
            <strong>{value ?? "—"}</strong>
            <small>{sub}</small>
          </Link>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent moderation cases</h2>
            <p>Evidence first. Your judgment next.</p>
          </div>
          <Link className="text-link" to="/queue">
            View queue <ArrowUpRight size={16} />
          </Link>
        </div>
        <ErrorBox message={cases.error} />
        {cases.data ? <CaseTable rows={cases.data.slice(0, 6)} /> : <Loading />}
      </section>
    </>
  );
}
function CaseTable({ rows }: { rows: CaseRow[] }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Content</th>
            <th>Assessment</th>
            <th>Severity</th>
            <th>Policy</th>
            <th>Received</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link className="case-title" to={"/cases/" + c.id}>
                  {c.text.slice(0, 75)}
                  {c.text.length > 75 ? "…" : ""}
                </Link>
                <small>
                  {human(c.type)} · {c.author_name}
                </small>
              </td>
              <td>
                <Badge value={c.status} />
                {c.isStale && c.analysis && (
                  <small className="warning-text">Stale evidence</small>
                )}
              </td>
              <td>
                <Badge value={c.severity} />
              </td>
              <td>v{c.policy_version}</td>
              <td className="muted nowrap">{fmt(c.created_at)}</td>
              <td>
                <Link to={"/cases/" + c.id} aria-label={"Open case " + c.id}>
                  <ArrowUpRight size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text="No cases match this view." />
  );
}
function Queue() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<CaseRow[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const status = params.get("status") || "",
    q = params.get("q") || "";
  useEffect(() => {
    let active = true;
    setLoading(true);
    const t = setTimeout(
      () =>
        listApi<CaseRow>("/cases?" + params)
          .then((r) => {
            if (active) {
              setRows(r.data);
              setNext(r.nextCursor || null);
              setError("");
            }
          })
          .catch((e) => active && setError(e.message))
          .finally(() => active && setLoading(false)),
      200,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [params]);
  const change = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    value ? p.set(key, value) : p.delete(key);
    p.delete("cursor");
    setParams(p);
  };
  return (
    <>
      <Heading
        title="Moderation queue"
        description="Review content with the full picture, one case at a time."
      />
      <section className="panel">
        <div className="filters">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Search content"
              placeholder="Search content…"
              value={q}
              onChange={(e) => change("q", e.target.value)}
            />
          </label>
          <select
            aria-label="Filter case status"
            value={status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">All statuses</option>
            {[
              "PENDING_ANALYSIS",
              "ANALYZING",
              "READY_FOR_REVIEW",
              "ANALYSIS_FAILED",
              "DECIDED",
            ].map((s) => (
              <option key={s} value={s}>
                {human(s)}
              </option>
            ))}
          </select>
        </div>
        <ErrorBox message={error} />
        {loading ? <Loading /> : <CaseTable rows={rows} />}
        <div className="pagination">
          <small>Up to 50 cases per page</small>
          <div>
            {params.has("cursor") && (
              <Button
                kind="secondary"
                onClick={() => {
                  const p = new URLSearchParams(params);
                  p.delete("cursor");
                  setParams(p);
                }}
              >
                First page
              </Button>
            )}
            {next && (
              <Button
                kind="secondary"
                onClick={() => {
                  const p = new URLSearchParams(params);
                  p.set("cursor", next);
                  setParams(p);
                }}
              >
                Next page
              </Button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
function Findings({
  analysis,
  text,
  onSelect,
}: {
  analysis: Analysis | null;
  text: string;
  onSelect?: (a: number, b: number) => void;
}) {
  if (!analysis)
    return (
      <Empty text="No current assessment. A human can review manually if needed." />
    );
  return (
    <>
      <div className="analysis-summary">
        <div>
          <span className="eyebrow">
            {analysis.mode === "fixture"
              ? "FIXTURE · NOT LIVE AI"
              : "AI ASSISTED REVIEW"}
          </span>
          <Badge value={analysis.output.proposedAction} />
        </div>
        <p>{analysis.output.summary}</p>
        <small>
          Advisory only · {analysis.model} · {fmt(analysis.created_at)}
        </small>
      </div>
      {analysis.output.findings.length === 0 ? (
        <div className="notice">
          No violations identified in this assessment. A human decision is still
          required.
        </div>
      ) : (
        analysis.output.findings.map((f, i) => (
          <article
            className={
              "finding " +
              (f.source === "DETERMINISTIC" ? "src-deterministic" : "src-ai")
            }
            key={i}
          >
            <div className="finding-top">
              <strong>{f.clauseKey}</strong>
              <Badge value={f.severity} />
            </div>
            <div className="finding-meta">
              <span
                className={
                  "source-tag " + (f.source === "DETERMINISTIC" ? "det" : "ai")
                }
              >
                {f.source === "DETERMINISTIC" ? (
                  <>
                    <Check size={11} /> Deterministic check
                  </>
                ) : (
                  <>
                    <Cpu size={11} /> AI interpretation
                  </>
                )}
              </span>
              ·{" "}
              {f.certainty === "SUPPORTED"
                ? "Supported evidence"
                : "Uncertain interpretation"}
            </div>
            <blockquote>{f.policyQuote}</blockquote>
            <button
              className="evidence-quote"
              onClick={() => onSelect?.(f.start, f.end)}
              disabled={!onSelect}
            >
              “{text.slice(f.start, f.end)}” <ArrowUpRight size={13} />
            </button>
            <p>{f.interpretation}</p>
            <small>
              {f.source === "DETERMINISTIC"
                ? "Exact match confidence"
                : "Model estimate"}
              : {Math.round(f.confidence * 100)}% · Human judgment required
            </small>
          </article>
        ))
      )}
    </>
  );
}
function CasePage() {
  const { id } = useParams();
  const { data: c, error, reload } = useData<CaseDetail>("/cases/" + id, 4000);
  const [range, setRange] = useState<[number, number] | null>(null),
    [action, setAction] = useState("ALLOW"),
    [disposition, setDisposition] = useState("MODIFY"),
    [rationale, setRationale] = useState(""),
    [keys, setKeys] = useState<string[]>([]),
    [manual, setManual] = useState(false),
    [confirmRemove, setConfirmRemove] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  async function act(path: string, body: unknown) {
    setBusy(true);
    setFailure("");
    try {
      await api(path, body);
      reload();
    } catch (e) {
      setFailure((e as Error).message);
      reload();
    } finally {
      setBusy(false);
    }
  }
  if (!c) return error ? <ErrorBox message={error} /> : <Loading />;
  const selected = range && range[1] <= c.text.length ? range : null;
  const recordDecision = () =>
    act(`/cases/${id}/decisions`, {
      expectedRevision: c.revision,
      action,
      disposition,
      rationale,
      clauseKeys: keys,
      manualReview: manual,
    });
  return (
    <>
      <Link className="back-link" to="/queue">
        <ArrowLeft size={16} /> Back to queue
      </Link>
      <Heading
        eyebrow={"CASE " + c.id.slice(0, 8).toUpperCase()}
        title="Review with context."
        description={`Policy v${c.policy_version} · ${c.author_name} · ${fmt(c.created_at)}`}
      >
        <Badge value={c.status} />
      </Heading>
      <ErrorBox message={error || failure} />
      {c.isStale && c.analysis && (
        <div className="notice warning">
          This assessment is stale. Current policy/content must be reviewed
          before a decision.
        </div>
      )}
      <div className="review-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Content & context</h2>
            <Badge value={c.type} />
          </div>
          <div className="panel-body">
            <div className="author-line">
              <span className="avatar">{c.author_name[0]}</span>
              <div>
                <strong>{c.author_name}</strong>
                <small>Immutable review snapshot</small>
              </div>
            </div>
            <div className="content-text">
              {selected ? (
                <>
                  {c.text.slice(0, selected[0])}
                  <mark>{c.text.slice(...selected)}</mark>
                  {c.text.slice(selected[1])}
                </>
              ) : (
                c.text
              )}
            </div>
            {c.parent_text && (
              <>
                <h3>Parent post snapshot</h3>
                <p className="content-text">{c.parent_text}</p>
              </>
            )}
            <h3>
              Reports <span className="count">{c.reports.length}</span>
            </h3>
            {c.reports.length ? (
              c.reports.map((r) => (
                <div className="report" key={r.id}>
                  <small>Unverified allegation</small>
                  <p>{r.reason}</p>
                </div>
              ))
            ) : (
              <p className="muted">No user reports.</p>
            )}
            <details>
              <summary>
                Previous moderation history ({c.history.length})
              </summary>
              {c.history.map((d) => (
                <div className="history-item" key={d.id}>
                  <Badge value={d.action} />
                  <p>{d.rationale}</p>
                  <small>{fmt(d.created_at)}</small>
                </div>
              ))}
            </details>
            <details>
              <summary>Policy v{c.policy_version}</summary>
              {c.policy.clauses.map((p) => (
                <div className="history-item" key={p.key}>
                  <strong>{p.key}</strong>
                  <p>{p.text}</p>
                </div>
              ))}
            </details>
            <details>
              <summary>Assessment history ({c.analyses.length})</summary>
              {c.analyses.map((a) => (
                <div className="history-item" key={a.id}>
                  <small>
                    {fmt(a.created_at)} · {a.mode}
                  </small>
                  <p>{a.output.summary}</p>
                  <code>{a.policy_id}</code>
                </div>
              ))}
            </details>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Evidence & findings</h2>
            <ShieldCheck size={19} />
          </div>
          <div className="panel-body">
            <Findings
              analysis={c.analysis}
              text={c.text}
              onSelect={(a, b) => setRange([a, b])}
            />
          </div>
        </section>
        <section className="panel decision-panel">
          <div className="panel-heading">
            <h2>Your decision</h2>
            <Scale size={19} />
          </div>
          <div className="panel-body">
            {c.decision ? (
              <>
                <Badge value={c.decision.action} />
                <p>{c.decision.rationale}</p>
                <small>Recorded {fmt(c.decision.created_at)}</small>
              </>
            ) : (
              <>
                <p className="muted">AI advises. You make the final call.</p>
                {c.permittedActions.includes("CLAIM") && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(`/cases/${id}/claim`, {
                        expectedRevision: c.revision,
                      })
                    }
                  >
                    Claim case
                  </Button>
                )}
                {c.permittedActions.includes("DECIDE") ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (action === "REMOVE") {
                        setConfirmRemove(true);
                        return;
                      }
                      recordDecision();
                    }}
                  >
                    <label>
                      Review response
                      <select
                        value={disposition}
                        onChange={(e) => {
                          setDisposition(e.target.value);
                          if (
                            e.target.value === "APPROVE" &&
                            c.analysis &&
                            c.analysis.output.proposedAction !== "ESCALATE"
                          )
                            setAction(c.analysis.output.proposedAction);
                          if (e.target.value === "REJECT") setAction("ALLOW");
                        }}
                      >
                        <option value="MODIFY">Choose / modify action</option>
                        <option
                          value="APPROVE"
                          disabled={
                            !c.analysis ||
                            c.analysis.output.proposedAction === "ESCALATE"
                          }
                        >
                          Approve recommendation
                        </option>
                        <option value="REJECT">Reject finding</option>
                      </select>
                    </label>
                    <label>
                      Resulting action
                      <select
                        value={action}
                        onChange={(e) => setAction(e.target.value)}
                        disabled={
                          disposition === "REJECT" || disposition === "APPROVE"
                        }
                      >
                        {["ALLOW", "WARN", "REMOVE"].map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                    </label>
                    <fieldset>
                      <legend>Supporting policy clauses</legend>
                      {c.policy.clauses.map((p) => (
                        <label className="checkbox" key={p.key}>
                          <input
                            type="checkbox"
                            checked={keys.includes(p.key)}
                            onChange={(e) =>
                              setKeys(
                                e.target.checked
                                  ? [...keys, p.key]
                                  : keys.filter((k) => k !== p.key),
                              )
                            }
                          />
                          {p.key}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      Decision rationale
                      <textarea
                        required
                        minLength={10}
                        maxLength={3000}
                        rows={5}
                        value={rationale}
                        onChange={(e) => setRationale(e.target.value)}
                        placeholder="Explain the evidence and your reasoning…"
                      />
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={manual}
                        onChange={(e) => setManual(e.target.checked)}
                      />
                      I reviewed the current policy and content manually.
                    </label>
                    <Button
                      type="submit"
                      disabled={
                        busy ||
                        (!manual &&
                          (c.isStale || c.status !== "READY_FOR_REVIEW"))
                      }
                      kind={action === "REMOVE" ? "danger" : ""}
                    >
                      {busy ? "Saving…" : "Record decision"}
                    </Button>
                    <Button
                      kind="secondary"
                      disabled={
                        busy ||
                        ["ANALYZING", "PENDING_ANALYSIS"].includes(c.status)
                      }
                      onClick={() =>
                        act(`/cases/${id}/analyze`, {
                          expectedRevision: c.revision,
                        })
                      }
                    >
                      <RefreshCw size={15} /> Re-run analysis
                    </Button>
                    <Button
                      kind="text"
                      disabled={busy || rationale.length < 10}
                      onClick={() =>
                        act(`/cases/${id}/escalate`, {
                          expectedRevision: c.revision,
                          reason: rationale,
                        })
                      }
                    >
                      Escalate to queue
                    </Button>
                  </form>
                ) : (
                  !c.permittedActions.includes("CLAIM") && (
                    <div className="notice">
                      This case is assigned to another moderator or your role
                      cannot decide it.
                    </div>
                  )
                )}
              </>
            )}
          </div>
        </section>
      </div>
      {confirmRemove && (
        <ConfirmDialog
          title="Remove this content?"
          danger
          confirmLabel="Remove content"
          busy={busy}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            recordDecision();
          }}
        >
          <p>
            This removes the content from the community feed. It will show in
            the author’s history and they can appeal once.
          </p>
          <div className="dialog-ref">
            {human(c.type)} · {c.author_name} — “{c.text.slice(0, 120)}
            {c.text.length > 120 ? "…" : ""}”
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
function Appeals() {
  const { data, error } = useData<AppealRow[]>("/appeals", 6000);
  return (
    <>
      <Heading
        title="A fair second look."
        eyebrow="APPEALS"
        description="Original decisions, new context, and independent human review."
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Appeals queue</h2>
          <Scale size={19} />
        </div>
        <ErrorBox message={error} />
        {!data ? (
          <Loading />
        ) : !data.length ? (
          <Empty text="Appeals will appear here when an author requests a review." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Appeal</th>
                  <th>Original action</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link className="case-title" to={"/appeals/" + a.id}>
                        {a.reason.slice(0, 90)}
                      </Link>
                      <small>#{a.id.slice(0, 8)}</small>
                    </td>
                    <td>
                      <Badge value={a.action} />
                    </td>
                    <td>
                      <Badge value={a.status} />
                    </td>
                    <td>{fmt(a.created_at)}</td>
                    <td>
                      <Link to={"/appeals/" + a.id}>
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
function AppealPage() {
  const { id } = useParams(),
    { user } = useContext(Auth);
  const {
    data: a,
    error,
    reload,
  } = useData<AppealDetail>("/appeals/" + id, 4000);
  const [outcome, setOutcome] = useState("UPHELD"),
    [action, setAction] = useState("WARN"),
    [rationale, setRationale] = useState(""),
    [basis, setBasis] = useState("current"),
    [manual, setManual] = useState(false),
    [confirmResolve, setConfirmResolve] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  async function submit(path: string, b: unknown) {
    setBusy(true);
    try {
      await api(path, b);
      setFailure("");
      reload();
    } catch (e) {
      setFailure((e as Error).message);
      reload();
    } finally {
      setBusy(false);
    }
  }
  if (!a) return error ? <ErrorBox message={error} /> : <Loading />;
  const finalAction =
    outcome === "UPHELD"
      ? a.original.action
      : outcome === "OVERTURNED"
        ? "ALLOW"
        : action;
  const resolveAppeal = () =>
    submit(`/appeals/${id}/resolve`, {
      expectedRevision: a.revision,
      outcome,
      action: finalAction,
      rationale,
      policyId: basis === "current" ? a.currentPolicy.id : a.originalPolicy.id,
      manualReview: manual,
    });
  return (
    <>
      <Link className="back-link" to="/appeals">
        <ArrowLeft size={16} /> Appeals
      </Link>
      <Heading
        title="Every perspective matters."
        eyebrow={"APPEAL " + a.id.slice(0, 8)}
        description={"Submitted " + fmt(a.created_at)}
      >
        <Badge value={a.status} />
      </Heading>
      <ErrorBox message={error || failure} />
      {a.currentPolicy.id !== a.originalPolicy.id && (
        <div className="notice warning">
          Policy changed from v{a.originalPolicy.version} to v
          {a.currentPolicy.version}. Review both before finalizing.
        </div>
      )}
      <div className="two-columns">
        <section className="panel">
          <div className="panel-heading">
            <h2>Original decision</h2>
            <Badge value={a.original.action} />
          </div>
          <div className="panel-body">
            <div className="content-text">{a.text}</div>
            <h3>Moderator rationale</h3>
            <p>{a.original.rationale}</p>
            <h3>Original policy · v{a.originalPolicy.version}</h3>
            {a.originalPolicy.clauses.map((c) => (
              <div className="clause" key={c.key}>
                <strong>{c.key}</strong>
                <p>{c.text}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Author’s perspective</h2>
            <MessageSquare size={18} />
          </div>
          <div className="panel-body">
            <h3>Appeal reason</h3>
            <p className="content-text">{a.reason}</p>
            <h3>Additional evidence</h3>
            <p className="content-text">
              {a.evidence || "No additional evidence supplied."}
            </p>
            {user.role !== "AUTHOR" && (
              <>
                <h3>Current assessment</h3>
                {a.analysisJob && a.analysisJob.status !== "SUCCEEDED" && (
                  <div className="notice" role="status">
                    Latest analysis: {a.analysisJob.status.toLowerCase()}.
                    {a.analysisJob.error && " " + a.analysisJob.error}
                    {a.analysis &&
                      " The assessment below is from an earlier run."}
                  </div>
                )}
                <Findings analysis={a.analysis} text={a.text} />
                {a.permittedActions.includes("ANALYZE") && (
                  <Button
                    kind="secondary"
                    disabled={
                      busy ||
                      ["QUEUED", "RUNNING"].includes(
                        a.analysisJob?.status || "",
                      )
                    }
                    onClick={() =>
                      submit(`/appeals/${id}/analyze`, {
                        expectedRevision: a.revision,
                      })
                    }
                  >
                    Re-run appeal analysis
                  </Button>
                )}
                <details>
                  <summary>Current policy · v{a.currentPolicy.version}</summary>
                  {a.currentPolicy.clauses.map((c) => (
                    <div className="clause" key={c.key}>
                      <strong>{c.key}</strong>
                      <p>{c.text}</p>
                    </div>
                  ))}
                </details>
              </>
            )}
          </div>
        </section>
      </div>
      <section className="panel resolution">
        <div className="panel-heading">
          <h2>Independent review</h2>
          <Scale size={19} />
        </div>
        <div className="panel-body">
          {a.resolution ? (
            <>
              <Badge value={a.resolution.outcome} />
              <h3>Final action: {a.resolution.action}</h3>
              {!a.resolution.visibility_applied && (
                <p className="notice">
                  This outcome applies to the appealed decision. Content
                  visibility remains governed by a newer review.
                </p>
              )}
              <p>{a.resolution.rationale}</p>
              <small>
                Resolved {fmt(a.resolution.created_at)} · Policy{" "}
                {a.resolution.policy_id === a.originalPolicy.id
                  ? "v" + a.originalPolicy.version
                  : "v" + a.currentPolicy.version}
              </small>
            </>
          ) : (
            <>
              {a.permittedActions.includes("CLAIM") && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    submit(`/appeals/${id}/claim`, {
                      expectedRevision: a.revision,
                    })
                  }
                >
                  Claim independent review
                </Button>
              )}
              {a.permittedActions.includes("RESOLVE") ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setConfirmResolve(true);
                  }}
                >
                  <div className="form-row">
                    <label>
                      Outcome
                      <select
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                      >
                        {["UPHELD", "OVERTURNED", "MODIFIED"].map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Resulting action
                      <select
                        disabled={outcome !== "MODIFIED"}
                        value={
                          outcome === "UPHELD"
                            ? a.original.action
                            : outcome === "OVERTURNED"
                              ? "ALLOW"
                              : action
                        }
                        onChange={(e) => setAction(e.target.value)}
                      >
                        {["ALLOW", "WARN", "REMOVE"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Policy basis
                      <select
                        value={basis}
                        onChange={(e) => setBasis(e.target.value)}
                      >
                        <option value="current">
                          Current · v{a.currentPolicy.version}
                        </option>
                        <option value="original">
                          Original · v{a.originalPolicy.version}
                        </option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Reasoning, including policy basis
                    <textarea
                      required
                      minLength={10}
                      maxLength={3000}
                      rows={3}
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                    />
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={manual}
                      onChange={(e) => setManual(e.target.checked)}
                    />
                    I have manually reviewed the current and original policy
                    evidence.
                  </label>
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      (!manual &&
                        (!a.analysis ||
                          (!!a.analysisJob &&
                            a.analysisJob.status !== "SUCCEEDED")))
                    }
                  >
                    Record final outcome
                  </Button>
                </form>
              ) : (
                !a.permittedActions.includes("CLAIM") && (
                  <p className="muted">
                    Awaiting an eligible independent reviewer. No automatic
                    appeal decisions.
                  </p>
                )
              )}
            </>
          )}
        </div>
      </section>
      {confirmResolve && (
        <ConfirmDialog
          title="Record this appeal outcome?"
          danger={finalAction === "REMOVE"}
          confirmLabel="Record outcome"
          busy={busy}
          onCancel={() => setConfirmResolve(false)}
          onConfirm={() => {
            setConfirmResolve(false);
            resolveAppeal();
          }}
        >
          <p>
            This records the final outcome of the appealed decision. It updates
            content visibility only when no newer review exists. It cannot be
            edited afterward.
          </p>
          <div className="dialog-ref">
            Outcome: <strong>{outcome}</strong> · Resulting action:{" "}
            <strong>{finalAction}</strong> · Policy basis{" "}
            {basis === "current"
              ? "v" + a.currentPolicy.version
              : "v" + a.originalPolicy.version}
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
function Content({ mine }: { mine: boolean }) {
  const { data, error, reload } = useData<ContentRow[]>(
    "/contents?mine=" + mine,
  );
  const [text, setText] = useState(""),
    [parent, setParent] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  return (
    <>
      <Heading
        title={mine ? "Your voice, your content." : "Community conversations."}
        eyebrow="AUTHOR PORTAL"
        description={
          mine
            ? "Create content and follow its review history."
            : "Read posts and flag concerns for human review."
        }
      />
      <ErrorBox message={error || failure} />
      {mine && (
        <section className="panel composer">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/contents", {
                  text,
                  type: parent ? "COMMENT" : "POST",
                  parentId: parent || null,
                });
                setText("");
                setParent("");
                setFailure("");
                reload();
              } catch (e) {
                setFailure((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Start a conversation</h2>
            <label>
              Content
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                minLength={1}
                maxLength={5000}
                required
                rows={3}
                placeholder="What would you like to share?"
              />
            </label>
            <div className="form-row">
              <label>
                Post type
                <select
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                >
                  <option value="">New post</option>
                  {data
                    ?.filter(
                      (c) => c.type === "POST" && c.visibility === "VISIBLE",
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        Reply: {c.text.slice(0, 50)}
                      </option>
                    ))}
                </select>
              </label>
              <Button type="submit" disabled={busy || !text.trim()}>
                <Plus size={16} />
                {busy ? "Publishing…" : "Publish content"}
              </Button>
            </div>
            <small>{text.length}/5000 characters</small>
          </form>
        </section>
      )}
      <div className="content-grid">
        {data?.map((c) => (
          <Link
            className="panel content-card"
            to={"/content/" + c.id}
            key={c.id}
          >
            <div className="content-card-top">
              <span className="avatar">{c.author_name[0]}</span>
              <div>
                <strong>{c.author_name}</strong>
                <small>
                  {fmt(c.created_at)} · {human(c.type)}
                </small>
              </div>
              <Badge value={c.visibility} />
            </div>
            <p>{c.text}</p>
            <span className="text-link">
              View content & history <ArrowUpRight size={16} />
            </span>
          </Link>
        ))}
      </div>
      {!data ? (
        <Loading />
      ) : (
        !data.length && <Empty text="Published content will appear here." />
      )}
    </>
  );
}
function ContentDetail() {
  const { id } = useParams(),
    { user } = useContext(Auth);
  const {
    data: c,
    error,
    reload,
  } = useData<ContentRow & { history: Decision[] }>("/contents/" + id);
  const [appealFor, setAppealFor] = useState(""),
    [reason, setReason] = useState(""),
    [evidence, setEvidence] = useState(""),
    [edit, setEdit] = useState(false),
    [text, setText] = useState(""),
    [report, setReport] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  const navigate = useNavigate();
  async function submit(path: string, body: unknown, appeal = false) {
    setBusy(true);
    try {
      const r = await api<{ id: string }>(path, body);
      setFailure("");
      setAppealFor("");
      setEdit(false);
      setReport(false);
      if (appeal) navigate("/appeals/" + r.id);
      else reload();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!c) return error ? <ErrorBox message={error} /> : <Loading />;
  return (
    <>
      <Link className="back-link" to="/content">
        <ArrowLeft size={16} /> Content
      </Link>
      <Heading
        title="Content & review history"
        description={c.author_name + " · " + fmt(c.created_at)}
      >
        <Badge value={c.visibility} />
      </Heading>
      <ErrorBox message={error || failure} />
      <section className="panel">
        <div className="panel-body">
          <p className="content-text">{c.text}</p>
          {c.author_id === user.id ? (
            <Button
              kind="secondary"
              onClick={() => {
                setEdit(!edit);
                setText(c.text);
              }}
            >
              Edit content
            </Button>
          ) : (
            <Button kind="secondary" onClick={() => setReport(!report)}>
              Report a concern
            </Button>
          )}
          {edit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(`/contents/${id}/versions`, {
                  text,
                  expectedRevision: c.revision,
                });
              }}
            >
              <label>
                New content version
                <textarea
                  required
                  value={text}
                  maxLength={5000}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                Save new version
              </Button>
            </form>
          )}
          {report && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(`/contents/${id}/reports`, { reason });
              }}
            >
              <label>
                Reason for report
                <textarea
                  required
                  minLength={10}
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                Send report
              </Button>
            </form>
          )}
        </div>
      </section>
      <h2 className="section-title">Decision history</h2>
      {c.history.map((d) => (
        <section className="panel history-card" key={d.id}>
          <Badge value={d.action} />
          <small>{fmt(d.created_at)}</small>
          <p>{d.rationale}</p>
          <small>
            Policy {d.policy_id.slice(0, 8)} ·{" "}
            {d.clause_keys.join(", ") || "No violation clauses"}
          </small>
          {d.appeal_id ? (
            <Link className="text-link" to={"/appeals/" + d.appeal_id}>
              View appeal <ArrowUpRight size={15} />
            </Link>
          ) : (
            ["WARN", "REMOVE"].includes(d.action) &&
            c.author_id === user.id && (
              <Button kind="secondary" onClick={() => setAppealFor(d.id)}>
                Appeal decision
              </Button>
            )
          )}
          {appealFor === d.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(
                  `/decisions/${d.id}/appeals`,
                  { reason, evidence },
                  true,
                );
              }}
            >
              <label>
                Why should this be reconsidered?
                <textarea
                  required
                  minLength={10}
                  maxLength={3000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                Additional evidence (optional)
                <textarea
                  maxLength={5000}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                Submit appeal
              </Button>
            </form>
          )}
        </section>
      ))}
      {!c.history.length && (
        <Empty text="No human decision has been recorded yet." />
      )}
    </>
  );
}
function Policies() {
  const { user } = useContext(Auth);
  const { data, error, reload } = useData<Policy[]>("/policies");
  const drafts = useData<(Policy & { revision: number })[]>(
    user.role === "ADMIN" ? "/policy-drafts" : "/policies",
  );
  const [selected, setSelected] = useState(""),
    [editor, setEditor] = useState(false),
    [title, setTitle] = useState(""),
    [clauses, setClauses] = useState<Policy["clauses"]>([]),
    [draftId, setDraftId] = useState(""),
    [draftRevision, setDraftRevision] = useState(1),
    [confirmPublish, setConfirmPublish] = useState(false),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);
  const p = data?.find((p) => p.id === selected) || data?.[0];
  function edit(d?: Policy & { revision?: number }) {
    setEditor(true);
    setTitle(d?.title || "Community safety policy");
    setClauses(
      d?.clauses || [{ key: "RULE_1", text: "", severity: "MEDIUM", term: "" }],
    );
    setDraftId(d?.revision ? d.id : "");
    setDraftRevision(d?.revision || 1);
  }
  async function persist() {
    const result = await api<{ id: string; revision: number }>(
      draftId ? "/policies/drafts/" + draftId : "/policies/drafts",
      {
        title,
        clauses,
        ...(draftId ? { expectedRevision: draftRevision } : {}),
      },
      draftId ? "PATCH" : "POST",
    );
    setDraftId(result.id);
    setDraftRevision(result.revision);
    drafts.reload();
    return result;
  }
  async function save() {
    setBusy(true);
    try {
      await persist();
      setFailure("");
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setBusy(true);
    try {
      // Save the current edits first so publication never discards them,
      // then publish against the revision the server just confirmed.
      const saved = await persist();
      await api(`/policies/drafts/${saved.id}/publish`, {
        expectedRevision: saved.revision,
      });
      setEditor(false);
      setDraftId("");
      setFailure("");
      reload();
      drafts.reload();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Clear rules. Preserved context."
        eyebrow="POLICIES"
        description="Published versions are immutable. Every decision keeps its policy."
      />
      {user.role === "ADMIN" && (
        <Button onClick={() => edit(p)}>
          <Plus size={16} />
          Create policy draft
        </Button>
      )}
      <ErrorBox message={error || failure} />
      <div className="policy-layout">
        <section className="panel version-list">
          <h3>Published versions</h3>
          {data?.map((v) => (
            <button
              key={v.id}
              className={p?.id === v.id ? "selected" : ""}
              onClick={() => setSelected(v.id)}
            >
              <BookOpen size={18} />
              <div>
                <strong>Version {v.version}</strong>
                <small>{fmt(v.created_at)}</small>
              </div>
              {p?.id === v.id && <Check size={16} />}
            </button>
          ))}
          {user.role === "ADMIN" && (
            <>
              <h3>Drafts</h3>
              {drafts.data?.map((d) => (
                <button key={d.id} onClick={() => edit(d)}>
                  <FileText size={18} />
                  {d.title}
                </button>
              ))}
            </>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>{p?.title || "Policy"}</h2>
            {p && <Badge value={"VERSION " + p.version} />}
          </div>
          <div className="panel-body">
            {p?.clauses.map((c) => (
              <div className="clause" key={c.key}>
                <div className="finding-top">
                  <strong>{c.key}</strong>
                  <Badge value={c.severity} />
                </div>
                <p>{c.text}</p>
                {c.term && <small>Deterministic text match: {c.term}</small>}
              </div>
            ))}
          </div>
        </section>
      </div>
      {editor && (
        <section className="panel policy-editor">
          <div className="panel-heading">
            <h2>Policy draft</h2>
            <button
              className="icon-button"
              aria-label="Close draft editor"
              onClick={() => setEditor(false)}
            >
              <X />
            </button>
          </div>
          <div className="panel-body">
            <label>
              Policy title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
            </label>
            {clauses.map((c, i) => (
              <div className="clause-editor" key={i}>
                <div className="form-row">
                  <label>
                    Clause key
                    <input
                      value={c.key}
                      onChange={(e) =>
                        setClauses(
                          clauses.map((v, n) =>
                            n === i ? { ...v, key: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Severity
                    <select
                      value={c.severity}
                      onChange={(e) =>
                        setClauses(
                          clauses.map((v, n) =>
                            n === i
                              ? {
                                  ...v,
                                  severity: e.target.value as typeof c.severity,
                                }
                              : v,
                          ),
                        )
                      }
                    >
                      {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Rule text
                  <textarea
                    value={c.text}
                    onChange={(e) =>
                      setClauses(
                        clauses.map((v, n) =>
                          n === i ? { ...v, text: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Optional exact-match term
                  <input
                    value={c.term}
                    onChange={(e) =>
                      setClauses(
                        clauses.map((v, n) =>
                          n === i ? { ...v, term: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  kind="text"
                  onClick={() => setClauses(clauses.filter((_, n) => n !== i))}
                >
                  Remove clause
                </Button>
              </div>
            ))}
            <div className="actions">
              <Button
                kind="secondary"
                onClick={() =>
                  setClauses([
                    ...clauses,
                    {
                      key: "RULE_" + (clauses.length + 1),
                      text: "",
                      severity: "MEDIUM",
                      term: "",
                    },
                  ])
                }
              >
                Add clause
              </Button>
              <Button disabled={busy} onClick={save}>
                Save draft
              </Button>
              {draftId && (
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() => setConfirmPublish(true)}
                >
                  Save &amp; publish
                </Button>
              )}
            </div>
          </div>
        </section>
      )}
      {confirmPublish && (
        <ConfirmDialog
          title="Save and publish this policy?"
          confirmLabel="Publish new version"
          busy={busy}
          onCancel={() => setConfirmPublish(false)}
          onConfirm={() => {
            setConfirmPublish(false);
            publish();
          }}
        >
          <p>
            Your current edits are saved first, then published as a new
            immutable version. Unresolved cases and open appeals are scheduled
            for re-evaluation against it. Decisions already made keep their
            original policy version.
          </p>
          <div className="dialog-ref">
            “{title}” · {clauses.length} clause{clauses.length === 1 ? "" : "s"}
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
function Audit() {
  const [cursor, setCursor] = useState(""),
    [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    listApi<any>("/audit" + (cursor ? "?cursor=" + cursor : ""))
      .then((r) => {
        setRows(r.data);
        setNext(r.nextCursor || null);
      })
      .catch((e) => setError(e.message));
  }, [cursor]);
  return (
    <>
      <Heading
        title="Nothing lost between decisions."
        eyebrow="AUDIT TRAIL"
        description="An append-only record of human actions and system events."
      />
      <ErrorBox message={error} />
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Actor</th>
                <th>Time</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{human(r.action)}</strong>
                    <small>{r.resource_id.slice(0, 8)}</small>
                  </td>
                  <td>{r.actor || "System"}</td>
                  <td>{fmt(r.created_at)}</td>
                  <td>
                    <details>
                      <summary>Inspect event</summary>
                      <pre>{JSON.stringify(r.detail, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <Button
            kind="secondary"
            disabled={!cursor}
            onClick={() => setCursor("")}
          >
            First page
          </Button>
          <Button
            kind="secondary"
            disabled={!next}
            onClick={() => setCursor(next!)}
          >
            Next page
          </Button>
        </div>
      </section>
    </>
  );
}
function Status() {
  const { data, error } = useData<{
    aiMode: string;
    aiConfigured: boolean;
    workerHealthy: boolean;
    heartbeat: string;
    jobs: { status: string; count: number }[];
  }>("/status", 5000);
  return (
    <>
      <Heading
        title="A transparent operating picture."
        eyebrow="SERVICE STATUS"
        description="No silent fallbacks. Know exactly how reviews are running."
      />
      <ErrorBox message={error} />
      {data ? (
        <>
          <div className="stats">
            <div className="stat">
              <div>AI mode</div>
              <strong className="status-value">{data.aiMode}</strong>
              <small>
                {data.aiMode === "fixture"
                  ? "Deterministic demonstration; not live AI"
                  : data.aiConfigured
                    ? "Provider configured — not a verified live request"
                    : "Provider credentials missing"}
              </small>
            </div>
            <div className="stat">
              <div>Worker</div>
              <strong className="status-value">
                {data.workerHealthy ? "Healthy" : "Unavailable"}
              </strong>
              <small>
                {data.heartbeat
                  ? "Last heartbeat " + fmt(data.heartbeat)
                  : "No heartbeat received"}
              </small>
            </div>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>Background jobs</h2>
            </div>
            <div className="panel-body">
              {data.jobs.map((j) => (
                <div className="status-row" key={j.status}>
                  <Badge value={j.status} />
                  <strong>{j.count}</strong>
                </div>
              ))}
              {!data.jobs.length && (
                <Empty text="No jobs have been scheduled." />
              )}
            </div>
          </section>
        </>
      ) : (
        <Loading />
      )}
    </>
  );
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false);
  useEffect(() => {
    api<User>("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setReady(true));
    const expired = () => {
      setUser(null);
      clearSession();
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function logout() {
    try {
      await api("/auth/logout", {});
    } finally {
      setUser(null);
      clearSession();
      window.history.replaceState(null, "", "/");
    }
  }
  if (!ready) return <Loading />;
  if (user) return <Shell user={user} logout={logout} />;
  return (
    <Routes>
      <Route
        path="/about"
        element={
          <Suspense fallback={<Loading />}>
            <About user={null} />
          </Suspense>
        }
      />
      <Route
        path="*"
        element={
          <Login
            onLogin={(u) => {
              setUser(u);
              window.history.replaceState(null, "", "/");
            }}
          />
        }
      />
    </Routes>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
