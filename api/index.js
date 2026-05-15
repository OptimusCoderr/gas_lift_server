// ============================================================
// PumpCtrl API  —  api/index.js
// Vercel serverless — export app, do NOT call listen().
//
// SENSOR DATAPOINTS (hardware → DB):
//   voltage        Air pump voltage draw (V)
//   current        Air pump current draw (A)
//   air_pressure   Pressure produced by air pump (units 0-1000)
//   water_pressure Water pressure near well exit (units 0-1000)
//   temperature    Temperature near well exit (units 0-1000)
//   flow_rate      Flow rate exiting the well (units 0-1000)
//
// ACTUATOR CONTROL (website → hardware):
//   air_pump       Gas lift pump, 0-100
//   water_pump     Well pressure pump, 0-100
//   valve          open | closed
//
// ENDPOINTS:
//   GET    /health
//   POST   /control/air-pump       { value: 0-100 }
//   POST   /control/water-pump     { value: 0-100 }
//   POST   /control/valve          { state: "open"|"closed" }
//   GET    /control/state
//   POST   /sensors/reading        { voltage, current, air_pressure, water_pressure, temperature, flow_rate }
//   GET    /sensors/latest
//   GET    /sensors/history        ?limit=N  (max 100)
//   DELETE /sensors/clear
//   GET    /stream                 SSE — pushes sensor+actuator every 2s
// ============================================================

const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');

const app = express();

// ── MONGODB URI ───────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI ||
  'mongodb+srv://chukwuebukaanulunko:zYUae505TCxgfyes@cluster0.9fvj2ut.mongodb.net/pumpctrl?retryWrites=true&w=majority';

// ── DB CONNECTION (serverless-safe, cached on global) ─────────
let isConnected = false;
async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) return;
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    bufferCommands: false,
  });
  isConnected = true;
}

// ── MODELS ────────────────────────────────────────────────────

// All six sensor values in one timestamped document
const SensorReading = mongoose.models.SensorReading ||
  mongoose.model('SensorReading', new mongoose.Schema({
    // Air pump electrical
    voltage:        { type: Number, required: true },  // V  (any range)
    current:        { type: Number, required: true },  // A  (any range)
    // Pressures & process values (0-1000 raw units)
    air_pressure:   { type: Number, required: true },
    water_pressure: { type: Number, required: true },
    temperature:    { type: Number, required: true },
    flow_rate:      { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
  }));

// Singleton — last commanded actuator state
const ActuatorState = mongoose.models.ActuatorState ||
  mongoose.model('ActuatorState', new mongoose.Schema({
    device_id:       { type: String, default: 'main' },
    air_pump_value:  { type: Number, default: 0 },   // 0-100
    water_pump_value:{ type: Number, default: 0 },   // 0-100
    valve_state:     { type: String, default: 'closed' },
    updated_at:      { type: Date,   default: Date.now },
  }));

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Connect before every request
app.use(async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (err) { res.status(503).json({ success: false, error: 'DB unavailable: ' + err.message }); }
});

