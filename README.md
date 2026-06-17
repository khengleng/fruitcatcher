# LyHuor Learning Monorepo

This repository contains the production apps for the LyHuor Learning TV quiz system:

- `apps/tv-webos`: LG webOS TV quiz client
- `apps/controller-web`: mobile phone answer controller
- `apps/gateway`: Express + WebSocket room gateway and quiz engine
- `apps/admin-web`: Railway-hosted admin panel for live quiz settings

The gateway is the system of record for live configuration. Admin changes are pushed into the gateway immediately and active TV/controller sessions receive the updated config without redeploying the web apps.

## Local Development

Install workspace dependencies:

```bash
npm install
```

Run the gateway:

```bash
npm run dev:gateway
```

Run the controller:

```bash
npm run dev:controller
```

Run the admin:

```bash
npm run dev:admin
```

Useful checks:

```bash
npm run check
```

Local defaults:

- gateway: `http://localhost:3000`
- controller: `http://localhost:3001`
- admin: `http://localhost:3002`

The controller and admin apps serve their `config.js` dynamically, so local development does not require manual edits for the web apps.

To preview the TV app locally:

```bash
cd apps/tv-webos
python3 -m http.server 8080
```

## Railway Deployment

Deploy each service from its app directory:

- `apps/gateway`
- `apps/controller-web`
- `apps/admin-web`

### Gateway

Required behavior:

- listens on `process.env.PORT`
- exposes `GET /health`
- exposes `GET /config`
- exposes protected `GET /admin/config`
- exposes protected `PUT /admin/config`
- manages room creation and phone pairing through WebSockets

Recommended gateway environment variables:

```bash
ADMIN_TOKEN=change-this-secret
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
BRAND_TITLE=LyHuor Learning
BRAND_CAPTION=Grades 2-12 Quiz Challenge
QUIZ_SUBJECT=math
GRADE_LEVEL=6
QUESTIONS_PER_ROUND=10
QUESTION_TIMER_SEC=30
CONFIG_PATH=/data/game-config.json
APP_VERSION=1.0.0
```

Notes:

- `CONFIG_PATH` lets the gateway persist admin changes across restarts.
- If `OPENAI_API_KEY` is missing or quota is exhausted, the gateway falls back to the built-in question bank.
- If `ADMIN_TOKEN` is missing, admin endpoints reject requests.

### Controller Web

Recommended environment variables:

```bash
GATEWAY_HTTP_URL=https://gateway-production-bb7c.up.railway.app
GATEWAY_WS_URL=wss://gateway-production-bb7c.up.railway.app
```

Bind the controller service to your public domain, for example:

- `https://mytv.cambobia.com`

### Admin Web

Recommended environment variables:

```bash
GATEWAY_HTTP_URL=https://gateway-production-bb7c.up.railway.app
```

Bind the admin service to your public domain, for example:

- `https://admintv.cambobia.com`

Use the same `ADMIN_TOKEN` configured on the gateway when logging into the admin page.

## TV Configuration

The TV app reads its runtime endpoints from:

- [apps/tv-webos/config.js](/Users/mlh/QWEN/fruitcatcher/apps/tv-webos/config.js)

Example:

```js
window.FRUIT_CATCHER_CONFIG = {
  gatewayHttpUrl: "https://gateway-production-bb7c.up.railway.app",
  gatewayWsUrl: "wss://gateway-production-bb7c.up.railway.app",
  controllerUrl: "https://mytv.cambobia.com"
};
```

Changing this file requires repackaging and reinstalling the TV app.

## LG TV Packaging And Install

From inside `apps/tv-webos`:

```bash
cd /Users/mlh/QWEN/fruitcatcher/apps/tv-webos
ares-package .
```

Install the generated IPK:

```bash
ares-install com.fruitcatcher.game_1.0.0_all.ipk -d HTV
```

Launch the app:

```bash
ares-launch com.fruitcatcher.game -d HTV
```

For another device, replace `HTV` with the configured target name such as `officetv`.

## Live Operations

What updates immediately after saving in admin:

- `brandTitle`
- `brandCaption`
- `subject`
- `curriculum`
- `language`
- `gradeLevel`
- `difficultyMode`
- `questionSource`
- `questionsPerRound`
- `questionTimerSec`

What requires repackaging the TV app:

- changes to TV HTML, CSS, or JavaScript
- QR rendering logic changes
- controller URL changes in `apps/tv-webos/config.js`
- any other code change inside `apps/tv-webos`

## Known Production Constraints

- OpenAI-generated questions require valid API billing and quota.
- On quota errors, the gateway logs a `429 insufficient_quota` error and falls back to local questions.
- The TV app must stay compatible with LG webOS browser limitations, so avoid modern syntax that may not parse on-device without validation.
