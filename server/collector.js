import { mkdirSync,writeFileSync,renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { reelURL,normalizeComments } from './domain.js';
import { readDOMComments } from './dom-comments.js';
import { inspectCommentPane,findReplyControls,hasTerminalComment,completionEvidence } from './comment-scroll.js';
import { dismissLoginInvitation } from './instagram-dialog.js';
import { locateCommentsControl } from './instagram-comments-control.js';
import { instagramProxy } from './instagram-proxy.js';

export function mediaIdFromURL(url){const code=new URL(reelURL(url)).pathname.split('/')[2],alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let id=0n;for(const char of code)id=id*64n+BigInt(alphabet.indexOf(char));return id.toString();}
export function extractComments(body){
  const found=[];
  function comment(node,parentId=''){
    const user=node.user?.username??node.owner?.username??node.username,id=node.pk??node.id;if(!user||!id||typeof node.text!=='string')return;
    found.push({id:String(id),username:user,text:node.text,timestamp:node.created_at??node.created_at_utc??node.timestamp??'',parentId:parentId||String(node.parent_comment_id??'')});
    for(const child of node.preview_child_comments??node.child_comments??[])comment(child,String(id));
    for(const edge of node.edge_threaded_comments?.edges??[])comment(edge.node,String(id));
  }
  function walk(value){
    if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(walk);return;}
    for(const[key,child]of Object.entries(value)){
      if(['comments','preview_comments','child_comments'].includes(key)&&Array.isArray(child))child.forEach(n=>comment(n,key==='child_comments'?String(value.parent_comment_id??'reply'):''));
      else if(/^(?:comments_connection|edge_media_to_parent_comment|edge_media_to_comment|xdt_api__v1__media__media_id__comments(?:(?:__parent_comment_id__child_comments)?__connection)?)$/.test(key)){if(child?.edges)child.edges.forEach(e=>comment(e.node));else if(child?.comments)child.comments.forEach(n=>comment(n));}
      else if(!['caption','user','owner'].includes(key))walk(child);
    }
  }walk(body);return found;
}
export function commentPageInfo(body){
  let info=null;
  function walk(value){if(!value||typeof value!=='object')return;for(const[key,child]of Object.entries(value)){if(/^(?:comments_connection|edge_media_to_parent_comment|edge_media_to_comment|xdt_api__v1__media__media_id__comments(?:__connection)?)$/.test(key)&&typeof child?.page_info?.has_next_page==='boolean')info={hasNextPage:child.page_info.has_next_page};else if(!['caption','user','owner'].includes(key))walk(child);}}
  walk(body);return info;
}
export class InstagramCollector{
  constructor(dataDir){this.dataDir=dataDir;this.job=null;this.responseTasks=new Set();this.loopPromise=null;}
  status(){if(!this.job)return null;const{context,page,comments,replyAttempts,blockedPaths,...safe}=this.job;return{...safe,count:comments.size,browserAvailable:!!page&&!page.isClosed()};}
  async open(contest,options={}){
    if(this.job&&!['closed','error'].includes(this.job.status))throw Object.assign(new Error('Сначала завершите текущую загрузку Instagram.'),{status:409});
    if(this.job?.context)await this.close();
    const profile=resolve(this.dataDir,'instagram-profile');mkdirSync(profile,{recursive:true});
    const job=this.job={contestId:contest.id,reelUrl:contest.reelUrl,owner:contest.owner,status:'opening',message:'Открываем Chrome…',comments:new Map(),startedAt:new Date().toISOString(),rounds:0,context:null,page:null,stop:false,completeness:'partial',terminalCommentSeen:false,reachedEnd:false,replyAttempts:new Map(),blockedPaths:new Set(),stablePasses:0,atBottom:false,headed:options.headless!==true};
    try{
      const{chromium}=await import('playwright');job.context=await chromium.launchPersistentContext(profile,{...(process.platform==='win32'?{channel:'chrome'}:{}),headless:options.headless===true,proxy:instagramProxy(),viewport:{width:1280,height:900},args:['--disable-background-timer-throttling']});job.page=job.context.pages()[0]||await job.context.newPage();
      job.context.on('close',()=>{job.stop=true;job.status='closed';job.message='Окно закрыто. Собранные комментарии сохранены.';this.persist(job);});
      await job.context.route('**/*',route=>{const url=new URL(route.request().url());return job.blockedPaths.has(url.origin+url.pathname)?route.abort():route.continue();});this.watchResponses(job);
      await job.page.goto(job.reelUrl,{waitUntil:'domcontentloaded',timeout:60000});await job.page.waitForTimeout(1800);await dismissLoginInvitation(job.page);await this.captureDOM(job);
      const initial=await job.page.evaluate(code=>{let result=null;function walk(v){if(!v||typeof v!=='object')return;if(v.xig_polaris_media?.code===code){result=v.xig_polaris_media;return;}for(const c of Object.values(v))if(c&&typeof c==='object')walk(c);}for(const script of document.querySelectorAll('script[type="application/json"]')){try{walk(JSON.parse(script.textContent));}catch{}if(result)break;}return result;},new URL(job.reelUrl).pathname.split('/')[2]);
      if(initial){for(const row of extractComments(initial))this.add(job,row,true);Object.assign(job,commentPageInfo(initial));const count=initial.if_not_gated_logged_out?.comment_count;if(Number.isInteger(count))job.reportedCount=count;}
      if(job.accessLimited)return this.status();
      job.status='ready';job.message='Откройте комментарии и нажмите «Начать сбор». Если Instagram запросит вход, войдите в этом окне.';
    }catch(error){if(job.accessLimited)return this.status();job.status='error';job.message=/ERR_NAME_NOT_RESOLVED/.test(error.message)?'Не удалось определить адрес Instagram. Проверьте DNS и доступ к Instagram на компьютере или сервере, где запущен сборщик.':/ERR_TIMED_OUT|Timeout/.test(error.message)?'Instagram не ответил за 60 секунд. Проверьте доступ к Instagram с компьютера или сервера, где запущен сборщик.':`Не удалось открыть Instagram: ${error.message.split('\n')[0]}`;throw new Error(job.message);}return this.status();
  }
  watchResponses(job){
    const id=mediaIdFromURL(job.reelUrl),code=new URL(job.reelUrl).pathname.split('/')[2];
    job.page.on('response',response=>{const task=(async()=>{
      try{
        const url=new URL(response.url());if(!/(^|\.)instagram\.com$/.test(url.hostname))return;
        const direct=url.pathname.includes(`/media/${id}/comments/`),replyParent=url.pathname.match(/\/comments\/(\d+)\/child_comments/);let requestBody=response.request().postData()||'';try{requestBody=decodeURIComponent(requestBody);}catch{}
        const graphql=url.pathname.includes('/graphql')&&(requestBody.includes(id)||requestBody.includes(code));
        if(response.status()===429){job.blockedPaths?.add(url.origin+url.pathname);job.lastLimitedEndpoint=url.pathname;}
        if([429,401,403].includes(response.status())&&(direct||graphql)){job.stop=true;job.accessLimited=true;job.accessStatus=response.status();job.accessEndpoint=url.pathname;job.status='paused';job.completeness='partial';job.message='Instagram ограничил доступ к комментариям. Сбор остановлен; полученное сохранено. Повторите позже.';this.persist(job);if(!job.headed)await job.page.close().catch(()=>{});return;}
        if(!direct&&!graphql)return;if(!response.ok())return;
        const body=await response.json();for(const row of extractComments(body)){if(replyParent)row.parentId=replyParent[1];this.add(job,row,true);}
        if(!replyParent)Object.assign(job,commentPageInfo(body));
        if(direct&&!replyParent){const count=body.comment_count??body.total_comment_count;if(Number.isInteger(count))job.reportedCount=count;if(body.has_more_comments===false&&body.has_more_headload_comments!==true)job.apiEndSeen=true;}
      }catch{}
    })();this.responseTasks.add(task);task.finally(()=>this.responseTasks.delete(task));});
  }
  add(job,row,fromNetwork=false){try{const[n]=normalizeComments([row]),old=job.comments.get(n.id);if(old&&!fromNetwork)return;job.comments.set(n.id,n);}catch{}}
  async collect(){
    if(!this.job?.page||this.job.accessLimited||!['ready','paused','collected'].includes(this.job.status)||this.loopPromise)throw Object.assign(new Error(this.job?.accessLimited?this.job.message:'Сначала откройте Instagram или дождитесь завершения текущего сбора.'),{status:409});
    const job=this.job;job.status='collecting';job.stop=false;job.loginRequired=false;job.reachedEnd=false;job.stablePasses=0;job.completeness='partial';job.message='Прокручиваем окно комментариев и сохраняем каждую загруженную порцию.';
    this.loopPromise=this.loop(job).catch(error=>{if(job.accessLimited)return;job.status='error';job.completeness='partial';job.message=`Сбор прерван: ${error.message.split('\n')[0]}. Полученное сохранено.`;}).finally(()=>{this.persist(job);this.loopPromise=null;});return this.status();
  }
  async loop(job){
    const code=new URL(job.reelUrl).pathname.split('/')[2];let previousCount=job.comments.size,lastHeight=0,lastProgress=Date.now(),lastNudge=Date.now();
    await job.page.evaluate(inspectCommentPane,{code,reset:true});
    for(let round=0;round<1200&&!job.stop;round++){
      if(job.page.isClosed())break;await dismissLoginInvitation(job.page);await this.captureDOM(job);
      const gate=job.page.getByText(/Посмотрите, что говорят люди о публикации|See what people are saying about/).first();
      if(/\/accounts\/login|\/challenge|\/checkpoint/.test(job.page.url())||await gate.isVisible().catch(()=>false)){job.loginRequired=true;job.status='paused';job.completeness='partial';job.message='Instagram запросил вход. Войдите в этом окне и продолжите; собранные комментарии сохранены.';return;}
      const teaser=job.page.getByText(/Не пропускайте публикации|Don.t miss out on/).first();if(await teaser.isVisible().catch(()=>false))await job.page.getByRole('button',{name:/^(Закрыть|Close)$/i}).first().click({timeout:1500}).catch(()=>{});
      let pane=await job.page.evaluate(inspectCommentPane,{code});
      if(!pane.found){if(round===0&&await job.page.evaluate(locateCommentsControl,code))await job.page.locator('[data-mp-open-comments]').click({timeout:2500}).catch(()=>{});await job.page.waitForTimeout(1500);job.rounds++;if(round>=5){job.status='paused';job.message='Не найдено прокручиваемое окно комментариев. Откройте его в Chrome и продолжите сбор.';return;}continue;}
      const controls=await job.page.evaluate(findReplyControls,{code});let pending=0,expanded=false;
      for(const control of controls){const key=control.parentId+':'+control.text,attempts=job.replyAttempts.get(key)||0;pending++;if(attempts>=2)continue;job.replyAttempts.set(key,attempts+1);
        try{await job.page.locator(`[data-mp-replies="${control.index}"]`).click({timeout:1800});await job.page.waitForTimeout(850);await this.captureDOM(job);expanded=true;}catch{}break;
      }
      // Never click the public "view all/load more comments" teaser: it opens a
      // login invitation. Let the inner pane load batches as it scrolls instead.
      if(!expanded)await job.page.evaluate(inspectCommentPane,{code,advance:true});
      await job.page.waitForTimeout(1400);await this.captureDOM(job);await Promise.allSettled([...this.responseTasks]);pane=await job.page.evaluate(inspectCommentPane,{code});
      job.rounds++;job.atBottom=!!pane.bottom;job.loading=!!pane.loading;job.pendingReplies=pending;const unchanged=job.comments.size===previousCount&&pane.height===lastHeight&&!expanded;
      if(!unchanged)lastProgress=Date.now();
      job.stablePasses=unchanged&&pane.bottom&&!pane.loading&&job.hasNextPage!==true?job.stablePasses+1:0;previousCount=job.comments.size;lastHeight=pane.height;job.scroll={top:Math.round(pane.top||0),height:pane.height||0,viewport:pane.viewport||0};
      if(pane.bottom&&Date.now()-lastProgress>20000&&Date.now()-lastNudge>20000){await job.page.mouse.move(pane.x,pane.y);await job.page.mouse.wheel(0,-Math.max(160,pane.viewport*.8));await job.page.waitForTimeout(350);await job.page.mouse.wheel(0,Math.max(200,pane.viewport));lastNudge=Date.now();}
      if(pane.bottom&&Date.now()-lastProgress>90000){job.status='paused';job.completeness='partial';job.message=`Instagram не загрузил следующую порцию за 90 секунд. Сохранено ${job.comments.size}${job.reportedCount?' из '+job.reportedCount:''} комментариев. Сбор не завершён; попробуйте продолжить позже.`;return;}
      job.message=`Собрано ${job.comments.size}${job.reportedCount?' из '+job.reportedCount:''}. ${job.terminalCommentSeen?'Комментарий с правилами найден. ':''}${pane.bottom?'Проверяем конец списка.':'Прокручиваем окно комментариев.'}`;this.persist(job);if(job.stablePasses>=5)break;
    }
    await Promise.allSettled([...this.responseTasks]);await this.captureDOM(job);
    const evidence=completionEvidence({count:job.comments.size,reportedCount:job.reportedCount,terminalCommentSeen:job.terminalCommentSeen,atBottom:job.atBottom,stablePasses:job.stablePasses,pendingReplies:job.pendingReplies,stopped:job.stop,loginRequired:job.loginRequired,loading:job.loading,hasNextPage:job.hasNextPage});Object.assign(job,evidence);
    if(!['paused','closed'].includes(job.status)){job.status='collected';job.message=job.stop?'Сбор остановлен. Полученные комментарии сохранены.':evidence.reachedEnd?`Достигнут конец окна: ${job.comments.size} комментариев.${job.terminalCommentSeen?' Последний комментарий медиагида с правилами найден.':''}${evidence.completeness==='partial'?' Количество отличается от счётчика Instagram — требуется сверка.':' Можно импортировать список и проверить участников.'}`:'Загрузка не завершена. Продолжите сбор после раскрытия оставшихся ответов.';}
  }
  async captureDOM(job=this.job){
    if(!job?.page||job.page.isClosed())return;const code=new URL(job.reelUrl).pathname.split('/')[2],rows=await job.page.evaluate(readDOMComments,code);rows.forEach(row=>this.add(job,row));job.domCount=rows.length;job.terminalCommentSeen=job.terminalCommentSeen||hasTerminalComment(rows,job.owner);
    const control=await job.page.evaluate(locateCommentsControl,code);if(control?.count!=null)job.reportedCount=control.count;
  }
  persist(job=this.job){if(!job?.comments.size)return;const folder=resolve(this.dataDir,'collections');mkdirSync(folder,{recursive:true});const file=resolve(folder,`${new URL(job.reelUrl).pathname.split('/')[2]}.json`);writeFileSync(file+'.tmp',JSON.stringify(this.payload(job),null,2));renameSync(file+'.tmp',file);}
  payload(job=this.job){return{reelUrl:job.reelUrl,comments:[...job.comments.values()],source:{kind:'browser',label:'Instagram · окно комментариев',at:new Date().toISOString(),completeness:job.completeness,reportedCount:job.reportedCount??null,reachedEnd:!!job.reachedEnd,terminalCommentSeen:!!job.terminalCommentSeen,loginRequired:!!job.loginRequired,pendingReplies:job.pendingReplies||0,rounds:job.rounds}};}
  stop(){if(this.job){this.job.stop=true;this.job.message='Завершаем текущую порцию и сохраняем комментарии…';}return this.status();}
  async close(){const job=this.job;if(job){job.stop=true;await this.loopPromise;this.persist(job);await job.context?.close();job.status='closed';}}
  export(contestId){if(this.job?.contestId!==contestId||!this.job.comments.size)throw Object.assign(new Error('Нет собранных комментариев для этого конкурса.'),{status:400});if(this.loopPromise)throw Object.assign(new Error('Дождитесь завершения текущей порции.'),{status:409});return this.payload();}
}
