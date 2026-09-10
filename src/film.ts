import type { Draw, Winner } from './types';
import { participantName } from '../shared/names.mjs';
import { filmSettings, countLabel, plural, type FilmSettings } from '../shared/contest.mjs';

export const FILM = filmSettings(5, 5);
export const COLORS = {
  paper: '#e7e7e5', canvas: '#f4f4ef', ink: '#181917', accent: '#e52b08', muted: '#65665f', rule: '#cececa',
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const easeOut = (value: number) => 1 - Math.pow(1 - clamp(value), 3);
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

function seeded(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

export function buildReel(participants: string[], draw: Draw, placeIndex: number): string[] {
  const random = seeded(draw.animationSeed + placeIndex * 7919);
  const previous = new Set(draw.winners.slice(0, placeIndex).map(winner => winner.account));
  const accounts = participants.filter(account => !previous.has(account));
  for (let i = accounts.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [accounts[i], accounts[j]] = [accounts[j], accounts[i]];
  }
  // Every account appears once in the reel; a rotated index lands on the already saved result.
  const winner = accounts.indexOf(draw.winners[placeIndex].account);
  return [...accounts.slice(winner + 1), ...accounts.slice(0, winner + 1)];
}

export class FilmRenderer {
  private ctx: CanvasRenderingContext2D;
  private reels: string[][] = [];
  private draw: Draw | null = null;
  constructor(readonly canvas: HTMLCanvasElement, readonly participants: string[], readonly settings: FilmSettings = FILM, readonly isInstagram = true) {
    canvas.width = this.settings.width;
    canvas.height = this.settings.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Ваш браузер не поддерживает запись — откройте приложение в Chrome или Edge');
    this.ctx = context;
  }

  setDraw(draw: Draw) {
    if (!Array.isArray(draw.winners) || draw.winners.length !== this.settings.winnerCount ||
      draw.winners.some((winner, index) => !winner.account || winner.place !== index + 1 ||
        !this.participants.includes(winner.account) || !['main', 'reserve'].includes(winner.kind))) {
      throw new Error('Не удалось прочитать список победителей — обновите страницу');
    }
    this.draw = draw;
    this.reels = draw.winners.map((_, index) => buildReel(this.participants, draw, index));
  }

  private text(text: string, x: number, y: number, size: number, color = COLORS.ink, weight = 400, family = 'Golos Text', maxWidth?: number) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px "${family}", sans-serif`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y, maxWidth);
  }

  private display(text: string, x: number, y: number, size: number, color = COLORS.ink, maxWidth = 820) {
    this.text(text, x, y, size, color, 900, 'Roboto Condensed', maxWidth);
  }

  private line(x: number, y: number, width: number, color = COLORS.rule) {
    this.ctx.fillStyle = color; this.ctx.fillRect(x, y, width, 2);
  }

  private star(x: number, y: number, radius: number, rotation: number, color = COLORS.accent) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.fillStyle = color;
    for (let i = 0; i < 8; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 4); ctx.fillRect(-radius * .105, -radius, radius * .21, radius * 2); ctx.restore();
    }
    ctx.restore();
  }

  private header(inverted = false) {
    const color = inverted ? COLORS.canvas : COLORS.ink;
    const ctx = this.ctx;
    ctx.fillStyle = inverted ? COLORS.canvas : COLORS.accent;
    ctx.fillRect(88, 264, 19, 19);
    this.text('РОЗЫГРЫШ', 127, 282, 25, color, 600);
    this.text(this.settings.reserveCount ? `${this.settings.mainWinnerCount} + ${this.settings.reserveCount}` : String(this.settings.mainWinnerCount), 775, 282, 25, color, 600, 'Golos Text', 137);
    this.line(88, 320, 824, inverted ? 'rgba(244,244,239,.35)' : COLORS.rule);
  }

  private footer(message: string, inverted = false) {
    const color = inverted ? COLORS.canvas : COLORS.muted;
    this.line(88, 1440, 824, inverted ? 'rgba(244,244,239,.35)' : COLORS.rule);
    this.text(message, 88, 1497, 26, color);
    this.text('УДАЧА В КАДРЕ', 88, 1685, 20, inverted ? 'rgba(244,244,239,.7)' : COLORS.muted, 600);
  }

  poster(time = 0) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.canvas; ctx.fillRect(0, 0, this.settings.width, this.settings.height);
    this.header();
    this.display('КОМУ', 76, 562, 224);
    this.display('ПОВЕЗЁТ?', 76, 767, 224, COLORS.accent);
    this.text('СЕГОДНЯ УЗНАЕМ', 88, 840, 27, COLORS.muted, 600);
    this.drawReel(2, this.participants, 1070, false);
    this.star(850, 1370, 45, -.15 + time * .13);
    this.footer(countLabel(this.settings.mainWinnerCount, this.settings.reserveCount).replace(' / без резерва', '').toUpperCase());
  }

  private drawReel(position: number, accounts: string[], center: number, active: boolean) {
    const ctx = this.ctx;
    const rowHeight = 132;
    const left = 88, width = 824;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, center - 214, 1080, 428); ctx.clip();
    const nearest = Math.round(position);
    const drawRows = (color: string, selected: boolean) => {
      for (let offset = -3; offset <= 3; offset++) {
        const index = nearest + offset;
        const normalized = ((index % accounts.length) + accounts.length) % accounts.length;
        const name = participantName(accounts[normalized], this.isInstagram);
        const y = center + (index - position) * rowHeight;
        ctx.save();
        ctx.globalAlpha = selected ? 1 : Math.max(.12, 1 - Math.abs(y - center) / 260) * .52;
        const size = name.length > 24 ? 42 : name.length > 18 ? 48 : 54;
        this.text(name, left + 38, y + 18, size, color, 600, 'Golos Text', width - 128);
        ctx.restore();
      }
    };
    drawRows(COLORS.ink, false);
    ctx.fillStyle = COLORS.accent; ctx.fillRect(left, center - 62, width, 124);
    ctx.save(); ctx.beginPath(); ctx.rect(left, center - 62, width, 124); ctx.clip();
    drawRows(COLORS.canvas, true); ctx.restore();
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath(); ctx.moveTo(952, center - 13); ctx.lineTo(931, center); ctx.lineTo(952, center + 13); ctx.closePath(); ctx.fill();
    const topFade = ctx.createLinearGradient(0, center - 214, 0, center - 114);
    topFade.addColorStop(0, COLORS.canvas); topFade.addColorStop(1, 'rgba(244,244,239,0)');
    ctx.fillStyle = topFade; ctx.fillRect(0, center - 214, 1080, 100);
    const bottomFade = ctx.createLinearGradient(0, center + 114, 0, center + 214);
    bottomFade.addColorStop(0, 'rgba(244,244,239,0)'); bottomFade.addColorStop(1, COLORS.canvas);
    ctx.fillStyle = bottomFade; ctx.fillRect(0, center + 114, 1080, 100);
    ctx.restore();
    if (active) this.text('СЛУЧАЙ ВЫБИРАЕТ', left, center + 270, 24, COLORS.muted, 600);
  }

  frame(time: number) {
    if (!this.draw) { this.poster(); return; }
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.canvas; ctx.fillRect(0, 0, this.settings.width, this.settings.height);

    if (time < 2.3) {
      this.header();
      const entrance = easeOut(time / .65);
      ctx.save(); ctx.globalAlpha = entrance; ctx.translate(0, 65 * (1 - entrance));
      this.display('СЕГОДНЯ', 76, 581, 197);
      this.display('ПОВЕЗЁТ', 76, 772, 210, COLORS.accent);
      this.display(this.settings.reserveCount ? `${this.settings.mainWinnerCount} + ${this.settings.reserveCount}` : String(this.settings.mainWinnerCount), 76, 1160, 302, COLORS.ink, 715);
      this.text(this.settings.reserveCount ? 'ПОБЕДИТЕЛИ / РЕЗЕРВ' : plural(this.settings.mainWinnerCount, ['ПОБЕДИТЕЛЬ', 'ПОБЕДИТЕЛЯ', 'ПОБЕДИТЕЛЕЙ']), 88, 1246, 36, COLORS.ink, 600);
      this.star(818, 1017, 69, -.12 + time * .35);
      ctx.restore();
      this.footer(countLabel(this.settings.mainWinnerCount, this.settings.reserveCount).replace(' / без резерва', '').toUpperCase());
    } else if (time < this.settings.spinStart) {
      this.header();
      this.display('ЛОВИМ', 76, 559, 201);
      this.display('МОМЕНТ', 76, 746, 201);
      const elapsed = time - 2.3;
      const count = Math.max(1, 3 - Math.floor(elapsed / .5));
      const pulse = Math.sin((elapsed % .5) / .5 * Math.PI);
      this.star(779, 1164, 103 + pulse * 9, elapsed * .6);
      this.display(String(count), 73, 1280, 534, COLORS.accent, 540);
      this.footer(`${this.settings.winnerCount} ${plural(this.settings.winnerCount, ['МЕСТО', 'МЕСТА', 'МЕСТ'])} / БЕЗ ПОВТОРОВ`);
    } else if (time < this.settings.summaryStart) {
      const index = Math.min(this.settings.winnerCount - 1, Math.floor((time - this.settings.spinStart) / this.settings.slotDuration));
      const elapsed = time - this.settings.spinStart - index * this.settings.slotDuration;
      const winner = this.draw.winners[index];
      if (elapsed < this.settings.revealDelay) {
        this.header();
        this.display(winner.kind === 'main' ? 'МЕСТО' : 'РЕЗЕРВ', 76, 551, 202);
        this.display(String(winner.place).padStart(2, '0'), 76, 799, 286, COLORS.accent);
        this.text(winner.kind === 'main' ? 'ОСНОВНОЙ ПОБЕДИТЕЛЬ' : 'РЕЗЕРВНЫЙ УЧАСТНИК', 88, 854, 27, COLORS.muted, 600);
        const progress = clamp(elapsed / (this.settings.revealDelay - .15));
        const reel = this.reels[index];
        const position = (reel.length - 1) * (1 - Math.pow(1 - progress, 3));
        this.drawReel(position, reel, 1110, true);
        this.footer(this.isInstagram ? 'БЕЗ ПОВТОРОВ / КАЖДЫЙ АККАУНТ — ОДНО МЕСТО' : 'БЕЗ ПОВТОРОВ / КАЖДЫЙ УЧАСТНИК — ОДНО МЕСТО');
        ctx.fillStyle = COLORS.accent; ctx.fillRect(88, 1408, 824 * progress, 4);
      } else {
        this.revealWinner(winner, elapsed - this.settings.revealDelay);
      }
    } else {
      this.summary(time);
    }
  }

  private revealWinner(winner: Winner, elapsed: number) {
    const ctx = this.ctx;
    const main = winner.kind === 'main';
    const foreground = main ? COLORS.canvas : COLORS.ink;
    ctx.fillStyle = main ? COLORS.accent : COLORS.canvas; ctx.fillRect(0, 0, this.settings.width, this.settings.height);
    const enter = easeOut(elapsed / .3);
    this.header(main);
    ctx.save(); ctx.translate(0, 35 * (1 - enter)); ctx.globalAlpha = enter;
    this.display(main ? 'ПОБЕДИТЕЛЬ' : 'РЕЗЕРВ', 76, 555, main ? 157 : 211, foreground);
    this.display('№' + String(winner.place).padStart(2, '0'), 76, 819, 294, main ? COLORS.canvas : COLORS.accent);
    this.star(821, 749, 68, elapsed * .18, main ? COLORS.canvas : COLORS.accent);
    ctx.fillStyle = COLORS.canvas; ctx.fillRect(88, 939, 824, 290);
    if (!main) { ctx.fillStyle = COLORS.ink; ctx.fillRect(88, 939, 824, 290); }
    this.text(main ? 'ОСНОВНОЙ ПОБЕДИТЕЛЬ' : 'РЕЗЕРВНЫЙ УЧАСТНИК', 124, 1001, 24, main ? COLORS.accent : COLORS.canvas, 600);
    const name = participantName(winner.account, this.isInstagram);
    const size = name.length > 25 ? 42 : name.length > 20 ? 49 : name.length > 16 ? 57 : 69;
    this.text(name, 124, 1100, size, main ? COLORS.ink : COLORS.canvas, 700, 'Golos Text', 752);
    this.text(`МЕСТО ${winner.place}`, 124, 1170, 24, main ? COLORS.muted : COLORS.canvas);
    this.text(main ? 'ПОЗДРАВЛЯЕМ!' : 'МЕСТО В ОБЩЕМ СПИСКЕ — ' + winner.place, 88, 1331, 32, foreground, 600);
    ctx.restore();
    this.footer(`ВЫБРАНО ${winner.place} ИЗ ${this.settings.winnerCount}`, main);
    // Two short paper strips celebrate the reveal without crossing the name.
    if (main && elapsed < 1.5) {
      const p = smooth(elapsed / 1.5);
      ctx.save(); ctx.globalAlpha = 1 - p;
      ctx.fillStyle = COLORS.canvas;
      ctx.translate(957, 520 + 820 * p); ctx.rotate(p * 2); ctx.fillRect(-8, -40, 16, 80);
      ctx.restore();
    }
  }

  summary(time = this.settings.summaryStart) {
    if (!this.draw) return;
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.canvas; ctx.fillRect(0, 0, this.settings.width, this.settings.height);
    this.header();
    this.display('ИТОГИ', 76, 541, 235);
    this.star(822, 466, 60, -.12);
    const pages = Math.ceil(this.draw.winners.length / 10);
    const page = Math.max(0, Math.min(pages - 1, Math.floor((time - this.settings.summaryStart) / this.settings.summaryPageDuration)));
    const winners = this.draw.winners.slice(page * 10, page * 10 + 10);
    const mainCount = winners.filter(winner => winner.kind === 'main').length;
    const hasReserve = winners.some(winner => winner.kind === 'reserve');
    if (mainCount) this.text(this.settings.mainWinnerCount === 1 ? 'ПОБЕДИТЕЛЬ' : 'ОСНОВНЫЕ ПОБЕДИТЕЛИ', 88, 636, 27, COLORS.accent, 600);
    const reserveLabelY = mainCount ? 636 + mainCount * 69 + 109 : 636;
    if (hasReserve) this.text('РЕЗЕРВ', 88, reserveLabelY, 27, COLORS.ink, 600);
    for (const [index, winner] of winners.entries()) {
      const main = winner.kind === 'main';
      const y = main ? 706 + index * 69 : reserveLabelY + 70 + (index - mainCount) * 69;
      if (main) {
        ctx.fillStyle = COLORS.accent; ctx.fillRect(88, y - 43, 824, 69);
        this.line(110, y + 25, 780, 'rgba(244,244,239,.3)');
      } else this.line(88, y + 25, 824);
      const foreground = main ? COLORS.canvas : COLORS.ink;
      this.text(String(winner.place).padStart(2, '0'), 111, y, 28, foreground, 600);
      const name = participantName(winner.account, this.isInstagram);
      const size = name.length > 25 ? 31 : name.length > 21 ? 34 : 38;
      this.text(name, 187, y, size, foreground, 600, 'Golos Text', 699);
    }
    if (pages > 1) this.text(`СПИСОК ${page + 1} ИЗ ${pages}`, 88, 1600, 24, COLORS.muted);
    this.text('СПАСИБО КАЖДОМУ ЗА УЧАСТИЕ', 88, 1532, 25, COLORS.muted);
    this.text('УДАЧА В КАДРЕ', 88, 1685, 20, COLORS.muted, 600);
  }
}
