const express = require("express");

const app = express();
const PORT = Number(process.env.PORT || 3003);
const CONTROLLER_URL = process.env.CONTROLLER_URL || "https://mytv.cambobia.com";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const MESSENGER_VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN || "";
const MESSENGER_PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN || "";
const startedAt = new Date().toISOString();

app.use(express.json({ limit: "1mb" }));

function cleanText(value, maxLength = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildQuizUrl(options = {}) {
  const url = new URL(CONTROLLER_URL);
  url.searchParams.set("mode", "solo");
  url.searchParams.set("source", cleanText(options.source || "web", 24));

  if (options.sourceUserId) {
    url.searchParams.set("sourceUserId", cleanText(options.sourceUserId, 64));
  }
  if (options.name) {
    url.searchParams.set("name", cleanText(options.name, 48));
  }

  url.searchParams.set("curriculum", cleanText(options.curriculum || "cambodia_moeys", 32));
  url.searchParams.set("language", cleanText(options.language || "khmer", 16));
  url.searchParams.set("subject", cleanText(options.subject || "math", 32));
  url.searchParams.set("grade", String(Math.min(12, Math.max(2, Math.round(Number(options.grade || 6))))));
  return url.toString();
}

async function sendTelegramMessage(chatId, text, quizUrl) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) {
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Start Quiz", url: quizUrl }],
          [{ text: "Khmer Math Grade 6", url: buildQuizUrl({ source: "telegram", sourceUserId: chatId, curriculum: "cambodia_moeys", language: "khmer", subject: "math", grade: 6 }) }],
          [{ text: "English International Grade 6", url: buildQuizUrl({ source: "telegram", sourceUserId: chatId, curriculum: "international", language: "english", subject: "english", grade: 6 }) }]
        ]
      }
    })
  });

  return response.ok;
}

async function sendMessengerMessage(recipientId, text, quizUrl) {
  if (!MESSENGER_PAGE_ACCESS_TOKEN || !recipientId) {
    return false;
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(MESSENGER_PAGE_ACCESS_TOKEN)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text,
            buttons: [
              {
                type: "web_url",
                url: quizUrl,
                title: "Start Quiz",
                webview_height_ratio: "full"
              }
            ]
          }
        }
      }
    })
  });

  return response.ok;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    startedAt,
    uptimeSec: Math.round(process.uptime()),
    controllerUrl: CONTROLLER_URL,
    telegramConfigured: Boolean(TELEGRAM_BOT_TOKEN),
    messengerConfigured: Boolean(MESSENGER_PAGE_ACCESS_TOKEN && MESSENGER_VERIFY_TOKEN)
  });
});

app.get("/quiz-link", (req, res) => {
  res.json({
    url: buildQuizUrl({
      source: req.query.source || "web",
      sourceUserId: req.query.sourceUserId || req.query.uid,
      name: req.query.name,
      curriculum: req.query.curriculum,
      language: req.query.language,
      subject: req.query.subject,
      grade: req.query.grade
    })
  });
});

app.post("/telegram/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body?.message || req.body?.edited_message;
    const chatId = message?.chat?.id;
    const from = message?.from || {};
    const name = cleanText([from.first_name, from.last_name].filter(Boolean).join(" "), 48);
    const quizUrl = buildQuizUrl({
      source: "telegram",
      sourceUserId: from.id || chatId,
      name,
      curriculum: "cambodia_moeys",
      language: "khmer",
      subject: "math",
      grade: 6
    });
    await sendTelegramMessage(
      chatId,
      "Choose Start Quiz, then select your grade, subject, language, and curriculum on the quiz page.",
      quizUrl
    );
  } catch (error) {
    console.error("Telegram webhook failed:", error);
  }
});

app.get("/messenger/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === MESSENGER_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

app.post("/messenger/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId || !event.message) {
          continue;
        }

        const quizUrl = buildQuizUrl({
          source: "messenger",
          sourceUserId: senderId,
          curriculum: "cambodia_moeys",
          language: "khmer",
          subject: "math",
          grade: 6
        });
        await sendMessengerMessage(
          senderId,
          "Open the quiz page, then choose your grade, subject, language, and curriculum.",
          quizUrl
        );
      }
    }
  } catch (error) {
    console.error("Messenger webhook failed:", error);
  }
});

app.listen(PORT, () => {
  console.log(`Bot gateway listening on ${PORT}`);
});
