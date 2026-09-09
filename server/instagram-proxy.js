import {assert} from './domain.js';

export function instagramProxy(env=process.env) {
  const server=env.COLLECTOR_PROXY_SERVER?.trim();
  if(!server)return undefined;
  let url;try{url=new URL(server);}catch{assert(false,'Укажите адрес прокси с протоколом http://, https:// или socks5://.');}
  assert(['http:','https:','socks5:'].includes(url.protocol)&&url.hostname&&url.pathname.length<=1&&!url.search&&!url.hash,'Некорректный адрес прокси Instagram.');
  let username,password;
  try{username=env.COLLECTOR_PROXY_USERNAME||decodeURIComponent(url.username);password=env.COLLECTOR_PROXY_PASSWORD||decodeURIComponent(url.password);}catch{assert(false,'Некорректные данные подключения к прокси.');}
  assert(url.protocol!=='socks5:'||(!username&&!password),'Для прокси с логином используйте HTTP или HTTPS.');
  return {server:url.protocol+'//'+url.host,...(username?{username}:{}),...(password?{password}:{})};
}
