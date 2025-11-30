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
  const [totalNetWorth, setTotalNetWorth] = useState(null);
  const [loadingTotal, setLoadingTotal] = useState(false);

  const [cryptoTotal, setCryptoTotal] = useState(0);
  const [tradfiTotal, setTradfiTotal] = useState(0);

  const [totalAssets, setTotalAssets] = useState(0);
  const [totalLiabilities, setTotalLiabilities] = useState(0);

  const [liabilities, setLiabilities] = useState([]);
  const [loadingLiabilities, setLoadingLiabilities] = useState(false);

  const [liabilityForm, setLiabilityForm] = useState({
    name: 'Mortgage',
    type: 'mortgage',
    balanceUsd: 300000,
    interestRate: 0.05,
    minPaymentUsd: 2500,
    notes: '',
  });


  const [exposure, setExposure] = useState(null);
  const [loadingExposure, setLoadingExposure] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({
    connectionName: 'Manual Portfolio',
    accountName: 'Test Account',
    symbol: 'BTC',
    quantity: 1.25,
    priceUsd: 50000,
    assetClass: 'crypto',
  });

  const [linkToken, setLinkToken] = useState(null);
  const [plaidConnectionId, setPlaidConnectionId] = useState(null);
  const [plaidSyncing, setPlaidSyncing] = useState(false);

  const [realEstate, setRealEstate] = useState([]);
const [loadingRealEstate, setLoadingRealEstate] = useState(false);


  const [holdings, setHoldings] = useState([]);
  const [loadingHoldings, setLoadingHoldings] = useState(false);

  // NEW: snapshots state (for net worth over time)
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);

  const backendUrl = 'http://localhost:4000';

  // ====== FETCH NET WORTH SUMMARY ======
  const fetchTotal = async () => {
    try {
      setLoadingTotal(true);
      setError('');
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
    } catch (e) {
      setError('Network error while fetching net worth summary');
    } finally {
      setLoadingTotal(false);
    }
  };


  // ====== FETCH EXPOSURE SUMMARY ======
  const fetchExposure = async () => {
    try {
      setLoadingExposure(true);
      setError('');
      const res = await fetch(`${backendUrl}/api/exposure/summary`);
      const data = await res.json();

      if (res.ok) {
        setExposure(data);
      } else {
        setError(data.error || 'Failed to fetch exposure summary');
      }
    } catch (e) {
      setError('Network error while fetching exposure summary');
    } finally {
      setLoadingExposure(false);
    }
  };

  // ====== FETCH HOLDINGS LIST ======
  const fetchHoldings = async () => {
    try {
      setLoadingHoldings(true);
      setError('');
      const res = await fetch(`${backendUrl}/api/holdings/list`);
      const data = await res.json();
      if (res.ok) {
        setHoldings(data.holdings || []);
      } else {
        setError(data.error || 'Failed to fetch holdings');
      }
    } catch (e) {
      setError('Network error while fetching holdings');
    } finally {
      setLoadingHoldings(false);
    }
  };

  const fetchLiabilities = async () => {
    try {
      setLoadingLiabilities(true);
      setError('');
      const res = await fetch(`${backendUrl}/api/liabilities/list`);
      const data = await res.json();
      if (res.ok) {
        setLiabilities(data.liabilities || []);
      } else {
        setError(data.error || 'Failed to fetch liabilities');
      }
    } catch (e) {
      setError('Network error while fetching liabilities');
    } finally {
      setLoadingLiabilities(false);
    }
  };

  // ====== FETCH REAL ESTATE LIST ======
