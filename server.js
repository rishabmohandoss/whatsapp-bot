const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

const accessToken = process.env.ACCESS_TOKEN || "your-local-access-token";
const phoneNumberId = "634093596444481";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "your-local-verify-token";

if (!accessToken) console.warn("⚠️ accessToken is undefined!");
if (!phoneNumberId) console.warn("⚠️ phoneNumberId is undefined!");

const MENUS = {
  indian: {
    "chicken biryani": 12,
    "coke": 3,
    "naan": 2,
    "butter chicken": 10
  },
  italian: {
    "margherita pizza": 11,
    "garlic bread": 4,
    "spaghetti bolognese": 13,
    "lasagna": 14,
    "tiramisu": 6
  }
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
    orderSessions[customerNumber] = { greeted: false, restaurant: null, items: {}, total: 0 };
  }

  const session = orderSessions[customerNumber];

  if (!session.greeted) {
    session.greeted = true;
    await sendWhatsAppMessage(customerNumber, `👋 Welcome! Would you like to order from the *Indian Restaurant* or *Italian Restaurant*?`);
    return res.sendStatus(200);
  }

  if (!session.restaurant) {
    if (customerText.includes("indian")) {
      session.restaurant = "indian";
      await sendWhatsAppMessage(customerNumber, `🇮🇳 Great choice! Here's our Indian menu:\n${formatMenu("indian")}`);
    } else if (customerText.includes("italian")) {
      session.restaurant = "italian";
      await sendWhatsAppMessage(customerNumber, `🇮🇹 Buon appetito! Here's our Italian menu:\n${formatMenu("italian")}`);
    } else {
      await sendWhatsAppMessage(customerNumber, `❓ Please reply with 'Indian' or 'Italian' to choose a restaurant.`);
    }
    return res.sendStatus(200);
  }

  const confirmationYes = ["yes", "yeah", "y"].includes(customerText);
  const confirmationNo = ["no", "nah", "n"].includes(customerText);

  if (confirmationYes) {
    if (session.total > 0) {
      await sendWhatsAppMessage(customerNumber, `✅ Your order has been confirmed! We'll start preparing it.`);
      await sendWhatsAppMessage(customerNumber, `🧾 To complete your payment, please visit: https://buy.stripe.com/14A14mbBX8TmeaI3alf7i00`);
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
    const parsedOrder = parseOrderLocally(customerText, session.restaurant);
    const validItems = {};

    for (const item in parsedOrder) {
      if (MENUS[session.restaurant].hasOwnProperty(item)) {
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
        const price = MENUS[session.restaurant][item];
        summary += `- ${qty}x ${item} ($${price * qty})\n`;
        total += price * qty;
      }
      summary += `\n💰 Total: $${total}\nReply 'yes' to confirm or 'no' to modify.`;

      for (const item in validItems) {
        session.items[item] = (session.items[item] || 0) + validItems[item];
      }
      session.total += total;

      await sendWhatsAppMessage(customerNumber, summary);
    } else {
      await sendWhatsAppMessage(customerNumber, `❌ Sorry, I didn’t understand your order. Please use phrases like: '2 biryanis and 1 coke' or '1 lasagna and 2 garlic bread'.`);
    }
  }

  res.sendStatus(200);
});

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

function parseOrderLocally(text, restaurantType) {
  const result = {};
  const joined = text.toLowerCase();

  for (const item of Object.keys(MENUS[restaurantType])) {
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
