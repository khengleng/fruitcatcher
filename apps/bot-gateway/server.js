const express = require("express");

const app = express();
const PORT = Number(process.env.PORT || 3003);
const CONTROLLER_URL = process.env.CONTROLLER_URL || "https://mytv.cambobia.com";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const MESSENGER_VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN || "";
const MESSENGER_PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN || "";
// Subscriptions: the bot talks to the gateway with a shared secret.
const GATEWAY_HTTP_URL = (process.env.GATEWAY_HTTP_URL || "").replace(/\/$/, "");
const BOT_API_SECRET = process.env.BOT_API_SECRET || "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
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
  if (options.sub) {
    url.searchParams.set("sub", String(options.sub));
  }

  url.searchParams.set("curriculum", cleanText(options.curriculum || "cambodia_moeys", 32));
  url.searchParams.set("language", cleanText(options.language || "khmer", 16));
  url.searchParams.set("subject", cleanText(options.subject || "math", 32));
  url.searchParams.set("grade", String(Math.min(12, Math.max(2, Math.round(Number(options.grade || 6))))));
  return url.toString();
}

// ===== Gateway (subscription) API =====
const subscriptionsEnabled = Boolean(GATEWAY_HTTP_URL && BOT_API_SECRET);

async function gatewayApi(path, { method = "GET", body } = {}) {
  const res = await fetch(`${GATEWAY_HTTP_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-bot-secret": BOT_API_SECRET },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Gateway ${res.status}`);
  }
  return data;
}

// ===== Telegram API =====
async function tg(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) return false;
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

function sendText(chatId, text, replyMarkup) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

function answerCallback(callbackId, text) {
  return tg("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toUTCString().replace(/ GMT$/, " UTC");
  } catch (e) {
    return String(iso);
  }
}

const mainMenu = {
  inline_keyboard: [
    [{ text: "💳 Subscribe", callback_data: "menu:subscribe" }],
    [{ text: "📊 My status", callback_data: "menu:status" }],
    [{ text: "▶️ Take a quiz", callback_data: "menu:quiz" }]
  ]
};

// Remembers which tier a user is paying for, until they send their proof.
const pendingTier = new Map();

async function showWelcome(chatId) {
  await sendText(
    chatId,
    "👋 Welcome to <b>LyHuor Learning</b>!\n\nSolo quizzes are for subscribers. Choose a plan, pay, and send your receipt here — an admin will activate your access.",
    mainMenu
  );
}

async function showTiers(chatId) {
  if (!subscriptionsEnabled) {
    await sendText(chatId, "Subscriptions are not available right now. Please try again later.");
    return;
  }
  const data = await gatewayApi("/bot/subscription/tiers");
  const tiers = data.tiers || [];
  if (!tiers.length) {
    await sendText(chatId, "No subscription plans are available right now. Please check back soon.");
    return;
  }
  const rows = tiers.map((t) => [{
    text: `💵 $${t.priceUsd} — ${t.durationDays} day${t.durationDays === 1 ? "" : "s"}`,
    callback_data: `tier:${t.id}`
  }]);
  await sendText(chatId, "Choose your subscription plan:", { inline_keyboard: rows });
}

async function chooseTier(chatId, tierId, from) {
  const data = await gatewayApi("/bot/subscription/tiers");
  const tier = (data.tiers || []).find((t) => t.id === tierId);
  if (!tier) {
    await sendText(chatId, "That plan is no longer available. Tap Subscribe to see current plans.", mainMenu);
    return;
  }
  pendingTier.set(String(chatId), { tierId: tier.id, name: tier.name, priceUsd: tier.priceUsd, durationDays: tier.durationDays });
  // Make sure a subscriber row exists.
  await gatewayApi("/bot/subscription/subscriber", {
    method: "POST",
    body: {
      telegramId: String(chatId),
      telegramUsername: from?.username || "",
      displayName: cleanText([from?.first_name, from?.last_name].filter(Boolean).join(" "), 48)
    }
  });
  const info = data.paymentInfo || "Transfer the amount and send your receipt here.";
  await sendText(
    chatId,
    `You selected <b>$${tier.priceUsd} — ${tier.durationDays} day${tier.durationDays === 1 ? "" : "s"}</b>.\n\n` +
    `${info}\n\n` +
    `📸 After paying, send a <b>photo of your receipt</b> or type the <b>transaction ID</b> here.`
  );
}

