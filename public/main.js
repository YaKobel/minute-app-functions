// ========= i18n loader (RU / EN / UK) =========
const LS_LANG_KEY = 'minute.lang';
let I18N_CACHE = {};
let I18N_CURRENT = {};


// ПРЕФИКС ЛОКОВ — должен быть доступен до cleanup
const LOCK_PREFIX = 'minute.lock.';


// Удаляем старые лочки (старше суток), чтобы localStorage не пух
(function cleanupOldLocks(){
  const dayAgo = Date.now() - 24*60*60*1000;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LOCK_PREFIX)) {
      const iso = k.slice(LOCK_PREFIX.length);
      const ts  = Date.parse(iso);
      if (!Number.isFinite(ts) || ts < dayAgo) localStorage.removeItem(k);
    }
  }
})();


function makeHiddenPlaceholderOption(label, selected) {
  const o = document.createElement('option');
  o.value = '';
  o.textContent = label;
  o.disabled = true;
  o.hidden = true;      // ← не будет виден в выпадающем списке
  if (selected) o.selected = true;
  return o;
}


function getLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && ['ru','en','uk'].includes(q)) {
    localStorage.setItem(LS_LANG_KEY, q);
    return q;
  }
  return localStorage.getItem(LS_LANG_KEY) || 'ru';
}

async function loadI18n(lang) {
  if (I18N_CACHE[lang]) {
    I18N_CURRENT = I18N_CACHE[lang];
    return I18N_CURRENT;
  }
  try {
    const resp = await fetch(`i18n/${lang}.json`, { cache: 'no-store' });
    const json = await resp.json();
    I18N_CACHE[lang] = json;
    I18N_CURRENT = json;
    return json;
  } catch {
    // небольшой fallback, если json не загрузился
    I18N_CURRENT = {
      'nav.home':'Главная','nav.stats':'Статистика','nav.profile':'Профиль',
      'profile.note':'Данные сохраняются в Firebase','toast.saved':'Готово!',
      'error.network':'Ошибка сети. Повторите.'
    };
    return I18N_CURRENT;
  }
}

function t(key) {
  if (!key) return '';
  let val;
  try {
    // сначала пробуем как вложенный объект: a.b.c
    val = key.split('.').reduce((acc, k) => (acc && typeof acc === 'object') ? acc[k] : undefined, I18N_CURRENT);
  } catch {}
  // если не нашли — пробуем как плоский ключ "a.b.c"
  if (val == null) val = I18N_CURRENT[key];
  // в крайнем случае — вернуть сам ключ
  return (val != null) ? val : key;
}


function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    const txt = t(k);
    if (el.tagName === 'INPUT' && 'placeholder' in el) {
      el.placeholder = txt;
    } else if (el.tagName === 'OPTION') {
      el.textContent = txt;
    } else {
      el.textContent = txt;
    }
  });
  const current = getLang();
  root.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === current);
  });
}


// ========= Инициализация =========
document.addEventListener('DOMContentLoaded', async () => {
  // I18n bootstrap
  const lang = getLang();
  await loadI18n(lang);
  applyI18n(document);

  // Переключатель языка
  document.querySelectorAll('#langSwitch .lang-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newLang = btn.dataset.lang;
      if (!['ru','en','uk'].includes(newLang)) return;
      localStorage.setItem('minute.lang', newLang);
      await loadI18n(newLang);
      applyI18n(document);
      // если мы на профиле — обновим подписи в селектах (страны/регионы)
      if (typeof refreshProfileSelects === 'function') refreshProfileSelects();
    });
  });

  // === About modal wiring (перенесено в ПЕРВЫЙ DOMContentLoaded, чтобы работало везде) ===
  const aboutBtn   = document.getElementById('aboutBtn');
  const aboutModal = document.getElementById('aboutModal');
  const aboutClose = document.getElementById('aboutClose');

  function openAbout(){ aboutModal?.removeAttribute('hidden'); document.body.classList.add('modal-open'); }
  function closeAbout(){ aboutModal?.setAttribute('hidden',''); document.body.classList.remove('modal-open'); }

  aboutBtn?.addEventListener('click', openAbout);
  aboutClose?.addEventListener('click', closeAbout);
  aboutModal?.querySelector('.modal__backdrop')?.addEventListener('click', closeAbout);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeAbout(); });

  // авто-открытие по ?screen=about
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('screen') === 'about') openAbout();
  } catch {}

  
  // Какие страницы открыты?
  const onStatsPage   = !!document.getElementById('periodTabs');
  const onProfilePage = !!document.getElementById('profileForm');

  if (onStatsPage)   initStats();
  if (onProfilePage) initProfile?.();
});



