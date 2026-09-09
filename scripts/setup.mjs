import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
if(!existsSync('.env'))writeFileSync('.env',readFileSync('.env.example','utf8').replace('SETUP_TOKEN=','SETUP_TOKEN='+randomBytes(32).toString('hex')),{mode:0o600});
process.loadEnvFile('.env');
const base=process.argv.includes('--docker')?'http://127.0.0.1:4311':process.env.PUBLIC_URL||'http://127.0.0.1:4310';
if(process.argv.includes('--env-only')){console.log('.env готов. Секретные значения не выводятся.');process.exit(0);}
const browser=await chromium.launchPersistentContext('data/setup-browser',{...(process.platform==='win32'?{channel:'chrome'}:{}),headless:false,viewport:null});
const page=browser.pages()[0]||await browser.newPage();await page.goto(base+'/#setup='+encodeURIComponent(process.env.SETUP_TOKEN||''));
console.log('Введите пароль в открытой форме браузера. Пароль в терминал не вводится.');
