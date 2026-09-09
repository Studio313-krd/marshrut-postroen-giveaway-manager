import { mkdirSync,writeFileSync,renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { reelURL,normalizeComments } from './domain.js';
import { readDOMComments } from './dom-comments.js';
import { inspectCommentPane,findReplyControls,hasTerminalComment,completionEvidence } from './comment-scroll.js';

export function mediaIdFromURL(url){const code=new URL(reelURL(url)).pathname.split('/')[2],alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let id=0n;for(const char of code)id=id*64n+BigInt(alphabet.indexOf(char));return id.toString();}
export function extractComments(body){
  const found=[];
  function comment(node,parentId=''){
    const user=node.user?.username??node.owner?.username??node.username,id=node.pk??node.id;if(!user||!id||typeof node.text!=='string')return;
    found.push({id:String(id),username:user,text:node.text,timestamp:node.created_at??node.created_at_utc??node.timestamp??'',parentId});
    for(const child of node.preview_child_comments??node.child_comments??[])comment(child,String(id));
    for(const edge of node.edge_threaded_comments?.edges??[])comment(edge.node,String(id));
  }
  function walk(value){
    if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(walk);return;}
    for(const[key,child]of Object.entries(value)){
      if(['comments','preview_comments','child_comments'].includes(key)&&Array.isArray(child))child.forEach(n=>comment(n,key==='child_comments'?String(value.parent_comment_id??'reply'):''));
      else if(/edge_media_to_parent_comment|edge_media_to_comment|xdt_api__v1__media__media_id__comments/.test(key)){if(child?.edges)child.edges.forEach(e=>comment(e.node));else if(child?.comments)child.comments.forEach(n=>comment(n));}
      else if(!['caption','user','owner'].includes(key))walk(child);
    }
  }walk(body);return found;
}
export class InstagramCollector{
  constructor(dataDir){this.dataDir=dataDir;this.job=null;this.responseTasks=new Set();this.loopPromise=null;}
  status(){if(!this.job)return null;const{context,page,comments,replyAttempts,...safe}=this.job;return{...safe,count:comments.size};}
  async open(contest,options={}){
    if(this.job&&!['closed','error'].includes(this.job.status))throw Object.assign(new Error('Сначала завершите текущую загрузку Instagram.'),{status:409});
    if(this.job?.context)await this.close();
    const profile=resolve(this.dataDir,'instagram-profile');mkdirSync(profile,{recursive:true});
    const job=this.job={contestId:contest.id,reelUrl:contest.reelUrl,owner:contest.owner,status:'opening',message:'Открываем Chrome…',comments:new Map(),startedAt:new Date().toISOString(),rounds:0,context:null,page:null,stop:false,completeness:'partial',terminalCommentSeen:false,reachedEnd:false,replyAttempts:new Map(),stablePasses:0,atBottom:false};
    try{
      const{chromium}=await import('playwright');job.context=await chromium.launchPersistentContext(profile,{...(process.platform==='win32'?{channel:'chrome'}:{}),headless:options.headless===true,viewport:{width:1280,height:900},args:['--disable-background-timer-throttling']});job.page=job.context.pages()[0]||await job.context.newPage();
      job.context.on('close',()=>{job.stop=true;job.status='closed';job.message='Окно закрыто. Собранные комментарии сохранены.';this.persist(job);});this.watchResponses(job);
      await job.page.goto(job.reelUrl,{waitUntil:'domcontentloaded',timeout:60000});await job.page.waitForTimeout(1800);await this.captureDOM(job);
      job.status='ready';job.message='Откройте комментарии и нажмите «Начать сбор». Если Instagram запросит вход, войдите в этом окне.';
    }catch(error){job.status='error';job.message=`Не удалось открыть Instagram: ${error.message.split('\n')[0]}`;throw new Error(job.message);}return this.status();
  }
  watchResponses(job){
    const id=mediaIdFromURL(job.reelUrl),code=new URL(job.reelUrl).pathname.split('/')[2];
    job.page.on('response',response=>{const task=(async()=>{
      try{
        const url=new URL(response.url());if(!/(^|\.)instagram\.com$/.test(url.hostname))return;
        const direct=url.pathname.includes(`/media/${id}/comments/`),replyParent=url.pathname.match(/\/comments\/(\d+)\/child_comments/);let requestBody=response.request().postData()||'';try{requestBody=decodeURIComponent(requestBody);}catch{}
        const graphql=url.pathname.includes('/graphql')&&(requestBody.includes(id)||requestBody.includes(code));if(!direct&&!graphql)return;
        if([429,401,403].includes(response.status())){job.stop=true;job.status='paused';job.completeness='partial';job.message='Instagram ограничил доступ. Сбор остановлен; полученное сохранено.';return;}if(!response.ok())return;
        const body=await response.json();for(const row of extractComments(body)){if(replyParent)row.parentId=replyParent[1];this.add(job,row,true);}
        if(direct&&!replyParent){const count=body.comment_count??body.total_comment_count;if(Number.isInteger(count))job.reportedCount=count;if(body.has_more_comments===false&&body.has_more_headload_comments!==true)job.apiEndSeen=true;}
      }catch{}
    })();this.responseTasks.add(task);task.finally(()=>this.responseTasks.delete(task));});
  }
  add(job,row,fromNetwork=false){try{const[n]=normalizeComments([row]),old=job.comments.get(n.id);job.comments.set(n.id,{...n,parentId:fromNetwork?n.parentId:(old?.parentId||n.parentId)});}catch{}}
  async collect(){
    if(!this.job?.page||!['ready','paused','collected'].includes(this.job.status)||this.loopPromise)throw Object.assign(new Error('Сначала откройте Instagram или дождитесь завершения текущего сбора.'),{status:409});
    const job=this.job;job.status='collecting';job.stop=false;job.loginRequired=false;job.reachedEnd=false;job.stablePasses=0;job.completeness='partial';job.message='Прокручиваем окно комментариев и сохраняем каждую загруженную порцию.';
    this.loopPromise=this.loop(job).catch(error=>{job.status='error';job.completeness='partial';job.message=`Сбор прерван: ${error.message.split('\n')[0]}. Полученное сохранено.`;}).finally(()=>{this.persist(job);this.loopPromise=null;});return this.status();
  }
  async loop(job){
    const code=new URL(job.reelUrl).pathname.split('/')[2];let previousCount=job.comments.size,lastHeight=0;
    await job.page.evaluate(inspectCommentPane,{code,reset:true});
    for(let round=0;round<1200&&!job.stop;round++){
      if(job.page.isClosed())break;await this.captureDOM(job);
      const gate=job.page.getByText(/Посмотрите, что говорят люди о публикации|See what people are saying about/).first();
      if(/\/accounts\/login|\/challenge|\/checkpoint/.test(job.page.url())||await gate.isVisible().catch(()=>false)){job.loginRequired=true;job.status='paused';job.completeness='partial';job.message='Instagram запросил вход. Войдите в этом окне и продолжите; собранные комментарии сохранены.';return;}
      const teaser=job.page.getByText(/Не пропускайте публикации|Don.t miss out on/).first();if(await teaser.isVisible().catch(()=>false))await job.page.getByRole('button',{name:/^(Закрыть|Close)$/i}).first().click({timeout:1500}).catch(()=>{});
      let pane=await job.page.evaluate(inspectCommentPane,{code});
      if(!pane.found){if(round===0&&!job.comments.size)await job.page.getByRole('button',{name:/^(Комментировать|Comment)$/}).first().click({timeout:2000}).catch(()=>{});await job.page.waitForTimeout(1500);job.rounds++;if(round>=5){job.status='paused';job.message='Не найдено прокручиваемое окно комментариев. Откройте его в Chrome и продолжите сбор.';return;}continue;}
      const controls=await job.page.evaluate(findReplyControls,{code});let pending=0,expanded=false;
      for(const control of controls){const key=control.parentId+':'+control.text,attempts=job.replyAttempts.get(key)||0;pending++;if(attempts>=2)continue;job.replyAttempts.set(key,attempts+1);
        try{await job.page.locator(`[data-mp-replies="${control.index}"]`).click({timeout:1800});await job.page.waitForTimeout(850);await this.captureDOM(job);expanded=true;}catch{}break;
      }
      // Never click the public "view all/load more comments" teaser: it opens a
      // login invitation. Let the inner pane load batches as it scrolls instead.
      if(!expanded)await job.page.evaluate(inspectCommentPane,{code,advance:true});
      await job.page.waitForTimeout(1400);await this.captureDOM(job);await Promise.allSettled([...this.responseTasks]);pane=await job.page.evaluate(inspectCommentPane,{code});
      job.rounds++;job.atBottom=!!pane.bottom;job.pendingReplies=pending;const unchanged=job.comments.size===previousCount&&pane.height===lastHeight&&!expanded;
      job.stablePasses=unchanged&&pane.bottom?job.stablePasses+1:0;previousCount=job.comments.size;lastHeight=pane.height;job.scroll={top:Math.round(pane.top||0),height:pane.height||0,viewport:pane.viewport||0};
      job.message=`Собрано ${job.comments.size}${job.reportedCount?' из '+job.reportedCount:''}. ${job.terminalCommentSeen?'Комментарий с правилами найден. ':''}${pane.bottom?'Проверяем конец списка.':'Прокручиваем окно комментариев.'}`;this.persist(job);if(job.stablePasses>=5)break;
    }
    await Promise.allSettled([...this.responseTasks]);await this.captureDOM(job);
    const evidence=completionEvidence({count:job.comments.size,reportedCount:job.reportedCount,terminalCommentSeen:job.terminalCommentSeen,atBottom:job.atBottom,stablePasses:job.stablePasses,pendingReplies:job.pendingReplies,stopped:job.stop,loginRequired:job.loginRequired});Object.assign(job,evidence);
    if(!['paused','closed'].includes(job.status)){job.status='collected';job.message=job.stop?'Сбор остановлен. Полученные комментарии сохранены.':evidence.reachedEnd?`Достигнут конец окна: ${job.comments.size} комментариев.${job.terminalCommentSeen?' Последний комментарий медиагида с правилами найден.':''}${evidence.completeness==='partial'?' Количество отличается от счётчика Instagram — требуется сверка.':' Можно импортировать список и проверить участников.'}`:'Загрузка не завершена. Продолжите сбор после раскрытия оставшихся ответов.';}
  }
  async captureDOM(job=this.job){
    if(!job?.page||job.page.isClosed())return;const code=new URL(job.reelUrl).pathname.split('/')[2],rows=await job.page.evaluate(readDOMComments,code);rows.forEach(row=>this.add(job,row));job.domCount=rows.length;job.terminalCommentSeen=job.terminalCommentSeen||hasTerminalComment(rows,job.owner);
    const reported=await job.page.evaluate(()=>{const buttons=[...document.querySelectorAll('button,[role="button"]')],index=buttons.findIndex(b=>b.querySelector('svg[aria-label="Комментировать"],svg[aria-label="Comment"]'));const value=index>=0?buttons[index+1]?.textContent?.replace(/[\s\u00a0]/g,''):'';return /^\d+$/.test(value||'')?Number(value):null;});if(reported!==null)job.reportedCount=reported;
  }
  persist(job=this.job){if(!job?.comments.size)return;const folder=resolve(this.dataDir,'collections');mkdirSync(folder,{recursive:true});const file=resolve(folder,`${new URL(job.reelUrl).pathname.split('/')[2]}.json`);writeFileSync(file+'.tmp',JSON.stringify(this.payload(job),null,2));renameSync(file+'.tmp',file);}
  payload(job=this.job){return{reelUrl:job.reelUrl,comments:[...job.comments.values()],source:{kind:'browser',label:'Instagram · окно комментариев',at:new Date().toISOString(),completeness:job.completeness,reportedCount:job.reportedCount??null,reachedEnd:!!job.reachedEnd,terminalCommentSeen:!!job.terminalCommentSeen,loginRequired:!!job.loginRequired,pendingReplies:job.pendingReplies||0,rounds:job.rounds}};}
  stop(){if(this.job){this.job.stop=true;this.job.message='Завершаем текущую порцию и сохраняем комментарии…';}return this.status();}
  async close(){const job=this.job;if(job){job.stop=true;await this.loopPromise;this.persist(job);await job.context?.close();job.status='closed';}}
  export(contestId){if(this.job?.contestId!==contestId||!this.job.comments.size)throw Object.assign(new Error('Нет собранных комментариев для этого конкурса.'),{status:400});if(this.loopPromise)throw Object.assign(new Error('Дождитесь завершения текущей порции.'),{status:409});return this.payload();}
}
