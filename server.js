const express = require('express');
const axios = require('axios');
const { OpenAI } = require("openai");

const app = express();
const port = process.env.PORT || 3000;

// ✅ Replace with your OpenAI key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// ✅ Replace with your actual token + phone number ID from Meta
const accessToken = "EAAe4ZCBaZBPoABO9nmWefpwCsJfPj7wxdkYgtg8nIUrZBSIRsTZBZA4c0c3W2QyqkQmRG7pQlsTRhdcxEynt7eT2kHFHzo20ZCIZCvArkihBZB6yS3ZBEjxZBkXlagGJsy76AEtMcRSWzp9xgcUhA34AkuXnRmcDmMkO1woZC1AvEY09p1JC7DoGZCz268d3vEo0RgZDZD";
const phoneNumberId = "634093596444481";

// Simple menu for price lookup
const MENU = {
  "chicken biryani": 12,
  "coke": 3,
  "naan": 2,
  "butter chicken": 10
};

// Temp store for order sessions
const orderSessions = {};

app.use(express.json());

// Webhook verification
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
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

// Main webhook handler
app.post('/webhook', async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];

  if (message?.type === 'text') {
    const customerText = message.text.body.trim().toLowerCase();
    const customerNumber = message.from;

    // ✅ Handle confirmation
    if (customerText === "yes") {
      const lastOrder = orderSessions[customerNumber];
      if (lastOrder) {
        console.log("✅ Confirmed order:", lastOrder);
        await sendWhatsAppMessage(customerNumber, "✅ Your order has been confirmed! We'll start preparing it.");
        delete orderSessions[customerNumber];
      } else {
        await sendWhatsAppMessage(customerNumber, "❌ Sorry, we couldn't find an order to confirm.");
      }
    }

    // ❌ Handle cancellation
    else if (customerText === "no") {
      await sendWhatsAppMessage(customerNumber, "❌ Your order has been cancelled.");
      delete orderSessions[customerNumber];
    }

    // 🤖 Handle new AI-based order
    else {
      const aiOrder = await parseOrderWithAI(customerText);

      if (aiOrder && Object.keys(aiOrder).length > 0) {
        let summary = "🧾 Your order:\n";
        let total = 0;

        for (const item in aiOrder) {
          const qty = aiOrder[item];
          const price = MENU[item.toLowerCase()] || 0;
          summary += `- ${qty}x ${item} ($${price * qty})\n`;
          total += price * qty;
        }

        summary += `\n💰 Total: $${total}\nReply 'yes' to confirm or 'no' to cancel.`;
        orderSessions[customerNumber] = { items: aiOrder, total };

        await sendWhatsAppMessage(customerNumber, summary);
      } else {
        await sendWhatsAppMessage(customerNumber, "Sorry, we couldn't understand your order. Please try something like: '2 biryanis and a Coke'.");
      }
    }
  }

  res.sendStatus(200);
});

// 🔁 Send message back to WhatsApp
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

// 🧠 Parse order using OpenAI
async function parseOrderWithAI(text) {
  const prompt = `Extract a structured food order from this message:
"${text}"
Return a JSON object in this format:
{"chicken biryani": 2, "naan": 1, "coke": 1}
Only include items you recognize.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    });

    const content = response.choices[0].message.content.trim();
    console.log("🧠 GPT Response:", content);

    return JSON.parse(content);
  } catch (error) {
    console.error("❌ AI parsing failed:", error.response?.data || error.message);
    return null;
  }
}

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
