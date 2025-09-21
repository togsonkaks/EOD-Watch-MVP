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
  
  console.log(`🔄 Fetching ${symbol} daily ${startDateYMD ? `from ${startDateYMD}` : 'full history'} from Tiingo...`);
  
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

async function fetchTiingoIntraday(symbol, startDateYMD = null) {
  // Tiingo intraday API for 4H data
  const base = `https://api.tiingo.com/iex/${encodeURIComponent(symbol)}/prices`;
  const params = new URLSearchParams({
    token: TIINGO_TOKEN,
    resampleFreq: '4hour',
    format: 'json'
  });
  
  if (startDateYMD) {
    params.set('startDate', startDateYMD);
  }
  
  const url = `${base}?${params}`;
  
  console.log(`🔄 Fetching ${symbol} 4H ${startDateYMD ? `from ${startDateYMD}` : 'recent'} from Tiingo...`);
  
  try {
    const { data } = await axios.get(url, { timeout: 15000 });
    // Normalize intraday data to consistent format
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
      console.log(`⚠️ Rate limited for ${symbol} intraday - will use existing cache`);
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

  // Check if we're in a rate limit window
  if (meta && meta.status === 'rate_limited' && meta.rate_limited_until) {
    const retryTime = new Date(meta.rate_limited_until);
    const now = new Date();
    if (now < retryTime) {
      console.log(`⏳ Still rate limited for ${symbol} ${timeframe} until ${retryTime.toISOString()}`);
      throw new Error(`Rate limited until ${retryTime.toISOString()}`);
    } else {
      console.log(`🔄 Rate limit window expired for ${symbol} ${timeframe} - attempting fetch`);
      // Clear the rate limit status and try again
      meta = null;
    }
  }

  // First-time fetch
  if (!meta) {
    console.log(`📥 First-time cache miss for ${symbol} ${timeframe} - fetching historical data`);
    
    try {
      let fetched;
      if (timeframe === '4h') {
        // For 4H, get last 30 days of intraday data
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const startDateYMD = ymd(startDate);
        fetched = await fetchTiingoIntraday(symbol, startDateYMD);
      } else {
        // For daily data, get 5 years of history
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 5);
        const startDateYMD = ymd(startDate);
        fetched = await fetchTiingoDaily(symbol, startDateYMD);
      }
      
      // Only create cache if we got actual data
      if (fetched.length > 0) {
        // Keep only what we care about (last 1500 bars max)
        const MAX_BARS = 1500;
        bars = fetched.slice(-MAX_BARS);
        meta = { 
          last_fetch_at: new Date().toISOString(), 
          last_bar_date: bars.at(-1)?.time ?? null 
        };
        await writeCache(symbol, timeframe, { meta, bars });
        console.log(`✅ Cached ${bars.length} bars for ${symbol} ${timeframe} (first-time fetch)`);
      } else {
        console.log(`⚠️ No data received for ${symbol} ${timeframe} - rate limited or no data available`);
        // Create a placeholder cache with retry timestamp to prevent thundering herd
        const retryAfter = new Date();
        retryAfter.setMinutes(retryAfter.getMinutes() + 15); // Retry in 15 minutes
        bars = [];
        meta = { 
          last_fetch_at: new Date().toISOString(), 
          last_bar_date: null,
          rate_limited_until: retryAfter.toISOString(),
          status: 'rate_limited'
        };
        await writeCache(symbol, timeframe, { meta, bars });
        console.log(`⏳ Created placeholder cache for ${symbol} ${timeframe} - will retry after ${retryAfter.toISOString()}`);
        throw new Error(`Rate limited - please try again later`);
      }
    } catch (error) {
      console.log(`❌ First-time fetch failed for ${symbol} ${timeframe}: ${error.message}`);
      
      // If we don't have a cache file yet, create a placeholder to prevent retries
      if (!meta) {
        const retryAfter = new Date();
        retryAfter.setMinutes(retryAfter.getMinutes() + 15);
        const placeholderMeta = { 
          last_fetch_at: new Date().toISOString(), 
          last_bar_date: null,
          rate_limited_until: retryAfter.toISOString(),
          status: 'rate_limited'
        };
        await writeCache(symbol, timeframe, { meta: placeholderMeta, bars: [] });
        console.log(`⏳ Created error placeholder cache for ${symbol} ${timeframe}`);
      }
      
      throw error; // Let the API endpoint handle the error response
    }
  }

  // If today's bar isn't present, fetch just the delta since last_bar_date+1
  const haveLatest = meta.last_bar_date && meta.last_bar_date >= today;
  if (!haveLatest) {
    console.log(`🔄 Cache stale for ${symbol} ${timeframe} (last: ${meta.last_bar_date}) - checking for updates`);
    const start = meta.last_bar_date ? ymd(new Date(Date.parse(meta.last_bar_date) + 24*3600*1000)) : null;
    
    try {
      let delta;
      if (timeframe === '4h') {
        delta = await fetchTiingoIntraday(symbol, start);
      } else {
        delta = await fetchTiingoDaily(symbol, start);
      }
      
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
        console.log(`✅ Added ${newBars} new bars for ${symbol} ${timeframe} (delta update)`);
      } else {
        console.log(`📦 No new bars for ${symbol} ${timeframe} since ${meta.last_bar_date}`);
      }
    } catch (error) {
      console.log(`⚠️ Delta fetch failed for ${symbol} ${timeframe}, using cached data (${bars.length} bars)`);
      // Continue with existing cached data
    }
  } else {
    console.log(`📦 Cache hit for ${symbol} ${timeframe} (fresh data)`);
  }

  // Return the trailing window requested
  const n = Math.max(1, Number(days) | 0);
  return { symbol: symbol.toUpperCase(), data: bars.slice(-n) };
}

