import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import TopMenu from "./top-menu/TopMenu.jsx";
import "./top-menu/top-menu.css";
import DiagramStepBar from "./components/DiagramStepBar.jsx";
import { REFIT_EVENT, useFitOnResize } from "./hooks/useFitOnResize";
import { useDiagramStepper } from "./hooks/useDiagramStepper";
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport, PassportActions } from "./diagram-kit/DiagramKit.jsx";
import { boxPassport, sidePoint } from "./diagram-kit/diagramKit.js";
import "./diagram-kit/diagram-kit.css";
import "./standalone-ui.css";
import "./app.css";

const FIT = { padding: 0.08 };
const HANDLES = [["t", Position.Top], ["b", Position.Bottom], ["l", Position.Left], ["r", Position.Right]];

const PATTERN = {
  title: "The WIMSE chain",
  nodes: [
    { id: "issuer", label: "Issuer / Credential Service", kind: "idp", x: 40, y: 60 },
    { id: "gateway", label: "Gateway", kind: "gateway", x: 340, y: 140 },
    { id: "orders", label: "Orders", kind: "resource", x: 700, y: 40 },
    { id: "billing", label: "Billing", kind: "resource", x: 700, y: 240 },
    { id: "txn", label: "Context service", kind: "idp", x: 340, y: 340 },
  ],
  steps: [
    { from: "issuer", to: "gateway", label: "(1) WIT: who the workload is + cnf key", say: "The issuer mints a Workload Identity Token for the gateway: sub names the workload in the trust domain, cnf.jwk carries its public key. A WIT is never bearer." },
    { from: "txn", to: "gateway", label: "Txn-Token: Alice's context", say: "The context service mints a Txn-Token carrying the end-user context (Alice) for this transaction." },
    { from: "gateway", to: "orders", label: "(2) WIT + WPT + Txn-Token", say: "The gateway calls orders: WIT + WPT (aud = exact target URI, exp seconds, jti replay, wth = hash of the WIT, tth = hash of the Txn-Token) + the Txn-Token. Orders verifies every claim." },
    { from: "orders", to: "billing", label: "(3) WIT + WPT (binds Txn)", say: "Orders calls billing the same way. The WPT cryptographically binds identity, audience and context: steal any single token and it is useless elsewhere." },
  ],
};

const GRAPH = {
  nodes: PATTERN.nodes.map((n) => ({ id: n.id, label: n.label, group: n.kind, groupLabel: n.kind === "idp" ? "issuer / context" : n.kind })),
  edges: PATTERN.steps.map((s, i) => ({ source: s.from, target: s.to, label: `${i + 1}. ${s.label}` })),
};

const initialPositions = Object.fromEntries(PATTERN.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

function Box({ data }) {
  return (
    <div className={`wlab-node wlab-node--${data.kind}${data.on ? " wlab-node--on" : ""}${data.passport ? " dk-open" : ""}`} data-testid={`wlab-node-${data.id}`}>
      {HANDLES.map(([k, pos]) => (
        <span key={k}>
          <Handle id={`s-${k}`} type="source" position={pos} className="wlab-handle" />
          <Handle id={`t-${k}`} type="target" position={pos} className="wlab-handle" />
        </span>
      ))}
      {data.label}
      {data.passport && <Passport p={data.passport} />}
    </div>
  );
}
const nodeTypes = { box: Box };
const edgeTypes = { arrow: ArrowNoLabel };

function sides(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ["r", "l"] : ["l", "r"]) : (dy > 0 ? ["b", "t"] : ["t", "b"]);
}

function labelOffsets(steps) {
  return steps.map((s, i) => {
    if (steps.slice(0, i).some((o) => o.from === s.to && o.to === s.from)) return 16;
    return steps.slice(i + 1).some((o) => o.from === s.to && o.to === s.from) ? -16 : 0;
  });
}