async function submitProof(chatId, from, { proofText, proofFileId }) {
  const pending = pendingTier.get(String(chatId));
  if (!pending) return false;
  try {
    const result = await gatewayApi("/bot/subscription/payments", {
      method: "POST",
      body: {
        telegramId: String(chatId),
        tierId: pending.tierId,
        telegramUsername: from?.username || "",
        displayName: cleanText([from?.first_name, from?.last_name].filter(Boolean).join(" "), 48),
        proofText: proofText || "",
        proofFileId: proofFileId || ""
      }
    });
    pendingTier.delete(String(chatId));
    await sendText(
      chatId,
      `✅ Thank you! Your payment for <b>${pending.name}</b> ($${pending.priceUsd}) is <b>pending approval</b>. ` +
      `You'll get access as soon as an admin confirms it.`,
      mainMenu
    );
    if (ADMIN_CHAT_ID) {
      const who = from?.username ? `@${from.username}` : cleanText([from?.first_name, from?.last_name].filter(Boolean).join(" "), 48) || String(chatId);
      await sendText(
        ADMIN_CHAT_ID,
        `🔔 New subscription payment\nFrom: ${who} (id ${chatId})\nPlan: ${pending.name} — $${pending.priceUsd}\n` +
        `Proof: ${proofFileId ? "photo receipt" : (proofText || "—")}\n\nApprove it in the Admin portal → Subscriptions.`
      );
    }
    return true;
  } catch (error) {
    console.error("Submit proof failed:", error.message);
    await sendText(chatId, "Sorry, we couldn't record that. Please try again or contact support.");
    return true;
  }
}

async function showStatus(chatId) {
  if (!subscriptionsEnabled) {
    await sendText(chatId, "Subscriptions are not available right now.");
    return;
  }
  const data = await gatewayApi(`/bot/subscription/status?telegramId=${encodeURIComponent(chatId)}`);
  if (!data.exists || !data.subscriber) {
    await sendText(chatId, "You don't have a subscription yet. Tap <b>Subscribe</b> to choose a plan.", mainMenu);
    return;
  }
  const s = data.subscriber;
  if (s.active) {
    await sendText(
      chatId,
      `✅ Your subscription is <b>active</b> until <b>${formatDate(s.activeUntil)}</b>.`,
      { inline_keyboard: [[{ text: "▶️ Take a quiz", url: buildQuizUrl({ source: "telegram", sourceUserId: chatId, sub: s.token }) }]] }
    );
  } else {
    const pending = data.latestPayment && data.latestPayment.status === "pending";
    await sendText(
      chatId,
      pending
        ? "⏳ Your latest payment is <b>pending approval</b>. We'll notify you once it's active."
        : "❌ You don't have an active subscription right now. Tap <b>Subscribe</b> to renew.",
      mainMenu
    );
  }
}

async function startQuiz(chatId) {
  if (!subscriptionsEnabled) {
    await sendText(chatId, "Quizzes are not available right now.");
    return;
  }
  const data = await gatewayApi(`/bot/subscription/status?telegramId=${encodeURIComponent(chatId)}`);
  if (data.subscriber && data.subscriber.active) {
    await sendText(
      chatId,
      "Great — tap below to start. You can pick your grade, subject, language, and curriculum on the quiz page.",
      { inline_keyboard: [[{ text: "▶️ Start Quiz", url: buildQuizUrl({ source: "telegram", sourceUserId: chatId, sub: data.subscriber.token }) }]] }
    );
  } else {
    await sendText(chatId, "You need an active subscription to take solo quizzes. Tap <b>Subscribe</b> to get started.", mainMenu);
  }
}

async function handleTelegramUpdate(update) {
  // Inline button taps.
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const data = String(cb.data || "");
    await answerCallback(cb.id);
    if (!chatId) return;
    if (data === "menu:subscribe") return void (await showTiers(chatId));
    if (data === "menu:status") return void (await showStatus(chatId));
    if (data === "menu:quiz") return void (await startQuiz(chatId));
    if (data.startsWith("tier:")) return void (await chooseTier(chatId, data.slice(5), cb.from));
    return;
  }

  const message = update.message || update.edited_message;
  if (!message) return;
  const chatId = message.chat?.id;
  const from = message.from || {};
  if (!chatId) return;

  // Payment proof: a photo (with a pending tier) or text that isn't a command.
  if (subscriptionsEnabled && pendingTier.has(String(chatId))) {
    if (Array.isArray(message.photo) && message.photo.length) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      const handled = await submitProof(chatId, from, { proofFileId: fileId, proofText: cleanText(message.caption, 200) });
      if (handled) return;
    } else if (message.text && !message.text.startsWith("/")) {
      const handled = await submitProof(chatId, from, { proofText: cleanText(message.text, 200) });
      if (handled) return;
    }
  }

  const text = String(message.text || "").trim().toLowerCase();
  if (text === "/subscribe" || text === "subscribe") return void (await showTiers(chatId));
  if (text === "/status" || text === "status") return void (await showStatus(chatId));
  if (text === "/quiz" || text === "quiz") return void (await startQuiz(chatId));
  // /start or anything else → welcome menu.
  await showWelcome(chatId);
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
              { type: "web_url", url: quizUrl, title: "Start Quiz", webview_height_ratio: "full" }
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
    subscriptionsEnabled,
    adminNotify: Boolean(ADMIN_CHAT_ID),
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
    await handleTelegramUpdate(req.body || {});
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
  console.log(`Bot gateway listening on ${PORT} (subscriptions ${subscriptionsEnabled ? "on" : "off"})`);
});
