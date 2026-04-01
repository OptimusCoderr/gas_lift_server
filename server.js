// ============================================================
// PumpCtrl API  —  server.js
// One file. No subfolders. Easy to read and debug.
//
// ENDPOINTS:
//   GET    /health
//   POST   /control/air-pump       body: { pwm: 0-255 }
//   POST   /control/water-pump     body: { pwm: 0-255 }
//   POST   /control/valve          body: { state: "open" | "closed" }
//   GET    /control/state
//   POST   /sensors/reading        body: { flow_rate, temperature, pressure }
//   GET    /sensors/latest
//   GET    /sensors/history        query: ?limit=50
//   DELETE /sensors/clear
// ============================================================
require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');

const app  = express();
const PORT = process.env.PORT;

// ── PUT YOUR MONGODB URI HERE ────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;  
// ─────────────────────────────────────────────────────────────

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── MONGODB MODELS ───────────────────────────────────────────

// Stores one snapshot of all three sensor values
const SensorReading = mongoose.model('SensorReading', new mongoose.Schema({
  flow_rate:   { type: Number, required: true },
  temperature: { type: Number, required: true },
  pressure:    { type: Number, required: true },
  timestamp:   { type: Date,   default: Date.now },
}));

// Singleton document — holds the last commanded actuator state
const ActuatorState = mongoose.model('ActuatorState', new mongoose.Schema({
  device_id:      { type: String, default: 'main' },
  air_pump_pwm:   { type: Number, default: 0 },
  water_pump_pwm: { type: Number, default: 0 },
  valve_state:    { type: String, default: 'closed' },
  updated_at:     { type: Date,   default: Date.now },
}));

// ── HEALTH ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({
    status:    'ok',
    db:        states[mongoose.connection.readyState] || 'unknown',
    uptime_s:  Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── POST /control/air-pump ───────────────────────────────────
app.post('/control/air-pump', async (req, res) => {
  try {
    const pwm = parseInt(req.body.pwm, 10);
    if (isNaN(pwm) || pwm < 0 || pwm > 255) {
      return res.status(400).json({ success: false, error: 'pwm must be an integer 0-255' });
    }
    await ActuatorState.findOneAndUpdate(
      { device_id: 'main' },
      { air_pump_pwm: pwm, updated_at: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, air_pump_pwm: pwm });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /control/water-pump ─────────────────────────────────
app.post('/control/water-pump', async (req, res) => {
  try {
    const pwm = parseInt(req.body.pwm, 10);
    if (isNaN(pwm) || pwm < 0 || pwm > 255) {
      return res.status(400).json({ success: false, error: 'pwm must be an integer 0-255' });
    }
    await ActuatorState.findOneAndUpdate(
      { device_id: 'main' },
      { water_pump_pwm: pwm, updated_at: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, water_pump_pwm: pwm });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /control/valve ──────────────────────────────────────
app.post('/control/valve', async (req, res) => {
  try {
    const state = (req.body.state || '').toLowerCase();
    if (state !== 'open' && state !== 'closed') {
      return res.status(400).json({ success: false, error: 'state must be "open" or "closed"' });
    }
    await ActuatorState.findOneAndUpdate(
      { device_id: 'main' },
      { valve_state: state, updated_at: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, valve_state: state });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /control/state ───────────────────────────────────────
app.get('/control/state', async (req, res) => {
  try {
    const doc = await ActuatorState.findOne({ device_id: 'main' }).lean();
    if (!doc) {
      return res.json({ success: true, air_pump_pwm: 0, water_pump_pwm: 0, valve_state: 'closed', updated_at: null });
    }
    res.json({
      success:        true,
      air_pump_pwm:   doc.air_pump_pwm,
      water_pump_pwm: doc.water_pump_pwm,
      valve_state:    doc.valve_state,
      updated_at:     doc.updated_at,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /sensors/reading ────────────────────────────────────
app.post('/sensors/reading', async (req, res) => {
  try {
    const { flow_rate, temperature, pressure } = req.body;

    // All three required
    if (flow_rate === undefined || flow_rate === null)
      return res.status(400).json({ success: false, error: 'flow_rate is required' });
    if (temperature === undefined || temperature === null)
      return res.status(400).json({ success: false, error: 'temperature is required' });
    if (pressure === undefined || pressure === null)
      return res.status(400).json({ success: false, error: 'pressure is required' });

    // Range check 0-1000
    for (const [key, val] of [['flow_rate', flow_rate], ['temperature', temperature], ['pressure', pressure]]) {
      const n = parseFloat(val);
      if (isNaN(n) || n < 0 || n > 1000) {
        return res.status(400).json({ success: false, error: `${key} must be a number between 0 and 1000` });
      }
    }

    const doc = await SensorReading.create({
      flow_rate:   parseFloat(flow_rate),
      temperature: parseFloat(temperature),
      pressure:    parseFloat(pressure),
    });

    res.status(201).json({
      success:     true,
      id:          doc._id,
      flow_rate:   doc.flow_rate,
      temperature: doc.temperature,
      pressure:    doc.pressure,
      timestamp:   doc.timestamp,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /sensors/latest ──────────────────────────────────────
app.get('/sensors/latest', async (req, res) => {
  try {
    const doc = await SensorReading.findOne().sort({ timestamp: -1 }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, error: 'No sensor readings found' });
    }
    res.json({
      success:     true,
      id:          doc._id,
      flow_rate:   doc.flow_rate,
      temperature: doc.temperature,
      pressure:    doc.pressure,
      timestamp:   doc.timestamp,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /sensors/history ─────────────────────────────────────
app.get('/sensors/history', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const docs = await SensorReading.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      count:   docs.length,
      data:    docs.map(d => ({
        id:          d._id,
        flow_rate:   d.flow_rate,
        temperature: d.temperature,
        pressure:    d.pressure,
        timestamp:   d.timestamp,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /sensors/clear ────────────────────────────────────
app.delete('/sensors/clear', async (req, res) => {
  try {
    const result = await SensorReading.deleteMany({});
    res.json({ success: true, deleted_count: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── START ────────────────────────────────────────────────────
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('[DB] Connected to MongoDB Atlas');
    app.listen(PORT, () => {
      console.log(`[API] Running at http://localhost:${PORT}`);
      console.log(`[API] Test it: http://localhost:${PORT}/health`);
    });
  })
  .catch(err => {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  });
