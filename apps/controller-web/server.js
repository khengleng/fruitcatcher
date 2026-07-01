const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3001);

app.set("trust proxy", true);

// Baseline security headers. Referrer-Policy matters here because solo-quiz links
// carry a subscriber token in the query string — this keeps it out of cross-origin
// Referer headers. CSP allows inline scripts/styles (the app uses them), the
// same-origin config/support scripts, YouTube embeds, and https/wss to the gateway.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "media-src 'self' https:; " +
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
    "connect-src 'self' https: wss: http://localhost:* ws://localhost:*; " +
    "base-uri 'self'; object-src 'none'; frame-ancestors 'self'"
  );
  next();
});

function inferGatewayHttpUrl(req) {
  const host = req.get("host") || process.env.RAILWAY_PUBLIC_DOMAIN;
  const protocol = process.env.PUBLIC_PROTOCOL || req.protocol || "http";
  return `${protocol}://${host}`;
}

function inferGatewayWsUrl(httpUrl) {
  if (process.env.GATEWAY_WS_URL) {
    return process.env.GATEWAY_WS_URL;
  }

  return httpUrl.replace(/^http/i, "ws");
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "controller-web"
  });
});

app.get("/config.js", (req, res) => {
  const gatewayHttpUrl = process.env.GATEWAY_HTTP_URL || inferGatewayHttpUrl(req);
  const gatewayWsUrl = inferGatewayWsUrl(gatewayHttpUrl);

  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(
    `window.FRUIT_CATCHER_CONFIG = ${JSON.stringify({
      gatewayHttpUrl,
      gatewayWsUrl
    }, null, 2)};`
  );
});

app.use(express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

app.listen(port, "0.0.0.0", () => {
  console.log(`Controller listening on ${port}`);
});
