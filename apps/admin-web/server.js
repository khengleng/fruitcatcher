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
