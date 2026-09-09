import test from 'node:test';
import assert from 'node:assert/strict';
import {instagramProxy} from '../server/instagram-proxy.js';

test('proxy credentials stay separate from its address and unsupported configurations fail without echoing secrets',()=>{
  assert.equal(instagramProxy({}),undefined);
  assert.deepEqual(instagramProxy({COLLECTOR_PROXY_SERVER:'http://manager:p%40ss@proxy.example:8080'}),{server:'http://proxy.example:8080',username:'manager',password:'p@ss'});
  assert.deepEqual(instagramProxy({COLLECTOR_PROXY_SERVER:'socks5://proxy.example:1080'}),{server:'socks5://proxy.example:1080'});
  assert.throws(()=>instagramProxy({COLLECTOR_PROXY_SERVER:'file:///secret'}));
  assert.throws(()=>instagramProxy({COLLECTOR_PROXY_SERVER:'http://proxy.example/path?secret=x'}),error=>!error.message.includes('secret'));
  assert.throws(()=>instagramProxy({COLLECTOR_PROXY_SERVER:'socks5://user:password@proxy.example:1080'}),error=>!error.message.includes('password'));
});
