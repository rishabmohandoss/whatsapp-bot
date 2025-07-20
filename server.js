import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { parse } from "querystring";
import pkg from "twilio";
const { Twilio } = pkg;

const app = express();
app.use(bodyParser.text({ type: "*/*" }));

// ─────────── MENU LOAD (cold-start) ───────────
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

// ─────────── SESSION STORAGE ───────────
const sessions = new Map();

function parseOrder(text) {
  const add = {}, remove = {};
  const lower = text.toLowerCase();
  for (const item of Object.keys(MENUS.flat)) {
    const addRE = new RegExp(`(?:add\\s*)?(\\d+)?\\s*${item}`, "gi");
    const remRE = new RegExp(`(?:remove|cancel|delete|no)\\s*(\\d+)?\\s*${item}`, "gi");
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
  const client = new Twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  await client.messages.create({
    body,
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to
  });
}

// ─────────── WEBHOOK ROUTE ───────────
app.post("/webhook", async (req, res) => {
  let parsedBody = parse(req.body);
  const from = parsedBody.From;
  const textRaw = parsedBody.Body || "";
  const text = textRaw.trim().toLowerCase();

  if (!from || !text) return res.status(200).send("ok");

  if (!sessions.has(from))
    sessions.set(from, { greeted: false, items: {}, total: 0 });
  const session = sessions.get(from);

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

  const { add, remove } = parseOrder(text);
  if (!Object.keys(add).length && !Object.keys(remove).length) {
    await sendTwilio(from, "❌ I didn't understand. Try 'add 2 naan'.");
    return res.status(200).send("unrecognized");
  }

  for (const [item, qty] of Object.entries(remove)) {
    const cur = session.items[item] || 0;
    const newQ = Math.max(cur - qty, 0);
    if (newQ === 0) delete session.items[item];
    else session.items[item] = newQ;
    session.total -= (MENUS.flat[item] || 0) * Math.min(qty, cur);
  }

  for (const [item, qty] of Object.entries(add)) {
    session.items[item] = (session.items[item] || 0) + qty;
    session.total += (MENUS.flat[item] || 0) * qty;
  }

  await sendTwilio(from, summary(session));
  return res.status(200).send("updated");
});

// ─────────── START SERVER ───────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
