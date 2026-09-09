import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../server/auth.js';

test('password setup, hashed storage, secure cookies, logout and login throttling',async()=>{
  const previous={...process.env};process.env.SETUP_TOKEN=randomBytes(32).toString('hex');process.env.ADMIN_PASSWORD_HASH='';process.env.NODE_ENV='test';process.env.AUTH_DISABLED='false';
  try{
    const dir=mkdtempSync(resolve('data','auth-test-')),auth=createAuth(dir,'https://giveaway.example'),req={headers:{},socket:{remoteAddress:'test-client'}},headers={},res={setHeader:(key,value)=>headers[key]=value},password=randomBytes(24).toString('base64url');
    assert.equal(auth.session(req),null);assert.equal(auth.setupRequired,true);
    await assert.rejects(()=>auth.login(req,res,{password,token:'wrong'},true),/ссылка/);
    const session=await auth.login(req,res,{password,token:process.env.SETUP_TOKEN},true);assert.equal(session.username,'admin');assert.equal(auth.setupRequired,false);
    assert.match(headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);assert.match(headers['Set-Cookie'],/; Secure/);assert(!readFileSync(resolve(dir,'auth.json'),'utf8').includes(password));
    req.headers.cookie=headers['Set-Cookie'].split(';')[0];assert.equal(auth.session(req).csrf,session.csrf);auth.logout(req,res);assert.equal(auth.session(req),null);
    const reloaded=createAuth(dir,'https://giveaway.example');assert.equal(reloaded.setupRequired,false);await reloaded.login(req,res,{username:'admin',password});
    for(let i=0;i<10;i++)await assert.rejects(()=>reloaded.login(req,res,{username:'admin',password:'incorrect'}),/Неверный/);
    await assert.rejects(()=>reloaded.login(req,res,{username:'admin',password}),/много попыток/);
  }finally{for(const key of ['SETUP_TOKEN','ADMIN_PASSWORD_HASH','NODE_ENV','AUTH_DISABLED'])if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
