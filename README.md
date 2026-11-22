# WIMSE Lab

Tier: Demo. Catalog D137, port 7822.

A mock, fully offline lab for the IETF **WIMSE** (Workload Identity in Multi System Environments) architecture — `draft-ietf-wimse-arch-09` and the Workload Proof Token `draft-ietf-wimse-wpt-02`.

## What it shows

- **Trust domains**: an issuer is authorized for exactly one domain (`corp.example.com`); a `wimse://` identifier naming a different domain is refused even when signed by the same key.
- **Workload Identity Token (WIT)**: a JWT with `sub: wimse://trust-domain/workload`, a `cnf.jwk` confirmation claim (never bearer), short `exp`.
- **Workload Proof Token (WPT)**: a per-request JWT with `aud` (target URI), `exp`, `jti` (replay), `wth` (hash of the WIT) and `tth` (hash of the Txn-Token). Sent as `Authorization: WPT <token>`, with the WIT in `Workload-Identity-Token`.
- **Multi-hop chain**: Gateway → Orders → Billing, every hop presenting WIT + WPT + Txn-Token.
- **Break it**: wrong audience, swapped Txn-Token (tth), swapped WIT (wth), expired WIT, rogue trust domain.

## Run

### Postman

`postman/wimse-lab.postman_collection.json` drives the token flow without the UI: mint a WIT (with the traversal-path negative), chain a Txn-Token from it, validate the hop binding (tth), and run the attack suite (swap-txn, expired, unknown-kind negative). Tokens chain via collection variables; no environment needed — the keys are in-process and labelled.

```
node ../../shared/postman/generator.mjs --spec postman/spec.json            # regenerate (never hand-edit the output)
npx newman run postman/wimse-lab.postman_collection.json
```

```bash
npm install && npm run build && npm start   # http://127.0.0.1:7822
# or
docker compose up --build
```

- Tests: `npm test` (node --test, server)
- Doctor: `npm run doctor` (server must be running)
- Reset: `npm run reset`

## Honesty

Everything here is a simulation: tokens are mock-signed (labelled), the issuer is in-process, there are no real outbound calls and no login. Tokens are shown raw for education.

Docs: `docs/talk-track.md`.
