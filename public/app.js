/**
 * MINUTE App — главная: минутка + ETA до UTC-окон + POST country/region/lang
 */
(function () {
  const API_KEY = (window.APP_KEY || 'ajK9sdfh2398sdhf923SDHF82shdf9283');


  let minuteTimer = null;
  let minuteLeft = 60;

  // Профиль обязателен: голосуем только после заполнения
  const profile = getStoredProfile() || {};
  const miss = [];
  if (!profile.country)   miss.push('страна');
  if (!profile.region)    miss.push('регион');
  if (!profile.lang)      miss.push('язык');
  if (!profile.gender)    miss.push('пол');
  if (!profile.ageGroup)  miss.push('возраст');

  if (miss.length) {
    alert('Сначала заполните профиль: ' + miss.join(', '));
    // если открыто внутри Telegram — аккуратно ведём на экран профиля
    try {
      const base = location.origin || (window.PUBLIC_BASE || '');
      window.Telegram?.WebApp?.openLink?.(`${base}/index.html?screen=profile`);
    } catch (_) {}
    btn.classList.remove('selected');
    return;
  }

  // Без дефолтов! Берём только то, что реально указал пользователь
  const payload = {
    category,
    country: String(profile.country).toUpperCase(), // удалили "|| 'UA'"
    region:  String(profile.region),                 // удалили "|| 'center'"
    lang:    String(profile.lang),                   // удалили "|| getLang()"
    gender:  profile.gender,
    ageGroup: profile.ageGroup,

    // тех.поля (по желанию)
    userId: detectUserId(),
    chatId: detectUserId()
  };


  function startMinute(clockEl) {
    clearInterval(minuteTimer);
    minuteTimer = setInterval(() => {
      minuteLeft = Math.max(0, minuteLeft - 1);
      renderMinute(clockEl, minuteLeft);
      if (minuteLeft === 0) clearInterval(minuteTimer);
    }, 1000);
  }

  function renderMinute(el, s) {
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    el.textContent = `${m}:${ss}`;
  }

  // ETA до ближайшего окна (00:00 / 08:00 / 16:00) строго по UTC
  function tickNextEta(el) {
    const now = new Date();
    const next = nextWindowUTC(now);
    const sec = Math.max(0, Math.floor((next - now) / 1000));
    const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    el.textContent = `00:00 / 08:00 / 16:00  •  через ${hh}:${mm}:${ss}`;
  }

  function nextWindowUTC(dNow) {
    const minsNow = dNow.getUTCHours() * 60 + dNow.getUTCMinutes();
    const windows = [0, 8 * 60, 16 * 60];
    const y = dNow.getUTCFullYear(), m = dNow.getUTCMonth(), day = dNow.getUTCDate();

    for (const mTotal of windows) {
      const h = Math.floor(mTotal / 60), min = mTotal % 60;
      if (minsNow < mTotal || (minsNow === mTotal && dNow.getUTCSeconds() > 0)) {
        return new Date(Date.UTC(y, m, day, h, min, 0));
      }
    }
    return new Date(Date.UTC(y, m, day + 1, 0, 0, 0));
  }

  function getStoredProfile() {
    try { return JSON.parse(localStorage.getItem('minute.profile') || '{}'); }
    catch { return {}; }
  }
  function getLang() { return localStorage.getItem('minute.lang') || 'ru'; }
  function detectUserId() {
    try { const tg = window.Telegram?.WebApp; const id = tg?.initDataUnsafe?.user?.id; if (id) return id; } catch {}
    const q = new URLSearchParams(location.search).get('user_id');
    if (q && /^\d+$/.test(q)) return Number(q);
    return 566405905;
  }
  async function safeJson(resp) { const t = await resp.text(); try { return JSON.parse(t); } catch { return null; } }
})();