// ========= Ключ для API (совпадает с серверным APP_API_KEY) =========
const APP_KEY = 'ajK9sdfh2398sdhf923SDHF82shdf9283';  // тот же, что APP_API_KEY на сервере
window.APP_KEY = APP_KEY;

function norm(s) {
  return (s || '').toString().trim().toLowerCase();
}

function normalizeRegionName(s) {
  const k = norm(s);
  const map = {
    'west':'west','запад':'west','захід':'west',
    'east':'east','восток':'east','схід':'east',
    'north':'north','север':'north','північ':'north',
    'south':'south','юг':'south','південь':'south',
    'center':'center','центр':'center','центp':'center'
  };
  return map[k] || 'center'; // дефолт безопасный
}


// Универсальный рендерер топ-списков с "Показать больше" (классами, а не стилями)
function renderTopList({ box, items, limit = 4, makeLabel }) {
  if (!box || !Array.isArray(items)) return;

  const MAX = Math.max(1, ...items.map(x => x.count || 0));
  const top  = items.slice(0, limit);
  const rest = items.slice(limit);

  // видимые строки
  const rowsTop = top.map(x => {
    const pct = Math.round((x.count / MAX) * 100);
    return `
      <div class="tr">
        <div class="country">${makeLabel(x)}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="count">${x.count}</div>
      </div>`;
  }).join('');

  // скрытые строки (изначально с классом hidden-row)
  const rowsRest = rest.map(x => {
    const pct = Math.round((x.count / MAX) * 100);
    return `
      <div class="tr hidden-row">
        <div class="country">${makeLabel(x)}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="count">${x.count}</div>
      </div>`;
  }).join('');

  const btn = rest.length
    ? `<button class="show-more-btn" data-role="toggle-more">
         ${(t?.('common.more')) || 'Показать больше'}
       </button>`
    : '';

  box.innerHTML = rowsTop + rowsRest + btn;

  // логика "Показать больше/Свернуть" — переключаем ИМЕННО КЛАСС
  const toggle = box.querySelector('[data-role="toggle-more"]');
  if (toggle) {
    // фикс: запоминаем первоначально скрытые строки и просто
    // переключаем у них КЛАСС, а не style.display
    const hiddenRows = Array.from(box.querySelectorAll('.hidden-row')); // snapshot
    let expanded = false;
  
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      hiddenRows.forEach(el => el.classList.toggle('hidden-row', !expanded));
      toggle.textContent = expanded
        ? (t?.('common.less') || 'Свернуть')
        : (t?.('common.more') || 'Показать больше');
    });
  }
}



// ========= Статистика =========
function initStats() {
  let currentPeriod = 'day';
  const tabs = document.querySelectorAll('#periodTabs [data-period]');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      loadStats(currentPeriod);
    });
  });
  loadStats(currentPeriod);
}

