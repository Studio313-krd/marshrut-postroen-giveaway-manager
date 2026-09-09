const W=1920,H=1080,ACCENT='#db2a00',WHITE='#e5e5df';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const display=(size)=>`900 ${size}px DexaCondensed`;
const body=(size)=>`400 ${size}px Dexa`;
const visualRandom=n=>crypto.getRandomValues(new Uint32Array(1))[0]%n;
function fitText(ctx,text,width){let value=text;while(value.length>1&&ctx.measureText(value).width>width)value=value.slice(0,-1);return value===text?text:value+'…';}

export async function openStage({contest,draw,close,toast}) {
  if(!contest.snapshot)throw new Error('Сначала зафиксируйте список участников.');
  await document.fonts.ready;
  const winners=contest.snapshot.payload.winnerCount??5,reserves=contest.snapshot.payload.reserveCount??5,total=winners+reserves;
  const stage=document.createElement('section');stage.className='stage';stage.setAttribute('role','dialog');stage.setAttribute('aria-modal','true');stage.setAttribute('aria-label','Экран розыгрыша');
  stage.innerHTML=`<canvas class="stage-canvas" width="1920" height="1080" aria-label="Анимация розыгрыша и выбранные места"></canvas><div class="stage-toolbar"><span class="stage-label" id="stage-status">Список зафиксирован</span><label class="check"><input type="checkbox" id="record-choice" checked>Записывать видео</label><label class="check"><input type="checkbox" id="sound-choice" checked>Звук</label><button class="btn primary" id="next-place">Выбрать место</button><button class="btn light" id="auto-places">Снять видео и выбрать всех</button><button class="btn" id="stop-record" hidden>Завершить запись</button><button class="btn" id="download-video" hidden>Скачать видео</button><button class="icon-btn" id="stage-fullscreen" aria-label="Полный экран" title="Полный экран">⛶</button><button class="icon-btn" id="stage-close" aria-label="Закрыть розыгрыш" title="Закрыть">×</button></div><span class="stage-hint" id="stage-hint" aria-live="polite">Видео записывает только эту сцену. Результат каждого места сохраняется в приложении.</span>`;
  document.body.append(stage);document.body.style.overflow='hidden';
  const canvas=stage.querySelector('canvas');const ctx=canvas.getContext('2d',{alpha:false});
  const el=id=>stage.querySelector('#'+id);
  let c=contest;let results=[...c.draw.results];let spinning=false;let auto=false;let ended=false;let recording=false;let recorder=null;let chunks=[];let video=null;let videoURL=null;let recordingStream=null;let saved=false;let audioCtx=null;let audioDest=null;let animation=null;let drawState=null;let currentWinner=results.at(-1)||null;let lastTick=-1;let paintTimer;
  const participants=c.snapshot.payload.participants.map(r=>r.username);
  let visualPool=participants.filter(u=>!results.some(r=>r.username===u));
  const initial=Array.from({length:11},()=>visualPool[visualRandom(visualPool.length)]||participants[0]);
  function text(value,x,y,font,color=WHITE,align='left'){ctx.font=font;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(value,x,y);}
  function line(x1,y1,x2,y2,color='#ffffff22'){ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  function arrow(x,y,size,color=ACCENT){ctx.strokeStyle=color;ctx.lineWidth=size*.1;ctx.beginPath();ctx.moveTo(x,y+size);ctx.lineTo(x+size*.62,y+size);ctx.lineTo(x+size*.62,y);ctx.moveTo(x+size*.3,y+size*.32);ctx.lineTo(x+size*.62,y);ctx.lineTo(x+size*.94,y+size*.32);ctx.stroke();}
  function card(user,x,y,w,h,active=false){ctx.fillStyle=active?WHITE:'#24261f';ctx.fillRect(x,y,w,h);ctx.strokeStyle=active?WHITE:'#4a4d3e';ctx.strokeRect(x+.5,y+.5,w-1,h-1);const fg=active?'#070707':'#c1c7b6';ctx.fillStyle=active?ACCENT:'#3b4032';ctx.beginPath();ctx.arc(x+w/2,y+82,39,0,Math.PI*2);ctx.fill();text(user.slice(0,2).toUpperCase(),x+w/2,y+96,display(38),active?'#fff':'#d0d4c5','center');ctx.font=body(19);text(fitText(ctx,'@'+user,w-22),x+w/2,y+163,body(19),fg,'center');text(active?'МАРШРУТ К ПОБЕДЕ':'УЧАСТНИК КОНКУРСА',x+w/2,y+201,body(10),active?'#686b60':'#87907b','center');ctx.fillStyle=active?ACCENT:'#69725a';ctx.fillRect(x,y+h-5,w,5);}
  function paint(){
    if(ended)return;ctx.fillStyle='#0a0c08';ctx.fillRect(0,0,W,H);
    for(let x=0;x<W;x+=60)line(x,0,x,H,'#ffffff04');for(let y=0;y<H;y+=60)line(0,y,W,y,'#ffffff04');
    text('МАРШРУТ',64,66,display(36));text('ПОСТРОЕН',64,96,display(36));arrow(238,39,52);
    text('КОНКУРСЫ / МЕДИАГИД',351,63,body(14),'#a1a795');text(c.name.toUpperCase(),351,92,body(20));
    if(c.demo){ctx.fillStyle=ACCENT;ctx.fillRect(W-410,40,342,39);text('РЕПЕТИЦИЯ · ДЕМОУЧАСТНИКИ',W-239,65,body(14),'#fff','center');}
    else {ctx.fillStyle=recording?ACCENT:'#727e62';ctx.beginPath();ctx.arc(W-259,60,5,0,Math.PI*2);ctx.fill();text(recording?'ИДЁТ ЗАПИСЬ':'РОЗЫГРЫШ',W-70,65,body(14),'#c1c7b6','right');}
    line(64,124,W-64,124);
    const complete=results.length===total&&!spinning;
    const rank=spinning?(drawState?.rank??Math.min(results.length+1,total)):Math.min(results.length+1,total);
    text(complete?'МАРШРУТ ПОСТРОЕН.':spinning?'УДАЧА УЖЕ В ПУТИ.':currentWinner?'СЛЕДУЮЩАЯ ОСТАНОВКА — ПОБЕДА.':'У КАЖДОГО ЕСТЬ ШАНС.',64,184,body(14),'#9ba78b');
    text(complete?'ВСЕ ПОБЕДИТЕЛИ':spinning?`МЕСТО ${String(rank).padStart(2,'0')}`:currentWinner?`МЕСТО ${String(currentWinner.rank).padStart(2,'0')}`:'ВАШ МАРШРУТ К ПОБЕДЕ',61,293,display(110));
    text(`${String(results.length).padStart(2,'0')} / ${total}`,W-67,232,display(62),ACCENT,'right');
    text(`${winners} ОСНОВНЫХ + ${reserves} РЕЗЕРВНЫХ`,W-67,277,body(13),'#8d987e','right');
    const y=340,h=238,w=220,gap=12,pitch=w+gap;
    ctx.save();ctx.beginPath();ctx.rect(0,y,W,h);ctx.clip();
    if(drawState){
      const offset=drawState.offset;
      drawState.cards.forEach((user,i)=>{const x=i*pitch+offset;if(x+w>=-20&&x<W+20)card(user,x,y,w,h,!spinning&&i===drawState.target);});
    }else initial.forEach((user,i)=>card(user,(i-5)*pitch+(W-w)/2,y,w,h,false));
    const fadeL=ctx.createLinearGradient(0,0,150,0);fadeL.addColorStop(0,'#0a0c08');fadeL.addColorStop(1,'#0a0c0800');ctx.fillStyle=fadeL;ctx.fillRect(0,y,150,h);const fadeR=ctx.createLinearGradient(W-150,0,W,0);fadeR.addColorStop(0,'#0a0c0800');fadeR.addColorStop(1,'#0a0c08');ctx.fillStyle=fadeR;ctx.fillRect(W-150,y,150,h);ctx.restore();
    ctx.strokeStyle=ACCENT;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(W/2,y-15);ctx.lineTo(W/2,y+h+15);ctx.stroke();ctx.fillStyle=ACCENT;ctx.beginPath();ctx.moveTo(W/2-11,y-17);ctx.lineTo(W/2+11,y-17);ctx.lineTo(W/2,y-3);ctx.fill();
    if(currentWinner&&!spinning){text('@'+currentWinner.username,W/2,650,display(58),WHITE,'center');text(complete?`${total} УЧАСТНИКОВ ВЫБРАНЫ. УСЛОВИЯ ПОДТВЕРЖДАЕТ МЕНЕДЖЕР.`:`${String(currentWinner.rank).padStart(2,'0')} МЕСТО · ${currentWinner.rank<=winners?'ОСНОВНОЙ КАНДИДАТ':'РЕЗЕРВ'} · ОЖИДАЕТ ПРОВЕРКИ`,W/2,687,body(13),'#a6af9a','center');}
    else {text(spinning?'КТО ПРОДОЛЖИТ МАРШРУТ?':`${total} МЕСТ. ОДИН ШАНС У КАЖДОГО.`,W/2,650,display(43),spinning?WHITE:'#89947b','center');text(`${participants.length} АККАУНТОВ В ЗАФИКСИРОВАННОМ СПИСКЕ`,W/2,687,body(13),'#8d987e','center');}
    const perPage=10,pageIndex=Math.max(0,Math.floor((results.length-1)/perPage)),fromRank=pageIndex*perPage+1,visible=Math.min(perPage,total-pageIndex*perPage),cellW=(W-128-9*12)/10;
    text('ВЫБРАННЫЕ МЕСТА',64,763,body(14),WHITE);
    text(total>10?`МЕСТА ${fromRank}–${fromRank+visible-1} / ${total}`:'ОСНОВНЫЕ И РЕЗЕРВНЫЕ КАНДИДАТЫ',W-64,763,body(12),'#9fa891','right');
    for(let i=0;i<visible;i++){
      const rank=fromRank+i,x=64+i*(cellW+12),cy=784,result=results.find(r=>r.rank===rank),primary=rank<=winners,active=result&&(!spinning||result.rank!==drawState.rank);
      ctx.fillStyle=active?(primary?'#22271c':'#191d15'):'#11150e';ctx.fillRect(x,cy,cellW,137);ctx.fillStyle=primary?ACCENT:'#4a5740';ctx.fillRect(x,cy,cellW,2);
      text(String(rank).padStart(2,'0'),x+12,cy+52,display(43),active?(primary?ACCENT:'#a8b49a'):'#454e3d');
      ctx.font=body(13);text(active?fitText(ctx,'@'+result.username,cellW-20):'ЕЩЁ НЕ ВЫБРАН',x+12,cy+85,body(active?13:10),active?WHITE:'#6f7c60');
      text(primary?'ОСНОВНОЙ':'РЕЗЕРВ',x+12,cy+112,body(9),'#869276');
    }
    line(64,960,W-64,960);
    text(c.demo?'РЕПЕТИЦИЯ: УЧАСТНИКИ И ЛОКАЦИИ ВЫМЫШЛЕНЫ':new URL(c.reelUrl).pathname,W/2,999,body(12),c.demo?'#e88565':'#8b967b','center');
    text('СПИСОК ЗАФИКСИРОВАН · '+c.snapshot.hash.slice(0,16).toUpperCase(),64,1040,body(11),'#7a886c');
    text('МАРШРУТ ПОСТРОЕН / КОНКУРСЫ',W-64,1040,body(11),'#7a886c','right');
  }
  function toolbar(){const done=results.length>=total;el('next-place').disabled=spinning||auto||done;el('auto-places').disabled=spinning||auto||done;el('next-place').textContent=done?`${total} мест определены`:`Выбрать ${results.length+1}-е место`;el('auto-places').textContent=results.length?'Выбрать оставшиеся':'Снять видео и выбрать всех';el('record-choice').disabled=recording||spinning||!!video;el('stop-record').hidden=!recording;el('stop-record').disabled=spinning;el('download-video').hidden=!video;el('stage-close').disabled=spinning||auto;el('stage-status').textContent=recording?'● Идёт запись':done?'Розыгрыш завершён':`${results.length} из ${total} мест`;el('stage-status').classList.toggle('recording',recording);el('stage-hint').textContent=spinning?'Результат сохраняется на сервере; на экране — анимация выбора.':video?'Скачайте видео перед закрытием вкладки. Повторный выбор уже определённых мест недоступен.':done?'Все места сохранены. Перейдите к проверке условий участников.':'Видео записывает только эту сцену. Результат каждого места сохраняется в приложении.';}
  function sound(tone=650,length=.025){if(!el('sound-choice').checked||!audioCtx)return;const oscillator=audioCtx.createOscillator();const gain=audioCtx.createGain();oscillator.frequency.value=tone;oscillator.type='sine';gain.gain.setValueAtTime(.04,audioCtx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+length);oscillator.connect(gain);gain.connect(audioCtx.destination);if(audioDest)gain.connect(audioDest);oscillator.start();oscillator.stop(audioCtx.currentTime+length);}
  async function startRecording(){
    if(!audioCtx && (el('sound-choice').checked||el('record-choice').checked)){audioCtx=new AudioContext();await audioCtx.resume();audioDest=audioCtx.createMediaStreamDestination();}
    if(!el('record-choice').checked||recording)return;
    if(video)throw new Error('Запись уже завершена. Скачайте её и откройте сцену заново для продолжения.');
    if(!window.MediaRecorder||!canvas.captureStream)throw new Error('Браузер не поддерживает запись. Откройте приложение в Chrome или Edge.');
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime)throw new Error('Запись WebM недоступна в этом браузере.');
    recordingStream=canvas.captureStream(30);if(audioDest)recordingStream.addTrack(audioDest.stream.getAudioTracks()[0]);
    recorder=new MediaRecorder(recordingStream,{mimeType:mime,videoBitsPerSecond:7000000});chunks=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onerror=()=>{auto=false;toast('Ошибка записи видео. Результаты сохранены, автоматический выбор остановлен.',true);};
    recorder.onstop=()=>{video=new Blob(chunks,{type:'video/webm'});videoURL=URL.createObjectURL(video);recording=false;recordingStream.getTracks().forEach(t=>t.stop());toolbar();paint();download();};
    recorder.start(1000);recording=true;paint();toolbar();
    await wait(900);
  }
  function download(){if(!videoURL)return;const a=document.createElement('a');a.href=videoURL;a.download=`${c.demo?'rehearsal':'contest'}-${c.id}-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`;a.click();saved=true;toast('Видео готово. Проверьте файл в папке загрузок.');}
  function stopRecording(){if(recorder?.state==='recording'){paint();recorder.stop();}}
  function animate(result){return new Promise(resolve=>{
    const pool=participants.filter(u=>!results.some(r=>r.rank<result.rank&&r.username===u));
    const target=52;const cards=Array.from({length:target+8},()=>pool[visualRandom(pool.length)]);cards[target]=result.username;
    const pitch=232;const from=(W-220)/2-3*pitch;const to=(W-220)/2-target*pitch;
    drawState={cards,target,offset:from,rank:result.rank};const started=performance.now();lastTick=-1;
    function frame(now){const progress=Math.min(1,(now-started)/5200);const ease=1-Math.pow(1-progress,4);drawState.offset=from+(to-from)*ease;const tick=Math.floor(-drawState.offset/pitch);if(tick!==lastTick){lastTick=tick;sound(650+visualRandom(130));}paint();if(progress<1){animation=requestAnimationFrame(frame);}else{spinning=false;currentWinner=result;drawState.offset=to;sound(880,.25);paint();toolbar();el('stage-hint').textContent=`${result.rank}-е место: @${result.username}. Ожидает проверки условий.`;resolve();}}
    animation=requestAnimationFrame(frame);
  });}
  async function next(){if(spinning||results.length>=total)return;spinning=true;toolbar();
    try{await startRecording();const data=await draw(results.length+1);c=data.contest;results=[...c.draw.results];await animate(data.result);}
    catch(error){spinning=false;auto=false;toolbar();toast(error.message,true);throw error;}
  }
  async function finishIfDone(){if(results.length===total){await wait(2200);if(!ended)stopRecording();}}
  el('next-place').addEventListener('click',()=>next().then(finishIfDone).catch(()=>{}));
  el('auto-places').addEventListener('click',async()=>{if(auto||spinning)return;el('record-choice').checked=true;auto=true;try{while(auto&&results.length<total&&!ended){await next();if(results.length<total)await wait(1400);}await finishIfDone();}catch{}finally{auto=false;toolbar();}});
  el('stop-record').addEventListener('click',()=>{auto=false;stopRecording();});el('download-video').addEventListener('click',download);
  el('stage-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await stage.requestFullscreen();}catch{toast('Полноэкранный режим недоступен.',true);}});
  function beforeUnload(event){if(recording||video&&!saved){event.preventDefault();event.returnValue='';}}
  window.addEventListener('beforeunload',beforeUnload);
  el('stage-close').addEventListener('click',async()=>{
    if(spinning)return;
    if(recording){auto=false;stopRecording();toast('Запись завершается и будет скачана. После этого закройте экран.');return;}
    if(video&&!saved){download();return;}
    ended=true;auto=false;cancelAnimationFrame(animation);clearInterval(paintTimer);window.removeEventListener('beforeunload',beforeUnload);if(document.fullscreenElement)await document.exitFullscreen();if(audioCtx)await audioCtx.close();if(videoURL)URL.revokeObjectURL(videoURL);stage.remove();document.body.style.overflow='';close();
  });
  paintTimer=setInterval(()=>{if(!spinning)paint();},250);
  if(currentWinner){drawState={cards:initial,target:5,offset:(W-220)/2-5*232,rank:currentWinner.rank};drawState.cards[5]=currentWinner.username;}
  toolbar();paint();el('next-place').focus();
}
