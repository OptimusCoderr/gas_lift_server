# PumpCtrl API

One file backend. `server.js` contains everything.

## Run

```bash
npm install
npm start
```

Check it works:
```
http://localhost:3000/health
```

## The MongoDB URI is hardcoded in server.js

Look for this line near the top of `server.js` and replace with your URI if needed:

```js
const MONGODB_URI = process.env.MONGODB_URI ||
  'mongodb+srv://chukwuebukaanulunko:...@cluster0.9fvj2ut.mongodb.net/pumpctrl?retryWrites=true&w=majority';
```

## Endpoints

| Method | URL | Body |
|--------|-----|------|
| GET | /health | — |
| POST | /control/air-pump | `{ "pwm": 128 }` |
| POST | /control/water-pump | `{ "pwm": 200 }` |
| POST | /control/valve | `{ "state": "open" }` |
| GET | /control/state | — |
| POST | /sensors/reading | `{ "flow_rate": 500, "temperature": 250, "pressure": 750 }` |
| GET | /sensors/latest | — |
| GET | /sensors/history?limit=20 | — |
| DELETE | /sensors/clear | — |
