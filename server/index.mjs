import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createDrawStore } from './store.mjs';
import { createAuth } from './auth.mjs';
import { networkSettings } from './runtime.mjs';
import { createParticipantStore, parseText, MAX_EXCEL_BYTES, MAX_TEXT_BYTES } from './participants.mjs';
import { parseExcel } from './excel.mjs';
import { filmSettings, validateCounts } from '../shared/contest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5173);
const production = process.argv.includes('--production');
const network = networkSettings();
const participantsFile = resolve(root, process.env.GIVEAWAY_PARTICIPANTS_FILE || 'data/participants.json');
const config = JSON.parse(await readFile(join(root, 'data/config.json'), 'utf8'));
const stateDirectory = resolve(root, process.env.GIVEAWAY_STATE_DIR || '.local');
const outputDirectory = resolve(root, process.env.GIVEAWAY_OUTPUT_DIR || 'output');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const auth = await createAuth(stateDirectory, { secureCookies: network.secureCookies });
const participantStore = await createParticipantStore({ file: participantsFile, directory: stateDirectory });
const settingsFile = join(stateDirectory, 'settings.json');
async function getSettings(data) {
  try {
    const saved = JSON.parse(await readFile(settingsFile, 'utf8'));
    validateCounts(saved.main, saved.reserve, Number.MAX_SAFE_INTEGER);
    const main = Math.min(saved.main, data.participants.length);
    return { main, reserve: Math.min(saved.reserve, data.participants.length - main) };
  } catch (error) { if (error.code === 'ENOENT') { const main = Math.min(5, data.participants.length); return { main, reserve: Math.min(5, data.participants.length - main) }; } throw error; }
}
const settingsKey = settings => `${settings.main}-${settings.reserve}`;
const getStore = (settings, data) => createDrawStore({
  directory: stateDirectory, ...data, ...filmSettings(settings.main, settings.reserve),
  fileKey: settings.main === 5 && settings.reserve === 5 ? '' : settingsKey(settings),
});
async function readBody(req, maximum) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maximum) throw new Error('Файл или список слишком большой'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readJSON(req, maximum = 8192) { return JSON.parse((await readBody(req, maximum)).toString('utf8')); }
await mkdir(outputDirectory, { recursive: true });
const vite = production ? null : await (await import('vite')).createServer({
  root, server: { middlewareMode: true }, appType: 'spa',
});
let encoderReady = false;
try {
  const { stdout } = await promisify(execFile)(ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true });
  encoderReady = stdout.includes('libx264');
} catch { /* The UI presents an actionable error before selecting a winner. */ }
const jobs = new Map();

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
const videoName = draw => `rozygrysh-${draw.id}-v${config.renderVersion}.mp4`;
const videoUrl = draw => `/output/${videoName(draw)}`;

async function convert(input, output, duration) {
  await new Promise((resolveConversion, reject) => {
    const process = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-an',
      '-vf', `fps=${config.fps},scale=${config.width}:${config.height}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=${duration}`,
      '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-t', String(duration), '-movflags', '+faststart', output,
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let detail = '';
    process.stderr.on('data', chunk => { detail = (detail + chunk).slice(-3000); });
    const timeout = setTimeout(() => { process.kill(); reject(new Error('Video encoding timed out.')); }, Math.max(120_000, duration * 2000));
    process.on('error', error => { clearTimeout(timeout); reject(error); });
    process.on('close', code => {
      clearTimeout(timeout);
      code === 0 ? resolveConversion() : reject(new Error(`FFmpeg exited ${code}: ${detail}`));
    });
  });
}

