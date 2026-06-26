(function () {
  var cfg = window.FRUIT_CATCHER_CONFIG || {};
  var gatewayUrl = cfg.gatewayHttpUrl || "";
  if (!gatewayUrl) return;

  var history = [];
  var sessionId = null;
  var sending = false;

  var css = ""
    + ".sw-btn{position:fixed;right:18px;bottom:18px;z-index:99998;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;"
    + "background:#ffd34f;color:#08111d;font-size:24px;box-shadow:0 10px 24px rgba(0,0,0,.3);}"
    + ".sw-panel{position:fixed;right:18px;bottom:84px;z-index:99999;width:min(360px,92vw);height:min(520px,72vh);display:none;"
    + "flex-direction:column;background:#0f2238;color:#f6f8fb;border:1px solid rgba(255,255,255,.12);border-radius:16px;overflow:hidden;"
    + "box-shadow:0 18px 50px rgba(0,0,0,.4);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}"
    + ".sw-panel.open{display:flex;}"
    + ".sw-head{padding:12px 14px;background:#112033;font-weight:800;display:flex;justify-content:space-between;align-items:center;}"
    + ".sw-head button{background:none;border:0;color:#9fb2c9;font-size:20px;cursor:pointer;}"
    + ".sw-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;}"
    + ".sw-msg{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;}"
    + ".sw-user{align-self:flex-end;background:#ffd34f;color:#08111d;border-bottom-right-radius:4px;}"
    + ".sw-bot{align-self:flex-start;background:#1b3151;color:#f6f8fb;border-bottom-left-radius:4px;}"
    + ".sw-foot{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.1);}"
    + ".sw-foot input{flex:1;border:0;outline:none;border-radius:12px;padding:11px;background:#1b3151;color:#f6f8fb;font-size:14px;}"
    + ".sw-foot button{border:0;border-radius:12px;padding:0 16px;background:#69e6a6;color:#08111d;font-weight:800;cursor:pointer;}"
    + ".sw-foot button:disabled{opacity:.5;}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement("button");
  btn.className = "sw-btn";
  btn.setAttribute("aria-label", "Help and support");
  btn.textContent = "💬";

  var panel = document.createElement("div");
  panel.className = "sw-panel";
  panel.innerHTML = ""
    + '<div class="sw-head"><span>💬 Help &amp; Support</span><button aria-label="Close" id="swClose">×</button></div>'
    + '<div class="sw-body" id="swBody"></div>'
    + '<div class="sw-foot"><input id="swInput" placeholder="Ask about the platform…" maxlength="2000"><button id="swSend">Send</button></div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var body = panel.querySelector("#swBody");
  var input = panel.querySelector("#swInput");
  var sendBtn = panel.querySelector("#swSend");

  function add(role, text) {
    var el = document.createElement("div");
    el.className = "sw-msg " + (role === "user" ? "sw-user" : "sw-bot");
    el.textContent = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  var greeted = false;
  function openPanel() {
    panel.classList.add("open");
    if (!greeted) {
      greeted = true;
      add("assistant", "Hi! I can help you use this learning platform — quizzes, classes, accounts, worksheets, and more. What do you need?");
    }
    input.focus();
  }

  btn.addEventListener("click", function () {
    if (panel.classList.contains("open")) panel.classList.remove("open");
    else openPanel();
  });
  panel.querySelector("#swClose").addEventListener("click", function () { panel.classList.remove("open"); });

  function userLabel() {
    try {
      if (localStorage.getItem("fruitcatcher_student_name")) return "student:" + localStorage.getItem("fruitcatcher_student_name");
    } catch (e) {}
    return "guest";
  }

  async function send() {
    var text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    sendBtn.disabled = true;
    input.value = "";
    add("user", text);
    history.push({ role: "user", content: text });
    var typing = document.createElement("div");
    typing.className = "sw-msg sw-bot";
    typing.textContent = "…";
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;
    try {
      var res = await fetch(gatewayUrl + "/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(0, -1), sessionId: sessionId, userLabel: userLabel() })
      });
      var data = await res.json();
      typing.remove();
      if (!res.ok) throw new Error(data.error || "Support is unavailable.");
      sessionId = data.sessionId || sessionId;
      add("assistant", data.reply);
      history.push({ role: "assistant", content: data.reply });
      if (history.length > 20) history = history.slice(-20);
    } catch (e) {
      typing.remove();
      add("assistant", e.message || "Sorry, something went wrong. Please try again.");
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
})();
