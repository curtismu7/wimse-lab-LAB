import React, { useEffect, useState } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';
import TopMenu from './top-menu/TopMenu.jsx';
import './top-menu/top-menu.css';
import './app.css';

const nodePos = (p) => p || { x: 0, y: 0 };

const ATTACKS = [
  { kind: 'wrong-aud', label: 'Wrong audience', note: 'WPT minted for a different target URI' },
  { kind: 'swap-txn', label: 'Swap Txn-Token', note: 'present a different user context than the one the WPT bound' },
  { kind: 'swap-wit', label: 'Swap WIT', note: 'pair the WPT with another workload\'s identity token' },
  { kind: 'expired', label: 'Expired WIT', note: 'present credentials past their exp' },
  { kind: 'untrusted-domain', label: 'Rogue trust domain', note: 'sub names a domain the issuer is not authorized for' },
];

export default function App() {
  const [health, setHealth] = useState(null);
  const [info, setInfo] = useState(null);
  const [story, setStory] = useState(null);
  const [nodes, setNodes] = useState([
    { id: 'issuer', position: nodePos({ x: 0, y: 60 }), data: { label: 'Issuer / Credential Service\n(trust domain corp.example.com)' } },
    { id: 'gateway', position: nodePos({ x: 300, y: 120 }), data: { label: 'Gateway\nwimse://corp.example.com/gateway' } },
    { id: 'orders', position: nodePos({ x: 640, y: 40 }), data: { label: 'Orders\nwimse://corp.example.com/orders' } },
    { id: 'billing', position: nodePos({ x: 640, y: 220 }), data: { label: 'Billing\nwimse://corp.example.com/billing' } },
    { id: 'txn', position: nodePos({ x: 300, y: 300 }), data: { label: 'Context service\nTxn-Token (Alice)' } },
  ]);
  const edges = [
    { id: 'e1', source: 'issuer', target: 'gateway', label: '(1) WIT' },
    { id: 'e2', source: 'gateway', target: 'orders', label: '(2) WIT + WPT + Txn' },
    { id: 'e3', source: 'orders', target: 'billing', label: '(3) WIT + WPT (binds Txn)' },
    { id: 'e4', source: 'txn', target: 'gateway', label: 'Txn-Token' },
  ];
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [present, setPresent] = useState(false);
  const [talkTrack, setTalkTrack] = useState(false);
  const [theme, setTheme] = useState('auto');
  const [fontSize, setFontSize] = useState('M');
  const [mode, setMode] = useState('mock');

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
    fetch('/api/info').then((r) => r.json()).then((i) => { setInfo(i); setMode(i.source); }).catch(() => {});
    fetch('/api/story').then((r) => r.json()).then(setStory).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.style.fontSize = { S: '14px', M: '16px', L: '18px' }[fontSize] || '16px';
    document.documentElement.dataset.theme = theme;
  }, [theme, fontSize]);

  const switchMode = async (next) => {
    const r = await fetch('/api/mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: next }),
    });
    if (r.ok) {
      setMode(next);
      const i = await (await fetch('/api/info')).json();
      setInfo(i);
      setNodes((ns) => ns.slice()); // reload data
    }
  };

  const runChain = async () => {
    setBusy(true);
    setResult(null);
    try {
      const wit = await (await fetch('/api/mint/wit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workloadId: 'wimse://corp.example.com/gateway' }),
      })).json();
      await new Promise((r) => setTimeout(r, 400 / speed));
      const txn = await (await fetch('/api/mint/txn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub: 'alice@example.com', tenant: 'demo' }),
      })).json();
      await new Promise((r) => setTimeout(r, 400 / speed));
      const hop = await (await fetch('/api/hop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerWorkloadId: 'wimse://corp.example.com/gateway',
          targetWorkloadId: 'wimse://corp.example.com/orders',
          targetUri: 'https://orders.example.com/api',
          witString: wit.witString,
          txnString: txn.txnString,
        }),
      })).json();
      setResult({ ok: hop.valid, hop });
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    }
    setBusy(false);
  };

  const runAttack = async (kind) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await (await fetch('/api/attack', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })).json();
      setResult({ ok: false, attack: r });
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    }
    setBusy(false);
  };

  const reset = () => {
    setNodes([
      { id: 'issuer', position: nodePos({ x: 0, y: 60 }), data: { label: 'Issuer / Credential Service\n(trust domain corp.example.com)' } },
      { id: 'gateway', position: nodePos({ x: 300, y: 120 }), data: { label: 'Gateway\nwimse://corp.example.com/gateway' } },
      { id: 'orders', position: nodePos({ x: 640, y: 40 }), data: { label: 'Orders\nwimse://corp.example.com/orders' } },
      { id: 'billing', position: nodePos({ x: 640, y: 220 }), data: { label: 'Billing\nwimse://corp.example.com/billing' } },
      { id: 'txn', position: nodePos({ x: 300, y: 300 }), data: { label: 'Context service\nTxn-Token (Alice)' } },
    ]);
    setResult(null);
  };

  return (
    <div className="lab">
      <header className="shell-bar">
        <h1>WIMSE Lab</h1>
        <TopMenu
          mode={{ value: mode, onChange: switchMode, realAvailable: info?.realAvailable, realHint: info?.realHint }}
          theme={{ value: theme, onChange: setTheme }}
          fontSize={{ value: fontSize, onChange: setFontSize }}
          present={{ active: present, onToggle: () => setPresent((p) => !p) }}
          talkTrack={{ active: talkTrack, onToggle: () => setTalkTrack((t) => !t) }}
          onReset={reset}
        />
      </header>
      <div className="banner">Simulation: all tokens, issuers and trust domains are in-process mocks. Nothing leaves this container. Mode: {mode}.</div>
      {present && story && (
        <section className="card result">
          <h2>{story.title} (presenter mode)</h2>
          <ol>
            {story.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </section>
      )}
      {talkTrack && story && (
        <section className="card result">
          <h2>Talk track</h2>
          <ol>
            {story.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </section>
      )}

      <section className="cards">
        <div className="card">
          <h2>Chain</h2>
          <p>Issuer mints a Workload Identity Token (WIT) for the gateway. A context service mints a Txn-Token for Alice. Every hop presents WIT + WPT (Workload Proof Token) + Txn-Token; the WPT&apos;s wth/tth claims cryptographically bind them together.</p>
          <div style={{ height: 340 }}>
            <ReactFlow nodes={nodes} edges={edges} onNodesChange={(c) => {
              setNodes((ns) => {
                const byId = Object.fromEntries(ns.map((n) => [n.id, n]));
                return ns.map((n) => {
                  const change = c.find((x) => x.id === n.id && x.type === 'position' && x.position);
                  return change ? { ...n, position: change.position } : n;
                });
              });
            }}>
              <Background />
              <Controls />
            </ReactFlow>
          </div>
          <div className="controls">
            <button className="primary" onClick={runChain} disabled={busy}>Run chain</button>
            <button onClick={reset} disabled={busy}>Reset</button>
            <label>
              Speed
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card">
          <h2>Break it</h2>
          <p>Each attack shows the exact refusal the WIMSE validation chain produces.</p>
          <div className="attack-grid">
            {ATTACKS.map((a) => (
              <button key={a.kind} onClick={() => runAttack(a.kind)} disabled={busy} title={a.note}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="result card">
        <h2>Result</h2>
        {!result && <p className="muted">Run the chain or an attack.</p>}
        {result?.error && <p className="fail">{result.error}</p>}
        {result?.attack && (
          <div>
            <p className={result.attack.valid ? 'pass' : 'refused'}>
              {result.attack.valid ? 'ACCEPTED (unexpected)' : 'REFUSED'} — {result.attack.kind}
            </p>
            {result.attack.note && <p className="muted">{result.attack.note}</p>}
            <pre className="json">{JSON.stringify(result.attack.failures, null, 2)}</pre>
          </div>
        )}
        {result?.hop && (
          <div>
            <p className={result.ok ? 'pass' : 'refused'}>{result.ok ? 'HOP ACCEPTED' : 'REFUSED'}</p>
            {result.ok ? (
              <>
                <h3>WIT claims</h3>
                <pre className="json">{JSON.stringify(result.hop.wit.payload, null, 2)}</pre>
                <h3>WPT claims</h3>
                <pre className="json">{JSON.stringify(result.hop.wpt.payload, null, 2)}</pre>
                <h3>Txn-Token claims</h3>
                <pre className="json">{JSON.stringify(result.hop.txn.payload, null, 2)}</pre>
              </>
            ) : (
              <pre className="json">{JSON.stringify(result.hop.failures, null, 2)}</pre>
            )}
          </div>
        )}
      </section>

      <footer className="muted">
        {health ? `health: ${health.status} (${health.catalogId})` : 'health: unknown'} · IETF WIMSE arch draft-ietf-wimse-arch-09, WPT draft-ietf-wimse-wpt-02 · mock only
      </footer>
    </div>
  );
}
