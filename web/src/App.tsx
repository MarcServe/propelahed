import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import Dashboard from "./pages/Dashboard";
import Articles from "./pages/Articles";
import Evaluations from "./pages/Evaluations";
import Learning from "./pages/Learning";
import GateFailures from "./pages/GateFailures";
import ConfigEditor from "./pages/ConfigEditor";
import RunLoop from "./pages/RunLoop";
import Research from "./pages/Research";
import { EMPTY_LABEL } from "./formatDisplay";
import {
  IconArticles,
  IconChart,
  IconClipboard,
  IconFlame,
  IconHome,
  IconLightbulb,
  IconPen,
  IconSearchNotes,
  IconSettings,
} from "./navIcons";

type ClientRow = { client_id: string; filename: string };

type NavItemProps = { to: string; end?: boolean; icon: ReactNode; label: string };

function SidebarNav({ to, end, icon, label }: NavItemProps) {
  return (
    <NavLink end={end} className={({ isActive }) => `nav__link${isActive ? " nav__link--active" : ""}`} to={to}>
      <span className="nav__link-icon">{icon}</span>
      <span className="nav__link-text">{label}</span>
    </NavLink>
  );
}

export default function App() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data: ClientRow[]) => {
        setClients(data);
        setClientId((prev) => prev || (data[0]?.client_id ?? ""));
      })
      .catch(() =>
        setErr(
          "Could not connect to Content workspace. Start it from the project folder (see README), then refresh this page.",
        ),
      );
  }, []);

  return (
    <div className="layout layout--app">
      {err ? (
        <div className="banner error banner--app" role="alert">
          {err}
        </div>
      ) : null}
      <div className="shell-app">
        <aside className="sidebar" aria-label="Primary">
          <div className="sidebar-brand">
            <IconFlame />
            <span className="sidebar-brand__name">Content workspace</span>
          </div>
          <nav className="nav">
            <SidebarNav to="/" end icon={<IconHome />} label="Home" />
            <SidebarNav to="/research" icon={<IconSearchNotes />} label="Research notes" />
            <SidebarNav to="/articles" icon={<IconArticles />} label="Published articles" />
            <SidebarNav to="/evaluations" icon={<IconChart />} label="Quality scores" />
            <SidebarNav to="/learning" icon={<IconLightbulb />} label="What we learned" />
            <SidebarNav to="/gate-failures" icon={<IconClipboard />} label="Draft checks" />
            <SidebarNav to="/config" icon={<IconSettings />} label="Settings" />
            <SidebarNav to="/run" icon={<IconPen />} label="Write new article" />
          </nav>
        </aside>
        <div className="main-column">
          <header className="main-toolbar">
            <nav className="breadcrumb" aria-label="Location">
              <span className="breadcrumb__segment">Content workspace</span>
              <span className="breadcrumb__sep" aria-hidden>
                /
              </span>
              <span className="breadcrumb__segment breadcrumb__segment--emphasis">{clientId || EMPTY_LABEL}</span>
            </nav>
            <div className="main-toolbar__actions">
              <label className="client-select client-select--toolbar">
                <span className="client-select__label">Business / site</span>
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  disabled={!clients.length}
                  aria-label="Business or site workspace"
                >
                  {clients.map((c) => (
                    <option key={c.client_id} value={c.client_id}>
                      {c.client_id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="user-chip" title="Operator" aria-hidden>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
            </div>
          </header>
          <main className="main">
            {!clientId ? (
              <p className="prose-lead">
                No workspace is configured yet. Ask your technical contact to add a settings file under{" "}
                <code>seo_engine/config/</code> (see the project README).
              </p>
            ) : (
              <Routes>
                <Route path="/" element={<Dashboard clientId={clientId} />} />
                <Route path="/research" element={<Research clientId={clientId} />} />
                <Route path="/articles" element={<Articles clientId={clientId} />} />
                <Route path="/evaluations" element={<Evaluations clientId={clientId} />} />
                <Route path="/learning" element={<Learning clientId={clientId} />} />
                <Route path="/gate-failures" element={<GateFailures clientId={clientId} />} />
                <Route path="/config" element={<ConfigEditor clientId={clientId} />} />
                <Route path="/run" element={<RunLoop clientId={clientId} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
