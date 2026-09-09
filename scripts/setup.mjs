import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
if(!existsSync('.env'))writeFileSync('.env',readFileSync('.env.example','utf8').replace('SETUP_TOKEN=','SETUP_TOKEN='+randomBytes(32).toString('hex')),{mode:0o600});
process.loadEnvFile('.env');
const base=process.argv.includes('--docker')?'http://127.0.0.1:4311':process.env.PUBLIC_URL||'http://127.0.0.1:4310';
if(process.argv.includes('--env-only')){console.log('.env готов. Секретные значения не выводятся.');process.exit(0);}
const address=base+'/#setup='+encodeURIComponent(process.env.SETUP_TOKEN||'');
const command=process.platform==='win32'?'rundll32':process.platform==='darwin'?'open':'xdg-open';
const args=process.platform==='win32'?['url.dll,FileProtocolHandler',address]:[address];
const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>console.error('Не удалось открыть браузер. Проверьте локальную настройку приложения.'));child.unref();
console.log('Введите пароль в открытой форме браузера. Пароль в терминал не вводится.');
