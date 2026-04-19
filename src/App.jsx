import { useState, useEffect, useCallback } from "react";

const BOT_API = import.meta.env?.VITE_BOT_API || "http://localhost:3001";
const GAMMA = BOT_API;

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body, #root {
    background: #0a0c0f;
    color: #c8cdd4;
    font-family: 'IBM Plex Sans', sans-serif;
    min-height: 100vh;
  }

  .app {
    display: grid;
    grid-template-rows: 56px 1fr;
    min-height: 100vh;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    border-bottom: 1px solid #1e2530;
    background: #0d1017;
  }

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .logo-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #22c55e;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .logo-text {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 15px;
    font-weight: 500;
    color: #e2e8f0;
    letter-spacing: 0.05em;
  }

  .badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid;
  }

  .badge-paper {
    color: #f59e0b;
    border-color: #f59e0b40;
    background: #f59e0b10;
  }

  .badge-live {
    color: #22c55e;
    border-color: #22c55e40;
    background: #22c55e10;
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .stat-inline {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: #64748b;
  }

  .stat-inline span {
    color: #94a3b8;
    margin-left: 4px;
  }

  .refresh-btn {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    padding: 4px 12px;
    background: transparent;
    border: 1px solid #1e2530;
    border-radius: 4px;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s;
  }

  .refresh-btn:hover { border-color: #334155; color: #94a3b8; }

  .main {
    display: grid;
    grid-template-columns: 260px 1fr 300px;
    gap: 0;
    overflow: hidden;
    height: calc(100vh - 56px);
  }

  @media (max-width: 1100px) {
    .main { grid-template-columns: 1fr 280px; }
    .sidebar-left { display: none; }
  }

  @media (max-width: 720px) {
    .main { grid-template-columns: 1fr; }
    .sidebar-right { display: none; }
  }

  .panel {
    border-right: 1px solid #1e2530;
    overflow-y: auto;
    padding: 20px;
  }

  .panel:last-child { border-right: none; }

  .panel-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 16px;
  }

  .metric-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 20px;
  }

  .metric-card {
    background: #111520;
    border: 1px solid #1e2530;
    border-radius: 6px;
    padding: 12px;
  }

  .metric-label {
    font-size: 11px;
    color: #475569;
    margin-bottom: 4px;
  }

  .metric-value {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 18px;
    font-weight: 500;
    color: #e2e8f0;
  }

  .metric-value.green { color: #22c55e; }
  .metric-value.amber { color: #f59e0b; }
  .metric-value.red { color: #ef4444; }

  .trade-list { display: flex; flex-direction: column; gap: 6px; }

  .trade-item {
    background: #111520;
    border: 1px solid #1e2530;
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 12px;
  }

  .trade-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .trade-side {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: 3px;
  }

  .trade-side.yes { background: #22c55e20; color: #22c55e; }
  .trade-side.no { background: #ef444420; color: #ef4444; }

  .trade-size {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: #94a3b8;
  }

  .trade-market {
    color: #64748b;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .trade-reason {
    color: #475569;
    font-size: 10px;
    margin-top: 3px;
    font-style: italic;
  }

  .markets-panel {
    padding: 20px;
    overflow-y: auto;
    height: 100%;
  }

  .markets-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .search-input {
    flex: 1;
    min-width: 160px;
    background: #111520;
    border: 1px solid #1e2530;
    border-radius: 6px;
    padding: 7px 12px;
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 13px;
    color: #c8cdd4;
    outline: none;
    transition: border-color 0.15s;
  }

  .search-input:focus { border-color: #334155; }
  .search-input::placeholder { color: #334155; }

  .filter-btn {
    font-size: 12px;
    padding: 6px 12px;
    background: transparent;
    border: 1px solid #1e2530;
    border-radius: 6px;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .filter-btn:hover, .filter-btn.active {
    border-color: #3b82f6;
    color: #3b82f6;
    background: #3b82f610;
  }

  .markets-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 10px;
  }

  .market-card {
    background: #111520;
    border: 1px solid #1e2530;
    border-radius: 8px;
    padding: 14px;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .market-card:hover { border-color: #334155; }

  .market-question {
    font-size: 13px;
    color: #c8cdd4;
    line-height: 1.45;
    margin-bottom: 12px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .market-odds {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .odds-bar {
    flex: 1;
    height: 4px;
    background: #1e2530;
    border-radius: 2px;
    overflow: hidden;
  }

  .odds-fill {
    height: 100%;
    background: #22c55e;
    border-radius: 2px;
    transition: width 0.3s;
  }

  .odds-yes {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: #22c55e;
    min-width: 36px;
  }

  .odds-no {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: #ef4444;
    min-width: 36px;
    text-align: right;
  }

  .market-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .market-volume {
    font-size: 11px;
    color: #475569;
  }

  .market-tag {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 3px;
    background: #1e2530;
    color: #64748b;
  }

  .arb-badge {
    background: #f59e0b20;
    color: #f59e0b;
    border: 1px solid #f59e0b40;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 3px;
  }

  .empty-state {
    text-align: center;
    padding: 48px 24px;
    color: #334155;
    font-size: 13px;
  }

  .spinner {
    width: 20px; height: 20px;
    border: 2px solid #1e2530;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 32px auto;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .pipeline-status {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 20px;
  }

  .pipeline-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #111520;
    border: 1px solid #1e2530;
    border-radius: 6px;
  }

  .pipeline-name {
    font-size: 12px;
    color: #94a3b8;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dot { width: 6px; height: 6px; border-radius: 50%; }
  .dot-green { background: #22c55e; }
  .dot-amber { background: #f59e0b; }
  .dot-gray { background: #334155; }

  .pipeline-next {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: #475569;
  }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1e2530; border-radius: 2px; }
`;

function formatUSDC(v) {
  return "$" + parseFloat(v || 0).toFixed(2);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  return Math.floor(s / 3600) + "h ago";
}

export default function PolybotDashboard() {
  const [botStatus, setBotStatus] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchBot = useCallback(async () => {
    try {
      const r = await fetch(`${BOT_API}/status`);
      const d = await r.json();
      setBotStatus(d);
    } catch {
      setBotStatus(null);
    }
  }, []);

  const fetchMarkets = useCallback(async () => {
    try {
      const r = await fetch(`${GAMMA}/markets`);
      const d = await r.json();
      setMarkets(Array.isArray(d) ? d : []);
    } catch {
      setMarkets([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchBot(), fetchMarkets()]);
    setLastRefresh(new Date());
    setLoading(false);
  }, [fetchBot, fetchMarkets]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [refresh]);

  const filteredMarkets = markets.filter(m => {
    const q = (m.question || "").toLowerCase();
    if (search && !q.includes(search.toLowerCase())) return false;
    if (filter === "arb") {
      const yes = parseFloat(m.outcomePrices?.[0] || 0);
      const no = parseFloat(m.outcomePrices?.[1] || 0);
      return yes + no < 0.97;
    }
    if (filter === "high") {
      const yes = parseFloat(m.outcomePrices?.[0] || 0);
      return yes > 0.7;
    }
    if (filter === "low") {
      const yes = parseFloat(m.outcomePrices?.[0] || 0);
      return yes < 0.3;
    }
    return true;
  });

  const balance = botStatus?.paperBalance ?? 1000;
  const trades = botStatus?.trades ?? [];
  const tradeCount = botStatus?.tradesCount ?? 0;
  const arbCount = markets.filter(m => {
    const yes = parseFloat(m.outcomePrices?.[0] || 0);
    const no = parseFloat(m.outcomePrices?.[1] || 0);
    return yes + no < 0.97;
  }).length;

  const isPaper = true;

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <header className="topbar">
          <div className="topbar-left">
            <div className="logo-dot" />
            <span className="logo-text">POLYBOT</span>
            <span className={`badge ${isPaper ? "badge-paper" : "badge-live"}`}>
              {isPaper ? "PAPER" : "LIVE"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="stat-inline">Balanç<span>{formatUSDC(balance)}</span></span>
            <span className="stat-inline">Trades<span>{tradeCount}</span></span>
            <span className="stat-inline">Arbs<span style={{ color: arbCount > 0 ? "#f59e0b" : undefined }}>{arbCount}</span></span>
            {lastRefresh && (
              <span className="stat-inline">{timeAgo(lastRefresh)}</span>
            )}
            <button className="refresh-btn" onClick={refresh}>↻ Refresh</button>
          </div>
        </header>

        <div className="main">
          {/* Sidebar esquerra */}
          <aside className="panel sidebar-left">
            <div className="panel-title">Estat del bot</div>

            <div className="pipeline-status">
              {[
                { name: "News pipeline", interval: "15min", color: "dot-green" },
                { name: "Copy trading", interval: "30min", color: "dot-green" },
                { name: "Arb scanner", interval: "2min", color: "dot-green" },
              ].map(p => (
                <div className="pipeline-row" key={p.name}>
                  <span className="pipeline-name">
                    <span className={`dot ${p.color}`} />
                    {p.name}
                  </span>
                  <span className="pipeline-next">cada {p.interval}</span>
                </div>
              ))}
            </div>

            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-label">Balanç paper</div>
                <div className={`metric-value ${balance > 1000 ? "green" : balance < 1000 ? "red" : ""}`}>
                  {formatUSDC(balance)}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Trades totals</div>
                <div className="metric-value">{tradeCount}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Mercats actius</div>
                <div className="metric-value">{markets.length}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Arbs detectats</div>
                <div className={`metric-value ${arbCount > 0 ? "amber" : ""}`}>{arbCount}</div>
              </div>
            </div>

            <div className="panel-title" style={{ marginTop: 4 }}>Últims trades</div>
            {trades.length === 0 ? (
              <div className="empty-state">Cap trade executat encara</div>
            ) : (
              <div className="trade-list">
                {trades.slice().reverse().map((t, i) => (
                  <div className="trade-item" key={i}>
                    <div className="trade-item-header">
                      <span className={`trade-side ${t.side === "YES" ? "yes" : "no"}`}>{t.side}</span>
                      <span className="trade-size">{formatUSDC(t.size)}</span>
                    </div>
                    <div className="trade-market">{t.market}</div>
                    {t.reason && <div className="trade-reason">{t.reason}</div>}
                  </div>
                ))}
              </div>
            )}
          </aside>

          {/* Panell central — mercats */}
          <div className="markets-panel">
            <div className="markets-toolbar">
              <input
                className="search-input"
                placeholder="Cerca mercats..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {[
                { key: "all", label: "Tots" },
                { key: "high", label: "YES >70%" },
                { key: "low", label: "YES <30%" },
                { key: "arb", label: `Arb (${arbCount})` },
              ].map(f => (
                <button
                  key={f.key}
                  className={`filter-btn ${filter === f.key ? "active" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {loading && markets.length === 0 ? (
              <div className="spinner" />
            ) : filteredMarkets.length === 0 ? (
              <div className="empty-state">Cap mercat trobat</div>
            ) : (
              <div className="markets-grid">
                {filteredMarkets.map((m, i) => {
                  const yes = parseFloat(m.outcomePrices?.[0] ?? m.bestAsk ?? 0.5);
				  const no = 1 - yes;
                  const isArb = yes + no < 0.97;
                  const vol = m.volume ? parseFloat(m.volume).toLocaleString("en", { maximumFractionDigits: 0 }) : "—";
                  return (
                    <div className="market-card" key={m.id || i}>
                      <div className="market-question">{m.question}</div>
                      <div className="market-odds">
                        <span className="odds-yes">{(yes * 100).toFixed(0)}%</span>
                        <div className="odds-bar">
                          <div className="odds-fill" style={{ width: `${yes * 100}%` }} />
                        </div>
                        <span className="odds-no">{(no * 100).toFixed(0)}%</span>
                      </div>
                      <div className="market-footer">
                        <span className="market-volume">Vol: ${vol}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          {isArb && <span className="arb-badge">ARB</span>}
                          {m.category && <span className="market-tag">{m.category}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sidebar dreta */}
          <aside className="panel sidebar-right" style={{ borderRight: "none" }}>
            <div className="panel-title">Arb oportunitats</div>
            {arbCount === 0 ? (
              <div className="empty-state">Cap arb actiu ara</div>
            ) : (
              <div className="trade-list">
                {markets
                  .filter(m => {
                    const y = parseFloat(m.outcomePrices?.[0] || 0);
                    const n = parseFloat(m.outcomePrices?.[1] || 0);
                    return y + n < 0.97;
                  })
                  .map((m, i) => {
                    const y = parseFloat(m.outcomePrices?.[0] || 0);
                    const n = parseFloat(m.outcomePrices?.[1] || 0);
                    return (
                      <div className="trade-item" key={i} style={{ borderColor: "#f59e0b40" }}>
                        <div className="trade-market" style={{ marginBottom: 6, color: "#94a3b8", WebkitLineClamp: 2, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {m.question}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 }}>
                          <span style={{ color: "#22c55e" }}>YES {(y * 100).toFixed(1)}¢</span>
                          <span style={{ color: "#f59e0b" }}>∑ {((y + n) * 100).toFixed(1)}¢</span>
                          <span style={{ color: "#ef4444" }}>NO {(n * 100).toFixed(1)}¢</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            <div className="panel-title" style={{ marginTop: 20 }}>Connexió bot</div>
            <div className="pipeline-row">
              <span className="pipeline-name">
                <span className={`dot ${botStatus ? "dot-green" : "dot-gray"}`} />
                {botStatus ? "Connectat" : "Desconnectat"}
              </span>
              <span className="pipeline-next">{BOT_API.replace("http://", "")}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "#334155", padding: "8px 0" }}>
              Si no connecta: obre el port al VPS amb<br />
              <code style={{ fontFamily: "IBM Plex Mono, monospace", color: "#475569" }}>ufw allow 3001</code>
              <br />i afegeix a Vercel:<br />
              <code style={{ fontFamily: "IBM Plex Mono, monospace", color: "#475569" }}>VITE_BOT_API=http://IP:3001</code>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
