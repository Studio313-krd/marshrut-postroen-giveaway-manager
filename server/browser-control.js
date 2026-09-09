import {assert} from './domain.js';

export async function browserInput(page,input) {
  assert(page&&!page.isClosed(),'Окно Instagram закрыто. Запустите сбор заново.',409);
  const viewport=page.viewportSize()||{width:1280,height:900};
  if(input.type==='click') {
    assert(Number.isFinite(input.x)&&Number.isFinite(input.y)&&input.x>=0&&input.y>=0&&input.x<viewport.width&&input.y<viewport.height,'Недопустимая точка на экране.');
    await page.mouse.click(input.x,input.y);
  } else if(input.type==='text') {
    assert(typeof input.text==='string'&&input.text.length<=4096,'Текст слишком длинный.');
    await page.keyboard.insertText(input.text);
  } else if(input.type==='key') {
    assert(['Enter','Tab','Shift+Tab','Backspace','Delete','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','ControlOrMeta+A'].includes(input.key),'Клавиша не поддерживается.');
    await page.keyboard.press(input.key);
  } else if(input.type==='scroll') {
    assert(Number.isFinite(input.delta)&&Math.abs(input.delta)<=1500,'Недопустимая прокрутка.');
    await page.mouse.wheel(0,input.delta);
  } else assert(false,'Действие не поддерживается.');
}
