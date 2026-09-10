export type FilmSettings = {
  width: number; height: number; fps: number; duration: number; renderVersion: number;
  winnerCount: number; mainWinnerCount: number; reserveCount: number;
  spinStart: number; slotDuration: number; revealDelay: number;
  summaryStart: number; summaryPageDuration: number;
};
export function validateCounts(main: number, reserve: number, available: number): { main: number; reserve: number };
export function filmSettings(main: number, reserve: number): FilmSettings;
export function plural(number: number, forms: [string, string, string]): string;
export function countLabel(main: number, reserve: number): string;
export function timecode(seconds: number): string;
