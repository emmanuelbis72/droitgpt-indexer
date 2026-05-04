// bp/core/grantsAlerts.js
import { recordAlert } from "./grantsDb.js";

export async function sendGrantAlerts({ watchConfig, newOpportunities = [] }) {
  const items = Array.isArray(newOpportunities) ? newOpportunities : [];
  if (!items.length) return { sent: [], skipped: ["no_new_opportunities"] };

  const sent = [];
  const skipped = [];
  const text = buildAlertText(watchConfig, items);

  if (watchConfig?.alerts?.slack && process.env.SLACK_WEBHOOK_URL) {
    try {
      await postJson(process.env.SLACK_WEBHOOK_URL, { text });
      sent.push("slack");
    } catch (e) {
      skipped.push(`slack_error:${String(e?.message || e).slice(0, 160)}`);
    }
  } else if (watchConfig?.alerts?.slack) {
    skipped.push("slack_missing_webhook");
  }

  if (watchConfig?.alerts?.whatsapp && process.env.WHATSAPP_WEBHOOK_URL) {
    try {
      await postJson(process.env.WHATSAPP_WEBHOOK_URL, { text, channel: "whatsapp" });
      sent.push("whatsapp");
    } catch (e) {
      skipped.push(`whatsapp_error:${String(e?.message || e).slice(0, 160)}`);
    }
  } else if (watchConfig?.alerts?.whatsapp) {
    skipped.push("whatsapp_missing_webhook");
  }

  if (watchConfig?.alerts?.email && process.env.EMAIL_WEBHOOK_URL) {
    try {
      await postJson(process.env.EMAIL_WEBHOOK_URL, {
        to: watchConfig?.alerts?.emailTo || process.env.GRANTS_ALERT_EMAIL_TO || "",
        subject: `Nouveaux appels a projets: ${watchConfig.name}`,
        text,
      });
      sent.push("email");
    } catch (e) {
      skipped.push(`email_error:${String(e?.message || e).slice(0, 160)}`);
    }
  } else if (watchConfig?.alerts?.email) {
    skipped.push("email_missing_webhook");
  }

  await recordAlert({
    watchId: watchConfig?.id || null,
    channels: sent,
    skipped,
    newCount: items.length,
    preview: text.slice(0, 1500),
  });

  return { sent, skipped };
}

function buildAlertText(watchConfig, items) {
  const lines = [
    `Nouveaux appels detectes - ${watchConfig?.name || "Grant watch"}`,
    "",
    ...items.slice(0, 8).map((opp, idx) => {
      const score = opp?.match?.score ?? "-";
      return `${idx + 1}. ${opp.title} (${opp.source}, score ${score})\n${opp.url}`;
    }),
  ];
  if (items.length > 8) lines.push(`\n+${items.length - 8} autres opportunites.`);
  return lines.join("\n");
}

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Alert webhook HTTP ${resp.status}: ${txt.slice(0, 250)}`);
  }
}
