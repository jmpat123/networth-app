import React, { useState, useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Pie, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler
);

function App() {
  const backendUrl = 'http://localhost:4000';

  // ===== STATE =====
  const [totalNetWorth, setTotalNetWorth] = useState(null);
  const [loadingTotal, setLoadingTotal] = useState(false);
  const [cryptoTotal, setCryptoTotal] = useState(0);
  const [tradfiTotal, setTradfiTotal] = useState(0);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalLiabilities, setTotalLiabilities] = useState(0);
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [timeframe, setTimeframe] = useState('ALL');
  const [exposure, setExposure] = useState(null);
  const [loadingExposure, setLoadingExposure] = useState(false);
  const [holdings, setHoldings] = useState([]);
  const [loadingHoldings, setLoadingHoldings] = useState(false);
  const [liabilities, setLiabilities] = useState([]);
  const [loadingLiabilities, setLoadingLiabilities] = useState(false);
  const [realEstate, setRealEstate] = useState([]);
  const [loadingRealEstate, setLoadingRealEstate] = useState(false);

  // Forms
 // Updated Manual Asset Form (Now with Effective Date)
 const [form, setForm] = useState({
  connectionName: 'Manual Portfolio',
  accountName: 'Test Account',
  symbol: 'BTC',
  quantity: 0,
  priceUsd: 0,
  assetClass: 'crypto',
  effectiveDate: new Date().toISOString().slice(0, 10) // Default to today (YYYY-MM-DD)
});

