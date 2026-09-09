// Runs in the page. Instagram's dismissible login invitation is not an auth wall.
export function findLoginDismissButton(){
  const visible=element=>element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden';
  for(const svg of document.querySelectorAll('svg[aria-label="Закрыть"],svg[aria-label="Close"]')){
    const button=svg.closest('button,[role="button"]');if(!button||!visible(button))continue;
    for(let panel=button.parentElement,depth=0;panel&&panel!==document.body&&depth<9;panel=panel.parentElement,depth++){
      if(panel.querySelector('a[href*="/c/"]'))break;
      if(/войти|войдите|вход в Instagram|зарегистрир|не пропускайте|посмотрите, что говорят|log in|sign up|see what people|don't miss out/i.test(panel.innerText||'')&&visible(panel)){
        button.setAttribute('data-mp-dismiss-login','true');return true;
      }
    }
  }
  return false;
}
export async function dismissLoginInvitation(page){
  if(page.isClosed()||/\/accounts\/login|\/challenge|\/checkpoint/.test(page.url()))return false;
  if(!await page.evaluate(findLoginDismissButton))return false;
  await page.locator('[data-mp-dismiss-login="true"]').first().click({timeout:2500});
  await page.waitForTimeout(400);return true;
}
