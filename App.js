// Görev Defteri — kişisel günlük/haftalık görev + ezber takibi (Expo / React Native)
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Platform, Switch, KeyboardAvoidingView, StatusBar as RNStatusBar, AppState,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Calendar from 'expo-calendar';

// ---------- theme ----------
const C = {
  paper:'#F1ECE0', paper2:'#E9E2D2', card:'#F7F3EA', ink:'#1B1A17', muted:'#6E675A',
  blue:'#294B8F', blueDeep:'#1E3568', ochre:'#D8982B', ochreDeep:'#A9741A',
  done:'#4E7A5A', line:'#D6CDBB',
};
const DAYS  = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];
const SHORT = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

// ---------- helpers ----------
const trIndex = (d) => (d.getDay()+6)%7;                  // Pzt=0 … Paz=6
const pad = (n) => String(n).padStart(2,'0');
const dateKey = (d=new Date()) => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
function weekKey(d0){ const d=d0?new Date(d0):new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+3-((d.getDay()+6)%7)); const w1=new Date(d.getFullYear(),0,4);
  const n=1+Math.round(((d-w1)/86400000-3+((w1.getDay()+6)%7))/7); return d.getFullYear()+'-W'+pad(n); }
const dayOfYear = (d) => Math.floor((d-new Date(d.getFullYear(),0,0))/86400000);
const uid = () => 'id'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const trDate = (d=new Date()) => d.toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

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
  if(!remind.enabled) return true;
  const ok = await ensurePerms(); if(!ok) return false;
  if(Platform.OS==='android'){
    await Notifications.setNotificationChannelAsync('daily', {
      name:'Günlük hatırlatma', importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const now = new Date();
  for(let k=0;k<14;k++){
    const d = new Date(now); d.setDate(now.getDate()+k);
    d.setHours(remind.hour, remind.minute, 0, 0);
    const ti = (d.getDay()+6)%7;
    const daily  = config.daily[ti] || [];
    const weekly = config.weekly || [];
    const mem = config.memorize.length ? config.memorize[dayOfYear(d)%config.memorize.length] : null;

    if(d > now){
      const parts = [`${daily.length} günlük · ${weekly.length} haftalık görev`];
      if(mem) parts.push(`Ezber: ${mem.title}`);
      await Notifications.scheduleNotificationAsync({
        content:{ title:`Görev Defteri · ${DAYS[ti]}`, body: parts.join('\n') },
        trigger:{ type: Notifications.SchedulableTriggerInputTypes.DATE, date: d, channelId:'daily' },
      });
    }

    const doneMap = prog.daily?.[dateKey(d)] || {};
    const allDone = daily.length>0 && daily.every(t=>doneMap[t.id]);
    if(remind.warn && daily.length>0 && !(k===0 && allDone)){
      const w = new Date(d); w.setHours(remind.warnHour, remind.warnMinute, 0, 0);
      if(w > now){
        await Notifications.scheduleNotificationAsync({
          content:{ title:`Görev Defteri · ${DAYS[ti]}`, body:`Bugünkü ${daily.length} görevi tamamladın mı? Kalanları unutma.` },
          trigger:{ type: Notifications.SchedulableTriggerInputTypes.DATE, date: w, channelId:'daily' },
        });
      }
    }
  }
  return true;
}

async function getTodayEvents(date){
  const perm = await Calendar.requestCalendarPermissionsAsync();
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

// ---------- app ----------
export default function App(){
  const [loaded,setLoaded]   = useState(false);
  const [config,setConfig]   = useState({ daily:{0:[],1:[],2:[],3:[],4:[],5:[],6:[]}, weekly:[], memorize:[] });
  const [prog,setProg]       = useState({ daily:{}, weekly:{} });
  const [remind,setRemind]   = useState({ enabled:false, hour:8, minute:0, warn:true, warnHour:21, warnMinute:0 });
  const [tab,setTab]         = useState('today');
  const [now,setNow]         = useState(new Date());
  const [selDay,setSelDay]   = useState(trIndex(new Date()));
  const [events,setEvents]   = useState([]);
  const today = trIndex(now);
  const dk = dateKey(now), wk = weekKey(now);

  // load
  useEffect(()=>{ (async()=>{
    try{
      const [c,p,r] = await Promise.all([
        AsyncStorage.getItem('gd-config'),
        AsyncStorage.getItem('gd-progress'),
        AsyncStorage.getItem('gd-remind'),
      ]);
      if(c){ const cf=JSON.parse(c); for(let i=0;i<7;i++) if(!Array.isArray(cf.daily?.[i])) cf.daily[i]=[];
             if(!Array.isArray(cf.weekly)) cf.weekly=[]; if(!Array.isArray(cf.memorize)) cf.memorize=[]; setConfig(cf); }
      else{ setConfig(cfg=>({ ...cfg, weekly:[
             {id:uid(),text:'Bu haftanın şiirini oku'},
             {id:uid(),text:'Kitap: ~200 sayfa (2 haftada 1)'} ]})); }
      if(p) setProg(JSON.parse(p));
      if(r) setRemind(r0=>({ ...r0, ...JSON.parse(r) }));
    }catch(e){}
    setLoaded(true);
  })(); },[]);

  // persist
  useEffect(()=>{ if(loaded) AsyncStorage.setItem('gd-config',JSON.stringify(config)); },[config,loaded]);
  useEffect(()=>{ if(loaded) AsyncStorage.setItem('gd-progress',JSON.stringify(prog)); },[prog,loaded]);
  useEffect(()=>{ if(loaded) AsyncStorage.setItem('gd-remind',JSON.stringify(remind)); },[remind,loaded]);

  // gün her zaman güncel kalsın
  useEffect(()=>{
    const sub = AppState.addEventListener('change', st=>{ if(st==='active') setNow(new Date()); });
    const id  = setInterval(()=> setNow(new Date()), 60*1000);
    return ()=>{ sub.remove(); clearInterval(id); };
  },[]);

  // bildirimleri config/ilerleme/ayar değişince yeniden planla
  useEffect(()=>{ if(loaded && remind.enabled) scheduleDynamic(config, remind, prog); },[config, prog, remind, loaded]);

  // gün değişince telefon takvimini oku
  useEffect(()=>{ getTodayEvents(now).then(setEvents).catch(()=>{}); },[now]);

  // ---- mutations ----
  const addDaily = (day,text)=>{ text=text.trim(); if(!text) return;
    setConfig(c=>({ ...c, daily:{ ...c.daily, [day]:[...c.daily[day],{id:uid(),text}] } })); };
  const delDaily = (day,id)=> setConfig(c=>({ ...c, daily:{ ...c.daily, [day]:c.daily[day].filter(t=>t.id!==id) } }));
  const addWeekly = (text)=>{ text=text.trim(); if(!text) return; setConfig(c=>({ ...c, weekly:[...c.weekly,{id:uid(),text}] })); };
  const delWeekly = (id)=> setConfig(c=>({ ...c, weekly:c.weekly.filter(t=>t.id!==id) }));
  const addMem = (title,body)=>{ if(!title.trim() && !body.trim()) return;
    setConfig(c=>({ ...c, memorize:[...c.memorize,{id:uid(),title:title.trim()||'(başlıksız)',body:body.trim()}] })); };
  const delMem = (id)=> setConfig(c=>({ ...c, memorize:c.memorize.filter(m=>m.id!==id) }));

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
          {tab==='today'    && <TodayView {...{config,prog,today,now,events,dDone,wDone,toggleDaily,toggleWeekly,remind,setRemind}} />}
          {tab==='daily'    && <DailyView {...{config,selDay,setSelDay,today,addDaily,delDaily}} />}
          {tab==='weekly'   && <WeeklyView {...{config,wDone,toggleWeekly,addWeekly,delWeekly}} />}
          {tab==='memorize' && <MemorizeView {...{config,addMem,delMem}} />}
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
function CheckRow({text,done,onToggle,onDelete}){
  return (
    <View style={[s.item, done && s.itemDone]}>
      <TouchableOpacity onPress={onToggle} style={[s.chk, done && s.chkDone]}>
        {done && <Text style={s.chkMark}>✓</Text>}
      </TouchableOpacity>
      <Text style={[s.itemTxt, done && s.itemTxtDone]}>{text}</Text>
      {onDelete && <TouchableOpacity onPress={onDelete} style={s.del}><Text style={s.delTxt}>×</Text></TouchableOpacity>}
    </View>
  );
}
function EditRow({text,onDelete}){
  return (
    <View style={s.item}>
      <Text style={[s.itemTxt,{flex:1}]}>{text}</Text>
      <TouchableOpacity onPress={onDelete} style={s.del}><Text style={s.delTxt}>×</Text></TouchableOpacity>
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
function TodayView({config,prog,today,now,events,dDone,wDone,toggleDaily,toggleWeekly,remind,setRemind}){
  const [revealed,setRevealed]=useState(false);
  const dt=config.daily[today]||[];
  const mem=config.memorize.length ? config.memorize[dayOfYear(now)%config.memorize.length] : null;
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

      <ReminderCard remind={remind} setRemind={setRemind} config={config} prog={prog} />
    </View>
  );
}

function ReminderCard({remind,setRemind,config,prog}){
  const [msg,setMsg]=useState('');
  const bump=(field,delta,max)=> setRemind(r=>({ ...r, [field]:(r[field]+delta+max)%max }));
  const apply=async(next)=>{
    if(next.enabled){
      const ok = await ensurePerms();
      setMsg(ok?`Her gün ${pad(next.hour)}:${pad(next.minute)} için kuruldu, akşam ${pad(next.warnHour)}:${pad(next.warnMinute)}'de kontrol uyarısı var.`
               :'Bildirim izni verilmedi ya da gerçek cihaz gerekiyor.');
    }else{
      setMsg('Günlük hatırlatma kapatıldı.');
    }
    setRemind(next);
  };
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
      </View>
    </View>
  );
}
function Stepper({label,value,onMinus,onPlus}){
  return (
    <View style={{alignItems:'center'}}>
      <Text style={s.stepperLabel}>{label}</Text>
      <View style={s.stepper}>
        <TouchableOpacity onPress={onMinus} style={s.stepBtn}><Text style={s.stepBtnTxt}>–</Text></TouchableOpacity>
        <Text style={s.stepVal}>{value}</Text>
        <TouchableOpacity onPress={onPlus} style={s.stepBtn}><Text style={s.stepBtnTxt}>+</Text></TouchableOpacity>
      </View>
    </View>
  );
}

// ---------- Daily editor ----------
function DailyView({config,selDay,setSelDay,today,addDaily,delDaily}){
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
          {list.length ? list.map(t=><EditRow key={t.id} text={t.text} onDelete={()=>delDaily(selDay,t.id)} />) : <Empty>Boş.</Empty>}
          <AddBar placeholder={`Yeni görev — ${DAYS[selDay]}`} onAdd={(v)=>addDaily(selDay,v)} />
        </View>
      </View>
    </View>
  );
}

// ---------- Weekly ----------
function WeeklyView({config,wDone,toggleWeekly,addWeekly,delWeekly}){
  return (
    <View>
      <Eyebrow>TÜM HAFTA İÇİN — HER HAFTA BAŞINDA SIFIRLANIR</Eyebrow>
      <View style={s.sec}>
        <SectionH title="Haftalık görevler" count={config.weekly.length?`${config.weekly.filter(t=>wDone(t.id)).length} / ${config.weekly.length}`:'0'} />
        {config.weekly.length ? config.weekly.map(t=>(
          <CheckRow key={t.id} text={t.text} done={wDone(t.id)} onToggle={()=>toggleWeekly(t.id)} onDelete={()=>delWeekly(t.id)} />
        )) : <Empty>Henüz haftalık görev yok.</Empty>}
        <AddBar placeholder="Yeni haftalık görev" onAdd={addWeekly} />
      </View>
    </View>
  );
}

// ---------- Memorize ----------
function MemorizeView({config,addMem,delMem}){
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [study,setStudy]=useState(false);
  const [idx,setIdx]=useState(0);
  const [rev,setRev]=useState(false);

  if(study && config.memorize.length){
    const m=config.memorize[idx%config.memorize.length];
    return (
      <View>
        <View style={s.flash}>
          <Text style={s.flashPrompt}>{m.title}</Text>
          <Text style={[s.flashAnswer, !rev && {color:C.muted,fontStyle:'italic'}]}>{rev?m.body:'••• hatırla, sonra göster'}</Text>
        </View>
        <View style={s.flashNav}>
          <TouchableOpacity style={s.btnGhost} onPress={()=>setStudy(false)}><Text style={s.btnGhostTxt}>Bitir</Text></TouchableOpacity>
          <Text style={s.count}>{(idx%config.memorize.length)+1} / {config.memorize.length}</Text>
          <View style={{flexDirection:'row',gap:8}}>
            <TouchableOpacity style={s.btnGhost} onPress={()=>setRev(r=>!r)}><Text style={s.btnGhostTxt}>{rev?'Gizle':'Göster'}</Text></TouchableOpacity>
            <TouchableOpacity style={s.btnFill} onPress={()=>{ setIdx(i=>i+1); setRev(false); }}><Text style={s.btnFillTxt}>Sonraki →</Text></TouchableOpacity>
          </View>
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
          <TouchableOpacity style={s.btnGhost} onPress={()=>{ setStudy(true); setIdx(0); setRev(false); }}><Text style={s.btnGhostTxt}>Çalış (kart modu)</Text></TouchableOpacity>
        )}
      </View>

      <View style={{marginTop:20}}>
        {config.memorize.length ? config.memorize.map(m=>(
          <View key={m.id} style={s.mCard}>
            <Text style={s.mTitle}>{m.title}</Text>
            <Text style={s.mBody}>{m.body}</Text>
            <TouchableOpacity onPress={()=>delMem(m.id)} style={{marginTop:8,alignSelf:'flex-start'}}><Text style={s.delLink}>Sil</Text></TouchableOpacity>
          </View>
        )) : <Empty>Henüz metin eklenmedi.</Empty>}
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
