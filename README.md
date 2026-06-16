# Fruit Catcher Monorepo

This repository contains three apps:

- `apps/tv-webos`: LG webOS TV game client
- `apps/controller-web`: mobile phone controller
- `apps/gateway`: Express + WebSocket room gateway for TV and phone pairing

## Local Development

Install dependencies for the workspace root:

```bash
npm install
```

Run the gateway locally:

```bash
npm run dev:gateway
```

The gateway defaults to `http://localhost:3000` and `ws://localhost:3000`.

To preview the controller locally, serve `apps/controller-web` with any static server:

```bash
cd apps/controller-web
python3 -m http.server 4173
```

To preview the TV app locally, serve `apps/tv-webos` with any static server:

```bash
cd apps/tv-webos
python3 -m http.server 8080
```

Before local testing, check these config files:

- `apps/controller-web/config.js`
- `apps/tv-webos/config.js`

For local development they already point to `localhost:3000`.

## Railway Deployment

Deploy `apps/gateway` as the Railway service root.

Environment:

- `NODE_ENV=production`

Railway command:

```bash
npm install
npm start
```

The gateway listens on `process.env.PORT` automatically.

After Railway gives you a public domain, update:

- `apps/controller-web/config.js`
- `apps/tv-webos/config.js`

Set the HTTP and WebSocket URLs to your Railway hostname, for example:

```js
window.FRUIT_CATCHER_CONFIG = {
  gatewayHttpUrl: "https://fruitcatcher-gateway.up.railway.app",
  gatewayWsUrl: "wss://fruitcatcher-gateway.up.railway.app"
};
```

For the TV app, also set the controller host in `apps/tv-webos/config.js`:

```js
window.FRUIT_CATCHER_CONFIG = {
  gatewayHttpUrl: "https://fruitcatcher-gateway.up.railway.app",
  gatewayWsUrl: "wss://fruitcatcher-gateway.up.railway.app",
  controllerUrl: "https://mytv.cambobia.com"
};
```

Host `apps/controller-web` at `https://mytv.cambobia.com`. The TV app reads that URL to build the on-screen join link and QR code, then creates a room code on launch.

## LG TV Packaging And Install

Package the TV app from inside `apps/tv-webos`:

```bash
cd apps/tv-webos
ares-package .
```

Install the generated IPK:

```bash
ares-install <ipk> -d HTV
```

Launch the app:

```bash
ares-launch com.fruitcatcher.game -d HTV
```
