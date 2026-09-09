import { randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync,existsSync,writeFileSync,renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { assert } from './domain.js';
const scrypt=promisify(scryptCallback),hash=v=>createHash('sha256').update(v).digest('hex');
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;}
async function verify(password,encoded){const [type,salt,expected]=encoded.split(':');if(type!=='scrypt'||!salt||!expected)return false;const actual=await scrypt(password,salt,64),target=Buffer.from(expected,'hex');return actual.length===target.length&&timingSafeEqual(actual,target);}
export function createAuth(dataDir,publicURL){
  const disabled=process.env.NODE_ENV==='test'&&process.env.AUTH_DISABLED==='true';
  const file=resolve(dataDir,'auth.json');let encoded=process.env.ADMIN_PASSWORD_HASH||(existsSync(file)?JSON.parse(readFileSync(file,'utf8')).passwordHash:'');
  const setupToken=process.env.SETUP_TOKEN||'';const secure=publicURL.startsWith('https:');
  assert(disabled||encoded||setupToken.length>=32,'Настройте ADMIN_PASSWORD_HASH или случайный SETUP_TOKEN длиной от 32 символов в .env.');
  const sessions=new Map(),attempts=new Map();const testSession={csrf:randomBytes(32).toString('hex'),username:'admin'};
  const cookie=(res,value,age)=>res.setHeader('Set-Cookie',`mp_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`);
  return {
    disabled,
    get setupRequired(){return !encoded&&!disabled;},
    session(req){if(disabled)return testSession;const token=(req.headers.cookie||'').match(/(?:^|;\s*)mp_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return null;const key=hash(token),session=sessions.get(key);if(!session)return null;if(session.expires<Date.now()){sessions.delete(key);return null;}return session;},
    async login(req,res,input,setup=false){
      const key=req.socket.remoteAddress,now=Date.now();for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);
      const rate=attempts.get(key)||{count:0,until:now+15*60*1000};assert(rate.count<10,'Слишком много попыток. Повторите через 15 минут.',429);rate.count++;attempts.set(key,rate);
      const password=String(input.password||'');assert(password.length<=1024,'Некорректный пароль.');
      if(setup){assert(!encoded,'Пароль уже настроен.',409);assert(setupToken.length>=32&&hash(String(input.token||''))===hash(setupToken),'Неверная ссылка настройки.',403);assert(password.length>=12,'Используйте пароль минимум из 12 символов.');
        encoded=await passwordHash(password);writeFileSync(file+'.tmp',JSON.stringify({passwordHash:encoded}),{mode:0o600});renameSync(file+'.tmp',file);
      }else assert(String(input.username)==='admin'&&encoded&&await verify(password,encoded),'Неверный логин или пароль.',401);
      attempts.delete(key);for(const[k,v]of sessions)if(v.expires<now)sessions.delete(k);
      const token=randomBytes(32).toString('hex'),session={csrf:randomBytes(32).toString('hex'),username:'admin',expires:now+12*60*60*1000};sessions.set(hash(token),session);cookie(res,token,12*60*60);return session;
    },
    logout(req,res){const token=(req.headers.cookie||'').match(/mp_session=([a-f0-9]{64})/)?.[1];if(token)sessions.delete(hash(token));cookie(res,'',0);}
  };
}
