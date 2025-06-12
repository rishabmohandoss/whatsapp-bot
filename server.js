const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

const accessToken = process.env.ACCESS_TOKEN || "your-local-access-token";
const phoneNumberId = "634093596444481";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "your-local-verify-token";

if (!accessToken) console.warn("⚠️ accessToken is undefined!");
if (!phoneNumberId) console.warn("⚠️ phoneNumberId is undefined!");

const MENU = {
  "chicken biryani": 12,
  "coke": 3,
  "naan": 2,
  "butter chicken": 10
};

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
    orderSessions[customerNumber] = { greeted: false, items: {}, total: 0 };
  }

  if (!orderSessions[customerNumber].greeted) {
    orderSessions[customerNumber].greeted = true;
    await sendWhatsAppMessage(customerNumber, `👋 Welcome to our restaurant! Here's our menu:\n${formatMenu()}`);
    return res.sendStatus(200);
  }

  const confirmationYes = ["yes", "yeah", "y"].includes(customerText);
  const confirmationNo = ["no", "nah", "n"].includes(customerText);

  if (confirmationYes) {
    const lastOrder = orderSessions[customerNumber];
    if (lastOrder?.total > 0) {
      await sendWhatsAppMessage(customerNumber, `✅ Your order has been confirmed! We'll start preparing it.`);
      await sendWhatsAppMessage(customerNumber, `🧾 To complete your payment, please visit: https://buy.stripe.com/14A14mbBX8TmeaI3alf7i00`);
      delete orderSessions[customerNumber];
    } else {
      await sendWhatsAppMessage(customerNumber, `❌ Sorry, we couldn't find an order to confirm.`);
    }
  }

  else if (confirmationNo) {
    const lastOrder = orderSessions[customerNumber];
    if (lastOrder?.total > 0) {
      await sendWhatsAppMessage(customerNumber, `Would you like to add more items to your order or cancel it? Please reply with 'add more' or 'cancel'.`);
    } else {
      await sendWhatsAppMessage(customerNumber, `❌ No active order found.`);
    }
  }

  else if (customerText.includes("add more")) {
    await sendWhatsAppMessage(customerNumber, `Sure, send the items you’d like to add to your current order.`);
  }

  else if (customerText.includes("cancel")) {
    delete orderSessions[customerNumber];
    await sendWhatsAppMessage(customerNumber, `✅ Your order has been cancelled.`);
  }

  else {
    const parsedOrder = parseOrderLocally(customerText);
    const validItems = {};

    for (const item in parsedOrder) {
      if (MENU.hasOwnProperty(item)) {
        let qty = parsedOrder[item];
        if (qty > 20) qty = 20;
        validItems[item] = qty;
      }
    }

    if (Object.keys(validItems).length > 0) {
      let summary = "🧾 Your order:\n";
      let total = 0;
      for (const item in validItems) {
        const qty = validItems[item];
        const price = MENU[item];
        summary += `- ${qty}x ${item} ($${price * qty})\n`;
        total += price * qty;
      }
      summary += `\n💰 Total: $${total}\nReply 'yes' to confirm or 'no' to modify.`;

      if (!orderSessions[customerNumber]) orderSessions[customerNumber] = { items: {}, total: 0 };
      for (const item in validItems) {
        orderSessions[customerNumber].items[item] = (orderSessions[customerNumber].items[item] || 0) + validItems[item];
      }
      orderSessions[customerNumber].total += total;

      await sendWhatsAppMessage(customerNumber, summary);
    } else {
      await sendWhatsAppMessage(customerNumber, "❌ Sorry, we didn’t understand your order. Please mention items like: '2 chicken biryani and 1 coke'.");
    }
  }

  res.sendStatus(200);
});

function formatMenu() {
  return Object.entries(MENU)
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

// Basic parser using keyword matching and quantity extraction
function parseOrderLocally(text) {
  const result = {};
  const words = text.toLowerCase().split(/[\s,]+/);
  const joined = text.toLowerCase();

  for (const item of Object.keys(MENU)) {
    const pattern = new RegExp(`(\\d+)?\\s*${item}`, 'gi');
    let match;
    while ((match = pattern.exec(joined)) !== null) {
      const quantity = parseInt(match[1]) || 1;
      result[item] = (result[item] || 0) + quantity;
    }
  }

  return result;
}

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
