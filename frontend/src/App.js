import React, { useState, useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

function App() {
  const [totalNetWorth, setTotalNetWorth] = useState(null);
  const [loadingTotal, setLoadingTotal] = useState(false);

  const [cryptoTotal, setCryptoTotal] = useState(0);
  const [tradfiTotal, setTradfiTotal] = useState(0);

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

  const [holdings, setHoldings] = useState([]);
  const [loadingHoldings, setLoadingHoldings] = useState(false);

  const backendUrl = 'http://localhost:4000';

  // ===== FETCH NET WORTH SUMMARY FROM BACKEND =====
  const fetchTotal = async () => {
    try {
      setLoadingTotal(true);
      setError('');
      const res = await fetch(`${backendUrl}/api/networth/summary`);
      const data = await res.json();

      if (res.ok) {
        setTotalNetWorth(data.totalNetWorthUsd ?? null);
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

  // ===== FETCH HOLDINGS LIST =====
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

  useEffect(() => {
    fetchTotal();
    fetchHoldings();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]:
        name === 'quantity' || name === 'priceUsd' ? Number(value) : value,
    }));
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
        fetchHoldings();
      }
    } catch (e) {
      setError('Network error while saving holding');
    } finally {
      setSaving(false);
    }
  };

  // ===== DELETE HOLDING (MAINLY MANUAL) =====
  const handleDeleteHolding = async (id) => {
    const confirmed = window.confirm('Delete this holding?');
    if (!confirmed) return;

    try {
      setError('');
      const res = await fetch(`${backendUrl}/api/holdings/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to delete holding');
        return;
      }

      setMessage('Holding deleted');
      fetchTotal();
      fetchHoldings();
    } catch (e) {
      setError('Network error while deleting holding');
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
        fetchHoldings();
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

  // ===== CRYPTO VS TRADFI CHART DATA =====
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
            return `${label}: $${value.toLocaleString()} (${pct}%)`;
          },
        },
      },
    },
  };

  // ===== LAST UPDATED TIMESTAMP (BASED ON HOLDINGS.as_of) =====
  const lastUpdatedTimestamp = holdings.reduce((latest, h) => {
    if (!h.as_of) return latest;
    const t = new Date(h.as_of).getTime();
    return t > latest ? t : latest;
  }, 0);

  const lastUpdatedLabel =
    lastUpdatedTimestamp > 0
      ? new Date(lastUpdatedTimestamp).toLocaleString()
      : null;

  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '24px',
        maxWidth: 1000,
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
            <p style={{ fontSize: 14, color: '#555' }}>
              <strong>Crypto:</strong> ${cryptoTotal.toLocaleString()} &nbsp;·&nbsp;
              <strong>TradFi:</strong> ${tradfiTotal.toLocaleString()}
            </p>
            {lastUpdatedLabel && (
              <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                Last updated: {lastUpdatedLabel}
              </p>
            )}
          </>
        ) : (
          <p>No data yet.</p>
        )}
      </section>

      {/* CRYPTO VS TRADFI PIE CHART */}
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
          <h2>Crypto vs TradFi</h2>
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
              {((cryptoTotal / (cryptoTotal + tradfiTotal || 1)) * 100).toFixed(
                1
              )}
              %
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
                  <th
                    style={{
                      borderBottom: '1px solid #ccc',
                      textAlign: 'left',
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const provider = h.accounts?.connections?.provider || '';
                  const nickname =
                    h.accounts?.connections?.nickname || '';
                  const isManual = provider === 'manual';

                  return (
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
                        {provider}
                        {nickname ? ` (${nickname})` : ''}
                      </td>
                      <td style={{ borderBottom: '1px solid #eee' }}>
                        {isManual && (
                          <button
                            style={{ fontSize: 12 }}
                            onClick={() => handleDeleteHolding(h.id)}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MESSAGES & ERRORS */}
      {message && (
        <p style={{ color: 'green', marginTop: 12 }}>{message}</p>
      )}
      {error && (
        <p style={{ color: 'red', marginTop: 12 }}>{error}</p>
      )}
    </div>
  );
}

export default App;