async function loadStats(period = 'day') {
  const elTotal     = document.getElementById('kpi-total');
  const elClimate   = document.getElementById('kpi-climate');
  const elWar       = document.getElementById('kpi-war');
  const elPersonal  = document.getElementById('kpi-personal');
  const elFamily    = document.getElementById('kpi-family');
  const topWrap     = document.getElementById('topTable');

  try {
    const resp = await fetch(`/api/stats?period=${encodeURIComponent(period)}`, {
      headers: { 'X-App-Key': APP_KEY }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'unknown');

    // === KPI ===
    const bc = data.byCategory || {};
    if (elTotal)    elTotal.textContent    = data.total ?? '—';
    if (elWar)      elWar.textContent      = bc.war ?? 0;
    if (elClimate)  elClimate.textContent  = bc.climate ?? 0;
    if (elPersonal) elPersonal.textContent = bc.personal ?? 0;
    if (elFamily)   elFamily.textContent   = bc.family ?? 0;

    // === Top countries (с ограничением + «Показать больше») ===
    if (topWrap && Array.isArray(data.topCountries)) {
      const L = getLang?.() || 'en';
      const items = data.topCountries
        .filter(x => x && x.country && x.country !== 'XX')     // скрываем «без профиля»
        .map(x => ({ country: x.country, count: x.count || 0 }));

      renderTopList({
        box: topWrap,
        items,
        limit: 10, // ← сейчас 4 для эксперимента; позже поставишь 20
        makeLabel: (x) => countryLabel(x.country, L)           // "Россия (RU)"
      });
    }

    // === Regions (ТОП регионов с кнопкой «Показать больше») ===
    const regionsBox = document.getElementById('regionsList');
    if (regionsBox && Array.isArray(data.topRegions)) {
      const L = getLang?.() || 'en';
      const items = data.topRegions.map(x => ({
        country: x.country,
        region : normalizeRegionName(x.region),
        count  : x.count || 0
      }));

      renderTopList({
        box: regionsBox,
        items,
        limit: 10, // ← сейчас 4; позже 20
        makeLabel: (x) => {
          const country = countryLabel(x.country, L);     // "Россия (RU)"
          const region  = t('regions.' + x.region);       // локализованное «Запад/Восток…»
          return `${country} • ${region}`;
        }
      });
    }

    // === Gender ===
    const genderBox = document.getElementById('genderList');
    if (genderBox && data.byGender) {
      const g = data.byGender;
      const pairs = [
        [t('profile.gender.male'),   g.male   || 0],
        [t('profile.gender.female'), g.female || 0]
      ];
      const max = Math.max(1, ...pairs.map(p => p[1]));
      genderBox.innerHTML = pairs.map(([label,val]) => {
        const pct = Math.round((val / max) * 100);
        return `<div class="tr">
          <div class="country">${label}</div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <div class="count">${val}</div>
        </div>`;
      }).join('');
    }

    // === Age groups ===
    const ageBox = document.getElementById('ageList');
    if (ageBox && Array.isArray(data.topAgeGroups)) {
      const arr = data.topAgeGroups;
      const max = Math.max(1, ...arr.map(x => x.count));
      ageBox.innerHTML = arr.map(x => {
        const label = ageLabel(x.group, t);   // <-- вот эта строка важна
        const pct   = Math.round((x.count / max) * 100);
        return `<div class="tr">
          <div class="country">${label}</div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <div class="count">${x.count}</div>
        </div>`;
      }).join('');
    }

  } catch (e) {
    showToast('error.network');
    console.error('/api/stats error:', e);
  }
}



// ========= Страны (RU/EN названия) + регионы =========

const REGIONS = [
  { key:'regions.west',   ru:'Запад',  en:'West',   uk:'Захід'  },
  { key:'regions.east',   ru:'Восток', en:'East',   uk:'Схід'   },
  { key:'regions.north',  ru:'Север',  en:'North',  uk:'Північ' },
  { key:'regions.south',  ru:'Юг',     en:'South',  uk:'Південь'},
  { key:'regions.center', ru:'Центр',  en:'Center', uk:'Центр'  },
];

// ===== Полный список стран из /countries.json =====

// Локализованная подпись "Название (XX)"
function countryLabel(code, lang) {
  try {
    const L = lang || getLang?.() || 'en';
    const dn = new Intl.DisplayNames([L], { type: 'region' });
    const name = dn.of(code) || code;
    return `${name} (${code})`;
  } catch {
    return code;
  }
}

// Заполнение селекта: [placeholder] + все страны (по алфавиту текущего языка) + "Другая страна"
async function populateCountrySelect(selectEl, keepValue = null) {
  if (!selectEl) return;
  const current = keepValue ?? selectEl.value;
  const L = getLang?.() || 'en';

  // грузим коды
  let codes = [];
  try {
    const resp = await fetch('/countries.json', { cache: 'no-store' });
    codes = await resp.json();
  } catch (e) {
    console.error('countries.json load error', e);
    codes = ['UA','RU','US','GB','DE','FR','PL']; // fallback на случай оффлайна
  }

  // сортируем по локализованному названию
  codes.sort((a, b) => countryLabel(a, L).localeCompare(countryLabel(b, L)));

  // строим опции
  const opts = [];
  // placeholder
  opts.push(new Option(t?.('profile.country.placeholder') || 'Select country', '', true, false));
  // все страны
  for (const code of codes) {
    const o = new Option(countryLabel(code, L), code);
    opts.push(o);
  }
  // "Другая страна"
  //opts.push(new Option(t?.('country.other') || 'Other country', 'OTHER'));

  // применяем
  selectEl.innerHTML = '';
  opts.forEach(o => selectEl.add(o));

  // восстановим значение, если было
  if (current) {
    // если сохранённый код не из списка — добавим его временно в начало
    if (!codes.includes(current) && current !== 'OTHER' && current !== '') {
      const extra = new Option('★ ' + countryLabel(current, L), current, false, true);
      selectEl.add(extra, 1);
    }
    selectEl.value = current;
  }
}

// При выборе OTHER — отключаем регионы
function hookCountryRegion(countrySel, regionSel) {
  if (!countrySel || !regionSel) return;
  function apply() {
    const block = countrySel.value === 'OTHER';  // пустое значение страну НЕ блокирует
    regionSel.disabled = block;
    if (block) {
      regionSel.innerHTML = `<option value="">—</option>`;
    } else {
      // переотрисуем регионы по i18n
      populateRegions(regionSel, regionSel.value);
    }
  }
  countrySel.addEventListener('change', apply);
  apply();
}


function populateRegions(regionSelect, keepValue=null) {
  if (!regionSelect) return;
  const current = regionValueToCode(keepValue ?? regionSelect.value);
 // плейсхолдер
  const opts = [ makeHiddenPlaceholderOption(
    t('profile.region.placeholder') || 'Выберите регион',
    !keepValue && !regionSelect.value  // выбрать плейсхолдер только если ещё нет значения
  ) ];
 
 // базовый набор регионов — локализуем через i18n
 ['west','east','north','south','center'].forEach(code => {
   const o = new Option(t('regions.' + code), code);
   opts.push(o);
 });
 regionSelect.innerHTML = '';
 opts.forEach(o => regionSelect.add(o));
 if (current) regionSelect.value = regionValueToCode(current);
}

// при смене языка на странице профиля — пересоздать опции селектов, не теряя значения
function refreshProfileSelects() {
  const form = document.getElementById('profileForm');
  if (!form) return;
  const country = document.getElementById('country');
  const region  = document.getElementById('region');
  populateCountrySelect(country, country.value);
  populateRegions(region, region.value);
}

// ========= Профиль =========
async function initProfile() {
  const form   = document.getElementById('profileForm');
  if (!form) return;

  const country  = document.getElementById('country');
  const region   = document.getElementById('region');
  const genderEl = document.getElementById('gender');
  const ageEl    = document.getElementById('age'); // возрастная группа ('-15','16-20',...)
  const saveBtn  = document.getElementById('saveProfileBtn');
  const note     = document.getElementById('saveNote');



  // заселить списки
  await populateCountrySelect(country);
  populateRegions(region, region.value);   // ← нарисовать список регионов сразу
  hookCountryRegion(country, region);      // ← а уже потом навесить хук

  // префилл из localStorage (если уже сохраняли)
  const saved = getStoredProfile();
  if (saved.country) country.value = saved.country;
  if (saved.region)  region.value  = regionValueToCode(saved.region);
  if (saved.gender)  genderEl.value = saved.gender;
  if (saved.ageGroup)ageEl.value    = saved.ageGroup;
  
  // (перерисовка по смене языка уже есть в обработчике языков)

  // сохранить профиль
  saveBtn.addEventListener('click', async () => {
    const payload = {
      userId:  detectUserId(),
      country: country.value,
      region:  region.value,       // West / East / North / South / Center
      gender:  (genderEl.value || '').toLowerCase() || undefined,   // только male / female или null
      ageGroup:(ageEl.value || '') || undefined,         // ГРУППА, а не число
      lang:    getLang()
    };

    // локально — для WebApp
    try {
      localStorage.setItem('minute.profile', JSON.stringify(payload));
    } catch {}

    // и на сервер — чтобы Телеграм-обработчик знал страну/регион
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'X-App-Key': APP_KEY
        },
        body: JSON.stringify(payload)
      });
    } catch (_) {}

    saveBtn.disabled = true;
    note.textContent = t('profile.note');
    await new Promise(r => setTimeout(r, 500));
    saveBtn.disabled = false;
    showToast('toast.saved');
  });
}

