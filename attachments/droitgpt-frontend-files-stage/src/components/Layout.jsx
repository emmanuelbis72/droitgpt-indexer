// src/components/Layout.jsx
import React from "react";
import { Outlet } from "react-router-dom";
import Navbar from "./Navbar.jsx";

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 text-center text-xs text-slate-600">
          Développé par <span className="font-semibold">BISIMWA EMMANUEL</span> •{" "}
          <a className="underline hover:text-slate-900" href="tel:+243816307451">
            +243816307451
          </a>
          {" "}• ETS ROBOTECH
        </div>
      </footer>
    </div>
  );
}
