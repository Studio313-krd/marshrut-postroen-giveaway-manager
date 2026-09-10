import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, link, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function createDrawStore({ directory, participants, sourceHash, winnerCount = 10, mainWinnerCount = 5, duration = 45, fileKey = '' }) {
  if (!participants.length || participants.some(account => typeof account !== 'string' || !account.trim()) || new Set(participants).size !== participants.length) {
    throw new Error('Participant list must contain unique, non-empty accounts.');
  }
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || participants.length < winnerCount ||
      !Number.isInteger(mainWinnerCount) || mainWinnerCount < 1 || mainWinnerCount > winnerCount) {
    throw new Error('Not enough participants or invalid winner counts.');
  }
  if (fileKey && !/^\d+-\d+$/.test(fileKey)) throw new Error('Invalid draw key');
  const file = join(directory, `draw-${sourceHash}${fileKey ? '-' + fileKey : ''}.json`);

  async function read() {
    let result;
    try { result = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (result.version !== 2 || result.sourceHash !== sourceHash || !Array.isArray(result.winners) ||
      result.winners.length !== winnerCount || new Set(result.winners.map(winner => winner.account)).size !== winnerCount ||
      result.winners.some((winner, index) => participants[winner.participantIndex] !== winner.account ||
        winner.place !== index + 1 || winner.kind !== (index < mainWinnerCount ? 'main' : 'reserve')) ||
      result.participantsCount !== participants.length || !/^[a-f0-9-]{36}$/.test(result.id) || result.duration !== duration) {
      throw new Error('Saved draw does not match the participant list.');
    }
    return result;
  }

  async function draw() {
    await mkdir(directory, { recursive: true });
    const previous = await read();
    if (previous) return previous;
    const remaining = participants.map((account, participantIndex) => ({ account, participantIndex }));
    const winners = Array.from({ length: winnerCount }, (_, index) => {
      const [winner] = remaining.splice(randomInt(remaining.length), 1);
      return { ...winner, place: index + 1, kind: index < mainWinnerCount ? 'main' : 'reserve' };
    });
    const result = {
      version: 2,
      id: randomUUID(),
      sourceHash,
      createdAt: new Date().toISOString(),
      participantsCount: participants.length,
      winners,
      animationSeed: randomInt(1, 0x7fffffff),
      duration,
    };
    const temporary = join(directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    try {
      // Atomic create-if-absent: concurrent tabs/processes cannot overwrite a draw.
      await link(temporary, file);
      return result;
    } catch (error) {
      if (error.code === 'EEXIST') return await read();
      throw error;
    } finally { await rm(temporary, { force: true }); }
  }
  return { read, draw };
}
