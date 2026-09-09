import { readFileSync } from 'node:fs';
import { digest, permutation } from '../server/domain.js';
const path=process.argv[2];
if(!path){console.error('Использование: npm run verify -- путь/к/audit.json [протокол-до-розыгрыша.json]');process.exit(1);}
try {
  const audit=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
  const total=(audit.snapshot?.payload.winnerCount??5)+(audit.snapshot?.payload.reserveCount??5);
  if(!audit.snapshot || !audit.draw?.seed || audit.draw.results.length!==total)throw new Error('Нужен финальный протокол после всех мест.');
  if(digest(audit.snapshot.payload)!==audit.snapshot.hash)throw new Error('Хеш списка не совпадает.');
  if(digest(audit.draw.seed)!==audit.draw.commitment)throw new Error('Обязательство по ключу не совпадает.');
  const users=audit.snapshot.payload.participants.map(r=>r.username);
  if(new Set(users).size!==users.length)throw new Error('В исходном списке есть повторные аккаунты.');
  if(process.argv[3]) {
    const before=JSON.parse(readFileSync(process.argv[3],'utf8'));
    if(before.snapshot?.hash!==audit.snapshot.hash || before.draw?.commitment!==audit.draw.commitment)throw new Error('Протокол до розыгрыша отличается от финального.');
  }
  const order=permutation(users,audit.draw.seed,audit.snapshot.hash).slice(0,total);
  audit.draw.results.forEach((r,i)=>{if(r.rank!==i+1||r.username!==order[i])throw new Error(`Несовпадение на месте ${i+1}.`);});
  console.log(`Проверено: ${users.length} уникальных участников, все ${total} мест совпадают.`);
  console.log(`SHA-256 списка: ${audit.snapshot.hash}`);
  console.log('Для проверки неизменности с момента старта сравните с отдельно сохранённым протоколом до розыгрыша.');
}catch(error){console.error('Проверка не пройдена: '+error.message);process.exit(1);}