function Canvas({ positions, onMove, stepper, open, setOpen }) {
  const ref = useRef(null);
  useFitOnResize(ref, FIT);
  const active = stepper.step >= 0 ? PATTERN.steps[stepper.step] : null;
  const nodes = PATTERN.nodes.map((n) => ({
    id: n.id, type: "box", position: positions[n.id], draggable: true, zIndex: n.id === open ? 10 : undefined,
    data: { id: n.id, label: n.label, kind: n.kind, on: !!active && (active.from === n.id || active.to === n.id), passport: n.id === open ? boxPassport(GRAPH, n.id) : null },
  }));
  const offs = labelOffsets(PATTERN.steps);
  const edges = PATTERN.steps.map((s, i) => {
    let [a, b] = sides(positions[s.from], positions[s.to]);
    if (PATTERN.steps.slice(0, i).some((o) => o.from === s.to && o.to === s.from)) [a, b] = a === "l" || a === "r" ? ["b", "b"] : ["r", "r"];
    const now = stepper.step === i;
    const seen = stepper.step >= 0 && i <= stepper.step;
    return {
      id: `e${i}`, source: s.from, target: s.to, sourceHandle: `s-${a}`, targetHandle: `t-${b}`, type: "arrow",
      animated: now,
      className: `wlab-edge${now ? " wlab-edge--now" : ""}${stepper.step >= 0 && !seen ? " wlab-edge--dim" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed },
    };
  });
  const labels = PATTERN.steps.map((s, i) => ({
    id: `e${i}`, text: `${i + 1}. ${s.label}`, source: s.from, target: s.to, sourceHandle: edges[i].sourceHandle, targetHandle: edges[i].targetHandle,
    active: stepper.step === i, dim: stepper.step >= 0 && !(i <= stepper.step), prefer: offs[i],
  }));
  const actions = useMemo(() => ({
    open: (id) => setOpen(id), close: () => setOpen(null),
    link: (id) => { const u = new URL(window.location.href); u.searchParams.set("box", id); return u.toString(); },
  }), [setOpen]);
  return (
    <div ref={ref} className="wlab-canvas" data-testid="wlab-canvas">
      <PassportActions.Provider value={actions}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={FIT} nodesConnectable={false} minZoom={0.3}
          onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : n.id))} onPaneClick={() => setOpen(null)}
          onNodeDragStop={(_, n) => onMove(n.id, n.position)} onNodeDrag={(_, n) => onMove(n.id, n.position)} proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={18} />
          <Controls showInteractive={false} />
          <EdgeLabels items={labels} pointFor={(box, handle) => sidePoint(box, String(handle).split("-")[1])} fallback={{ w: 170, h: 56 }} />
          <FitOpen open={open} closePadding={FIT.padding} />
        </ReactFlow>
      </PassportActions.Provider>
    </div>
  );
}

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
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [present, setPresent] = useState(false);
  const [talkTrack, setTalkTrack] = useState(false);
  const [theme, setTheme] = useState('auto');
  const [fontSize, setFontSize] = useState('M');
  const [mode, setMode] = useState('mock');
  const [open, setOpen] = useState(() => { const box = new URLSearchParams(window.location.search).get("box"); return box && PATTERN.nodes.some((n) => n.id === box) ? box : null; });
  const [positions, setPositions] = useState(initialPositions);
  const stepper = useDiagramStepper(PATTERN.steps.length);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
    fetch('/api/info').then((r) => r.json()).then((i) => { setInfo(i); setMode(i.source); }).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const switchMode = async (next) => {
    const r = await fetch('/api/mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: next }),
    });
    if (r.ok) {
      setMode(next);
      const i = await (await fetch('/api/info')).json();
      setInfo(i);
    }
  };

  const runChain = async () => {
    setBusy(true);
    setResult(null);
    stepper.simulate();
    try {
      const wit = await (await fetch('/api/mint/wit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workloadId: 'wimse://corp.example.com/gateway' }),
      })).json();
      const txn = await (await fetch('/api/mint/txn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub: 'alice@example.com', tenant: 'demo' }),
      })).json();
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

  const reset = useCallback(() => {
    stepper.stop();
    setPositions(initialPositions);
    setResult(null);
    setTimeout(() => window.dispatchEvent(new Event(REFIT_EVENT)), 0);
  }, [stepper.stop]);

  const step = stepper.step >= 0 ? PATTERN.steps[stepper.step] : null;

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
      {present && (
        <section className="card result">
          <h2>{PATTERN.title} (presenter mode)</h2>
          <ol>
            {PATTERN.steps.map((s, i) => <li key={i}><strong>{s.label}</strong> — {s.say}</li>)}
          </ol>
        </section>
      )}
      {talkTrack && (
        <section className="card result">
          <h2>Talk track</h2>
          <ol>
            {PATTERN.steps.map((s, i) => <li key={i}><strong>{s.label}</strong> — {s.say}</li>)}
          </ol>
        </section>
      )}

      <section className="cards">
        <div className="card">
          <h2><span className="step-num" aria-hidden="true">1</span>Chain</h2>
          <p>Issuer mints a Workload Identity Token (WIT) for the gateway. A context service mints a Txn-Token for Alice. Every hop presents WIT + WPT (Workload Proof Token) + Txn-Token; the WPT&apos;s wth/tth claims cryptographically bind them together. Click any box for its details.</p>
          <DiagramStepBar stepper={stepper} caption={step ? step.label : ""} testId="wlab-step-bar" />
          {step && (
            <article className="track__now" data-testid="wlab-now">
              <h3>Step {stepper.step + 1}: {step.label}</h3>
              <p>{step.say}</p>
            </article>
          )}
          <ReactFlowProvider>
            <Canvas positions={positions} onMove={(id, p) => setPositions((cur) => ({ ...cur, [id]: { x: p.x, y: p.y } }))} stepper={stepper} open={open} setOpen={setOpen} />
          </ReactFlowProvider>
          <div className="controls">
            <button className="primary" onClick={runChain} disabled={busy}>Run chain</button>
            <button onClick={reset} disabled={busy}>Reset</button>
          </div>
        </div>

        <div className="card">
          <h2><span className="step-num" aria-hidden="true">2</span>Break it</h2>
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
        <h2><span className="step-num" aria-hidden="true">3</span>Result</h2>
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
