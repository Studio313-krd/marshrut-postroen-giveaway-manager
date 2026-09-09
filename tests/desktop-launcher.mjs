import {launchDesktop} from '../scripts/desktop.mjs';
import {mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
process.env.DESKTOP_PORT='14314';process.env.DESKTOP_DATA_DIR=mkdtempSync(resolve('data','desktop-launcher-test-'));process.env.SETUP_TOKEN=randomBytes(32).toString('hex');process.env.ADMIN_PASSWORD_HASH='';
const app=await launchDesktop();
try{await app.page.getByRole('heading',{name:'Создайте пароль'}).waitFor();await app.page.locator('input[name=password]').fill(randomBytes(24).toString('base64url'));await app.page.getByRole('button',{name:'Сохранить пароль и войти'}).click();await app.page.getByRole('heading',{name:'НАЧНЁМ С РИЛСА.'}).waitFor();assert.equal((await app.page.evaluate(()=>fetch('/api/session').then(r=>r.json()))).collectorMode,'desktop');await app.page.screenshot({path:'artifacts/desktop-launcher.png',fullPage:true});assert(!app.page.isClosed());}finally{await app.close();}
assert.equal(app.server.exitCode,0);console.log('Visible Chrome launcher: setup, authenticated desktop mode and graceful shutdown passed.');
