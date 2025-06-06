const express = require('express');
const axios = require('axios');
const { OpenAI } = require("openai");

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const accessToken = process.env.ACCESS_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

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
    orderSessions[customerNumber] = { greeted: true, items: {}, total: 0 };
    await sendWhatsAppMessage(customerNumber, `👋 Welcome to our restaurant! Here's our menu:\n${formatMenu()}`);
  }

  const confirmationYes = ["yes", "yeah", "y"].includes(customerText);
  const confirmationNo = ["no", "nah", "n"].includes(customerText);

  if (confirmationYes) {
    const lastOrder = orderSessions[customerNumber];
    if (lastOrder?.total > 0) {
      await sendWhatsAppMessage(customerNumber, `✅ Your order has been confirmed! We'll start preparing it.`);
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
    const aiOrder = await parseOrderWithAI(customerText);
    console.log("Parsed order:", aiOrder);
    const validItems = {};
    for (const item in aiOrder || {}) {
      if (MENU.hasOwnProperty(item.toLowerCase())) {
        let qty = aiOrder[item];
        if (qty > 20) qty = 20;
        validItems[item] = qty;
      }
    }

    if (Object.keys(validItems).length > 0) {
      let summary = "🧾 Your order:\n";
      let total = 0;
      for (const item in validItems) {
        const qty = validItems[item];
        const price = MENU[item.toLowerCase()] || 0;
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
      const fallback = await fallbackAI(customerText);
      await sendWhatsAppMessage(customerNumber, fallback);
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

async function parseOrderWithAI(text) {
  const prompt = `You are a food ordering assistant. The menu is: ${Object.entries(MENU).map(([k, v]) => `${k} $${v}`).join(', ')}.\nExtract only valid menu items and quantities from this message: "${text}"\nRespond only with JSON like: {"naan": 1, "coke": 2}`;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    });
    return JSON.parse(response.choices[0].message.content.trim());
  } catch (error) {
    console.error("❌ AI parsing failed:", error.response?.data || error.message);
    return {};
  }
}

async function fallbackAI(text) {
  const fallbackPrompt = `You are a restaurant bot. The user sent this message: \"${text}\". If it's an order, try to extract items. If it's a question, answer helpfully. If it's not understandable, say: 'Sorry, I didn’t understand that. Please order like: 2 biryanis and a coke.'`;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: fallbackPrompt }],
      temperature: 0.7
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    return "Sorry, I didn’t understand that. Please order like: 2 biryanis and a coke.";
  }
}

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
