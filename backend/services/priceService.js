// backend/services/priceService.js
const axios = require('axios');

// Simple memory cache so we don't spam the API
// Structure: { 'BTC': { price: 96000, timestamp: 171... } }
let priceCache = {};
const CACHE_DURATION_MS = 60 * 1000; // 1 minute

// CoinGecko requires IDs, not symbols. We map common ones here.
const COINGECKO_IDS = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'SOL': 'solana',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'LINK': 'chainlink',
  'UNI': 'uniswap',
  'MATIC': 'matic-network',
  'AVAX': 'avalanche-2',
  'DOGE': 'dogecoin',
  'ADA': 'cardano',
  'XRP': 'ripple',
  'DOT': 'polkadot'
};

async function getCryptoPrice(symbol) {
  const upper = (symbol || '').toUpperCase();

  // 1. Check Cache
  const cached = priceCache[upper];
  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION_MS)) {
    console.log(`[PriceService] Cache hit for ${upper}: $${cached.price}`);
    return cached.price;
  }

  // 2. Fetch from API
  const id = COINGECKO_IDS[upper];
  if (!id) {
    console.log(`[PriceService] No ID found for ${upper}, skipping.`);
    return null;
  }

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
    const res = await axios.get(url);
    const price = res.data[id]?.usd;

    if (price) {
      // 3. Save to Cache
      priceCache[upper] = { price, timestamp: Date.now() };
      console.log(`[PriceService] Fetched ${upper}: $${price}`);
      return price;
    }
  } catch (err) {
    console.error(`[PriceService] Error fetching ${upper}:`, err.message);
  }

  return null;
}

// This is the main function we will call from other controllers
async function getPrice(symbol, assetClass) {
  if (assetClass === 'crypto') {
    return await getCryptoPrice(symbol);
  }
  // Future: Add 'equity' logic here (Yahoo Finance, etc.)
  return null;
}

module.exports = { getPrice };