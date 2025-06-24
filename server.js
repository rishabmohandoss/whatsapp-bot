const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

const accessToken = process.env.ACCESS_TOKEN || "your-local-access-token";
const phoneNumberId = "634093596444481";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "your-local-verify-token";

if (!accessToken) console.warn("⚠️ accessToken is undefined!");
if (!phoneNumberId) console.warn("⚠️ phoneNumberId is undefined!");

const fs = require("fs");
let MENUS = {};

function loadMenu() {
  try {
    if (!fs.existsSync("menu.json")) {
      fs.writeFileSync("menu.json", JSON.stringify({}, null, 2));
      console.warn("⚠️ menu.json not found, created empty file");
    }
    MENUS = JSON.parse(fs.readFileSync("menu.json", "utf-8"));
    console.log("✅ Menu loaded");
  } catch (err) {
    console.error("❌ Error loading menu:", err.message);
    MENUS = {}; // fallback to empty
  }
}

const { execSync } = require("child_process");
try {
  execSync("node syncMenu.js");
  console.log("🔄 Ran syncMenu.js on startup");
} catch (err) {
  console.warn("⚠️ syncMenu.js failed:", err.message);
}


loadMenu();


const orderSessions = {};

app.use(express.json());

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];

  if (!message?.text) {
    const customerNumber = message?.from;
    if (customerNumber) {
      await sendWhatsAppMessage(customerNumber, "Sorry, I can only process text orders right now.");
    }
    return res.sendStatus(200);
  }

  const customerText = message.text.body.trim().toLowerCase();
  const customerNumber = message.from;

  console.log(`Incoming from ${customerNumber}: ${customerText}`);

  if (!orderSessions[customerNumber]) {
    orderSessions[customerNumber] = { greeted: false, restaurant: null, items: {}, total: 0 };
  }

  const session = orderSessions[customerNumber];

if (!session.restaurant) {
  if (!session.greeted) {
    session.greeted = true;
    await sendWhatsAppMessage(customerNumber, `👋 Welcome! Would you like to order from one of these: ${Object.keys(MENUS).map(r => `*${capitalize(r)}*`).join(", ")}?`);
    return res.sendStatus(200); // ⛔ Stop here — don’t evaluate yet
  }

  const selected = Object.keys(MENUS).find(menuKey =>
    customerText.includes(menuKey.toLowerCase())
  );

  if (selected) {
    session.restaurant = selected;
    const emoji = selected === "indian" ? "🇮🇳" : selected === "italian" ? "🇮🇹" : "🍽️";
    await sendWhatsAppMessage(customerNumber, `${emoji} Great choice! Here's our ${capitalize(selected)} menu:\n${formatMenu(selected)}`);
  } else {
    await sendWhatsAppMessage(customerNumber, `❓ Please reply with one of these: ${Object.keys(MENUS).map(r => `'${capitalize(r)}'`).join(", ")}`);
  }

  return res.sendStatus(200);
}

  const confirmationYes = ["yes", "yeah", "y"].includes(customerText);
  const confirmationNo = ["no", "nah", "n"].includes(customerText);

