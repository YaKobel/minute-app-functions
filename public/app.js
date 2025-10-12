/**
 * MINUTE App — главная: минутка + ETA до UTC-окон + POST country/region/lang
 */
(function () {
  const API_KEY = (window.APP_KEY || 'ajK9sdfh2398sdhf923SDHF82shdf9283');


  let minuteTimer = null;
  let minuteLeft = 60;

  document.querySelectorAll('.cta[data-vote]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const category = (btn.getAttribute('data-vote') || '').toLowerCase();
      if (!['war', 'climate', 'personal', 'family'].includes(category)) return;
  
      // необязательная анимация/подсветка выбора
      btn.classList.add('selected');
  
      // профиль для метаданных
      const profile = getStoredProfile() || {};
      const payload = {
        category,                                 // ← сервер ждёт "category"
        country: (profile.country || 'UA').toUpperCase(),
        region:  (profile.region  || 'center'),
        lang:    (profile.lang    || getLang()),
        gender:  profile.gender  || null,
        ageGroup: profile.ageGroup || null,
  
        // тех. поля (по желанию; на сервере можно игнорить)
        userId:  detectUserId(),
        chatId:  detectUserId()
      };
  
      try {
        const resp = await fetch('/api/vote', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Key': API_KEY                // ← ИСПОЛЬЗУЕМ ПЕРЕМЕННУЮ
          },
          body: JSON.stringify(payload)
        });
		
		if (!resp.ok) {
          let errMsg = 'vote_failed';
          try {
            const j = await resp.json();
            if (j && j.message) errMsg = j.message;
          } catch (_) {}
          throw new Error(errMsg);
        }
  
        const data = await resp.json();
        if (!resp.ok || !data?.ok) throw new Error(data?.error || 'vote_failed');
  
        // короткая «галочка» что всё ок
        btn.classList.add('neon-ok');
        setTimeout(() => btn.classList.remove('neon-ok'), 1200);
  
        // по желанию — обнови статистику на странице, если она открыта
        if (location.pathname.includes('stats')) {
          try { await loadStats?.(); } catch(_) {}
        }
      } catch (e) {
        alert('Ошибка отправки. Проверьте соединение.');
        console.error('vote error:', e);
      }
    }, { passive: true });
  });

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
