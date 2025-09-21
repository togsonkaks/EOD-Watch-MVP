// cache.js - Production-grade delta caching system for EOD data
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const CACHE_DIR = path.join(process.cwd(), 'cache');

// Ensure cache directory exists
(async () => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (err) {
    // Directory already exists, ignore
  }
})();

const TIINGO_TOKEN = process.env.TIINGO_TOKEN;

function cachePath(symbol, timeframe = '1d') {
  // Security: Sanitize symbol to prevent path traversal attacks
  const safeSymbol = symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!safeSymbol || safeSymbol.length > 10) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }
  return path.join(CACHE_DIR, `${safeSymbol}_${timeframe}.json`);
}

async function readCache(symbol, timeframe) {
  try {
    const p = cachePath(symbol, timeframe);
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { meta: null, bars: [] };
  }
}

async function writeCache(symbol, timeframe, data) {
  const p = cachePath(symbol, timeframe);
  await fs.writeFile(p, JSON.stringify(data), 'utf8');
}

function ymd(date) {
  return date.toISOString().slice(0,10); // YYYY-MM-DD
}

async function fetchTiingoDaily(symbol, startDateYMD = null) {
  // Docs: Tiingo EOD supports ?startDate=YYYY-MM-DD to fetch from a date
  const base = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices`;
  const url = startDateYMD
    ? `${base}?startDate=${startDateYMD}&token=${TIINGO_TOKEN}`
    : `${base}?token=${TIINGO_TOKEN}`;
  
  console.log(`🔄 Fetching ${symbol} ${startDateYMD ? `from ${startDateYMD}` : 'full history'} from Tiingo...`);
  
  try {
    const { data } = await axios.get(url, { timeout: 15000 });
    // Normalize to {time, open, high, low, close, volume}
    return (data || []).map(row => ({
      time: row.date,                 // ISO string
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume ?? null
    }));
  } catch (error) {
    if (error.response?.status === 429) {
      console.log(`⚠️ Rate limited for ${symbol} - will use existing cache`);
      return []; // Return empty array to gracefully fallback to cache
    }
    throw error; // Re-throw other errors
  }
}

async function getDailyBarsCached(symbol, days = 600, timeframe = '1d') {
  if (!TIINGO_TOKEN) throw new Error('Missing TIINGO_TOKEN');
  
  // Security: Validate symbol format to prevent path traversal
  if (!/^[A-Z0-9.-]{1,10}$/i.test(symbol)) {
    throw new Error(`Invalid symbol format: ${symbol}`);
  }

  const today = ymd(new Date());
  let { meta, bars } = await readCache(symbol, timeframe);

  // First-time fetch
  if (!meta) {
    console.log(`📥 First-time cache miss for ${symbol} - fetching full history`);
    const fetched = await fetchTiingoDaily(symbol);   // full history (Tiingo limits apply)
    // Keep only what you care about (e.g., last 5y ≈ 1260 trading days)
    const MAX_BARS = 1500;
    bars = fetched.slice(-MAX_BARS);
    meta = { 
      last_fetch_at: new Date().toISOString(), 
      last_bar_date: bars.at(-1)?.time ?? null 
    };
    await writeCache(symbol, timeframe, { meta, bars });
    console.log(`✅ Cached ${bars.length} bars for ${symbol} (first-time fetch)`);
  }

  // If today's bar isn't present, fetch just the delta since last_bar_date+1
  const haveLatest = meta.last_bar_date && meta.last_bar_date >= today;
  if (!haveLatest) {
    console.log(`🔄 Cache stale for ${symbol} (last: ${meta.last_bar_date}) - checking for updates`);
    const start = meta.last_bar_date ? ymd(new Date(Date.parse(meta.last_bar_date) + 24*3600*1000)) : null;
    
    try {
      const delta = await fetchTiingoDaily(symbol, start);
      if (delta.length) {
        // Append, ensuring no duplicates
        const existing = new Set(bars.map(b => b.time));
        let newBars = 0;
        for (const d of delta) {
          if (!existing.has(d.time)) {
            bars.push(d);
            newBars++;
          }
        }
        // Trim to MAX_BARS
        const MAX_BARS = 1500;
        if (bars.length > MAX_BARS) bars = bars.slice(-MAX_BARS);
        meta.last_bar_date = bars.at(-1)?.time ?? meta.last_bar_date;
        meta.last_fetch_at = new Date().toISOString();
        await writeCache(symbol, timeframe, { meta, bars });
        console.log(`✅ Added ${newBars} new bars for ${symbol} (delta update)`);
      } else {
        console.log(`📦 No new bars for ${symbol} since ${meta.last_bar_date}`);
      }
    } catch (error) {
      console.log(`⚠️ Delta fetch failed for ${symbol}, using cached data (${bars.length} bars)`);
      // Continue with existing cached data
    }
  } else {
    console.log(`📦 Cache hit for ${symbol} (fresh data)`);
  }

  // Return the trailing window requested
  const n = Math.max(1, Number(days) | 0);
  return { symbol: symbol.toUpperCase(), data: bars.slice(-n) };
}

module.exports = {
  getDailyBarsCached
};