if (confirmationYes) {
  if (session.total > 0) {
    await sendWhatsAppMessage(customerNumber, `✅ Your order has been confirmed! We'll start preparing it.`);

    try {
      const paymentRes = await axios.post("https://whatsapp-bot-s0i3.onrender.com/create-paypal-order", {
        total: session.total
      });
      await sendWhatsAppMessage(customerNumber, `🧾 To complete your payment, please visit: ${paymentRes.data.url}`);
    } catch (err) {
      console.error("❌ PayPal payment error:", err.message);
      await sendWhatsAppMessage(customerNumber, `⚠️ We encountered a problem generating your payment link. Please try again in a moment.`);
    }

    delete orderSessions[customerNumber];
    } else {
      await sendWhatsAppMessage(customerNumber, `❌ Sorry, we couldn't find an order to confirm.`);
    }
  } else if (confirmationNo) {
    if (session.total > 0) {
      await sendWhatsAppMessage(customerNumber, `Would you like to add more items to your order or cancel it? Please reply with 'add more' or 'cancel'.`);
    } else {
      await sendWhatsAppMessage(customerNumber, `❌ No active order found.`);
    }
  } else if (customerText.includes("add more")) {
    await sendWhatsAppMessage(customerNumber, `Sure, send the items you’d like to add to your current order.`);
  } else if (customerText.includes("cancel")) {
    delete orderSessions[customerNumber];
    await sendWhatsAppMessage(customerNumber, `✅ Your order has been cancelled.`);
  } else {
  const { addItems, removeItems } = parseOrderWithIntent(customerText, session.restaurant);

  let changesMade = false;
  let addedTotal = 0;

  // Apply removals
  for (const item in removeItems) {
    if (MENUS[session.restaurant].hasOwnProperty(item)) {
      const qty = removeItems[item];
      const currentQty = session.items[item] || 0;
      const newQty = Math.max(currentQty - qty, 0);

      if (newQty === 0) {
        delete session.items[item];
      } else {
        session.items[item] = newQty;
      }

      session.total -= MENUS[session.restaurant][item] * Math.min(qty, currentQty);
      changesMade = true;
    }
  }

  // Apply additions
  for (const item in addItems) {
    if (MENUS[session.restaurant].hasOwnProperty(item)) {
      const qty = addItems[item];
      session.items[item] = (session.items[item] || 0) + qty;
      session.total += MENUS[session.restaurant][item] * qty;
      changesMade = true;
    }
  }

  if (changesMade) {
    let summary = "🧾 Your updated order:\n";

    for (const item in session.items) {
      const qty = session.items[item];
      const price = MENUS[session.restaurant][item];
      summary += `- ${qty}x ${item} ($${qty * price})\n`;
    }

    summary += `\n💰 Total: $${session.total}\nReply 'yes' to confirm or 'no' to modify.`;

    await sendWhatsAppMessage(customerNumber, summary);
  } else {
    await sendWhatsAppMessage(customerNumber, `❌ Sorry, I didn’t understand your update. Try phrases like 'add 1 naan', 'remove 2 cokes', or 'cancel biryani'.`);
  }
}



  res.sendStatus(200);
});

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}


function formatMenu(type) {
  return Object.entries(MENUS[type])
    .map(([item, price]) => `- ${item}: $${price}`)
    .join("\n");
}

async function sendWhatsAppMessage(to, message) {
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

function parseOrderWithIntent(text, restaurantType) {
  const addItems = {};
  const removeItems = {};
  const lowered = text.toLowerCase();

  for (const item of Object.keys(MENUS[restaurantType])) {
    const addPattern = new RegExp(`(\\d+)?\\s*${item}`, 'gi');
    const removePattern = new RegExp(`(remove|delete|no|cancel)\\s*(\\d+)?\\s*${item}`, 'gi');

    let match;

    while ((match = removePattern.exec(lowered)) !== null) {
      const qty = parseInt(match[2]) || 1;
      removeItems[item] = (removeItems[item] || 0) + qty;
    }

    while ((match = addPattern.exec(lowered)) !== null) {
      const qty = parseInt(match[1]) || 1;
      addItems[item] = (addItems[item] || 0) + qty;
    }
  }

  return { addItems, removeItems };
}
// Add this BEFORE app.listen()

app.post('/create-paypal-order', async (req, res) => {
  const { total } = req.body;

  try {
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
    const tokenRes = await axios.post(
'https://api-m.sandbox.paypal.com/v1/oauth2/token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const accessToken = tokenRes.data.access_token;

    const orderRes = await axios.post(
'https://api-m.sandbox.paypal.com/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'USD',
            value: total.toFixed(2)
          }
        }],
        application_context: {
          return_url: 'https://yourdomain.com/success',
          cancel_url: 'https://yourdomain.com/cancel'
        }
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const approvalLink = orderRes.data.links.find(link => link.rel === 'approve').href;
    res.json({ url: approvalLink });

  } catch (err) {
    console.error("❌ PayPal error:", err.message);
    res.status(500).json({ error: "Failed to create PayPal order" });
  }
});

// Now start the server
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});


