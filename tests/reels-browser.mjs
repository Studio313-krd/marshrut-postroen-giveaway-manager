import { chromium, devices } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { commentsWorkbook } from '../server/excel.js';
import { openXmlWorkbook } from './helpers/openxml.js';

mkdirSync('data', { recursive: true }); mkdirSync('artifacts', { recursive: true });
const dir = mkdtempSync(resolve('data', 'reels-test-')), port = 14314, base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_URL: base, CONTEST_DATA_DIR: dir, NODE_ENV: 'test', AUTH_DISABLED: 'true' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', browser;
child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
try {
  let session;
  for (let i = 0; i < 100; i++) { try { session = await (await fetch(base + '/api/session')).json(); break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert(session, logs);
  const request = async (path, body) => {
    const response = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); assert(response.ok, data.error); return data;
  };
  const rows = Array.from({ length: 15 }, (_, i) => ({ username: i === 0 ? 'w'.repeat(30) : 'reels_guest_' + i, text: 'Exact source comment @friend ❤️ ' + i }));
  let c = await request('/contests', { filename: 'PRIVATE-SOURCE-NAME.xlsx', base64: (await commentsWorkbook(rows)).toString('base64') });
  await request(`/contests/${c.id}/prompt`, { conditions: 'Техническая репетиция на вымышленных участниках.' });
  await request(`/contests/${c.id}/selection`, { filename: 'selection.xlsx', base64: (await openXmlWorkbook(rows)).toString('base64') });
  const patched = await fetch(base + `/api/contests/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }, body: JSON.stringify({ name: 'Репетиция · вертикальный розыгрыш', winnerCount: 5, reserveCount: 1 }) });
  assert(patched.ok); c = await request(`/contests/${c.id}/freeze`, { acknowledged: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async ({ contest, csrf }) => {
    const { openStage } = await import('/stage.js');
    window.stageMessages = []; window.drawRequests = 0;
    await openStage({ contest, draw: async expectedRank => {
      window.drawRequests++;
      const response = await fetch(`/api/contests/${contest.id}/draw`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ expectedRank }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
    }, toast: message => window.stageMessages.push(message), close: () => {} });
  }, { contest: c, csrf: session.csrf });
  for (const [width, height] of [[320, 568], [390, 844], [430, 932], [768, 1024], [844, 390], [1440, 1000]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const stage = document.querySelector('.stage'), canvas = stage.querySelector('canvas');
      const box = canvas.getBoundingClientRect();
      const targets = [...stage.querySelectorAll('button')].filter(node => !node.disabled && node.getClientRects().length).map(node => ({ id: node.id, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
      return { width: innerWidth, scrollWidth: stage.scrollWidth, canvas: { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: canvas.width, height: canvas.height }, targets };
    });
    assert(layout.scrollWidth <= width + 1, JSON.stringify(layout));
    assert(layout.canvas.x >= 0 && layout.canvas.right <= width + 1, JSON.stringify(layout));
    assert(layout.canvas.bottom <= height + 1, JSON.stringify(layout));
    assert.deepEqual([layout.canvas.width, layout.canvas.height], [1080, 1920]);
    for (const target of layout.targets) assert(target.width >= 44 && target.height >= 44, JSON.stringify(target));
    await page.screenshot({ path: `artifacts/reels-stage-${width}x${height}.png` });
  }
  // Measure the actual loaded fonts, including the maximum account length.
  const textChecks = await page.evaluate(async contest => {
    const { paintStage, SAFE } = await import('/stage-scene.js');
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext('2d'), calls = [], original = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y) => {
      const metrics = ctx.measureText(text), left = x - (ctx.textAlign === 'center' ? metrics.width / 2 : ctx.textAlign === 'right' ? metrics.width : 0);
      calls.push({ text, left, right: left + metrics.width, top: y - metrics.actualBoundingBoxAscent, bottom: y + metrics.actualBoundingBoxDescent }); original(text, x, y);
    };
    const participants = contest.snapshot.payload.participants.map(row => row.username);
    const results = participants.slice(0, 6).map((username, index) => ({ username, rank: index + 1, group: index < 5 ? 'primary' : 'reserve' }));
    for (const summaryPage of [0, 1]) paintStage(ctx, { contest, participants, results, spinning: false, currentWinner: results.at(-1), summaryPage });
    paintStage(ctx, { contest, participants, results: [], spinning: false, currentWinner: null });
    return { safe: SAFE, calls };
  }, c);
  for (const item of textChecks.calls) {
    assert(!/PRIVATE-SOURCE|\.xlsx|SHA-256|ЗАФИКСИРОВАН/i.test(item.text), item.text);
    assert(item.left >= textChecks.safe.left - 1 && item.right <= textChecks.safe.right + 1, JSON.stringify(item));
    assert(item.top >= textChecks.safe.top - 1 && item.bottom <= textChecks.safe.bottom + 1, JSON.stringify(item));
  }
  assert(textChecks.calls.some(item => item.text === '@' + 'w'.repeat(30)));
  assert(textChecks.calls.some(item => item.text === '@reels_guest_5'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.realTypeCheck = MediaRecorder.isTypeSupported; MediaRecorder.isTypeSupported = () => false; });
  await page.locator('#next-place').click();
  await page.waitForFunction(() => window.stageMessages.some(message => message.includes('MP4 недоступна')));
  assert.equal(await page.evaluate(() => window.drawRequests), 0, 'Recording must be validated before choosing anyone');
  await page.evaluate(() => { MediaRecorder.isTypeSupported = window.realTypeCheck; });
  const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
  await page.locator('#auto-places').click();
  await page.waitForTimeout(1400); await page.screenshot({ path: 'artifacts/reels-mobile-recording.png' });
  const download = await downloadPromise; assert.match(download.suggestedFilename(), /\.mp4$/);
  await download.saveAs('artifacts/reels-mobile-test.mp4');
  await page.screenshot({ path: 'artifacts/reels-mobile-complete.png' });
  await page.locator('#summary-next').click();
  await page.locator('#stage-close').click();
  assert.equal(await page.locator('.stage').count(), 0);
  const finished = await request(`/contests/${c.id}`); assert.equal(finished.draw.results.length, 6); assert.equal(new Set(finished.draw.results.map(row => row.username)).size, 6);
  assert.deepEqual(errors, []);
  const media = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,pix_fmt,sample_rate,avg_frame_rate', '-show_entries', 'format=duration', '-of', 'json', 'artifacts/reels-mobile-test.mp4'], { encoding: 'utf8', windowsHide: true }));
  const video = media.streams.find(stream => stream.codec_type === 'video'), audio = media.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(video.codec_name, 'h264'); assert.equal(video.width, 1080); assert.equal(video.height, 1920); assert.equal(video.pix_fmt, 'yuv420p'); assert.equal(audio.codec_name, 'aac'); assert.equal(audio.sample_rate, '48000');
  const [frames, seconds] = video.avg_frame_rate.split('/').map(Number); assert(frames / seconds >= 23 && frames / seconds <= 60, JSON.stringify(video));
  writeFileSync('artifacts/reels-checks.json', JSON.stringify({ passed: true, viewportCount: 6, places: 6, textSafe: true, noFilename: true, media, errors }, null, 2));
  console.log('Reels passed: 6 viewports, touch targets, long accounts, safe text, two summary pages, MP4 H.264/AAC, 1080x1920, no duplicate draws.');
} finally { await browser?.close(); child.kill(); }