function showToast(keyOrText) {
  const box = document.getElementById('toast');
  if (!box) return alert(typeof keyOrText === 'string' ? t(keyOrText) : 'OK');
  box.textContent = typeof keyOrText === 'string' ? t(keyOrText) : String(keyOrText);
  box.classList.add('show');
  setTimeout(() => box.classList.remove('show'), 2000);
}

function renderStats(data) {
  // ... твой существующий вывод категорий и стран

  // gender
  const g = data.byGender || {};
  const genderList = document.getElementById('genderList');
  if (genderList) {
    genderList.innerHTML = '';
    ['male','female','other','unknown'].forEach(k => {
      const li = document.createElement('li');
      li.textContent = `${k}: ${g[k] || 0}`;
      genderList.appendChild(li);
    });
  }

  // age groups
  const age = data.topAgeGroups || [];
  const ageList = document.getElementById('ageList');
  if (ageList) {
    ageList.innerHTML = '';
    age.forEach(({group, count}) => {
      const li = document.createElement('li');
      li.textContent = `${group}: ${count}`;
      ageList.appendChild(li);
    });
  }
}


// ========= helpers =========
function detectUserId() {
  try {
    const tg = window.Telegram?.WebApp;
    const id = tg?.initDataUnsafe?.user?.id;
    if (id) return String(id);
  } catch {}
  const q = new URLSearchParams(location.search).get('user_id');
  if (q && /^\d+$/.test(q)) return String(q);
  let uid = localStorage.getItem('uid');
  if (!uid) {
    uid = 'web-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('uid', uid);
  }
  return uid;
}

