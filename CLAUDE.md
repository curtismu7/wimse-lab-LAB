# wimse-lab-LAB

Mock IETF WIMSE lab: trust domains, WIT (Workload Identity Token), WPT (Workload Proof Token), multi-hop chain.

- Run: `npm install && npm run build && npm start` (port 7822, loopback-only) or `docker compose up --build`.
- Tests: `npm test` (node --test, server).
- Doctor: `npm run doctor` (server must be running).
- Rules that bite: no login (mock only, banner on every page); loopback-only bind; tokens shown raw (education) but mock-issued and labelled; diagram is ReactFlow with movable boxes, Simulate, Reset, speed control; no `crypto.generateKeyPairSync('ec')`; no AI attribution anywhere.
