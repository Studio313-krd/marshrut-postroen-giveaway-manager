import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {dismissLoginInvitation} from '../server/instagram-dialog.js';

test('dismiss the login invitation via the SVG Close button before treating it as an auth gate',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{const page=await browser.newPage();await page.route('https://www.instagram.com/**',r=>r.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));await page.goto('https://www.instagram.com/reel/Dcv1u1Jo1QE/');await page.setContent('<div role="dialog"><div class="xdg88n9 x10l6tqk"><div role="button" tabindex="0" onclick="this.closest(\'[role=dialog]\').remove()"><div><svg aria-label="Закрыть" role="img" width="18" height="18"><title>Закрыть</title></svg></div></div></div><h2>Посмотрите, что говорят люди о публикации</h2><button>Войти</button></div><main>Рилс</main>');assert.equal(await dismissLoginInvitation(page),true);assert.equal(await page.locator('[role=dialog]').count(),0);assert.equal(await dismissLoginInvitation(page),false);
  await page.setContent('<div role="dialog"><a href="/reel/Dcv1u1Jo1QE/c/123/">Комментарий</a><div role="button"><svg aria-label="Закрыть" width="18" height="18"></svg></div><button>Войти</button></div>');assert.equal(await dismissLoginInvitation(page),false,'do not close the comments pane itself');}finally{await browser.close();}
});
