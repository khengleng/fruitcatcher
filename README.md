# LyHuor Learning Monorepo

This repository contains the production apps for the LyHuor Learning TV quiz system:

- `apps/tv-webos`: LG webOS TV quiz client
- `apps/controller-web`: mobile phone answer controller
- `apps/gateway`: Express + WebSocket room gateway, quiz engine, and Postgres persistence API
- `apps/admin-web`: Railway-hosted admin panel for live quiz settings and student progress reports
- `apps/bot-gateway`: Telegram/Messenger entry service that sends learners into solo quiz links

The gateway is the system of record for live configuration and persisted quiz results. Admin changes are pushed into the gateway immediately and active TV/controller sessions receive the updated config without redeploying the web apps.

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

Run the bot gateway:

```bash
npm run dev:bot
```

Useful checks:

```bash
npm run check
```

Local defaults:

- gateway: `http://localhost:3000`
- controller: `http://localhost:3001`
- admin: `http://localhost:3002`
- bot gateway: `http://localhost:3003`

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
- `apps/bot-gateway`

### Gateway

Required behavior:

- listens on `process.env.PORT`
- exposes `GET /health`
- exposes `GET /config`
- exposes protected `GET /admin/config`
- exposes protected `PUT /admin/config`
- exposes protected `GET /admin/reports/*`
- manages room creation and phone pairing through WebSockets
- stores quiz sessions, students, questions, answers, scores, and progress in Postgres when `DATABASE_URL` is configured

Recommended gateway environment variables:

```bash
ADMIN_TOKEN=change-this-secret
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
DATABASE_URL=postgresql://...
BRAND_TITLE=LyHuor Learning
BRAND_CAPTION=Grades 2-12 Quiz Challenge
QUIZ_SUBJECT=math   # math | algebra_1 | algebra_2 | geometry | precalculus | general_science | biology | chemistry | physics | english | ielts | sat
GRADE_LEVEL=6
QUESTIONS_PER_ROUND=10
QUESTION_TIMER_SEC=30
CONFIG_PATH=/data/game-config.json
APP_VERSION=1.0.0
```

Optional abuse/cost protection variables (sensible defaults are built in):

```bash
SOLO_RATE_LIMIT_MAX=40          # solo requests per IP per window
SOLO_RATE_LIMIT_WINDOW_MS=60000
MAX_SOLO_SESSIONS=2000          # cap on concurrent in-memory solo sessions
SOLO_SESSION_TTL_MS=3600000     # idle solo sessions are swept after this
MAX_ROOMS=500                   # cap on concurrent TV rooms
ROOM_IDLE_TTL_MS=10800000       # idle TV rooms are closed after this
MAX_WS_CONNECTIONS_PER_IP=20    # WebSocket connections allowed per IP
OPENAI_TIMEOUT_MS=20000         # abort OpenAI calls that hang past this
SWEEP_INTERVAL_MS=300000        # how often idle resources are reclaimed
```

The gateway runs behind a single proxy hop on Railway (`trust proxy` is set to `1`), so admin and solo rate limits key on the real client IP from `X-Forwarded-For`.

Notes:

- Attach Railway Postgres to the gateway service so Railway injects `DATABASE_URL`.
- The gateway creates the required tables automatically on startup.
- Without `DATABASE_URL`, the live TV quiz still works, but student progress and reports are not persisted.
- `CONFIG_PATH` lets the gateway persist admin changes across restarts.
- When Postgres is configured, admin settings are also stored in the `admin_settings` table.
- If `OPENAI_API_KEY` is missing or quota is exhausted, the gateway falls back to the built-in question bank.
- If `ADMIN_TOKEN` is missing, admin endpoints reject requests.

### Postgres Data Model

The gateway creates these tables:

- `admin_settings`: saved live configuration.
- `students`: stable phone/student identity from the controller client ID.
- `quiz_sessions`: one TV room session with curriculum, language, grade, subject, and timing.
- `session_participants`: students who joined each TV quiz session.
- `quiz_questions`: generated or fallback questions, choices, correct answer, OpenAI explanation, and model/source.
- `student_answers`: each student's answer, correctness, response time, and explanation context.
- `student_progress`: aggregate progress by student, curriculum, language, subject, and grade.

### Controller Web

Recommended environment variables:

```bash
GATEWAY_HTTP_URL=https://gateway-production-bb7c.up.railway.app
GATEWAY_WS_URL=wss://gateway-production-bb7c.up.railway.app
```

Bind the controller service to your public domain, for example:

- `https://mytv.cambobia.com`

The controller supports two modes:

- TV room mode: `https://mytv.cambobia.com?roomCode=ABC123`
- Solo ad/bot mode: `https://mytv.cambobia.com?mode=solo&source=facebook&curriculum=cambodia_moeys&language=khmer&subject=math&grade=6`

### Admin Web

Recommended environment variables:

```bash
GATEWAY_HTTP_URL=https://gateway-production-bb7c.up.railway.app
```

Bind the admin service to your public domain, for example:

- `https://admintv.cambobia.com`

Use the same `ADMIN_TOKEN` configured on the gateway in the admin page. The admin page can:

- manage live quiz settings
- show overview metrics
- list recent quiz sessions
- inspect a session's questions, answers, scores, and OpenAI explanations
- list students and their aggregate progress
- inspect a student's recent answers and elaborations

### Bot Gateway

Recommended environment variables:

```bash
CONTROLLER_URL=https://mytv.cambobia.com
TELEGRAM_BOT_TOKEN=123456:telegram-token
MESSENGER_VERIFY_TOKEN=change-this-facebook-verify-token
MESSENGER_PAGE_ACCESS_TOKEN=facebook-page-access-token
```

Useful bot endpoints:

- `GET /health`: Railway health check.
- `GET /quiz-link`: returns a generated solo quiz URL for ads, landing pages, and QR codes.
- `POST /telegram/webhook`: Telegram bot webhook. Learners receive a button that opens the controller in solo quiz mode.
- `GET /messenger/webhook`: Facebook Messenger webhook verification.
- `POST /messenger/webhook`: Facebook Messenger webhook. Learners receive a button that opens the controller in solo quiz mode.

Example generated solo quiz URL:

```text
https://mytv.cambobia.com?mode=solo&source=telegram&curriculum=cambodia_moeys&language=khmer&subject=math&grade=6
```

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
- Student progress reports require Railway Postgres attached to the gateway service.
- The TV app must stay compatible with LG webOS browser limitations, so avoid modern syntax that may not parse on-device without validation.
