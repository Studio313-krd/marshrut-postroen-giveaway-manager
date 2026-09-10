export const VIDEO = Object.freeze({ width: 1080, height: 1920, fps: 30 });
// Essential content stays clear of Reels controls, captions and the top overlay.
export const SAFE = Object.freeze({ left: 84, right: 876, top: 288, bottom: 1240 });
export const SUMMARY_PAGE_SIZE = 5;
export const SLOT = Object.freeze({ top: 650, height: 324, pitch: 108, center: 812 });
const C = { background: '#0a0c08', surface: '#20251b', ink: '#e5e5df', muted: '#a9b59d', accent: '#db2a00', route: '#252e1c', line: '#45513b' };
const display = size => `900 ${size}px DexaCondensed`;
const body = size => `400 ${size}px Dexa`;
const center = (SAFE.left + SAFE.right) / 2;
const width = SAFE.right - SAFE.left;

export function paintStage(ctx, { contest, participants, results, spinning, drawState, currentWinner, summaryPage = 0 }) {
  const winners = contest.snapshot.payload.winnerCount ?? 5;
  const reserves = contest.snapshot.payload.reserveCount ?? 5;
  const total = winners + reserves;
  const complete = results.length === total && !spinning;
  function text(value, x, y, size, { color = C.ink, align = 'left', condensed = false, maxWidth = width } = {}) {
    const font = condensed ? display : body;
    ctx.font = font(size);
    while (ctx.measureText(value).width > maxWidth && size > 22) ctx.font = font(--size);
    ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y);
  }
  function line(x1, y1, x2, y2, color = C.line, weight = 2) {
    ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, VIDEO.width, VIDEO.height);
  // The route continues into the UI-covered area, but carries no text there.
  ctx.strokeStyle = C.route; ctx.lineWidth = 30; ctx.lineJoin = 'miter';
  ctx.beginPath(); ctx.moveTo(-50, 120); ctx.lineTo(1000, 120); ctx.lineTo(1000, 1490); ctx.lineTo(210, 1490); ctx.lineTo(210, 1800); ctx.lineTo(730, 1800); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(640, 1710); ctx.lineTo(730, 1800); ctx.lineTo(640, 1890); ctx.stroke();
  line(SAFE.left, 240, SAFE.left + 130, 240, C.accent, 12);
  text('МАРШРУТ', SAFE.left, 326, 52, { condensed: true });
  text('ПОСТРОЕН', SAFE.left, 370, 52, { condensed: true });
  line(SAFE.left + 247, 310, SAFE.left + 290, 310, C.accent, 9);
  line(SAFE.left + 290, 310, SAFE.left + 290, 365, C.accent, 9);
  text(contest.demo ? 'РЕПЕТИЦИЯ' : 'РОЗЫГРЫШ', SAFE.right, 333, 25, { align: 'right', color: C.muted, maxWidth: 350 });
  const title = contest.name.replace(/\s+/g, ' ').trim();
  let heading = title; ctx.font = body(34);
  while (ctx.measureText(heading).width > width && heading.length > 1) heading = heading.slice(0, -1);
  if (heading !== title) heading = heading.slice(0, -1) + '…';
  text(heading, SAFE.left, 443, 34);
  line(SAFE.left, 478, SAFE.right, 478);

  if (complete) {
    text('МАРШРУТ ПОСТРОЕН.', SAFE.left, 571, 79, { condensed: true });
    const pages = Math.ceil(results.length / SUMMARY_PAGE_SIZE);
    const page = Math.max(0, Math.min(summaryPage, pages - 1));
    const visible = results.slice(page * SUMMARY_PAGE_SIZE, (page + 1) * SUMMARY_PAGE_SIZE);
    text(`${winners} ОСНОВНЫХ + ${reserves} В РЕЗЕРВЕ`, SAFE.left, 619, 27, { color: C.muted });
    visible.forEach((result, index) => {
      const y = 691 + index * 102;
      text(String(result.rank).padStart(2, '0'), SAFE.left, y + 4, 57, { condensed: true, color: result.group === 'reserve' ? C.muted : C.accent, maxWidth: 90 });
      text('@' + result.username, SAFE.left + 112, y, 51, { maxWidth: width - 112 });
      text(result.group === 'reserve' ? 'РЕЗЕРВ' : 'ОСНОВНОЙ КАНДИДАТ', SAFE.left + 112, y + 33, 22, { color: C.muted });
      line(SAFE.left, y + 48, SAFE.right, y + 48);
    });
    text('УСЛОВИЯ УЧАСТИЯ ПРОВЕРЯЕТ КОМАНДА', SAFE.left, 1200, 25, { color: C.muted });
    if (pages > 1) text(`${page + 1} / ${pages}`, SAFE.right, 1237, 23, { color: C.muted, align: 'right' });
    return;
  }

  const rank = spinning ? drawState?.rank ?? Math.min(results.length + 1, total) : currentWinner?.rank ?? 1;
  text(rank <= winners ? 'ОСНОВНОЙ КАНДИДАТ' : 'РЕЗЕРВНЫЙ КАНДИДАТ', SAFE.left, 540, 28, { color: C.muted });
  text(`МЕСТО ${String(rank).padStart(2, '0')}`, SAFE.left, 622, 94, { condensed: true });
  text(`/ ${total}`, SAFE.right, 615, 46, { color: C.muted, align: 'right', maxWidth: 160 });
  ctx.save(); ctx.beginPath(); ctx.rect(SAFE.left, SLOT.top, width, SLOT.height); ctx.clip();
  ctx.fillStyle = C.surface; ctx.fillRect(SAFE.left, SLOT.top, width, SLOT.height);
  ctx.fillStyle = C.ink; ctx.fillRect(SAFE.left, SLOT.center - SLOT.pitch / 2, width, SLOT.pitch);
  const cards = drawState?.cards ?? participants.slice(0, 3);
  const offset = drawState?.offset ?? SLOT.center - SLOT.pitch;
  cards.forEach((user, index) => {
    const y = index * SLOT.pitch + offset;
    if (y < SLOT.top - SLOT.pitch || y > SLOT.top + SLOT.height + SLOT.pitch) return;
    const active = Math.abs(y - SLOT.center) < SLOT.pitch / 2;
    text('@' + user, center, y + 20, 64, { align: 'center', color: active ? C.background : C.muted, maxWidth: width - 66 });
  });
  ctx.restore();
  ctx.fillStyle = C.accent; ctx.fillRect(SAFE.left, SLOT.center - SLOT.pitch / 2, 10, SLOT.pitch);
  text(spinning ? 'УДАЧА УЖЕ В ПУТИ' : currentWinner ? 'МАРШРУТ К ПОБЕДЕ' : 'У КАЖДОГО ЕСТЬ ШАНС', center, 1050, 49, { align: 'center', condensed: true });
  text(`${participants.length} АККАУНТОВ · ОДИН ШАНС У КАЖДОГО`, center, 1101, 26, { align: 'center', color: C.muted });
  line(SAFE.left, 1150, SAFE.right, 1150);
  text(`${spinning ? Math.max(0, results.length - 1) : results.length} ИЗ ${total} МЕСТ ОПРЕДЕЛЕНЫ`, SAFE.left, 1200, 28, { color: C.muted });
}
