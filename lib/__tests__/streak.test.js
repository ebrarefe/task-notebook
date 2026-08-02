// lib/streak.js için testler — özellikle seri (streak) mantığı sessizce yanlış
// olabilecek türden: görevi olmayan günün seriyi bozmaması, yarım kalan günün
// seriyi kırması ve hiç veri yokken 0 dönmesi burada doğrulanıyor.
import { computeStreak, lastNDays } from '../streak';

// trIndex: Pzt=0 … Paz=6. 2026-01-08 Perşembe → trIndex 3.
const THU = new Date(2026, 0, 8); // Perşembe

function mkConfig(byWeekday){
  // byWeekday: {0:[...], 1:[...], ...} — verilmeyenler boş dizi
  const daily = {};
  for(let i=0;i<7;i++) daily[i] = byWeekday[i] || [];
  return { daily, weekly:[], memorize:[] };
}
function key(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function daysAgo(ref, n){ const d=new Date(ref); d.setDate(d.getDate()-n); d.setHours(0,0,0,0); return d; }

describe('computeStreak', () => {
  test('hiç veri yokken (config boş) 0 döner', () => {
    const config = mkConfig({});
    const prog = { daily:{}, weekly:{} };
    expect(computeStreak(config, prog, THU)).toBe(0);
  });

  test('görevi olmayan bir gün seriyi bozmaz — atlanır', () => {
    // Perşembe (trIndex 3) görevsiz; diğer tüm günlerde 1 görev var ve hepsi tamamlanmış.
    const task = { id:'t1', text:'x' };
    const config = mkConfig({0:[task],1:[task],2:[task],3:[],4:[task],5:[task],6:[task]});
    const prog = { daily:{}, weekly:{} };
    // bugünden geriye 10 gün için: görevi olan her günü tamamlanmış işaretle
    for(let i=0;i<10;i++){
      const d = daysAgo(THU, i);
      const wd = (d.getDay()+6)%7;
      if(wd!==3) prog.daily[key(d)] = { t1:true };
    }
    // Perşembe günleri (görevsiz) hiç prog kaydı yok — total=0, atlanmalı.
    // 10 günlük pencerede (i=0..9) 2 Perşembe var (i=0 ve i=7), onlar atlanır;
    // geri kalan 8 gün görevli ve tamamlanmış, seri kırılmaz.
    expect(computeStreak(config, prog, THU)).toBe(8);
  });

  test('yarım tamamlanan bir gün seriyi kırar', () => {
    const t1 = { id:'t1', text:'a' }, t2 = { id:'t2', text:'b' };
    // her gün için aynı iki görev (hafta günü farketmeksizin)
    const config = mkConfig({0:[t1,t2],1:[t1,t2],2:[t1,t2],3:[t1,t2],4:[t1,t2],5:[t1,t2],6:[t1,t2]});
    const prog = { daily:{}, weekly:{} };
    // bugün (0) ve dün (1) tam tamamlanmış
    prog.daily[key(daysAgo(THU,0))] = { t1:true, t2:true };
    prog.daily[key(daysAgo(THU,1))] = { t1:true, t2:true };
    // 2 gün önce yarım kalmış (sadece t1)
    prog.daily[key(daysAgo(THU,2))] = { t1:true };
    // 3 gün önce yine tam — ama seri 2 günde kırılmış olmalı, buraya ulaşmamalı
    prog.daily[key(daysAgo(THU,3))] = { t1:true, t2:true };
    expect(computeStreak(config, prog, THU)).toBe(2);
  });

  test('bugün hiç işaretlenmemişse (görev var ama prog kaydı yok) seri 0 döner', () => {
    const t1 = { id:'t1', text:'a' };
    const config = mkConfig({0:[t1],1:[t1],2:[t1],3:[t1],4:[t1],5:[t1],6:[t1]});
    const prog = { daily:{}, weekly:{} };
    expect(computeStreak(config, prog, THU)).toBe(0);
  });

  test('tüm görevler her gün tamamlanmışsa uzun bir seri doğru sayılır', () => {
    const t1 = { id:'t1', text:'a' };
    const config = mkConfig({0:[t1],1:[t1],2:[t1],3:[t1],4:[t1],5:[t1],6:[t1]});
    const prog = { daily:{}, weekly:{} };
    for(let i=0;i<15;i++) prog.daily[key(daysAgo(THU,i))] = { t1:true };
    expect(computeStreak(config, prog, THU)).toBe(15);
  });
});

describe('lastNDays', () => {
  test('n gün döner, eskiden yeniye sıralı, sonuncusu bugün', () => {
    const config = mkConfig({});
    const prog = { daily:{}, weekly:{} };
    const out = lastNDays(config, prog, THU, 30);
    expect(out.length).toBe(30);
    expect(out[29].key).toBe(key(THU));
    expect(out[0].key).toBe(key(daysAgo(THU,29)));
  });

  test('görevi olmayan günde ratio null, total 0 döner', () => {
    const config = mkConfig({}); // hiçbir günde görev yok
    const prog = { daily:{}, weekly:{} };
    const out = lastNDays(config, prog, THU, 5);
    out.forEach(d=>{ expect(d.total).toBe(0); expect(d.ratio).toBeNull(); });
  });

  test('kısmen tamamlanan günde ratio doğru hesaplanır', () => {
    const t1={id:'t1',text:'a'}, t2={id:'t2',text:'b'};
    const config = mkConfig({0:[t1,t2],1:[t1,t2],2:[t1,t2],3:[t1,t2],4:[t1,t2],5:[t1,t2],6:[t1,t2]});
    const prog = { daily:{ [key(THU)]: { t1:true } }, weekly:{} };
    const out = lastNDays(config, prog, THU, 1);
    expect(out[0].done).toBe(1);
    expect(out[0].total).toBe(2);
    expect(out[0].ratio).toBe(0.5);
  });
});
