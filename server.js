const express = require('express');
const axios = require('axios');
const { OpenAI } = require("openai");

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const accessToken = process.env.ACCESS_TOKEN;
const phoneNumberId = "634093596444481";
//const phoneNumberId = process.env.PHONE_NUMBER_ID;

const MENU = {
  "chicken biryani": 12,
  "coke": 3,
  "naan": 2,
  "butter chicken": 10
};

const orderSessions = {};

app.use(express.json());

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

app.post('/webhook', async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];

  if (message?.type === 'text') {
    const customerText = message.text.body.trim().toLowerCase();
    const customerNumber = message.from;

    const affirmatives = ['yes', 'yeah', 'y', 'yep', 'sure'];
    const negatives = ['no', 'nah', 'n', 'nope'];

    if (affirmatives.includes(customerText)) {
      const lastOrder = orderSessions[customerNumber];
      if (lastOrder) {
        await sendWhatsAppMessage(customerNumber, "✅ Your order has been confirmed! We'll start preparing it.");
        delete orderSessions[customerNumber];
      } else {
        await sendWhatsAppMessage(customerNumber, "❌ Sorry, we couldn't find an order to confirm.");
      }
    } else if (negatives.includes(customerText)) {
      await sendWhatsAppMessage(customerNumber, "❌ Your order has been cancelled.");
      delete orderSessions[customerNumber];
    } else {
      const aiOrder = await parseOrderWithAI(customerText);

      if (!aiOrder || Object.keys(aiOrder).length === 0) {
        await sendWhatsAppMessage(customerNumber,
          "❌ Sorry, we couldn't understand your order.\nPlease use a format like:\n“2 chicken biryani and 1 coke”."
        );
        return res.sendStatus(200);
      }

      let summary = "🧾 Your order:\n";
      let total = 0;
      let allValid = true;

      for (const item in aiOrder) {
        if (!MENU[item.toLowerCase()]) {
          allValid = false;
          break;
        }
      }

      if (!allValid) {
        await sendWhatsAppMessage(customerNumber,
          "❌ We only accept items from our menu.\nTry something like:\n“1 naan and 1 butter chicken”."
        );
        return res.sendStatus(200);
      }

      for (const item in aiOrder) {
        const qty = aiOrder[item];
        const price = MENU[item.toLowerCase()];
        summary += `- ${qty}x ${item} ($${price * qty})\n`;
        total += price * qty;
      }

      summary += `\n💰 Total: $${total}\nReply 'yes' to confirm or 'no' to cancel.`;
      orderSessions[customerNumber] = { items: aiOrder, total };

      await sendWhatsAppMessage(customerNumber, summary);
    }
  }

  res.sendStatus(200);
});

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
  const prompt = `Extract a structured food order from this message:
"${text}"
Return a JSON object ONLY like this:
{"chicken biryani": 2, "naan": 1, "coke": 1}
Only include items that exactly match the menu: chicken biryani, naan, butter chicken, coke.
`;

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
  console.log("📞 phoneNumberId from env:", phoneNumberId);

});
