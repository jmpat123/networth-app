require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const walletsRoutes = require('./routes/wallets');
const pricesRoutes = require('./routes/prices');

// ✅ CHANGE 1: Use the single database client we created
const { supabase } = require('./db/supabaseClient');

// ✅ CHANGE 2: Import the new Route file for Snapshots
const snapshotsRoutes = require('./routes/snapshots');

const app = express();
app.use(cors());
app.use(express.json());

const TEST_USER_ID = process.env.TEST_USER_ID;

// ==== HELPER: GET USER ID ====
let defaultUserId = null;
async function getDefaultUserId() {
  if (defaultUserId) return defaultUserId;
  const { data, error } = await supabase.from('users').select('id').limit(1);
  if (error || !data || data.length === 0) throw new Error('No default user found');
  defaultUserId = data[0].id;
  return defaultUserId;
}

// ==== HELPER: SPAM FILTER ====
function isSpamToken(symbol, priceUsd, valueUsd) {
  const s = (symbol || '').toString().toLowerCase();
  if (!priceUsd || priceUsd <= 0) return true;
  if (s.includes('http') || s.includes('.com') || s.includes('.io')) return true;
  const badSubstrings = ['visit ', 'claim ', 'rewards', 'reward', 'bonus', 'gift', 'airdrop', 'notice', 'urgent', 'secure your funds'];
  if (badSubstrings.some((bad) => s.includes(bad))) return true;
  if (valueUsd != null && valueUsd < 1) return true;
  return false;
}

// ==== HELPER: EXPOSURE ENGINE ====
function classifyHoldingExposure(holding) {
  const value = Number(holding.value_usd || 0);
  if (!value || value <= 0) return { bucket: 'unknown', subtype: 'unknown', isCryptoExposure: false, cryptoUnderlying: null, exposureUsd: 0 };
  
  const assetClass = holding.asset_class || '';
  const accountType = holding.accounts?.type || '';
  const provider = holding.accounts?.connections?.provider || '';
  const rawSymbol = (holding.symbol || '').toString().trim().toUpperCase();

  const BTC_ETFS = ['IBIT', 'FBTC', 'GBTC', 'BTC', 'BITB', 'ARKB', 'BITO', 'HODL', 'BRRR', 'BTCO', 'EZBC'];
  const ETH_ETFS = ['ETHA', 'ETHE', 'ETH', 'FETH', 'QETH'];
  const SOL_ETFS = ['BSOL'];
  const CRYPTO_EQUITIES = ['MSTR', 'MARA', 'CEP', 'MTPLF', '3350', 'CEPO', 'BLSH', 'BMNR', 'COIN', 'GLXY', 'BRPHF', 'RIOT', 'CLSK', 'HUT', 'HIVE', 'CORZ', 'CIFR', 'BITD'];
  const STABLECOIN_SYMBOLS = ['USDT', 'USDC', 'DAI', 'TUSD', 'USDP', 'FDUSD', 'GUSD'];
  const GOLD_ETFS = ['GLD', 'IAU', 'SGOL', 'PHYS'];
  const SILVER_ETFS = ['SLV', 'SIVR', 'PSLV'];
  const BROAD_COMMODITY_ETFS = ['DBC', 'COMT', 'GSG', 'USCI'];
  const REAL_ESTATE_ETFS = ['VNQ', 'SCHH', 'IYR', 'XLRE', 'REET', 'RWR'];
  const INTL_EQUITY_ETFS = ['VXUS', 'VEA', 'IEFA', 'EFA', 'IXUS', 'VEU', 'SCHF', 'ACWX', 'EEM', 'VWO', 'EWJ', 'EWU', 'EWA', 'EWC', 'EWG', 'EWQ', 'EWH', 'EWS', 'EWY', 'EWT', 'EZA', 'EWZ'];

  const isStable = STABLECOIN_SYMBOLS.includes(rawSymbol) || rawSymbol.endsWith('USD');

  let bucket = 'unknown';
  let subtype = 'unknown';
  let isCryptoExposure = false;
  let cryptoUnderlying = null;

  if (assetClass === 'crypto') {
    bucket = 'crypto';
    isCryptoExposure = true;
    if (isStable) subtype = 'stablecoin';
    else if (provider === 'wallet' || accountType === 'crypto_wallet') subtype = 'spot_on_chain';
    else subtype = 'spot_custodial';
  } else if (assetClass === 'equity') {
    if (BTC_ETFS.includes(rawSymbol)) { bucket = 'crypto'; subtype = 'crypto_etf'; isCryptoExposure = true; cryptoUnderlying = 'BTC'; }
    else if (ETH_ETFS.includes(rawSymbol)) { bucket = 'crypto'; subtype = 'crypto_etf'; isCryptoExposure = true; cryptoUnderlying = 'ETH'; }
    else if (SOL_ETFS.includes(rawSymbol)) { bucket = 'crypto'; subtype = 'crypto_etf'; isCryptoExposure = true; cryptoUnderlying = 'SOL'; }
    else if (CRYPTO_EQUITIES.includes(rawSymbol)) { bucket = 'crypto'; subtype = 'crypto_equity'; isCryptoExposure = true; }
    else if (GOLD_ETFS.includes(rawSymbol)) { bucket = 'commodities'; subtype = 'gold'; }
    else if (SILVER_ETFS.includes(rawSymbol)) { bucket = 'commodities'; subtype = 'silver'; }
    else if (BROAD_COMMODITY_ETFS.includes(rawSymbol)) { bucket = 'commodities'; subtype = 'commodity_fund'; }
    else if (REAL_ESTATE_ETFS.includes(rawSymbol)) { bucket = 'real_estate'; subtype = 'reit_etf'; }
    else if (INTL_EQUITY_ETFS.includes(rawSymbol)) { bucket = 'equity'; subtype = 'intl_equity'; }
    else { bucket = 'equity'; subtype = 'us_equity'; }
  } else if (assetClass === 'cash') {
    bucket = 'cash'; subtype = 'cash';
  } else if (assetClass === 'fixed_income') {
    bucket = 'fixed_income'; subtype = 'fixed_income';
  } else if (assetClass === 'real_estate' || accountType === 'real_estate') {
    bucket = 'real_estate'; subtype = 'direct_property';
  }
  return { bucket, subtype, isCryptoExposure, cryptoUnderlying, exposureUsd: value };
}

