import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { networkSettings } from '../server/runtime.mjs';
import { configureAdmin, createAuth } from '../server/auth.mjs';

test('HTTPS reverse proxy accepts the configured origin and rejects spoofed forwarding headers', () => {
  const network = networkSettings({ PUBLIC_URL: 'https://giveaway.example', HOST: '0.0.0.0' });
  assert.equal(network.host, '0.0.0.0');
  assert.equal(network.secureCookies, true);
  assert.ok(network.allowsHost('giveaway.example'));
  assert.ok(network.allowsHost('127.0.0.1:4310'));
  assert.equal(network.allowsHost('unrelated.example'), false);
  assert.ok(network.allowsOrigin({ headers: { origin: 'https://giveaway.example', host: 'giveaway.example' }, socket: {} }));
  assert.equal(network.allowsOrigin({ headers: { origin: 'https://unrelated.example', host: 'giveaway.example', 'x-forwarded-host': 'unrelated.example' }, socket: {} }), false);
  assert.equal(network.allowsOrigin({ headers: { origin: 'http://giveaway.example', host: 'giveaway.example' }, socket: {} }), false);
  assert.throws(() => networkSettings({ PUBLIC_URL: 'https://giveaway.example/path' }));
});

test('proxied HTTPS sessions have Secure cookies and logout revokes them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'giveaway-auth-'));
  try {
    await configureAdmin(dir, 'admin', 'Isolated-auth-test-901');
    const auth = await createAuth(dir, { secureCookies: true });
    const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    let cookie;
    const res = { setHeader(name, value) { cookie = value; } };
    assert.equal((await auth.login(req, res, 'admin', 'wrong')).status, 401);
    assert.equal((await auth.login(req, res, 'admin', 'Isolated-auth-test-901')).status, 200);
    assert.match(cookie, /; Secure$/);
    assert.match(cookie, /; HttpOnly; SameSite=Strict/);
    req.headers.cookie = cookie.split(';')[0];
    assert.equal(auth.session(req).username, 'admin');
    auth.logout(req, res);
    assert.equal(auth.session(req), null);
    assert.match(cookie, /Max-Age=0; Secure$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
