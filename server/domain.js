import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { stereoLocations } from './locations.js';

export const DEFAULT_URL = 'https://www.instagram.com/reel/Dcv1u1Jo1QE/';
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const username = value => String(value ?? '').trim().replace(/^@/, '').toLowerCase();
const validUser = value => /^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/i.test(value);
export function assert(ok, message, status = 400) { if (!ok) throw Object.assign(new Error(message), { status }); }
export function reelURL(value) {
  let url; try { url = new URL(value); } catch { assert(false, 'Введите ссылку на рилс Instagram.'); }
  assert(['instagram.com', 'www.instagram.com'].includes(url.hostname) && /^\/reel\/[\w-]+\/?$/.test(url.pathname), 'Нужна ссылка вида https://www.instagram.com/reel/CODE/.');
  return `https://www.instagram.com${url.pathname.replace(/\/$/, '')}/`;
}
export function newContest(input = {}) {
  return { id: randomUUID(), name: String(input.name || 'Конкурс').trim().slice(0, 150),
    reelUrl: input.reelUrl ? reelURL(input.reelUrl) : '', owner: 'marshrut_postroen.media',
    createdAt: new Date().toISOString(), locations: structuredClone(stereoLocations), requiredLocations: 3, duplicatePolicy: 'exclude',
    comments: [], overrides: {}, source: null, acknowledged: false, snapshot: null, draw: null, reviews: {}, events: [], demo: false };
}
export function event(c, type, detail = {}) { c.events.push({ at: new Date().toISOString(), type, ...detail }); }
export function configure(c, input) {
  assert(!c.snapshot, 'Список уже зафиксирован. Создайте новый конкурс для других условий.', 409);
  if (input.name !== undefined) { assert(String(input.name).trim(), 'Укажите название конкурса.'); c.name = String(input.name).trim().slice(0,150); }
  if (input.reelUrl !== undefined) { const next = reelURL(input.reelUrl); assert(!c.comments.length || next === c.reelUrl, 'Для другого рилса создайте новый конкурс.'); c.reelUrl = next; }
  if (input.owner !== undefined) { assert(validUser(username(input.owner)), 'Проверьте аккаунт медиагида.'); c.owner = username(input.owner); }
  for (const key of ['winnerCount','reserveCount']) if (input[key] !== undefined) {
    assert(Number.isInteger(input[key]) && input[key] >= (key==='winnerCount'?1:0) && input[key] <= 50, 'Основных мест: 1–50, резервных: 0–50.');
    c[key] = input[key];
  }
  if (input.conditions !== undefined) {
    const next=String(input.conditions).trim(); assert(next.length<=30000,'Условия: максимум 30 000 символов.');
    if(next!==c.conditions) {c.conditions=next;c.prompt='';c.selectedComments=[];c.selection=null;}
  }
  if(input.manualChecks!==undefined) c.manualChecks=String(input.manualChecks).trim().slice(0,10000);
  if (input.duplicatePolicy !== undefined) { assert(['first','exclude'].includes(input.duplicatePolicy), 'Неизвестное правило повторов.'); c.duplicatePolicy = input.duplicatePolicy; }
  if (input.locations !== undefined) {
    assert(Array.isArray(input.locations) && input.locations.length <= 100, 'Укажите список локаций.');
    const seen = new Set();
    c.locations = input.locations.map(item => {
      const name = String(item.name ?? '').trim().slice(0,120);
      const aliases = [...new Set([name, ...(Array.isArray(item.aliases) ? item.aliases : [])].map(s => String(s).normalize('NFKC').trim().toLowerCase().replace(/ё/g,'е')).filter(Boolean))];
      assert(name && aliases.length <= 30, 'У каждой локации должно быть название.');
      for (const alias of aliases) { assert(alias.length >= 2 && alias.length <= 150, 'Вариант названия: от 2 до 150 символов.'); assert(!seen.has(alias), `Вариант «${alias}» повторяется у нескольких локаций.`); seen.add(alias); }
      return { name, aliases };
    });
  }
  c.acknowledged = false;
  c.overrides = {};
  event(c, 'rules_updated');
}
export function parseCSV(raw) {
  const delimiter = raw.split(/\r?\n/,1)[0].includes(';') ? ';' : ',';
  const rows = []; let row = [], cell = '', quote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') { if (quote && raw[i+1] === '"') { cell += '"'; i++; } else quote = !quote; }
    else if (ch === delimiter && !quote) { row.push(cell); cell = ''; }
    else if (ch === '\n' && !quote) { row.push(cell.replace(/\r$/, '')); if(row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  assert(!quote, 'CSV: незакрытая кавычка.');
  row.push(cell.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row);
  const headers = (rows.shift() || []).map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase());
  assert(headers.includes('username') && headers.includes('text'), 'CSV должен содержать столбцы username и text.');
  return rows.map(r => Object.fromEntries(headers.map((h,i) => [h, r[i] ?? ''])));
}
export function normalizeComments(input,options={}) {
  const rows = Array.isArray(input) ? input : input?.comments ?? input?.data;
  assert(Array.isArray(rows) && rows.length > 0, 'Файл не содержит комментариев. Нужен массив или объект с полем comments.');
  assert(rows.length <= 100000, 'Максимум 100 000 комментариев за один импорт.');
  const result = []; const ids = new Map();
  rows.forEach((r, i) => {
    const user = username(r.username ?? r.owner?.username ?? r.user?.username);
    const text = options.preserveText?String(r.text??''):String(r.text ?? '').trim();
    assert(validUser(user) && (options.allowEmptyText||text) && text.length <= 10000, `Строка ${i+1}: проверьте аккаунт и комментарий.`);
    const time = r.timestamp ?? r.created_at ?? '';
    const date = time === '' ? '' : new Date(typeof time === 'number' ? (time < 1e12 ? time*1000 : time) : time);
    assert(date === '' || !Number.isNaN(date.getTime()), `Строка ${i+1}: некорректная дата.`);
    const timestamp = date === '' ? '' : date.toISOString();
    const parentId = String(r.parentId ?? r.parent_id ?? '');
    // Without a platform ID identical rows may be two real comments. Keep both.
    const id = String(r.id || r.pk || `${digest({ user, text, timestamp, parentId })}:${i}`);
    const comment = { id, username: user, text, timestamp, parentId };
    if (ids.has(id)) { assert(JSON.stringify(ids.get(id)) === JSON.stringify(comment), `Конфликт данных у комментария ${id}.`); return; }
    ids.set(id, comment); result.push(comment);
  });
  return result;
}
const escapeRE = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hasAlias(text, alias) { return new RegExp(`(?<![\\p{L}\\p{N}_@])${escapeRE(alias)}(?![\\p{L}\\p{N}_]${alias.startsWith('@')?'|\\.[a-z0-9_]':''})`, 'u').test(text); }
export function evaluate(c) {
  if(c.workflow==='external') {
    const rows=(c.selectedComments||[]).map(comment=>({username:comment.username,comment,count:1,eligible:true,reasons:[],locations:[],friends:[],override:null}));
    return {rows,stats:{comments:c.comments.length,accounts:new Set(c.comments.map(x=>x.username)).size,eligible:rows.length,excluded:0,replies:0,duplicates:0}};
  }
  const groups = new Map();
  const comments = c.comments.filter(r => r.username !== c.owner);
  for (const comment of comments) { if (!groups.has(comment.username)) groups.set(comment.username, []); groups.get(comment.username).push(comment); }
  const locationHandles = new Set(c.locations.flatMap(l => l.aliases.filter(a => a.startsWith('@')).map(username)));
  const rows = [...groups].map(([user, items]) => {
    // With incomplete timestamps retain import order; never manufacture chronology.
    if(items.every(x => x.timestamp)) items.sort((a,b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
    const comment = items.find(item=>!item.parentId) || items[0];
    const text = comment.text.normalize('NFKC').toLowerCase().replace(/ё/g,'е');
    const locations = c.locations.filter(l => l.aliases.some(alias => hasAlias(text,alias))).map(l => l.name);
    const friends = [...new Set([...text.matchAll(/(?<![\p{L}\p{N}_.])(?:с|c)?@([a-z0-9_.]+)/gu)].map(m=>m[1].replace(/\.+$/,'')))].filter(u => validUser(u) && u !== user && u !== c.owner && u !== 'stereo_picnic' && !locationHandles.has(u));
    const reasons = [];
    const onlyReplies = items.every(item=>item.parentId);
    if(onlyReplies) reasons.push('Только ответы в ветках');
    if(c.locations.length < c.requiredLocations) reasons.push('Не настроены локации');
    else if(locations.length < c.requiredLocations) reasons.push(`Локации: ${locations.length} из ${c.requiredLocations}`);
    if(!friends.length) reasons.push('Нет отметки друга');
    const duplicateExcluded = c.duplicatePolicy === 'exclude' && items.length > 1;
    if(duplicateExcluded) reasons.push('Больше одного комментария');
    const override = c.overrides[user];
    let eligible = reasons.length === 0;
    if(override && !duplicateExcluded && !onlyReplies && c.locations.length >= c.requiredLocations) eligible = override.eligible;
    return { username: user, comment, count: items.length, locations, friends, eligible, reasons, override: override || null };
  });
  rows.sort((a,b) => a.username.localeCompare(b.username, 'en'));
  return { rows, stats: { comments: c.comments.length, accounts: rows.length, eligible: rows.filter(r=>r.eligible).length, excluded: rows.filter(r=>!r.eligible).length, replies: c.comments.filter(r=>r.parentId).length, duplicates: rows.filter(r=>r.count>1).length } };
}
// Reproducible Fisher–Yates. Rejection sampling avoids modulo bias.
export function permutation(users, seed, snapshotHash) {
  const pool = [...users]; let counter = 0;
  function below(n) {
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) { const number = createHmac('sha256', Buffer.from(seed,'hex')).update(`${snapshotHash}:${counter++}`).digest().readUInt32BE(0); if(number < limit) return number % n; }
  }
  for(let i=pool.length-1;i>0;i--) { const j=below(i+1); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  return pool;
}
export function freeze(c) {
  assert(!c.snapshot, 'Список уже зафиксирован.',409);
  assert(c.acknowledged, 'Подтвердите, что проверили полноту выгрузки и список участников.');
  assert(c.source?.completeness !== 'partial' || c.workflow==='external' && c.sourceAccepted===true, 'Подтвердите отдельно расхождение выгрузки со счётчиком Instagram.');
  if(c.workflow!=='external') assert(c.locations.length >= 3, 'Укажите минимум три локации в условиях.');
  else assert(c.selection && c.selection.conditionsHash===digest(c.conditions) && c.selection.sourceHash===digest(c.comments), 'Загрузите Excel с участниками, проверенными по текущим условиям и исходному файлу.');
  const { rows } = evaluate(c); const eligible = rows.filter(r=>r.eligible);
  assert(eligible.length >= totalPlaces(c), `Для розыгрыша нужно минимум ${totalPlaces(c)} отобранных аккаунтов.`);
  const payload = { contestId:c.id, name:c.name, reelUrl:c.reelUrl, owner:c.owner, demo:c.demo, at:new Date().toISOString(), locations:c.locations, duplicatePolicy:c.duplicatePolicy, source:c.source, comments:c.comments, participants:eligible, overrides:c.overrides, winnerCount:c.winnerCount??5,reserveCount:c.reserveCount??5,conditions:c.conditions||'',manualChecks:c.manualChecks||'',selection:c.selection||null,sourceAccepted:c.sourceAccepted===true };
  const hash = digest(payload); const seed = randomBytes(32).toString('hex');
  c.snapshot = { payload, hash };
  c.draw = { seed, commitment: digest(seed), results: [], algorithm:'HMAC-SHA256/Fisher-Yates/rejection-v1' };
  event(c,'frozen',{ snapshotHash:hash, seedCommitment:c.draw.commitment, count:eligible.length });
}
export function drawNext(c) {
  assert(c.snapshot && c.draw, 'Сначала зафиксируйте список участников.');
  assert(c.draw.results.length < totalPlaces(c), 'Все места уже определены.',409);
  const order = permutation(c.snapshot.payload.participants.map(r=>r.username), c.draw.seed, c.snapshot.hash);
  const rank = c.draw.results.length + 1;
  const result = { rank, username:order[rank-1], group:rank<=(c.snapshot.payload.winnerCount??5)?'primary':'reserve', at:new Date().toISOString() };
  c.draw.results.push(result); event(c,'place_drawn',result); return result;
}
export function publicContest(c) {
  const out = structuredClone(c);
  if(out.draw && out.draw.results.length < totalPlaces(out)) delete out.draw.seed;
  return { ...out, evaluation: evaluate(c) };
}
export function review(c, user, input) {
  assert(c.draw?.results.some(r=>r.username===user), 'Участник не выбран в этом розыгрыше.');
  assert(['pending','confirmed','rejected'].includes(input.status), 'Некорректный статус.');
  const checks = Object.fromEntries(['like','follow','save','share'].map(k=>[k,input.checks?.[k]===true]));
  const note = String(input.note ?? '').trim().slice(0,2000);
  assert(input.status !== 'confirmed' || (c.workflow==='external'?input.verified===true:Object.values(checks).every(Boolean)), 'Подтвердите проверку всех условий конкурса.');
  assert(input.status !== 'rejected' || note, 'Укажите причину отказа.');
  c.reviews[user] = { status:input.status, checks, verified:input.verified===true,note, at:new Date().toISOString() };
  event(c,'review_updated',{ username:user, ...c.reviews[user] });
}
export const totalPlaces = c => (c.snapshot?.payload.winnerCount??c.winnerCount??5)+(c.snapshot?.payload.reserveCount??c.reserveCount??5);

export function acceptSelection(c, rows, filename) {
  assert(!c.snapshot,'Список уже зафиксирован.',409);
  assert(c.conditions && c.prompt,'Сначала создайте промпт по условиям конкурса.');
  const normalized=normalizeComments(rows,{preserveText:true}),seen=new Set();
  const source=new Map(c.comments.map(x=>[JSON.stringify([x.username,x.text]),x]));
  c.selectedComments=normalized.map(row=>{
    assert(!seen.has(row.username),`Аккаунт @${row.username} повторяется в Excel. Оставьте одну строку для одного шанса.`);seen.add(row.username);
    const original=source.get(JSON.stringify([row.username,row.text]));
    assert(original,`Комментарий @${row.username} не совпадает с исходной выгрузкой. ИИ должен сохранить текст без изменений.`);
    return structuredClone(original);
  });
  c.workflow='external';c.selection={filename:String(filename||'participants.xlsx').slice(0,200),at:new Date().toISOString(),conditionsHash:digest(c.conditions),sourceHash:digest(c.comments),count:c.selectedComments.length};
  c.acknowledged=false;event(c,'selection_imported',c.selection);
}
