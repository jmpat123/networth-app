// backend/controllers/priceController.js
const { supabase } = require('../db/supabaseClient');
const { getPrice } = require('../services/priceService');

async function refreshAllPrices(req, res) {
  try {
    const userId = process.env.TEST_USER_ID;

    // 1. Get all holdings for this user
    // We join accounts->connections to ensure we only get THIS user's holdings
    const { data: holdings, error } = await supabase
      .from('holdings')
      .select(`
        id,
        symbol,
        quantity,
        asset_class,
        accounts!inner(
          connections!inner(user_id)
        )
      `)
      .eq('accounts.connections.user_id', userId);

    if (error) throw error;

    let updatedCount = 0;
    const updates = [];

    console.log(`[PriceController] Refreshing prices for ${holdings.length} holdings...`);

    // 2. Loop through and fetch new prices
    for (const h of holdings) {
      // Skip assets that are essentially "cash" or don't have symbols
      if (h.asset_class === 'cash' || !h.symbol) continue;

      // Fetch live price
      const newPrice = await getPrice(h.symbol, h.asset_class);

      if (newPrice) {
        const newValue = newPrice * Number(h.quantity);
        
        // Prepare the update
        updates.push(
          supabase
            .from('holdings')
            .update({ 
              price_usd: newPrice, 
              value_usd: newValue,
              as_of: new Date().toISOString()
            })
            .eq('id', h.id)
        );
        updatedCount++;
      }
    }

    // 3. Execute all updates
    await Promise.all(updates);

    res.json({ success: true, message: `Updated prices for ${updatedCount} assets.` });

  } catch (err) {
    console.error('Error refreshing prices:', err);
    res.status(500).json({ error: 'Failed to refresh prices' });
  }
}

module.exports = { refreshAllPrices };