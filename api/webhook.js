import axios from "axios";
import fs from "fs";
import path from "path";

/*****************************
 * WhatsApp Ordering Webhook *
 * For Vercel serverless    *
 *****************************/

// ----‑‑ Load menu once at cold‑start ───────────────────────────
let MENUS = { full: {}, flat: {} };
(function loadMenu() {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "menu.json"), "utf‑8")
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
    console.log("✅ Menu loaded (" + Object.keys(MENUS.flat).length + " items)");
  } catch (err) {
    console.error("❌ Failed to load menu.json", err.message);
  }
})();

// ----‑‑ In‑memory sessions (OK for serverless demo) ────────────
const sessions = new Map(); // key = phone number

// ----‑‑ Helper functions ───────────────────────────────────────
function parseOrder(text) {
  const add = {}, remove = {};
  const lower = text.toLowerCase();
  for (const item of Object.keys(MENUS.flat)) {
    const addRe = new RegExp(`(?:add\\s*)?(\\d+)?\\s*${item}`, "gi");
    const remRe = new RegExp(`(?:remove|cancel|delete|no)\\s*(\\d+)?\\s*${item}`, "gi");
    let m;
    while ((m = remRe.exec(lower))) remove[item] = (remove[item] || 0) + (parseInt(m[1]) || 1);
    while ((m = addRe.exec(lower))) add[item] = (add[item] || 0) + (parseInt(m[1]) || 1);
  }
  return { add, remove };
}

function menuText() {
  return Object.entries(MENUS.full)
    .filter(([s]) => s !== "Restaurant")
    .map(([sec, it]) => `*${sec}*\n${Object.entries(it).map(([n,p])=>`- ${n}: $${p}`).join("\n")}`)
    .join("\n\n");
}

async function sendWAMessage(to, body) {
  const url = `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`;
  await axios.post(url,
    { messaging_product: "whatsapp", to, type: "text", text:{ body } },
    { headers:{ Authorization:`Bearer ${process.env.ACCESS_TOKEN}` } }
  );
}

function orderSummary(session) {
  let txt = "📎 Your updated order:\n";
  for (const [item, qty] of Object.entries(session.items)) {
    txt += `- ${qty}x ${item} ($${(qty*MENUS.flat[item]).toFixed(2)})\n`;
  }
  txt += `\n💰 Total: $${session.total.toFixed(2)}\nReply 'yes' to confirm or 'no' to modify.`;
  return txt;
}

// ----‑‑ Webhook handler exported to Vercel ─────────────────────
export default async function handler(req, res) {
  /* Webhook verification (GET) */
  if (req.method === "GET") {
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": chall } = req.query;
    return mode === "subscribe" && token === process.env.VERIFY_TOKEN
      ? res.status(200).send(chall) : res.status(403).send("Forbidden");
  }

  /* Incoming messages (POST) */
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg?.text) return res.status(200).send("Ignored");

  const from = msg.from;
  const text = msg.text.body.trim().toLowerCase();
  if (!sessions.has(from)) sessions.set(from,{ greeted:false, items:{}, total:0 });
  const session = sessions.get(from);

  // greet
  if (!session.greeted) {
    session.greeted = true;
    await sendWAMessage(from,"👋 Welcome! Type 'menu' to see our dishes.");
    return res.status(200).send("Greeting sent");
  }
  // show menu
  if (text.includes("menu")) {
    await sendWAMessage(from, menuText());
    return res.status(200).send("Menu sent");
  }
  // confirm / cancel
  if (["yes","y","confirm"].includes(text)) {
    if (session.total>0){
      await sendWAMessage(from,"✅ Order confirmed! Thanks.");
      sessions.delete(from);
    } else {
      await sendWAMessage(from,"❌ No active order.");
    }
    return res.status(200).send("Confirm handled");
  }
  if (["no","n","cancel"].includes(text)) {
    sessions.delete(from);
    await sendWAMessage(from,"🗑️ Order cancelled. Start again anytime.");
    return res.status(200).send("Cancelled");
  }

  // add / remove items
  const { add, remove } = parseOrder(text);
  if (!Object.keys(add).length && !Object.keys(remove).length) {
    await sendWAMessage(from,"❌ Sorry, I didn’t understand. Try 'add 1 naan'.");
    return res.status(200).send("Unrecognized");
  }
  for (const [item,qty] of Object.entries(remove)) {
    const cur = session.items[item]||0;
    const newQ = Math.max(cur-qty,0);
    if(newQ===0) delete session.items[item]; else session.items[item]=newQ;
    session.total -= (MENUS.flat[item]||0)*Math.min(qty,cur);
  }
  for (const [item,qty] of Object.entries(add)) {
    session.items[item]=(session.items[item]||0)+qty;
    session.total += (MENUS.flat[item]||0)*qty;
  }
  await sendWAMessage(from, orderSummary(session));
  return res.status(200).send("Order updated");
}
