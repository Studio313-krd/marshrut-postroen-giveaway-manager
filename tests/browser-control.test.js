import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {browserInput} from '../server/browser-control.js';

test('browser login input supports click, text, tab and masked passwords without arbitrary commands',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.setContent('<input aria-label="Username"><input aria-label="Password" type="password">');
    const box=await page.locator('input').first().boundingBox();
    await browserInput(page,{type:'click',x:box.x+10,y:box.y+10});
    await browserInput(page,{type:'text',text:'manager'});await browserInput(page,{type:'key',key:'Tab'});
    await browserInput(page,{type:'text',text:'example-test-password'});
    assert.equal(await page.locator('input').first().inputValue(),'manager');
    assert.equal(await page.locator('[type=password]').inputValue(),'example-test-password');
    await assert.rejects(browserInput(page,{type:'click',x:2000,y:1}));
    await assert.rejects(browserInput(page,{type:'key',key:'Control+L'}));
    await assert.rejects(browserInput(page,{type:'eval',code:'1+1'}));
    await assert.rejects(browserInput(page,{type:'text',text:'x'.repeat(4097)}));
  } finally {await browser.close();}
});
