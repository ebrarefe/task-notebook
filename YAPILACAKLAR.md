# Claude Code görev dosyası — Görev Defteri

Bu Expo/React Native uygulamasına 4 özellik eklenecek. Aşağıdaki kod parçalarını
uygula, sonra gerçek cihazda test et. Yapı: **App.js tek dosya**, Expo SDK 57,
AsyncStorage + expo-notifications zaten kurulu.

## Kurulum (önce)
```bash
npm install
npx expo install expo-calendar
```
Not: Arka plan görevi (background-task) KULLANMA — uyarılar planlı bildirimlerle yapılacak.

---

## 1) Dinamik bildirim
`scheduleDaily`'yi sil, yerine `scheduleDynamic(config, remind, prog)` yaz. Sabit
tekrar yerine önümüzdeki 14 günü tek tek `DATE` trigger'lı planla; her bildirim o
günün görev sayısını + o günün rotasyonlu ezber başlığını göstersin.

```js
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

    // sabah bildirimi
    if(d > now){
      const parts = [`${daily.length} günlük · ${weekly.length} haftalık görev`];
      if(mem) parts.push(`Ezber: ${mem.title}`);
      await Notifications.scheduleNotificationAsync({
        content:{ title:`Görev Defteri · ${DAYS[ti]}`, body: parts.join('\n') },
        trigger:{ type: Notifications.SchedulableTriggerInputTypes.DATE, date: d, channelId:'daily' },
      });
    }

    // 3) akşam "kontrol" uyarısı — bugün hepsi bittiyse atla
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
```

`ReminderCard`'a `config` ve `prog`'u geçir; `apply()` içindeki eski çağrıyı kaldır,
gerçek planlamayı şu efekt yapsın (App içinde):
```js
useEffect(()=>{ if(loaded && remind.enabled) scheduleDynamic(config, remind, prog); }, [config, prog, remind, loaded]);
```

## 2) Uygulama hep güncel güne gelsin
`today`/`dk`/`wk` şu an mount'ta bir kez hesaplanıyor. `now`'ı state yap:
```js
import { AppState } from 'react-native';
// App() içinde:
const [now, setNow] = useState(new Date());
const today = trIndex(now);
const dk = dateKey(now), wk = weekKey(now);
useEffect(()=>{
  const sub = AppState.addEventListener('change', st=>{ if(st==='active') setNow(new Date()); });
  const id  = setInterval(()=> setNow(new Date()), 60*1000);
  return ()=>{ sub.remove(); clearInterval(id); };
},[]);
```

## 3) Yapılmayan görev uyarısı
Kodu (1)'in içine gömdüm (akşam kontrol bloğu). `remind` varsayılanına
`warn:true, warnHour:21, warnMinute:0` ekle. `ReminderCard`'daki saat seçiciyi
"Akşam kontrol saati" için bir kez daha çoğalt (warnHour/warnMinute'a bağla).

## 4) Telefon takvimini oku
```js
import * as Calendar from 'expo-calendar';

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

// App() içinde — now değişince tazelenir (gün kaçmaz):
const [events, setEvents] = useState([]);
useEffect(()=>{ getTodayEvents(now).then(setEvents).catch(()=>{}); }, [now]);
```
`events`'i `TodayView`'e geçir, "Bugünün takvimi" bölümünde saat + başlık olarak listele.
`app.json` → `plugins` dizisine ekle:
```json
["expo-calendar", { "calendarPermission": "Günün etkinliklerini görevlerinle göstermek için takvime erişim." }]
```

---

## Test
```bash
npx expo run:android    # gerçek cihaz — Expo Go'da bildirim/takvim tam çalışmaz
```

## Build (indirilebilir dosya) — eas.json hazır
```bash
npm install -g eas-cli
eas login
eas init
eas build -p android --profile preview      # .apk (yan yükleme/test)
eas build -p android --profile production   # .aab (Google Play)
```
