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

  const [form, setForm] = useState({
    connectionName: 'Manual Portfolio',
    accountName: 'Test Account',
    symbol: 'BTC',
    quantity: 1.25,
    priceUsd: 50000,
    assetClass: 'crypto',
    effectiveDate: new Date().toISOString().slice(0, 10), // default today
  });
  

  const [liabilityForm, setLiabilityForm] = useState({
    name: 'Mortgage',
    type: 'mortgage',
    balanceUsd: 300000,
    interestRate: 0.05,
    minPaymentUsd: 2500,
    notes: '',
  });

  const [linkToken, setLinkToken] = useState(null);
  const [plaidConnectionId, setPlaidConnectionId] = useState(null);
  const [plaidSyncing, setPlaidSyncing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // =============================
  // TIMEFRAME FILTER FUNCTION
  // =============================
  function filterSnapshotsByTimeframe(allSnapshots) {
    if (!allSnapshots || allSnapshots.length === 0) return [];
    const now = new Date();

    const ranges = {
      '1W': 7,
      '1M': 30,
      '3M': 90,
      '1Y': 365,
    };

    if (timeframe === 'ALL') return allSnapshots;

    if (timeframe === 'YTD') {
      const jan1 = new Date(now.getFullYear(), 0, 1);
      return allSnapshots.filter(s => new Date(s.taken_at) >= jan1);
    }

    const days = ranges[timeframe];
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return allSnapshots.filter(s => new Date(s.taken_at) >= cutoff);
  }

  // ===== FETCH FUNCTIONS =====
  const fetchTotal = async () => {
    try {
      setLoadingTotal(true);
      const res = await fetch(`${backendUrl}/api/networth/summary`);
      const data = await res.json();

      if (res.ok) {
        setTotalNetWorth(data.totalNetWorthUsd ?? null);
        setTotalAssets(data.totalAssetsUsd ?? 0);
        setTotalLiabilities(data.totalLiabilitiesUsd ?? 0);
        setCryptoTotal(data.totalCryptoUsd ?? 0);
        setTradfiTotal(data.totalTradfiUsd ?? 0);
      } else {
        setError(data.error || 'Failed to fetch net worth summary');
      }
    } catch {
      setError('Network error while fetching net worth summary');
    } finally {
      setLoadingTotal(false);
    }
  };

  const fetchExposure = async () => {
    try {
      setLoadingExposure(true);
      const res = await fetch(`${backendUrl}/api/exposure/summary`);
      const data = await res.json();
      if (res.ok) setExposure(data);
      else setError(data.error || 'Failed to fetch exposure summary');
    } catch {
      setError('Network error while fetching exposure summary');
    } finally {
      setLoadingExposure(false);
    }
  };

  const fetchHoldings = async () => {
    try {
      setLoadingHoldings(true);
      const res = await fetch(`${backendUrl}/api/holdings/list`);
      const data = await res.json();
      if (res.ok) setHoldings(data.holdings || []);
      else setError(data.error || 'Failed to fetch holdings');
    } catch {
      setError('Network error while fetching holdings');
    } finally {
      setLoadingHoldings(false);
    }
  };

  const fetchLiabilities = async () => {
    try {
      setLoadingLiabilities(true);
      const res = await fetch(`${backendUrl}/api/liabilities/list`);
      const data = await res.json();
      if (res.ok) setLiabilities(data.liabilities || []);
      else setError(data.error || 'Failed to fetch liabilities');
    } catch {
      setError('Network error while fetching liabilities');
    } finally {
      setLoadingLiabilities(false);
    }
  };

  const fetchRealEstate = async () => {
    try {
      setLoadingRealEstate(true);
      const res = await fetch(`${backendUrl}/api/realestate/list`);
      const data = await res.json();
      if (res.ok) setRealEstate(data.properties || []);
      else setError(data.error || 'Failed to fetch real estate');
    } catch {
      setError('Network error while fetching real estate');
    } finally {
      setLoadingRealEstate(false);
    }
  };

  const fetchSnapshots = async () => {
    try {
      setLoadingSnapshots(true);
      const res = await fetch(`${backendUrl}/api/snapshots`);
      const data = await res.json();
      if (res.ok) setSnapshots(data.snapshots || []);
      else setError(data.error || 'Failed to fetch snapshots');
    } catch {
      setError('Network error while fetching snapshots');
    } finally {
      setLoadingSnapshots(false);
    }
  };

  // ===== USE EFFECT (INITIAL LOAD) =====
  useEffect(() => {
    fetchTotal();
    fetchExposure();
    fetchHoldings();
    fetchLiabilities();
    fetchRealEstate();
    fetchSnapshots();
  }, []);

  // ===== FORM HANDLERS =====
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: name === 'quantity' || name === 'priceUsd' ? Number(value) : value,
    }));
  };

  const handleLiabilityChange = (e) => {
    const { name, value } = e.target;
    setLiabilityForm(prev => ({
      ...prev,
      [name]:
        name === 'balanceUsd' ||
        name === 'interestRate' ||
        name === 'minPaymentUsd'
          ? Number(value)
          : value,
    }));
  };

  const handleLiabilitySubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`${backendUrl}/api/liabilities/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(liabilityForm),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to save liability');
      } else {
        setMessage('Liability saved!');
        fetchLiabilities();
        fetchTotal();

        await fetch(`${backendUrl}/api/snapshots/write`, { method: "POST" });
        fetchSnapshots();

      }
    } catch {
      setError('Network error while saving liability');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`${backendUrl}/api/holdings/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to save holding');
      } else {
        setMessage('Holding saved!');
        fetchHoldings();
        fetchExposure();
        fetchTotal();
        fetchSnapshots();
        await fetch(`${backendUrl}/api/snapshots/write`, { method: "POST" });

      }
    } catch {
      setError('Network error while saving holding');
    } finally {
      setSaving(false);
    }
  };

  // =============================
  // PLAID FRONTEND LOGIC
  // =============================
  const createLinkToken = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/plaid/create-link-token`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) setLinkToken(data.link_token);
      else setError(data.error || 'Failed to create Plaid link token');
    } catch {
      setError('Network error creating Plaid link token');
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token) => {
      try {
        setMessage('Exchanging public token...');
        const res = await fetch(`${backendUrl}/api/plaid/exchange-public-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token }),
        });

        const data = await res.json();
        if (!res.ok) return setError(data.error || 'Failed to exchange token');

        setPlaidConnectionId(data.connectionId);
        setMessage('Syncing Plaid holdings...');

        setPlaidSyncing(true);
        const syncRes = await fetch(`${backendUrl}/api/plaid/sync-holdings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: data.connectionId }),
        });

        const syncData = await syncRes.json();
        setPlaidSyncing(false);

        if (!syncRes.ok)
          return setError(syncData.error || 'Failed to sync holdings');

        setMessage('Plaid synced successfully!');
        fetchTotal();
        fetchExposure();
        fetchHoldings();
        fetchSnapshots();
      } catch {
        setError('Error handling Plaid success');
      }
    },
  });

  const handlePlaidClick = async () => {
    if (!linkToken) await createLinkToken();
    setTimeout(() => {
      if (ready) open();
      else setError('Plaid Link not ready. Try again.');
    }, 300);
  };

  // =============================
  // SNAPSHOT PROCESSING (CHART)
  // =============================
  const filteredSnapshots = filterSnapshotsByTimeframe(snapshots);

  const sortedSnapshots = [...filteredSnapshots].sort(
    (a, b) => new Date(a.taken_at) - new Date(b.taken_at)
  );

  const latest = sortedSnapshots[sortedSnapshots.length - 1];
  const previous =
    sortedSnapshots.length > 1
      ? sortedSnapshots[sortedSnapshots.length - 2]
      : undefined;

  const latestNetWorth = latest ? latest.total_net_worth_usd : 0;
  const prevNetWorth = previous ? previous.total_net_worth_usd : 0;
  const delta = latestNetWorth - prevNetWorth;
  const deltaPct =
    prevNetWorth > 0 ? (delta / prevNetWorth) * 100 : undefined;

  const hasSnapshotData = sortedSnapshots.length > 0;

  const netWorthLineData = {
    labels: sortedSnapshots.map(s =>
      new Date(s.taken_at).toLocaleString()
    ),
    datasets: [
      {
        label: 'Total Net Worth (USD)',
        data: sortedSnapshots.map(s => Number(s.total_net_worth_usd)),
        fill: true,
        tension: 0.25,
        pointRadius: 2,
      },
    ],
  };

  const netWorthLineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false } },
      y: {
        ticks: {
          callback: (value) => {
            const n = Number(value);
            if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
            if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'k';
            return '$' + n.toFixed(0);
          },
        },
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx =>
            'Net worth: $' +
            ctx.parsed.y.toLocaleString(undefined, {
              maximumFractionDigits: 0,
            }),
        },
      },
    },
  };

  const cryptoExposurePct =
    exposure && exposure.totalNetWorthUsd
      ? (exposure.totalCryptoExposureUsd / exposure.totalNetWorthUsd) * 100
      : 0;

  const tradfiExposurePct =
    exposure && exposure.totalNetWorthUsd
      ? (exposure.totalTradfiExposureUsd / exposure.totalNetWorthUsd) * 100
      : 0;

  const cryptoBreakdown = exposure?.cryptoBreakdown || {};

  // =============================
  // RENDER
  // =============================
  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '24px',
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      <h1>Net Worth Tracker (MVP)</h1>

      {/* TOTAL NET WORTH */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Total Net Worth</h2>
        {loadingTotal ? (
          <p>Loading...</p>
        ) : totalNetWorth !== null ? (
          <>
            <p style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>
              ${totalNetWorth.toLocaleString()}
            </p>
            <p style={{ margin: 0, fontSize: 14, color: '#555' }}>
              <strong>Assets:</strong> ${totalAssets.toLocaleString()}
            </p>
            <p style={{ margin: 0, fontSize: 14, color: '#555' }}>
              <strong>Liabilities:</strong> ${totalLiabilities.toLocaleString()}
            </p>
          </>
        ) : (
          <p>No data yet.</p>
        )}
      </section>

      {/* NET WORTH OVER TIME */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Net Worth Over Time</h2>

        {/* TIMEFRAME BUTTONS */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
          {['1W', '1M', '3M', '1Y', 'YTD', 'ALL'].map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              style={{
                padding: '6px 10px',
                background: timeframe === tf ? '#2563eb' : '#eee',
                color: timeframe === tf ? 'white' : 'black',
                border: '1px solid #ccc',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {tf}
            </button>
          ))}
        </div>

        {loadingSnapshots ? (
          <p>Loading history...</p>
        ) : !hasSnapshotData ? (
          <p style={{ fontSize: 14, color: '#555' }}>
            No history yet. Run a wallet refresh or Plaid sync to create
            snapshots.
          </p>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  Latest snapshot net worth
                </div>
                <div style={{ fontSize: 20, fontWeight: 'bold' }}>
                  ${latestNetWorth.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </div>
              </div>

              {previous && (
                <div style={{ textAlign: 'right', fontSize: 12 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      color: delta >= 0 ? '#16a34a' : '#dc2626',
                    }}
                  >
                    {delta >= 0 ? '+' : ''}
                    ${delta.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </div>

                  {deltaPct !== undefined && (
                    <div
                      style={{
                        color: delta >= 0 ? '#16a34a' : '#dc2626',
                      }}
                    >
                      {delta >= 0 ? '+' : ''}
                      {deltaPct.toFixed(2)}% vs previous snapshot
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ height: 220 }}>
              <Line data={netWorthLineData} options={netWorthLineOptions} />
            </div>
          </>
        )}
      </section>

      {/* EXPOSURE SNAPSHOT */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '24px',
        }}
      >
        <div style={{ flex: '1 1 260px' }}>
          <h2>Exposure Snapshot</h2>
          {loadingExposure && <p>Loading exposure...</p>}

          {!loadingExposure && exposure && (
            <>
              <p>
                <strong>Crypto exposure:</strong>{' '}
                ${exposure.totalCryptoExposureUsd.toLocaleString()} (
                {cryptoExposurePct.toFixed(1)}%)
              </p>
              <p>
                <strong>TradFi / other exposure:</strong>{' '}
                ${exposure.totalTradfiExposureUsd.toLocaleString()} (
                {tradfiExposurePct.toFixed(1)}%)
              </p>
            </>
          )}
        </div>

        <div style={{ flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0 }}>Crypto Breakdown</h3>
          {cryptoBreakdown && exposure ? (
            <ul style={{ paddingLeft: 16, fontSize: 14 }}>
              <li>
                <strong>On-chain spot:</strong>{' '}
                ${cryptoBreakdown.spotOnChainUsd.toLocaleString()}
              </li>
              <li>
                <strong>Custodial spot:</strong>{' '}
                ${cryptoBreakdown.spotCustodialUsd.toLocaleString()}
              </li>
              <li>
                <strong>Stablecoins:</strong>{' '}
                ${cryptoBreakdown.stablecoinUsd.toLocaleString()}
              </li>
              <li>
                <strong>Crypto ETFs:</strong>{' '}
                ${cryptoBreakdown.cryptoEtfUsd.toLocaleString()}
              </li>
              <li>
                <strong>Crypto equities:</strong>{' '}
                ${cryptoBreakdown.cryptoEquityUsd.toLocaleString()}
              </li>
            </ul>
          ) : (
            <p>No crypto breakdown yet.</p>
          )}
        </div>
      </section>

      {/* CRYPTO VS TRADFI PIE */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '24px',
        }}
      >
        <div style={{ flex: '0 0 280px' }}>
          <h2>Crypto vs TradFi (Net Worth)</h2>

          {cryptoTotal + tradfiTotal > 0 ? (
            <Pie
              data={{
                labels: ['Crypto', 'TradFi'],
                datasets: [
                  {
                    data: [cryptoTotal, tradfiTotal],
                    backgroundColor: ['#4f46e5', '#f97316'],
                  },
                ],
              }}
              options={{
                plugins: {
                  legend: { position: 'bottom' },
                  tooltip: {
                    callbacks: {
                      label: ctx => {
                        const label = ctx.label;
                        const value = ctx.raw;
                        const total = cryptoTotal + tradfiTotal || 1;
                        const pct = ((value / total) * 100).toFixed(1);
                        return `${label}: $${value.toLocaleString()} (${pct}%)`;
                      },
                    },
                  },
                },
              }}
            />
          ) : (
            <p>Add holdings to see your mix.</p>
          )}
        </div>

        <div style={{ flex: '1 1 200px', fontSize: 14 }}>
          <p>
            <strong>Crypto:</strong> ${cryptoTotal.toLocaleString()}
          </p>
          <p>
            <strong>TradFi:</strong> ${tradfiTotal.toLocaleString()}
          </p>
        </div>
      </section>

      {/* PLAID CONNECT */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Connect Investment Account (Plaid Sandbox)</h2>
        <button onClick={handlePlaidClick} disabled={plaidSyncing}>
          {plaidSyncing ? 'Syncing...' : 'Connect via Plaid Sandbox'}
        </button>
      </section>

      {/* MANUAL HOLDINGS */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Add Manual Holding</h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 8 }}>
            <input
              name="connectionName"
              value={form.connectionName}
              onChange={handleChange}
              placeholder="Connection Name"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <input
              name="accountName"
              value={form.accountName}
              onChange={handleChange}
              placeholder="Account Name"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <input
              name="symbol"
              value={form.symbol}
              onChange={handleChange}
              placeholder="Symbol"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <input
              type="number"
              name="quantity"
              value={form.quantity}
              onChange={handleChange}
              step="0.0001"
              placeholder="Quantity"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <input
              type="number"
              name="priceUsd"
              value={form.priceUsd}
              onChange={handleChange}
              step="0.01"
              placeholder="Price (USD)"
            />
          </div>
          <div style={{ marginBottom: 8 }}>
  <label>
    Effective Date:{' '}
    <input
      type="date"
      name="effectiveDate"
      value={form.effectiveDate}
      onChange={handleChange}
    />
  </label>
</div>



          <div style={{ marginBottom: 8 }}>
            <select
              name="assetClass"
              value={form.assetClass}
              onChange={handleChange}
            >
              <option value="crypto">Crypto</option>
              <option value="equity">Equity</option>
              <option value="cash">Cash</option>
              <option value="fixed_income">Fixed Income</option>
            </select>
          </div>

          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Holding'}
          </button>
        </form>
      </section>

      {/* LIABILITIES */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Liabilities</h2>

        <form onSubmit={handleLiabilitySubmit} style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <input
              name="name"
              value={liabilityForm.name}
              onChange={handleLiabilityChange}
              placeholder="Name"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <select
              name="type"
              value={liabilityForm.type}
              onChange={handleLiabilityChange}
            >
              <option value="mortgage">Mortgage</option>
              <option value="credit_card">Credit Card</option>
              <option value="student_loan">Student Loan</option>
              <option value="auto_loan">Auto Loan</option>
              <option value="business_loan">Business Loan</option>
              <option value="tax">Tax</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <input
              type="number"
              name="balanceUsd"
              value={liabilityForm.balanceUsd}
              onChange={handleLiabilityChange}
              step="0.01"
              placeholder="Balance"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <input
              type="number"
              name="interestRate"
              value={liabilityForm.interestRate}
              onChange={handleLiabilityChange}
              step="0.0001"
              placeholder="Interest Rate"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <input
              type="number"
              name="minPaymentUsd"
              value={liabilityForm.minPaymentUsd}
              onChange={handleLiabilityChange}
              step="0.01"
              placeholder="Minimum Payment"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <input
              name="notes"
              value={liabilityForm.notes}
              onChange={handleLiabilityChange}
              placeholder="Notes"
            />
          </div>

          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Liability'}
          </button>
        </form>

        {loadingLiabilities ? (
          <p>Loading liabilities...</p>
        ) : liabilities.length === 0 ? (
          <p>No liabilities yet.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 14 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th style={{ textAlign: 'right' }}>Interest</th>
                <th style={{ textAlign: 'right' }}>Min Payment</th>
              </tr>
            </thead>
            <tbody>
              {liabilities.map(l => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>{l.type}</td>
                  <td style={{ textAlign: 'right' }}>
                    ${Number(l.balance_usd).toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {l.interest_rate ?? '-'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {l.min_payment_usd
                      ? `$${Number(l.min_payment_usd).toLocaleString()}`
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* REAL ESTATE */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Real Estate</h2>

        {loadingRealEstate ? (
          <p>Loading properties...</p>
        ) : realEstate.length === 0 ? (
          <p>No real estate properties.</p>
        ) : (
          realEstate.map(p => (
            <div
              key={p.id}
              style={{
                marginBottom: 12,
                borderBottom: '1px solid #eee',
                paddingBottom: 12,
              }}
            >
              <strong>{p.name}</strong>
              <br />
              {p.city}, {p.state}
              <br />
              Value: ${Number(p.current_value_usd).toLocaleString()}
            </div>
          ))
        )}

        {realEstate.length > 0 && (
          <p style={{ marginTop: 16, fontWeight: 'bold' }}>
            Total Real Estate:{' '}
            ${realEstate
              .reduce((sum, p) => sum + Number(p.current_value_usd), 0)
              .toLocaleString()}
          </p>
        )}
      </section>

      {/* HOLDINGS TABLE */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Holdings</h2>
        {loadingHoldings ? (
          <p>Loading holdings...</p>
        ) : holdings.length === 0 ? (
          <p>No holdings yet.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 14 }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th style={{ textAlign: 'right' }}>Quantity</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th>Class</th>
                <th>Account</th>
                <th>Provider</th>
              </tr>
            </thead>

            <tbody>
              {holdings.map(h => (
                <tr key={h.id}>
                  <td>{h.symbol}</td>
                  <td style={{ textAlign: 'right' }}>
                    {Number(h.quantity).toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    ${Number(h.price_usd).toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    ${Number(h.value_usd).toLocaleString()}
                  </td>
                  <td>{h.asset_class}</td>
                  <td>{h.accounts?.name}</td>
                  <td>{h.accounts?.connections?.provider}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* MESSAGES */}
      {message && <p style={{ color: 'green' }}>{message}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}

export default App;
