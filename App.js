// Görev Defteri — kişisel günlük/haftalık görev + ezber takibi (Expo / React Native)
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Platform, Switch, KeyboardAvoidingView, StatusBar as RNStatusBar, AppState, Linking, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Calendar from 'expo-calendar';
// not: expo-file-system SDK54+'ta yeni File/Paths API'sine geçti; o API tamamen native
// bağlamalı (web'de write/text metotları hiç yok) ve rastgele content:// URI'lerle (dosya
// seçiciden gelen) iyi çalışmıyor. Burada string URI alıp veren eski `legacy` API bilinçli
// tercih edildi — Sharing.shareAsync bir URI string bekliyor, DocumentPicker de URI string
// döndürüyor, ikisi de legacy'nin writeAsStringAsync/readAsStringAsync'iyle doğrudan uyuşuyor.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { trIndex, pad, dateKey, weekKey, dayOfYear } from './lib/dates';
import { computeStreak, lastNDays } from './lib/streak';

SplashScreen.preventAutoHideAsync().catch(()=>{});

// ---------- theme ----------
const C = {
  paper:'#F1ECE0', paper2:'#E9E2D2', card:'#F7F3EA', ink:'#1B1A17', muted:'#6E675A',
  blue:'#294B8F', blueDeep:'#1E3568', ochre:'#D8982B', ochreDeep:'#A9741A',
  done:'#4E7A5A', line:'#D6CDBB',
};
const DAYS  = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];
const SHORT = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

// ---------- helpers ----------
// not: trIndex/pad/dateKey/weekKey/dayOfYear artık lib/dates.js'te (saf fonksiyonlar, testli)
const uid = () => 'id'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const trDate = (d=new Date()) => d.toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

// günün ezberini id'ye göre sabit sıralı bir kopyadan seç — kart eklenince/silinince
// dizinin sırası değişse de rotasyon kaymasın (dayOfYear % length hep aynı kartı bulsun)
function pickDailyMem(memorize, date){
  if(!memorize || !memorize.length) return null;
  const sorted = [...memorize].sort((a,b)=> a.id<b.id?-1:a.id>b.id?1:0);
  return sorted[dayOfYear(date)%sorted.length];
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner:true, shouldShowList:true, shouldPlaySound:true, shouldSetBadge:false,
  }),
});