function getStoredProfile() {
  try {
    const raw = localStorage.getItem('minute.profile');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function norm(s){return (s||'').toString().trim().toLowerCase();}
function regionValueToCode(v){
  const k = norm(v);
  const m = {
    west:'west','запад':'west','захід':'west',
    east:'east','восток':'east','схід':'east',
    north:'north','север':'north','північ':'north',
    south:'south','юг':'south','південь':'south',
    center:'center','центр':'center'
  };
  return m[k] || '';
}

// === LIVE limiter (2 клика на окно) ==========================
const LIVE_LIMIT = 2;
const API_KEY = (window.APP_KEY || 'ajK9sdfh2398sdhf923SDHF82shdf9283');

// --- UTC-окна: 00:00 / 08:00 / 16:00 (всегда одна и та же логика)
function getNextWindowTs(now = Date.now()) {
  const d = new Date(now);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const WINDOWS_MIN = [0, 8 * 60, 16 * 60]; // 00:00 / 08:00 / 16:00
  const midnightUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  const next = WINDOWS_MIN.find(m => m > mins);
  const total = (next !== undefined ? next : WINDOWS_MIN[0] + 24 * 60);
  return midnightUTC + total * 60_000;
}

function _liveKey(ts = getNextWindowTs()) {
  return 'liveClicks:' + new Date(ts).toISOString();
}
function getLiveCount(ts = getNextWindowTs()) {
  return +(localStorage.getItem(_liveKey(ts)) || 0);
}
function incLiveCount(ts = getNextWindowTs()) {
  const n = getLiveCount(ts) + 1;
  localStorage.setItem(_liveKey(ts), String(n));
  return n;
}

async function sendVoteAfterMinute(category, profile) {
  // шлём ровно через минуту (чтобы выглядело «после минуты»)
  setTimeout(async () => {
    try {
      // 1) Жёсткая проверка профиля на клиенте
      const p = profile || {};
      const hasProfile = p.country && p.region && p.lang && p.gender && p.ageGroup;
      if (!hasProfile) {
        showToast('Сначала заполните профиль (страна, регион, язык, пол, возраст).');
        return;
      }
      // 2) Собираем payload без дефолтов 'XX'
      const payload = {
        userId: detectUserId?.() || 'web',
        category,
        country: String(p.country).toUpperCase(),
        region : p.region,
        gender : p.gender,
        ageGroup: p.ageGroup,
        lang   : p.lang || getLang?.() || 'ru',
        mode   : 'live',
        at     : Date.now()
      };
      const resp = await fetch('/api/vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Key': API_KEY
        },
        body: JSON.stringify(payload)
      });
      // 3) Учитываем ответ сервера — тост только при ok:true
      let data = null;
      try { data = await resp.json(); } catch {}
      if (!resp.ok || !data?.ok) {
        const msg = data?.message || data?.error || 'Ошибка отправки';
        showToast(msg);
        return;
      }
      showToast('Голос засчитан: ' + category);
    } catch (e) {
      console.error('vote err', e);
    }
  }, 61_000); // чуть больше 60 с, чтобы гарантированно «после минуты»
}


// Нормализуем строку: дефис, пробелы, разные тире
function _normAge(s){ return (s ?? '').toString().trim().replace(/[\u2013\u2014]/g,'-').replace(/\s+/g,''); }

// Вернёт ОДИН из канонических ключей: '-14','15-20',...,'87-92','93+'
function ageKeyFor(group){
  const raw = _normAge(group);

  // +N или N+ (поддерживаем оба вида)
  if (/^\+?\d+\+?$/.test(raw)) {
    const n = parseInt(raw.replace('+',''), 10);
    if (!Number.isFinite(n)) return raw;
    return n >= 93 ? '93+' : _bucketByNumber(n);
  }

  // Диапазон 'a-b' → берём нижнюю границу
  if (/^\d+-\d+$/.test(raw)) {
    const n = parseInt(raw.split('-')[0],10);
    return Number.isFinite(n) ? _bucketByNumber(n) : raw;
  }

  // Одиночное число
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw,10);
    return _bucketByNumber(n);
  }

  // Иначе оставляем как есть — сработает фолбэк подписи
  return raw;

  function _bucketByNumber(n){
    if (n <= 14) return '-14';
    const ranges = [
      [15,20],[21,26],[27,32],[33,38],[39,44],[45,50],
      [51,56],[57,62],[63,68],[69,74],[75,80],[81,86],[87,92]
    ];
    for (const [a,b] of ranges){ if (n>=a && n<=b) return `${a}-${b}`; }
    return '93+';
  }
}

