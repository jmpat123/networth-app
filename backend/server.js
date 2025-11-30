require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const app = express();
app.use(cors());
app.use(express.json());

// ==== SUPABASE SETUP =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TEST_USER_ID = process.env.TEST_USER_ID;

let defaultUserId = null;

async function getDefaultUserId() {
  if (defaultUserId) return defaultUserId;

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .limit(1);

  if (error) {
    console.error('Error fetching default user:', error);
    throw new Error('No default user found');
  }

  if (!data || data.length === 0) {
    throw new Error('No users in the users table. Please insert one.');
  }

  defaultUserId = data[0].id;
  return defaultUserId;
}

// ==== NET WORTH + SNAPSHOT HELPERS ====

async function computeNetWorthForUser(userId) {
  const { data, error } = await supabase
    .from('holdings')
    .select(`
      value_usd,
      asset_class,
      accounts!inner(
        connections!inner(
          user_id
        )
      )
    `)
    .eq('accounts.connections.user_id', userId);

  if (error) {
    console.error('Error in computeNetWorthForUser:', error);
    throw error;
  }

  let totalAssets = 0;
  let totalCrypto = 0;
  let totalTradfi = 0;

  for (const h of data || []) {
    const value = Number(h.value_usd || 0);
    if (!value || value <= 0) continue;

    totalAssets += value;

    if (h.asset_class === 'crypto') {
      totalCrypto += value;
    } else {
      totalTradfi += value;
    }
  }

  return {
    totalNetWorthUsd: totalAssets,
    totalCryptoUsd: totalCrypto,
    totalTradfiUsd: totalTradfi,
  };
}

async function recordSnapshot(userId, source = 'unknown') {
  try {
    const {
      totalNetWorthUsd,
      totalCryptoUsd,
      totalTradfiUsd,
    } = await computeNetWorthForUser(userId);

    const { data, error } = await supabase
      .from('snapshots')
      .insert({
        user_id: userId,
        total_net_worth_usd: totalNetWorthUsd,
        total_crypto_usd: totalCryptoUsd,
        total_tradfi_usd: totalTradfiUsd,
        breakdown: {
          crypto: totalCryptoUsd,
          tradfi: totalTradfiUsd,
        },
        source,
      })
      .select('*')
      .single();

    if (error) {
      console.error('Error inserting snapshot:', error);
      throw error;
    }

    return data;
  } catch (e) {
    console.error('recordSnapshot failed:', e);
    throw e;
  }
}

const MORALIS_API_KEY = process.env.MORALIS_API_KEY;

// Simple spam / dust token filter
function isSpamToken(symbol, priceUsd, valueUsd) {
  const s = (symbol || '').toString().toLowerCase();

  // 1) No price or non-positive price => junk
  if (!priceUsd || priceUsd <= 0) return true;

  // 2) Very domain-like / URL-ish symbols
  if (
    s.includes('http') ||
    s.includes('https') ||
    s.includes('.com') ||
    s.includes('.net') ||
    s.includes('.org') ||
    s.includes('.io')
  ) {
    return true;
  }

  // 3) Obvious spammy strings
  const badSubstrings = [
    'visit ',
    'claim ',
    'rewards',
    'reward',
    'bonus',
    'gift',
    'airdrop',
    'notice',
    'urgent',
    'secure your funds',
  ];

  if (badSubstrings.some((bad) => s.includes(bad))) {
    return true;
  }

  // 4) Optional: dust filter (very tiny value, e.g. < $1)
  if (valueUsd != null && valueUsd < 1) {
    return true;
  }

  return false;
}

