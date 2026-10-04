import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  ArrowRight,
  ArrowUpRight,
  Scale,
  BookOpen,
  FileText,
  PenLine,
  Gavel,
  Check,
  Menu,
  X,
  History,
  Plus,
} from "lucide-react";
import type { User } from "../../../shared/contracts";

/* The public product introduction. Expressive but truthful: every claim
   maps to behaviour the Veridict backend actually implements. */

function Reveal({
  children,
  className,
  from = "left",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  from?: "left" | "right";
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      data-reveal={from}
      initial={reduced ? false : { opacity: 0, x: from === "left" ? -32 : 32 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{
        duration: reduced ? 0 : 0.55,
        delay: reduced ? 0 : delay,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

const ANCHORS = [
  ["workflow", "Workflow"],
  ["roles", "Roles"],
  ["principles", "Principles"],
  ["faq", "FAQ"],
] as const;

const ROLES = [
  {
    key: "author",
    name: "Author",
    icon: PenLine,
    kicker: "Creates and defends content",
    points: [
      "Publishes posts and comments into one controlled community feed.",
      "Sees the review status and decision history of their own content.",
      "Can appeal a warn or remove decision once, with a written reason and optional evidence.",
      "Never sees private case evidence, reporter identities, or staff notes.",
    ],
  },
  {
    key: "moderator",
    name: "Moderator",
    icon: ShieldCheck,
    kicker: "Makes the human decision",
    points: [
      "Claims a case from the queue against an immutable content and policy snapshot.",
      "Reviews deterministic checks and AI findings with exact citations.",
      "Records allow, warn, or remove — or escalates the case back to the queue.",
      "Must confirm manual review when an assessment is stale or missing.",
    ],
  },
  {
    key: "reviewer",
    name: "Independent reviewer",
    icon: Scale,
    kicker: "Hears the appeal",
    points: [
      "Claims appeals they are eligible for — never their own prior decisions.",
      "Compares the original policy version against the current one.",
      "Upholds, overturns, or modifies the original outcome with a written rationale.",
      "Cannot be the original decision maker, the author, or a reporter on the case.",
    ],
  },
  {
    key: "admin",
    name: "Administrator",
    icon: BookOpen,
    kicker: "Stewards the policy",
    points: [
      "Drafts and edits policy clauses with severities and optional exact-match terms.",
      "Publishes a new immutable policy version when it is ready.",
      "Publication schedules re-evaluation of unresolved cases and open appeals.",
      "Prior decisions keep the exact policy version they were made under.",
    ],
  },
];

const PRINCIPLES = [
  {
    icon: Gavel,
    title: "Human approval before enforcement",
    body: "AI and deterministic checks are advisory. No automated path can remove content or decide an appeal. A person records every outcome.",
  },
  {
    icon: BookOpen,
    title: "Exact policy citations",
    body: "Each finding quotes the precise policy clause and the exact span of content it refers to. Unsupported citations fail the job instead of becoming a finding.",
  },
  {
    icon: History,
    title: "Preserved policy versions",
    body: "Published policies are immutable. Every decision is pinned to the version it was made under, so history is never silently rewritten.",
  },
  {
    icon: Scale,
    title: "Independent appeal review",
    body: "Appeals are heard by a reviewer who was not involved in the original decision and is not the author or a reporter on the case.",
  },
  {
    icon: FileText,
    title: "Recorded decision history",
    body: "Human actions and system events are written to an append-only audit trail. The application exposes no route to edit or delete that history.",
  },
];

const FAQ = [
  {
    q: "Does AI remove content automatically?",
    a: "No. Deterministic checks and the configured model produce advisory findings only. A human moderator records every allow, warn, or remove decision, and removal requires an explicit confirmation step.",
  },
  {
    q: "How do appeals work?",
    a: "An author can appeal a warn or remove decision once. The appeal is routed to an independent reviewer who was not the original decision maker, the author, or a reporter. They uphold, overturn, or modify the outcome with a written rationale.",
  },
  {
    q: "What happens when a policy changes?",
    a: "Publishing a new policy version schedules re-evaluation of unresolved cases and open appeals against the new version. Decisions that were already made keep the exact policy version they were decided under, and assessments pinned to an older version are flagged as stale.",
  },
  {
    q: "What is the difference between fixture and live AI mode?",
    a: "Fixture mode runs only the configured exact-text rules and labels its output as a deterministic demonstration — useful for repeatable testing, not a substitute for a model. Live mode calls a configured OpenAI-compatible endpoint; its outputs are schema-validated and every citation is checked against the pinned input.",
  },
  {
    q: "Which content formats are supported?",
    a: "Text only — posts and comments in a single controlled community. There are no file attachments, no email, and author registration is available. Staff accounts are provisioned privately.",
  },
];

function HeroVisual() {
  return (
    <svg
      viewBox="0 0 360 360"
      role="img"
      aria-label="Evidence nodes feeding a central human review decision, inside an independent appeal orbit"
    >
      <defs>
        <radialGradient id="vg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#45c0d2" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#45c0d2" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="180" cy="180" r="150" fill="url(#vg)" />
      <circle
        cx="180"
        cy="180"
        r="118"
        fill="none"
        stroke="#2b3237"
        strokeWidth="1"
      />
      <circle
        cx="180"
        cy="180"
        r="150"
        fill="none"
        stroke="#2b3237"
        strokeWidth="1"
        strokeDasharray="4 7"
      />
      {[
        [180, 62],
        [298, 180],
        [180, 298],
        [62, 180],
      ].map(([x, y], i) => (
        <g key={i}>
          <line
            x1="180"
            y1="180"
            x2={x}
            y2={y}
            stroke="#0f7481"
            strokeWidth="1.5"
          />
          <circle
            cx={x}
            cy={y}
            r="18"
            fill="#1c2226"
            stroke="#45c0d2"
            strokeWidth="1.5"
          />
        </g>
      ))}
      <circle cx="180" cy="180" r="34" fill="#0f7481" />
      <path
        d="M168 180l8 8 16-18"
        fill="none"
        stroke="#f2efe9"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StageFigure({ kind }: { kind: 1 | 2 | 3 }) {
  if (kind === 1)
    return (
      <svg
        viewBox="0 0 280 110"
        role="img"
        aria-label="Content, reports, and a pinned policy version entering a review"
      >
        {[
          ["Content", 10],
          ["Reports", 42],
          ["Policy v3", 74],
        ].map(([label, y], i) => (
          <g key={i}>
            <rect
              x="8"
              y={y as number}
              width="96"
              height="24"
              rx="5"
              fill="#f7f5f0"
              stroke="#e8e3d9"
            />
            <text
              x="18"
              y={(y as number) + 16}
              fontSize="11"
              fill="#565a60"
              fontFamily="Inter, sans-serif"
            >
              {label}
            </text>
            <line
              x1="104"
              y1={(y as number) + 12}
              x2="178"
              y2="55"
              stroke="#0f7481"
              strokeWidth="1.5"
            />
          </g>
        ))}
        <rect
          x="178"
          y="38"
          width="94"
          height="34"
          rx="7"
          fill="#e4f0f1"
          stroke="#bfdde1"
        />
        <text
          x="225"
          y="59"
          fontSize="11"
          fill="#0c5a64"
          textAnchor="middle"
          fontFamily="Inter, sans-serif"
        >
          Review
        </text>
      </svg>
    );
  if (kind === 2)
    return (
      <svg
        viewBox="0 0 280 110"
        role="img"
        aria-label="Deterministic checks and AI findings citing exact policy and content"
      >
        <rect
          x="8"
          y="10"
          width="120"
          height="40"
          rx="7"
          fill="#e4f0f1"
          stroke="#bfdde1"
        />
        <text
          x="20"
          y="28"
          fontSize="10.5"
          fill="#0c5a64"
          fontFamily="Inter, sans-serif"
        >
          Deterministic
        </text>
        <text
          x="20"
          y="42"
          fontSize="9"
          fill="#35656d"
          fontFamily="Inter, sans-serif"
        >
          exact match
        </text>
        <rect
          x="8"
          y="60"
          width="120"
          height="40"
          rx="7"
          fill="#e7f5f8"
          stroke="#bfdde1"
          strokeDasharray="4 4"
        />
        <text
          x="20"
          y="78"
          fontSize="10.5"
          fill="#0b6673"
          fontFamily="Inter, sans-serif"
        >
          AI finding
        </text>
        <text
          x="20"
          y="92"
          fontSize="9"
          fill="#35656d"
          fontFamily="Inter, sans-serif"
        >
          cited span
        </text>
        <line
          x1="128"
          y1="30"
          x2="188"
          y2="52"
          stroke="#0f7481"
          strokeWidth="1.5"
        />
        <line
          x1="128"
          y1="80"
          x2="188"
          y2="58"
          stroke="#45c0d2"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <rect
          x="190"
          y="38"
          width="82"
          height="34"
          rx="7"
          fill="#f7f5f0"
          stroke="#e8e3d9"
        />
        <text
          x="231"
          y="59"
          fontSize="10.5"
          fill="#565a60"
          textAnchor="middle"
          fontFamily="Inter, sans-serif"
        >
          Citations
        </text>
      </svg>
    );
  return (
    <svg
      viewBox="0 0 280 110"
      role="img"
      aria-label="A human decision, an author appeal, independent review, and retained history"
    >
      <rect x="8" y="40" width="78" height="30" rx="7" fill="#0f7481" />
      <text
        x="47"
        y="59"
        fontSize="10.5"
        fill="#f2efe9"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
      >
        Decision
      </text>
      <line
        x1="86"
        y1="55"
        x2="118"
        y2="55"
        stroke="#0f7481"
        strokeWidth="1.5"
      />
      <rect
        x="118"
        y="40"
        width="60"
        height="30"
        rx="7"
        fill="#f7f5f0"
        stroke="#e8e3d9"
      />
      <text
        x="148"
        y="59"
        fontSize="10"
        fill="#565a60"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
      >
        Appeal
      </text>
      <line
        x1="178"
        y1="55"
        x2="210"
        y2="55"
        stroke="#0f7481"
        strokeWidth="1.5"
      />
      <rect
        x="210"
        y="40"
        width="62"
        height="30"
        rx="7"
        fill="#e4f0f1"
        stroke="#bfdde1"
      />
      <text
        x="241"
        y="59"
        fontSize="10"
        fill="#0c5a64"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
      >
        Review
      </text>
      <rect
        x="118"
        y="84"
        width="154"
        height="20"
        rx="5"
        fill="none"
        stroke="#cfc8b8"
        strokeDasharray="3 4"
      />
      <text
        x="195"
        y="98"
        fontSize="9"
        fill="#696d73"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
      >
        retained history
      </text>
    </svg>
  );
}

export default function About({ user }: { user: User | null }) {
  const [solid, setSolid] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [role, setRole] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      toggleRef.current?.focus();
    };
  }, [drawer]);

  const workspaceHref = user
    ? user.role === "AUTHOR"
      ? "/content"
      : "/"
    : "/";
  const workspaceLabel = user ? "Open workspace" : "Open review workspace";

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      n = (i + 1) % ROLES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      n = (i - 1 + ROLES.length) % ROLES.length;
    else return;
    e.preventDefault();
    setRole(n);
    (tabsRef.current?.children[n] as HTMLElement)?.focus();
  };

  const active = ROLES[role];
  const ActiveIcon = active.icon;

  return (
    <div className="public">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className={solid ? "public-header solid" : "public-header"}>
        <Link to="/about" className="brand" aria-label="Veridict home">
          <ShieldCheck />
          Veridict<span>®</span>
        </Link>
        <nav className="public-nav" aria-label="Primary">
          <div className="anchors">
            {ANCHORS.map(([id, label]) => (
              <a key={id} href={"#" + id}>
                {label}
              </a>
            ))}
          </div>
          <Link className="button nav-cta" to={user ? workspaceHref : "/"}>
            {user ? workspaceLabel : "Sign in"}
            <ArrowUpRight size={16} />
          </Link>
          <button
            ref={toggleRef}
            className="nav-toggle"
            aria-expanded={drawer}
            aria-controls="public-drawer"
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
          >
            <Menu size={20} />
          </button>
        </nav>
      </header>

      <div
        id="public-drawer"
        className={drawer ? "public-drawer open" : "public-drawer"}
        aria-hidden={!drawer}
      >
        <div className="scrim" onClick={() => setDrawer(false)} />
        <div
          className="drawer-panel"
          role="dialog"
          aria-label="Menu"
          aria-modal="true"
        >
          <button
            className="drawer-close"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
          >
            <X />
          </button>
          {ANCHORS.map(([id, label]) => (
            <a
              key={id}
              href={"#" + id}
              onClick={() => setDrawer(false)}
              tabIndex={drawer ? 0 : -1}
            >
              {label}
            </a>
          ))}
          <Link
            to={user ? workspaceHref : "/"}
            onClick={() => setDrawer(false)}
            tabIndex={drawer ? 0 : -1}
          >
            {user ? workspaceLabel : "Sign in"}
          </Link>
        </div>
      </div>

      <main id="main">
        <section className="public-hero on-dark">
          <div className="dot-grid" aria-hidden="true" />
          <div className="hero-inner">
            <Reveal className="hero-copy" from="left">
              <span className="eyebrow">Trust &amp; safety, accountable</span>
              <h1>
                Context before <em>judgment.</em>
              </h1>
              <p>
                Veridict is a text moderation workspace where evidence is linked
                to exact policy, decisions are made by people, and every appeal
                gets an independent hearing. AI assists the review — it never
                enforces it.
              </p>
              <div className="hero-cta">
                <Link className="button" to={user ? workspaceHref : "/"}>
                  {workspaceLabel}
                  <ArrowRight size={18} />
                </Link>
                <a className="button ghost-dark" href="#workflow">
                  Explore the workflow
                </a>
              </div>
            </Reveal>
            <Reveal className="hero-visual" from="right" delay={0.1}>
              <HeroVisual />
              <span className="hero-visual-caption">
                Evidence → human review → accountable outcome
              </span>
            </Reveal>
          </div>
        </section>

        <section className="public-section" aria-labelledby="problem-h">
          <div className="section-head">
            <span className="eyebrow">Why moderation breaks down</span>
            <h2 id="problem-h">Three failures Veridict is built to prevent.</h2>
          </div>
          <div className="problem-grid">
            {[
              [
                "01",
                "Decisions without context",
                "Moderators act on a fragment — no reports, no parent thread, no exact clause. Veridict assembles the full, immutable picture before a decision is possible.",
              ],
              [
                "02",
                "Policies that drift silently",
                "When rules change, old decisions get quietly reinterpreted. Veridict keeps every published version and pins each decision to the one it was made under.",
              ],
              [
                "03",
                "Appeals without independence",
                "Appeals too often return to the person who decided. Veridict routes each appeal to an independent reviewer who had no part in the original case.",
              ],
            ].map(([num, title, body], i) => (
              <Reveal
                className="problem-item"
                key={num}
                from={i % 2 ? "right" : "left"}
                delay={i * 0.06}
              >
                <span className="num">{num}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <hr className="section-divider" />

        <section
          className="public-section"
          id="workflow"
          aria-labelledby="workflow-h"
        >
          <div className="section-head">
            <span className="eyebrow">How a review moves</span>
            <h2 id="workflow-h">
              Gather context, review evidence, decide and reconsider.
            </h2>
            <p>
              A single path from a flagged post to an accountable outcome. The
              diagrams below are illustrative, not live moderation results.
            </p>
          </div>
          <div className="workflow-stages">
            {[
              {
                n: 1,
                t: "Gather context",
                p: "Content, any reports, and the pinned policy version enter a review against an immutable snapshot.",
              },
              {
                n: 2,
                t: "Review evidence",
                p: "Deterministic checks and AI findings each cite the exact policy clause and the exact span of content.",
              },
              {
                n: 3,
                t: "Decide and reconsider",
                p: "A moderator records the decision. The author may appeal once; an independent reviewer resolves it. History is retained.",
              },
            ].map((s) => (
              <Reveal
                className="stage"
                key={s.n}
                from={s.n === 2 ? "right" : "left"}
                delay={(s.n - 1) * 0.06}
              >
                <span className="stage-no">{s.n}</span>
                <h3>{s.t}</h3>
                <p>{s.p}</p>
                <div className="stage-figure">
                  <StageFigure kind={s.n as 1 | 2 | 3} />
                </div>
              </Reveal>
            ))}
          </div>
          <div className="legend">
            <span>
              <span className="swatch human" /> Human action
            </span>
            <span>
              <span className="swatch ai" /> AI / automated recommendation
            </span>
          </div>
          <p className="illustrative">
            Illustrative diagram — not a live assessment
          </p>
        </section>

        <hr className="section-divider" />

        <section
          className="public-section"
          id="roles"
          aria-labelledby="roles-h"
        >
          <div className="section-head">
            <span className="eyebrow">Who does what</span>
            <h2 id="roles-h">Four roles, clear boundaries.</h2>
          </div>
          <div className="roles-layout">
            <div
              className="role-tabs"
              role="tablist"
              aria-label="Roles"
              ref={tabsRef}
            >
              {ROLES.map((r, i) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.key}
                    role="tab"
                    id={"roletab-" + r.key}
                    aria-selected={role === i}
                    aria-controls="role-panel"
                    tabIndex={role === i ? 0 : -1}
                    className="role-tab"
                    onClick={() => setRole(i)}
                    onKeyDown={(e) => onTabKey(e, i)}
                  >
                    <span className="role-icon">
                      <Icon size={19} />
                    </span>
                    <span>
                      <strong>{r.name}</strong>
                      <small>{r.kicker}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              className="role-panel"
              role="tabpanel"
              id="role-panel"
              aria-labelledby={"roletab-" + active.key}
              tabIndex={0}
            >
              <h3>
                <ActiveIcon
                  size={22}
                  style={{
                    verticalAlign: "-4px",
                    marginRight: 8,
                    color: "var(--accent)",
                  }}
                />
                {active.name}
              </h3>
              <p className="role-kicker">{active.kicker}</p>
              <ul>
                {active.points.map((pt, i) => (
                  <li key={i}>
                    <Check size={17} />
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <hr className="section-divider" />

        <section
          className="public-section"
          id="principles"
          aria-labelledby="principles-h"
        >
          <div className="section-head">
            <span className="eyebrow">What stays true</span>
            <h2 id="principles-h">Principles the system enforces.</h2>
          </div>
          <div className="principles-grid">
            {PRINCIPLES.map((p, i) => {
              const Icon = p.icon;
              return (
                <Reveal
                  className="principle"
                  key={p.title}
                  from={i % 2 ? "right" : "left"}
                >
                  <span className="p-icon">
                    <Icon size={20} />
                  </span>
                  <div>
                    <h3>{p.title}</h3>
                    <p>{p.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </section>

        <hr className="section-divider" />

        <section className="public-section" id="faq" aria-labelledby="faq-h">
          <div className="section-head">
            <span className="eyebrow">Questions</span>
            <h2 id="faq-h">Frequently asked.</h2>
          </div>
          <div className="faq-list">
            {FAQ.map((f) => (
              <details className="faq-item" key={f.q}>
                <summary>
                  {f.q}
                  <Plus className="chev" size={18} aria-hidden="true" />
                </summary>
                <p className="faq-answer">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="public-cta on-dark">
          <div className="dot-grid" aria-hidden="true" />
          <div className="public-section">
            <span className="eyebrow" style={{ color: "var(--cyan)" }}>
              Ready when you are
            </span>
            <h2>Judgment, with the evidence in hand.</h2>
            <p>
              Sign in to the review workspace. Author registration is open;
              staff accounts are provisioned privately.
            </p>
            <Link
              className="button"
              to={user ? workspaceHref : "/"}
              style={{ marginTop: 10 }}
            >
              {workspaceLabel}
              <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="public-footer">
        <div className="footer-inner">
          <div>
            <Link to="/about" className="brand">
              <ShieldCheck />
              Veridict<span>®</span>
            </Link>
            <p className="footer-about">
              A text moderation workspace with evidence-linked AI assistance,
              human decisions, independent appeals, immutable policy versions,
              and an audit trail.
            </p>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <a href="#workflow">Workflow</a>
            <a href="#roles">Roles</a>
            <a href="#principles">Principles</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="footer-col">
            <h4>Access</h4>
            <Link to="/">{user ? workspaceLabel : "Sign in"}</Link>
            <span>Author signup & demo</span>
            <span>Text posts &amp; comments</span>
          </div>
        </div>
        <div className="footer-bottom">
          <span>Veridict · Thoughtful moderation, accountable decisions.</span>
          <span>Human judgment. AI assisted.</span>
        </div>
      </footer>
    </div>
  );
}