// ==== PLAID SETUP ====
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

// ==========================================
// ROUTES
// ==========================================

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ✅ CHANGE 3: Mount the Snapshots Route (This delegates logic to your new file)
app.use('/api/snapshots', snapshotsRoutes);

app.use('/api/wallets', walletsRoutes);

app.use('/api/prices', pricesRoutes);

// ====== MANUAL HOLDING ENTRY (Updated with Cost Basis + Live Pricing) ======
app.post('/api/holdings/manual', async (req, res) => {
  try {
    const { 
      connectionName, 
      accountName, 
      symbol, 
      quantity, 
      priceUsd,      // This is now treated as "Cost Basis" / Purchase Price
      assetClass, 
      effectiveDate 
    } = req.body;

    if (!symbol || quantity == null || priceUsd == null || !assetClass) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1. Try to fetch the LIVE price automatically
    // (Requires that you created services/priceService.js in the previous step)
    let currentPrice = priceUsd; // Default to what user typed
    try {
       const { getPrice } = require('./services/priceService');
       const fetchedPrice = await getPrice(symbol, assetClass);
       if (fetchedPrice) {
         currentPrice = fetchedPrice;
         console.log(`Using live price for ${symbol}: $${currentPrice}`);
       }
    } catch (e) {
       console.log('Price service skipped or failed:', e.message);
    }

    const valueUsd = quantity * currentPrice;

    // 2. Create/Find Connection & Account (Same as before)
    const { data: connection, error: connError } = await supabase.from('connections')
      .insert({ user_id: TEST_USER_ID, provider: 'manual', identifier: connectionName || 'manual-conn' })
      .select('*').single();
      
    // (If connection exists, we really should select it, but for MVP insert is fine if unique constraint isn't hit. 
    // If you get errors here, we can refine to "upsert" later.)
    if (connError && !connection) return res.status(500).json({ error: connError.message });

    const { data: account, error: accError } = await supabase.from('accounts')
      .insert({ connection_id: connection.id, name: accountName || 'Manual Acct', type: 'manual', currency: 'USD' })
      .select('*').single();
      
    if (accError && !account) return res.status(500).json({ error: accError.message });

    // 3. Insert Holding with BOTH prices
    const now = new Date().toISOString();
    const effectiveDateForDb = effectiveDate || now.slice(0, 10);

    const { data: holding, error: holdError } = await supabase.from('holdings').insert({
        account_id: account.id, 
        symbol, 
        quantity, 
        
        // The "Live" Market Value (used for Net Worth)
        price_usd: currentPrice, 
        
        // The "Cost Basis" (what you paid)
        purchase_price_usd: priceUsd, 

        value_usd: valueUsd,
        asset_class: assetClass, 
        as_of: now, 
        effective_date: effectiveDateForDb
    }).select('*').single();

    if (holdError) return res.status(500).json({ error: holdError.message });

    // 4. Trigger a Snapshot update so the chart moves
    // (We use the controller function logic you added earlier via the route)
    // Ideally the frontend calls /write after this, but we return success here.

    res.json({ message: 'Manual holding saved', holding });
  } catch (err) {
    console.error('Error in /api/holdings/manual:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== CALCULATE TOTAL NET WORTH (Total of Holdings only) ======
app.get('/api/holdings/total', async (req, res) => {
  try {
    const { data, error } = await supabase.from('holdings').select('value_usd, accounts!inner(connection_id, connections!inner(user_id))').eq('accounts.connections.user_id', TEST_USER_ID);
    if (error) return res.status(500).json({ error: error.message });
    const total = (data || []).reduce((sum, h) => sum + Number(h.value_usd), 0);
    res.json({ totalNetWorthUsd: total });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ====== NET WORTH SUMMARY (The Dashboard Endpoint) ======
app.get('/api/networth/summary', async (req, res) => {
  try {
    const { data: holdings, error: holdingsError } = await supabase
      .from('holdings')
      .select(`value_usd, asset_class, accounts!inner(connections!inner(user_id))`)
      .eq('accounts.connections.user_id', TEST_USER_ID);

    if (holdingsError) return res.status(500).json({ error: holdingsError.message });

    let totalAssets = 0, totalCrypto = 0, totalTradfi = 0;
    for (const h of holdings || []) {
      const value = Number(h.value_usd || 0);
      totalAssets += value;
      if (h.asset_class === 'crypto') totalCrypto += value;
      else totalTradfi += value;
    }

    const { data: props, error: propsError } = await supabase.from('real_estate_properties').select('current_value_usd').eq('user_id', TEST_USER_ID);
    if (propsError) return res.status(500).json({ error: propsError.message });

    let totalRealEstate = 0;
    for (const p of props || []) { totalRealEstate += Number(p.current_value_usd || 0); }
    
    totalAssets += totalRealEstate;
    totalTradfi += totalRealEstate;

    const { data: liabs, error: liabsError } = await supabase.from('liabilities').select('balance_usd').eq('user_id', TEST_USER_ID);
    if (liabsError) return res.status(500).json({ error: liabsError.message });

    let totalLiabilities = 0;
    for (const l of liabs || []) { totalLiabilities += Number(l.balance_usd || 0); }

    return res.json({
      totalAssetsUsd: totalAssets, totalLiabilitiesUsd: totalLiabilities, totalNetWorthUsd: totalAssets - totalLiabilities,
      totalCryptoUsd: totalCrypto, totalTradfiUsd: totalTradfi, totalRealEstateUsd: totalRealEstate,
    });
  } catch (err) { return res.status(500).json({ error: 'Server error' }); }
});

// ====== LIABILITIES ROUTES ======
app.get('/api/liabilities/list', async (req, res) => {
    try {
        const { data, error } = await supabase.from('liabilities').select('*').eq('user_id', TEST_USER_ID).order('as_of', { ascending: false });
        if(error) return res.status(500).json({error: error.message});
        res.json({ liabilities: data || [] });
    } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/liabilities/manual', async (req, res) => {
    try {
        const { name, type, balanceUsd, creditLimitUsd, interestRate, minPaymentUsd, notes } = req.body;
        if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
        const { data, error } = await supabase.from('liabilities').insert({
            user_id: TEST_USER_ID, name, type, balance_usd: balanceUsd ?? 0, credit_limit_usd: creditLimitUsd ?? null,
            interest_rate: interestRate ?? null, min_payment_usd: minPaymentUsd ?? null, notes: notes || null,
        }).select('*').single();
        if(error) return res.status(500).json({error: error.message});
        res.json({ liability: data });
    } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

// ====== REAL ESTATE ROUTES ======
app.get('/api/realestate/list', async (req, res) => {
    try {
        const { data, error } = await supabase.from('real_estate_properties').select('*').eq('user_id', TEST_USER_ID).order('created_at', { ascending: false });
        if(error) return res.status(500).json({error: error.message});
        res.json({ properties: data || [] });
    } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/realestate/manual', async (req, res) => {
    try {
        const { name, propertyType, city, state, currentValueUsd, purchasePriceUsd, notes } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });
        const { data, error } = await supabase.from('real_estate_properties').insert({
            user_id: TEST_USER_ID, name, property_type: propertyType || null, city: city || null, state: state || null,
            current_value_usd: currentValueUsd ?? 0, purchase_price_usd: purchasePriceUsd ?? null, notes: notes || null,
        }).select('*').single();
        if(error) return res.status(500).json({error: error.message});
        res.json({ property: data });
    } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

// ====== HOLDINGS LIST ======
// ====== HOLDINGS LIST (Updated to include Cost Basis & Grouping Info) ======
// ====== HOLDINGS LIST (Final) ======
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
        purchase_price_usd,
        effective_date,      
        asset_class,
        as_of,
        accounts!inner(
          id,
          name,
          type,
          connections!inner(
            id,
            provider,
            nickname,
            identifier
          )
        )
      `)
      .eq('accounts.connections.user_id', TEST_USER_ID)
      .order('value_usd', { ascending: false });

    if (error) {
        console.error("Holdings List Error:", error);
        return res.status(500).json({ error: error.message });
    }
    
    res.json({ holdings: data || [] });
  } catch (err) { 
      console.error("Server Error in Holdings List:", err);
      res.status(500).json({ error: 'Server error' }); 
  }
});

// ====== DELETE HOLDING ======
app.delete('/api/holdings/:id', async (req, res) => {
  try {
    const holdingId = req.params.id;
    const { data: rows } = await supabase.from('holdings').select(`id, accounts!inner(connections!inner(user_id))`).eq('id', holdingId).eq('accounts.connections.user_id', TEST_USER_ID).limit(1);
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Holding not found' });
    const { error: deleteError } = await supabase.from('holdings').delete().eq('id', holdingId);
    if (deleteError) return res.status(500).json({ error: 'Failed to delete holding' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ====== EXPOSURE SUMMARY ======
app.get('/api/exposure/summary', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('holdings')
      .select(`id, symbol, quantity, price_usd, value_usd, asset_class, as_of, accounts!inner(id, name, type, connections!inner(id, provider, user_id, nickname))`)
      .eq('accounts.connections.user_id', TEST_USER_ID);

    if (error) return res.status(500).json({ error: error.message });

    let totalNetWorthUsd = 0, totalCryptoExposureUsd = 0, totalTradfiExposureUsd = 0;
    let spotOnChainUsd = 0, spotCustodialUsd = 0, stablecoinUsd = 0, cryptoEtfUsd = 0, cryptoEquityUsd = 0, otherCryptoUsd = 0;
    const bucketMap = {};

    for (const h of data || []) {
      const val = Number(h.value_usd || 0);
      if (!val || val <= 0) continue;
      totalNetWorthUsd += val;
      const cls = classifyHoldingExposure(h);
      if (!bucketMap[cls.bucket]) bucketMap[cls.bucket] = 0;
      bucketMap[cls.bucket] += cls.exposureUsd;

      if (cls.isCryptoExposure) {
        totalCryptoExposureUsd += cls.exposureUsd;
        if (cls.subtype === 'spot_on_chain') spotOnChainUsd += cls.exposureUsd;
        else if (cls.subtype === 'spot_custodial') spotCustodialUsd += cls.exposureUsd;
        else if (cls.subtype === 'stablecoin') stablecoinUsd += cls.exposureUsd;
        else if (cls.subtype === 'crypto_etf') cryptoEtfUsd += cls.exposureUsd;
        else if (cls.subtype === 'crypto_equity') cryptoEquityUsd += cls.exposureUsd;
        else otherCryptoUsd += cls.exposureUsd;
      } else {
        totalTradfiExposureUsd += cls.exposureUsd;
      }
    }
    const exposuresByBucket = Object.keys(bucketMap).map((bucket) => ({ bucket, exposureUsd: bucketMap[bucket], pctOfNetWorth: totalNetWorthUsd > 0 ? (bucketMap[bucket] / totalNetWorthUsd) * 100 : 0 }));
    res.json({ totalNetWorthUsd, totalCryptoExposureUsd, totalTradfiExposureUsd, cryptoBreakdown: { spotOnChainUsd, spotCustodialUsd, stablecoinUsd, cryptoEtfUsd, cryptoEquityUsd, otherCryptoUsd, totalCryptoExposureUsd }, exposuresByBucket });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ====== PLAID ROUTES ======
app.post('/api/plaid/create-link-token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({ user: { client_user_id: TEST_USER_ID }, client_name: 'Net Worth Tracker MVP', products: ['investments'], language: 'en', country_codes: ['US'] });
    res.json({ link_token: response.data.link_token });
  } catch (err) { res.status(500).json({ error: 'Failed to create link token' }); }
});

app.post('/api/plaid/exchange-public-token', async (req, res) => {
  try {
    const { public_token } = req.body;
    if (!public_token) return res.status(400).json({ error: 'public_token is required' });
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token });
    const { data: connection, error: connError } = await supabase.from('connections').insert({ user_id: TEST_USER_ID, provider: 'plaid', identifier: exchangeResponse.data.item_id, access_token: exchangeResponse.data.access_token }).select('*').single();
    if (connError) return res.status(500).json({ error: connError.message });
    res.json({ message: 'Plaid connection saved', connectionId: connection.id });
  } catch (err) { res.status(500).json({ error: 'Failed to exchange public token' }); }
});

app.post('/api/plaid/sync-holdings', async (req, res) => {
  try {
    const { connectionId } = req.body;
    if (!connectionId) return res.status(400).json({ error: 'connectionId is required' });
    const { data: connection } = await supabase.from('connections').select('*').eq('id', connectionId).single();
    if (!connection) return res.status(404).json({ error: 'Connection not found' });

    const holdingsResponse = await plaidClient.investmentsHoldingsGet({ access_token: connection.access_token });
    const now = new Date().toISOString();
    const securityMap = {};
    holdingsResponse.data.securities.forEach((sec) => { securityMap[sec.security_id] = sec; });
    
    // Sync Accounts & Holdings logic (Condensed for brevity but fully functional)
    // In a full refactor, this moves to a Plaid Service
    const accountMap = {};
    for (const acct of holdingsResponse.data.accounts) {
        const { data: dbAccount } = await supabase.from('accounts').insert({ connection_id: connection.id, name: acct.name, type: 'investment', currency: acct.balances.iso_currency_code || 'USD' }).select('*').single();
        accountMap[acct.account_id] = dbAccount.id;
    }
    for (const h of holdingsResponse.data.holdings) {
        const sec = securityMap[h.security_id];
        if (!sec) continue;
        await supabase.from('holdings').insert({
            account_id: accountMap[h.account_id], symbol: sec.ticker_symbol || sec.name, quantity: h.quantity, price_usd: sec.close_price, value_usd: h.quantity * sec.close_price, asset_class: 'equity', as_of: now
        });
    }
    
    // Trigger Snapshot!
    // Note: We use the imported controller directly here for convenience until we move Plaid logic to a controller.
    // However, since writeSnapshot expects (req, res), we can't call it easily here as a function without mocking req/res.
    // For now, we will assume the frontend calls /write snapshot after this returns success.
    
    res.json({ message: 'Plaid holdings synced' });
  } catch (err) { res.status(500).json({ error: 'Failed to sync Plaid holdings' }); }
});



// ====== START SERVER ======
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));