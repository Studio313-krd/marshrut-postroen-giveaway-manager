import base from '../data/config.json' with { type: 'json' };

export function validateCounts(main, reserve, available) {
  if (!Number.isInteger(main) || main < 1 || !Number.isInteger(reserve) || reserve < 0 || main + reserve > available) {
    throw new Error(`Укажите целое число победителей от 1 и резервных от 0 / Всего можно выбрать не больше ${available} участников`);
  }
  return { main, reserve };
}

export function filmSettings(main, reserve) {
  const winnerCount = main + reserve;
  const summaryStart = base.spinStart + base.slotDuration * winnerCount;
  return {
    ...base, winnerCount, mainWinnerCount: main, reserveCount: reserve,
    summaryStart, summaryPageDuration: 8.2,
    duration: Math.ceil(summaryStart + Math.ceil(winnerCount / 10) * 8.2),
  };
}

export function plural(number, forms) {
  const last = number % 10, lastTwo = number % 100;
  return forms[last === 1 && lastTwo !== 11 ? 0 : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 1 : 2];
}

export function countLabel(main, reserve) {
  return `${main} ${plural(main, ['победитель', 'победителя', 'победителей'])}${reserve ? ` / ${reserve} в резерве` : ' / без резерва'}`;
}

export function timecode(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
