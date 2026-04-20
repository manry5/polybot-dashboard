import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const GAMMA_URL = "https://gamma-api.polymarket.com";
const CORS_PROXY = "https://corsproxy.io/?url=";
const BOT_INTERVAL_MS = 5 * 60 * 1000;
const MARKET_REFRESH_MS = 3 * 60 * 1000;
const INITIAL_BALANCE = 1000;
const MAX_POSITION_PCT = 0.08;
const MAX_OPEN_POSITIONS = 6;

// ─── STORAGE ─────────────────────────────────────────────────────────────────
function loadState() {
  try { const s = localStorage.getItem("polybot_v3"); if (s) return JSON.parse(s); } catch {}
  return null;
}
function saveState(s) { try { localStorage.setItem("polybot_v3", JSON.stringify(s)); } catch {} }
function initState() { return { balance: INITIAL_BALANCE, positions: [], trades: [], log: [] }; }

// ─── KELLY ───────────────────────────────────────────────────────────────────
function kellySize(balance, prob, edge) {
  const b = (1 / Math.max(prob, 0.01)) - 1;
  const p = Math.min(prob + edge, 0.99);
  const q = 1 - p;
  const kelly = Math.max(0, (b * p - q) / b);
  const frac = Math.min(kelly * 0.5, MAX_POSITION_PCT);
  return Math.max(5, Math.min(balance * frac, balance * MAX_POSITION_PCT));
}

