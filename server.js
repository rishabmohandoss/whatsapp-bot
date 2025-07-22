const express = require("express");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const phoneNumberId = process.env.PHONE_NUMBER_ID || "123456";
const accessToken = process.env.ACCESS_TOKEN || "mock-token";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "verify-me";
const { execSync } = require("child_process");

try {
  execSync("node syncMenu.js");
  console.log("🔄 Ran syncMenu.js on server startup");
} catch (e) {
  console.warn("⚠️ Failed to sync menu on startup:", e.message);
}


let MENUS = {};
function loadMenu() {
  try {
    const raw = JSON.parse(fs.readFileSync("menu.json"));
    MENUS = {
      full: raw.menu,
      flat: Object.entries(raw.menu)
        .filter(([section]) => section !== "Restaurant")
        .flatMap(([_, items]) => Object.entries(items))
        .reduce((acc, [name, price]) => {
          acc[name.toLowerCase()] = price;
          return acc;
        }, {})
    };
    console.log("✅ Menu loaded");
  } catch (e) {
    console.error("❌ Error loading menu:", e.message);
    MENUS = { full: {}, flat: {} };
  }
}
loadMenu();

const orderSessions = {};
app.use(express.json());

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const entry = req.body.entry?.[0];
  const message = entry?.changes?.[0]?.value?.messages?.[0];
  if (!message?.text) return res.sendStatus(200);

  const from = message.from;
  const text = message.text.body.trim().toLowerCase();

  if (!orderSessions[from]) {
    orderSessions[from] = {
      greeted: false,
      items: {},
      total: 0
    };
  }

  const session = orderSessions[from];

  if (!session.greeted) {
    session.greeted = true;
    await sendWhatsAppMessage(from, `👋 Welcome! Would you like to order from one of these: *Menu*?`);
    return res.sendStatus(200);
  }

  if (text.includes("menu")) {
    await sendWhatsAppMessage(from, `🍽️ Great choice! Here's our Menu:
${formatMenu(MENUS.full)}`);
    return res.sendStatus(200);
  }
// Handle confirmation
if (["yes", "y", "confirm"].includes(text)) {
  if (session.total > 0) {
    await sendWhatsAppMessage(from, `✅ Your order has been confirmed! Thank you!`);
    delete orderSessions[from]; // Reset the session
  } else {
    await sendWhatsAppMessage(from, `❌ No active order to confirm.`);
  }
  return res.sendStatus(200);
}

if (["no", "n", "cancel"].includes(text)) {
  await sendWhatsAppMessage(from, `📝 Okay! You can send updated items or start a new order anytime.`);
  return res.sendStatus(200);
}

const { addItems, removeItems } = parseOrderLocally(text, MENUS.flat);

if (Object.keys(addItems).length === 0 && Object.keys(removeItems).length === 0) {
  await sendWhatsAppMessage(
    from,
    `❌ Sorry, I didn’t understand your update. Try phrases like 'add 1 naan', 'remove 2 cokes', or 'cancel biryani'.`
  );
  return res.sendStatus(200);
}

// Remove items
for (const item in removeItems) {
  const qty = removeItems[item];
  const currentQty = session.items[item] || 0;
  const newQty = Math.max(currentQty - qty, 0);

  if (newQty === 0) {
    delete session.items[item];
  } else {
    session.items[item] = newQty;
  }

  session.total -= (MENUS.flat[item] || 0) * Math.min(qty, currentQty);
}

// Add items
for (const item in addItems) {
  const qty = addItems[item];
  session.items[item] = (session.items[item] || 0) + qty;
  session.total += (MENUS.flat[item] || 0) * qty;
}

  let summary = "📎 Your updated order:\n";
  for (const item in session.items) {
    const qty = session.items[item];
    const price = MENUS.flat[item];
    summary += `- ${qty}x ${item} ($${(qty * price).toFixed(2)})\n`;
  }
  summary += `\n💰 Total: $${session.total.toFixed(2)}\nReply 'yes' to confirm or 'no' to modify.`;

  await sendWhatsAppMessage(from, summary);
  res.sendStatus(200);
});

function formatMenu(menu) {
  return Object.entries(menu)
    .filter(([section]) => section !== "Restaurant")
    .map(([section, items]) => {
      const list = Object.entries(items)
        .map(([item, price]) => `- ${item}: $${price}`)
        .join("\n");
      return `\n*${section}*\n${list}`;
    })
    .join("\n\n");
}

function parseOrderLocally(text, menu) {
  const addItems = {};
  const removeItems = {};
  const lowered = text.toLowerCase();

  for (const item of Object.keys(menu)) {
    const removePattern = new RegExp(`(remove|cancel|delete|no)\\s*(\\d+)?\\s*${item}`, 'gi');
    const addPattern = new RegExp(`(?:add\\s*)?(\\d+)?\\s*${item}`, 'gi');

    let match;

    // Look for remove expressions
    while ((match = removePattern.exec(lowered)) !== null) {
      const qty = parseInt(match[2]) || 1;
      removeItems[item] = (removeItems[item] || 0) + qty;
    }

    // Look for add expressions
    while ((match = addPattern.exec(lowered)) !== null) {
      const qty = parseInt(match[1]) || 1;
      addItems[item] = (addItems[item] || 0) + qty;
    }
  }

  return { addItems, removeItems };
}

async function sendWhatsAppMessage(to, message) {
  const mockMode = process.env.MOCK_MODE === "true";

  if (mockMode) {
    console.log(`📩 MOCK MESSAGE to ${to}: ${message}`);
    return;
  }

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log("✅ Message sent to customer");
  } catch (error) {
    console.error("❌ Failed to send message:", error.response?.data || error.message);
  }
}

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
