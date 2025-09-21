#!/usr/bin/env node
// Auto-update system for EOD Watch
// Runs at 7pm ET to refresh all cached stock data proactively

const { getBarsCached } = require('./cache.js');
require('dotenv').config();

// Default watchlist symbols (can be expanded)
const DEFAULT_WATCHLIST = [
  'AAPL', 'META', 'GOOGL', 'TSLA', 'MSFT', 'NVDA', 'AMZN', 'NFLX', 
  'SPY', 'QQQ', 'IWM', 'BTCUSD', 'AMD', 'CRM', 'SNOW'
];

// Batch size to avoid overwhelming API
const BATCH_SIZE = 5;

// Delay between batches (seconds)
const BATCH_DELAY = 10;

async function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function updateSymbolCache(symbol) {
  try {
    console.log(`🔄 Updating cache for ${symbol}...`);
    
    // Update multiple timeframes for each symbol
    await getBarsCached(symbol, 1000, '1d');   // Daily data
    await getBarsCached(symbol, 200, '1w');    // Weekly data  
    await getBarsCached(symbol, 60, '1m');     // Monthly data
    
    console.log(`✅ Updated ${symbol} cache successfully`);
    return true;
  } catch (error) {
    console.log(`❌ Failed to update ${symbol}: ${error.message}`);
    return false;
  }
}

async function updateAllCaches(symbolList = DEFAULT_WATCHLIST) {
  console.log(`🚀 Starting auto-update for ${symbolList.length} symbols...`);
  console.log(`📦 Batch size: ${BATCH_SIZE}, Delay: ${BATCH_DELAY}s between batches`);
  
  const startTime = Date.now();
  let successCount = 0;
  let errorCount = 0;
  
  // Process symbols in batches
  for (let i = 0; i < symbolList.length; i += BATCH_SIZE) {
    const batch = symbolList.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(symbolList.length / BATCH_SIZE);
    
    console.log(`\n📋 Processing batch ${batchNum}/${totalBatches}: ${batch.join(', ')}`);
    
    // Process batch in parallel
    const promises = batch.map(symbol => updateSymbolCache(symbol));
    const results = await Promise.allSettled(promises);
    
    // Count results
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value === true) {
        successCount++;
      } else {
        errorCount++;
        console.log(`❌ ${batch[index]} failed: ${result.reason || 'Unknown error'}`);
      }
    });
    
    // Delay between batches (except for last batch)
    if (i + BATCH_SIZE < symbolList.length) {
      console.log(`⏸️ Waiting ${BATCH_DELAY}s before next batch...`);
      await sleep(BATCH_DELAY);
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`\n🎉 Auto-update completed in ${duration}s`);
  console.log(`✅ Success: ${successCount}, ❌ Errors: ${errorCount}`);
  console.log(`💡 Users will now experience instant symbol switching!`);
  
  return { successCount, errorCount, duration };
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
EOD Watch Auto-Update System

Usage:
  node auto-update.js                    # Update default watchlist
  node auto-update.js AAPL META TSLA     # Update specific symbols
  node auto-update.js --test              # Test with 3 symbols only

Examples:
  node auto-update.js                     # Full update (15 symbols)
  node auto-update.js --test              # Quick test (3 symbols)
  node auto-update.js AAPL GOOGL TSLA     # Custom symbols

Scheduling:
  Add to crontab for 7pm ET daily:
  0 19 * * * cd /path/to/eod-watch && node auto-update.js
    `);
    process.exit(0);
  }
  
  let symbols = DEFAULT_WATCHLIST;
  
  if (args.includes('--test')) {
    symbols = ['AAPL', 'META', 'TSLA']; // Quick test with 3 symbols
    console.log('🧪 Running in TEST mode with 3 symbols only');
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    symbols = args.map(s => s.toUpperCase());
    console.log(`🎯 Custom symbol list: ${symbols.join(', ')}`);
  }
  
  updateAllCaches(symbols)
    .then(result => {
      console.log(`\n📊 Final Results:`);
      console.log(`   Success Rate: ${((result.successCount / (result.successCount + result.errorCount)) * 100).toFixed(1)}%`);
      console.log(`   Total Time: ${result.duration}s`);
      process.exit(result.errorCount > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error(`💥 Auto-update failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { updateAllCaches, updateSymbolCache };