async function serveFile(req, res, path, mime, download = false) {
  const info = await stat(path);
  const headers = { 'Content-Type': mime, 'Content-Length': info.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.split(sep).at(-1)}"`;
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (match) {
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) { res.writeHead(416); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${info.size}` });
    createReadStream(path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, headers);
    createReadStream(path).pipe(res);
  }
}

async function api(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    const ready = encoderReady && auth.ready;
    json(res, { service: 'giveaway', version: '4.1.0', ready }, ready ? 200 : 503); return;
  }
  if (req.method !== 'GET' && !network.allowsOrigin(req)) {
    json(res, { error: 'Запрос с другого сайта отклонён' }, 403); return;
  }
  if (req.method === 'GET' && pathname === '/api/auth/session') {
    const session = auth.session(req); json(res, { authenticated: !!session, username: session?.username }); return;
  }
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    let body;
    try { body = await readJSON(req); } catch { json(res, { error: 'Введите логин и пароль' }, 400); return; }
    const result = await auth.login(req, res, body.username, body.password);
    json(res, result, result.status); return;
  }
  if (!auth.session(req)) { json(res, { error: 'Войдите в аккаунт, чтобы продолжить' }, 401); return; }
  if (req.method === 'POST' && pathname === '/api/auth/logout') { auth.logout(req, res); json(res, { ok: true }); return; }
  const data = participantStore.current();
  if (req.method === 'GET' && pathname === '/api/state') {
    const settings = await getSettings(data);
    const draw = await getStore(settings, data).read();
    const hasVideo = draw && await stat(join(outputDirectory, videoName(draw))).then(() => true, () => false);
    json(res, { ...data, settings, draw, encoderReady, renderVersion: config.renderVersion, videoUrl: hasVideo ? videoUrl(draw) : null });
    return;
  }
  if (req.method !== 'POST') { json(res, { error: 'Not found' }, 404); return; }
  if (req.headers['x-film-version'] !== String(config.renderVersion)) {
    json(res, { error: 'Приложение обновлено — обновите страницу перед записью' }, 409); return;
  }
  if (pathname !== '/api/export' && req.headers['x-source-hash'] !== participantStore.current().sourceHash) {
    json(res, { error: 'Список изменился — обновите страницу перед продолжением' }, 409); return;
  }
  if (pathname === '/api/participants/text' || pathname === '/api/participants/excel') {
    try {
      let next;
      if (pathname.endsWith('/text')) {
        const body = await readJSON(req, MAX_TEXT_BYTES + 1024);
        next = parseText(body.text, body.isInstagram);
      } else {
        const filename = decodeURIComponent(req.headers['x-file-name'] || '');
        next = await parseExcel(await readBody(req, MAX_EXCEL_BYTES), filename);
      }
      await participantStore.replace(next, req.headers['x-source-hash']);
      json(res, { participants: next.participants.length, duplicates: next.duplicates });
    } catch (error) { json(res, { error: error.message }, error.status || 400); }
    return;
  }
  if (pathname === '/api/settings') {
    let settings;
    try { const body = await readJSON(req); settings = validateCounts(body.main, body.reserve, data.participants.length); }
    catch (error) { json(res, { error: error.message === 'Unexpected end of JSON input' ? 'Проверьте количество мест' : error.message }, 400); return; }
    await mkdir(stateDirectory, { recursive: true });
    const temporary = join(stateDirectory, `settings-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(settings));
    await rename(temporary, settingsFile);
    json(res, { settings }); return;
  }
  if (!encoderReady) { json(res, { error: 'Для сохранения MP4 установите FFmpeg и перезапустите приложение' }, 503); return; }
  const settings = await getSettings(data);
  if (pathname === '/api/draw') {
    if (req.headers['x-contest-key'] !== settingsKey(settings)) { json(res, { error: 'Настройки изменились — обновите страницу перед записью' }, 409); return; }
    json(res, await getStore(settings, data).draw()); return;
  }
  if (pathname !== '/api/export') { json(res, { error: 'Not found' }, 404); return; }
  const keyMatch = /^(\d+)-(\d+)$/.exec(req.headers['x-contest-key'] || '');
  if (!keyMatch) { json(res, { error: 'Не удалось прочитать настройки записи' }, 400); return; }
  let exportSettings;
  let exportData;
  try {
    exportData = await participantStore.read(req.headers['x-source-hash']);
    exportSettings = validateCounts(Number(keyMatch[1]), Number(keyMatch[2]), exportData.participants.length);
  }
  catch (error) { json(res, { error: error.message }, 400); return; }
  const draw = await getStore(exportSettings, exportData).read();
  if (!draw || req.headers['x-draw-id'] !== draw.id) { json(res, { error: 'Результат розыгрыша не найден — обновите страницу' }, 409); return; }
  if (!/^video\/(webm|mp4)/.test(req.headers['content-type'] || '')) { json(res, { error: 'Неподдерживаемый формат записи' }, 415); return; }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > Math.max(120 * 1024 * 1024, draw.duration * 2_000_000)) { json(res, { error: 'Запись слишком большая — повторите запись' }, 413); return; }
    chunks.push(chunk);
  }
  if (size < 1024) { json(res, { error: 'Видео не записалось — повторите запись' }, 400); return; }
  if (!jobs.has(draw.id)) {
    const job = (async () => {
      const nonce = randomUUID();
      const input = join(outputDirectory, `${nonce}.recording`);
      const temporary = join(outputDirectory, `${nonce}.mp4`);
      try {
        await writeFile(input, Buffer.concat(chunks));
        await convert(input, temporary, draw.duration);
        await rename(temporary, join(outputDirectory, videoName(draw)));
        await writeFile(join(outputDirectory, `result-${draw.id}.json`), JSON.stringify(draw, null, 2) + '\n');
      } finally {
        await rm(input, { force: true });
        await rm(temporary, { force: true });
      }
    })();
    jobs.set(draw.id, job);
  }
  try { await jobs.get(draw.id); json(res, { videoUrl: videoUrl(draw) }); }
  finally { jobs.delete(draw.id); }
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!network.allowsHost(req.headers.host)) { json(res, { error: 'Host not allowed' }, 403); return; }
    if (pathname.startsWith('/api/')) { await api(req, res, pathname); return; }
    const decodedPath = decodeURIComponent(pathname).replaceAll('\\', '/');
    if (/(?:^|\/)(?:\.local|server|tests|scripts)(?:\/|$)|auth\.json/.test(decodedPath)) { res.writeHead(403); res.end(); return; }
    const publicFile = pathname === '/' || pathname === '/login' || /^\/(?:assets\/[^/]+\.(?:js|css)|fonts\/[^/]+\.(?:ttf|txt)|favicon\.svg)$/.test(pathname);
    const devLoginFile = vite && (/^\/src\/(?:main\.ts|style\.css)$/.test(pathname) || pathname === '/@vite/client' || pathname.startsWith('/node_modules/vite/'));
    if (!publicFile && !devLoginFile && !auth.session(req)) { json(res, { error: 'Войдите в аккаунт, чтобы продолжить' }, 401); return; }
    if (/^\/output\/rozygrysh-[a-f0-9-]{36}-v\d+\.mp4$/.test(pathname)) {
      await serveFile(req, res, join(outputDirectory, pathname.split('/').at(-1)), 'video/mp4', true); return;
    }
    if (vite) { vite.middlewares(req, res); return; }
    const dist = resolve(root, 'dist');
    const requested = resolve(dist, '.' + decodeURIComponent(pathname));
    if (requested !== dist && !requested.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
    const path = extname(pathname) ? requested : join(dist, 'index.html');
    await serveFile(req, res, path, mimeTypes[extname(path)] || 'application/octet-stream');
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, { error: error.code === 'ENOENT' ? 'Файл не найден' : 'Не удалось сохранить видео — нажмите ещё раз, результаты останутся теми же' }, error.code === 'ENOENT' ? 404 : 500);
    else res.end();
  }
});
server.requestTimeout = 180_000;
server.listen(port, network.host, () => console.log(`Giveaway: port ${port}; MP4 encoder ${encoderReady ? 'ready' : 'unavailable'}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(async () => { await Promise.allSettled([...jobs.values()]); await vite?.close(); process.exit(); });
});
