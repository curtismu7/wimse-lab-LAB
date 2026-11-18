# WIMSE Lab — talk track

1. **The problem**: microservices and agents call each other machine-to-machine. Bearer tokens get stolen and replayed. WIMSE (IETF) defines how a *workload* proves who it is on every hop.
2. **Trust domain** — the administrative scope. Our issuer is authorized for `corp.example.com` only. A credential whose `wimse://` identifier names another domain is refused even if our own key signed it.
3. **WIT** — who the workload is: `sub: wimse://corp.example.com/orders`, plus a `cnf.jwk` confirmation key. A WIT is never a bearer token.
4. **WPT** — the per-request proof: `Authorization: WPT <jwt>`. Its claims bind everything together: `aud` = exact target URI, `exp` = seconds, `jti` = replay protection, `wth` = hash of the WIT, `tth` = hash of the user-context Txn-Token.
5. **Run the chain** — gateway → orders → billing. Every hop: WIT + WPT + Txn-Token, all validated.
6. **Break it** — wrong audience refused (aud mismatch), swapped user context refused (tth), swapped workload identity refused (wth), expired refused, rogue domain refused by trust-domain mapping.
7. **Takeaway** — identity is verified hop by hop and cryptographically bound to the request: steal a token and it is useless elsewhere.

Compare with workload-cert-lab (the X.509/mTLS variant) and workload-identity-lab (the Privilege gateway variant).
