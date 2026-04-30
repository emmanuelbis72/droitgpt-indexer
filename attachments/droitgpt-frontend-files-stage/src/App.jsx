// src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Home from "./pages/Home.jsx";

import { AuthProvider } from "./auth/AuthContext.jsx";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import Layout from "./components/Layout.jsx";

// ✅ Admin (protégé par rôle)
import AdminRoute from "./auth/AdminRoute.jsx";
import Admin from "./pages/Admin.jsx";

// Pages / components
import ChatInterface from "./components/ChatInterface.jsx";
import Generate from "./components/Generate.jsx";
import Analyse from "./components/Analyse.jsx";
import AssistantVocal from "./components/AssistantVocal.jsx";

// Auth UI
import Login from "./components/Login.jsx";
import Register from "./components/Register.jsx";

// 🎓 Pages Académie
import Academie from "./pages/Academie.jsx";
import AcademieProgramme from "./pages/AcademieProgramme.jsx";
import AcademieLecon from "./pages/AcademieLecon.jsx";
import AcademieDashboard from "./pages/AcademieDashboard.jsx";

// ⚖️ Justice Lab (jeu de cas pratiques)
import JusticeLab from "./pages/JusticeLab.jsx";
import JusticeLabPlay from "./pages/JusticeLabPlay.jsx";
import JusticeLabResults from "./pages/JusticeLabResults.jsx";
import JusticeLabDashboard from "./pages/JusticeLabDashboard.jsx";

// ✅ NOUVEAU: phases dédiées
import JusticeLabAudience from "./pages/JusticeLabAudience.jsx";
import JusticeLabAppeal from "./pages/JusticeLabAppeal.jsx";

// ✅ Journal (audit log)
import JusticeLabJournal from "./pages/JusticeLabJournal.jsx";

// ✅ Redirect helper (fallback “dernier run”)
import { readRuns } from "./justiceLab/storage.js";

// ✅ Business Plan Premium (page)
import BusinessPlanPremiumPage from "./pages/BusinessPlanPremiumPage.jsx";
import LicenceMemoirePage from "./pages/LicenceMemoirePage.jsx";

// ✅ NEW: ONG Premium (page)
import NgoProjectPremiumPage from "./pages/NgoProjectPremiumPage.jsx";

// ✅ Excel Apps (progiciels Excel)
import ExcelAppsPage from "./pages/ExcelAppsPage.jsx";

function JusticeLabResultsFallback() {
  try {
    const runs = readRuns();
    const last = runs?.[0] || null;
    if (last?.runId) return <Navigate to={`/justice-lab/results/${encodeURIComponent(last.runId)}`} replace />;
  } catch {
    // ignore
  }
  return <Navigate to="/justice-lab" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            {/* Public */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* ✅ Business Plan Premium (protégé) */}
            <Route
              path="/bp"
              element={
                <ProtectedRoute>
                  <BusinessPlanPremiumPage />
                </ProtectedRoute>
              }
            />

            {/* ✅ ONG Premium (protégé) */}
            {/* ✅ Progiciels Excel (protégé) */}
            <Route
              path="/excel-apps"
              element={
                <ProtectedRoute>
                  <ExcelAppsPage />
                </ProtectedRoute>
              }
            />


            <Route
              path="/ong"
              element={
                <ProtectedRoute>
                  <NgoProjectPremiumPage />
                </ProtectedRoute>
              }
            />

            {/* ✅ Mémoire Licence (protégé) */}
            <Route
              path="/memoire"
              element={
                <ProtectedRoute>
                  <LicenceMemoirePage />
                </ProtectedRoute>
              }
            />

            {/* ✅ Admin (invisible pour les autres) */}
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <Admin />
                </AdminRoute>
              }
            />

            {/* Protected */}
            <Route
              path="/chat"
              element={
                <ProtectedRoute>
                  <ChatInterface />
                </ProtectedRoute>
              }
            />

            <Route
              path="/generate"
              element={
                <ProtectedRoute>
                  <Generate />
                </ProtectedRoute>
              }
            />

            <Route
              path="/analyse"
              element={
                <ProtectedRoute>
                  <Analyse />
                </ProtectedRoute>
              }
            />

            <Route
              path="/assistant-vocal"
              element={
                <ProtectedRoute>
                  <AssistantVocal />
                </ProtectedRoute>
              }
            />

            {/* ⚖️ Justice Lab (protégé) */}
            <Route
              path="/justice-lab"
              element={
                <ProtectedRoute>
                  <JusticeLab />
                </ProtectedRoute>
              }
            />

            <Route
              path="/justice-lab/dashboard"
              element={
                <ProtectedRoute>
                  <JusticeLabDashboard />
                </ProtectedRoute>
              }
            />

            {/* Join / lobby screen without selecting a dossier first */}
            <Route
              path="/justice-lab/play"
              element={
                <ProtectedRoute>
                  <JusticeLabPlay />
                </ProtectedRoute>
              }
            />

            <Route
              path="/justice-lab/play/:caseId"
              element={
                <ProtectedRoute>
                  <JusticeLabPlay />
                </ProtectedRoute>
              }
            />

            {/* ✅ Results (robuste) */}
            <Route
              path="/justice-lab/results"
              element={
                <ProtectedRoute>
                  <JusticeLabResultsFallback />
                </ProtectedRoute>
              }
            />

            <Route
              path="/justice-lab/results/:runId"
              element={
                <ProtectedRoute>
                  <JusticeLabResults />
                </ProtectedRoute>
              }
            />

            {/* ✅ Journal (audit log) */}
            <Route
              path="/justice-lab/journal/:runId"
              element={
                <ProtectedRoute>
                  <JusticeLabJournal />
                </ProtectedRoute>
              }
            />

            {/* ✅ Routes phases (protégées) */}
            <Route
              path="/justice-lab/audience"
              element={
                <ProtectedRoute>
                  <JusticeLabAudience />
                </ProtectedRoute>
              }
            />

            <Route
              path="/justice-lab/appeal"
              element={
                <ProtectedRoute>
                  <JusticeLabAppeal />
                </ProtectedRoute>
              }
            />

            {/* Académie (protégé) */}
            <Route
              path="/academie"
              element={
                <ProtectedRoute>
                  <Academie />
                </ProtectedRoute>
              }
            />

            <Route
              path="/academie/dashboard"
              element={
                <ProtectedRoute>
                  <AcademieDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/academie/programme/:id"
              element={
                <ProtectedRoute>
                  <AcademieProgramme />
                </ProtectedRoute>
              }
            />

            <Route
              path="/academie/programme/:id/lesson/:lessonId"
              element={
                <ProtectedRoute>
                  <AcademieLecon />
                </ProtectedRoute>
              }
            />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
