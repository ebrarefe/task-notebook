// Seri (streak) ve "son N gün" hesapları — saf fonksiyonlar, App.js ve testler tarafından paylaşılır.
//
// ⚠️ BİLİNEN SINIRLAMA: geçmiş `config` (o günkü görev listesi) hiç saklanmıyor,
// sadece bugünkü liste var. Yani "3 hafta önce Salı'nın kaç görevi vardı" bilinemez —
// bugünkü listedeki, o günün hafta gününe (trIndex) denk gelen görevler yaklaşık
// olarak kullanılıyor. Görevler eklenip silindiyse ya da metni değiştiyse geçmiş
// oranlar gerçek değeri yansıtmayabilir. Bu yüzden sonuç UI'da bir not olarak
// mutlaka belirtilmeli, sayıya kesin gözüyle bakılmamalı.
import { trIndex, dateKey } from './dates';

// Tek bir günün tamamlanma durumu. total=0 → o gün için hiç görev tanımlı değil
// ("veri yok" anlamında), ratio null döner — bu, seriyi bozmayan/saymayan gün demektir.
function dayCompletion(config, prog, date){
  const tasks = config?.daily?.[trIndex(date)] || [];
  if(tasks.length===0) return { done:0, total:0, ratio:null };
  const doneMap = prog?.daily?.[dateKey(date)] || {};
  const done = tasks.filter(t=>doneMap[t.id]).length;
  return { done, total:tasks.length, ratio: done/tasks.length };
}

// Son n günün (bugün dahil) tamamlanma oranlarını, eskiden yeniye sırayla döndürür.
export function lastNDays(config, prog, today=new Date(), n=30){
  const out = [];
  for(let i=n-1;i>=0;i--){
    const d = new Date(today); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    out.push({ date:d, key:dateKey(d), ...dayCompletion(config, prog, d) });
  }
  return out;
}

// Bugünden geriye doğru, o günün TÜM görevleri tamamlanmış ardışık gün sayısı.
// Görevi olmayan günler (total=0) atlanır: seriyi ne bozar ne de sayıya katar.
// Arama, prog'un budandığı ufuk olan 400 günle sınırlı (App.js'teki pruneProg ile tutarlı) —
// bu ufkun ötesinde zaten veri tutulmuyor, dolayısıyla o günler "tamamlanmamış" görünür
// ve seri orada doğal olarak durur.
export function computeStreak(config, prog, today=new Date()){
  let streak = 0;
  const base = new Date(today); base.setHours(0,0,0,0);
  for(let i=0;i<400;i++){
    const cur = new Date(base); cur.setDate(base.getDate()-i);
    const { total, done } = dayCompletion(config, prog, cur);
    if(total===0) continue; // görevi olmayan gün: atla, ne bozar ne sayar
    if(done===total) streak++;
    else break; // yarım kalmış gün serinin sonu
  }
  return streak;
}
