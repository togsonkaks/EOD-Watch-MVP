const path = require('path');
const express = require('express');
const fetch = require('node-fetch');   // v2 matches CommonJS
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const TIINGO_TOKEN = process.env.TIINGO_TOKEN;

if (!TIINGO_TOKEN) {
  console.error('❌ Missing TIINGO_TOKEN in .env');
  process.exit(1);
}

app.use(cors());

// serve /public
app.use(express.static(path.join(__dirname, 'public')));

// health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// EOD proxy (Tiingo → simplified OHLC bars)
app.get('/eod', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'AAPL').toUpperCase();
    const days = Math.min(parseInt(req.query.days || '600', 10), 2000);

    const start = new Date(Date.now() - days * 86400000)
      .toISOString()
      .slice(0, 10);

    const url =
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices` +
      `?startDate=${start}&token=${TIINGO_TOKEN}`;

    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).send(txt);
    }
    const json = await r.json();

    const data = json.map(d => ({
      time: Math.floor(new Date(d.date).getTime() / 1000),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close
    }));

    res.json({ symbol, data });
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'proxy_error', detail: String(err) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ EOD server running at http://0.0.0.0:${PORT}`);
});
