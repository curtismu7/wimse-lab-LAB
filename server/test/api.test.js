import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('wimse-lab API', () => {
  let app;
  beforeEach(() => { app = createApp(); });

  it('health returns demo-health/1', async () => {
    const r = await request(app).get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.health, 'demo-health/1');
    assert.equal(r.body.catalogId, 'D137');
  });

  it('mints a WIT for a valid workload id and refuses foreign domains', async () => {
    const ok = await request(app).post('/api/mint/wit').send({ workloadId: 'wimse://corp.example.com/orders' });
    assert.equal(ok.status, 200);
    const bad = await request(app).post('/api/mint/wit').send({ workloadId: 'wimse://rogue.example.com/orders' });
    assert.equal(bad.status, 400);
  });

  it('a clean hop succeeds with decoded wit, wpt and txn', async () => {
    const wit = (await request(app).post('/api/mint/wit').send({ workloadId: 'wimse://corp.example.com/gateway' })).body;
    const txn = (await request(app).post('/api/mint/txn').send({ sub: 'alice@example.com' })).body;
    const r = await request(app).post('/api/hop').send({
      callerWorkloadId: 'wimse://corp.example.com/gateway',
      targetWorkloadId: 'wimse://corp.example.com/orders',
      targetUri: 'https://orders.example.com/api',
      witString: wit.witString,
      txnString: txn.txnString,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.valid, true);
    assert.equal(r.body.wit.payload.sub, 'wimse://corp.example.com/gateway');
    assert.equal(r.body.wpt.header.typ, 'wpt+jwt');
    assert.equal(r.body.txn.payload.sub, 'alice@example.com');
  });

  it('hop refuses an expired WIT with 401 and a named failure', async () => {
    const wit = (await request(app).post('/api/mint/wit').send({ workloadId: 'wimse://corp.example.com/gateway', ttlSec: 1 })).body;
    await new Promise((r) => setTimeout(r, 1100));
    const r = await request(app).post('/api/hop').send({
      callerWorkloadId: 'wimse://corp.example.com/gateway',
      targetWorkloadId: 'wimse://corp.example.com/orders',
      targetUri: 'https://orders.example.com/api',
      witString: wit.witString,
    });
    assert.equal(r.status, 401);
    assert.ok(r.body.failures.some((f) => f.includes('expired')));
  });

  it('attack wrong-aud is refused', async () => {
    const r = await request(app).post('/api/attack').send({ kind: 'wrong-aud' });
    assert.equal(r.status, 200);
    assert.equal(r.body.valid, false);
    assert.ok(r.body.failures.join(' ').includes('aud mismatch'));
  });

  it('attack swap-txn is refused via tth binding', async () => {
    const r = await request(app).post('/api/attack').send({ kind: 'swap-txn' });
    assert.equal(r.body.valid, false);
    assert.ok(r.body.failures.join(' ').includes('tth'));
  });

  it('attack swap-wit is refused via wth binding', async () => {
    const r = await request(app).post('/api/attack').send({ kind: 'swap-wit' });
    assert.equal(r.body.valid, false);
    assert.ok(r.body.failures.join(' ').includes('wth'));
  });

  it('attack untrusted-domain is refused by trust domain mapping', async () => {
    const r = await request(app).post('/api/attack').send({ kind: 'untrusted-domain' });
    assert.equal(r.body.valid, false);
    assert.ok(r.body.failures.join(' ').includes('trust domain mismatch'));
  });

  it('unknown attack kind is a 400 with a message', async () => {
    const r = await request(app).post('/api/attack').send({ kind: 'nope' });
    assert.equal(r.status, 400);
    assert.ok(r.body.message);
  });
});
