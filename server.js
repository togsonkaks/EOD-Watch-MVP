// server.js — CommonJS
const path = require('path');
const express = require('express');
const fetch = require('node-fetch');   // v2.x
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const TIINGO_TOKEN = process.env.TIINGO_TOKEN || process.env.TIINGO_KEY; // accept either name
const INTRADAY_PROVIDER = process.env.INTRADAY_PROVIDER || '';            // e.g. 'tiingo' later

if (!TIINGO_TOKEN) {
  console.error('❌ Missing TIINGO_TOKEN in .env');
  process.exit(1);
}

app.use(cors());
// Disable cache for development to ensure updates are picked up
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: function (res, path) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Health
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/**
 * Normalize EOD rows → [{time,open,high,low,close}]
 */
function normalizeDaily(json) {
  return (json || []).map(d => ({
    time: Math.floor(new Date(d.date).getTime() / 1000),
    open: d.open, high: d.high, low: d.low, close: d.close
  }));
}

/**
 * GET /eod?symbol=AAPL&days=4000
 * Tiingo daily prices; allow deep history (cap at 4000 days).
 */
app.get('/eod', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'AAPL').toUpperCase();
    const days = Math.min(parseInt(req.query.days || '600', 10), 4000);  // ⬅ bump cap to 4000
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const url =
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices` +
      `?startDate=${start}&token=${TIINGO_TOKEN}`;

    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).send(txt);
    }
    const raw = await r.json();
    return res.json({ symbol, data: normalizeDaily(raw) });
  } catch (err) {
    console.error('EOD proxy error:', err);
    return res.status(500).json({ error: 'proxy_error', detail: String(err) });
  }
});

/* ------------------------- INTRADAY (4H) STUB --------------------------
   The UI already switches to "4H". To make it *real*, you need minute bars.
   This route is a clean scaffold:

   - If you don't set INTRADAY_PROVIDER, it returns 501 (not enabled).
   - If you later set INTRADAY_PROVIDER='tiingo' and implement the fetcher,
     it will:
        1) pull 1-minute bars (last N days),
        2) resample to 240-minute (4H) candles server-side,
        3) return normalized OHLC to the client.

   Until then, your UI will still work (it falls back to daily for 4H).
--------------------------------------------------------------------------*/

/** Group minute bars to 4H candles (t in seconds; bars sorted ascending) */
function resampleTo4H(minBars) {
  if (!minBars || !minBars.length) return [];
  // 4 hours = 4 * 60 minutes
  const BUCKET_SEC = 4 * 60 * 60;

  const floorToBucket = (tSec) => Math.floor(tSec / BUCKET_SEC) * BUCKET_SEC;

  const out = [];
  let cur = null;
  let bucket = null;

  for (const b of minBars) {
    // expect { time (sec), open, high, low, close }
    const tSec = typeof b.time === 'number' ? b.time : Math.floor(new Date(b.time).getTime() / 1000);
    const k = floorToBucket(tSec);

    if (bucket === null || k !== bucket) {
      if (cur) out.push(cur);
      bucket = k;
      cur = { time: k, open: b.open, high: b.high, low: b.low, close: b.close };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low  = Math.min(cur.low,  b.low);
      cur.close = b.close;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Normalize minute rows into {time,open,high,low,close} */
function normalizeMinute(json, timeField) {
  // Accept either ISO date string or epoch; map to seconds
  return (json || []).map(d => {
    const t = d[timeField] || d.date || d.time;
    const tSec = typeof t === 'number' ? Math.floor(t / 1000) : Math.floor(new Date(t).getTime() / 1000);
    return { time: tSec, open: d.open, high: d.high, low: d.low, close: d.close };
  });
}

/** Placeholder fetcher: implement your minute source here */
async function fetchMinuteBarsTiingo(symbol, days) {
  // NOTE: This is only a skeleton — fill it in once you enable Tiingo IEX minute data.
  // Tiingo IEX minute endpoint (docs on Tiingo): /iex/{symbol}/prices with startDate & resampleFreq
  // Example (check docs for exact params):
  //   https://api.tiingo.com/iex/AAPL/prices?startDate=YYYY-MM-DD&resampleFreq=1min&token=TIINGO_TOKEN
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const url =
    `https://api.tiingo.com/iex/${encodeURIComponent(symbol)}/prices` +
    `?startDate=${start}&resampleFreq=1min&token=${TIINGO_TOKEN}`;

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`tiingo_iex_failed ${r.status}: ${txt}`);
  }
  const raw = await r.json();
  // Tiingo minute rows usually have "date" ISO field
  return normalizeMinute(raw, 'date');
}

app.get('/intraday', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'AAPL').toUpperCase();
    const days = Math.min(parseInt(req.query.days || '30', 10), 120); // reasonable lookback
    const tf = (req.query.interval || '4h').toLowerCase();

    if (tf !== '4h') return res.status(400).json({ error: 'only_4h_supported_for_now' });

    if (!INTRADAY_PROVIDER) {
      return res.status(501).json({ error: 'intraday_not_enabled', hint: 'Set INTRADAY_PROVIDER=tiingo and implement fetchMinuteBarsTiingo.' });
    }

    let minuteBars = [];
    if (INTRADAY_PROVIDER === 'tiingo') {
      minuteBars = await fetchMinuteBarsTiingo(symbol, days);
    } else {
      return res.status(501).json({ error: 'unsupported_provider', provider: INTRADAY_PROVIDER });
    }

    const bars4h = resampleTo4H(minuteBars);
    return res.json({ symbol, interval: '4h', data: bars4h });
  } catch (err) {
    console.error('INTRADAY error:', err);
    return res.status(500).json({ error: 'intraday_error', detail: String(err) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ EOD server running at http://0.0.0.0:${PORT}`);
  if (!INTRADAY_PROVIDER) {
    console.log('ℹ️  /intraday is disabled (set INTRADAY_PROVIDER to enable).');
  }
});
