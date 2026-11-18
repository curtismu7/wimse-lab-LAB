import { createHash, randomBytes } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const b64urlJson = (obj) => b64url(JSON.stringify(obj));
const sha256b64 = (s) => b64url(createHash('sha256').update(s, 'ascii').digest());

export function decodeJwt(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()),
      payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()),
      signature: parts[2],
    };
  } catch {
    return null;
  }
}

function signEs256Like(headerB64, payloadB64, key) {
  return b64url(createHash('sha256').update(`${headerB64}.${payloadB64}.${key}`, 'ascii').digest());
}

export function mintToken({ header, payload, signingKey }) {
  const headerB64 = b64urlJson(header);
  const payloadB64 = b64urlJson(payload);
  const signature = signEs256Like(headerB64, payloadB64, signingKey);
  return `${headerB64}.${payloadB64}.${signature}`;
}

export function makeJwk() {
  const k = randomBytes(32).toString('base64url');
  return { kty: 'OKP', crv: 'Ed25519', x: k, alg: 'EdDSA' };
}

export function mintWit({ workloadId, issuer, ttlSec = 300, signingKey, now = Date.now() }) {
  const jwk = makeJwk();
  const iat = Math.floor(now / 1000);
  const header = { alg: 'EdDSA', kid: 'issuer-key-1', typ: 'wit+jwt' };
  const payload = {
    sub: workloadId,
    cnf: { jwk },
    iss: issuer,
    iat,
    exp: iat + ttlSec,
    jti: randomBytes(12).toString('base64url'),
  };
  return { token: mintToken({ header, payload, signingKey }), payload, header };
}

export function mintWpt({ targetUri, wit, witString, ttlSec = 120, signingKey, txnToken, otherTokens = {}, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header = { alg: 'EdDSA', typ: 'wpt+jwt' };
  const payload = {
    aud: targetUri,
    exp: iat + ttlSec,
    jti: randomBytes(12).toString('base64url'),
    wth: sha256b64(witString),
  };
  if (txnToken) payload.tth = sha256b64(txnToken);
  if (Object.keys(otherTokens).length > 0) {
    payload.oth = {};
    for (const [name, value] of Object.entries(otherTokens)) {
      payload.oth[name.toLowerCase()] = sha256b64(String(value).trim());
    }
  }
  return { token: mintToken({ header, payload, signingKey }), payload, header };
}

export function mintTxnToken({ sub, tenant, ttlSec = 600, signingKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header = { alg: 'EdDSA', typ: 'txn+jwt' };
  const payload = { sub, tenant, iat, exp: iat + ttlSec, jti: randomBytes(12).toString('base64url') };
  return { token: mintToken({ header, payload, signingKey }), payload, header };
}

export function validateWit({ witString, trustedIssuers, now = Date.now() }) {
  const failures = [];
  const decoded = decodeJwt(witString);
  if (!decoded) return { valid: false, failures: ['malformed JWT: not three base64url segments'] };
  const { header, payload } = decoded;
  if (header.typ !== 'wit+jwt') failures.push(`typ must be wit+jwt (got ${header.typ ?? 'none'})`);
  const issuerOk = (trustedIssuers || []).some((t) => t.issuer === payload.iss);
  if (!issuerOk) failures.push(`issuer ${payload.iss} is not trusted for any configured trust domain`);
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) failures.push('token expired (exp has passed)');
  if (!payload.sub || !String(payload.sub).startsWith('wimse://')) failures.push('sub must be a wimse:// workload identifier');
  if (!payload.cnf || !payload.cnf.jwk || !payload.cnf.jwk.alg) failures.push('cnf.jwk with alg is required (WIT is never bearer)');
  const domain = payload.sub ? String(payload.sub).replace('wimse://', '').split('/')[0] : '';
  const issuerEntry = (trustedIssuers || []).find((t) => t.issuer === payload.iss);
  if (issuerEntry && issuerEntry.trustDomain !== domain) {
    failures.push(`trust domain mismatch: sub names ${domain} but issuer is authorized for ${issuerEntry.trustDomain}`);
  }
  return { valid: failures.length === 0, failures, decoded, trustDomain: domain };
}

export function validateWpt({ wptString, witString, targetUri, txnToken, otherTokens = {}, now = Date.now() }) {
  const failures = [];
  const decoded = decodeJwt(wptString);
  if (!decoded) return { valid: false, failures: ['malformed WPT: not three base64url segments'] };
  const { header, payload } = decoded;
  if (header.typ !== 'wpt+jwt') failures.push(`typ must be wpt+jwt (got ${header.typ ?? 'none'})`);
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) failures.push('WPT expired (exp has passed)');
  if (!payload.jti) failures.push('jti is required for replay protection');
  if (targetUri && payload.aud !== targetUri) failures.push(`aud mismatch: WPT is for ${payload.aud}, request targets ${targetUri}`);
  const witHash = sha256b64(witString);
  if (payload.wth !== witHash) failures.push('wth does not match the presented WIT (the WIT was swapped or the WPT was replayed against a different WIT)');
  if (txnToken && payload.tth !== sha256b64(txnToken)) failures.push('tth does not match the presented Txn-Token (context token was swapped)');
  if (Object.keys(otherTokens).length > 0) {
    if (!payload.oth) {
      failures.push('request carries context tokens but the WPT has no oth claim');
    } else {
      for (const [name, value] of Object.entries(otherTokens)) {
        const key = name.toLowerCase();
        if (!(key in payload.oth)) {
          failures.push(`oth has no entry for ${key} (tokens not covered by oth must not be used for decisions)`);
        } else if (payload.oth[key] !== sha256b64(String(value).trim())) {
          failures.push(`oth hash mismatch for ${key}`);
        }
      }
      for (const key of Object.keys(payload.oth)) {
        if (!Object.keys(otherTokens).some((n) => n.toLowerCase() === key)) {
          failures.push(`oth contains unrecognised entry ${key}: WPT must be rejected`);
        }
      }
    }
  }
  return { valid: failures.length === 0, failures, decoded };
}
