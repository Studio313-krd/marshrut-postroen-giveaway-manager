import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { assert, newContest, configure, event, normalizeComments, parseCSV, publicContest, freeze, drawNext, evaluate, review, digest,acceptSelection,totalPlaces } from './domain.js';
import { demoContest } from './demo.js';
import { InstagramCollector } from './collector.js';
import { createAuth } from './auth.js';
import { commentsWorkbook,readWorkbook } from './excel.js';
import { createPrompt } from './prompt.js';
import { collectedImport } from './collection-import.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const dataDir=resolve(process.env.CONTEST_DATA_DIR||resolve(root,'data'));
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(resolve(dataDir,'contests.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS contests (id TEXT PRIMARY KEY, body TEXT NOT NULL);');
const save=c=>db.prepare('INSERT INTO contests (id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(c.id,JSON.stringify(c));
const get=id=>{const row=db.prepare('SELECT body FROM contests WHERE id=?').get(id);assert(row,'Конкурс не найден.',404);return JSON.parse(row.body);};
const all=()=>db.prepare('SELECT body FROM contests ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body));
for(const c of all())if(!c.snapshot&&c.workflow!=='external'&&!c.demo){c.workflow='external';c.conditions='';c.selectedComments=[];save(c);}
const collector=new InstagramCollector(dataDir);
const port=Number(process.env.PORT||4310);
const host=process.env.HOST||'127.0.0.1';
const publicURL=process.env.PUBLIC_URL||`http://127.0.0.1:${port}`;
const auth=createAuth(dataDir,publicURL);
function json(res,data,status=200) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data)); }
async function body(req) {
  let size=0; const chunks=[]; for await(const chunk of req) {size+=chunk.length;assert(size<=25*1024*1024,'Файл слишком большой: максимум 25 МБ.',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{assert(false,'Некорректный JSON.');}
}
function csv(rows) {return '\uFEFF'+rows.map(row=>row.map(value=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}).join(';')).join('\r\n');}
function attach(res,text,type,name) {res.writeHead(200,{'Content-Type':type,'Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'no-store'});res.end(text);}
function importInto(c, rows, source) {
  assert(!c.snapshot,'Список зафиксирован; импорт закрыт.',409);
  const imported=collectedImport(c.comments,rows,source);const comments=imported.comments;source=imported.source;
  if(digest(c.comments)===digest(comments))return;
  c.comments=comments;c.source={...source,count:c.comments.length};c.acknowledged=false;c.sourceAccepted=false;c.selectedComments=[];c.selection=null;c.overrides={};event(c,'comments_imported',{...c.source,hash:digest(c.comments)});save(c);
}
const server=http.createServer(async(req,res)=>{
  try {
    const expectedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,new URL(publicURL).host]);
    assert(expectedHosts.has(req.headers.host),'Недопустимый адрес сервера.',403);
    if(req.headers.origin) assert([`http://127.0.0.1:${port}`,`http://localhost:${port}`,new URL(publicURL).origin].includes(req.headers.origin),'Запрос с другого сайта запрещён.',403);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
    const url=new URL(req.url,`http://${host}:${port}`);const path=url.pathname;
    if(path==='/healthz')return json(res,{ok:true});
    if(path==='/robots.txt')return attach(res,'User-agent: *\nDisallow: /\n','text/plain','robots.txt');
    const session=auth.session(req);
    if(path==='/api/session'&&req.method==='GET')return json(res,{authenticated:!!session,csrf:session?.csrf,username:session?.username,setupRequired:auth.setupRequired,version:'2.0.0'});
    if(['/api/login','/api/setup'].includes(path)&&req.method==='POST') {assert(req.headers['content-type']?.startsWith('application/json'),'Нужен JSON.',415);const logged=await auth.login(req,res,await body(req),path==='/api/setup');return json(res,{authenticated:true,csrf:logged.csrf,username:'admin'});}
    if(path.startsWith('/api/'))assert(session,'Войдите в аккаунт.',401);
    if(path.startsWith('/api/') && !['GET','HEAD'].includes(req.method)) assert(req.headers['x-csrf-token']===session.csrf,'Обновите страницу: сессия приложения изменилась.',403);
    if(path==='/api/logout'&&req.method==='POST'){auth.logout(req,res);return json(res,{ok:true});}
    if(path==='/api/contests' && req.method==='GET')return json(res,all().map(c=>({id:c.id,name:c.name,reelUrl:c.reelUrl,createdAt:c.createdAt,demo:c.demo,frozen:!!c.snapshot,places:c.draw?.results.length||0,totalPlaces:totalPlaces(c),results:c.draw?.results||[],reviews:c.reviews,stats:evaluate(c).stats})));
    if(path==='/api/contests' && req.method==='POST') {const input=await body(req);const c=newContest({...input,name:input.name||'Конкурс · '+new Date().toLocaleDateString('ru-RU')});c.workflow='external';c.conditions='';c.selectedComments=[];c.winnerCount=5;c.reserveCount=5;save(c);return json(res,publicContest(c),201);}
    if(path==='/api/demo' && req.method==='POST') {const c=demoContest();save(c);return json(res,publicContest(c),201);}
    if(path==='/api/collector' && req.method==='GET')return json(res,collector.status());
    const match=path.match(/^\/api\/contests\/([\w-]+)(?:\/(.+))?$/);
    if(match) {
      const [,id,action]=match;let c=get(id);
      if(!action && req.method==='GET')return json(res,publicContest(c));
      if(!action && req.method==='PATCH') {const input=await body(req);c=get(id);configure(c,input);save(c);return json(res,publicContest(c));}
      if(action==='prompt'&&req.method==='POST'){const input=await body(req);c=get(id);configure(c,{conditions:input.conditions});assert(c.conditions,'Введите условия конкурса.');c.prompt=createPrompt(c);event(c,'prompt_created',{conditionsHash:digest(c.conditions)});save(c);return json(res,publicContest(c));}
      if(action==='selection'&&req.method==='POST'){const input=await body(req);assert(typeof input.base64==='string','Загрузите Excel.');const rows=await readWorkbook(Buffer.from(input.base64,'base64'));c=get(id);acceptSelection(c,rows,input.filename);save(c);return json(res,publicContest(c));}
      if(action==='export/comments.xlsx'&&req.method==='GET'){assert(c.comments.length,'Сначала соберите комментарии.');return attach(res,await commentsWorkbook(c.comments),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',`comments-${id}.xlsx`);}
      if(action==='export/selected.xlsx'&&req.method==='GET')return attach(res,await commentsWorkbook((c.snapshot?.payload.participants||evaluate(c).rows).map(r=>r.comment)),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',`participants-${id}.xlsx`);
      if(action==='import'&&req.method==='POST') {
        const input=await body(req);c=get(id);let rows=input.content;
        if(typeof rows==='string') { if(input.format==='csv')rows=parseCSV(rows);else {try{rows=JSON.parse(rows.replace(/^\uFEFF/,''));}catch{assert(false,'Не удалось прочитать JSON.');}} }
        if(rows?.reelUrl)assert(new URL(reelSafe(rows.reelUrl)).pathname===new URL(c.reelUrl).pathname,'Выгрузка относится к другому рилсу.');
        importInto(c,rows,{kind:'file',label:String(input.filename||'Импорт файла').slice(0,200),at:new Date().toISOString(),completeness:rows?.source?.completeness==='partial'?'partial':'unverified',reportedCount:Number.isInteger(rows?.source?.reportedCount)?rows.source.reportedCount:null,terminalCommentSeen:rows?.source?.terminalCommentSeen===true,reachedEnd:rows?.source?.reachedEnd===true,loginRequired:rows?.source?.loginRequired===true});return json(res,publicContest(c));
      }
      if(action==='override'&&req.method==='POST') {
        const input=await body(req);c=get(id);assert(!c.snapshot,'Список уже зафиксирован.',409);
        assert(evaluate(c).rows.some(r=>r.username===input.username),'Участник не найден.');
        assert(typeof input.eligible==='boolean' && String(input.reason||'').trim(),'Укажите решение и его причину.');
        c.overrides[input.username]={eligible:input.eligible,reason:String(input.reason).trim().slice(0,1000),at:new Date().toISOString()};c.acknowledged=false;
        event(c,'manual_decision',{username:input.username,...c.overrides[input.username]});save(c);return json(res,publicContest(c));
      }
      if(action==='freeze'&&req.method==='POST') {const input=await body(req);c=get(id);c.acknowledged=input.acknowledged===true;c.sourceAccepted=input.sourceAccepted===true;freeze(c);save(c);return json(res,publicContest(c));}
      if(action==='draw'&&req.method==='POST') {
        const input=await body(req);c=get(id);assert(Number.isInteger(input.expectedRank)&&input.expectedRank>=1&&input.expectedRank<=totalPlaces(c),'Укажите ожидаемое место.');
        // Retry after a dropped response returns the already saved place instead of drawing again.
        const previous=c.draw?.results.find(r=>r.rank===input.expectedRank);
        if(previous)return json(res,{result:previous,contest:publicContest(c)});
        assert(input.expectedRank===(c.draw?.results.length||0)+1,'Обновите результаты перед следующим местом.',409);
        const result=drawNext(c);save(c);return json(res,{result,contest:publicContest(c)});
      }
      if(action==='review'&&req.method==='POST') {const input=await body(req);c=get(id);review(c,input.username,input);save(c);return json(res,publicContest(c));}
      if(action==='collector/open'&&req.method==='POST') {assert(!c.snapshot,'Список уже зафиксирован.',409);return json(res,await collector.open(c,{headless:process.env.COLLECTOR_HEADLESS!=='false'}));}
      if(action==='collect'&&req.method==='POST') {
        assert(!c.snapshot,'Список уже зафиксирован.',409);
        if(collector.job&&collector.job.contestId!==id&&!['closed','error','collected','paused','ready'].includes(collector.job.status))assert(false,'Уже идёт сбор другого конкурса.',409);
        if(collector.job?.contestId===id&&['opening','collecting'].includes(collector.job.status))return json(res,collector.status());
        if(collector.job)await collector.close();
        collector.open(c,{headless:process.env.COLLECTOR_HEADLESS!=='false'}).then(async()=>{await collector.collect();await collector.loopPromise;const current=get(id);if(!current.snapshot&&collector.job?.contestId===id&&collector.job.comments.size){const imported=collector.export(id);importInto(current,imported.comments,imported.source);}}).catch(()=>{});
        return json(res,collector.status(),202);
      }
      if(action?.startsWith('collector/')&&req.method==='POST') {
        assert(collector.job?.contestId===id,'Сбор открыт для другого конкурса.',409);
        if(action==='collector/start')return json(res,await collector.collect());
        if(action==='collector/stop')return json(res,collector.stop());
        if(action==='collector/close') {await collector.close();return json(res,collector.status());}
        if(action==='collector/import') {const imported=collector.export(id);c=get(id);importInto(c,imported.comments,imported.source);return json(res,publicContest(c));}
      }
      if(action==='export/comments'&&req.method==='GET')return attach(res,JSON.stringify({reelUrl:c.reelUrl,source:c.source,comments:c.comments},null,2),'application/json; charset=utf-8',`comments-${id}.json`);
      if(action==='export/participants'&&req.method==='GET')return attach(res,csv([['username','eligible','comment','locations','friend','comment_count','reason'],...evaluate(c).rows.map(r=>[r.username,r.eligible?'yes':'no',r.comment.text,r.locations.join(', '),r.friends.join(', '),r.count,r.override?.reason||r.reasons.join('; ')])]),'text/csv; charset=utf-8',`participants-${id}.csv`);
      if(action==='export/results'&&req.method==='GET')return attach(res,csv([['place','username','group','verification','like','follow','save','share','note'],...(c.draw?.results||[]).map(r=>{const v=c.reviews[r.username];return[r.rank,r.username,r.group,v?.status||'pending',v?.checks.like||false,v?.checks.follow||false,v?.checks.save||false,v?.checks.share||false,v?.note||''];})]),'text/csv; charset=utf-8',`results-${id}.csv`);
      if(action==='export/audit'&&req.method==='GET') {const audit=publicContest(c);delete audit.evaluation;return attach(res,JSON.stringify(audit,null,2),'application/json; charset=utf-8',`audit-${id}.json`);}
    }
    if(path.startsWith('/api/'))return json(res,{error:'Метод не найден.'},404);
    assert(req.method==='GET'||req.method==='HEAD','Метод не поддерживается.',405);
    const publicDir=resolve(root,'public');const file=resolve(publicDir,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    assert(file.startsWith(publicDir+sep)&&existsSync(file),'Файл не найден.',404);
    const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:readFileSync(file));
  } catch(error) {if(!res.headersSent)json(res,{error:error.status?error.message:'Не удалось выполнить операцию. '+error.message.split('\n')[0]},error.status||500);else res.end();}
});
function reelSafe(value) {let u;try{u=new URL(value);}catch{assert(false,'Некорректная ссылка в выгрузке.');}return u.href;}
server.listen(port,host,()=>console.log(`Конкурсы Маршрут-Построен: http://${host}:${port}`));
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Порт ${port} занят. Приложение, возможно, уже открыто.`:error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{collector.close().finally(()=>server.close(()=>{db.close();process.exit(0);}));});
