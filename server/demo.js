import { newContest, normalizeComments, event } from './domain.js';
export function demoContest() {
  const c=newContest({name:'Стереопикник · репетиция'}); c.demo=true;
  c.locations=[{name:'Главная сцена',aliases:['главная сцена']},{name:'Гастромаркет',aliases:['гастромаркет']},{name:'Лекторий',aliases:['лекторий']}];
  const names=['anya.travel','misha.krasnodar','katya.more','alex.volkov','dasha.sun','nikita.route','polina.art','sergey.south','lena.weekend','max.petrov','alina.city','roman.music','vika.picnic','denis.walk','nastya.light','pavel.photo','olga.hello','ilya.green','sonya.mood','artem.fest','maria.days','kirill.live','julia.world','andrey.local','tanya.space','dima.coffee','veronika.go','sasha.park'];
  c.comments=normalizeComments(names.map((username,i)=>({id:`demo-${i}`,username,text:i%7===0?'Хочу на фестиваль! @my_friend':i%9===0?'Главная сцена, гастромаркет, лекторий — мой маршрут!':`Главная сцена, гастромаркет и лекторий. @friend_${i} идём на Стереопикник!`,timestamp:new Date(Date.UTC(2026,8,1,12,i)).toISOString()})));
  c.source={kind:'demo',label:'Вымышленные участники и локации для репетиции',count:c.comments.length,completeness:'demo',at:new Date().toISOString()};
  event(c,'demo_created'); return c;
}
