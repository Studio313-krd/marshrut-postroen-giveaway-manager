import './style.css';
import { COLORS, FILM, FilmRenderer } from './film';
import { recordFilm, recordingType } from './record';
import type { AppState, Draw } from './types';
import { countLabel, filmSettings, timecode, validateCounts } from '../shared/contest.mjs';
import { helpersMarkup, connectHelpers } from './prompt';
import { participantsMarkup, connectParticipants } from './participants';
import { participantName } from '../shared/names.mjs';

for (const [name, color] of Object.entries(COLORS)) document.documentElement.style.setProperty(`--${name}`, color);

const star = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 1v38M1 20h38M6.5 6.5l27 27m0-27-27 27" stroke="currentColor" stroke-width="6"/></svg>';
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="masthead">
    <div class="wordmark"><span class="mark" aria-hidden="true"></span> УДАЧА В КАДРЕ</div>
    <div class="header-account"><span class="masthead-note">РОЗЫГРЫШ <span class="slash">/</span> REELS</span><button type="button" id="logout" class="text-button">Выйти <span aria-hidden="true">↗</span></button></div>
  </header>
  <main class="workspace">
    <section class="intro" aria-labelledby="title">
      <p class="eyebrow">ПУСТЬ РЕШИТ СЛУЧАЙ</p>
      <h1 id="title">СЛУЧАЙ<br><span>РЕШАЕТ</span><span class="title-star">${star}</span></h1>
      <p class="description"><span id="participant-description">Участники из проверенного списка</span><br><span id="places-description">Настройте количество мест</span></p>
      ${participantsMarkup}
      <form id="settings-form" class="settings-form">
        <div class="settings-heading"><span>НАСТРОЙКИ РОЗЫГРЫША</span><label class="reserve-switch"><input id="reserve-enabled" type="checkbox" checked /><span class="switch-track" aria-hidden="true"></span><span>Нужен резерв</span></label></div>
        <div class="count-inputs"><label for="main-count">Победители<input id="main-count" type="number" min="1" step="1" value="5" required inputmode="numeric" /></label><label for="reserve-count">Резерв<input id="reserve-count" type="number" min="0" step="1" value="5" required inputmode="numeric" /></label></div>
        <div class="settings-bottom"><p id="settings-note">Количество можно изменить перед записью</p><button id="apply-settings" type="submit" class="text-button" disabled>Применить <span aria-hidden="true">↗</span></button></div>
        <p id="settings-error" class="field-error" role="status"></p>
      </form>
      <div id="results" class="results" hidden>
        <table aria-label="Результаты розыгрыша по местам">
          <thead><tr><th scope="col">Место</th><th scope="col" id="participant-column">Аккаунт</th><th scope="col">Статус</th></tr></thead>
          <tbody id="result-rows"></tbody>
        </table>
      </div>
      <div class="action-block">
        <button id="record" class="record-button" disabled>
          <span class="record-icon" aria-hidden="true"></span>
          <span id="button-text">Записать видео</span>
          <svg class="button-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" stroke="currentColor" stroke-width="1.7"/></svg>
        </button>
        <p id="status" class="status" role="status" aria-live="polite">Готовим кадр</p>
      </div>
      <div class="details"><span id="duration-note">${FILM.duration} секунд</span><span>MP4 / без звука</span><span>Для вашего Reels</span></div>
    </section>
    <section class="preview" aria-label="Предварительный просмотр вертикального видео">
      <div class="preview-caption"><span id="preview-label">БУДУЩИЙ РОЛИК</span><span class="rec-indicator"><i></i><span id="rec-label">ПРЕДПРОСМОТР</span></span></div>
      <div class="film-frame">
        <canvas id="film" role="img" aria-label="Вертикальный ролик: розыгрыш среди проверенных участников"></canvas>
        <div class="reduced-cover" aria-hidden="true">Идёт запись<span>Анимация будет в готовом видео</span></div>
      </div>
      <div class="preview-bottom"><span>1080 × 1920 <span class="slash">/</span> 9:16</span><span id="timecode">00:00 <span class="slash">/</span> 00:${FILM.duration}</span></div>
      <div class="timeline" role="progressbar" aria-label="Запись видео" aria-valuemin="0" aria-valuemax="${FILM.duration}" aria-valuenow="0"><span id="progress"></span></div>
    </section>
  </main>
  ${helpersMarkup}
  <footer class="page-footer"><span class="source-status"><svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m4 9 3 3 7-7" stroke="currentColor" stroke-width="1.5"/></svg><span id="source-note">Список из Excel</span></span><span>ОДИН КЛИК — ЧЬЯ-ТО УДАЧА</span></footer>
