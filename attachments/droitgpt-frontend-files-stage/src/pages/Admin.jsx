import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

export default function Admin() {
  const { accessToken, AUTH_BASE_URL, logout } = useAuth();

  const apiBase = useMemo(() => AUTH_BASE_URL || "https://droitgpt-indexer.onrender.com/auth", [AUTH_BASE_URL]);

  const [loading, setLoading] = useState(true);
  const [totalUsers, setTotalUsers] = useState(0);
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    }),
    [accessToken]
  );

  const fetchStatsAndUsers = async () => {
    setError("");
    setLoading(true);

    try {
      const [statsRes, usersRes] = await Promise.all([
        fetch(`${apiBase}/admin/stats`, { headers }),
        fetch(`${apiBase}/admin/users`, { headers }),
      ]);

      if (!statsRes.ok || !usersRes.ok) {
        const t1 = await statsRes.text().catch(() => "");
        const t2 = await usersRes.text().catch(() => "");
        throw new Error(t1 || t2 || "Impossible de charger les données admin.");
      }

      const stats = await statsRes.json();
      const list = await usersRes.json();

      setTotalUsers(stats?.totalUsers || 0);
      setUsers(Array.isArray(list?.users) ? list.users : []);
    } catch (e) {
      setError(e?.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatsAndUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter((u) => {
      const name = String(u.fullName || "").toLowerCase();
      const phone = String(u.phone || "").toLowerCase();
      return name.includes(s) || phone.includes(s);
    });
  }, [users, q]);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-5xl rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-white/10 bg-slate-950/60 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-emerald-300 font-semibold">
              ADMIN • DROITGPT
            </div>
            <h1 className="text-xl font-bold mt-1">Tableau de bord</h1>
            <p className="text-xs text-slate-300 mt-1">Gestion des comptes utilisateurs.</p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="px-3 py-1.5 rounded-full border border-slate-600/70 bg-slate-900/80 text-slate-200 hover:bg-slate-800 transition text-xs"
            >
              ⬅️ Accueil
            </Link>

            <button
              onClick={logout}
              className="px-3 py-1.5 rounded-full border border-rose-500/70 bg-slate-900/80 text-rose-200 hover:bg-rose-500/10 transition text-xs"
              title="Se déconnecter"
            >
              🚪 Déconnexion
            </button>
          </div>
        </div>

        <div className="px-6 py-5 border-b border-white/10 bg-slate-950/40">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Total comptes</div>
              <div className="text-3xl font-bold mt-1">{loading ? "…" : totalUsers}</div>
              <div className="text-[11px] text-slate-400 mt-1">Inscrits sur la plateforme</div>
            </div>

            <div className="md:col-span-2 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Utilisateurs</div>
                  <div className="text-sm text-slate-300">Recherche par nom ou numéro</div>
                </div>

                <div className="flex gap-2">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="w-full md:w-80 px-3 py-2 rounded-2xl bg-slate-950/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                    placeholder="Ex: Emmanuel ou +243…"
                  />
                  <button
                    onClick={fetchStatsAndUsers}
                    className="px-4 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition shadow-lg shadow-emerald-500/20"
                  >
                    Rafraîchir
                  </button>
                </div>
              </div>

              {error && (
                <div className="mt-3 text-xs text-rose-200 bg-rose-500/10 border border-rose-500/40 rounded-2xl px-3 py-2">
                  ❌ {error}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/70">
                <tr className="text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-300">NOMS</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-300">Téléphone</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-300">Rôle</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-300">Créé le</th>
                </tr>
              </thead>
              <tbody className="bg-slate-900/50">
                {loading ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-300" colSpan={4}>
                      Chargement…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-300" colSpan={4}>
                      Aucun utilisateur trouvé.
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u._id || u.id || `${u.phone}-${u.createdAt}`} className="border-t border-white/5">
                      <td className="px-4 py-3">{u.fullName || "-"}</td>
                      <td className="px-4 py-3">{u.phone || "-"}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-1 rounded-full text-[11px] border border-white/10 bg-slate-950/40">
                          {u.role || "user"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {u.createdAt ? new Date(u.createdAt).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-400">
            Astuce : si tu ne vois rien, assure-toi que ton compte a <strong>role=admin</strong> dans MongoDB, puis reconnecte-toi.
          </p>
        </div>
      </div>
    </div>
  );
}
