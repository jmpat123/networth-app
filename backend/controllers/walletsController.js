// backend/controllers/walletsController.js
const { supabase } = require('../db/supabaseClient');
const axios = require('axios');

const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
const TEST_USER_ID = process.env.TEST_USER_ID;

// Helper: Spam Filter
function isSpamToken(symbol, priceUsd, valueUsd) {
  const s = (symbol || '').toString().toLowerCase();
  if (!priceUsd || priceUsd <= 0) return true;
  if (s.includes('http') || s.includes('.com') || s.includes('.io')) return true;
  const badSubstrings = ['visit ', 'claim ', 'rewards', 'reward', 'bonus', 'gift', 'airdrop'];
  if (badSubstrings.some((bad) => s.includes(bad))) return true;
  if (valueUsd != null && valueUsd < 1) return true;
  return false;
}

// POST /api/wallets/add
async function addWallet(req, res) {
  try {
    const { address, chain, nickname } = req.body;
    if (!address || !chain) return res.status(400).json({ error: 'address and chain required' });

    const { data: conn, error } = await supabase.from('connections')
      .insert({ 
        user_id: TEST_USER_ID, 
        provider: 'wallet', 
        identifier: address.toLowerCase(), 
        chain: chain.toLowerCase(), 
        nickname 
      })
      .select('*')
      .single();

    if (error) throw error;

    // Create Account for this wallet
    await supabase.from('accounts').insert({ 
      connection_id: conn.id, 
      name: nickname || 'Crypto Wallet', 
      type: 'crypto_wallet', 
      currency: 'USD' 
    });

    res.json({ success: true, connection: conn });
  } catch(e) { 
    console.error('Error adding wallet:', e);
    res.status(500).json({error: e.message}); 
  }
}

// GET /api/wallets
async function listWallets(req, res) {
    const { data } = await supabase.from('connections').select('*').eq('provider', 'wallet').eq('user_id', TEST_USER_ID);
    res.json({ wallets: data || [] });
}

// GET /api/wallets/refresh (The Missing Logic!)
async function refreshWallets(req, res) {
  try {
    const userId = TEST_USER_ID;
    if (!MORALIS_API_KEY) return res.status(500).json({ error: 'MORALIS_API_KEY missing' });

    // 1. Get Wallets
    const { data: wallets } = await supabase.from('connections').select('*').eq('provider', 'wallet').eq('user_id', userId);
    if (!wallets || wallets.length === 0) return res.json({ message: "No wallets to sync" });

    const nowIso = new Date().toISOString();
    const results = [];

    for (const w of wallets) {
      const address = w.identifier;
      const chain = (w.chain || 'eth').toLowerCase();

      // Get Account ID
      const { data: accounts } = await supabase.from('accounts').select('id').eq('connection_id', w.id).limit(1);
      if (!accounts || accounts.length === 0) continue;
      const accountId = accounts[0].id;

      // 2. Call Moralis
      const url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${chain}`;
      try {
          const response = await axios.get(url, { headers: { 'x-api-key': MORALIS_API_KEY } });
          const tokens = response.data.result || [];

          // 3. Process Tokens
          const holdingsToInsert = tokens.map(t => {
              const decimals = Number(t.decimals || 18);
              const quantity = Number(t.balance) / (10 ** decimals);
              const priceUsd = Number(t.usd_price || 0);
              const valueUsd = Number(t.usd_value || (quantity * priceUsd));
              
              return {
                  account_id: accountId,
                  symbol: t.symbol || 'UNKNOWN',
                  quantity,
                  price_usd: priceUsd,
                  value_usd: valueUsd,
                  asset_class: 'crypto',
                  as_of: nowIso
              };
          }).filter(h => !isSpamToken(h.symbol, h.price_usd, h.value_usd));

          // 4. Replace Holdings in DB
          await supabase.from('holdings').delete().eq('account_id', accountId);
          if (holdingsToInsert.length > 0) {
              await supabase.from('holdings').insert(holdingsToInsert);
          }
          
          results.push({ address, count: holdingsToInsert.length });

      } catch (moralisErr) {
          console.error(`Moralis failed for ${address}:`, moralisErr.message);
      }
    }

    // 5. Trigger Snapshot
    // We can call the snapshot logic here or let the frontend trigger it.
    // For now, we just return success so the frontend triggers the snapshot.
    res.json({ success: true, synced: results });

  } catch (err) {
    console.error('Error refreshing wallets:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { addWallet, listWallets, refreshWallets };