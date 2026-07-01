const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const app = express();
const port = Number(process.env.PORT || 3002);

app.set("trust proxy", 1);

const pageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

app.use(pageLimiter);

// Baseline security headers for the admin portal. Stricter than the public app:
// the admin UI must never be framed (clickjacking), and CSP limits scripts to
// self + the Chart.js CDN it loads. 'unsafe-inline' is required by the current
// inline scripts/styles; frame-ancestors 'none' + X-Frame-Options: DENY block
// framing regardless.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' https: http://localhost:*; " +
    "base-uri 'self'; object-src 'none'; frame-ancestors 'none'"
  );
  next();
});

function inferGatewayHttpUrl(req) {
  if (process.env.GATEWAY_HTTP_URL) {
    return process.env.GATEWAY_HTTP_URL;
  }

  const host = req.get("host") || "localhost:3000";
  const protocol = process.env.PUBLIC_PROTOCOL || req.protocol || "http";
  return `${protocol}://${host}`;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "admin-web"
  });
});

app.get("/config.js", (req, res) => {
  const gatewayHttpUrl = inferGatewayHttpUrl(req);

  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(
    `window.FRUIT_CATCHER_ADMIN_CONFIG = ${JSON.stringify({
      gatewayHttpUrl
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
  console.log(`Admin web listening on ${port}`);
});
