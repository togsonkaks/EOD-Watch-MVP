const path = require('path');
const express = require('express');
const fetch = require('node-fetch');   // v2 matches CommonJS
const cors = require('cors');
require('dotenv').config();
const { getBarsCached } = require('./cache.js');

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

// Production-grade delta caching now handled by cache.js
// Eliminates rate limiting issues with intelligent delta updates

// Enhanced data API with multi-timeframe support and delta caching
app.get('/api/data', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'AAPL').toUpperCase();
    const timeframe = req.query.timeframe || '1D';
    
    // Deep history support: up to 4000 days (11+ years)
    let days = parseInt(req.query.days || '4000', 10);
    days = Math.min(days, 4000); // Cap at 4000 days for performance
    
    // Use production-grade multi-timeframe caching
    const result = await getBarsCached(symbol, days, timeframe);
    
    // Transform to frontend format
    const transformedData = result.data.map(bar => ({
      date: bar.time,
      open: parseFloat(bar.open),
      high: parseFloat(bar.high), 
      low: parseFloat(bar.low),
      close: parseFloat(bar.close),
      volume: bar.volume || 0
    }));

    console.log(`✅ Served ${transformedData.length} bars for ${symbol} ${timeframe}`);
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

// Legacy EOD endpoint with delta caching (backward compatibility)
app.get('/eod', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'AAPL').toUpperCase();
    const days = Math.min(parseInt(req.query.days || '600', 10), 2000);

    // Use production-grade delta caching (always daily for legacy compatibility)
    const result = await getBarsCached(symbol, days, '1d');
    
    const data = result.data.map(d => ({
      time: Math.floor(new Date(d.time).getTime() / 1000),
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
