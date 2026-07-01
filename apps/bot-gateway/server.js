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
// Subscriptions require the gateway link/secret AND the admin master switch.
// `subscriptionsConfigured` is fixed at boot; `subscriptionsAdminEnabled` is
// polled from the gateway so an admin can turn the feature on/off at runtime.
// Default off until the first successful poll (fail-safe: no paywall shown).
const subscriptionsConfigured = Boolean(GATEWAY_HTTP_URL && BOT_API_SECRET);
let subscriptionsAdminEnabled = false;
function subscriptionsOn() {
  return subscriptionsConfigured && subscriptionsAdminEnabled;
}

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

function sendPhoto(chatId, photoUrl, caption) {
  return tg("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    ...(caption ? { caption: caption.slice(0, 1024), parse_mode: "HTML" } : {})
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

// Menus are built on demand so the Subscribe / My-status buttons only appear
// while subscriptions are enabled. When disabled, only "Take a quiz" shows.
const SUBSCRIBE_BTN = "💳 Subscribe";
const STATUS_BTN = "📊 My status";
const QUIZ_BTN = "▶️ Take a quiz";
function mainMenu() {
  const rows = [];
  if (subscriptionsOn()) {
    rows.push([{ text: SUBSCRIBE_BTN, callback_data: "menu:subscribe" }]);
    rows.push([{ text: STATUS_BTN, callback_data: "menu:status" }]);
  }
  rows.push([{ text: QUIZ_BTN, callback_data: "menu:quiz" }]);
  return { inline_keyboard: rows };
}

// Persistent buttons that stay docked above the text box — no typing needed.
function replyKeyboard() {
  const rows = subscriptionsOn()
    ? [[{ text: SUBSCRIBE_BTN }], [{ text: STATUS_BTN }, { text: QUIZ_BTN }]]
    : [[{ text: QUIZ_BTN }]];
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Tap a button below 👇"
  };
}

// Map a typed command, a reply-keyboard tap, or a slash command to an action.
function matchMenuCommand(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  if (t === "/start" || t === "start" || t === "menu" || t === "/menu") return "start";
  if (t.startsWith("/subscribe") || t.includes("subscribe")) return "subscribe";
  if (t.startsWith("/status") || t.includes("status")) return "status";
  if (t.startsWith("/quiz") || t.includes("quiz")) return "quiz";
  return null;
}

// Register the bot's command list (powers the "Menu" button by the text box).
async function setupBotMenu() {
  const commands = [{ command: "quiz", description: "▶️ Take a quiz" }];
  if (subscriptionsOn()) {
    commands.unshift(
      { command: "subscribe", description: "💳 Subscribe / see plans" },
      { command: "status", description: "📊 My subscription status" }
    );
  }
  await tg("setMyCommands", { commands });
  await tg("setChatMenuButton", { menu_button: { type: "commands" } });
}

// Remembers which tier a user is paying for, until they send their proof.
const pendingTier = new Map();

async function showWelcome(chatId, from) {
  let extra = "";
  // First contact creates the subscriber, which may grant a one-time free trial.
  if (subscriptionsOn()) {
    try {
      const data = await gatewayApi("/bot/subscription/subscriber", {
        method: "POST",
        body: {
          telegramId: String(chatId),
          telegramUsername: from?.username || "",
          displayName: cleanText([from?.first_name, from?.last_name].filter(Boolean).join(" "), 48)
        }
      });
      if (data.trialGranted) {
        const d = data.trialDays || 1;
        extra = `\n\n🎁 <b>Welcome gift:</b> you've got <b>${d} free day${d === 1 ? "" : "s"}</b> to try everything — tap ▶️ <b>Take a quiz</b> to start now!`;
      } else if (data.subscriber && data.subscriber.active) {
        extra = "\n\n✅ Your access is active — tap ▶️ <b>Take a quiz</b>.";
      }
    } catch (e) { /* non-fatal */ }
  }
  const welcome = subscriptionsOn()
    ? "👋 Welcome to <b>LyHuor Learning</b>!\n\nSolo quizzes are for subscribers. Use the buttons below 👇\n\n💳 <b>Subscribe</b> — choose a plan and pay\n📊 <b>My status</b> — check your access\n▶️ <b>Take a quiz</b> — start learning"
    : "👋 Welcome to <b>LyHuor Learning</b>!\n\nTap ▶️ <b>Take a quiz</b> below to start learning 👇";
  await sendText(chatId, welcome + extra, replyKeyboard());
}

async function showTiers(chatId) {
  if (!subscriptionsOn()) {
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
    await sendText(chatId, "That plan is no longer available. Tap Subscribe to see current plans.", mainMenu());
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
  const planLine = `You selected <b>$${tier.priceUsd} — ${tier.durationDays} day${tier.durationDays === 1 ? "" : "s"}</b>.`;
  const followUp = `${info}\n\n📸 After paying, send a <b>photo of your receipt</b> or type the <b>transaction ID</b> here.`;
  if (data.paymentQrUrl) {
    // Show the KHQR payment image, then the instructions.
    await sendPhoto(chatId, data.paymentQrUrl, `${planLine}\n\nScan this KHQR to pay <b>$${tier.priceUsd}</b>.`);
    await sendText(chatId, followUp);
  } else {
    await sendText(chatId, `${planLine}\n\n${followUp}`);
  }
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
      mainMenu()
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

// Forward a subscriber's incoming message to the gateway so it appears in the
// admin chat thread.
async function forwardInbound(chatId, from, message) {
  if (!subscriptionsOn()) return;
  let kind = "text";
  let body = message.text || "";
  let fileId = null, fileName = null, latitude, longitude;
  if (Array.isArray(message.photo) && message.photo.length) {
    kind = "photo"; fileId = message.photo[message.photo.length - 1].file_id; body = message.caption || "";
  } else if (message.document) {
    kind = "document"; fileId = message.document.file_id; fileName = message.document.file_name || ""; body = message.caption || "";
  } else if (message.location) {
    kind = "location"; latitude = message.location.latitude; longitude = message.location.longitude;
  } else if (message.voice || message.audio || message.video || message.sticker) {
    kind = "document"; const f = message.voice || message.audio || message.video; if (f) fileId = f.file_id; body = message.caption || "[media]";
  }
  try {
    await gatewayApi("/bot/subscription/inbound", {
      method: "POST",
      body: {
        telegramId: String(chatId),
        telegramUsername: from?.username || "",
        displayName: cleanText([from?.first_name, from?.last_name].filter(Boolean).join(" "), 48),
        kind, body: String(body).slice(0, 4000), fileId, fileName, latitude, longitude
      }
    });
  } catch (error) {
    console.error("Forward inbound failed:", error.message);
  }
}

async function showStatus(chatId) {
  if (!subscriptionsOn()) {
    await sendText(chatId, "Subscriptions are not available right now.");
    return;
  }
  const data = await gatewayApi(`/bot/subscription/status?telegramId=${encodeURIComponent(chatId)}`);
  if (!data.exists || !data.subscriber) {
    await sendText(chatId, "You don't have a subscription yet. Tap <b>Subscribe</b> to choose a plan.", mainMenu());
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
      mainMenu()
    );
  }
}

async function startQuiz(chatId) {
  // With subscriptions off, quizzes are free — send the link straight away.
  if (!subscriptionsOn()) {
    await sendText(
      chatId,
      "Great — tap below to start. You can pick your grade, subject, language, and curriculum on the quiz page.",
      { inline_keyboard: [[{ text: "▶️ Start Quiz", url: buildQuizUrl({ source: "telegram", sourceUserId: chatId }) }]] }
    );
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
    await sendText(chatId, "You need an active subscription to take solo quizzes. Tap <b>Subscribe</b> to get started.", mainMenu());
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

  // A menu button / command always wins — even mid-payment, so a user can bail.
  const cmd = matchMenuCommand(message.text || "");
  if (cmd === "subscribe") return void (await showTiers(chatId));
  if (cmd === "status") return void (await showStatus(chatId));
  if (cmd === "quiz") return void (await startQuiz(chatId));
  if (cmd === "start") return void (await showWelcome(chatId, from));

  // A real message — log it to the admin chat thread.
  await forwardInbound(chatId, from, message);

  // If mid-purchase, also treat a photo / text as the payment proof.
  if (subscriptionsOn() && pendingTier.has(String(chatId))) {
    if (Array.isArray(message.photo) && message.photo.length) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      if (await submitProof(chatId, from, { proofFileId: fileId, proofText: cleanText(message.caption, 200) })) return;
    } else if (message.text && !message.text.startsWith("/")) {
      if (await submitProof(chatId, from, { proofText: cleanText(message.text, 200) })) return;
    }
  }

  // Otherwise acknowledge — their message is now in the admin inbox.
  await sendText(chatId, "✅ Got your message — our team will reply soon. Use the buttons below anytime 👇", replyKeyboard());
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
    subscriptionsConfigured,
    subscriptionsEnabled: subscriptionsOn(),
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

// Poll the gateway for the admin master switch. When it flips, re-register the
// bot's slash commands so the Subscribe/Status entries appear or disappear.
async function refreshBotConfig() {
  if (!subscriptionsConfigured) return;
  try {
    const data = await gatewayApi("/bot/config");
    const next = Boolean(data.subscriptionsEnabled);
    if (next !== subscriptionsAdminEnabled) {
      subscriptionsAdminEnabled = next;
      console.log(`Subscriptions ${next ? "enabled" : "disabled"} by admin.`);
      if (TELEGRAM_BOT_TOKEN) await setupBotMenu().catch((e) => console.error("Bot menu refresh failed:", e.message));
    }
  } catch (e) {
    // Keep the last known value if the gateway is briefly unreachable.
  }
}

app.listen(PORT, () => {
  console.log(`Bot gateway listening on ${PORT} (subscriptions ${subscriptionsConfigured ? "configured" : "off"})`);
  if (subscriptionsConfigured) {
    refreshBotConfig().finally(() => {
      if (TELEGRAM_BOT_TOKEN) {
        setupBotMenu().then(() => console.log("Telegram bot menu/commands registered.")).catch((e) => console.error("Bot menu setup failed:", e.message));
      }
    });
    setInterval(refreshBotConfig, 60_000);
  } else if (TELEGRAM_BOT_TOKEN) {
    setupBotMenu().then(() => console.log("Telegram bot menu/commands registered.")).catch((e) => console.error("Bot menu setup failed:", e.message));
  }
});
