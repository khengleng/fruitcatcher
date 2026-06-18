const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');

// Express setup
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Passport middleware
passport.use(new LocalStrategy(
  async function(username, password, done) {
    if (username === process.env.ADMIN_USERNAME && await bcrypt.compare(password, process.env.ADMIN_PASSWORD)) {
      return done(null, { id: username });
    } else {
      return done(null, false);
    }
  }
));

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  done(null, { id: id });
});

app.use(passport.initialize());
app.use(passport.session());

// Admin routes
const requireAdmin = function(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authorized' });
  }
  next();
};

app.post('/login', passport.authenticate('local', { successRedirect: '/admin', failureRedirect: '/login', failureMessage: true }));

app.get('/admin', requireAdmin, (req, res) => {
  res.send('Admin dashboard');
});

// Existing routes
function inferGatewayHttpUrl(req) {
  if (process.env.GATEWAY_HTTP_URL) {
    return process.env.GATEWAY_HTTP_URL;
  }

  const host = req.get("host");
  const protocol = req.protocol || "http";
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