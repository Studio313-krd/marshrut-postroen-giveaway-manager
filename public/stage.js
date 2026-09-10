import { VIDEO, SLOT, SUMMARY_PAGE_SIZE, paintStage } from './stage-scene.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const visualRandom = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const mp4Types = ['video/mp4;codecs=avc1.420028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];

export async function openStage({ contest, draw, close, toast }) {
  if (!contest.snapshot) throw new Error('Сначала зафиксируйте список участников.');
  await document.fonts.ready;
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const stage = document.createElement('section');
  stage.className = 'stage'; stage.setAttribute('role', 'dialog'); stage.setAttribute('aria-modal', 'true'); stage.setAttribute('aria-label', 'Экран розыгрыша');
  stage.innerHTML = `<div class="stage-preview"><canvas class="stage-canvas" width="${VIDEO.width}" height="${VIDEO.height}" aria-label="Вертикальное видео розыгрыша 9:16"></canvas></div>
    <div class="stage-controls"><div class="stage-heading"><div><p>ВИДЕО ДЛЯ REELS</p><h2>Маршрут к победе</h2></div><button class="icon-btn" id="stage-close" aria-label="Закрыть розыгрыш">×</button></div>
    <p class="stage-format">1080 × 1920 · 9:16 · MP4</p>
    <p class="stage-label" id="stage-status" role="status" aria-live="polite"></p>
    <div class="stage-options"><label class="check"><input type="checkbox" id="record-choice" checked>Записывать видео</label><label class="check"><input type="checkbox" id="sound-choice" checked>Звук</label></div>
    <div class="stage-actions"><button class="btn primary" id="auto-places">Снять видео и выбрать всех</button><button class="btn light" id="next-place">Выбрать место</button><button class="btn" id="stop-record" hidden>Завершить запись</button><button class="btn primary" id="download-video" hidden>Скачать MP4</button><button class="btn" id="share-video" hidden>Поделиться видео</button></div>
    <div class="stage-secondary"><button class="btn" id="stage-fullscreen">Полный экран</button><button class="btn" id="summary-next" hidden>Следующие места</button></div>
    <p class="stage-hint" id="stage-hint" aria-live="polite">В видео попадёт только вертикальная сцена.</p></div>`;
  document.body.append(stage); document.body.style.overflow = 'hidden';
  const el = id => stage.querySelector('#' + id);
  const canvas = stage.querySelector('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  let c = contest, results = [...c.draw.results], currentWinner = results.at(-1) || null;
  const total = (c.snapshot.payload.winnerCount ?? 5) + (c.snapshot.payload.reserveCount ?? 5);
  const participants = c.snapshot.payload.participants.map(row => row.username);
  let spinning = false, auto = false, ended = false, recording = false, finalizing = false, summaryPlaying = false;
  let recorder, recordingStream, video, videoURL, videoName, audioCtx, audioDest, animation, wakeLock;
  let chunks = [], saved = false, drawState = null, summaryPage = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function paint() { if (!ended) paintStage(ctx, { contest: c, participants, results, spinning, drawState, currentWinner, summaryPage }); }
  function toolbar() {
    const done = results.length >= total, locked = spinning || auto || finalizing || summaryPlaying;
    stage.classList.toggle('is-recording', recording);
    stage.classList.toggle('is-complete', done && !spinning);
    el('next-place').disabled = locked || done;
    el('auto-places').disabled = locked || done || !!video;
    el('next-place').textContent = done ? 'Все места определены' : `Выбрать ${results.length + 1}-е место`;
    el('auto-places').textContent = results.length ? 'Снять видео и выбрать оставшихся' : 'Снять видео и выбрать всех';
    el('record-choice').disabled = recording || locked || !!video;
    el('stop-record').hidden = !recording; el('stop-record').disabled = spinning || summaryPlaying;
    el('download-video').hidden = !video;
    el('share-video').hidden = !video || !navigator.canShare?.({ files: [new File([video], videoName, { type: 'video/mp4' })] });
    el('stage-close').disabled = locked;
    el('summary-next').hidden = !done || results.length <= SUMMARY_PAGE_SIZE;
    el('summary-next').disabled = summaryPlaying || finalizing;
    el('stage-status').textContent = finalizing ? 'Готовим MP4…' : recording ? 'Идёт запись' : done ? 'Все места сохранены' : `${results.length} из ${total} мест определены`;
    el('stage-status').classList.toggle('recording', recording);
    el('stage-hint').textContent = video ? 'Сохраните MP4 перед закрытием. Видео готово для вертикального Reels.' : recording ? 'Оставьте эту вкладку открытой до завершения записи.' : 'В видео попадёт только вертикальная сцена.';
  }
  async function releaseWakeLock() { try { await wakeLock?.release(); } catch {} wakeLock = null; }
  function sound(tone = 650, length = .025) {
    if (!el('sound-choice').checked || !audioCtx) return;
    const oscillator = audioCtx.createOscillator(), gain = audioCtx.createGain();
    oscillator.frequency.value = tone; oscillator.type = 'sine';
    gain.gain.setValueAtTime(.04, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + length);
    oscillator.connect(gain); gain.connect(audioCtx.destination); if (audioDest) gain.connect(audioDest);
    oscillator.start(); oscillator.stop(audioCtx.currentTime + length);
  }
  function download() {
    if (!videoURL) return;
    const a = document.createElement('a'); a.href = videoURL; a.download = videoName;
    document.body.append(a); a.click(); a.remove(); saved = true;
    toast('MP4 готов. Проверьте файл в загрузках.');
  }
  async function startRecording() {
    if (recording) return;
    if (!el('record-choice').checked) {
      if (el('sound-choice').checked) {
        if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 48000 });
        await audioCtx.resume();
      }
      return;
    }
    if (video || finalizing) throw new Error('Сохраните видео и откройте сцену заново для следующей записи.');
    const mime = window.MediaRecorder && mp4Types.find(type => MediaRecorder.isTypeSupported(type));
    if (!mime || !canvas.captureStream) throw new Error('Запись MP4 недоступна. Откройте приложение в актуальном Chrome, Edge или Safari.');
    if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 48000 });
    if (!audioDest) audioDest = audioCtx.createMediaStreamDestination();
    await audioCtx.resume();
    recordingStream = canvas.captureStream(VIDEO.fps);
    recordingStream.addTrack(audioDest.stream.getAudioTracks()[0]);
    try {
      recorder = new MediaRecorder(recordingStream, { mimeType: mime, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 });
      chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { auto = false; toast('Ошибка записи. Выбранные места сохранены; завершите запись и скачайте видео.', true); };
      recorder.onstop = () => {
        video = new Blob(chunks, { type: 'video/mp4' }); chunks = [];
        videoName = `reels-${c.demo ? 'rehearsal-' : ''}${c.id}.mp4`;
        videoURL = URL.createObjectURL(video); recording = false; finalizing = false;
        recordingStream.getVideoTracks().forEach(track => track.stop());
        releaseWakeLock(); toolbar(); paint(); download();
      };
      recorder.start(1000); recording = true;
    } catch (error) { recordingStream.getVideoTracks().forEach(track => track.stop()); throw error; }
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    paint(); toolbar(); await wait(600);
  }
  function stopRecording() {
    if (recorder?.state === 'recording') { finalizing = true; recorder.stop(); toolbar(); }
  }
  function animate(result) {
    return new Promise(resolve => {
      const pool = participants.filter(user => !results.some(row => row.rank < result.rank && row.username === user));
      const target = 28, cards = Array.from({ length: target + 3 }, () => pool[visualRandom(pool.length)]);
      cards[target] = result.username;
      const from = SLOT.center - 2 * SLOT.pitch, to = SLOT.center - target * SLOT.pitch;
      drawState = { cards, target, offset: from, rank: result.rank };
      const started = performance.now(); let lastTick = -1;
      function frame(now) {
        if (ended) { resolve(); return; }
        const progress = Math.min(1, (now - started) / (reducedMotion ? 250 : 2600));
        drawState.offset = from + (to - from) * (1 - Math.pow(1 - progress, 4));
        const tick = Math.floor(-drawState.offset / SLOT.pitch);
        if (tick !== lastTick) { lastTick = tick; sound(650 + visualRandom(130)); }
        if (progress < 1) animation = requestAnimationFrame(frame);
        else { spinning = false; currentWinner = result; drawState.offset = to; sound(880, .25); paint(); toolbar(); resolve(); }
      }
      animation = requestAnimationFrame(frame);
    });
  }
  async function next() {
    if (spinning || results.length >= total) return;
    spinning = true; toolbar();
    try { await startRecording(); const data = await draw(results.length + 1); c = data.contest; results = [...c.draw.results]; await animate(data.result); }
    catch (error) { spinning = false; auto = false; toolbar(); toast(error.message, true); throw error; }
  }
  async function finishIfDone() {
    if (results.length !== total || !recording) return;
    summaryPlaying = true; toolbar();
    for (let page = 0; page < Math.ceil(results.length / SUMMARY_PAGE_SIZE) && !ended; page++) { summaryPage = page; paint(); await wait(4000); }
    summaryPlaying = false; if (!ended) stopRecording();
  }
  el('next-place').addEventListener('click', () => next().then(finishIfDone).catch(() => {}));
  el('auto-places').addEventListener('click', async () => {
    if (auto || spinning) return;
    el('record-choice').checked = true; auto = true;
    try { while (auto && results.length < total && !ended) { await next(); if (results.length < total) await wait(800); } await finishIfDone(); }
    catch {} finally { auto = false; toolbar(); }
  });
  el('stop-record').addEventListener('click', () => { auto = false; stopRecording(); });
  el('download-video').addEventListener('click', download);
  el('share-video').addEventListener('click', async () => {
    try { await navigator.share({ files: [new File([video], videoName, { type: 'video/mp4' })] }); saved = true; }
    catch (error) { if (error.name !== 'AbortError') toast('Не удалось поделиться. Скачайте MP4 и откройте его из файлов.', true); }
  });
  el('summary-next').addEventListener('click', () => { summaryPage = (summaryPage + 1) % Math.ceil(results.length / SUMMARY_PAGE_SIZE); paint(); });
  el('stage-fullscreen').hidden = !document.fullscreenEnabled;
  el('stage-fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); } catch { toast('Полноэкранный режим недоступен.', true); } });
  function beforeUnload(event) { if (recording || finalizing || video && !saved) { event.preventDefault(); event.returnValue = ''; } }
  window.addEventListener('beforeunload', beforeUnload);
  async function closeStage() {
    if (spinning || auto || finalizing || summaryPlaying) return;
    if (recording) { stopRecording(); return; }
    if (video && !saved) { download(); return; }
    ended = true; cancelAnimationFrame(animation); clearInterval(paintTimer);
    window.removeEventListener('beforeunload', beforeUnload); await releaseWakeLock();
    if (document.fullscreenElement === stage) await document.exitFullscreen();
    if (audioCtx) await audioCtx.close(); if (videoURL) URL.revokeObjectURL(videoURL);
    stage.remove(); document.body.style.overflow = previousOverflow; await close();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  el('stage-close').addEventListener('click', closeStage);
  stage.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeStage(); }
    if (event.key !== 'Tab') return;
    const buttons = [...stage.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(node => !node.hidden && node.getClientRects().length);
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  if (currentWinner) drawState = { cards: [currentWinner.username], target: 0, offset: SLOT.center, rank: currentWinner.rank };
  const paintTimer = setInterval(paint, 1000 / VIDEO.fps);
  toolbar(); paint(); el('auto-places').focus();
}