const fetchRealEstate = async () => {
  try {
    setLoadingRealEstate(true);
    setError('');
    const res = await fetch(`${backendUrl}/api/realestate/list`);
    const data = await res.json();

    if (res.ok) {
      setRealEstate(data.properties || []);
    } else {
      setError(data.error || 'Failed to fetch real estate');
    }
  } catch (e) {
    setError('Network error while fetching real estate');
  } finally {
    setLoadingRealEstate(false);
  }
};


  // ====== FETCH SNAPSHOTS (NET WORTH OVER TIME) ======
  const fetchSnapshots = async () => {
    try {
      setLoadingSnapshots(true);
      setError('');
      const res = await fetch(`${backendUrl}/api/snapshots`);
      const data = await res.json();
      if (res.ok) {
        setSnapshots(data.snapshots || []);
      } else {
        setError(data.error || 'Failed to fetch snapshots');
      }
    } catch (e) {
      setError('Network error while fetching snapshots');
    } finally {
      setLoadingSnapshots(false);
    }
  };

  useEffect(() => {
    fetchTotal();
    fetchExposure();
    fetchHoldings();
    fetchLiabilities();
    fetchRealEstate();     // <-- ADD THIS LINE
  }, []);
  


  // ====== FORM HANDLERS ======
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]:
        name === 'quantity' || name === 'priceUsd' ? Number(value) : value,
    }));
  };

  const handleLiabilityChange = (e) => {
    const { name, value } = e.target;
    setLiabilityForm((prev) => ({
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
        fetchTotal();        // updates net worth (assets – liabilities)
        fetchLiabilities();  // refresh list
      }
    } catch (e) {
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
        fetchTotal();
        fetchExposure();
        fetchHoldings();
        fetchSnapshots(); // update history when holdings change
      }
    } catch (e) {
      setError('Network error while saving holding');
    } finally {
      setSaving(false);
    }
  };

  // ===== PLAID FRONTEND LOGIC =====
  const createLinkToken = async () => {
    try {
      setError('');
      const res = await fetch(`${backendUrl}/api/plaid/create-link-token`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.link_token) {
        setLinkToken(data.link_token);
      } else {
        setError(data.error || 'Failed to create Plaid link token');
      }
    } catch (e) {
      setError('Network error creating Plaid link token');
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      try {
        setError('');
        setMessage('Plaid public token received, exchanging...');

        const res = await fetch(
          `${backendUrl}/api/plaid/exchange-public-token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token }),
          }
        );
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Failed to exchange public token');
          return;
        }

        const connectionId = data.connectionId;
        setPlaidConnectionId(connectionId);
        setMessage('Plaid connection saved. Syncing holdings...');

        setPlaidSyncing(true);
        const syncRes = await fetch(`${backendUrl}/api/plaid/sync-holdings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId }),
        });
        const syncData = await syncRes.json();
        setPlaidSyncing(false);

        if (!syncRes.ok) {
          setError(syncData.error || 'Failed to sync Plaid holdings');
          return;
        }

        setMessage('Plaid holdings synced!');
        fetchTotal();
        fetchExposure();
        fetchHoldings();
        fetchSnapshots(); // update history after Plaid sync
      } catch (e) {
        setError('Error handling Plaid success');
      }
    },
    onExit: (err, metadata) => {
      if (err) {
        setError('User exited Plaid Link or an error occurred.');
      }
    },
  });

  const handlePlaidClick = async () => {
    if (!linkToken) {
      await createLinkToken();
    }
    setTimeout(() => {
      if (ready) {
        open();
      } else {
        setError('Plaid Link not ready yet. Try again.');
      }
    }, 300);
  };

  // ===== CRYPTO VS TRADFI PIE (NET WORTH) =====
  const hasChartData = cryptoTotal + tradfiTotal > 0;

  const pieData = {
    labels: ['Crypto', 'TradFi'],
    datasets: [
      {
        data: [cryptoTotal, tradfiTotal],
        backgroundColor: ['#4f46e5', '#f97316'],
        hoverBackgroundColor: ['#4338ca', '#ea580c'],
      },
    ],
  };

  const pieOptions = {
    plugins: {
      legend: {
        position: 'bottom',
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const label = context.label || '';
            const value = context.raw || 0;
            const total = cryptoTotal + tradfiTotal || 1;
            const pct = ((value / total) * 100).toFixed(1);
            return `${label}: $${Number(value).toLocaleString()} (${pct}%)`;
          },
        },
      },
    },
  };

  // ===== Helper for exposure summary =====
  const cryptoExposurePct =
    exposure && exposure.totalNetWorthUsd
      ? (exposure.totalCryptoExposureUsd / exposure.totalNetWorthUsd) * 100
      : 0;

  const tradfiExposurePct =
    exposure && exposure.totalNetWorthUsd
      ? (exposure.totalTradfiExposureUsd / exposure.totalNetWorthUsd) * 100
      : 0;

  const cryptoBreakdown = exposure?.cryptoBreakdown || {};

  // ===== NET WORTH OVER TIME (LINE CHART) =====
  const hasSnapshotData = snapshots.length > 0;

  const sortedSnapshots = [...snapshots].sort(
    (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime()
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

  const netWorthLineData = {
    labels: sortedSnapshots.map((s) =>
      new Date(s.taken_at).toLocaleString()
    ),
    datasets: [
      {
        label: 'Total Net Worth (USD)',
        data: sortedSnapshots.map((s) => s.total_net_worth_usd),
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
      x: {
        grid: { display: false },
      },
      y: {
        ticks: {
          callback: (value) => {
            const n = Number(value);
            if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
            if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'k';
            return '$' + n.toFixed(0);
          },
        },
        grid: {
          color: 'rgba(0,0,0,0.05)',
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y;
            return (
              'Net worth: $' +
              val.toLocaleString(undefined, { maximumFractionDigits: 0 })
            );
          },
        },
      },
    },
  };

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
      Hello

      {/* NET WORTH OVER TIME (LINE CHART) */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Net Worth Over Time</h2>
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
                    $
                    {delta.toLocaleString(undefined, {
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
              <p style={{ margin: 0 }}>
                <strong>Crypto exposure:</strong>{' '}
                ${exposure.totalCryptoExposureUsd.toLocaleString()} (
                {cryptoExposurePct.toFixed(1)}%)
              </p>
              <p style={{ margin: '4px 0 0' }}>
                <strong>TradFi / other exposure:</strong>{' '}
                ${exposure.totalTradfiExposureUsd.toLocaleString()} (
                {tradfiExposurePct.toFixed(1)}%)
              </p>
              <p style={{ marginTop: 8, fontSize: 13, color: '#555' }}>
                Based on classification by bucket (crypto vs equity vs cash vs
                commodities vs real estate, etc.).
              </p>
            </>
          )}
          {!loadingExposure && !exposure && (
            <p>No exposure data yet. Add holdings or connect accounts.</p>
          )}
        </div>

        <div style={{ flex: '1 1 260px', fontSize: 13 }}>
          <h3 style={{ marginTop: 0 }}>Crypto Breakdown</h3>
          {cryptoBreakdown && exposure ? (
            <ul style={{ paddingLeft: 16, margin: 0 }}>
              <li>
                <strong>On-chain spot:</strong>{' '}
                ${Number(cryptoBreakdown.spotOnChainUsd || 0).toLocaleString()}
              </li>
              <li>
                <strong>Custodial spot:</strong>{' '}
                ${Number(cryptoBreakdown.spotCustodialUsd || 0).toLocaleString()}
              </li>
              <li>
                <strong>Stablecoins:</strong>{' '}
                ${Number(cryptoBreakdown.stablecoinUsd || 0).toLocaleString()}
              </li>
              <li>
                <strong>Crypto ETFs:</strong>{' '}
                ${Number(cryptoBreakdown.cryptoEtfUsd || 0).toLocaleString()}
              </li>
              <li>
                <strong>Crypto equities:</strong>{' '}
                ${Number(cryptoBreakdown.cryptoEquityUsd || 0).toLocaleString()}
              </li>
            </ul>
          ) : (
            <p>No crypto breakdown yet.</p>
          )}
        </div>
      </section>

      {/* CRYPTO VS TRADFI PIE CHART (NET WORTH) */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
          display: 'flex',
          gap: '24px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '0 0 280px' }}>
          <h2>Crypto vs TradFi (Net Worth)</h2>
          {!hasChartData ? (
            <p style={{ fontSize: 14, color: '#555' }}>
              Add some holdings or connect Plaid to see your risk breakdown.
            </p>
          ) : (
            <Pie data={pieData} options={pieOptions} />
          )}
        </div>
        <div style={{ flex: '1 1 200px', fontSize: 14 }}>
          <p>
            <strong>Crypto:</strong> ${cryptoTotal.toLocaleString()}
          </p>
          <p>
            <strong>TradFi (cash / equity / fixed income):</strong>{' '}
            ${tradfiTotal.toLocaleString()}
          </p>
          {hasChartData && (
            <p style={{ marginTop: 8 }}>
              Crypto share:{' '}
              {((cryptoTotal / (cryptoTotal + tradfiTotal)) * 100).toFixed(1)}%
            </p>
          )}
        </div>
      </section>

      {/* PLAID CONNECT SECTION */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Connect Investment Account (Plaid Sandbox)</h2>
        <p style={{ fontSize: 14, color: '#555' }}>
          This uses Plaid&apos;s sandbox environment. You&apos;ll see a fake
          bank flow and fake holdings, but the data really flows through your
          backend and into Supabase.
        </p>
        <button onClick={handlePlaidClick} disabled={plaidSyncing}>
          {plaidSyncing ? 'Syncing holdings...' : 'Connect via Plaid Sandbox'}
        </button>
      </section>

      {/* MANUAL HOLDING SECTION */}
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
            <label>
              Connection Name:{' '}
              <input
                name="connectionName"
                value={form.connectionName}
                onChange={handleChange}
              />
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Account Name:{' '}
              <input
                name="accountName"
                value={form.accountName}
                onChange={handleChange}
              />
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Symbol:{' '}
              <input
                name="symbol"
                value={form.symbol}
                onChange={handleChange}
              />
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Quantity:{' '}
              <input
                type="number"
                name="quantity"
                value={form.quantity}
                onChange={handleChange}
                step="0.0001"
              />
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Price (USD):{' '}
              <input
                type="number"
                name="priceUsd"
                value={form.priceUsd}
                onChange={handleChange}
                step="0.01"
              />
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Asset Class:{' '}
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
            </label>
          </div>

          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Holding'}
          </button>
        </form>
      </section>

      {/* LIABILITIES SECTION */}
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2>Liabilities</h2>

        {/* Add Liability Form */}
        <form onSubmit={handleLiabilitySubmit} style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <label>
              Name:{' '}
              <input
                name="name"
                value={liabilityForm.name}
                onChange={handleLiabilityChange}
              />
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Type:{' '}
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
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Balance (USD):{' '}
              <input
                type="number"
                name="balanceUsd"
                value={liabilityForm.balanceUsd}
                onChange={handleLiabilityChange}
                step="0.01"
              />
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Interest Rate:{' '}
              <input
                type="number"
                name="interestRate"
                value={liabilityForm.interestRate}
                onChange={handleLiabilityChange}
                step="0.0001"
              />{' '}
              <span style={{ fontSize: 12, color: '#555' }}>
                (e.g. 0.055 for 5.5%)
              </span>
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Min Payment (USD):{' '}
              <input
                type="number"
                name="minPaymentUsd"
                value={liabilityForm.minPaymentUsd}
                onChange={handleLiabilityChange}
                step="0.01"
              />
            </label>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>
              Notes:{' '}
              <input
                name="notes"
                value={liabilityForm.notes}
                onChange={handleLiabilityChange}
              />
            </label>
          </div>

          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Liability'}
          </button>
        </form>

        {/* Liabilities Table */}
        {loadingLiabilities ? (
          <p>Loading liabilities...</p>
        ) : liabilities.length === 0 ? (
          <p>No liabilities yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'left',
                    }}
                  >
                    Name
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'left',
                    }}
                  >
                    Type
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'right',
                    }}
                  >
                    Balance (USD)
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'right',
                    }}
                  >
                    Interest
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'right',
                    }}
                  >
                    Min Payment
                  </th>
                </tr>
              </thead>
              <tbody>
                {liabilities.map((l) => (
                  <tr key={l.id}>
                    <td style={{ borderBottom: '1px solid #eee' }}>
                      {l.name}
                    </td>
                    <td style={{ borderBottom: '1px solid #eee' }}>
                      {l.type}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid #eee',
                        textAlign: 'right',
                      }}
                    >
                      ${Number(l.balance_usd).toLocaleString()}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid #eee',
                        textAlign: 'right',
                      }}
                    >
                      {l.interest_rate != null ? l.interest_rate : '-'}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid #eee',
                        textAlign: 'right',
                      }}
                    >
                      {l.min_payment_usd != null
                        ? `$${Number(l.min_payment_usd).toLocaleString()}`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>


{/* REAL ESTATE SECTION */}
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
    <p>No real estate added yet.</p>
  ) : (
    <div style={{ fontSize: 14 }}>
      {realEstate.map((p) => (
        <div
          key={p.id}
          style={{
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: '1px solid #eee',
          }}
        >
          <strong>{p.name}</strong>
          <br />
          {p.city}, {p.state}
          <br />
          <span>
            <strong>Value:</strong>{' '}
            ${Number(p.current_value_usd).toLocaleString()}
          </span>
        </div>
      ))}

      <p style={{ marginTop: 16, fontWeight: 'bold' }}>
        Total Real Estate Value:{' '}
        ${realEstate
          .reduce(
            (sum, p) => sum + Number(p.current_value_usd || 0),
            0
          )
          .toLocaleString()}
      </p>
    </div>
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
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'left',
                    }}
                  >
                    Symbol
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'right',
                    }}
                  >
                    Quantity
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'right',
                    }}
                  >
                    Price (USD)
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'right',
                    }}
                  >
                    Value (USD)
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'left',
                    }}
                  >
                    Class
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'left',
                    }}
                  >
                    Account
                  </th>
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'left',
                    }}
                  >
                    Provider
                  </th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.id}>
                    <td style={{ borderBottom: '1px solid #eee' }}>
                      {h.symbol}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid #eee',
                        textAlign: 'right',
                      }}
                    >
                      {Number(h.quantity).toLocaleString()}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid #eee',
                        textAlign: 'right',
                      }}
                    >
                      ${Number(h.price_usd).toLocaleString()}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid #eee',
                        textAlign: 'right',
                      }}
                    >
                      ${Number(h.value_usd).toLocaleString()}
                    </td>
                    <td style={{ borderBottom: '1px solid #eee' }}>
                      {h.asset_class}
                    </td>
                    <td style={{ borderBottom: '1px solid #eee' }}>
                      {h.accounts?.name || ''}
                    </td>
                    <td style={{ borderBottom: '1px solid #eee' }}>
                      {h.accounts?.connections?.provider || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MESSAGES & ERRORS */}
      {message && (
        <p style={{ color: 'green', marginTop: 12 }}>{message}</p>
      )}
      {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
    </div>
  );
}

export default App;