// ==== EXPOSURE CLASSIFICATION HELPER ====
//
// Given a holding row (with accounts + connections joined),
// classify how it contributes to crypto / tradfi / commodities / real estate exposure.
//
function classifyHoldingExposure(holding) {
  const value = Number(holding.value_usd || 0);
  if (!value || value <= 0) {
    return {
      bucket: 'unknown',
      subtype: 'unknown',
      isCryptoExposure: false,
      cryptoUnderlying: null,
      exposureUsd: 0,
    };
  }

  const assetClass = holding.asset_class || '';
  const accountType = holding.accounts?.type || '';
  const provider = holding.accounts?.connections?.provider || '';
  const rawSymbol = (holding.symbol || '').toString().trim().toUpperCase();

  // ===== EXPOSURE ENGINE TICKER LISTS =====

  // Spot / trust Bitcoin ETFs and similar products
  const BTC_ETFS = [
    'IBIT',  // iShares Bitcoin Trust
    'FBTC',  // Fidelity Wise Origin Bitcoin Fund
    'GBTC',  // Grayscale Bitcoin Trust ETF
    'BTC',   // Grayscale Bitcoin Mini Trust
    'BITB',  // Bitwise Bitcoin ETF
    'ARKB',  // ARK 21Shares Bitcoin ETF
    'BITO',  // ProShares Bitcoin ETF (futures but still BTC exposure)
    'HODL',  // VanEck Bitcoin Trust
    'BRRR',  // Valkyrie Bitcoin Fund
    'BTCO',  // Invesco Galaxy Bitcoin ETF
    'EZBC',  // Franklin Bitcoin ETF
  ];

  // Spot / trust Ethereum ETFs
  const ETH_ETFS = [
    'ETHA',  // iShares Ethereum Trust
    'ETHE',  // Grayscale Ethereum Trust
    'ETH',   // Grayscale Ethereum Mini Trust
    'FETH',  // Fidelity Ethereum Fund
    'QETH',  // Invesco Galaxy Ethereum ETF
  ];

  // Solana ETFs
  const SOL_ETFS = [
    'BSOL',  // Bitwise Solana ETF (SOL exposure)
  ];

  // Crypto-related equities (treasuries, exchanges, miners, etc.)
  const CRYPTO_EQUITIES = [
    // Big BTC / crypto treasuries & DAT-style companies
    'MSTR',   // MicroStrategy
    'MARA',   // Marathon Digital
    'CEP',    // Twenty One / XXI
    'MTPLF',  // Metaplanet (US OTC)
    '3350',   // Metaplanet JP ticker
    'CEPO',   // Bitcoin Standard Treasury Co.
    'BLSH',   // Bullish
    'BMNR',   // BitMine Immersion (ETH treasury focus)

    // Exchanges / diversified crypto financials
    'COIN',   // Coinbase
    'GLXY',   // Galaxy Digital (TSX)
    'BRPHF',  // Galaxy OTC

    // Miners & infra with large BTC holdings
    'RIOT',   // Riot Platforms
    'CLSK',   // CleanSpark
    'HUT',    // Hut 8
    'HIVE',   // HIVE Digital Technologies
    'CORZ',   // Core Scientific
    'CIFR',   // Cipher Mining
    'BITD',   // Bitdeer
  ];

  // Stablecoins
  const STABLECOIN_SYMBOLS = [
    'USDT', 'USDC', 'DAI', 'TUSD', 'USDP', 'FDUSD', 'GUSD',
  ];

  // Precious metals / commodity ETFs
  const GOLD_ETFS = ['GLD', 'IAU', 'SGOL', 'PHYS'];
  const SILVER_ETFS = ['SLV', 'SIVR', 'PSLV'];
  const BROAD_COMMODITY_ETFS = ['DBC', 'COMT', 'GSG', 'USCI'];

  // Real estate / REIT ETFs (securities that behave like real estate exposure)
  const REAL_ESTATE_ETFS = ['VNQ', 'SCHH', 'IYR', 'XLRE', 'REET', 'RWR'];

  // International equity ETFs (very rough heuristic)
  const INTL_EQUITY_ETFS = [
    'VXUS', 'VEA', 'IEFA', 'EFA', 'IXUS', 'VEU', 'SCHF', 'ACWX',
    'EEM', 'VWO', // EM
    'EWJ', 'EWU', 'EWA', 'EWC', 'EWG', 'EWQ', 'EWH', 'EWS', 'EWY', 'EWT', 'EZA', 'EWZ',
  ];

  const isStable =
    STABLECOIN_SYMBOLS.includes(rawSymbol) || rawSymbol.endsWith('USD');

  // Default classification
  let bucket = 'unknown';
  let subtype = 'unknown';
  let isCryptoExposure = false;
  let cryptoUnderlying = null;

  // ========= 1) Direct crypto holdings (wallets, manual crypto) =========
  if (assetClass === 'crypto') {
    bucket = 'crypto';
    isCryptoExposure = true;

    if (isStable) {
      subtype = 'stablecoin';
    } else if (provider === 'wallet' || accountType === 'crypto_wallet') {
      subtype = 'spot_on_chain';
    } else {
      subtype = 'spot_custodial';
    }
  }

  // ========= 2) Equities / funds =========
  else if (assetClass === 'equity') {
    // --- 2a. Crypto ETFs ---
    if (BTC_ETFS.includes(rawSymbol)) {
      bucket = 'crypto';
      subtype = 'crypto_etf';
      isCryptoExposure = true;
      cryptoUnderlying = 'BTC';
    } else if (ETH_ETFS.includes(rawSymbol)) {
      bucket = 'crypto';
      subtype = 'crypto_etf';
      isCryptoExposure = true;
      cryptoUnderlying = 'ETH';
    } else if (SOL_ETFS.includes(rawSymbol)) {
      bucket = 'crypto';
      subtype = 'crypto_etf';
      isCryptoExposure = true;
      cryptoUnderlying = 'SOL';
    }
    // --- 2b. Crypto equities (MSTR, COIN, miners, etc.) ---
    else if (CRYPTO_EQUITIES.includes(rawSymbol)) {
      bucket = 'crypto';
      subtype = 'crypto_equity';
      isCryptoExposure = true;
    }
    // --- 2c. Commodities via ETFs (gold / silver / broad commodities) ---
    else if (GOLD_ETFS.includes(rawSymbol)) {
      bucket = 'commodities';
      subtype = 'gold';
    } else if (SILVER_ETFS.includes(rawSymbol)) {
      bucket = 'commodities';
      subtype = 'silver';
    } else if (BROAD_COMMODITY_ETFS.includes(rawSymbol)) {
      bucket = 'commodities';
      subtype = 'commodity_fund';
    }
    // --- 2d. Real estate via REIT ETFs ---
    else if (REAL_ESTATE_ETFS.includes(rawSymbol)) {
      bucket = 'real_estate';
      subtype = 'reit_etf';
    }
    // --- 2e. International vs US equity (very rough heuristic via ETFs) ---
    else if (INTL_EQUITY_ETFS.includes(rawSymbol)) {
      bucket = 'equity';
      subtype = 'intl_equity';
    } else {
      // Everything else defaults to US equity for now
      bucket = 'equity';
      subtype = 'us_equity';
    }
  }

  // ========= 3) Cash / fixed income =========
  else if (assetClass === 'cash') {
    bucket = 'cash';
    subtype = 'cash';
  } else if (assetClass === 'fixed_income') {
    bucket = 'fixed_income';
    subtype = 'fixed_income';
  }

  // ========= 4) Real estate (direct) =========
  else if (assetClass === 'real_estate' || accountType === 'real_estate') {
    bucket = 'real_estate';
    subtype = 'direct_property';
  }

  return {
    bucket,
    subtype,
    isCryptoExposure,
    cryptoUnderlying,
    exposureUsd: value,
  };
}

