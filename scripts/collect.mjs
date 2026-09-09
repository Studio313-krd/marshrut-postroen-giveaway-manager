import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { InstagramCollector } from '../server/collector.js';
import { newContest, DEFAULT_URL } from '../server/domain.js';
import { setTimeout as delay } from 'node:timers/promises';
const arg=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const url=arg('--url')||DEFAULT_URL;const headless=process.argv.includes('--headless');
const dir=resolve(arg('--data-dir')||'data/standalone-collector');mkdirSync(dir,{recursive:true});
const collector=new InstagramCollector(dir);const c=newContest({reelUrl:url});
try {
  await collector.open(c,{headless});console.log(collector.status().message);
  if(!headless){console.log('Откройте комментарии в Chrome, затем нажмите Enter. Вход нужен только если его запросит Instagram.');await new Promise(resolve=>process.stdin.once('data',resolve));}
  if(collector.status().status==='ready')await collector.collect();let last=-1;
  while(collector.status().status==='collecting'){const s=collector.status();if(s.count!==last){last=s.count;console.log(`${s.count} комментариев`);}await delay(1500);}
  const status=collector.status();console.log(status.message);
  if(status.count){const out=collector.export(c.id);out.reelUrl=c.reelUrl;out.source.count=out.comments.length;const file=resolve(arg('--out')||`data/comments-${new URL(url).pathname.split('/')[2]}.json`);writeFileSync(file,JSON.stringify(out,null,2));console.log(`Сохранено ${out.comments.length} комментариев: ${file}`);}
  else process.exitCode=2;
}catch(error){console.error(error.message);process.exitCode=1;}finally{await collector.close();process.stdin.pause();}
