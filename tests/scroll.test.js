import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readDOMComments } from '../server/dom-comments.js';
import { inspectCommentPane,findReplyControls,hasTerminalComment,completionEvidence } from '../server/comment-scroll.js';

test('scroll the nested pane, retain virtualized batches, and reach the terminal comment',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:800}});
    await page.setContent('<base href="https://www.instagram.com/"><style>body{margin:0}#outer{height:700px;overflow:auto}#pane{height:250px;width:600px;overflow-y:auto;overscroll-behavior:contain}.row{min-height:70px}#tail{height:1600px}</style><div id="outer"><div id="pane"></div><div id="tail">Other page content</div></div>');
    await page.evaluate(()=>{
      const pane=document.querySelector('#pane');let next=0,loading=false;
      function append(){for(let i=0;i<5&&next<35;i++,next++){
        const row=document.createElement('div');row.className='row';row.innerHTML=`<div><a href="/${next===34?'marshrut_postroen.media':'person_'+next}/">${next===34?'marshrut_postroen.media':'person_'+next}</a><span><a href="/p/Dcv1u1Jo1QE/c/${1000+next}/"><time datetime="2026-09-08T12:00:00Z">1 дн.</time></a></span></div><div><span>${next===34?'КАК ПРАВИЛЬНО ПОСТРОИТЬ СВОЙ МАРШРУТ 👇<br>Полные правила конкурса':'Арт-зоны, лекторий и фудкорт @friend'}</span></div>`;pane.append(row);
      }loading=false;}
      pane.addEventListener('scroll',()=>{if(!loading&&next<35&&pane.scrollTop+pane.clientHeight>=pane.scrollHeight-15){loading=true;setTimeout(()=>{if(next>=15){const removed=[...pane.children].slice(0,5);const height=removed.reduce((sum,n)=>sum+n.getBoundingClientRect().height,0);removed.forEach(n=>n.remove());pane.scrollTop-=height;}append();},35);}});
      append();
    });
    const captured=new Map();let bottom=false;
    for(let i=0;i<100;i++){
      const rows=await page.evaluate(readDOMComments,'Dcv1u1Jo1QE');rows.forEach(r=>captured.set(r.id,r));
      const pane=await page.evaluate(inspectCommentPane,{code:'Dcv1u1Jo1QE',advance:true});assert.equal(pane.found,true);bottom=pane.bottom;
      if(captured.size===35&&bottom)break;
      await page.waitForTimeout(60);
    }
    assert.equal(captured.size,35);assert.equal(hasTerminalComment([...captured.values()],'marshrut_postroen.media'),true);
    assert.equal(await page.evaluate(()=>document.querySelector('#outer').scrollTop),0);assert.equal(await page.evaluate(()=>window.scrollY),0);
    assert.equal((await page.evaluate(readDOMComments,'Dcv1u1Jo1QE')).length<35,true,'virtualized rows must survive in the accumulated map');
    assert.equal(completionEvidence({count:35,reportedCount:35,terminalCommentSeen:true,atBottom:bottom,stablePasses:5}).reachedEnd,true);
  }finally{await browser.close();}
});
test('end marker alone, short empty intervals, pending replies and count mismatches do not prove completeness',()=>{
  assert.equal(completionEvidence({count:15,reportedCount:333,terminalCommentSeen:true,atBottom:false,stablePasses:10}).reachedEnd,false);
  assert.equal(completionEvidence({count:333,reportedCount:333,atBottom:true,stablePasses:1}).reachedEnd,false);
  assert.equal(completionEvidence({count:333,reportedCount:333,atBottom:true,stablePasses:5,pendingReplies:1}).reachedEnd,false);
  const mismatch=completionEvidence({count:274,reportedCount:333,terminalCommentSeen:true,atBottom:true,stablePasses:5});assert.equal(mismatch.reachedEnd,true);assert.equal(mismatch.completeness,'partial');
  assert.equal(completionEvidence({count:333,reportedCount:333,atBottom:true,stablePasses:5,stopped:true}).completeness,'partial');
});
test('reply expanders support numeric Russian and English labels, never Reply or Hide replies',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{const page=await browser.newPage();await page.setContent('<div data-mp-comment-scroll="true"><div><a href="/p/Dcv1u1Jo1QE/c/1/">time</a><button>Посмотреть ответы (3)</button><button>View 2 replies</button><button>Ответить</button><button>Hide replies</button></div></div>');const controls=await page.evaluate(findReplyControls,{code:'Dcv1u1Jo1QE'});assert.deepEqual(controls.map(c=>c.text),['Посмотреть ответы (3)','View 2 replies']);assert(controls.every(c=>c.parentId==='1'));}finally{await browser.close();}
});
