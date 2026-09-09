import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';

export async function launchDesktop(){
  const root=resolve(fileURLToPath(new URL('..',import.meta.url)));process.chdir(root);
  if(!existsSync('.env'))writeFileSync('.env',readFileSync('.env.example','utf8').replace('SETUP_TOKEN=','SETUP_TOKEN='+randomBytes(32).toString('hex')),{mode:0o600});
  process.loadEnvFile('.env');
  const port=Number(process.env.DESKTOP_PORT||4312),base=`http://127.0.0.1:${port}`,dataDir=resolve(process.env.DESKTOP_DATA_DIR||'data/desktop');
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Некорректный DESKTOP_PORT.');
  mkdirSync(dataDir,{recursive:true});
  try{const response=await fetch(base+'/healthz',{signal:AbortSignal.timeout(1000)});if(response.ok)throw new Error(`Приложение уже работает: ${base}. Откройте этот адрес в Chrome.`);}catch(error){if(error.message.startsWith('Приложение уже'))throw error;}
  let browser,stopping=false;
  const server=spawn(process.execPath,['server/index.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_URL:base,CONTEST_DATA_DIR:dataDir,COLLECTOR_HEADLESS:'false'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  server.stdout.pipe(process.stdout);server.stderr.pipe(process.stderr);
  async function close(){if(stopping)return;stopping=true;await browser?.close().catch(()=>{});if(server.exitCode!==null)return;
    const exited=new Promise(r=>server.once('exit',r));if(server.connected)server.send({type:'desktop-shutdown'});else server.kill();
    const timeout=setTimeout(()=>server.kill(),10000);await exited;clearTimeout(timeout);
  }
  try{
    let session;
    for(let i=0;i<150;i++){if(server.exitCode!==null)throw new Error('Не удалось запустить локальный сервер.');try{const response=await fetch(base+'/api/session');if(response.ok){session=await response.json();break;}}catch{}await new Promise(r=>setTimeout(r,100));}
    if(!session)throw new Error('Локальный сервер не ответил.');
    browser=await chromium.launchPersistentContext(resolve(dataDir,'manager-chrome'),{...(process.platform==='win32'?{channel:'chrome'}:{}),headless:false,viewport:null,args:['--start-maximized']});
    browser.on('close',()=>void close());server.on('exit',()=>void browser.close().catch(()=>{}));const page=browser.pages()[0]||await browser.newPage();
    await page.goto(base+(session.setupRequired?'/#setup='+encodeURIComponent(process.env.SETUP_TOKEN||''):''));
    console.log(`Видимый Chrome готов. Адрес приложения: ${base}. Данные этого запуска хранятся локально.`);
    return{server,browser,page,base,close};
  }catch(error){await close();throw error;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{const app=await launchDesktop();for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close());if(app.server.exitCode===null)await new Promise(r=>app.server.once('exit',r));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