// Безопасная подпись возраста (если нет ключа в i18n — покажем сам диапазон)
function ageLabel(group, tFn){
  const key = 'profile.age.group.' + ageKeyFor(group);
  const txt = (tFn ?? t)(key);
  return (txt === key) ? key.replace('profile.age.group.','') : txt;
}

// --- РАДУЖНОЕ ОКНО (UTC) ---
const RAINBOW_MS = 3 * 60 * 1000; // 3 минуты

function isRainbowWindow(now = new Date()) {
  const m = now.getUTCMinutes();
  const h = now.getUTCHours();
  // Ореол включён в первые 3 минуты каждого окна 00 / 08 / 16 UTC
  return (h % 8 === 0) && (m < 3);
}

function applyHeroRainbow() {
  const hero = document.getElementById('hero');
  if (!hero) return;
  hero.classList.toggle('rainbow-on', isRainbowWindow());
}

// ТЕСТ через ?test=rainbow — 20 сек ореол
window.addEventListener('DOMContentLoaded', () => {
  const hero = document.getElementById('hero');
  const test = new URLSearchParams(location.search).get('test');
  if (test === 'rainbow' && hero) {
    hero.classList.add('rainbow-on');
    setTimeout(() => hero.classList.remove('rainbow-on'), 20000);
  }
  // первичная проверка
  applyHeroRainbow();
  // подстраховка — обновлять состояние раз в 15 секунд
  setInterval(applyHeroRainbow, 15000);
});