// ── GET /health ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  const states = { 0:'disconnected', 1:'connected', 2:'connecting', 3:'disconnecting' };
  res.json({
    status:    'ok',
    db:        states[mongoose.connection.readyState] || 'unknown',
    uptime_s:  Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── POST /control/air-pump ────────────────────────────────────
// Body: { value: 0-100 }
app.post('/control/air-pump', async (req, res) => {
  try {
    const value = parseInt(req.body.value, 10);
    if (isNaN(value) || value < 0 || value > 100)
      return res.status(400).json({ success: false, error: 'value must be an integer 0-100' });
    await ActuatorState.findOneAndUpdate(
      { device_id: 'main' },
      { air_pump_value: value, updated_at: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, air_pump_value: value });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /control/water-pump ──────────────────────────────────
// Body: { value: 0-100 }
app.post('/control/water-pump', async (req, res) => {
  try {
    const value = parseInt(req.body.value, 10);
    if (isNaN(value) || value < 0 || value > 100)
      return res.status(400).json({ success: false, error: 'value must be an integer 0-100' });
    await ActuatorState.findOneAndUpdate(
      { device_id: 'main' },
      { water_pump_value: value, updated_at: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, water_pump_value: value });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /control/valve ───────────────────────────────────────
// Body: { state: "open" | "closed" }
app.post('/control/valve', async (req, res) => {
  try {
    const state = (req.body.state || '').toLowerCase();
    if (state !== 'open' && state !== 'closed')
      return res.status(400).json({ success: false, error: 'state must be "open" or "closed"' });
    await ActuatorState.findOneAndUpdate(
      { device_id: 'main' },
      { valve_state: state, updated_at: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, valve_state: state });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /control/state ────────────────────────────────────────
app.get('/control/state', async (req, res) => {
  try {
    const doc = await ActuatorState.findOne({ device_id: 'main' }).lean();
    res.json({
      success: true,
      air_pump_value:   doc ? doc.air_pump_value   : 0,
      water_pump_value: doc ? doc.water_pump_value  : 0,
      valve_state:      doc ? doc.valve_state       : 'closed',
      updated_at:       doc ? doc.updated_at        : null,
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /control/air-pump ─────────────────────────────────────
// Returns the current commanded air pump value only
app.get('/control/air-pump', async (req, res) => {
  try {
    const doc = await ActuatorState.findOne({ device_id: 'main' }).lean();
    res.json({
      success:        true,
      air_pump_value: doc ? doc.air_pump_value : 0,
      updated_at:     doc ? doc.updated_at     : null,
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /control/water-pump ───────────────────────────────────
// Returns the current commanded water pump value only
app.get('/control/water-pump', async (req, res) => {
  try {
    const doc = await ActuatorState.findOne({ device_id: 'main' }).lean();
    res.json({
      success:          true,
      water_pump_value: doc ? doc.water_pump_value : 0,
      updated_at:       doc ? doc.updated_at       : null,
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /sensors/reading ─────────────────────────────────────
// Body: { voltage, current, air_pressure, water_pressure, temperature, flow_rate }
app.post('/sensors/reading', async (req, res) => {
  try {
    const fields = ['voltage', 'current', 'air_pressure', 'water_pressure', 'temperature', 'flow_rate'];
    const parsed = {};

    for (const key of fields) {
      const val = req.body[key];
      if (val === undefined || val === null)
        return res.status(400).json({ success: false, error: `'${key}' is required` });
      const n = parseFloat(val);
      if (isNaN(n))
        return res.status(400).json({ success: false, error: `'${key}' must be a number` });
      // Range check 0-1000 for process values only (not voltage/current which can be any value)
      if (['air_pressure', 'water_pressure', 'temperature', 'flow_rate'].includes(key) && (n < 0 || n > 1000))
        return res.status(400).json({ success: false, error: `'${key}' must be between 0 and 1000 (got ${n})` });
      parsed[key] = n;
    }

    const doc = await SensorReading.create(parsed);
    res.status(201).json({
      success: true,
      id:            doc._id,
      voltage:       doc.voltage,
      current:       doc.current,
      air_pressure:  doc.air_pressure,
      water_pressure:doc.water_pressure,
      temperature:   doc.temperature,
      flow_rate:     doc.flow_rate,
      timestamp:     doc.timestamp,
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /sensors/latest ───────────────────────────────────────
app.get('/sensors/latest', async (req, res) => {
  try {
    const doc = await SensorReading.findOne().sort({ timestamp: -1 }).lean();
    if (!doc) return res.status(404).json({ success: false, error: 'No sensor readings found' });
    res.json({ success: true, ...doc, id: doc._id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /sensors/history ──────────────────────────────────────
app.get('/sensors/history', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const docs = await SensorReading.find().sort({ timestamp: -1 }).limit(limit).lean();
    res.json({
      success: true,
      count:   docs.length,
      data:    docs.map(d => ({
        id:            d._id,
        voltage:       d.voltage,
        current:       d.current,
        air_pressure:  d.air_pressure,
        water_pressure:d.water_pressure,
        temperature:   d.temperature,
        flow_rate:     d.flow_rate,
        timestamp:     d.timestamp,
      })),
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── DELETE /sensors/clear ─────────────────────────────────────
app.delete('/sensors/clear', async (req, res) => {
  try {
    const result = await SensorReading.deleteMany({});
    res.json({ success: true, deleted_count: result.deletedCount });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /stream — Server-Sent Events ─────────────────────────
// Pushes live data every 2s. Named events: 'sensor', 'actuator'
app.get('/stream', async (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  async function push() {
    try {
      const sr = await SensorReading.findOne().sort({ timestamp: -1 }).lean();
      if (sr) send('sensor', {
        voltage:       sr.voltage,
        current:       sr.current,
        air_pressure:  sr.air_pressure,
        water_pressure:sr.water_pressure,
        temperature:   sr.temperature,
        flow_rate:     sr.flow_rate,
        timestamp:     sr.timestamp,
      });
      const ar = await ActuatorState.findOne({ device_id: 'main' }).lean();
      send('actuator', {
        air_pump_value:   ar ? ar.air_pump_value   : 0,
        water_pump_value: ar ? ar.water_pump_value  : 0,
        valve_state:      ar ? ar.valve_state       : 'closed',
      });
    } catch (_) {}
  }

  await push();
  const interval  = setInterval(push, 2000);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => { clearInterval(interval); clearInterval(heartbeat); });
});

// ── ROOT ──────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
  service: 'PumpCtrl API', version: '2.0.0',
  endpoints: {
    'GET    /health':               'Server + DB health',
    'POST   /control/air-pump':     'Set air pump 0-100  { value }',
    'GET    /control/air-pump':     'Read current air pump value',
    'POST   /control/water-pump':   'Set water pump 0-100  { value }',
    'GET    /control/water-pump':   'Read current water pump value',
    'POST   /control/valve':        'Set valve  { state: open|closed }',
    'GET    /control/state':        'Read current actuator state',
    'POST   /sensors/reading':      'Ingest sensor snapshot (6 fields)',
    'GET    /sensors/latest':       'Latest sensor reading',
    'GET    /sensors/history':      'Last N readings  ?limit=N',
    'DELETE /sensors/clear':        'Wipe all sensor readings',
    'GET    /stream':               'SSE stream — sensor + actuator events',
  },
}));

module.exports = app;
