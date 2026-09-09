import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {locateCommentsControl} from '../server/instagram-comments-control.js';

test('open the visible signed-in comments button with its count, ignoring adjacent Reels',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent('<div style="position:absolute;top:-200px" role="button"><svg aria-label="Comment" width="24" height="24"></svg>999</div><div id="target" role="button" onclick="this.dataset.opened=true"><svg aria-label="Комментировать" width="24" height="24"><title>Комментировать</title></svg><span>343</span></div><button>81</button>');
    // SVG titles contribute to textContent: the label is not part of the count.
    assert.deepEqual(await page.evaluate(locateCommentsControl,'Dcv1u1Jo1QE'),{count:343});
    await page.locator('[data-mp-open-comments]').click();
    assert.equal(await page.locator('#target').getAttribute('data-opened'),'true');
    await page.setContent('<button><svg aria-label="Comment" width="24" height="24"><title>Comment</title></svg></button><button>1&nbsp;234</button>');
    assert.deepEqual(await page.evaluate(locateCommentsControl,'Dcv1u1Jo1QE'),{count:1234});
  } finally {await browser.close();}
});