// === Главный экран: режимы (🔔/⏳/⚡), напоминания, отложенный/лайв запуск, ETA по UTC ===
document.addEventListener('DOMContentLoaded', () => {
  // Элементы
  const intentBtns = Array.from(document.querySelectorAll('.intent-btn[data-vote]')); // war|climate|personal|family
  const startBtn   = document.getElementById('fingerBtn');   // большая кнопка со сканером
  const countdown  = document.getElementById('countdown');   // большой таймер на карточке
  const nextEtaEl  = document.getElementById('nextEta');     // подстрока "00/08/16 • через …"

  // Кнопки режимов (index.html → #modeBar)
  const btnRemind = document.getElementById('modeRemind');   // "Напоминать (60/5)"
  const btnDefer  = document.getElementById('modeDefer');    // "Отложенно (в окно)"
  const btnLive   = document.getElementById('modeLive');     // "Лайв (тест)"
  const modeNote  = document.getElementById('modeNote');     // подпись под режимами

  // Если мы не на главной — выходим, чтобы не мешать профилю/статистике
  if (!countdown || !nextEtaEl || !startBtn) return;
  
  /// показать те же цифры в круге, что и в большом таймере
  ///const ringText = startBtn.querySelector('.timer');
  ///if (ringText && countdown) ringText.textContent = countdown.textContent;
  

  // Радужный перелив (внутренний круг): добавим слой, не ломая SVG-кольцо
  if (!startBtn.querySelector('.rainbow')) {
    const div = document.createElement('div');
    div.className = 'rainbow';
    startBtn.appendChild(div);
  }


  // Окна UTC (00:00 / 08:00 / 16:00) — оставить 16:00, как ты и просил
  const WINDOWS_MIN = [0, 8 * 60, 16 * 60];
  // Сколько «горит» радужная подсветка после начала окна
  const RAINBOW_FOR_MS = 3 * 60 * 1000; // 3 минуты


  // true, если сейчас в пределах первых 3 минут текущего окна (UTC)
  function isRainbowWindow(now = Date.now()) {
    const d = new Date(now);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const midnightUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
    // найдём старт последнего окна сегодня (<= текущее время)
    let startMin = WINDOWS_MIN[0];
    for (const m of WINDOWS_MIN) if (m <= mins) startMin = m;
    const startTs = midnightUTC + startMin * 60_000;
    return now >= startTs && now < startTs + RAINBOW_FOR_MS;
  }

  function applyHeroRainbow() {
    if (!heroEl) return;
	// если включён форс (тест/демо) — считаем, что окно активно
    const forced = Date.now() < rainbowForcedUntil;
    const on = forced || isRainbowWindow();
    heroEl.classList.toggle('rainbow-on', on);
  }

  const heroEl = document.getElementById('hero');
  let rainbowForcedUntil = 0; // ← добавить эту строку
  // тест: ?test=rainbow — включить радугу на 20 сек
    if (new URLSearchParams(location.search).get('test') === 'rainbow' && heroEl) {
      // держим радугу N секунд в тесте (для проверки без ожидания окна)
      rainbowForcedUntil = Date.now() + 15_000;   // 15 сек для демо
      // на случай мгновенного первого тика таймера
	  applyHeroRainbow();
      setTimeout(applyHeroRainbow, 50);
    }



  // ---- Состояние
  let selectedIntent = null;                                 // 'war'|'climate'|'personal'|'family'
  let MODE = localStorage.getItem('minute.mode') || 'defer'; // 'defer'|'live'
  let REMIND_ON = localStorage.getItem('minute.remind') === '1';
  let ticker = null;                                         // интервал минутного таймера
  let scheduled = null;                                      // { intent, ts } — отложенный старт
  const firedReminders = new Set();                          // "isoTs|60" / "isoTs|5"

  // ---- Время (строго UTC)
  function nextUtcWindowTs(now = Date.now()) {
    const d = new Date(now);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const midnightUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
    const next = WINDOWS_MIN.find(m => m > mins);
    const total = (next !== undefined ? next : WINDOWS_MIN[0] + 24 * 60);
    return midnightUTC + total * 60_000;
  }
  const isoKey = ts => new Date(ts).toISOString();
  

  function windowKey(ts){ return new Date(ts).toISOString(); }
  function isLocked(ts){ return localStorage.getItem(LOCK_PREFIX + windowKey(ts)) === '1'; }
  function lockWindow(ts){ localStorage.setItem(LOCK_PREFIX + windowKey(ts), '1'); }

function getChatId() {
  const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (tgId) return tgId;             // если открыто из Telegram WebApp
  let uid = localStorage.getItem('uid');
  if (!uid) {                        // локальный id для веб-тестов
    uid = 'web-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('uid', uid);
  }
  return uid;
}


 // ---- Выбор намерения + запуск в режиме LIVE (с лимитом 2/окно)
function markSelected(btn){
  intentBtns.forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}
intentBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const intent = btn.dataset.vote;     // 'war' | 'climate' | 'personal' | 'family'
    if (!intent) return;
    markSelected(btn);
    selectedIntent = intent;
   // В режиме LIVE ничего не запускаем здесь — старт только по синей кнопке
  }, { passive: true });
});

  // ---- Режимы
  function applyModeUI(){
    btnDefer && btnDefer.classList.toggle('primary', MODE === 'defer');
    btnLive  && btnLive .classList.toggle('primary', MODE === 'live');
    btnRemind&& btnRemind.classList.toggle('is-on', REMIND_ON);
    
	if (modeNote) {
      // вместо «жёсткой» строки — ключ i18n
      const key = (MODE === 'defer') ? 'mode.note.defer' : 'mode.note.live';
      modeNote.setAttribute('data-i18n', key);
      modeNote.textContent = t(key);
    }
  }
  function setMode(m){ MODE = m; localStorage.setItem('minute.mode', MODE); applyModeUI(); }
  function toggleRemind(){ REMIND_ON = !REMIND_ON; localStorage.setItem('minute.remind', REMIND_ON ? '1' : '0'); applyModeUI(); }
  btnRemind && btnRemind.addEventListener('click', toggleRemind);
  btnDefer  && btnDefer .addEventListener('click', () => setMode('defer'));
  btnLive   && btnLive  .addEventListener('click', () => setMode('live'));
  applyModeUI();
  // после applyModeUI();
  if (typeof applyI18n === 'function') applyI18n(); // чтобы на новых узлах схватились переводы

  

  // ---- Напоминания за 60 и 5 минут до окна (UTC)
  function maybeFireReminders() {
    if (!REMIND_ON) return;
    const tsWin = nextUtcWindowTs();
    const minsLeft = Math.floor((tsWin - Date.now()) / 60_000);
    const k = isoKey(tsWin);
    if (minsLeft === 60 && !firedReminders.has(k+'|60')) {
      firedReminders.add(k+'|60');
      showToast('Через 60 минут начнётся окно (UTC)');
      fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({type:'reminder',when:60,windowTs:tsWin})}).catch(()=>{});
      try { Telegram?.WebApp?.sendData(JSON.stringify({type:'reminder',when:60,windowTs:tsWin})); } catch {}
    }
    if (minsLeft === 5 && !firedReminders.has(k+'|5')) {
      firedReminders.add(k+'|5');
      showToast('Через 5 минут начнётся окно (UTC)');
      fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({type:'reminder',when:5,windowTs:tsWin})}).catch(()=>{});
      try { Telegram?.WebApp?.sendData(JSON.stringify({type:'reminder',when:5,windowTs:tsWin})); } catch {}
    }
  }

  // ---- Запуск минуты (с твоей синей дугой + радужный внутренний круг)
  function startMinute(intent){
    if (!intent) return;
    if (ticker) clearInterval(ticker);
    startBtn.classList.add('finger-running'); // CSS: скрыть отпечаток, показать .rainbow

    ///const textInRing = null; // внутренний таймер отключён
    const ringFG = startBtn.querySelector('.finger-ring .fg'); // синяя дуга
    const endAt = Date.now() + 60_000;

    // подготовка прогресса
    if (ringFG) {
      const r = parseFloat(ringFG.getAttribute('r') || '84');
      const C = 2 * Math.PI * r;
      ringFG.style.strokeDasharray = `${C}`;
      ringFG.style.strokeDashoffset = `${C}`;
    }

    const tick = () => {
      const left = Math.max(0, endAt - Date.now());
      const ss = String(Math.floor(left / 1000)).padStart(2, '0');
      countdown.textContent = `00:${ss}`;
      ///if (textInRing) textInRing.textContent = `00:${ss}`;
      if (ringFG) {
        const r = parseFloat(ringFG.getAttribute('r') || '84');
        const C = 2 * Math.PI * r;
        ringFG.style.strokeDashoffset = `${C * (left / 60_000)}`;
      }
      if (left <= 0) {
        clearInterval(ticker); ticker = null;
        startBtn.classList.remove('finger-running');
        // Голос отправляет sendVoteAfterMinute (для LIVE), а для DEFER — отложенная логика.
        try { Telegram?.WebApp?.sendData(JSON.stringify({type:'minute:end', intent, mode: MODE})); } catch {}
        showToast('Минута завершена');
      }
    };
    tick();
    ticker = setInterval(tick, 200);
  }

  // ---- Клик по «пальцу»: поведение зависит от режима
  startBtn.addEventListener('click', () => {
    if (!selectedIntent) { showToast('minute.choose'); return; }
	// 🟩 Проверка профиля перед запуском
    const p = (typeof getStoredProfile === 'function' ? getStoredProfile() : {}) || {};
    const hasProfile = p.country && p.region && p.lang && p.gender && p.ageGroup;
    if (!hasProfile) {
      showToast('Сначала заполните профиль (страна, регион, язык, пол, возраст).');
      try {
        const base = location.origin || (window.PUBLIC_BASE || '');
        window.Telegram?.WebApp?.openLink?.(`${base}/index.html?screen=profile`);
      } catch {}
      return;
    }
 

   const ts = nextUtcWindowTs();
   if (MODE === 'live') {
     // уже есть голос на это окно
     const ts = getNextWindowTs();
     if (getLiveCount(ts) >= LIVE_LIMIT) {
       showToast('Можно только 2 раза в текущее окно. Голосуйте в следующее окно.');
       return;
     }
     // фиксируем нажатие и запускаем минуту
     incLiveCount(ts);
     startMinute(selectedIntent);
     // отправка голоса — строго после минуты
     const profile = (typeof getStoredProfile === 'function' ? getStoredProfile() : {}) || {};
     sendVoteAfterMinute(selectedIntent, profile);
   } else {
     // Отложенно — оставляем твою текущую логику (планирование на ближайшее окно)
     const ts = getNextWindowTs();
     if (isLocked(ts)) {
       const d = new Date(ts);
       const hh = String(d.getUTCHours()).padStart(2,'0');
       const mm = String(d.getUTCMinutes()).padStart(2,'0');
       showToast?.(`Уже запланирован голос на ${hh}:${mm} (UTC).`);
       return;
     }
     scheduled = { intent: selectedIntent, ts };
     lockWindow(ts);
     const d = new Date(ts);
     const hh = String(d.getUTCHours()).padStart(2,'0');
     const mm = String(d.getUTCMinutes()).padStart(2,'0');
     showToast?.(`Голос запланирован на ${hh}:${mm} (UTC).`);
   }
 });
  // ---- ETA + напоминания + автозапуск отложенного голоса
  function renderEta() {
    const now = Date.now();
    const ts  = nextUtcWindowTs(now);
    let diff  = Math.max(0, ts - now);
    const hh = String(Math.floor(diff / 3_600_000)).padStart(2, '0'); diff %= 3_600_000;
    const mm = String(Math.floor(diff / 60_000)).padStart(2, '0');    diff %= 60_000;
    const ss = String(Math.floor(diff / 1000)).padStart(2, '0');
    nextEtaEl.textContent = `00:00 / 08:00 / 16:00 • через ${hh}:${mm}:${ss} (UTC)`;

    maybeFireReminders();

    // если запланировано и окно наступило — запускаем минуту
    if (scheduled && now >= scheduled.ts) {
      const { intent } = scheduled;
      scheduled = null;
      startMinute(intent);
    }
    // подсветка «радужного окна» 3 минуты с начала окна
    applyHeroRainbow();
  }
  renderEta();
  setInterval(renderEta, 1000);
  applyHeroRainbow(); // на всякий случай сразу проставить начальное состояние
});
