const { supabase } = require('../db/supabaseClient.js');

async function getSnapshots(req, res) {
  try {
    const userId = process.env.TEST_USER_ID;

    const { data, error } = await supabase
      .from('snapshots')
      .select(
        'id, taken_at, total_net_worth_usd, total_crypto_usd, total_tradfi_usd, total_liabilities_usd, total_real_estate_usd, breakdown, source'
      )
      .eq('user_id', userId)
      .order('taken_at', { ascending: true });

    if (error) {
      console.error('Error fetching snapshots:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({
      userId,
      count: data?.length || 0,
      snapshots: data || [],
    });
  } catch (err) {
    console.error('Error in getSnapshots:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function writeSnapshot(req, res) {
  try {
    const userId = process.env.TEST_USER_ID;

    // ---- 1) Fetch holdings ----
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    const { data: holdings, error: holdingsError } = await supabase
      .from('holdings')
      .select('value_usd, asset_class, effective_date')
      // you currently filter by user via the accounts/connections join;
      // keep that logic, and also add:
      .lte('effective_date', today);
    

    let crypto = 0;
    let tradfi = 0;

    for (const h of holdings || []) {
      const value = Number(h.value_usd || 0);
      if (h.asset_class === 'crypto') crypto += value;
      else tradfi += value;
    }

    const totalAssets = crypto + tradfi;

    // ---- 2) Fetch liabilities ----
    const { data: liabs } = await supabase
      .from('liabilities')
      .select('balance_usd')
      .eq('user_id', userId);

    let totalLiabilities = 0;
    for (const l of liabs || []) {
      totalLiabilities += Number(l.balance_usd || 0);
    }

    // ---- 3) Compute net worth ----
    const totalNetWorth = totalAssets - totalLiabilities;

    // ---- 4) Insert snapshot ----
    const { data: snapshot, error } = await supabase
      .from('snapshots')
      .insert({
        user_id: userId,
        total_net_worth_usd: totalNetWorth,
        total_crypto_usd: crypto,
        total_tradfi_usd: tradfi,
        total_liabilities_usd: totalLiabilities,
        total_real_estate_usd: 0,
        breakdown: { crypto, tradfi },
        source: 'manual_write',
      })
      .select('*')
      .single();

    if (error) {
      console.error('Error writing snapshot:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, snapshot });
  } catch (err) {
    console.error('Error in writeSnapshot:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  getSnapshots,
  writeSnapshot,
};
