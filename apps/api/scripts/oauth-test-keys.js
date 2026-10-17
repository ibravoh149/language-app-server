#!/usr/bin/env node
/**
 * Dev-only helper for testing Apple/Google sign-in without real accounts.
 *
 *   node scripts/oauth-test-keys.js init <dir>
 *       Creates an RS256 key pair: <dir>/jwks.json (serve it, then start the API
 *       with OAUTH_TEST_JWKS_URL pointing at it) and <dir>/private.json.
 *   node scripts/oauth-test-keys.js token <dir> <google|apple> <audience> <sub> <email|-> [verified=true] [expiresIn=10m]
 *       Prints a signed ID token with the real provider issuer.
 *
 * OAUTH_TEST_JWKS_URL is ignored when NODE_ENV=production.
 */
const fs = require('fs');
const path = require('path');
const { exportJWK, generateKeyPair, importJWK, SignJWT } = require('jose');

const ISSUERS = { google: 'https://accounts.google.com', apple: 'https://appleid.apple.com' };

async function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = `test-${Date.now()}`;
  const pub = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  const priv = { ...(await exportJWK(privateKey)), kid, alg: 'RS256' };
  fs.writeFileSync(path.join(dir, 'jwks.json'), JSON.stringify({ keys: [pub] }));
  fs.writeFileSync(path.join(dir, 'private.json'), JSON.stringify(priv));
  console.log(path.join(dir, 'jwks.json'));
}

async function token(dir, provider, audience, sub, email, verified = 'true', expiresIn = '10m') {
  const priv = JSON.parse(fs.readFileSync(path.join(dir, 'private.json'), 'utf8'));
  const key = await importJWK(priv, 'RS256');
  const claims = {};
  if (email !== '-') {
    claims.email = email;
    // Apple sends the flag as a string, Google as a boolean.
    claims.email_verified = provider === 'apple' ? verified : verified === 'true';
  }
  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: priv.kid })
    .setIssuer(ISSUERS[provider])
    .setAudience(audience)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
  console.log(jwt);
}

const [cmd, ...args] = process.argv.slice(2);
const run = cmd === 'init' ? init(...args) : cmd === 'token' ? token(...args) : Promise.reject(new Error('usage: init <dir> | token ...'));
run.catch((error) => {
  console.error(error.message);
  process.exit(1);
});