function resampleToWeekly(dailyBars) {
  const weeks = new Map();
  
  for (const bar of dailyBars) {
    const date = new Date(bar.time);
    // Get Monday of the week
    const monday = new Date(date);
    monday.setDate(date.getDate() - date.getDay() + 1);
    const weekKey = monday.toISOString().slice(0, 10);
    
    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, {
        time: weekKey,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume || 0
      });
    } else {
      const week = weeks.get(weekKey);
      week.high = Math.max(week.high, bar.high);
      week.low = Math.min(week.low, bar.low);
      week.close = bar.close; // Last close of the week
      week.volume += bar.volume || 0;
    }
  }
  
  return Array.from(weeks.values()).sort((a, b) => a.time.localeCompare(b.time));
}

function resampleToMonthly(dailyBars) {
  const months = new Map();
  
  for (const bar of dailyBars) {
    const date = new Date(bar.time);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
    
    if (!months.has(monthKey)) {
      months.set(monthKey, {
        time: monthKey,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume || 0
      });
    } else {
      const month = months.get(monthKey);
      month.high = Math.max(month.high, bar.high);
      month.low = Math.min(month.low, bar.low);
      month.close = bar.close; // Last close of the month
      month.volume += bar.volume || 0;
    }
  }
  
  return Array.from(months.values()).sort((a, b) => a.time.localeCompare(b.time));
}

async function getBarsCached(symbol, days = 600, timeframe = '1d') {
  // Handle different timeframes
  switch (timeframe.toLowerCase()) {
    case '4h':
      return await getDailyBarsCached(symbol, days, '4h');
    
    case '1w':
      // Get daily data and resample to weekly
      const dailyForWeekly = await getDailyBarsCached(symbol, days * 7, '1d'); // Get more days for weekly resampling
      const weeklyBars = resampleToWeekly(dailyForWeekly.data);
      return { symbol: symbol.toUpperCase(), data: weeklyBars.slice(-days) };
    
    case '1m':
      // Get daily data and resample to monthly
      const dailyForMonthly = await getDailyBarsCached(symbol, days * 30, '1d'); // Get more days for monthly resampling
      const monthlyBars = resampleToMonthly(dailyForMonthly.data);
      return { symbol: symbol.toUpperCase(), data: monthlyBars.slice(-days) };
    
    case '1d':
    default:
      return await getDailyBarsCached(symbol, days, '1d');
  }
}

module.exports = {
  getDailyBarsCached,
  getBarsCached
};