async function ensurePerms(){
  if(!Device.isDevice) return false;
  const cur = await Notifications.getPermissionsAsync();
  if(cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}
async function scheduleDynamic(config, remind, prog){
  await Notifications.cancelAllScheduledNotificationsAsync();
  if(!remind.enabled) return { ok:true, scheduled:0, failed:0 };
  const ok = await ensurePerms(); if(!ok) return { ok:false, scheduled:0, failed:0 };
  if(Platform.OS==='android'){
    await Notifications.setNotificationChannelAsync('daily', {
      name:'Günlük hatırlatma', importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let scheduled=0, failed=0;
  const now = new Date();
  for(let k=0;k<14;k++){
    const d = new Date(now); d.setDate(now.getDate()+k);
    d.setHours(remind.hour, remind.minute, 0, 0);
    const ti = (d.getDay()+6)%7;
    const daily  = config.daily[ti] || [];
    const weekly = config.weekly || [];
    const mem = pickDailyMem(config.memorize, d);

    if(d > now){
      const parts = [`${daily.length} günlük · ${weekly.length} haftalık görev`];
      if(mem) parts.push(`Ezber: ${mem.title}`);
      try{
        await Notifications.scheduleNotificationAsync({
          content:{ title:`Görev Defteri · ${DAYS[ti]}`, body: parts.join('\n') },
          trigger:{ type: Notifications.SchedulableTriggerInputTypes.DATE, date: d, channelId:'daily' },
        });
        scheduled++;
      }catch(e){ failed++; }
    }

    const doneMap = prog.daily?.[dateKey(d)] || {};
    const allDone = daily.length>0 && daily.every(t=>doneMap[t.id]);
    if(remind.warn && daily.length>0 && !(k===0 && allDone)){
      const w = new Date(d); w.setHours(remind.warnHour, remind.warnMinute, 0, 0);
      if(w > now){
        try{
          await Notifications.scheduleNotificationAsync({
            content:{ title:`Görev Defteri · ${DAYS[ti]}`, body:`Bugünkü ${daily.length} görevi tamamladın mı? Kalanları unutma.` },
            trigger:{ type: Notifications.SchedulableTriggerInputTypes.DATE, date: w, channelId:'daily' },
          });
          scheduled++;
        }catch(e){ failed++; }
      }
    }
  }
  return { ok:true, scheduled, failed };
}

// planlama çalışmaları asla iç içe geçmesin — modül seviyesinde söz zinciri
let scheduleChain = Promise.resolve();
const queueSchedule = (fn)=>{ scheduleChain = scheduleChain.then(fn, fn); return scheduleChain; };

async function openExactAlarmSettings(){
  if(Platform.OS!=='android') return;
  try{ await Linking.sendIntent('android.settings.REQUEST_SCHEDULE_EXACT_ALARM'); }
  catch(e){ Linking.openSettings().catch(()=>{}); }
}

async function getTodayEvents(date){
  let perm = await Calendar.getCalendarPermissionsAsync();
  if(perm.status !== 'granted') perm = await Calendar.requestCalendarPermissionsAsync();
  if(perm.status !== 'granted') return [];
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  if(!cals.length) return [];
  const start = new Date(date); start.setHours(0,0,0,0);
  const end   = new Date(date); end.setHours(23,59,59,999);
  const events = await Calendar.getEventsAsync(cals.map(c=>c.id), start, end);
  return events.sort((a,b)=> new Date(a.startDate)-new Date(b.startDate))
    .map(e=>({ id:e.id, title:e.title,
      time: e.allDay ? 'Tüm gün'
        : new Date(e.startDate).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}) }));
}

// ---------- veri güvenliği: yedek al / geri yükle / geçmiş budama ----------

// prog sonsuza kadar büyümesin diye yüklemede bir kez buda — dateKey ('YYYY-MM-DD')
// ve weekKey ('YYYY-Www') formatları zaten sıfır dolgulu, yani sözlük sırasıyla
// (string karşılaştırmasıyla) kronolojik sıra korunuyor; ekstra tarih ayrıştırmaya gerek yok.
function pruneProg(p, ref=new Date()){
  const cutDaily  = dateKey(new Date(ref.getTime() - 400*86400000));
  const cutWeekly = weekKey(new Date(ref.getTime() - 60*7*86400000));
  const daily = {};  for(const k in (p.daily||{}))  if(k >= cutDaily)  daily[k]  = p.daily[k];
  const weekly = {}; for(const k in (p.weekly||{})) if(k >= cutWeekly) weekly[k] = p.weekly[k];
  return { ...p, daily, weekly };
}

// ezber kartlarına sonradan eklenen hard/seen alanları eski kayıtlarda (ve eski
// yedeklerde) yok — okurken varsayılan uygula, yoksa eski veri yüklenince çöker.
// not: isValidBackup zaten yalnızca c.memorize'ın dizi olduğunu kontrol ediyor,
// öğe alanlarını zorunlu kılmıyor — bu yüzden eski yedekler doğrulamadan geçmeye
// devam ediyor, tek gereken import sonrası bu normalizasyonu uygulamak.
function normalizeMemorize(list){
  return (Array.isArray(list)?list:[]).map(m=>({ hard:false, seen:0, ...m }));
}

// içe aktarılan dosyanın gerçekten bir Görev Defteri yedeği olduğunu doğrula
function isValidBackup(obj){
  if(!obj || typeof obj!=='object') return false;
  if(obj.version !== 1) return false;
  const c = obj.config;
  if(!c || typeof c!=='object') return false;
  if(!c.daily || typeof c.daily!=='object') return false;
  for(let i=0;i<7;i++) if(!Array.isArray(c.daily[i])) return false;
  if(!Array.isArray(c.weekly)) return false;
  if(!Array.isArray(c.memorize)) return false;
  return true;
}

async function exportBackup(config, prog, remind){
  const payload = { version:1, exportedAt:new Date().toISOString(), config, prog, remind };
  const uri = FileSystem.documentDirectory + `gorev-defteri-yedek-${dateKey(new Date())}.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload));
  const available = await Sharing.isAvailableAsync();
  if(!available){
    Alert.alert('Paylaşım kullanılamıyor', 'Bu cihazda dosya paylaşımı desteklenmiyor. Yedek dosyası uygulama içinde oluşturuldu ama paylaşılamadı.');
    return;
  }
  await Sharing.shareAsync(uri, { mimeType:'application/json', dialogTitle:'Görev Defteri yedeğini paylaş', UTI:'public.json' });
}

async function importBackup(setConfig, setProg, setRemind){
  const res = await DocumentPicker.getDocumentAsync({ type:'application/json', copyToCacheDirectory:true });
  if(res.canceled) return;
  const asset = res.assets && res.assets[0];
  if(!asset) return;
  let data;
  try{
    const text = await FileSystem.readAsStringAsync(asset.uri);
    data = JSON.parse(text);
  }catch(e){
    Alert.alert('Dosya okunamadı', 'Seçilen dosya bozuk ya da geçerli bir JSON değil. Verin değiştirilmedi.');
    return;
  }
  if(!isValidBackup(data)){
    Alert.alert('Geçersiz yedek dosyası', 'Bu dosya bir Görev Defteri yedeği gibi görünmüyor. Verin değiştirilmedi.');
    return;
  }
  Alert.alert(
    'Geri yükleme onayı',
    'Mevcut verinin üzerine yazılacak, bu geri alınamaz. Devam edilsin mi?',
    [
      { text:'İptal', style:'cancel' },
      { text:'Geri yükle', style:'destructive', onPress:()=>{
        setConfig({ ...data.config, memorize: normalizeMemorize(data.config.memorize) });
        setProg(data.prog && typeof data.prog==='object' ? data.prog : { daily:{}, weekly:{} });
        if(data.remind && typeof data.remind==='object') setRemind(r=>({ ...r, ...data.remind }));
      }},
    ],
  );
}

// ---------- app ----------
export default function App(){
  const [loaded,setLoaded]   = useState(false);
  const [config,setConfig]   = useState({ daily:{0:[],1:[],2:[],3:[],4:[],5:[],6:[]}, weekly:[], memorize:[] });
  const [prog,setProg]       = useState({ daily:{}, weekly:{} });
  const [remind,setRemind]   = useState({ enabled:false, hour:8, minute:0, warn:true, warnHour:21, warnMinute:0 });
  const [tab,setTab]         = useState('today');
  const [now,setNow]         = useState(new Date());
  const [calNonce,setCalNonce] = useState(0);
  const [selDay,setSelDay]   = useState(trIndex(new Date()));
  const [events,setEvents]   = useState([]);
  const [schedResult,setSchedResult] = useState(null);
  const today = trIndex(now);
  const dk = dateKey(now), wk = weekKey(now);
  const bumpDay = ()=> setNow(prev => dateKey(prev)===dateKey(new Date()) ? prev : new Date());

  // load
  useEffect(()=>{ (async()=>{
    try{
      const [c,p,r] = await Promise.all([
        AsyncStorage.getItem('gd-config'),
        AsyncStorage.getItem('gd-progress'),
        AsyncStorage.getItem('gd-remind'),
      ]);
      if(c){ const cf=JSON.parse(c); for(let i=0;i<7;i++) if(!Array.isArray(cf.daily?.[i])) cf.daily[i]=[];
             if(!Array.isArray(cf.weekly)) cf.weekly=[]; if(!Array.isArray(cf.memorize)) cf.memorize=[];
             cf.memorize = normalizeMemorize(cf.memorize); setConfig(cf); }
      else{ setConfig(cfg=>({ ...cfg, weekly:[
             {id:uid(),text:'Bu haftanın şiirini oku'},
             {id:uid(),text:'Kitap: ~200 sayfa (2 haftada 1)'} ]})); }
      if(p) setProg(pruneProg(JSON.parse(p)));
      if(r) setRemind(r0=>({ ...r0, ...JSON.parse(r) }));
    }catch(e){}
    setLoaded(true);
    SplashScreen.hideAsync().catch(()=>{});
  })(); },[]);

  // persist
  useEffect(()=>{ if(loaded) AsyncStorage.setItem('gd-config',JSON.stringify(config)); },[config,loaded]);
  useEffect(()=>{ if(loaded) AsyncStorage.setItem('gd-progress',JSON.stringify(prog)); },[prog,loaded]);
  useEffect(()=>{ if(loaded) AsyncStorage.setItem('gd-remind',JSON.stringify(remind)); },[remind,loaded]);

  // gün her zaman güncel kalsın — saat hiçbir yerde kullanılmadığı için gün değişmediyse aynı referans döner
  useEffect(()=>{
    const sub = AppState.addEventListener('change', st=>{
      if(st==='active'){ bumpDay(); setCalNonce(n=>n+1); }
    });
    const id = setInterval(bumpDay, 60*1000);
    return ()=>{ sub.remove(); clearInterval(id); };
  },[]);

  // bildirimleri config/ilerleme/ayar değişince yeniden planla — hızlı tıklamalar debounce ile tek planlamaya çöker.
  // not: remind.enabled false olsa da çalıştır — scheduleDynamic önce cancelAll yapıp sonra dönüyor.
  // Aksi halde hatırlatma kapatıldığında önceden kurulmuş bildirimler iptal edilmeden gelmeye devam ederdi.
  useEffect(()=>{
    if(!loaded) return;
    const t = setTimeout(()=>{
      queueSchedule(()=> scheduleDynamic(config, remind, prog).then(setSchedResult).catch(()=>{}));
    }, 800);
    return ()=> clearTimeout(t);
  },[config, prog, remind, loaded]);

  // gün değişince ya da uygulama ön plana gelince telefon takvimini oku
  useEffect(()=>{ getTodayEvents(now).then(setEvents).catch(()=>{}); },[now, calNonce]);

  // ---- mutations ----
  const addDaily = (day,text)=>{ text=text.trim(); if(!text) return;
    setConfig(c=>({ ...c, daily:{ ...c.daily, [day]:[...c.daily[day],{id:uid(),text}] } })); };
  const delDaily = (day,id)=> Alert.alert('Görevi sil', 'Bu günlük görevi silmek istediğine emin misin?', [
    { text:'İptal', style:'cancel' },
    { text:'Sil', style:'destructive', onPress:()=> setConfig(c=>({ ...c, daily:{ ...c.daily, [day]:c.daily[day].filter(t=>t.id!==id) } })) },
  ]);
  const editDaily = (day,id,text)=>{ text=text.trim(); if(!text) return;
    setConfig(c=>({ ...c, daily:{ ...c.daily, [day]:c.daily[day].map(t=>t.id===id?{...t,text}:t) } })); };
  const addWeekly = (text)=>{ text=text.trim(); if(!text) return; setConfig(c=>({ ...c, weekly:[...c.weekly,{id:uid(),text}] })); };
  const delWeekly = (id)=> Alert.alert('Görevi sil', 'Bu haftalık görevi silmek istediğine emin misin?', [
    { text:'İptal', style:'cancel' },
    { text:'Sil', style:'destructive', onPress:()=> setConfig(c=>({ ...c, weekly:c.weekly.filter(t=>t.id!==id) })) },
  ]);
  const editWeekly = (id,text)=>{ text=text.trim(); if(!text) return;
    setConfig(c=>({ ...c, weekly:c.weekly.map(t=>t.id===id?{...t,text}:t) })); };
  const addMem = (title,body)=>{ if(!title.trim() && !body.trim()) return;
    setConfig(c=>({ ...c, memorize:[...c.memorize,{id:uid(),title:title.trim()||'(başlıksız)',body:body.trim(),hard:false,seen:0}] })); };
  const delMem = (id)=> Alert.alert('Ezberi sil', 'Bu ezber kartını silmek istediğine emin misin? Elle yazdığın metin kalıcı olarak silinecek.', [
    { text:'İptal', style:'cancel' },
    { text:'Sil', style:'destructive', onPress:()=> setConfig(c=>({ ...c, memorize:c.memorize.filter(m=>m.id!==id) })) },
  ]);
  const editMem = (id,title,body)=>{ title=title.trim(); body=body.trim(); if(!title && !body) return;
    setConfig(c=>({ ...c, memorize:c.memorize.map(m=>m.id===id?{...m,title:title||'(başlıksız)',body}:m) })); };
  // kart modunda "Bilemedim"/"Biliyorum" işaretlemesi — hard bayrağı + görülme sayacı
  const markMem = (id,hard)=> setConfig(c=>({ ...c, memorize:c.memorize.map(m=>m.id===id?{...m,hard,seen:(m.seen||0)+1}:m) }));

  const toggleDaily = (id)=> setProg(p=>{ const d={...(p.daily||{})}; const day={...(d[dk]||{})}; day[id]=!day[id]; d[dk]=day; return {...p,daily:d}; });
  const toggleWeekly= (id)=> setProg(p=>{ const w={...(p.weekly||{})}; const wkO={...(w[wk]||{})}; wkO[id]=!wkO[id]; w[wk]=wkO; return {...p,weekly:w}; });
  const dDone = (id)=> !!(prog.daily?.[dk]?.[id]);
  const wDone = (id)=> !!(prog.weekly?.[wk]?.[id]);

  if(!loaded) return <View style={[s.screen,{justifyContent:'center',alignItems:'center'}]}><Text style={s.muted}>yükleniyor…</Text></View>;

  return (
    <View style={s.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
        {/* header */}
        <View style={s.header}>
          <Text style={s.kicker}>KİŞİSEL · RÛZNAME</Text>
          <Text style={s.h1}>Görev Defteri</Text>
          <Text style={s.date}>Bugün: <Text style={{color:C.ink,fontWeight:'700'}}>{trDate()}</Text></Text>
          <View style={s.spine}>
            {SHORT.map((sh,i)=>(
              <TouchableOpacity key={i} onPress={()=>{ setSelDay(i); setTab('daily'); }}
                style={[s.spineBtn, i===today && s.spineToday]}>
                <Text style={[s.spineTxt, i===today && {color:C.ink}]}>{sh}</Text>
                {i===today && <View style={s.spineDot} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* content */}
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:16,paddingBottom:32}} keyboardShouldPersistTaps="handled">
          {tab==='today'    && <TodayView {...{config,prog,today,now,events,dDone,wDone,toggleDaily,toggleWeekly,remind,setRemind,schedResult,setConfig,setProg}} />}
          {tab==='daily'    && <DailyView {...{config,selDay,setSelDay,today,addDaily,delDaily,editDaily}} />}
          {tab==='weekly'   && <WeeklyView {...{config,wDone,toggleWeekly,addWeekly,delWeekly,editWeekly}} />}
          {tab==='memorize' && <MemorizeView {...{config,addMem,delMem,editMem,markMem}} />}
        </ScrollView>

        {/* tab bar */}
        <View style={s.tabbar}>
          {[['today','Bugün'],['daily','Günlük'],['weekly','Haftalık'],['memorize','Ezber']].map(([k,label])=>(
            <TouchableOpacity key={k} style={s.tabBtn} onPress={()=>setTab(k)}>
              <Text style={[s.tabTxt, tab===k && s.tabActive]}>{label}</Text>
              {tab===k && <View style={s.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------- shared rows ----------
// onSave verilirse metne dokununca satır içi düzenleme açılır (boş metne kaydetmeye izin verilmez)
function CheckRow({text,done,onToggle,onDelete,onSave}){
  const [editing,setEditing]=useState(false);
  const [v,setV]=useState(text);
  const startEdit=()=>{ setV(text); setEditing(true); };
  const save=()=>{ const t=v.trim(); if(!t) return; onSave(t); setEditing(false); };
  const cancel=()=>{ setV(text); setEditing(false); };
  if(editing){
    return (
      <View style={[s.item, done && s.itemDone]}>
        <TouchableOpacity onPress={onToggle} style={[s.chk, done && s.chkDone]}
          accessibilityRole="checkbox" accessibilityState={{checked:done}} accessibilityLabel={text}>
          {done && <Text style={s.chkMark}>✓</Text>}
        </TouchableOpacity>
        <TextInput style={[s.input,{flex:1,paddingVertical:6}]} value={v} onChangeText={setV}
          autoFocus onSubmitEditing={save} returnKeyType="done" />
        <TouchableOpacity onPress={save} style={s.del} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel="Kaydet"><Text style={[s.delTxt,{color:C.done}]}>✓</Text></TouchableOpacity>
        <TouchableOpacity onPress={cancel} style={s.del} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel="İptal"><Text style={s.delTxt}>×</Text></TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={[s.item, done && s.itemDone]}>
      <TouchableOpacity onPress={onToggle} style={[s.chk, done && s.chkDone]}
        accessibilityRole="checkbox" accessibilityState={{checked:done}} accessibilityLabel={text}>
        {done && <Text style={s.chkMark}>✓</Text>}
      </TouchableOpacity>
      {onSave
        ? <TouchableOpacity onPress={startEdit} style={{flex:1}}><Text style={[s.itemTxt, done && s.itemTxtDone]}>{text}</Text></TouchableOpacity>
        : <Text style={[s.itemTxt, done && s.itemTxtDone]}>{text}</Text>}
      {onDelete && <TouchableOpacity onPress={onDelete} style={s.del} hitSlop={{top:10,bottom:10,left:10,right:10}}><Text style={s.delTxt}>×</Text></TouchableOpacity>}
    </View>
  );
}
// EditRow: metne dokun → satır içi TextInput → kaydet/iptal. Boş metne kaydetmeye izin verilmez.
function EditRow({text,onDelete,onSave}){
  const [editing,setEditing]=useState(false);
  const [v,setV]=useState(text);
  const startEdit=()=>{ setV(text); setEditing(true); };
  const save=()=>{ const t=v.trim(); if(!t) return; onSave(t); setEditing(false); };
  const cancel=()=>{ setV(text); setEditing(false); };
  if(editing){
    return (
      <View style={s.item}>
        <TextInput style={[s.input,{flex:1,paddingVertical:6}]} value={v} onChangeText={setV}
          autoFocus onSubmitEditing={save} returnKeyType="done" />
        <TouchableOpacity onPress={save} style={s.del} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel="Kaydet"><Text style={[s.delTxt,{color:C.done}]}>✓</Text></TouchableOpacity>
        <TouchableOpacity onPress={cancel} style={s.del} hitSlop={{top:10,bottom:10,left:10,right:10}} accessibilityLabel="İptal"><Text style={s.delTxt}>×</Text></TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={s.item}>
      <TouchableOpacity onPress={startEdit} style={{flex:1}}><Text style={s.itemTxt}>{text}</Text></TouchableOpacity>
      <TouchableOpacity onPress={onDelete} style={s.del} hitSlop={{top:10,bottom:10,left:10,right:10}}><Text style={s.delTxt}>×</Text></TouchableOpacity>
    </View>
  );
}
function AddBar({placeholder,onAdd}){
  const [v,setV]=useState('');
  const go=()=>{ if(v.trim()){ onAdd(v); setV(''); } };
  return (
    <View style={s.addRow}>
      <TextInput style={s.input} placeholder={placeholder} placeholderTextColor={C.muted}
        value={v} onChangeText={setV} onSubmitEditing={go} returnKeyType="done" />
      <TouchableOpacity style={s.addBtn} onPress={go}><Text style={s.addBtnTxt}>Ekle</Text></TouchableOpacity>
    </View>
  );
}
const SectionH = ({title,count})=>(
  <View style={s.secH}><Text style={s.secTitle}>{title}</Text>{count!=null && <Text style={s.count}>{count}</Text>}</View>
);
const Eyebrow = ({children})=> <Text style={s.eyebrow}>{children}</Text>;
const Empty = ({children})=> <Text style={s.empty}>{children}</Text>;

// ---------- Today ----------
function TodayView({config,prog,today,now,events,dDone,wDone,toggleDaily,toggleWeekly,remind,setRemind,schedResult,setConfig,setProg}){
  const [revealed,setRevealed]=useState(false);
  const dt=config.daily[today]||[];
  const mem=pickDailyMem(config.memorize, now);
  return (
    <View>
      <Eyebrow>BUGÜN · {DAYS[today]}</Eyebrow>

      <View style={s.sec}>
        <SectionH title="Bugünün takvimi" count={events.length ? String(events.length) : null} />
        {events.length ? events.map(e=>(
          <View key={e.id} style={s.item}>
            <Text style={[s.itemTxt,{flex:0,fontWeight:'700',color:C.blueDeep,marginRight:10}]}>{e.time}</Text>
            <Text style={[s.itemTxt,{flex:1}]}>{e.title}</Text>
          </View>
        )) : <Empty>Bugün için telefon takviminde etkinlik yok.</Empty>}
      </View>

      <View style={s.sec}>
        <SectionH title="Günün görevleri" count={dt.length?`${dt.filter(t=>dDone(t.id)).length} / ${dt.length}`:'0'} />
        {dt.length ? dt.map(t=><CheckRow key={t.id} text={t.text} done={dDone(t.id)} onToggle={()=>toggleDaily(t.id)} />)
                   : <Empty>Bu güne görev yok — “Günlük” sekmesinden ekle.</Empty>}
      </View>

      <View style={s.sec}>
        <SectionH title="Bu haftanın görevleri" count={config.weekly.length?`${config.weekly.filter(t=>wDone(t.id)).length} / ${config.weekly.length}`:'0'} />
        {config.weekly.length ? config.weekly.map(t=><CheckRow key={t.id} text={t.text} done={wDone(t.id)} onToggle={()=>toggleWeekly(t.id)} />)
                              : <Empty>Haftalık görev yok — “Haftalık” sekmesinden ekle.</Empty>}
      </View>

      <StreakStrip config={config} prog={prog} now={now} />

      {mem && (
        <View style={s.sec}>
          <Eyebrow>GÜNÜN EZBERİ</Eyebrow>
          <View style={s.ezber}>
            <Text style={s.ezberTitle}>{mem.title}</Text>
            <Text style={s.ezberBody}>{revealed ? mem.body : '••• hatırla, sonra göster'}</Text>
            <TouchableOpacity style={[s.btnGhost,{marginTop:10,alignSelf:'flex-start'}]} onPress={()=>setRevealed(r=>!r)}>
              <Text style={s.btnGhostTxt}>{revealed?'Gizle':'Göster'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ReminderCard remind={remind} setRemind={setRemind} config={config} prog={prog} schedResult={schedResult} />

      <DataCard config={config} prog={prog} remind={remind} setConfig={setConfig} setProg={setProg} setRemind={setRemind} />
    </View>
  );
}

// son 30 gün şeridi + güncel seri — hesap lib/streak.js'te saf fonksiyon olarak test edilir
function StreakStrip({config,prog,now}){
  const days = lastNDays(config, prog, now, 30);
  const streak = computeStreak(config, prog, now);
  const cellColor = (ratio)=>{
    if(ratio==null) return { backgroundColor:C.paper2, borderColor:C.line }; // o gün görev yoktu
    if(ratio<=0) return { backgroundColor:C.paper, borderColor:C.line };
    if(ratio>=1) return { backgroundColor:C.done, borderColor:C.done };
    // ara ton: yeni renk uydurmadan, mevcut C.done'ın opaklığını orana göre kademelendir
    return { backgroundColor:C.done, borderColor:C.done, opacity:0.3+ratio*0.6 };
  };
  return (
    <View style={s.sec}>
      <SectionH title="Son 30 gün" count={`${streak} gün seri`} />
      <View style={s.streakRow}>
        {days.map(d=> <View key={d.key} style={[s.streakCell, cellColor(d.ratio)]} />)}
      </View>
      <Text style={s.streakNote}>
        Not: geçmiş günlerin görev listesi ayrıca saklanmıyor — o günün hafta gününe göre bugünkü liste
        yaklaşık olarak kullanılıyor. Sayı fikir vericidir, kesin değildir.
      </Text>
    </View>
  );
}

function DataCard({config,prog,remind,setConfig,setProg,setRemind}){
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState('');

  const doExport=async()=>{
    setBusy(true); setMsg('');
    try{ await exportBackup(config,prog,remind); setMsg('Yedek oluşturuldu.'); }
    catch(e){ setMsg('Yedek alınamadı: '+(e?.message||'bilinmeyen hata')); }
    setBusy(false);
  };
  const doImport=async()=>{
    setBusy(true); setMsg('');
    try{ await importBackup(setConfig,setProg,setRemind); }
    catch(e){ setMsg('Geri yükleme başarısız: '+(e?.message||'bilinmeyen hata')); }
    setBusy(false);
  };

  return (
    <View style={s.sec}>
      <Eyebrow>VERİ</Eyebrow>
      <View style={s.remindCard}>
        <Text style={s.remindLabel}>Verini yedekle, ya da bir yedekten geri yükle</Text>
        <View style={{flexDirection:'row',gap:8,marginTop:12}}>
          <TouchableOpacity style={s.btnFill} disabled={busy} onPress={doExport}><Text style={s.btnFillTxt}>Yedek al</Text></TouchableOpacity>
          <TouchableOpacity style={s.btnGhost} disabled={busy} onPress={doImport}><Text style={s.btnGhostTxt}>Geri yükle</Text></TouchableOpacity>
        </View>
        {!!msg && <Text style={s.remindMsg}>{msg}</Text>}
      </View>
    </View>
  );
}

function ReminderCard({remind,setRemind,config,prog,schedResult}){
  const [msg,setMsg]=useState('');
  const bump=(field,delta,max)=> setRemind(r=>({ ...r, [field]:(r[field]+delta+max)%max }));
  const apply=async(next)=>{
    if(next.enabled){
      const ok = await ensurePerms();
      setMsg(ok?'Planlanıyor…':'Bildirim izni verilmedi ya da gerçek cihaz gerekiyor.');
    }else{
      setMsg('Günlük hatırlatma kapatıldı.');
    }
    setRemind(next);
  };
  // gerçek planlama sonucu App'ten gelince mesajı buna göre güncelle
  useEffect(()=>{
    if(!schedResult || !remind.enabled) return;
    setMsg(schedResult.ok
      ? (schedResult.failed>0
          ? `${schedResult.scheduled} bildirim kuruldu, ${schedResult.failed} bildirim kurulamadı.`
          : `${schedResult.scheduled} bildirim kuruldu.`)
      : 'Bildirim izni verilmedi ya da gerçek cihaz gerekiyor.');
  },[schedResult]);
  return (
    <View style={s.sec}>
      <Eyebrow>GÜNLÜK HATIRLATMA</Eyebrow>
      <View style={s.remindCard}>
        <View style={s.remindRow}>
          <Text style={s.remindLabel}>Her sabah bildirim gönder</Text>
          <Switch value={remind.enabled} trackColor={{true:C.blue}} thumbColor={C.paper}
            onValueChange={(v)=>apply({...remind,enabled:v})} />
        </View>
        <View style={s.timeRow}>
          <Stepper label="Saat"  value={pad(remind.hour)}   onMinus={()=>bump('hour',-1,24)}   onPlus={()=>bump('hour',1,24)} />
          <Text style={s.colon}>:</Text>
          <Stepper label="Dakika" value={pad(remind.minute)} onMinus={()=>bump('minute',-5,60)} onPlus={()=>bump('minute',5,60)} />
        </View>
        <View style={s.timeRow}>
          <Stepper label="Akşam kontrol saati"  value={pad(remind.warnHour)}   onMinus={()=>bump('warnHour',-1,24)}   onPlus={()=>bump('warnHour',1,24)} />
          <Text style={s.colon}>:</Text>
          <Stepper label="Dakika" value={pad(remind.warnMinute)} onMinus={()=>bump('warnMinute',-5,60)} onPlus={()=>bump('warnMinute',5,60)} />
          <TouchableOpacity style={[s.btnFill,{marginLeft:'auto'}]} onPress={()=>apply(remind)}>
            <Text style={s.btnFillTxt}>Kaydet</Text>
          </TouchableOpacity>
        </View>
        {!!msg && <Text style={s.remindMsg}>{msg}</Text>}
        {remind.enabled && Platform.OS==='android' && (
          <View style={{marginTop:12}}>
            <Text style={[s.remindMsg,{marginTop:0}]}>
              Bildirimler bazen gecikiyor ya da hiç gelmiyorsa: (1) aşağıdaki butonla "Alarmlar ve hatırlatıcılar"
              iznini aç, (2) telefon Ayarlar → Uygulamalar → Görev Defteri → Pil bölümünden "Kısıtlanmasın / Sınırsız"
              seç (Samsung/Xiaomi/Huawei gibi markalarda bu OS'un kendi kısıtlaması, uygulama içinden düzeltilemiyor).
            </Text>
            <TouchableOpacity style={[s.btnGhost,{marginTop:8,alignSelf:'flex-start'}]} onPress={openExactAlarmSettings}>
              <Text style={s.btnGhostTxt}>Alarm iznini aç</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}
function Stepper({label,value,onMinus,onPlus}){
  return (
    <View style={{alignItems:'center'}}>
      <Text style={s.stepperLabel}>{label}</Text>
      <View style={s.stepper}>
        <TouchableOpacity onPress={onMinus} style={s.stepBtn} accessibilityLabel={`${label} azalt`}><Text style={s.stepBtnTxt}>–</Text></TouchableOpacity>
        <Text style={s.stepVal}>{value}</Text>
        <TouchableOpacity onPress={onPlus} style={s.stepBtn} accessibilityLabel={`${label} artır`}><Text style={s.stepBtnTxt}>+</Text></TouchableOpacity>
      </View>
    </View>
  );
}

// ---------- Daily editor ----------
function DailyView({config,selDay,setSelDay,today,addDaily,delDaily,editDaily}){
  const list=config.daily[selDay]||[];
  return (
    <View>
      <Eyebrow>HER GÜNÜN KENDİ LİSTESİ — HER HAFTA TEKRAR EDER</Eyebrow>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:14}} contentContainerStyle={{gap:8}}>
        {DAYS.map((name,i)=>(
          <TouchableOpacity key={i} onPress={()=>setSelDay(i)}
            style={[s.dayPill, selDay===i && s.dayPillActive, i===today && selDay!==i && s.dayPillToday]}>
            <Text style={[s.dayPillTxt, selDay===i && {color:C.paper}]}>{name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={s.dayCard}>
        <View style={s.dayHead}>
          <Text style={s.dayHeadTxt}>{DAYS[selDay]}</Text>
          {selDay===today && <Text style={s.flag}>BUGÜN</Text>}
          <Text style={[s.count,{marginLeft:'auto'}]}>{list.length} görev</Text>
        </View>
        <View style={{padding:12}}>
          {list.length ? list.map(t=><EditRow key={t.id} text={t.text} onDelete={()=>delDaily(selDay,t.id)} onSave={(v)=>editDaily(selDay,t.id,v)} />) : <Empty>Boş.</Empty>}
          <AddBar placeholder={`Yeni görev — ${DAYS[selDay]}`} onAdd={(v)=>addDaily(selDay,v)} />
        </View>
      </View>
    </View>
  );
}

// ---------- Weekly ----------
function WeeklyView({config,wDone,toggleWeekly,addWeekly,delWeekly,editWeekly}){
  return (
    <View>
      <Eyebrow>TÜM HAFTA İÇİN — HER HAFTA BAŞINDA SIFIRLANIR</Eyebrow>
      <View style={s.sec}>
        <SectionH title="Haftalık görevler" count={config.weekly.length?`${config.weekly.filter(t=>wDone(t.id)).length} / ${config.weekly.length}`:'0'} />
        {config.weekly.length ? config.weekly.map(t=>(
          <CheckRow key={t.id} text={t.text} done={wDone(t.id)} onToggle={()=>toggleWeekly(t.id)} onDelete={()=>delWeekly(t.id)} onSave={(v)=>editWeekly(t.id,v)} />
        )) : <Empty>Henüz haftalık görev yok.</Empty>}
        <AddBar placeholder="Yeni haftalık görev" onAdd={addWeekly} />
      </View>
    </View>
  );
}

// ---------- Memorize ----------
// çalışma sırası: önce hard=true olanlar, sonra en az görülenler (seen artan); id ile kararlı
function studyOrder(memorize){
  return [...memorize].sort((a,b)=>{
    const ah=a.hard?1:0, bh=b.hard?1:0;
    if(ah!==bh) return bh-ah;
    const as=a.seen||0, bs=b.seen||0;
    if(as!==bs) return as-bs;
    return a.id<b.id?-1:a.id>b.id?1:0;
  }).map(m=>m.id);
}
function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

function MemorizeView({config,addMem,delMem,editMem,markMem}){
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [study,setStudy]=useState(false);
  const [queue,setQueue]=useState([]);
  const [idx,setIdx]=useState(0);
  const [rev,setRev]=useState(false);

  const startStudy=()=>{ setQueue(studyOrder(config.memorize)); setIdx(0); setRev(false); setStudy(true); };
  const mark=(id,hard)=>{ markMem(id,hard); setIdx(i=>i+1); setRev(false); };

  if(study){
    // kart silinmişse kuyruktan düş — çalışma sırasında silme başka sekmeden olabilir
    const liveQueue = queue.filter(id=>config.memorize.some(m=>m.id===id));
    if(!liveQueue.length){
      return (
        <View>
          <Empty>Çalışılacak kart kalmadı.</Empty>
          <TouchableOpacity style={[s.btnGhost,{marginTop:10,alignSelf:'flex-start'}]} onPress={()=>setStudy(false)}><Text style={s.btnGhostTxt}>Bitir</Text></TouchableOpacity>
        </View>
      );
    }
    const pos = idx % liveQueue.length;
    const cur = config.memorize.find(m=>m.id===liveQueue[pos]);
    return (
      <View>
        <View style={s.flash}>
          <Text style={s.flashPrompt}>{cur.title}</Text>
          <Text style={[s.flashAnswer, !rev && {color:C.muted,fontStyle:'italic'}]}>{rev?cur.body:'••• hatırla, sonra göster'}</Text>
          {!!cur.hard && <Text style={[s.count,{marginTop:10,color:C.ochreDeep}]}>ZOR İŞARETLİ</Text>}
        </View>
        <View style={s.flashNav}>
          <TouchableOpacity style={s.btnGhost} onPress={()=>setStudy(false)}><Text style={s.btnGhostTxt}>Bitir</Text></TouchableOpacity>
          <Text style={s.count}>{pos+1} / {liveQueue.length}</Text>
          <TouchableOpacity style={s.btnGhost} onPress={()=>{ setQueue(q=>shuffle(q)); setIdx(0); setRev(false); }}><Text style={s.btnGhostTxt}>Karıştır</Text></TouchableOpacity>
        </View>
        <View style={{flexDirection:'row',gap:8,marginTop:10}}>
          <TouchableOpacity style={s.btnGhost} onPress={()=>setRev(r=>!r)}><Text style={s.btnGhostTxt}>{rev?'Gizle':'Göster'}</Text></TouchableOpacity>
          <TouchableOpacity style={[s.btnGhost,{borderColor:'#A33'}]} onPress={()=>mark(cur.id,true)}><Text style={[s.btnGhostTxt,{color:'#A33'}]}>Bilemedim</Text></TouchableOpacity>
          <TouchableOpacity style={s.btnFill} onPress={()=>mark(cur.id,false)}><Text style={s.btnFillTxt}>Biliyorum →</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Eyebrow>EZBERLENECEK METİNLER</Eyebrow>
      <TextInput style={s.input} placeholder="Başlık (ör. şiir adı / kavram)" placeholderTextColor={C.muted} value={title} onChangeText={setTitle} />
      <TextInput style={[s.input,{minHeight:90,marginTop:8,textAlignVertical:'top'}]} placeholder="Ezberlenecek metin..." placeholderTextColor={C.muted}
        value={body} onChangeText={setBody} multiline />
      <View style={{flexDirection:'row',gap:8,marginTop:8}}>
        <TouchableOpacity style={s.btnFill} onPress={()=>{ addMem(title,body); setTitle(''); setBody(''); }}><Text style={s.btnFillTxt}>Ekle</Text></TouchableOpacity>
        {config.memorize.length>0 && (
          <TouchableOpacity style={s.btnGhost} onPress={startStudy}><Text style={s.btnGhostTxt}>Çalış (kart modu)</Text></TouchableOpacity>
        )}
      </View>

      <View style={{marginTop:20}}>
        {config.memorize.length ? config.memorize.map(m=>(
          <MemCard key={m.id} m={m} onDelete={()=>delMem(m.id)} onSave={(t,b)=>editMem(m.id,t,b)} />
        )) : <Empty>Henüz metin eklenmedi.</Empty>}
      </View>
    </View>
  );
}
// ezber kartı: dokununca başlık+gövde ayrı ayrı satır içi düzenlenir; boş metne kaydetmeye izin verilmez
function MemCard({m,onDelete,onSave}){
  const [editing,setEditing]=useState(false);
  const [t,setT]=useState(m.title);
  const [b,setB]=useState(m.body);
  const start=()=>{ setT(m.title); setB(m.body); setEditing(true); };
  const save=()=>{ const tt=t.trim(), bb=b.trim(); if(!tt && !bb) return; onSave(tt,bb); setEditing(false); };
  const cancel=()=>{ setT(m.title); setB(m.body); setEditing(false); };
  if(editing){
    return (
      <View style={s.mCard}>
        <TextInput style={s.input} value={t} onChangeText={setT} placeholder="Başlık" placeholderTextColor={C.muted} />
        <TextInput style={[s.input,{minHeight:70,marginTop:8,textAlignVertical:'top'}]} value={b} onChangeText={setB}
          placeholder="Ezberlenecek metin..." placeholderTextColor={C.muted} multiline />
        <View style={{flexDirection:'row',gap:16,marginTop:8}}>
          <TouchableOpacity onPress={save}><Text style={[s.delLink,{color:C.done}]}>Kaydet</Text></TouchableOpacity>
          <TouchableOpacity onPress={cancel}><Text style={s.delLink}>İptal</Text></TouchableOpacity>
        </View>
      </View>
    );
  }
  return (
    <View style={s.mCard}>
      <TouchableOpacity onPress={start}>
        <Text style={s.mTitle}>{m.title}</Text>
        <Text style={s.mBody}>{m.body}</Text>
      </TouchableOpacity>
      <View style={{flexDirection:'row',alignItems:'center',gap:16,marginTop:8}}>
        <TouchableOpacity onPress={onDelete}><Text style={s.delLink}>Sil</Text></TouchableOpacity>
        {(m.hard || m.seen>0) ? <Text style={s.count}>{m.hard?'zor · ':''}{m.seen||0} kez çalışıldı</Text> : null}
      </View>
    </View>
  );
}

// ---------- styles ----------
const s = StyleSheet.create({
  screen:{ flex:1, backgroundColor:C.paper, paddingTop:(Platform.OS==='android'?RNStatusBar.currentHeight:0) },
  muted:{ color:C.muted },
  header:{ paddingHorizontal:16, paddingTop:14, paddingBottom:12, borderBottomWidth:2, borderBottomColor:C.ink, backgroundColor:C.paper },
  kicker:{ color:C.blue, fontSize:11, letterSpacing:2, fontWeight:'700' },
  h1:{ color:C.ink, fontSize:30, fontWeight:'800', letterSpacing:-0.5, marginTop:2 },
  date:{ color:C.muted, fontSize:12, marginTop:4 },
  spine:{ flexDirection:'row', gap:6, marginTop:12 },
  spineBtn:{ borderWidth:1.5, borderColor:C.line, backgroundColor:C.card, paddingVertical:6, paddingHorizontal:9, borderRadius:3, position:'relative' },
  spineToday:{ borderColor:C.ochreDeep },
  spineTxt:{ color:C.muted, fontSize:12, fontWeight:'600' },
  spineDot:{ position:'absolute', top:-4, right:-4, width:8, height:8, borderRadius:4, backgroundColor:C.ochre, borderWidth:1.5, borderColor:C.paper },

  sec:{ marginBottom:22 },
  secH:{ flexDirection:'row', alignItems:'baseline', gap:10, marginBottom:10 },
  secTitle:{ fontSize:20, fontWeight:'700', color:C.ink, letterSpacing:-0.3 },
  count:{ fontSize:12, color:C.muted, fontWeight:'600' },
  eyebrow:{ fontSize:11, letterSpacing:1.6, color:C.ochreDeep, fontWeight:'700', marginBottom:10 },
  empty:{ fontSize:14, color:C.muted, fontStyle:'italic', paddingVertical:8 },

  item:{ flexDirection:'row', alignItems:'center', gap:12, paddingVertical:11, paddingHorizontal:12, borderWidth:1.5, borderColor:C.line, borderRadius:4, backgroundColor:C.card, marginBottom:8 },
  itemDone:{ borderColor:C.line },
  chk:{ width:22, height:22, borderWidth:2, borderColor:C.blue, borderRadius:4, alignItems:'center', justifyContent:'center' },
  chkDone:{ backgroundColor:C.done, borderColor:C.done },
  chkMark:{ color:C.paper, fontSize:13, fontWeight:'900', lineHeight:15 },
  itemTxt:{ flex:1, fontSize:15, color:C.ink },
  itemTxtDone:{ color:C.muted, textDecorationLine:'line-through' },
  del:{ padding:4 },
  delTxt:{ fontSize:20, color:C.muted, lineHeight:20 },
  delLink:{ color:'#A33', fontSize:13, fontWeight:'600' },

  addRow:{ flexDirection:'row', gap:8, marginTop:6 },
  input:{ flex:1, fontSize:15, paddingVertical:10, paddingHorizontal:12, borderWidth:1.5, borderColor:C.line, borderRadius:4, backgroundColor:C.paper, color:C.ink },
  addBtn:{ paddingHorizontal:16, justifyContent:'center', backgroundColor:C.ink, borderRadius:4 },
  addBtnTxt:{ color:C.paper, fontWeight:'700', fontSize:14 },

  btnFill:{ backgroundColor:C.ink, borderRadius:4, paddingVertical:10, paddingHorizontal:16, alignItems:'center', justifyContent:'center' },
  btnFillTxt:{ color:C.paper, fontWeight:'700', fontSize:14 },
  btnGhost:{ borderWidth:1.5, borderColor:C.ink, borderRadius:4, paddingVertical:9, paddingHorizontal:14, alignItems:'center', justifyContent:'center' },
  btnGhostTxt:{ color:C.ink, fontWeight:'700', fontSize:14 },

  ezber:{ backgroundColor:C.paper2, borderWidth:1.5, borderColor:C.ochreDeep, borderStyle:'dashed', borderRadius:5, padding:16 },
  ezberTitle:{ fontSize:18, fontWeight:'700', color:C.ink, marginBottom:8 },
  ezberBody:{ fontSize:15, color:'#2c2a25', lineHeight:22 },

  remindCard:{ backgroundColor:C.card, borderWidth:1.5, borderColor:C.line, borderRadius:5, padding:14 },
  remindRow:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  remindLabel:{ fontSize:15, color:C.ink, fontWeight:'600' },
  timeRow:{ flexDirection:'row', alignItems:'flex-end', gap:10, marginTop:14 },
  colon:{ fontSize:22, fontWeight:'800', color:C.ink, marginBottom:6 },
  stepperLabel:{ fontSize:11, color:C.muted, marginBottom:4, letterSpacing:0.5 },
  stepper:{ flexDirection:'row', alignItems:'center', borderWidth:1.5, borderColor:C.line, borderRadius:4, backgroundColor:C.paper },
  stepBtn:{ paddingHorizontal:12, paddingVertical:6 },
  stepBtnTxt:{ fontSize:18, fontWeight:'800', color:C.blue },
  stepVal:{ fontSize:17, fontWeight:'700', color:C.ink, minWidth:28, textAlign:'center' },
  remindMsg:{ marginTop:10, fontSize:12, color:C.blueDeep },

  streakRow:{ flexDirection:'row', flexWrap:'wrap', gap:4 },
  streakCell:{ width:16, height:16, borderRadius:3, borderWidth:1 },
  streakNote:{ fontSize:11, color:C.muted, fontStyle:'italic', marginTop:8, lineHeight:16 },

  dayPill:{ borderWidth:1.5, borderColor:C.line, borderRadius:20, paddingVertical:7, paddingHorizontal:14, backgroundColor:C.card },
  dayPillActive:{ backgroundColor:C.ink, borderColor:C.ink },
  dayPillToday:{ borderColor:C.ochreDeep },
  dayPillTxt:{ fontSize:13, fontWeight:'600', color:C.muted },

  dayCard:{ borderWidth:1.5, borderColor:C.line, borderRadius:5, backgroundColor:C.card, overflow:'hidden' },
  dayHead:{ flexDirection:'row', alignItems:'center', gap:10, paddingVertical:11, paddingHorizontal:14, backgroundColor:C.paper2, borderBottomWidth:1.5, borderBottomColor:C.line },
  dayHeadTxt:{ fontSize:17, fontWeight:'700', color:C.ink },
  flag:{ fontSize:10, letterSpacing:1, color:C.paper, backgroundColor:C.ochreDeep, paddingHorizontal:7, paddingVertical:2, borderRadius:2, fontWeight:'700', overflow:'hidden' },

  mCard:{ borderWidth:1.5, borderColor:C.line, borderRadius:5, backgroundColor:C.card, padding:14, marginBottom:10 },
  mTitle:{ fontSize:17, fontWeight:'700', color:C.ink, marginBottom:6 },
  mBody:{ fontSize:15, color:'#2c2a25', lineHeight:22 },

  flash:{ borderWidth:2, borderColor:C.ink, borderRadius:6, backgroundColor:C.paper, padding:26, minHeight:180, justifyContent:'center', gap:14 },
  flashPrompt:{ fontSize:23, fontWeight:'800', color:C.ink, textAlign:'center' },
  flashAnswer:{ fontSize:16, color:'#2c2a25', lineHeight:24, borderTopWidth:1.5, borderTopColor:C.line, paddingTop:14 },
  flashNav:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop:14 },

  tabbar:{ flexDirection:'row', borderTopWidth:1.5, borderTopColor:C.line, backgroundColor:C.paper, paddingBottom:Platform.OS==='ios'?18:6, paddingTop:6 },
  tabBtn:{ flex:1, alignItems:'center', paddingVertical:8 },
  tabTxt:{ fontSize:14, fontWeight:'700', color:C.muted },
  tabActive:{ color:C.blueDeep },
  tabUnderline:{ height:2.5, width:22, backgroundColor:C.blue, borderRadius:2, marginTop:5 },
});
