const express = require('express');
const axios = require('axios');
const { OpenAI } = require("openai");

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: "sk-REPLACE_WITH_YOUR_KEY" });
const accessToken = "EAAe4ZCBaZBPoABO9nmWefpwCsJfPj7wxdkYgtg8nIUrZBSIRsTZBZA4c0c3W2QyqkQmRG7pQlsTRhdcxEynt7eT2kHFHzo20ZCIZCvArkihBZB6yS3ZBEjxZBkXlagGJsy76AEtMcRSWzp9xgcUhA34AkuXnRmcDmMkO1woZC1AvEY09p1JC7DoGZCz268d3vEo0RgZDZD";
const phoneNumberId = "634093596444481";

const MENU = {
  "chicken biryani": 12,
  "coke": 3,
  "naan": 2,
  "butter chicken": 10
};

const orderSessions = {};
const greetedUsers = new Set();

app.use(express.json());

app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = "REPLACE_WITH_YOUR_VERIFY_TOKEN";
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

  if (message?.type === 'text') {
    const customerText = message.text.body.trim().toLowerCase();
    const customerNumber = message.from;

    if (!greetedUsers.has(customerNumber)) {
      greetedUsers.add(customerNumber);
      await sendWhatsAppMessage(customerNumber, `👋 Welcome to our restaurant! Here's our menu:\n${formatMenu()}`);
    }

    const confirmationYes = ["yes", "yeah", "y"].includes(customerText);
    const confirmationNo = ["no", "nah", "n"].includes(customerText);

    if (confirmationYes) {
      const lastOrder = orderSessions[customerNumber];
      if (lastOrder) {
        await sendWhatsAppMessage(customerNumber, `✅ Your order has been confirmed! We'll start preparing it.`);
        delete orderSessions[customerNumber];
      } else {
        await sendWhatsAppMessage(customerNumber, `❌ Sorry, we couldn't find an order to confirm.`);
      }
    }

    else if (confirmationNo) {
      const lastOrder = orderSessions[customerNumber];
      if (lastOrder) {
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
      const validItems = {};
      for (const item in aiOrder || {}) {
        if (MENU.hasOwnProperty(item.toLowerCase())) {
          validItems[item] = aiOrder[item];
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
  const prompt = `Extract a structured food order from this message:\n"${text}"\nReturn a JSON object only using these menu items: ${Object.keys(MENU).join(", ")}. Format: {\"item\": quantity}`;
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
