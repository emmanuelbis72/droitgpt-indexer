import { generateBusinessPlanPremium } from "./orchestrator.js";
import { generateLicenceMemoire } from "./academicOrchestrator.js";
import { generateNgoProjectPremium } from "./ngoOrchestrator.js";
import { generateGrantsManagementWorkspace } from "./grantsOrchestrator.js";
import { generateExcelApp } from "./excelOrchestrator.js";

export async function runGenerationProcessor(processor, payload = {}) {
  switch (String(processor || "")) {
    case "businessplan":
      return runBusinessPlan(payload);
    case "memoire":
      return runMemoire(payload);
    case "ngo_project":
      return runNgoProject(payload);
    case "grants_management":
      return runGrantsManagement(payload);
    case "excel_app":
      return runExcelApp(payload);
    default:
      throw new Error(`UNKNOWN_GENERATION_PROCESSOR: ${processor || "missing"}`);
  }
}

async function runBusinessPlan(payload = {}) {
  const lang = payload.lang || "fr";
  const ctx = payload.ctx || {};
  const lite = Boolean(payload.lite);
  const output = payload.output || "pdf";
  const title = payload.title || `${ctx.companyName || "Projet"} - Business Plan`;
  const { sections, fullText } = await generateBusinessPlanPremium({ lang, ctx, lite });
  return { title, lang, ctx, lite, output, sections, fullText };
}

async function runMemoire(payload = {}) {
  const lang = payload.lang || "fr";
  const ctx = payload.ctx || {};
  const title = payload.title || ctx.topic || "Memoire";
  const { plan, sections, sourcesUsed } = await generateLicenceMemoire({ lang, ctx });
  const nextCtx = {
    ...ctx,
    sourcesUsed: Array.isArray(sourcesUsed) ? sourcesUsed : [],
  };
  return { title, lang, ctx: nextCtx, plan, sections, sourcesUsed: nextCtx.sourcesUsed };
}

async function runNgoProject(payload = {}) {
  const lang = payload.lang || "fr";
  const ctx = payload.ctx || {};
  const lite = Boolean(payload.lite);
  const title = payload.title || `${ctx.projectTitle || "Projet ONG"} - Projet ONG`;
  const result = await generateNgoProjectPremium({ lang, ctx, lite });
  return { title, lang, ctx, lite, sections: result?.sections || [] };
}

async function runGrantsManagement(payload = {}) {
  const lang = payload.lang || "fr";
  const ctx = payload.ctx || {};
  const title = payload.title || `${ctx.projectName || "Projet"} - Gestion de subventions`;
  const workspace = await generateGrantsManagementWorkspace({ lang, ctx });
  return { title, lang, ctx, workspace };
}

async function runExcelApp(payload = {}) {
  const out = await generateExcelApp({ lang: payload.lang || "fr", ctx: payload.ctx || {} });
  return {
    fileNameBase: out.fileNameBase,
    blueprint: out.blueprint,
    xlsxBase64: out.xlsxBuffer.toString("base64"),
  };
}
