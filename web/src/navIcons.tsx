import type { ReactNode } from "react";

/** Minimal line icons for sidebar nav (24×24 viewBox). */

function IconBox({ children }: { children: ReactNode }) {
  return (
    <svg
      className="nav-icon-svg"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconHome() {
  return (
    <IconBox>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </IconBox>
  );
}

export function IconSearchNotes() {
  return (
    <IconBox>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </IconBox>
  );
}

export function IconArticles() {
  return (
    <IconBox>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="16" y2="11" />
    </IconBox>
  );
}

export function IconChart() {
  return (
    <IconBox>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </IconBox>
  );
}

export function IconLightbulb() {
  return (
    <IconBox>
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 13c0 2 1 3 2 4h8c1-1 2-2 2-4a7 7 0 0 0-4-13z" />
    </IconBox>
  );
}

export function IconClipboard() {
  return (
    <IconBox>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M9 14l2 2 4-4" />
    </IconBox>
  );
}

export function IconSettings() {
  return (
    <IconBox>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </IconBox>
  );
}

export function IconPen() {
  return (
    <IconBox>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </IconBox>
  );
}

export function IconFlame() {
  return (
    <svg
      className="sidebar-brand__flame"
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2c0 0 3 4 3 8a3 3 0 1 1-6 0c0-2 1-3.5 2-4.5C10 6 9 4.5 9 3c0 0-4 3-4 9a7 7 0 0 0 14 0c0-5-3-8.5-7-10z" opacity="0.9" />
      <path d="M12 11c-1.5 1.5-2 3-2 4.5a2 2 0 0 0 4 0c0-1.2-.6-2.6-2-4.5z" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}
