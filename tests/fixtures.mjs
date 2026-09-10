import { createHash } from 'node:crypto';
const participants = Array.from({ length: 162 }, (_, i) => `test_account_${(i + 1).toString(36).padStart(3, '0')}`);
export const fixture = {
  sourceFile: 'Участники_прошедшие_проверку_совместимый.xlsx',
  sourceHash: createHash('sha256').update(participants.join('\n')).digest('hex'),
  participants,
};
