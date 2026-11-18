import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  mintWit, mintWpt, mintTxnToken, validateWit, validateWpt, decodeJwt,
} from './wimse.js';
import { getMode, setMode, realAvailable, REAL_HINT } from './mode.js';
import { install as installNetguard, assertMockZeroOutbound } from './netguard.js';
import { diagram as studioDiagram } from '../../scripts/diagram-data.mjs';

const TRUST_DOMAIN = 'corp.example.com';
const ISSUER = { issuer: 'https://issuer.example.com', trustDomain: TRUST_DOMAIN };
const SIGNING_KEY = 'mock-issuer-signing-key';
const WORKSPACE_ID = 'default';

const CAST = {
  trustDomain: TRUST_DOMAIN,
  issuer: ISSUER.issuer,
  witSub: `wimse://${TRUST_DOMAIN}/orders`,
  user: 'alice@example.com',
  gateway: `wimse://${TRUST_DOMAIN}/gateway`,
  orders: `wimse://${TRUST_DOMAIN}/orders`,
  billing: `wimse://${TRUST_DOMAIN}/billing`,
};

const HOPS = [
  { id: 'gateway', name: 'Gateway', workloadId: CAST.gateway },
  { id: 'orders', name: 'Orders service', workloadId: CAST.orders },
  { id: 'billing', name: 'Billing service', workloadId: CAST.billing },
];

const STORY = {
  id: 'wimse-chain',
  title: 'The WIMSE chain',
  steps: [
    'The issuer at {{cast.issuer}} mints a WIT for {{cast.gateway}} in trust domain {{cast.trustDomain}}.',
    'The context service mints a Txn-Token for {{cast.user}}.',
    '{{cast.gateway}} calls {{cast.orders}}: WIT + WPT (aud=https://orders.example.com/api, wth, tth) + Txn-Token.',
    '{{cast.orders}} verifies, then calls {{cast.billing}} the same way.',
    'Steal any single token and it is useless elsewhere: the WPT binds audience, WIT and context together.',
  ],
};

