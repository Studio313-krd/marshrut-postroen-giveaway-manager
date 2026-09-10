import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createDrawStore } from '../server/store.mjs';
import { filmSettings, validateCounts } from '../shared/contest.mjs';
import { fixture } from './fixtures.mjs';

test('participant fixture has 162 unique, valid accounts and a matching fingerprint', () => {
  const data = fixture;
  assert.equal(data.participants.length, 162);
  assert.equal(new Set(data.participants).size, 162);
  assert.ok(data.participants.every(account => /^[a-z0-9._]{1,30}$/.test(account)));
  assert.equal(data.sourceHash, createHash('sha256').update(data.participants.join('\n')).digest('hex'));
  assert.deepEqual(Object.keys(data).sort(), ['participants', 'sourceFile', 'sourceHash']);
});

test('concurrent clicks and a restarted store retain ten unique, ranked main and reserve winners', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'giveaway-unit-'));
  const options = { directory, participants: Array.from({ length: 20 }, (_, index) => `account_${index}`), sourceHash: 'test-pool' };
  try {
    const stores = Array.from({ length: 12 }, () => createDrawStore(options));
    assert.equal(await stores[0].read(), null);
    const results = await Promise.all(stores.map(store => store.draw()));
    for (const result of results) {
      assert.deepEqual(result, results[0]);
      assert.equal(result.winners.length, 10);
      assert.equal(new Set(result.winners.map(winner => winner.account)).size, 10);
      for (const [index, winner] of result.winners.entries()) {
        assert.equal(winner.account, options.participants[winner.participantIndex]);
        assert.equal(winner.place, index + 1);
        assert.equal(winner.kind, index < 5 ? 'main' : 'reserve');
      }
    }
    assert.deepEqual(await createDrawStore(options).draw(), results[0]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a corrupt saved result fails closed instead of silently selecting another winner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'giveaway-unit-'));
  try {
    const store = createDrawStore({ directory, participants: Array.from({ length: 20 }, (_, index) => `account_${index}`), sourceHash: 'test-pool' });
    const draw = await store.draw();
    draw.winners[0].account = 'someone_else';
    await writeFile(join(directory, 'draw-test-pool.json'), JSON.stringify(draw));
    await assert.rejects(store.draw(), /does not match/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('empty pools and duplicate accounts are rejected', () => {
  assert.throws(() => createDrawStore({ directory: '.', participants: [], sourceHash: 'test' }));
  assert.throws(() => createDrawStore({ directory: '.', participants: ['alpha', 'alpha'], sourceHash: 'test' }));
  assert.throws(() => createDrawStore({ directory: '.', participants: ['alpha'], sourceHash: 'test' }), /Not enough/);
});

test('custom main/reserve counts and film timing cover single, default and paginated results', () => {
  assert.equal(filmSettings(5, 5).duration, 45);
  assert.equal(filmSettings(1, 0).duration, 16);
  assert.equal(filmSettings(2, 1).duration, 22);
  for (const [main, reserve] of [[1, 0], [7, 0], [3, 9], [12, 3], [1, 161]]) {
    assert.deepEqual(validateCounts(main, reserve, 162), { main, reserve });
    const settings = filmSettings(main, reserve);
    assert.ok(settings.duration >= settings.summaryStart + Math.ceil((main + reserve) / 10) * 8.2);
  }
  for (const values of [[0, 1], [-1, 1], [1, -1], [1.5, 0], [1, 2.5], [160, 5]]) assert.throws(() => validateCounts(...values, 162));
});
