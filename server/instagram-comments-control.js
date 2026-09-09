// Executed in the page. The signed-in Reels button includes the count in its
// accessible name ("Comment 343"); the guest layout puts it beside the button.
export function locateCommentsControl(code) {
  if (location.hostname.endsWith('instagram.com') &&
      !new RegExp('^/(?:p|reels?)/' + code + '/').test(location.pathname)) return null;
  const icons = [...document.querySelectorAll('svg[aria-label="Комментировать"],svg[aria-label="Comment"]')];
  const icon = icons.find(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  });
  const button = icon?.closest('button,[role="button"]');
  if (!button) return null;
  for (const old of document.querySelectorAll('[data-mp-open-comments]')) old.removeAttribute('data-mp-open-comments');
  button.setAttribute('data-mp-open-comments', 'true');
  const buttons = [...document.querySelectorAll('button,[role="button"]')];
  const label = button.cloneNode(true);
  label.querySelectorAll('svg').forEach(node => node.remove());
  const values = [label.textContent, buttons[buttons.indexOf(button) + 1]?.textContent];
  const value = values.map(text => text?.replace(/[\s\u00a0]/g, '')).find(text => /^\d+$/.test(text || ''));
  return {count: value === undefined ? null : Number(value)};
}
