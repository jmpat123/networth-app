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
            user_id
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

    res.json({ message: 'Plaid holdings synced' });
  } catch (err) {
    console.error('Plaid sync error:', err.response?.data || err);
    res.status(500).json({ error: 'Failed to sync Plaid holdings' });
  }
});

// ====== START SERVER ======
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));