`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const button = $<HTMLButtonElement>('#record');
const status = $('#status');
const canvas = $<HTMLCanvasElement>('#film');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let state: AppState;
let renderer: FilmRenderer;
let busy = false;
let posterAnimation = 0;
let ready = false;
let helpersReady = false;
let film = FILM;
const mainCount = $<HTMLInputElement>('#main-count');
const reserveCount = $<HTMLInputElement>('#reserve-count');
const reserveEnabled = $<HTMLInputElement>('#reserve-enabled');
const applySettings = $<HTMLButtonElement>('#apply-settings');
let applyingSettings = false;
let importing = false;
let participantEditor: ReturnType<typeof connectParticipants>;

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, options); }
  catch { throw new Error('Приложение недоступно — запустите его заново и обновите страницу, результаты сохранены'); }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Не удалось получить ответ приложения — обновите страницу и повторите попытку'); }
  if (response.status === 401) { busy = false; location.reload(); throw new Error('Сессия завершена — войдите снова'); }
  if (!response.ok) throw new Error(data.error || 'Не удалось связаться с приложением — обновите страницу');
  return data;
}

function animatePoster(now: number) {
  if (busy || state.draw || reducedMotion.matches || document.hidden) return;
  renderer.poster(now / 1000);
  posterAnimation = requestAnimationFrame(animatePoster);
}

function download(url: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = url.split('/').at(-1)!;
  document.body.append(anchor); anchor.click(); anchor.remove();
}

function showResult(draw: Draw) {
  renderer.setDraw(draw); renderer.summary();
  canvas.setAttribute('aria-label', `Результаты розыгрыша — ${countLabel(state.settings.main, state.settings.reserve)}, список доступен в таблице`);
  $('#preview-label').textContent = 'РЕЗУЛЬТАТЫ СОХРАНЕНЫ';
  document.body.classList.add('has-result');
  $('#title').innerHTML = `ИТОГИ<br><span>РОЗЫГРЫША</span>`;
  $('.eyebrow').textContent = 'СЛУЧАЙ СДЕЛАЛ ВЫБОР';
  const rows = $('#result-rows');
  rows.replaceChildren();
  for (const winner of draw.winners) {
    const row = document.createElement('tr');
    row.className = winner.kind;
    for (const value of [String(winner.place).padStart(2, '0'), participantName(winner.account, state.isInstagram), winner.kind === 'main' ? 'Победитель' : 'Резерв']) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    rows.append(row);
  }
  $('#results').hidden = false;
}

async function initialize() {
  status.classList.remove('error');
  button.disabled = true;
  await Promise.all([
    document.fonts.load('900 80px "Roboto Condensed"'),
    document.fonts.load('400 32px "Golos Text"'),
    document.fonts.load('600 32px "Golos Text"'),
    document.fonts.load('700 32px "Golos Text"'),
  ]);
  state = await api<AppState>('/api/state');
  cancelAnimationFrame(posterAnimation);
  film = filmSettings(state.settings.main, state.settings.reserve);
  renderer = new FilmRenderer(canvas, state.participants, film, state.isInstagram);
  mainCount.value = String(state.settings.main); reserveCount.value = String(state.settings.reserve);
  mainCount.max = String(state.participants.length); reserveCount.max = String(state.participants.length - state.settings.main);
  reserveEnabled.checked = state.settings.reserve > 0; reserveCount.disabled = !reserveEnabled.checked;
  applySettings.disabled = true;
  $('#places-description').textContent = countLabel(state.settings.main, state.settings.reserve);
  $('#duration-note').textContent = `${timecode(film.duration)} / длительность`;
  $('#rec-label').textContent = 'ПРЕДПРОСМОТР';
  $('#timecode').textContent = `00:00 / ${timecode(film.duration)}`;
  $('.timeline').setAttribute('aria-valuemax', String(film.duration));
  $('.timeline').setAttribute('aria-valuenow', '0'); $('#progress').style.width = '0';
  if (state.renderVersion !== FILM.renderVersion) throw new Error('Приложение обновлено — обновите страницу');
  $('#participant-description').textContent = state.inputKind === 'text' ? 'Участники из вашего списка' : 'Участники из загруженного Excel';
  $('#participant-column').textContent = state.isInstagram ? 'Аккаунт' : 'Участник';
  $('#source-note').textContent = state.inputKind === 'text' ? 'Список введён вручную' : 'Список из Excel';
  if (state.draw) {
    showResult(state.draw);
    status.textContent = state.videoUrl
      ? 'Нажмите, чтобы скачать сохранённый ролик'
      : 'Все места сохранены — нажмите, чтобы записать видео';
  } else {
    document.body.classList.remove('has-result');
    $('#results').hidden = true; $('#result-rows').replaceChildren();
    $('#title').innerHTML = `СЛУЧАЙ<br><span>РЕШАЕТ</span><span class="title-star">${star}</span>`;
    $('.eyebrow').textContent = 'ПУСТЬ РЕШИТ СЛУЧАЙ';
    $('#preview-label').textContent = 'БУДУЩИЙ РОЛИК';
    renderer.poster();
    status.textContent = 'Нажмите — видео скачается автоматически';
    if (!reducedMotion.matches) posterAnimation = requestAnimationFrame(animatePoster);
  }
  $('#settings-note').textContent = state.draw ? 'Для этого количества мест результат уже сохранён' : 'Изменение количества открывает отдельный розыгрыш';
  if (!helpersReady) { connectHelpers(() => state); helpersReady = true; }
  participantEditor?.sync();
  if (!state.encoderReady) throw new Error('Для сохранения MP4 нужен FFmpeg — установите его и перезапустите приложение');
  if (!recordingType()) throw new Error('Откройте приложение в Chrome или Edge на компьютере, чтобы записать видео');
  ready = true; button.disabled = false;
}

function showError(error: unknown) {
  status.classList.add('error');
  status.textContent = error instanceof Error ? error.message : 'Не удалось записать видео — нажмите ещё раз, результаты сохранены';
  button.disabled = false;
}

function updateSettingsDraft() {
  if (!ready) return;
  const main = Number(mainCount.value);
  const reserve = reserveEnabled.checked ? Number(reserveCount.value) : 0;
  reserveCount.max = String(Math.max(0, state.participants.length - main));
  reserveCount.disabled = !reserveEnabled.checked || busy;
  const changed = main !== state.settings.main || reserve !== state.settings.reserve;
  applySettings.disabled = !changed || busy || applyingSettings || importing;
  button.disabled = changed || busy || applyingSettings || importing;
  $('#settings-error').textContent = '';
  if (changed) $('#settings-note').textContent = 'Нажмите «Применить» / Предыдущие результаты сохранятся';
}

mainCount.addEventListener('input', updateSettingsDraft);
reserveCount.addEventListener('input', () => {
  if (reserveCount.value === '0') reserveEnabled.checked = false;
  updateSettingsDraft();
});
reserveEnabled.addEventListener('change', () => {
  if (reserveEnabled.checked && Number(reserveCount.value) < 1) reserveCount.value = '1';
  updateSettingsDraft();
});
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || applyingSettings || importing) return;
  try {
    const selected = validateCounts(Number(mainCount.value), reserveEnabled.checked ? Number(reserveCount.value) : 0, state.participants.length);
    applyingSettings = true; applySettings.disabled = true; button.disabled = true;
    participantEditor?.setDisabled(true);
    await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Film-Version': String(FILM.renderVersion), 'X-Source-Hash': state.sourceHash }, body: JSON.stringify(selected) });
    await initialize();
    $('#settings-note').textContent = state.draw ? 'Для этого количества мест результат уже сохранён' : 'Настройки применены / Можно записывать';
  } catch (error) {
    $('#settings-error').textContent = error instanceof Error ? error.message : 'Не удалось сохранить настройки';
    applySettings.disabled = false;
  } finally { applyingSettings = false; participantEditor?.setDisabled(false); }
});

$('#logout').addEventListener('click', async () => {
  if (busy || importing) return;
  try { await api('/api/auth/logout', { method: 'POST' }); location.reload(); }
  catch (error) { showError(error); }
});

button.addEventListener('click', async () => {
  if (busy || applyingSettings || importing) return;
  if (!ready) { initialize().catch(showError); return; }
  if (state.videoUrl) { download(state.videoUrl); status.textContent = 'Скачиваем сохранённый ролик — все места остаются прежними'; return; }
  busy = true; button.disabled = true;
  participantEditor?.setDisabled(true);
  mainCount.disabled = true; reserveCount.disabled = true; reserveEnabled.disabled = true;
  $<HTMLButtonElement>('#logout').disabled = true;
  status.classList.remove('error');
  cancelAnimationFrame(posterAnimation);
  $('#button-text').textContent = 'Готовим запись';
  status.textContent = 'Оставьте эту вкладку открытой до конца записи';
  try {
    const draw = await api<Draw>('/api/draw', { method: 'POST', headers: { 'X-Film-Version': String(FILM.renderVersion), 'X-Source-Hash': state.sourceHash, 'X-Contest-Key': `${state.settings.main}-${state.settings.reserve}` } });
    renderer.setDraw(draw);
    state.draw = draw;
    $('#button-text').textContent = 'Записываем видео';
    $('#preview-label').textContent = 'В КАДРЕ';
    $('#rec-label').textContent = 'REC';
    document.body.classList.add('is-recording');
    document.body.classList.toggle('reduce-preview', reducedMotion.matches);
    if (matchMedia('(max-width: 700px)').matches) {
      $('.preview').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
    }
    const video = await recordFilm(renderer, time => {
      $('#progress').style.width = `${time / film.duration * 100}%`;
      $('.timeline').setAttribute('aria-valuenow', String(Math.floor(time)));
      $('#timecode').textContent = `${timecode(time)} / ${timecode(film.duration)}`;
    }, reducedMotion.matches);
    document.body.classList.remove('is-recording', 'reduce-preview');
    showResult(state.draw);
    $('#button-text').textContent = 'Сохраняем MP4';
    $('#rec-label').textContent = 'СОХРАНЕНИЕ';
    status.textContent = 'Ролик записан — готовим файл для монтажа';
    const result = await api<{ videoUrl: string }>('/api/export', {
      method: 'POST', headers: { 'Content-Type': video.type, 'X-Draw-Id': state.draw.id, 'X-Film-Version': String(FILM.renderVersion), 'X-Source-Hash': state.sourceHash, 'X-Contest-Key': `${state.settings.main}-${state.settings.reserve}` }, body: video,
    });
    state.videoUrl = result.videoUrl;
    download(state.videoUrl);
    status.textContent = 'Готово — видео сохранено / Нажмите ещё раз для повторного скачивания';
    $('#rec-label').textContent = 'ГОТОВО';
  } catch (error) {
    showError(error);
    if (state.draw) showResult(state.draw);
    $('#rec-label').textContent = 'ПРЕДПРОСМОТР';
  } finally {
    busy = false; button.disabled = false;
    participantEditor?.setDisabled(false);
    mainCount.disabled = false; reserveEnabled.disabled = false; reserveCount.disabled = !reserveEnabled.checked;
    $<HTMLButtonElement>('#logout').disabled = false;
    $('#button-text').textContent = 'Записать видео';
    document.body.classList.remove('is-recording', 'reduce-preview');
  }
});

window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(posterAnimation);
  if (ready && !busy && !state.draw && !document.hidden && !reducedMotion.matches) posterAnimation = requestAnimationFrame(animatePoster);
});
reducedMotion.addEventListener('change', () => {
  cancelAnimationFrame(posterAnimation);
  if (ready && !busy && !state.draw) { renderer.poster(); if (!reducedMotion.matches) posterAnimation = requestAnimationFrame(animatePoster); }
});
participantEditor = connectParticipants({
  getState: () => state,
  async submit(url, body, headers) {
    if (!ready || busy || applyingSettings || importing) throw new Error('Дождитесь завершения текущего действия');
    importing = true; button.disabled = true; applySettings.disabled = true;
    mainCount.disabled = true; reserveCount.disabled = true; reserveEnabled.disabled = true;
    $<HTMLButtonElement>('#logout').disabled = true;
    try {
      const result = await api<{ participants: number; duplicates: number }>(url, { method: 'POST', headers: { ...headers, 'X-Film-Version': String(FILM.renderVersion), 'X-Source-Hash': state.sourceHash }, body });
      $('#prompt-result').hidden = true;
      await initialize();
      return result;
    } finally {
      importing = false; mainCount.disabled = false; reserveEnabled.disabled = false;
      reserveCount.disabled = !reserveEnabled.checked; $<HTMLButtonElement>('#logout').disabled = false;
      updateSettingsDraft();
    }
  },
});
initialize().catch(showError);