// ─── FETCH MARKETS ────────────────────────────────────────────────────────────
async function fetchMarkets() {
  const params = "?limit=50&active=true&closed=false&order=volume&ascending=false";
  try {
    const r = await fetch(`${GAMMA_URL}/markets${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) { const d = await r.json(); return Array.isArray(d) ? d : []; }
  } catch {}
  try {
    const r = await fetch(`${CORS_PROXY}${encodeURIComponent(GAMMA_URL + "/markets" + params)}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (r.ok) { const d = await r.json(); return Array.isArray(d) ? d : []; }
  } catch {}
  return [];
}

// ─── BOT ENGINE ───────────────────────────────────────────────────────────────
function runBotEngine(markets, state, rules) {
  const now = new Date().toISOString();
  const newTrades = [];
  const newLog = [];
  let { balance, positions } = state;

  // Tancar posicions (TP/SL/mercat tancat)
  const keepPositions = [];
  for (const pos of positions) {
    const market = markets.find(m => m.id === pos.marketId);
    const raw = market
      ? parseFloat(pos.side === "YES" ? market.outcomePrices?.[0] : market.outcomePrices?.[1])
      : NaN;
    const currentPrice = isNaN(raw) ? pos.entryPrice : raw;
    const pnlPct = pos.entryPrice > 0 ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0;
    const activeRule = rules.find(r => r.id === pos.ruleId);
    const tp = activeRule?.takeProfit ?? 50;
    const sl = activeRule?.stopLoss ?? -30;

    if (pnlPct >= tp || pnlPct <= sl || !market || market.closed) {
      const exitValue = currentPrice * pos.shares;
      balance += exitValue;
      const reason = pnlPct >= tp ? `TP +${pnlPct.toFixed(1)}%` : pnlPct <= sl ? `SL ${pnlPct.toFixed(1)}%` : "Mercat tancat";
      newTrades.push({ type: "CLOSE", side: pos.side, market: pos.question, size: exitValue, pnl: exitValue - pos.size, pnlPct: pnlPct.toFixed(1), reason, at: now });
      newLog.push(`[CLOSE] ${pos.side} "${pos.question.slice(0, 40)}..." → ${reason} | PnL: ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`);
    } else {
      keepPositions.push({ ...pos, currentPrice, pnlPct });
    }
  }
  positions = keepPositions;

  // Obrir noves posicions
  if (positions.length < MAX_OPEN_POSITIONS && rules.some(r => r.enabled)) {
    for (const market of markets) {
      if (positions.length >= MAX_OPEN_POSITIONS) break;
      if (positions.find(p => p.marketId === market.id)) continue;
      const yesPrice = parseFloat(market.outcomePrices?.[0] ?? 0.5);
      const noPrice  = parseFloat(market.outcomePrices?.[1] ?? (1 - yesPrice));
      if (!yesPrice || yesPrice <= 0 || yesPrice >= 1) continue;
      if (parseFloat(market.volume ?? 0) < 5000) continue;

      for (const rule of rules) {
        if (!rule.enabled) continue;
        let signal = null;
        const thr = rule.threshold / 100;
        if      (rule.type === "CONTRARIAN_LOW"  && yesPrice < thr) signal = { side: "YES", price: yesPrice, prob: yesPrice,  edge: 0.05 };
        else if (rule.type === "CONTRARIAN_HIGH" && yesPrice > thr) signal = { side: "NO",  price: noPrice,  prob: noPrice,   edge: 0.05 };
        else if (rule.type === "MOMENTUM_HIGH"   && yesPrice > thr) signal = { side: "YES", price: yesPrice, prob: yesPrice,  edge: 0.03 };
        else if (rule.type === "MOMENTUM_LOW"    && yesPrice < thr) signal = { side: "NO",  price: noPrice,  prob: noPrice,   edge: 0.03 };

        if (signal && balance > 20) {
          const size = kellySize(balance, signal.prob, signal.edge);
          if (size > balance) continue;
          balance -= size;
          const pos = { id: `${market.id}_${Date.now()}`, marketId: market.id, ruleId: rule.id, question: market.question, side: signal.side, entryPrice: signal.price, currentPrice: signal.price, pnlPct: 0, size, shares: size / signal.price, openedAt: now };
          positions.push(pos);
          newTrades.push({ type: "OPEN", side: signal.side, market: market.question, size, price: signal.price, reason: `${rule.name} (${(signal.price * 100).toFixed(0)}%)`, at: now });
          newLog.push(`[OPEN] ${signal.side} "${market.question.slice(0, 40)}..." @ ${(signal.price * 100).toFixed(1)}% | $${size.toFixed(2)} (${rule.name})`);
          break;
        }
      }
    }
  }

  if (newLog.length === 0) newLog.push(`[SCAN] ${markets.length} mercats escaneats — cap senyal`);

  return {
    balance,
    positions,
    trades: [...state.trades, ...newTrades].slice(-100),
    log: [...state.log, ...newLog].slice(-50),
  };
}

// ─── DEFAULT RULES ────────────────────────────────────────────────────────────
const DEFAULT_RULES = [
  { id: "r1", name: "Contrarian LOW",  type: "CONTRARIAN_LOW",  threshold: 15, takeProfit: 60, stopLoss: -25, enabled: true,  description: "Compra YES quan probabilitat < 15%" },
  { id: "r2", name: "Contrarian HIGH", type: "CONTRARIAN_HIGH", threshold: 85, takeProfit: 60, stopLoss: -25, enabled: true,  description: "Compra NO quan probabilitat > 85%"  },
  { id: "r3", name: "Momentum HIGH",   type: "MOMENTUM_HIGH",   threshold: 70, takeProfit: 30, stopLoss: -20, enabled: false, description: "Segueix tendència quan YES > 70%"    },
];

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body, #root { background: #0a0c0f; color: #c8cdd4; font-family: 'IBM Plex Sans', sans-serif; min-height: 100vh; }
  .app { display: grid; grid-template-rows: 56px 40px 1fr; min-height: 100vh; }

  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid #1e2530; background: #0d1017; }
  .topbar-left { display: flex; align-items: center; gap: 10px; }
  .logo-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .logo-text { font-family:'IBM Plex Mono',monospace; font-size:15px; font-weight:500; color:#e2e8f0; letter-spacing:.05em; }
  .badge { font-family:'IBM Plex Mono',monospace; font-size:11px; padding:2px 8px; border-radius:4px; border:1px solid; }
  .badge-paper { color:#f59e0b; border-color:#f59e0b40; background:#f59e0b10; }
  .topbar-right { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .stat-inline { font-family:'IBM Plex Mono',monospace; font-size:12px; color:#64748b; }
  .stat-inline span { color:#94a3b8; margin-left:4px; }
  .stat-inline span.g { color:#22c55e; } .stat-inline span.r { color:#ef4444; }
  .refresh-btn { font-family:'IBM Plex Mono',monospace; font-size:11px; padding:4px 12px; background:transparent; border:1px solid #1e2530; border-radius:4px; color:#64748b; cursor:pointer; }
  .refresh-btn:hover { border-color:#334155; color:#94a3b8; }

  .tabs { display:flex; align-items:center; border-bottom:1px solid #1e2530; background:#0d1017; padding:0 20px; }
  .tab { font-family:'IBM Plex Mono',monospace; font-size:11px; padding:10px 16px; cursor:pointer; color:#475569; border-bottom:2px solid transparent; transition:all .15s; background:none; border-left:none; border-right:none; border-top:none; }
  .tab:hover { color:#94a3b8; }
  .tab.active { color:#e2e8f0; border-bottom-color:#3b82f6; }

  .main-content { overflow-y:auto; padding:20px; }

  .metric-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:8px; margin-bottom:20px; }
  .metric-card { background:#111520; border:1px solid #1e2530; border-radius:6px; padding:12px; }
  .metric-label { font-size:11px; color:#475569; margin-bottom:4px; }
  .metric-value { font-family:'IBM Plex Mono',monospace; font-size:18px; font-weight:500; color:#e2e8f0; }
  .metric-value.g { color:#22c55e; } .metric-value.r { color:#ef4444; } .metric-value.a { color:#f59e0b; }

  .table { width:100%; border-collapse:collapse; font-size:12px; }
  .table th { text-align:left; padding:8px 12px; color:#475569; font-family:'IBM Plex Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:.08em; border-bottom:1px solid #1e2530; font-weight:400; }
  .table td { padding:10px 12px; border-bottom:1px solid #1a1f2a; vertical-align:middle; }
  .table tr:hover td { background:#111520; }
  .sb { font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:500; padding:2px 7px; border-radius:3px; }
  .sb.yes { background:#22c55e20; color:#22c55e; } .sb.no { background:#ef444420; color:#ef4444; }
  .pg { color:#22c55e; font-family:'IBM Plex Mono',monospace; }
  .pr { color:#ef4444; font-family:'IBM Plex Mono',monospace; }
  .pz { color:#64748b; font-family:'IBM Plex Mono',monospace; }

  .markets-toolbar { display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
  .search-input { flex:1; min-width:160px; background:#111520; border:1px solid #1e2530; border-radius:6px; padding:7px 12px; font-family:'IBM Plex Sans',sans-serif; font-size:13px; color:#c8cdd4; outline:none; }
  .search-input:focus { border-color:#334155; }
  .search-input::placeholder { color:#334155; }
  .filter-btn { font-size:12px; padding:6px 12px; background:transparent; border:1px solid #1e2530; border-radius:6px; color:#64748b; cursor:pointer; white-space:nowrap; }
  .filter-btn:hover,.filter-btn.active { border-color:#3b82f6; color:#3b82f6; background:#3b82f610; }
  .markets-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); gap:10px; }
  .market-card { background:#111520; border:1px solid #1e2530; border-radius:8px; padding:14px; cursor:pointer; transition:border-color .15s; }
  .market-card:hover { border-color:#334155; }
  .market-question { font-size:13px; color:#c8cdd4; line-height:1.45; margin-bottom:12px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .market-odds { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
  .odds-bar { flex:1; height:4px; background:#1e2530; border-radius:2px; overflow:hidden; }
  .odds-fill { height:100%; background:#22c55e; border-radius:2px; }
  .oy { font-family:'IBM Plex Mono',monospace; font-size:12px; color:#22c55e; min-width:36px; }
  .on { font-family:'IBM Plex Mono',monospace; font-size:12px; color:#ef4444; min-width:36px; text-align:right; }
  .market-footer { display:flex; justify-content:space-between; align-items:center; }
  .market-volume { font-size:11px; color:#475569; }
  .market-tag { font-size:10px; padding:2px 7px; border-radius:3px; background:#1e2530; color:#64748b; }

  .rule-card { background:#111520; border:1px solid #1e2530; border-radius:8px; padding:16px; margin-bottom:10px; }
  .rule-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
  .rule-name { font-family:'IBM Plex Mono',monospace; font-size:13px; color:#e2e8f0; }
  .rule-desc { font-size:12px; color:#64748b; margin-bottom:12px; }
  .rule-params { display:flex; gap:16px; flex-wrap:wrap; }
  .rule-param { display:flex; flex-direction:column; gap:4px; }
  .rule-param label { font-size:10px; color:#475569; text-transform:uppercase; letter-spacing:.08em; }
  .rule-param input { width:80px; background:#0d1017; border:1px solid #1e2530; border-radius:4px; padding:5px 8px; font-family:'IBM Plex Mono',monospace; font-size:12px; color:#c8cdd4; outline:none; }
  .rule-param input:focus { border-color:#334155; }

  .toggle { position:relative; width:36px; height:20px; cursor:pointer; display:inline-block; }
  .toggle input { opacity:0; width:0; height:0; }
  .toggle-slider { position:absolute; inset:0; background:#1e2530; border-radius:10px; transition:.2s; }
  .toggle-slider:before { content:''; position:absolute; width:14px; height:14px; left:3px; top:3px; background:#475569; border-radius:50%; transition:.2s; }
  .toggle input:checked + .toggle-slider { background:#22c55e30; }
  .toggle input:checked + .toggle-slider:before { background:#22c55e; transform:translateX(16px); }

  .log-list { display:flex; flex-direction:column; gap:4px; }
  .log-item { font-family:'IBM Plex Mono',monospace; font-size:11px; padding:6px 10px; background:#111520; border-radius:4px; border-left:2px solid #1e2530; color:#475569; }
  .log-item.open { border-left-color:#22c55e; color:#c8cdd4; }
  .log-item.close { border-left-color:#f59e0b; color:#c8cdd4; }

  .section-title { font-family:'IBM Plex Mono',monospace; font-size:11px; color:#475569; text-transform:uppercase; letter-spacing:.1em; margin-bottom:12px; margin-top:20px; }
  .section-title:first-child { margin-top:0; }
  .empty-state { text-align:center; padding:40px 24px; color:#334155; font-size:13px; }
  .spinner { width:20px; height:20px; border:2px solid #1e2530; border-top-color:#3b82f6; border-radius:50%; animation:spin .8s linear infinite; margin:40px auto; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .btn { font-family:'IBM Plex Mono',monospace; font-size:11px; padding:6px 14px; border-radius:4px; border:1px solid; cursor:pointer; transition:all .15s; }
  .btn-primary { background:#3b82f620; border-color:#3b82f640; color:#3b82f6; }
  .btn-primary:hover { background:#3b82f630; }
  .btn-ghost { background:transparent; border-color:#1e2530; color:#64748b; }
  .btn-ghost:hover { border-color:#334155; color:#94a3b8; }
  ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:#1e2530;border-radius:2px}
`;

// ─── UTILS ────────────────────────────────────────────────────────────────────
const fmt$ = v => "$" + parseFloat(v || 0).toFixed(2);
function fmtPct(v) {
  const n = parseFloat(v);
  if (isNaN(n) || !isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}
function timeAgo(ts) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return s + "s"; if (s < 3600) return Math.floor(s / 60) + "m"; return Math.floor(s / 3600) + "h";
}
function pC(v) { const n = parseFloat(v); if (isNaN(n) || n === 0) return "pz"; return n > 0 ? "pg" : "pr"; }

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function PolybotDashboard() {
  const [tab, setTab]           = useState("portfolio");
  const [markets, setMarkets]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [mktStatus, setMktStatus] = useState("—");
  const [lastRef, setLastRef]   = useState(null);
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState("all");

  const [botState, setBotState] = useState(() => loadState() || initState());
  const [rules, setRules] = useState(() => {
    try { const s = localStorage.getItem("polybot_rules_v3"); return s ? JSON.parse(s) : DEFAULT_RULES; } catch { return DEFAULT_RULES; }
  });

  const mktRef   = useRef(markets);
  const rulesRef = useRef(rules);
  mktRef.current   = markets;
  rulesRef.current = rules;

  useEffect(() => { saveState(botState); }, [botState]);
  useEffect(() => { try { localStorage.setItem("polybot_rules_v3", JSON.stringify(rules)); } catch {} }, [rules]);

  const refreshMarkets = useCallback(async () => {
    setLoading(true); setMktStatus("carregant...");
    const data = await fetchMarkets();
    setMarkets(data);
    setLastRef(new Date());
    setLoading(data.length === 0);
    setMktStatus(data.length > 0 ? `${data.length} mercats` : "❌ CORS");
  }, []);

  const runBot = useCallback(() => {
    if (mktRef.current.length === 0) return;
    setBotState(prev => runBotEngine(mktRef.current, prev, rulesRef.current));
  }, []);

  useEffect(() => { refreshMarkets(); }, [refreshMarkets]);
  useEffect(() => { const id = setInterval(refreshMarkets, MARKET_REFRESH_MS); return () => clearInterval(id); }, [refreshMarkets]);
  useEffect(() => { const id = setInterval(runBot, BOT_INTERVAL_MS); return () => clearInterval(id); }, [runBot]);

  const { balance, positions, trades, log } = botState;

  const openPnL   = positions.reduce((a, p) => a + ((p.currentPrice ?? p.entryPrice) - p.entryPrice) * p.shares, 0);
  const closedPnL = trades.filter(t => t.type === "CLOSE").reduce((a, t) => a + (t.pnl ?? 0), 0);
  const totalVal  = balance + positions.reduce((a, p) => a + (p.currentPrice ?? p.entryPrice) * p.shares, 0);
  const totalPnL  = totalVal - INITIAL_BALANCE;
  const totalPct  = INITIAL_BALANCE > 0 ? (totalPnL / INITIAL_BALANCE) * 100 : 0;

  const arbCount = markets.filter(m => {
    const y = parseFloat(m.outcomePrices?.[0] || 0), n = parseFloat(m.outcomePrices?.[1] || 0);
    return y + n < 0.97;
  }).length;

  const filteredMarkets = markets.filter(m => {
    const q = (m.question || "").toLowerCase();
    if (search && !q.includes(search.toLowerCase())) return false;
    const y = parseFloat(m.outcomePrices?.[0] || 0), n = parseFloat(m.outcomePrices?.[1] || 0);
    if (filter === "arb")  return y + n < 0.97;
    if (filter === "high") return y > 0.7;
    if (filter === "low")  return y < 0.3;
    return true;
  });

  const updRule = (id, field, value) => setRules(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  const resetBot = () => { if (!confirm("Reiniciar tot?")) return; setBotState(initState()); localStorage.removeItem("polybot_v3"); };

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <header className="topbar">
          <div className="topbar-left">
            <div className="logo-dot" />
            <span className="logo-text">POLYBOT</span>
            <span className="badge badge-paper">PAPER</span>
          </div>
          <div className="topbar-right">
            <span className="stat-inline">Valor<span className={totalPnL >= 0 ? "g" : "r"}>{fmt$(totalVal)}</span></span>
            <span className="stat-inline">P&L<span className={totalPnL >= 0 ? "g" : "r"}>{fmtPct(totalPct)}</span></span>
            <span className="stat-inline">Pos.<span>{positions.length}/{MAX_OPEN_POSITIONS}</span></span>
            <span className="stat-inline">Arbs<span style={{ color: arbCount > 0 ? "#f59e0b" : undefined }}>{arbCount}</span></span>
            <span className="stat-inline" style={{ fontSize: 10, color: "#334155" }}>{mktStatus}</span>
            <button className="refresh-btn" onClick={() => { refreshMarkets(); runBot(); }}>↻</button>
          </div>
        </header>

        <div className="tabs">
          {[
            ["portfolio", "Portfolio"],
            ["markets",   "Mercats"],
            ["trades",    `Trades (${trades.length})`],
            ["rules",     "Regles"],
            ["log",       "Log"],
          ].map(([k, l]) => (
            <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        <div className="main-content">

          {/* PORTFOLIO */}
          {tab === "portfolio" && (
            <>
              <div className="metric-grid">
                {[
                  ["Valor total",    fmt$(totalVal),   totalPnL > 0 ? "g" : totalPnL < 0 ? "r" : ""],
                  ["P&L total",      fmtPct(totalPct), totalPnL > 0 ? "g" : totalPnL < 0 ? "r" : ""],
                  ["Efectiu lliure", fmt$(balance),    ""],
                  ["P&L obert",      fmt$(openPnL),    openPnL > 0 ? "g" : openPnL < 0 ? "r" : ""],
                  ["P&L tancat",     fmt$(closedPnL),  closedPnL > 0 ? "g" : closedPnL < 0 ? "r" : ""],
                  ["Posicions",      positions.length, ""],
                ].map(([label, val, cls]) => (
                  <div className="metric-card" key={label}>
                    <div className="metric-label">{label}</div>
                    <div className={`metric-value ${cls}`}>{val}</div>
                  </div>
                ))}
              </div>

              <div className="section-title">Posicions obertes</div>
              {positions.length === 0 ? (
                <div className="empty-state">Cap posició oberta<br /><span style={{ fontSize: 11, color: "#334155" }}>Bot escaneja cada 5 min. Cal que els mercats hagin carregat.</span></div>
              ) : (
                <table className="table">
                  <thead><tr><th>Mercat</th><th>Costat</th><th>Entrada</th><th>Actual</th><th>P&L %</th><th>P&L $</th><th>Mida</th><th>Fa</th></tr></thead>
                  <tbody>
                    {positions.map(p => {
                      const curr = p.currentPrice ?? p.entryPrice;
                      const pnlD = (curr - p.entryPrice) * p.shares;
                      const pnlP = p.entryPrice > 0 ? ((curr - p.entryPrice) / p.entryPrice) * 100 : 0;
                      return (
                        <tr key={p.id}>
                          <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#94a3b8" }}>{p.question}</td>
                          <td><span className={`sb ${p.side === "YES" ? "yes" : "no"}`}>{p.side}</span></td>
                          <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11 }}>{(p.entryPrice * 100).toFixed(1)}¢</td>
                          <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11 }}>{(curr * 100).toFixed(1)}¢</td>
                          <td><span className={pC(pnlP)}>{fmtPct(pnlP)}</span></td>
                          <td><span className={pC(pnlD)}>{pnlD >= 0 ? "+" : ""}{fmt$(pnlD)}</span></td>
                          <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11 }}>{fmt$(p.size)}</td>
                          <td style={{ color: "#475569", fontSize: 11 }}>{timeAgo(p.openedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                <button className="btn btn-primary" onClick={runBot}>▶ Forçar cicle bot</button>
                <button className="btn btn-ghost"   onClick={resetBot}>↺ Reset</button>
              </div>
            </>
          )}

          {/* MERCATS */}
          {tab === "markets" && (
            <>
              <div className="markets-toolbar">
                <input className="search-input" placeholder="Cerca mercats..." value={search} onChange={e => setSearch(e.target.value)} />
                {[["all","Tots"],["high","YES >70%"],["low","YES <30%"],["arb",`Arb (${arbCount})`]].map(([k,l]) => (
                  <button key={k} className={`filter-btn ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>{l}</button>
                ))}
                {lastRef && <span style={{ fontSize: 11, color: "#334155", fontFamily: "IBM Plex Mono, monospace" }}>fa {timeAgo(lastRef)}</span>}
              </div>
              {loading && markets.length === 0 ? (
                <div><div className="spinner" /><div className="empty-state">Carregant mercats...<br /><span style={{ fontSize: 11, color: "#334155" }}>Si no carrega, pot ser bloqueig CORS del navegador.</span></div></div>
              ) : filteredMarkets.length === 0 ? (
                <div className="empty-state">Cap mercat trobat</div>
              ) : (
                <div className="markets-grid">
                  {filteredMarkets.map((m, i) => {
                    const yes = parseFloat(m.outcomePrices?.[0] ?? 0.5);
                    const no  = parseFloat(m.outcomePrices?.[1] ?? (1 - yes));
                    const isArb = yes + no < 0.97;
                    const vol = m.volume ? parseFloat(m.volume).toLocaleString("en", { maximumFractionDigits: 0 }) : "—";
                    return (
                      <div className="market-card" key={m.id || i}>
                        <div className="market-question">{m.question}</div>
                        <div className="market-odds">
                          <span className="oy">{(yes * 100).toFixed(0)}%</span>
                          <div className="odds-bar"><div className="odds-fill" style={{ width: `${yes * 100}%` }} /></div>
                          <span className="on">{(no * 100).toFixed(0)}%</span>
                        </div>
                        <div className="market-footer">
                          <span className="market-volume">Vol: ${vol}</span>
                          <div style={{ display: "flex", gap: 6 }}>
                            {isArb && <span style={{ background:"#f59e0b20",color:"#f59e0b",border:"1px solid #f59e0b40",fontFamily:"IBM Plex Mono,monospace",fontSize:10,padding:"2px 7px",borderRadius:3 }}>ARB</span>}
                            {m.category && <span className="market-tag">{m.category}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* TRADES */}
          {tab === "trades" && (
            trades.length === 0 ? <div className="empty-state">Encara no hi ha trades</div> : (
              <table className="table">
                <thead><tr><th>Tipus</th><th>Costat</th><th>Mercat</th><th>Mida</th><th>P&L</th><th>Raó</th><th>Hora</th></tr></thead>
                <tbody>
                  {[...trades].reverse().map((t, i) => (
                    <tr key={i}>
                      <td><span style={{ fontFamily:"IBM Plex Mono,monospace",fontSize:10,color:t.type==="OPEN"?"#3b82f6":"#f59e0b" }}>{t.type}</span></td>
                      <td><span className={`sb ${t.side==="YES"?"yes":"no"}`}>{t.side}</span></td>
                      <td style={{ maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#94a3b8",fontSize:12 }}>{t.market}</td>
                      <td style={{ fontFamily:"IBM Plex Mono,monospace",fontSize:11 }}>{fmt$(t.size)}</td>
                      <td>{t.type==="CLOSE" ? <span className={pC(t.pnl)}>{t.pnl>=0?"+":""}{fmt$(t.pnl)} ({fmtPct(t.pnlPct)})</span> : <span style={{color:"#334155"}}>—</span>}</td>
                      <td style={{ fontSize:11,color:"#64748b" }}>{t.reason}</td>
                      <td style={{ fontSize:11,color:"#475569",fontFamily:"IBM Plex Mono,monospace" }}>{timeAgo(t.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {/* REGLES */}
          {tab === "rules" && (
            <>
              <div style={{ marginBottom:16,fontSize:12,color:"#475569" }}>
                Cicle automàtic cada <strong style={{color:"#94a3b8"}}>5 min</strong>. Cada regla compra amb Kelly Criterion (màx 8% per trade). Estat guardat a localStorage.
              </div>
              {rules.map(rule => (
                <div className="rule-card" key={rule.id}>
                  <div className="rule-header">
                    <span className="rule-name">{rule.name}</span>
                    <label className="toggle">
                      <input type="checkbox" checked={rule.enabled} onChange={e => updRule(rule.id,"enabled",e.target.checked)} />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                  <div className="rule-desc">{rule.description}</div>
                  <div className="rule-params">
                    {[["threshold","Llindar %"],["takeProfit","Take Profit %"],["stopLoss","Stop Loss %"]].map(([field,label]) => (
                      <div className="rule-param" key={field}>
                        <label>{label}</label>
                        <input type="number" value={rule[field]} onChange={e => updRule(rule.id, field, parseFloat(e.target.value))} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* LOG */}
          {tab === "log" && (
            log.length === 0 ? (
              <div className="empty-state">El bot no ha executat cap cicle encara.<br /><span style={{fontSize:11,color:"#334155"}}>Prem "Forçar cicle bot" o espera 5 min.</span></div>
            ) : (
              <div className="log-list">
                {[...log].reverse().map((entry, i) => {
                  const cls = entry.includes("[OPEN]") ? "open" : entry.includes("[CLOSE]") ? "close" : "";
                  return <div key={i} className={`log-item ${cls}`}>{entry}</div>;
                })}
              </div>
            )
          )}

        </div>
      </div>
    </>
  );
}
