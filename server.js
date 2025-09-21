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

// Data cache for optimizing API usage (respects 500 req/day limit)
const dataCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes for EOD data

function getCacheKey(symbol, timeframe, days) {
  return `${symbol}-${timeframe}-${days}`;
}

function isCacheValid(timestamp) {
  return Date.now() - timestamp < CACHE_DURATION;
}

// Enhanced data API with deep history and intraday framework
app.get('/api/data', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'AAPL').toUpperCase();
    const timeframe = req.query.timeframe || '1D';
    
    // Deep history support: up to 4000 days (11+ years)
    let days = parseInt(req.query.days || '4000', 10);
    days = Math.min(days, 4000); // Cap at 4000 days for performance
    
    const cacheKey = getCacheKey(symbol, timeframe, days);
    
    // Check cache first
    if (dataCache.has(cacheKey)) {
      const cached = dataCache.get(cacheKey);
      if (isCacheValid(cached.timestamp)) {
        console.log(`📦 Cache hit for ${symbol} ${timeframe}`);
        return res.json(cached.data);
      }
    }

    console.log(`🔄 Fetching ${symbol} ${timeframe} (${days} days from Tiingo...`);
    
    // Calculate start date for deep history
    const start = new Date(Date.now() - days * 86400000)
      .toISOString()
      .slice(0, 10);

    let apiUrl;
    
    // Intraday framework (ready for future 4H, 1H, etc.)
    switch (timeframe) {
      case '4H':
      case '1H':
      case '15M':
        // Future intraday support - for now fallback to daily
        console.log(`⚠️ Intraday ${timeframe} not yet supported, using daily data`);
        apiUrl = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${start}&token=${TIINGO_TOKEN}`;
        break;
      case '1W':
      case '1M':
      case '1D':
      default:
        // Daily data endpoint
        apiUrl = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${start}&token=${TIINGO_TOKEN}`;
        break;
    }

    const response = await fetch(apiUrl);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Tiingo API error ${response.status}: ${errorText}`);
      return res.status(response.status).json({ 
        error: 'api_error', 
        status: response.status,
        message: errorText 
      });
    }
    
    const rawData = await response.json();
    
    if (!Array.isArray(rawData) || rawData.length === 0) {
      console.warn(`⚠️ No data received for ${symbol}`);
      return res.json([]);
    }

    // Transform to frontend format
    const transformedData = rawData.map(bar => ({
      date: bar.date,
      open: parseFloat(bar.open),
      high: parseFloat(bar.high), 
      low: parseFloat(bar.low),
      close: parseFloat(bar.close),
      volume: bar.volume || 0
    }));

    // Cache the result
    dataCache.set(cacheKey, {
      data: transformedData,
      timestamp: Date.now()
    });

    console.log(`✅ Loaded ${transformedData.length} bars for ${symbol} ${timeframe}`);
    res.json(transformedData);

  } catch (err) {
    console.error('📡 Data API error:', err);
    res.status(500).json({ 
      error: 'server_error', 
      message: 'Failed to fetch market data',
      detail: err.message 
    });
  }
});

// Legacy EOD endpoint (maintained for backward compatibility)
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