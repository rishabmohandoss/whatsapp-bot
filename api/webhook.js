const express = require("express");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

const accessToken = process.env.ACCESS_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAYTM_MID = process.env.PAYTM_MID;
const PAYTM_API_KEY = process.env.PAYTM_API_KEY; // If applicable

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
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  } else {
    console.log("❌ Webhook verification failed");
    return res.sendStatus(403);
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
      total: 0,
      paymentConfirmed: false
    };
  }

  const session = orderSessions[from];

  if (!session.greeted) {
    session.greeted = true;
    await sendWhatsAppMessage(from, `👋 Welcome! Type "menu" to see our options.`);
    return res.sendStatus(200);
  }

  if (text.includes("menu")) {
    await sendWhatsAppMessage(from, formatMenu(MENUS.full));
    return res.sendStatus(200);
  }

  if (["yes", "y", "confirm"].includes(text)) {
    if (session.total > 0 && !session.paymentConfirmed) {
      const paymentLink = await generatePaytmLink(from, session.total.toFixed(2));
      await sendWhatsAppMessage(from, `💳 Please complete your payment here:\n${paymentLink}`);
      pollPaymentStatus(from, paymentLink); // Non-blocking
    } else if (session.paymentConfirmed) {
      await sendWhatsAppMessage(from, `✅ Your order has been confirmed! Please pay using this link https://paytm.me/yourshopname-product1`);
      delete orderSessions[from];
    } else {
      await sendWhatsAppMessage(from, `❌ No order found.`);
    }
    return res.sendStatus(200);
  }

  if (["no", "n", "cancel"].includes(text)) {
    await sendWhatsAppMessage(from, `📝 Okay, your session has been reset.`);
    delete orderSessions[from];
    return res.sendStatus(200);
  }

  const { addItems, removeItems } = parseOrderLocally(text, MENUS.flat);

  if (Object.keys(addItems).length === 0 && Object.keys(removeItems).length === 0) {
    await sendWhatsAppMessage(from, `❌ Unrecognized. Try 'add 1 naan', 'remove 2 coke'.`);
    return res.sendStatus(200);
  }

  for (const item in removeItems) {
    const qty = removeItems[item];
    const currentQty = session.items[item] || 0;
    const newQty = Math.max(currentQty - qty, 0);
    if (newQty === 0) delete session.items[item];
    else session.items[item] = newQty;
    session.total -= (MENUS.flat[item] || 0) * Math.min(qty, currentQty);
  }

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
  summary += `\n💰 Total: $${session.total.toFixed(2)}\nReply 'yes' to confirm and pay.`;

  await sendWhatsAppMessage(from, summary);
  return res.sendStatus(200);
});

function parseOrderLocally(text, menu) {
  const addItems = {}, removeItems = {};
  for (const item of Object.keys(menu)) {
    const addRegex = new RegExp(`(?:add\\s*)?(\\d+)?\\s*${item}`, 'gi');
    const removeRegex = new RegExp(`(remove|cancel|delete|no)\\s*(\\d+)?\\s*${item}`, 'gi');

    let match;
    while ((match = addRegex.exec(text)) !== null) {
      const qty = parseInt(match[1]) || 1;
      addItems[item] = (addItems[item] || 0) + qty;
    }
    while ((match = removeRegex.exec(text)) !== null) {
      const qty = parseInt(match[2]) || 1;
      removeItems[item] = (removeItems[item] || 0) + qty;
    }
  }
  return { addItems, removeItems };
}

function formatMenu(menu) {
  return Object.entries(menu)
    .filter(([s]) => s !== "Restaurant")
    .map(([section, items]) => {
      return `*${section}*\n${Object.entries(items).map(([k, v]) => `- ${k}: $${v}`).join("\n")}`;
    }).join("\n\n");
}

async function generatePaytmLink(userId, amount) {
  // Simulated Paytm API request (use actual production API)
  // Reference: https://developer.paytm.com/docs
  const orderId = `ORDER_${Date.now()}`;
  return `https://paytm.me/example-pay?amt=${amount}&orderId=${orderId}`;
}

async function pollPaymentStatus(from, orderId) {
  for (let i = 0; i < 24; i++) { // Every 5s for 2 minutes
    await new Promise(res => setTimeout(res, 5000));

    const paid = await checkPaytmStatus(orderId);
    if (paid) {
      orderSessions[from].paymentConfirmed = true;
      await sendWhatsAppMessage(from, `✅ Payment received! Your order is confirmed.`);
      return;
    }
  }

  await sendWhatsAppMessage(from, `⏰ Payment not received in time. Please try again.`);
}

async function checkPaytmStatus(orderId) {
  // Replace with real API call
  console.log(`🔍 Checking status for ${orderId}`);
  return false; // Stub: Replace with actual status check
}

async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
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
    console.log(`✅ Message sent to ${to}`);
  } catch (err) {
    console.error("❌ Failed to send message:", err.response?.data || err.message);
  }
}

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
