import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mintWit, mintWpt, mintTxnToken, validateWit, validateWpt, decodeJwt,
} from '../src/wimse.js';

const ISSUER = { issuer: 'https://issuer.example.com', trustDomain: 'corp.example.com' };
const witResult = mintWit({ workloadId: 'wimse://corp.example.com/orders', issuer: ISSUER.issuer, signingKey: 'k1' });

describe('WIT', () => {
  it('mints a WIT with sub, cnf.jwk and typ wit+jwt', () => {
    const d = decodeJwt(witResult.token);
    assert.equal(d.header.typ, 'wit+jwt');
    assert.equal(d.payload.sub, 'wimse://corp.example.com/orders');
    assert.equal(d.payload.cnf.jwk.alg, 'EdDSA');
    assert.ok(d.payload.exp > d.payload.iat);
  });

  it('validates a good WIT', () => {
    const r = validateWit({ witString: witResult.token, trustedIssuers: [ISSUER] });
    assert.equal(r.valid, true, r.failures?.join('; '));
  });

  it('rejects an untrusted issuer', () => {
    const r = validateWit({ witString: witResult.token, trustedIssuers: [{ issuer: 'https://other.example.com', trustDomain: 'corp.example.com' }] });
    assert.equal(r.valid, false);
    assert.ok(r.failures[0].includes('not trusted'));
  });

  it('rejects a trust-domain mismatch between sub and issuer authorization', () => {
    const r = validateWit({ witString: witResult.token, trustedIssuers: [{ issuer: ISSUER.issuer, trustDomain: 'other.example.com' }] });
    assert.equal(r.valid, false);
    assert.ok(r.failures.some((f) => f.includes('trust domain mismatch')));
  });

  it('rejects an expired WIT', () => {
    const expired = mintWit({ workloadId: 'wimse://corp.example.com/orders', issuer: ISSUER.issuer, signingKey: 'k1', now: Date.now() - 400000 });
    const r = validateWit({ witString: expired.token, trustedIssuers: [ISSUER] });
    assert.equal(r.valid, false);
    assert.ok(r.failures.some((f) => f.includes('expired')));
  });

  it('rejects a WIT without cnf (bearer use)', () => {
    const noCnf = mintWit({ workloadId: 'wimse://corp.example.com/orders', issuer: ISSUER.issuer, signingKey: 'k1' });
    const d = decodeJwt(noCnf.token);
    delete d.payload.cnf;
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'issuer-key-1', typ: 'wit+jwt' })).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(d.payload)).toString('base64url');
    const bad = `${headerB64}.${payloadB64}.sig`;
    const r = validateWit({ witString: bad, trustedIssuers: [ISSUER] });
    assert.equal(r.valid, false);
    assert.ok(r.failures.some((f) => f.includes('cnf')));
  });
});

describe('WPT', () => {
  const txn = mintTxnToken({ sub: 'alice@example.com', tenant: 't1', signingKey: 'k1' });
  const target = 'https://orders.example.com/api';
  const wpt = mintWpt({ targetUri: target, wit: witResult, witString: witResult.token, signingKey: 'k1', txnToken: txn.token });

  it('binds wth to the WIT and tth to the Txn-Token', () => {
    const d = decodeJwt(wpt.token);
    assert.equal(d.header.typ, 'wpt+jwt');
    assert.ok(d.payload.wth);
    assert.ok(d.payload.tth);
    assert.equal(d.payload.aud, target);
  });

  it('validates a good WPT+WIT+txn triple', () => {
    const r = validateWpt({ wptString: wpt.token, witString: witResult.token, targetUri: target, txnToken: txn.token });
    assert.equal(r.valid, true, r.failures?.join('; '));
  });

  it('rejects a replayed WPT against a different target URI', () => {
    const r = validateWpt({ wptString: wpt.token, witString: witResult.token, targetUri: 'https://billing.example.com/api', txnToken: txn.token });
    assert.equal(r.valid, false);
    assert.ok(r.failures.some((f) => f.includes('aud mismatch')));
  });

  it('rejects a swapped WIT (wth mismatch)', () => {
    const otherWit = mintWit({ workloadId: 'wimse://corp.example.com/billing', issuer: ISSUER.issuer, signingKey: 'k1' });
    const r = validateWpt({ wptString: wpt.token, witString: otherWit.token, targetUri: target, txnToken: txn.token });
    assert.equal(r.valid, false);
    assert.ok(r.failures.some((f) => f.includes('wth')));
  });

  it('rejects a swapped Txn-Token (tth mismatch)', () => {
    const otherTxn = mintTxnToken({ sub: 'mallory@example.com', tenant: 't1', signingKey: 'k1' });
    const r = validateWpt({ wptString: wpt.token, witString: witResult.token, targetUri: target, txnToken: otherTxn.token });
    assert.equal(r.valid, false);
    assert.ok(r.failures.some((f) => f.includes('tth')));
  });

  it('rejects an expired WPT', () => {
    const old = mintWpt({ targetUri: target, wit: witResult, witString: witResult.token, signingKey: 'k1', txnToken: txn.token, now: Date.now() - 300000 });
    const r = validateWpt({ wptString: old.token, witString: witResult.token, targetUri: target, txnToken: txn.token });
    assert.equal(r.valid, false);
    assert.ok(r.failures.some((f) => f.includes('expired')));
  });

  it('rejects when a context token is not covered by oth', () => {
    const other = { 'x-context-token': 'abc.def.ghi' };
    const r = validateWpt({ wptString: wpt.token, witString: witResult.token, targetUri: target, otherTokens: other });
    assert.equal(r.valid, false);
    assert.ok(r.failures.some((f) => f.includes('oth')));
  });
});
