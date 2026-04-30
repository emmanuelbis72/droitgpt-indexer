// src/components/Navbar.jsx
import React, { useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const items = useMemo(
    () => [
      { to: "/", label: "Accueil" },
      { to: "/chat", label: "Chatbot" },
      { to: "/analyse", label: "Analyse" },
      { to: "/bp", label: "Business Plan" },
      { to: "/memoire", label: "Mémoire" },
    ],
    []
  );

  // Close drawer on navigation
  React.useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const linkClass = ({ isActive }) =>
    [
      "rounded-lg px-3 py-2 text-sm font-medium transition",
      isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200",
    ].join(" ");

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-slate-900" />
          <div className="leading-tight">
            <div className="text-sm font-semibold">DroitGPT</div>
            <div className="text-xs text-slate-500">Droit congolais • IA</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} className={linkClass}>
              {it.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <NavLink to="/login" className={linkClass}>
            Connexion
          </NavLink>
          <NavLink to="/register" className={linkClass}>
            Inscription
          </NavLink>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 md:hidden"
          aria-label="Ouvrir le menu"
        >
          {open ? "Fermer" : "Menu"}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-white md:hidden">
          <div className="mx-auto w-full max-w-6xl px-4 py-3">
            <div className="flex flex-col gap-2">
              {items.map((it) => (
                <NavLink key={it.to} to={it.to} className={linkClass}>
                  {it.label}
                </NavLink>
              ))}
              <div className="h-px bg-slate-200" />
              <NavLink to="/login" className={linkClass}>
                Connexion
              </NavLink>
              <NavLink to="/register" className={linkClass}>
                Inscription
              </NavLink>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
