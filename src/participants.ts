import type { AppState } from './types';

export const participantsMarkup = `
  <section class="participants-section" aria-label="Список участников">
    <details id="participants-details">
      <summary><span>УЧАСТНИКИ <span id="participants-count"></span></span><span class="source-edit">Изменить <span aria-hidden="true">+</span></span></summary>
      <form id="participants-form">
        <fieldset id="participants-fields">
          <legend class="sr-only">Как добавить участников</legend>
          <div class="source-options">
            <label><input type="radio" name="participant-source" value="excel" checked /><span>Из Excel</span></label>
            <label><input type="radio" name="participant-source" value="text" /><span>Вставить список</span></label>
          </div>
          <div id="excel-input-panel">
            <label class="file-picker" for="participants-file"><span class="file-picker-title">Выберите Excel <span aria-hidden="true">↗</span></span><span id="file-caption">XLSX или XLS / до 20 МБ</span><input id="participants-file" type="file" accept=".xlsx,.xls" /></label>
            <p class="source-hint">Заголовок «Аккаунт» или «Имя пользователя» в первой строке / Проверяем столбцы A–J первых двух листов, без учёта регистра</p>
          </div>
          <div id="text-input-panel" hidden>
            <label for="participants-text" class="source-label">По одному участнику в строке</label>
            <textarea id="participants-text" rows="7" placeholder="Анна\nМихаил\nАлександр" spellcheck="false"></textarea>
            <label class="instagram-option"><input id="instagram-accounts" type="checkbox" checked aria-describedby="instagram-tooltip" /><span>Это Instagram аккаунты</span><span class="tooltip-mark" aria-hidden="true">?</span><span id="instagram-tooltip" role="tooltip">Если отмечено, добавляем @ перед именами в результатах и видео / Если выключено, показываем имена как в списке</span></label>
          </div>
          <p class="source-hint">Пустые строки пропускаем, повторы объединяем / До 50 000 строк / Прежние результаты сохраняются</p>
          <button id="apply-participants" type="submit" class="outline-button">Применить список <span aria-hidden="true">↗</span></button>
        </fieldset>
      </form>
    </details>
    <p id="participants-status" class="source-feedback" role="status" aria-live="polite"></p>
  </section>`;

export function connectParticipants(options: {
  getState: () => AppState;
  submit: (url: string, body: BodyInit, headers: Record<string, string>) => Promise<{ participants: number; duplicates: number }>;
}) {
  const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const fieldset = $<HTMLFieldSetElement>('#participants-fields');
  const file = $<HTMLInputElement>('#participants-file');
  const text = $<HTMLTextAreaElement>('#participants-text');
  const instagram = $<HTMLInputElement>('#instagram-accounts');
  const message = $('#participants-status');
  const submit = $<HTMLButtonElement>('#apply-participants');
  let loading = false;
  let hydrated = false;
  const mode = () => document.querySelector<HTMLInputElement>('input[name="participant-source"]:checked')!.value;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="participant-source"]')) input.addEventListener('change', () => {
    $('#excel-input-panel').hidden = mode() !== 'excel';
    $('#text-input-panel').hidden = mode() !== 'text';
    message.textContent = '';
  });
  file.addEventListener('change', () => { $('#file-caption').textContent = file.files?.[0]?.name || 'XLSX или XLS / до 20 МБ'; message.textContent = ''; });
  $('#participants-form').addEventListener('submit', async event => {
    event.preventDefault(); if (loading || fieldset.disabled) return;
    message.classList.remove('error');
    try {
      let url: string, body: BodyInit, headers: Record<string, string>;
      if (mode() === 'excel') {
        const selected = file.files?.[0];
        if (!selected) throw new Error('Выберите Excel со списком участников');
        if (selected.size > 20 * 1024 * 1024) throw new Error('Выберите Excel размером до 20 МБ');
        url = '/api/participants/excel'; body = selected;
        headers = { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(selected.name) };
      } else {
        if (!text.value.trim()) throw new Error('Вставьте список участников — по одному в строке');
        url = '/api/participants/text'; body = JSON.stringify({ text: text.value, isInstagram: instagram.checked }); headers = { 'Content-Type': 'application/json' };
      }
      loading = true; fieldset.disabled = true; submit.textContent = 'Читаем список'; message.textContent = 'Проверяем участников';
      const result = await options.submit(url, body, headers);
      message.textContent = `Список применён / Участников: ${result.participants}${result.duplicates ? ` / Повторов объединено: ${result.duplicates}` : ''}`;
      $<HTMLDetailsElement>('#participants-details').open = false;
      file.value = ''; $('#file-caption').textContent = 'XLSX или XLS / до 20 МБ';
    } catch (error) {
      message.classList.add('error'); message.textContent = error instanceof Error ? error.message : 'Не удалось применить список';
    } finally { loading = false; fieldset.disabled = false; submit.innerHTML = 'Применить список <span aria-hidden="true">↗</span>'; }
  });
  return {
    setDisabled(disabled: boolean) { fieldset.disabled = disabled || loading; },
    sync() {
      const state = options.getState();
      if (!hydrated && state.inputKind === 'text') {
        document.querySelector<HTMLInputElement>('input[name="participant-source"][value="text"]')!.checked = true;
        $('#excel-input-panel').hidden = true; $('#text-input-panel').hidden = false;
        text.value = state.participants.join('\n'); instagram.checked = state.isInstagram;
      }
      hydrated = true;
      $('#participants-count').textContent = String(state.participants.length);
      $('#participants-count').setAttribute('aria-label', `В списке ${state.participants.length}`);
    },
  };
}
