// SAVE AS: components/ui.jsx
// Presentational-only shared UI. NO "use client" here — these components
// render on the server and may be used from server components. Inline
// SVG icons only (no icon dependency); every icon is a 24x24 stroke
// glyph using currentColor.

const PATHS = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="17" cy="20" r="1.5" />
      <path d="M3 3h2l2.4 12.2a1.5 1.5 0 0 0 1.5 1.3h7.9a1.5 1.5 0 0 0 1.5-1.2L20.5 7H6" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" />
      <path d="M9 7.5h6M9 11h6M9 14.5h4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3.5 19.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 15c2.3.1 4 1.4 4.5 4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19.5c.8-3.5 3.6-5 7-5s6.2 1.5 7 5" />
    </>
  ),
  truck: (
    <>
      <path d="M2 6h11v10H2z" />
      <path d="M13 10h4l3 3v3h-7" />
      <circle cx="6.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a3 3 0 0 1 6 0" />
      <path d="M9 10h6M9 14h6M9 18h4" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M16 15h2" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-5M12 16V8M16 16v-3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 3.5 22 20H2z" />
      <path d="M12 9.5V14" />
      <path d="M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  package: (
    <>
      <path d="M12 3 4 7v10l8 4 8-4V7z" />
      <path d="M4 7l8 4 8-4" />
      <path d="M12 11v10" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3h10v5" />
      <rect x="4" y="8" width="16" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  cash: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </>
  ),
  return: (
    <>
      <path d="M8 5 4 9l4 4" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  logout: (
    <>
      <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h10" />
    </>
  ),
  flame: (
    <path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 1-3.5S9 10 10 10c0-3 2-7 2-7z" />
  ),
  table: (
    <>
      <path d="M3 8h18" />
      <path d="M5 8v12M19 8v12" />
      <path d="M3 12h18" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z" />
      <path d="M10 21a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h3v3h-3z" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="17" r="3" />
      <circle cx="18" cy="17" r="3" />
      <path d="M6 17 10 9h5l3 8" />
      <path d="M10 9 8.5 6H6" />
    </>
  ),
  bag: (
    <>
      <path d="M6 8h12l-1 12H7z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  phone: (
    <path d="M6 3h4l1.5 4.5L9 9.5a12 12 0 0 0 5.5 5.5l2-2.5L21 14v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z" />
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.3-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.7 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.5" />
    </>
  ),
};

// Alias: "food" renders the flame glyph.
PATHS.food = PATHS.flame;

export function Icon({ name = "info", className = "h-5 w-5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name] ?? PATHS.info}
    </svg>
  );
}

// Role labels for CLIENT components. Mirrors ROLE_LABELS in
// lib/session.js, which client components must never import (that module
// reads server-only headers/Prisma). Keep the two maps in sync.
export const ROLE_LABELS = {
  admin: "Admin",
  cashier: "Cashier",
  kitchen: "Kitchen",
  rider: "Rider",
};

export function roleTone(role) {
  switch (role) {
    case "admin":
      return "orange";
    case "cashier":
      return "blue";
    case "kitchen":
      return "amber";
    case "rider":
      return "green";
    default:
      return "slate";
  }
}

const BADGE_TONES = {
  green: "badge-green",
  emerald: "badge-emerald",
  amber: "badge-amber",
  red: "badge-red",
  slate: "badge-slate",
  blue: "badge-blue",
  orange: "badge-orange",
};

export function Badge({ tone = "slate", children }) {
  return (
    <span className={`badge ${BADGE_TONES[tone] ?? BADGE_TONES.slate}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function StatCard({ title, value, hint, icon, tone = "orange" }) {
  return (
    <article className="card card-pad flex min-w-0 items-start gap-3">
      {icon ? (
        <span className={`icon-chip icon-chip-${tone}`}>
          <Icon name={icon} />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-500">{title}</p>
        <p className="mt-0.5 text-xl font-bold break-words text-slate-900 sm:text-2xl">
          {value}
        </p>
        {hint ? <p className="mt-0.5 text-xs break-words text-slate-500">{hint}</p> : null}
      </div>
    </article>
  );
}

export function EmptyState({ icon = "info", title, description, action }) {
  return (
    <div className="card card-pad flex flex-col items-center py-10 text-center">
      <span className="icon-chip icon-chip-slate">
        <Icon name={icon} />
      </span>
      <h2 className="section-title mt-3">{title}</h2>
      {description ? (
        <p className="section-desc max-w-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