// NEW: Wallet Form State
const [walletForm, setWalletForm] = useState({ address: '', chain: 'eth', nickname: '' });
  const [liabilityForm, setLiabilityForm] = useState({ name: 'Mortgage', type: 'mortgage', balanceUsd: 0, interestRate: 0, minPaymentUsd: 0 });
  const [realEstateForm, setRealEstateForm] = useState({ name: 'My House', propertyType: 'primary_home', city: 'Austin', state: 'TX', currentValueUsd: 0 });

  // Plaid
  const [linkToken, setLinkToken] = useState(null);
  const [plaidSyncing, setPlaidSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // ===== HELPERS =====
  function filterSnapshotsByTimeframe(allSnapshots) {
    if (!allSnapshots || allSnapshots.length === 0) return [];
    const now = new Date();
    if (timeframe === 'ALL') return allSnapshots;
    
    // Simple filter logic
    const daysMap = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365 };
    if (timeframe === 'YTD') {
        const jan1 = new Date(now.getFullYear(), 0, 1);
        return allSnapshots.filter(s => new Date(s.taken_at) >= jan1);
    }
    const cutoff = new Date(now.getTime() - (daysMap[timeframe] * 24 * 60 * 60 * 1000));
    return allSnapshots.filter(s => new Date(s.taken_at) >= cutoff);
  }

  // ===== DATA FETCHING =====
  const fetchAllData = () => {
    fetch(`${backendUrl}/api/networth/summary`).then(r=>r.json()).then(d => {
        setTotalNetWorth(d.totalNetWorthUsd);
        setTotalAssets(d.totalAssetsUsd);
        setTotalLiabilities(d.totalLiabilitiesUsd);
        setCryptoTotal(d.totalCryptoUsd);
        setTradfiTotal(d.totalTradfiUsd);
    });
    fetch(`${backendUrl}/api/snapshots`).then(r=>r.json()).then(d => setSnapshots(d.snapshots || []));
    fetch(`${backendUrl}/api/exposure/summary`).then(r=>r.json()).then(d => setExposure(d));
    fetch(`${backendUrl}/api/holdings/list`).then(r=>r.json()).then(d => setHoldings(d.holdings || []));
    fetch(`${backendUrl}/api/liabilities/list`).then(r=>r.json()).then(d => setLiabilities(d.liabilities || []));
    fetch(`${backendUrl}/api/realestate/list`).then(r=>r.json()).then(d => setRealEstate(d.properties || []));
  };

  useEffect(() => { fetchAllData(); }, []);

  // ===== HANDLERS =====
  const handleManualAssetSubmit = async (e) => {
    e.preventDefault();
    await fetch(`${backendUrl}/api/holdings/manual`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(form)});
    await fetch(`${backendUrl}/api/snapshots/write`, { method: 'POST' }); // Update snapshot immediately
    fetchAllData();
    setMessage('Asset Added');
  };

  const handleDelete = async (id) => {
    if(!window.confirm("Are you sure you want to delete this asset?")) return;
  
    await fetch(`${backendUrl}/api/holdings/${id}`, { method: 'DELETE' });
    await fetch(`${backendUrl}/api/snapshots/write`, { method: 'POST' }); // Update history
    fetchAllData(); // Refresh UI
    setMessage('Asset deleted');
  };

  const handleLiabilitySubmit = async (e) => {
    e.preventDefault();
    await fetch(`${backendUrl}/api/liabilities/manual`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(liabilityForm)});
    await fetch(`${backendUrl}/api/snapshots/write`, { method: 'POST' });
    fetchAllData();
    setMessage('Liability Added');
  };

  const handleWalletSubmit = async (e) => {
    e.preventDefault();
    await fetch(`${backendUrl}/api/wallets/add`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(walletForm)
    });
    // Trigger a refresh to pull the new tokens from Moralis
    await fetch(`${backendUrl}/api/wallets/refresh`); 
    await fetch(`${backendUrl}/api/snapshots/write`, { method: 'POST' });
    fetchAllData();
    setMessage('Wallet Added & Syncing...');
    setWalletForm({ address: '', chain: 'eth', nickname: '' }); // Reset form
  };

  const handlePriceRefresh = async () => {
    setMessage('Refreshing asset prices...');
    await fetch(`${backendUrl}/api/prices/refresh`, { method: 'POST' });
    await fetch(`${backendUrl}/api/snapshots/write`, { method: 'POST' }); // Record the new values
    fetchAllData(); // Refresh UI
    setMessage('Prices updated!');
  };

  // Plaid Link Setup
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token) => {
        await fetch(`${backendUrl}/api/plaid/exchange-public-token`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({public_token})});
        setPlaidSyncing(true);
        await fetch(`${backendUrl}/api/plaid/sync-holdings`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({connectionId: 'TODO'})}); // Simplified for UI demo
        setPlaidSyncing(false);
        fetchAllData();
    }
  });

  useEffect(() => {
    fetch(`${backendUrl}/api/plaid/create-link-token`, { method: 'POST' }).then(r=>r.json()).then(d => setLinkToken(d.link_token));
  }, []);


  // ===== CHART DATA PREP =====
  const filteredSnapshots = filterSnapshotsByTimeframe(snapshots);
  const netWorthLineData = {
    labels: filteredSnapshots.map(s => new Date(s.taken_at).toLocaleDateString()),
    datasets: [{ label: 'Net Worth', data: filteredSnapshots.map(s => s.total_net_worth_usd), borderColor: '#2563eb', tension: 0.4, pointRadius: 0 }]
  };

  // ============================================
  //  THE NEW LAYOUT (Sidebar + Grid)
  // ============================================
  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', background: '#f4f4f5' }}>
        
        {/* SIDEBAR */}
        <div style={{ width: '280px', background: '#fff', borderRight: '1px solid #e4e4e7', padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 4px 0' }}>Unified Portfolio</h2>
                <p style={{ margin: 0, color: '#71717a', fontSize: '14px' }}>Net Worth Tracker MVP</p>
            </div>

{/* Quick Actions */}
<div>
                <h3 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#a1a1aa', letterSpacing: '0.5px', marginBottom: '16px' }}>Actions</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    
                    {/* 1. Plaid Button */}
                    <button onClick={() => ready ? open() : null} disabled={!ready} style={btnStyle}>+ Connect Plaid</button>
                    
                    <button onClick={handlePriceRefresh} style={{...btnStyle, background: '#fff', color: '#18181b', border: '1px solid #e4e4e7'}}>
    ↻ Refresh Prices
</button>

                    {/* 2. NEW: Add Crypto Wallet */}
                    <div style={cardStyle}>
                        <h4 style={{margin: '0 0 8px 0', fontSize: '14px'}}>Add Crypto Wallet</h4>
                        <input placeholder="Address (0x...)" value={walletForm.address} onChange={e => setWalletForm({...walletForm, address: e.target.value})} style={inputStyle} />
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                            <select value={walletForm.chain} onChange={e => setWalletForm({...walletForm, chain: e.target.value})} style={{...inputStyle, marginBottom:0}}>
                                <option value="eth">Ethereum</option>
                                <option value="sol">Solana</option>
                                <option value="btc">Bitcoin</option>
                                <option value="polygon">Polygon</option>
                            </select>
                            <input placeholder="Nickname" value={walletForm.nickname} onChange={e => setWalletForm({...walletForm, nickname: e.target.value})} style={{...inputStyle, marginBottom:0}} />
                        </div>
                        <button onClick={handleWalletSubmit} style={actionBtnStyle}>Sync Wallet</button>
                    </div>

                  {/* 3. Manual Asset (Corrected) */}
                  <div style={cardStyle}>
                        <h4 style={{margin: '0 0 8px 0', fontSize: '14px'}}>Add Manual Asset</h4>
                        
                        {/* Field 1: SYMBOL (Text) */}
                        <input 
                            placeholder="Symbol (e.g. BTC, AAPL)" 
                            type="text"
                            value={form.symbol} 
                            onChange={e => setForm({...form, symbol: e.target.value.toUpperCase()})} 
                            style={inputStyle} 
                        />

                        <div style={{ display: 'flex', gap: '8px' }}>
                            {/* Field 2: QUANTITY (Number) */}
                            <input 
                                placeholder="Quantity" 
                                type="number" 
                                value={form.quantity} 
                                onChange={e => setForm({...form, quantity: e.target.value})} 
                                style={inputStyle} 
                            />
                            
                            {/* Field 3: COST BASIS (Number) */}
                            <input 
                                placeholder="Cost Basis ($)" 
                                type="number" 
                                value={form.priceUsd} 
                                onChange={e => setForm({...form, priceUsd: e.target.value})} 
                                style={inputStyle} 
                            />
                        </div>

                        {/* Field 4: DATE */}
                        <label style={{fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px'}}>Effective Date:</label>
                        <input 
                            type="date" 
                            value={form.effectiveDate} 
                            onChange={e => setForm({...form, effectiveDate: e.target.value})} 
                            style={inputStyle} 
                        />
                        
                        <button onClick={handleManualAssetSubmit} style={actionBtnStyle}>Add Asset</button>
                    </div>

                    {/* 4. Add Liability */}
                    <div style={cardStyle}>
                        <h4 style={{margin: '0 0 8px 0', fontSize: '14px'}}>Add Liability</h4>
                        <input placeholder="Name (Mortgage)" value={liabilityForm.name} onChange={e => setLiabilityForm({...liabilityForm, name: e.target.value})} style={inputStyle} />
                        <input placeholder="Balance" type="number" value={liabilityForm.balanceUsd} onChange={e => setLiabilityForm({...liabilityForm, balanceUsd: e.target.value})} style={inputStyle} />
                        <button onClick={handleLiabilitySubmit} style={actionBtnStyle}>Add Debt</button>
                    </div>
                </div>
            </div>
        </div>

        {/* MAIN CONTENT AREA */}
        <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
            
            {/* TOP ROW: Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '32px' }}>
                {/* Net Worth Card */}
                <div style={bigCardStyle}>
                    <h3 style={cardHeaderStyle}>Total Net Worth</h3>
                    <div style={{ fontSize: '36px', fontWeight: '800', color: '#18181b' }}>
                        ${totalNetWorth?.toLocaleString() || '---'}
                    </div>
                    <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '14px' }}>
                        <span style={{ color: '#16a34a' }}>Assets: ${totalAssets.toLocaleString()}</span>
                        <span style={{ color: '#dc2626' }}>Debt: ${totalLiabilities.toLocaleString()}</span>
                    </div>
                </div>

                {/* Exposure Card */}
                <div style={bigCardStyle}>
                    <h3 style={cardHeaderStyle}>Crypto vs TradFi</h3>
                    <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {cryptoTotal + tradfiTotal > 0 ? 
                            <Pie data={{ labels: ['Crypto', 'TradFi'], datasets: [{ data: [cryptoTotal, tradfiTotal], backgroundColor: ['#4f46e5', '#f97316'] }] }} options={{ plugins: { legend: { display: false } } }} />
                        : <p style={{color: '#aaa'}}>No Data</p>}
                    </div>
                </div>

                {/* Status Card */}
                <div style={bigCardStyle}>
                    <h3 style={cardHeaderStyle}>System Status</h3>
                    <div style={{ fontSize: '14px', color: '#52525b', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>🔌 Backend: <span style={{color: '#16a34a'}}>Connected</span></div>
                        <div>🏦 Plaid: {linkToken ? <span style={{color: '#16a34a'}}>Ready</span> : 'Loading...'}</div>
                        <div>📸 Snapshots: {snapshots.length} recorded</div>
                    </div>
                </div>
            </div>

            {/* MIDDLE ROW: Timeline */}
            <div style={{ ...bigCardStyle, marginBottom: '32px', padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                    <h3 style={cardHeaderStyle}>Wealth Timeline</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {['1W', '1M', '3M', '1Y', 'ALL'].map(tf => (
                            <button key={tf} onClick={() => setTimeframe(tf)} style={{ ...filterBtnStyle, background: timeframe === tf ? '#e4e4e7' : 'transparent' }}>{tf}</button>
                        ))}
                    </div>
                </div>
                <div style={{ height: '300px' }}>
                    {snapshots.length > 0 ? <Line data={netWorthLineData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /> : <p>No history yet.</p>}
                </div>
            </div>

            {/* BOTTOM ROW: Holdings & Liabilities Tables */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
                
                <div style={bigCardStyle}>
                    <h3 style={cardHeaderStyle}>Holdings</h3>
                    <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
        <thead style={{ borderBottom: '1px solid #e4e4e7', color: '#71717a' }}>
          <tr>
            <th style={thStyle}>Asset</th>
            <th style={thStyle}>Qty</th>
            <th style={thStyle}>Price</th>
            <th style={thStyle}>Value</th>
            <th style={thStyle}>Action</th> {/* NEW HEADER */}
          </tr>
        </thead>
        <tbody>
          {holdings.map(h => (
            <tr key={h.id} style={{ borderBottom: '1px solid #f4f4f5' }}>
              <td style={tdStyle}>
                <b>{h.symbol}</b> 
                <span style={{color:'#a1a1aa', fontSize:'12px', marginLeft: '4px'}}>
                  {h.asset_class}
                </span>
              </td>
              <td style={tdStyle}>{Number(h.quantity).toLocaleString()}</td>
              <td style={tdStyle}>${Number(h.price_usd).toLocaleString()}</td>
              <td style={tdStyle}>${Number(h.value_usd).toLocaleString()}</td>
              <td style={tdStyle}>
                {/* NEW DELETE BUTTON */}
                <button 
                  onClick={() => handleDelete(h.id)}
                  style={{color: 'red', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold'}}
                >
                  X
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      
                </div>

                <div style={bigCardStyle}>
                    <h3 style={cardHeaderStyle}>Liabilities</h3>
                    {liabilities.map(l => (
                        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f4f4f5' }}>
                            <span style={{ fontSize: '14px', fontWeight: '500' }}>{l.name}</span>
                            <span style={{ fontSize: '14px', color: '#dc2626' }}>-${Number(l.balance_usd).toLocaleString()}</span>
                        </div>
                    ))}
                </div>

            </div>
        </div>
    </div>
  );
}

// ===== STYLES =====
const btnStyle = { padding: '10px', background: '#18181b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' };
const cardStyle = { background: '#f4f4f5', padding: '12px', borderRadius: '8px' };
const inputStyle = { width: '100%', padding: '8px', marginBottom: '8px', border: '1px solid #e4e4e7', borderRadius: '4px', boxSizing: 'border-box' };
const actionBtnStyle = { width: '100%', padding: '8px', background: '#fff', border: '1px solid #e4e4e7', borderRadius: '4px', cursor: 'pointer', fontWeight: '600' };
const bigCardStyle = { background: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e4e4e7', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };
const cardHeaderStyle = { margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#18181b' };
const filterBtnStyle = { padding: '4px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: '#52525b' };
const thStyle = { textAlign: 'left', padding: '8px 4px', fontWeight: '500', fontSize: '12px' };
const tdStyle = { padding: '12px 4px' };

export default App;