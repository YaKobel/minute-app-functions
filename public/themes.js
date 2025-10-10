// /public/themes.js — глобальная тема через localStorage + ?theme=...
(function () {
  const LS_KEY = 'minute.theme';
  const params = new URLSearchParams(location.search);
  const q = (params.get('theme') || '').toLowerCase();

  // 1) Приоритет: query ?theme=...
  if (['a','b','c'].includes(q)) {
    localStorage.setItem(LS_KEY, q);
  }

  // 2) Тема из LS, иначе дефолт: Light (c)
  const stored = localStorage.getItem(LS_KEY);
  const theme = ['a','b','c'].includes(stored) ? stored : 'c';

  // Применить тему к <html>
  document.documentElement.classList.remove('theme-a','theme-b','theme-c');
  document.documentElement.classList.add('theme-' + theme);

  // Подсветить активную кнопку (если есть)
  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-link]')
      .forEach(el => el.classList.toggle('active', el.dataset.themeLink === theme));

    // Сделать клики по кнопкам тем глобальными
    document.querySelectorAll('[data-theme-link]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const t = el.dataset.themeLink;
        if (!['a','b','c'].includes(t)) return;
        localStorage.setItem(LS_KEY, t);
        // Обновим все ссылки на страницы, чтобы не таскать ?theme=
        // просто перезагрузим текущую — тема уже применена глобально
        location.reload();
      });
    });

    // Обновить навигационные ссылки статично (на случай если хочешь оставить ?theme)
    document.querySelectorAll('a[href$=".html"]').forEach(a => {
      try {
        const url = new URL(a.href, location.origin);
        url.searchParams.set('theme', theme);
        a.href = url.pathname + '?' + url.searchParams.toString();
      } catch(_) {}
    });
  });
})();
