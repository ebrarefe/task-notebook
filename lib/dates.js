// Tarih yardımcıları — saf fonksiyonlar, App.js ve testler tarafından paylaşılır
export const trIndex = (d) => (d.getDay()+6)%7;                  // Pzt=0 … Paz=6
export const pad = (n) => String(n).padStart(2,'0');
export const dateKey = (d=new Date()) => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
export function weekKey(d0){ const d=d0?new Date(d0):new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+3-((d.getDay()+6)%7)); const w1=new Date(d.getFullYear(),0,4);
  const n=1+Math.round(((d-w1)/86400000-3+((w1.getDay()+6)%7))/7); return d.getFullYear()+'-W'+pad(n); }
export const dayOfYear = (d) => Math.floor((d-new Date(d.getFullYear(),0,0))/86400000);
