// /api/webhook.js  (Vercel serverless + Twilio WhatsApp)
import fs from "fs";
import path from "path";
import { Twilio } from "twilio";

// ───────────────── MENU LOAD (cold-start) ──────────────────
let MENUS = { full: {}, flat: {} };
(function loadMenu() {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "menu.json"), "utf-8")
    );
    MENUS = {
      full: raw.menu,
      flat: Object.entries(raw.menu)
        .filter(([s]) => s !== "Restaurant")
        .flatMap(([_, items]) => Object.entries(items))
        .reduce((acc, [name, price]) => {
          acc[name.toLowerCase()] = price;
          return acc;
        }, {})
    };
    console.log(`✅ Menu loaded (${Object.keys(MENUS.flat).length} items)`);
  } catch (e) {
    console.error("❌ Failed to load menu.json:", e.message);
  }
})();

// ───────────────── SESSIONS IN MEMORY ───────────────────────
const sessions = new Map(); // key = whatsapp:+123…

// ───────────────── HELPERS ──────────────────────────────────
function parseOrder(text) {
  const add = {},
    remove = {};
  const lower = text.toLowerCase();
  for (const item of Object.keys(MENUS.flat)) {
    const addRE = new RegExp(`(?:add\\s*)?(\\d+)?\\s*${item}`, "gi");
    const remRE = new RegExp(
      `(?:remove|cancel|delete|no)\\s*(\\d+)?\\s*${item}`,
      "gi"
    );
    let m;
    while ((m = addRE.exec(lower))) add[item] = (add[item] || 0) + (parseInt(m[1]) || 1);
    while ((m = remRE.exec(lower))) remove[item] = (remove[item] || 0) + (parseInt(m[1]) || 1);
  }
  return { add, remove };
}

function formatMenu() {
  return Object.entries(MENUS.full)
    .filter(([s]) => s !== "Restaurant")
    .map(([sec, items]) => {
      const rows = Object.entries(items)
        .map(([n, p]) => `- ${n}: $${p}`)
        .join("\n");
      return `*${sec}*\n${rows}`;
    })
    .join("\n\n");
}

function summary(session) {
  let txt = "📎 Your updated order:\n";
  for (const [item, qty] of Object.entries(session.items)) {
    txt += `- ${qty}x ${item} ($${(qty * MENUS.flat[item]).toFixed(2)})\n`;
  }
  txt += `\n💰 Total: $${session.total.toFixed(2)}\nReply 'yes' to confirm or 'no' to modify.`;
  return txt;
}

async function sendTwilio(to, body) {
  const client = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    body,
    from: process.env.TWILIO_WHATSAPP_NUMBER, // e.g. "whatsapp:+14155238886"
    to
  });
}

// ───────────────── WEBHOOK HANDLER ──────────────────────────
export default async function handler(req, res) {
  /* Twilio only sends POST for inbound messages */
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Twilio sends url-encoded by default – Vercel parses as req.body
  const from = req.body.From;  // "whatsapp:+1xxxx"
  const textRaw = req.body.Body || "";
  const text = textRaw.trim().toLowerCase();

  // Basic guard
  if (!from || !text) return res.status(200).send("ok");

  // Ensure a session
  if (!sessions.has(from))
    sessions.set(from, { greeted: false, items: {}, total: 0 });
  const session = sessions.get(from);

  // --- User flow ---
  if (!session.greeted) {
    session.greeted = true;
    await sendTwilio(from, "👋 Welcome! Type 'menu' to see our dishes.");
    return res.status(200).send("greeted");
  }

  if (text.includes("menu")) {
    await sendTwilio(from, formatMenu());
    return res.status(200).send("menu");
  }

  if (["yes", "y", "confirm"].includes(text)) {
    if (session.total > 0) {
      await sendTwilio(from, "✅ Order confirmed! Thank you.");
      sessions.delete(from);
    } else {
      await sendTwilio(from, "❌ No active order to confirm.");
    }
    return res.status(200).send("confirm");
  }

  if (["no", "n", "cancel"].includes(text)) {
    sessions.delete(from);
    await sendTwilio(from, "🗑️ Order cancelled. Start again anytime.");
    return res.status(200).send("cancel");
  }

  // Add/remove items
  const { add, remove } = parseOrder(text);
  if (!Object.keys(add).length && !Object.keys(remove).length) {
    await sendTwilio(from, "❌ I didn't understand. Try 'add 2 naan'.");
    return res.status(200).send("unrecognized");
  }

  // Apply removals
  for (const [item, qty] of Object.entries(remove)) {
    const cur = session.items[item] || 0;
    const newQ = Math.max(cur - qty, 0);
    if (newQ === 0) delete session.items[item];
    else session.items[item] = newQ;
    session.total -= (MENUS.flat[item] || 0) * Math.min(qty, cur);
  }
  // Apply additions
  for (const [item, qty] of Object.entries(add)) {
    session.items[item] = (session.items[item] || 0) + qty;
    session.total += (MENUS.flat[item] || 0) * qty;
  }

  await sendTwilio(from, summary(session));
  return res.status(200).send("updated");
}
