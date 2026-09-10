import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const derive = promisify(scrypt);
const ttl = 8 * 60 * 60 * 1000;
const cookieName = 'giveaway_session';

export async function configureAdmin(directory, username, password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Admin password must be at least 12 characters');
  await mkdir(directory, { recursive: true });
  const salt = randomBytes(32).toString('hex');
  const hash = (await derive(password, salt, 64)).toString('hex');
  await writeFile(join(directory, 'auth.json'), JSON.stringify({ username, salt, hash }, null, 2), { flag: 'wx', mode: 0o600 });
}

export async function createAuth(directory, { secureCookies = false } = {}) {
  let credentials;
  try { credentials = JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (process.env.GIVEAWAY_ADMIN_PASSWORD) {
      await configureAdmin(directory, 'admin', process.env.GIVEAWAY_ADMIN_PASSWORD);
      credentials = JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8'));
    }
  }
  const sessions = new Map();
  const failures = new Map();
  const tokenFrom = req => /(?:^|;\s*)giveaway_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const key = token => createHash('sha256').update(token).digest('hex');
  const cookie = (req, value, age) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies || req.socket.encrypted ? '; Secure' : ''}`;
  function session(req) {
    const token = tokenFrom(req);
    if (!token) return null;
    const stored = sessions.get(key(token));
    if (!stored || stored.expires <= Date.now()) { sessions.delete(key(token)); return null; }
    return { username: stored.username };
  }
  async function login(req, res, username, password) {
    if (!credentials) return { status: 503, error: 'Вход ещё не настроен на сервере' };
    const ip = req.socket.remoteAddress;
    const previous = failures.get(ip);
    if (previous && previous.until > Date.now() && previous.count >= 8) return { status: 429, error: 'Слишком много попыток — повторите вход через 15 минут' };
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 256 || username.length > 64) return { status: 400, error: 'Введите логин и пароль' };
    const hash = await derive(password, credentials.salt, 64);
    const validPassword = timingSafeEqual(hash, Buffer.from(credentials.hash, 'hex'));
    if (username !== credentials.username || !validPassword) {
      const record = previous?.until > Date.now() ? previous : { count: 0, until: Date.now() + 15 * 60_000 };
      record.count++; failures.set(ip, record);
      return { status: 401, error: 'Неверный логин или пароль' };
    }
    failures.delete(ip);
    for (const [id, value] of sessions) if (value.expires <= Date.now()) sessions.delete(id);
    const old = tokenFrom(req); if (old) sessions.delete(key(old));
    const token = randomBytes(32).toString('hex');
    sessions.set(key(token), { username: credentials.username, expires: Date.now() + ttl });
    res.setHeader('Set-Cookie', cookie(req, token, ttl / 1000));
    return { status: 200, username: credentials.username };
  }
  function logout(req, res) {
    const token = tokenFrom(req); if (token) sessions.delete(key(token));
    res.setHeader('Set-Cookie', cookie(req, '', 0));
  }
  return { session, login, logout, ready: !!credentials };
}
