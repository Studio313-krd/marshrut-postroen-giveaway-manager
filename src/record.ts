import { FilmRenderer } from './film';

export function recordingType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4;codecs=avc1.42E028', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
}

export async function recordFilm(renderer: FilmRenderer, onProgress: (time: number) => void, reducedMotion: boolean): Promise<Blob> {
  const mimeType = recordingType();
  if (!mimeType) throw new Error('Для записи видео откройте приложение в Chrome или Edge на компьютере');
  const canvas = renderer.canvas;
  renderer.frame(0);
  const stream = canvas.captureStream(renderer.settings.fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  let raf = 0;
  let wakeLock: WakeLockSentinel | undefined;
  let lastTime = -1;
  let stopped = false;

  try {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Optional on unsupported platforms. */ }
    return await new Promise<Blob>((resolve, reject) => {
      let failure: Error | undefined;
      const finish = (error?: Error) => {
        if (stopped) return;
        stopped = true; failure = error;
        cancelAnimationFrame(raf);
        if (recorder.state !== 'inactive') recorder.stop();
        else reject(error || new Error('Не удалось запустить запись — повторите попытку'));
      };
      // Hidden tabs can throttle capture. Abort cleanly and keep the saved draw for a retry.
      const onVisibility = () => {
        if (document.hidden) finish(new Error('Запись прервалась — вкладка была скрыта / Нажмите ещё раз и оставьте её открытой / Все места сохранены'));
      };
      document.addEventListener('visibilitychange', onVisibility);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => finish(new Error('Браузер прервал запись — нажмите ещё раз, результаты сохранены'));
      recorder.onstop = () => {
        document.removeEventListener('visibilitychange', onVisibility);
        if (failure) { reject(failure); return; }
        const blob = new Blob(chunks, { type: mimeType });
        blob.size > 1024 ? resolve(blob) : reject(new Error('Видео не записалось — повторите попытку'));
      };
      try { recorder.start(250); }
      catch (error) { document.removeEventListener('visibilitychange', onVisibility); reject(error); return; }
      const start = performance.now();
      const frame = (now: number) => {
        if (stopped) return;
        const elapsed = Math.min((now - start) / 1000, renderer.settings.duration);
        if (elapsed - lastTime >= 1 / renderer.settings.fps - .002 || elapsed >= renderer.settings.duration) {
          renderer.frame(elapsed); lastTime = elapsed;
          onProgress(elapsed);
        }
        if (elapsed >= renderer.settings.duration) { finish(); return; }
        raf = requestAnimationFrame(frame);
      };
      // Reduced motion changes the on-page preview, never the encoded film.
      canvas.dataset.motion = reducedMotion ? 'reduced' : 'full';
      raf = requestAnimationFrame(frame);
    });
  } finally {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach(track => track.stop());
    await wakeLock?.release().catch(() => undefined);
  }
}