// ==== PLAID SETUP =====
const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

// ====== HEALTH CHECK ======
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ====== MANUAL HOLDING ENTRY ======
app.post('/api/holdings/manual', async (req, res) => {
  try {
    const { connectionName, accountName, symbol, quantity, priceUsd, assetClass } = req.body;

    if (!symbol || quantity == null || priceUsd == null || !assetClass) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const valueUsd = quantity * priceUsd;

    // 1. Create connection
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .insert({
        user_id: TEST_USER_ID,
        provider: 'manual',
        identifier: connectionName || 'manual-connection'
      })
      .select('*')
      .single();

    if (connError) {
      console.error('connections insert error:', connError);
      return res.status(500).json({ error: connError.message });
    }

    // 2. Create account
    const { data: account, error: accError } = await supabase
      .from('accounts')
      .insert({
        connection_id: connection.id,
        name: accountName || 'Manual Account',
        type: 'manual',
        currency: 'USD'
      })
      .select('*')
      .single();

    if (accError) {
      console.error('accounts insert error:', accError);
      return res.status(500).json({ error: accError.message });
    }

    // 3. Create holding
    const now = new Date().toISOString();

    const { data: holding, error: holdError } = await supabase
      .from('holdings')
      .insert({
        account_id: account.id,
        symbol,
        quantity,
        price_usd: priceUsd,
        value_usd: valueUsd,
        asset_class: assetClass,
        as_of: now
      })
      .select('*')
      .single();

    if (holdError) {
      console.error('holdings insert error:', holdError);
      return res.status(500).json({ error: holdError.message });
    }

    res.json({ message: 'Manual holding saved', holding });
  } catch (err) {
    console.error('Error in /api/holdings/manual:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== CALCULATE TOTAL NET WORTH ======
app.get('/api/holdings/total', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('holdings')
      .select('value_usd, accounts!inner(connection_id, connections!inner(user_id))')
      .eq('accounts.connections.user_id', TEST_USER_ID);

    if (error) {
      console.error('Error in /api/holdings/total:', error);
      return res.status(500).json({ error: error.message });
    }

    const total = (data || []).reduce((sum, h) => sum + Number(h.value_usd), 0);

    res.json({ totalNetWorthUsd: total });
  } catch (err) {
    console.error('Error in /api/holdings/total catch:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== NET WORTH SUMMARY (ASSETS + REAL ESTATE + LIABILITIES + CRYPTO VS TRADFI) ======
app.get('/api/networth/summary', async (req, res) => {
  try {
    // 1) Sum assets from holdings
    const { data: holdings, error: holdingsError } = await supabase
      .from('holdings')
      .select(`
        value_usd,
        asset_class,
        accounts!inner(
          connections!inner(
            user_id
          )
        )
      `)
      .eq('accounts.connections.user_id', TEST_USER_ID);

    if (holdingsError) {
      console.error('Error fetching holdings in /api/networth/summary:', holdingsError);
      return res.status(500).json({ error: holdingsError.message });
    }

    let totalAssets = 0;
    let totalCrypto = 0;
    let totalTradfi = 0;

    for (const h of holdings || []) {
      const value = Number(h.value_usd || 0);
      totalAssets += value;

      if (h.asset_class === 'crypto') {
        totalCrypto += value;
      } else {
        totalTradfi += value;
      }
    }

    // 2) Real estate properties (manual values for now)
    const { data: props, error: propsError } = await supabase
      .from('real_estate_properties')
      .select('current_value_usd')
      .eq('user_id', TEST_USER_ID);

    if (propsError) {
      console.error('Error fetching real estate in /api/networth/summary:', propsError);
      return res.status(500).json({ error: propsError.message });
    }

    let totalRealEstate = 0;
    for (const p of props || []) {
      totalRealEstate += Number(p.current_value_usd || 0);
    }

    // Treat real estate as part of total assets and (for now) in the tradfi bucket
    totalAssets += totalRealEstate;
    totalTradfi += totalRealEstate;

    // 3) Liabilities
    const { data: liabs, error: liabsError } = await supabase
      .from('liabilities')
      .select('balance_usd')
      .eq('user_id', TEST_USER_ID);

    if (liabsError) {
      console.error('Error fetching liabilities in /api/networth/summary:', liabsError);
      return res.status(500).json({ error: liabsError.message });
    }

    let totalLiabilities = 0;
    for (const l of liabs || []) {
      totalLiabilities += Number(l.balance_usd || 0);
    }

    const totalNetWorth = totalAssets - totalLiabilities;

    return res.json({
      totalAssetsUsd: totalAssets,
      totalLiabilitiesUsd: totalLiabilities,
      totalNetWorthUsd: totalNetWorth,
      totalCryptoUsd: totalCrypto,
      totalTradfiUsd: totalTradfi,
      totalRealEstateUsd: totalRealEstate,
    });
  } catch (err) {
    console.error('Error in /api/networth/summary catch:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});


// ====== LIABILITIES: CREATE MANUAL LIABILITY ======
app.post('/api/liabilities/manual', async (req, res) => {
  try {
    const {
      name,
      type,
      balanceUsd,
      creditLimitUsd,
      interestRate,
      minPaymentUsd,
      notes,
    } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'name and type are required' });
    }

    const { data, error } = await supabase
      .from('liabilities')
      .insert({
        user_id: TEST_USER_ID,
        name,
        type,
        balance_usd: balanceUsd ?? 0,
        credit_limit_usd: creditLimitUsd ?? null,
        interest_rate: interestRate ?? null,
        min_payment_usd: minPaymentUsd ?? null,
        notes: notes || null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('Error inserting liability:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ liability: data });
  } catch (err) {
    console.error('Error in /api/liabilities/manual:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ====== LIABILITIES: LIST ======
app.get('/api/liabilities/list', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('liabilities')
      .select('*')
      .eq('user_id', TEST_USER_ID)
      .order('as_of', { ascending: false });

    if (error) {
      console.error('Error fetching liabilities:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ liabilities: data || [] });
  } catch (err) {
    console.error('Error in /api/liabilities/list:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ====== LIABILITIES: SUMMARY ======
app.get('/api/liabilities/summary', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('liabilities')
      .select('balance_usd')
      .eq('user_id', TEST_USER_ID);

    if (error) {
      console.error('Error in /api/liabilities/summary:', error);
      return res.status(500).json({ error: error.message });
    }

    let total = 0;
    for (const l of data || []) {
      total += Number(l.balance_usd || 0);
    }

    return res.json({ totalLiabilitiesUsd: total });
  } catch (err) {
    console.error('Error in /api/liabilities/summary catch:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ====== REAL ESTATE: CREATE MANUAL PROPERTY ======
app.post('/api/realestate/manual', async (req, res) => {
  try {
    const {
      name,
      propertyType,
      city,
      state,
      currentValueUsd,
      purchasePriceUsd,
      notes,
    } = req.body;

    // basic validation
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const { data, error } = await supabase
      .from('real_estate_properties')
      .insert({
        user_id: TEST_USER_ID,                // same pattern as liabilities
        name,
        property_type: propertyType || null,  // e.g. "primary_home", "rental"
        city: city || null,
        state: state || null,
        current_value_usd: currentValueUsd ?? 0,
        purchase_price_usd: purchasePriceUsd ?? null,
        notes: notes || null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('Error inserting real estate property:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ property: data });
  } catch (err) {
    console.error('Error in /api/realestate/manual:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ====== REAL ESTATE: LIST PROPERTIES ======
app.get('/api/realestate/list', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('real_estate_properties')
      .select('*')
      .eq('user_id', TEST_USER_ID)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching properties:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ properties: data });
  } catch (err) {
    console.error('Error in /api/realestate/list:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});



// ====== LIST HOLDINGS (AMBITION VERSION WITH JOINS) ======
app.get('/api/holdings/list', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('holdings')
      .select(`
        id,
        symbol,
        quantity,
        price_usd,
        value_usd,
        asset_class,
        as_of,
        accounts!inner(
          id,
          name,
          type,
          connections!inner(
            id,
            provider,
            user_id,
            nickname
          )
        )
      `)
      .eq('accounts.connections.user_id', TEST_USER_ID)
      .order('value_usd', { ascending: false });

    if (error) {
      console.error('Error in /api/holdings/list:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ holdings: data || [] });
  } catch (err) {
    console.error('Server error in /api/holdings/list catch:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== SNAPSHOTS: LIST FOR CURRENT USER ======
app.get('/api/snapshots', async (req, res) => {
  try {
    const userId = await getDefaultUserId();

    const { data, error } = await supabase
      .from('snapshots')
      .select(
        'id, taken_at, total_net_worth_usd, total_crypto_usd, total_tradfi_usd, total_liabilities_usd, breakdown, source'
      )
      .eq('user_id', userId)
      .order('taken_at', { ascending: true });

    if (error) {
      console.error('Error fetching snapshots:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      userId,
      count: (data || []).length,
      snapshots: data || [],
    });
  } catch (err) {
    console.error('Error in /api/snapshots:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});


// ====== DELETE A HOLDING (MAINLY FOR MANUAL ENTRIES) ======
app.delete('/api/holdings/:id', async (req, res) => {
  try {
    const holdingId = req.params.id;

    // 1) Verify this holding belongs to TEST_USER_ID
    const { data: rows, error: fetchError } = await supabase
      .from('holdings')
      .select(`
        id,
        accounts!inner(
          connections!inner(
            user_id
          )
        )
      `)
      .eq('id', holdingId)
      .eq('accounts.connections.user_id', TEST_USER_ID)
      .limit(1);

    if (fetchError) {
      console.error('Error fetching holding to delete:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch holding' });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Holding not found' });
    }

    // 2) Delete
    const { error: deleteError } = await supabase
      .from('holdings')
      .delete()
      .eq('id', holdingId);

    if (deleteError) {
      console.error('Error deleting holding:', deleteError);
      return res.status(500).json({ error: 'Failed to delete holding' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Error in DELETE /api/holdings/:id:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ====== WALLETS: ADD WALLET CONNECTION ======
app.post('/api/wallets/add', async (req, res) => {
  try {
    const { address, chain, nickname } = req.body;

    if (!address || !chain) {
      return res.status(400).json({ error: 'address and chain are required' });
    }

    const userId = await getDefaultUserId();

    const normalizedAddress = address.toLowerCase();
    const normalizedChain = chain.toLowerCase();

    // 1) Create connection row
    const { data: connData, error: connError } = await supabase
      .from('connections')
      .insert([
        {
          user_id: userId,
          provider: 'wallet',
          identifier: normalizedAddress,
          chain: normalizedChain,
          nickname: nickname || null,
          access_token: null,
        },
      ])
      .select('*');

    if (connError) {
      console.error('Error inserting wallet connection:', connError);
      return res.status(500).json({ error: 'Failed to save wallet connection' });
    }

    const connection = connData[0];

    // 2) Create an account for this wallet
    const { data: acctData, error: acctError } = await supabase
      .from('accounts')
      .insert([
        {
          connection_id: connection.id,
          name: nickname || `${normalizedChain.toUpperCase()} Wallet`,
          type: 'crypto_wallet',
          currency: 'USD',
        },
      ])
      .select('*');

    if (acctError) {
      console.error('Error creating wallet account:', acctError);
      return res.status(500).json({ error: 'Failed to create wallet account' });
    }

    const account = acctData[0];

    res.json({
      success: true,
      connection,
      account,
    });
  } catch (err) {
    console.error('Error in /api/wallets/add:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== WALLETS: LIST SAVED WALLETS ======
app.get('/api/wallets', async (req, res) => {
  try {
    const userId = await getDefaultUserId();

    const { data, error } = await supabase
      .from('connections')
      .select('id, provider, identifier, chain, nickname, created_at')
      .eq('provider', 'wallet')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching wallets:', error);
      return res.status(500).json({ error: 'Failed to fetch wallets' });
    }

    res.json({ wallets: data || [] });
  } catch (err) {
    console.error('Error in /api/wallets:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== WALLETS: REFRESH HOLDINGS FOR ALL WALLETS ======
app.get('/api/wallets/refresh', async (req, res) => {
  try {
    const userId = await getDefaultUserId();

    if (!MORALIS_API_KEY) {
      console.error('MORALIS_API_KEY missing');
      return res.status(500).json({ error: 'Crypto API not configured' });
    }

    // 1) Get all wallet connections for this user
    const { data: wallets, error: walletsError } = await supabase
      .from('connections')
      .select('id, identifier, chain, nickname')
      .eq('provider', 'wallet')
      .eq('user_id', userId);

    if (walletsError) {
      console.error('Error fetching wallet connections:', walletsError);
      return res.status(500).json({ error: 'Failed to fetch wallet connections' });
    }

    const nowIso = new Date().toISOString();
    const results = [];

    for (const w of wallets) {
      const address = w.identifier;
      const chain = (w.chain || 'eth').toLowerCase();

      // 2) Find or create an account for this wallet
      const { data: existingAccounts, error: acctFetchError } = await supabase
        .from('accounts')
        .select('*')
        .eq('connection_id', w.id)
        .eq('type', 'crypto_wallet')
        .limit(1);

      if (acctFetchError) {
        console.error('Error fetching wallet account:', acctFetchError);
        continue;
      }

      let account = existingAccounts && existingAccounts[0];

      if (!account) {
        const { data: acctInsertData, error: acctInsertError } = await supabase
          .from('accounts')
          .insert([
            {
              connection_id: w.id,
              name: w.nickname || `${chain.toUpperCase()} Wallet`,
              type: 'crypto_wallet',
              currency: 'USD',
            },
          ])
          .select('*');

        if (acctInsertError) {
          console.error('Error creating wallet account:', acctInsertError);
          continue;
        }

        account = acctInsertData[0];
      }

      // 3) Call Moralis for this wallet
      const url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${chain}`;

      const response = await fetch(url, {
        headers: {
          'x-api-key': MORALIS_API_KEY,
          accept: 'application/json',
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`Moralis error for ${address}:`, text);
        continue;
      }

      const json = await response.json();
      const tokens = json.result || json.tokens || [];

      const assets = tokens.map((t) => {
        const decimals = Number(t.decimals ?? 18);
        const raw = t.balance || t.amount || '0';
        const quantity = Number(raw) / 10 ** decimals;

        let priceUsd = 0;
        let valueUsd = 0;

        if (t.usd_value != null) {
          valueUsd = Number(t.usd_value);
          priceUsd = quantity > 0 ? valueUsd / quantity : 0;
        } else if (t.usd_price != null) {
          priceUsd = Number(t.usd_price);
          valueUsd = quantity * priceUsd;
        }

        return {
          symbol: t.symbol || 'UNKNOWN',
          quantity,
          price_usd: priceUsd,
          value_usd: valueUsd,
        };
      });

      // 4) Clear old holdings for this wallet account
      const { error: deleteError } = await supabase
        .from('holdings')
        .delete()
        .eq('account_id', account.id);

      if (deleteError) {
        console.error('Error clearing old holdings:', deleteError);
      }

      // 5) Insert new holdings (after spam filter)
      const holdingsToInsert = assets
        .filter(
          (a) =>
            a.quantity > 0 &&
            !isSpamToken(a.symbol, a.price_usd, a.value_usd)
        )
        .map((a) => ({
          account_id: account.id,
          symbol: a.symbol,
          quantity: a.quantity,
          price_usd: a.price_usd,
          value_usd: a.value_usd,
          asset_class: 'crypto',
          as_of: nowIso,
        }));

      if (holdingsToInsert.length > 0) {
        const { error: holdingsError } = await supabase
          .from('holdings')
          .insert(holdingsToInsert);

        if (holdingsError) {
          console.error('Error inserting holdings:', holdingsError);
        }
      }

      const totalUsdValue = holdingsToInsert.reduce(
        (sum, h) => sum + Number(h.value_usd || 0),
        0
      );

      results.push({
        address,
        chain,
        nickname: w.nickname,
        account_id: account.id,
        totalUsdValue,
        tokens: holdingsToInsert,
      });
    }

     // 6) After refreshing wallets, compute current totals (assets + real estate + liabilities)
     const { data: holdings, error: holdingsError } = await supabase
     .from('holdings')
     .select(`
       value_usd,
       asset_class,
       accounts!inner(
         connections!inner(
           user_id
         )
       )
     `)
     .eq('accounts.connections.user_id', userId);

   if (holdingsError) {
     console.error('Error fetching holdings for snapshot in /api/wallets/refresh:', holdingsError);
     // We still return wallets, but skip snapshot
     return res.json({ wallets: results });
   }

   let totalAssets = 0;
   let totalCrypto = 0;
   let totalTradfi = 0;

   for (const h of holdings || []) {
     const value = Number(h.value_usd || 0);
     totalAssets += value;

     if (h.asset_class === 'crypto') {
       totalCrypto += value;
     } else {
       totalTradfi += value;
     }
   }

   // Real estate properties (manual values for now)
   const { data: props, error: propsError } = await supabase
     .from('real_estate_properties')
     .select('current_value_usd')
     .eq('user_id', userId);

   if (propsError) {
     console.error('Error fetching real estate for snapshot in /api/wallets/refresh:', propsError);
     // Return wallets but no new snapshot if this fails
     return res.json({ wallets: results });
   }

   let totalRealEstate = 0;
   for (const p of props || []) {
     totalRealEstate += Number(p.current_value_usd || 0);
   }

   // Add real estate to assets and (for now) to tradfi bucket
   totalAssets += totalRealEstate;
   totalTradfi += totalRealEstate;

   // Liabilities
   const { data: liabs, error: liabsError } = await supabase
     .from('liabilities')
     .select('balance_usd')
     .eq('user_id', userId);

   if (liabsError) {
     console.error('Error fetching liabilities for snapshot in /api/wallets/refresh:', liabsError);
     // Return wallets but no snapshot if this fails
     return res.json({ wallets: results });
   }

   let totalLiabilities = 0;
   for (const l of liabs || []) {
     totalLiabilities += Number(l.balance_usd || 0);
   }

   const totalNetWorth = totalAssets - totalLiabilities;

   // 7) Insert snapshot row (assets, crypto, tradfi, real estate, liabilities, net worth)
   const { data: snapshot, error: snapError } = await supabase
     .from('snapshots')
     .insert({
       user_id: userId,
       total_net_worth_usd: totalNetWorth,
       total_crypto_usd: totalCrypto,
       total_tradfi_usd: totalTradfi,
       total_liabilities_usd: totalLiabilities,
       total_real_estate_usd: totalRealEstate,
       breakdown: {
         crypto: totalCrypto,
         tradfi: totalTradfi,
         real_estate: totalRealEstate,
       },
       source: 'wallet_refresh',
     })
     .select(
       'id, user_id, taken_at, total_net_worth_usd, total_crypto_usd, total_tradfi_usd, total_liabilities_usd, total_real_estate_usd, breakdown, source'
     )
     .single();

   if (snapError) {
     console.error('Error inserting snapshot in /api/wallets/refresh:', snapError);
     // Still return wallets even if snapshot insert fails
     return res.json({ wallets: results });
   }

   // Return wallets plus the latest snapshot info
   return res.json({
     wallets: results,
     snapshot,
   });




  } catch (err) {
    console.error('Error in /api/wallets/refresh:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ====== EXPOSURE SUMMARY ======
app.get('/api/exposure/summary', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('holdings')
      .select(`
        id,
        symbol,
        quantity,
        price_usd,
        value_usd,
        asset_class,
        as_of,
        accounts!inner(
          id,
          name,
          type,
          connections!inner(
            id,
            provider,
            user_id,
            nickname
          )
        )
      `)
      .eq('accounts.connections.user_id', TEST_USER_ID);

    if (error) {
      console.error('Error in /api/exposure/summary:', error);
      return res.status(500).json({ error: error.message });
    }

    const rows = data || [];

    // Aggregate totals
    let totalNetWorthUsd = 0;
    let totalCryptoExposureUsd = 0;
    let totalTradfiExposureUsd = 0;

    let spotOnChainUsd = 0;
    let spotCustodialUsd = 0;
    let stablecoinUsd = 0;
    let cryptoEtfUsd = 0;
    let cryptoEquityUsd = 0;
    let otherCryptoUsd = 0;

    const bucketMap = {}; // bucket -> exposureUsd

    for (const h of rows) {
      const val = Number(h.value_usd || 0);
      if (!val || val <= 0) continue;

      totalNetWorthUsd += val;

      const cls = classifyHoldingExposure(h);
      const bucket = cls.bucket;
      const subtype = cls.subtype;
      const exposure = cls.exposureUsd || 0;

      // Bucket-level aggregation
      if (!bucketMap[bucket]) {
        bucketMap[bucket] = 0;
      }
      bucketMap[bucket] += exposure;

      if (cls.isCryptoExposure) {
        totalCryptoExposureUsd += exposure;

        if (subtype === 'spot_on_chain') {
          spotOnChainUsd += exposure;
        } else if (subtype === 'spot_custodial') {
          spotCustodialUsd += exposure;
        } else if (subtype === 'stablecoin') {
          stablecoinUsd += exposure;
        } else if (subtype === 'crypto_etf') {
          cryptoEtfUsd += exposure;
        } else if (subtype === 'crypto_equity') {
          cryptoEquityUsd += exposure;
        } else {
          otherCryptoUsd += exposure;
        }
      } else {
        totalTradfiExposureUsd += exposure;
      }
    }

    const exposuresByBucket = Object.keys(bucketMap).map((bucket) => {
      const exposureUsd = bucketMap[bucket];
      const pctOfNetWorth =
        totalNetWorthUsd > 0
          ? (exposureUsd / totalNetWorthUsd) * 100
          : 0;
      return {
        bucket,
        exposureUsd,
        pctOfNetWorth,
      };
    });

    return res.json({
      totalNetWorthUsd,
      totalCryptoExposureUsd,
      totalTradfiExposureUsd,
      cryptoBreakdown: {
        spotOnChainUsd,
        spotCustodialUsd,
        stablecoinUsd,
        cryptoEtfUsd,
        cryptoEquityUsd,
        otherCryptoUsd,
        totalCryptoExposureUsd,
      },
      exposuresByBucket,
    });
  } catch (err) {
    console.error('Server error in /api/exposure/summary:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ====== PLAID: CREATE LINK TOKEN ======
app.post('/api/plaid/create-link-token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: TEST_USER_ID },
      client_name: 'Net Worth Tracker MVP',
      products: ['investments'],
      language: 'en',
      country_codes: ['US'],
    });

    res.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error('Plaid create-link-token error:', err.response?.data || err);
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

// ====== PLAID: EXCHANGE PUBLIC TOKEN ======
app.post('/api/plaid/exchange-public-token', async (req, res) => {
  try {
    const { public_token } = req.body;

    if (!public_token) return res.status(400).json({ error: 'public_token is required' });

    const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    const { data: connection, error: connError } = await supabase
      .from('connections')
      .insert({
        user_id: TEST_USER_ID,
        provider: 'plaid',
        identifier: itemId,
        access_token: accessToken,
      })
      .select('*')
      .single();

    if (connError) {
      console.error('connections insert error in /exchange-public-token:', connError);
      return res.status(500).json({ error: connError.message });
    }

    res.json({ message: 'Plaid connection saved', connectionId: connection.id });
  } catch (err) {
    console.error('Plaid exchange error:', err.response?.data || err);
    res.status(500).json({ error: 'Failed to exchange public token' });
  }
});

// ====== PLAID: SYNC HOLDINGS ======
app.post('/api/plaid/sync-holdings', async (req, res) => {
  try {
    const { connectionId } = req.body;
    if (!connectionId) return res.status(400).json({ error: 'connectionId is required' });

    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('*')
      .eq('id', connectionId)
      .single();

    if (connError || !connection) {
      console.error('connection not found in /sync-holdings:', connError);
      return res.status(404).json({ error: 'Connection not found' });
    }

    const accessToken = connection.access_token;
    const userId = connection.user_id || TEST_USER_ID;

    const holdingsResponse = await plaidClient.investmentsHoldingsGet({
      access_token: accessToken,
    });

    const accounts = holdingsResponse.data.accounts || [];
    const holdings = holdingsResponse.data.holdings || [];
    const securities = holdingsResponse.data.securities || [];

    const now = new Date().toISOString();
    const securityMap = {};
    securities.forEach((sec) => {
      securityMap[sec.security_id] = sec;
    });

    const accountMap = {};

    for (const acct of accounts) {
      const { data: dbAccount, error: accError } = await supabase
        .from('accounts')
        .insert({
          connection_id: connection.id,
          name: acct.name || 'Plaid Investment Account',
          type: 'investment',
          currency: acct.balances.iso_currency_code || 'USD',
        })
        .select('*')
        .single();

      if (accError) {
        console.error('Error creating account from Plaid:', accError);
        continue;
      }

      accountMap[acct.account_id] = dbAccount.id;
    }

    for (const h of holdings) {
      const sec = securityMap[h.security_id];
      if (!sec) continue;

      await supabase.from('holdings').insert({
        account_id: accountMap[h.account_id],
        symbol: sec.ticker_symbol || sec.name || 'UNKNOWN',
        quantity: h.quantity || 0,
        price_usd: sec.close_price || 0,
        value_usd: (h.quantity || 0) * (sec.close_price || 0),
        asset_class: 'equity',
        as_of: now,
      });
    }

    // After syncing holdings, record a snapshot
    let snapshot = null;
    try {
      snapshot = await recordSnapshot(userId, 'plaid_sync');
    } catch (e) {
      console.error('Snapshot failed after Plaid sync:', e);
    }

    res.json({ message: 'Plaid holdings synced', snapshot });
  } catch (err) {
    console.error('Plaid sync error:', err.response?.data || err);
    res.status(500).json({ error: 'Failed to sync Plaid holdings' });
  }
});

// ====== START SERVER ======
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));