export function createApp() {
  installNetguard();
  const app = express();
  app.use(express.json());
  const replayCache = new Set();

  app.get('/api/health', (_req, res) => {
    const outbound = assertMockZeroOutbound();
    res.json({ name: 'wimse-lab', status: 'ok', demoId: 'wimse-lab', health: 'demo-health/1', catalogId: 'D137', workspaceId: WORKSPACE_ID, mockZeroOutbound: outbound.ok });
  });

  app.get('/api/info', (_req, res) => {
    res.json({ name: 'WIMSE Lab', demoId: 'wimse-lab', source: getMode(), realAvailable: realAvailable(), realHint: REAL_HINT, simulated: true, workspaceId: WORKSPACE_ID, customerConfig: { brandName: 'WIMSE Lab' } });
  });

  app.post('/api/mode', (req, res) => {
    const { source: next } = req.body || {};
    if (next === 'real' && !realAvailable()) {
      return res.status(409).json({ error: 'real_unavailable', message: REAL_HINT });
    }
    if (next !== 'mock' && next !== 'real') {
      return res.status(400).json({ error: 'invalid_source', message: 'source must be mock or real' });
    }
    setMode(next);
    res.json({ source: getMode() });
  });

  app.get('/api/story', (_req, res) => {
    const render = (s) => s.replace(/\{\{cast\.(\w+)\}\}/g, (_m, k) => CAST[k] ?? '');
    res.json({
      ...STORY,
      steps: STORY.steps.map(render),
      cast: CAST,
      presenter: true,
      diagram: studioDiagram,
    });
  });

  app.get('/api/diagram', (_req, res) => {
    res.json(studioDiagram);
  });

  app.post('/api/reset', (_req, res) => {
    replayCache.clear();
    res.json({ ok: true });
  });

  // Mint credentials for a workload (step 1 of the flow)
  app.post('/api/mint/wit', (req, res) => {
    const { workloadId, ttlSec } = req.body || {};
    if (!workloadId || !String(workloadId).startsWith(`wimse://${TRUST_DOMAIN}/`)) {
      return res.status(400).json({ error: 'invalid_workload_id', message: `workloadId must be wimse://${TRUST_DOMAIN}/<path>` });
    }
    const wit = mintWit({ workloadId, issuer: ISSUER.issuer, signingKey: SIGNING_KEY, ttlSec: Number(ttlSec) || 300 });
    res.json({ ...wit, witString: wit.token, issuer: ISSUER.issuer, trustDomain: TRUST_DOMAIN });
  });

  app.post('/api/mint/txn', (req, res) => {
    const { sub, tenant } = req.body || {};
    if (!sub) return res.status(400).json({ error: 'missing_sub', message: 'sub (end-user) is required' });
    const txn = mintTxnToken({ sub, tenant: tenant || 'demo', signingKey: SIGNING_KEY });
    res.json({ ...txn, txnString: txn.token });
  });

  // Simulate one hop: caller sends WIT + WPT (+ optional txn) to a target
  app.post('/api/hop', (req, res) => {
    const { callerWorkloadId, targetWorkloadId, targetUri, witString, txnString, attack } = req.body || {};
    if (!witString) return res.status(400).json({ error: 'missing_wit', message: 'witString is required' });

    const witCheck = validateWit({ witString, trustedIssuers: [ISSUER] });
    if (!witCheck.valid) {
      return res.status(401).json({ stage: 'wit', valid: false, failures: witCheck.failures });
    }

    // The callee mints a WPT binding the WIT and context, as the caller would
    let wpt = mintWpt({ targetUri, wit: {}, witString, signingKey: SIGNING_KEY, txnToken: txnString });
    if (attack === 'replay') {
      wpt = { ...wpt, token: (req.body.wptString) || wpt.token };
    }
    if (attack === 'wrong-aud') {
      const bad = mintWpt({ targetUri: 'https://billing.example.com/other', wit: {}, witString, signingKey: SIGNING_KEY });
      wpt = bad;
    }

    const wptCheck = validateWpt({ wptString: wpt.token, witString, targetUri, txnToken: txnString });
    if (!wptCheck.valid) {
      return res.status(401).json({ stage: 'wpt', valid: false, failures: wptCheck.failures, wpt });
    }

    if (attack === 'replay-jti') {
      if (replayCache.has(wptCheck.decoded.payload.jti)) {
        return res.status(401).json({ stage: 'wpt', valid: false, failures: [`replay detected: jti ${wptCheck.decoded.payload.jti} was already seen`] });
      }
      replayCache.add(wptCheck.decoded.payload.jti);
    }

    const target = HOPS.find((h) => h.workloadId === targetWorkloadId);
    res.json({
      valid: true,
      stage: 'ok',
      from: callerWorkloadId,
      to: targetWorkloadId,
      targetUri,
      wit: decodeJwt(witString),
      wpt: decodeJwt(wpt.token),
      txn: txnString ? decodeJwt(txnString) : null,
      trustDomain: TRUST_DOMAIN,
      traceId: randomUUID(),
    });
  });

  // Break-it: run a full attack scenario and return the refusal evidence
  app.post('/api/attack', (req, res) => {    const { kind } = req.body || {};
    const wit = mintWit({ workloadId: `wimse://${TRUST_DOMAIN}/gateway`, issuer: ISSUER.issuer, signingKey: SIGNING_KEY });
    const target = 'https://orders.example.com/api';
    if (kind === 'wrong-aud') {
      const wpt = mintWpt({ targetUri: 'https://billing.example.com/steal', wit: {}, witString: wit.token, signingKey: SIGNING_KEY });
      const r = validateWpt({ wptString: wpt.token, witString: wit.token, targetUri: target });
      return res.json({ kind, valid: r.valid, failures: r.failures, wpt: decodeJwt(wpt.token) });
    }
    if (kind === 'swap-txn') {
      const txnA = mintTxnToken({ sub: 'alice@example.com', tenant: 'demo', signingKey: SIGNING_KEY });
      const txnB = mintTxnToken({ sub: 'mallory@example.com', tenant: 'demo', signingKey: SIGNING_KEY });
      const wpt = mintWpt({ targetUri: target, wit: {}, witString: wit.token, signingKey: SIGNING_KEY, txnToken: txnA.token });
      const r = validateWpt({ wptString: wpt.token, witString: wit.token, targetUri: target, txnToken: txnB.token });
      return res.json({ kind, valid: r.valid, failures: r.failures, note: 'the WPT was minted over Alice\'s context; presenting Mallory\'s Txn-Token breaks the tth binding' });
    }
    if (kind === 'swap-wit') {
      const witB = mintWit({ workloadId: `wimse://${TRUST_DOMAIN}/billing`, issuer: ISSUER.issuer, signingKey: SIGNING_KEY });
      const wpt = mintWpt({ targetUri: target, wit: {}, witString: wit.token, signingKey: SIGNING_KEY });
      const r = validateWpt({ wptString: wpt.token, witString: witB.token, targetUri: target });
      return res.json({ kind, valid: r.valid, failures: r.failures, note: 'the WPT proves possession of the gateway key; pairing it with a different WIT fails wth' });
    }
    if (kind === 'expired') {
      const oldWit = mintWit({ workloadId: `wimse://${TRUST_DOMAIN}/gateway`, issuer: ISSUER.issuer, signingKey: SIGNING_KEY, now: Date.now() - 600000 });
      const r = validateWit({ witString: oldWit.token, trustedIssuers: [ISSUER] });
      return res.json({ kind, valid: r.valid, failures: r.failures });
    }
    if (kind === 'untrusted-domain') {
      const rogue = mintWit({ workloadId: 'wimse://rogue.example.com/gateway', issuer: ISSUER.issuer, signingKey: SIGNING_KEY });
      const r = validateWit({ witString: rogue.token, trustedIssuers: [ISSUER] });
      return res.json({ kind, valid: r.valid, failures: r.failures, note: 'sub names trust domain rogue.example.com; the issuer is only authorized for corp.example.com' });
    }
    return res.status(400).json({ error: 'unknown_attack', message: 'kind must be one of wrong-aud, swap-txn, swap-wit, expired, untrusted-domain' });
  });

  // Rule 23: any unreachable upstream answers structured JSON, never an HTML page or a hang.
  app.use('/api', (err, _req, res, _next) => {
    const code = err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') ? 424 : 500;
    res.status(code).json({ error: err?.code || 'internal_error', message: err?.message || 'unexpected server error' });
  });

  return app;
}
