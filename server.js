/**
 * MINUTE / TimeWorld — сервер (Express + Telegram + Firestore) — ESM
 */

import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import admin from 'firebase-admin';
import TelegramBot from 'node-telegram-bot-api';

// ---------- file urls -> paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Firebase Admin ----------
// ---------- Firebase Admin ----------
(function initFirebase() {
  try {
    if (admin.apps.length) return;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64 || '';

    if (!raw && !b64) {
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
        console.log('🔐 Firebase Admin: GOOGLE_APPLICATION_CREDENTIALS');
        return;
      }
      throw new Error('Нет сервис-аккаунта. Укажи FIREBASE_SERVICE_ACCOUNT или FIREBASE_SERVICE_ACCOUNT_B64');
    }

    const jsonStr = raw || Buffer.from(b64, 'base64').toString('utf8');
    const sa = JSON.parse(jsonStr);

    if (sa.private_key) {
      // превращаем литералы \n в реальные переводы строки
      sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id,
    });
    console.log(`🔐 Firebase Admin OK (projectId: ${sa.project_id})`);
  } catch (e) {
    console.error('Firebase init error:', e);
    process.exit(1);
  }
})();

const db = admin.firestore();

// ---------- Конфиг ----------
const PORT = Number(process.env.PORT || 3000);
const APP_API_KEY = process.env.APP_API_KEY || '';
const PUBLIC_BASE = (process.env.PUBLIC_BASE || '').replace(/\/+$/, '');

const WEBAPP_URL =
  process.env.TG_WEBAPP_URL || (PUBLIC_BASE ? `${PUBLIC_BASE}/index.html` : '');
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || (PUBLIC_BASE ? `${PUBLIC_BASE}/telegram/webhook` : '');
///const isProd = process.env.NODE_ENV === 'production'; // на Render это prod

// ---------- Express ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- Защита по ключу (кроме /api/status) ----------
function requireKey(req, res, next) {
  if (!APP_API_KEY) return next(); // можно отключить в dev
  const key = req.get('X-App-Key');
  if (key !== APP_API_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

// ---------- Хелперы времени и возраста ----------
function ageToGroup(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return null;
  if (a <= 15) return '-15';
  if (a <= 20) return '16-20';
  if (a <= 25) return '21-25';
  if (a <= 30) return '26-30';
  if (a <= 36) return '31-36';
  if (a <= 40) return '37-40';
  if (a <= 45) return '41-45';
  if (a <= 50) return '46-50';
  if (a <= 55) return '51-55';
  if (a <= 60) return '56-60';
  if (a <= 65) return '61-65';
  if (a <= 70) return '66-70';
  if (a <= 75) return '71-75';
  if (a <= 80) return '76-80';
  if (a <= 85) return '81-85';
  if (a <= 90) return '86-90';
  return '90+';
}

function nextWindowUTC(now = new Date()) {
  const minsNow = now.getUTCHours() * 60 + now.getUTCMinutes();
  const windows = [0, 8 * 60, 16 * 60];
  let target = null;
  for (const m of windows) {
    if (minsNow < m || (minsNow === m && now.getUTCSeconds() > 0)) {
      target = m;
      break;
    }
  }
  const y = now.getUTCFullYear(),
    mo = now.getUTCMonth(),
    d = now.getUTCDate();
  if (target == null) return new Date(Date.UTC(y, mo, d + 1, 0, 0, 0));
  const h = Math.floor(target / 60),
    mi = target % 60;
  return new Date(Date.UTC(y, mo, d, h, mi, 0));
}
function fmtHMS(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function buildNextWindowLine() {
  const now = new Date();
  const next = nextWindowUTC(now);
  const diffSec = Math.max(0, Math.floor((next - now) / 1000));
  return `Следующее окно (UTC): через ${fmtHMS(diffSec)}`;
}

// «Минута» с обновлением раз в 10 сек
const activeCountdowns = new Map(); // chatId -> {timer, msgId, endAt}
async function startMinuteCountdown(botInstance, chatId) {
  const existing = activeCountdowns.get(chatId);
  if (existing) {
    const left = Math.max(0, Math.ceil((existing.endAt - Date.now()) / 1000));
    try {
      await botInstance.editMessageText(`✅ Твоя минута идёт!\nОсталось: ${fmtHMS(left)}`, {
        chat_id: chatId,
        message_id: existing.msgId,
      });
    } catch {}
    return;
  }
  const endAt = Date.now() + 60_000;
  const sent = await botInstance.sendMessage(chatId, `✅ Твоя минута началась!\nОсталось: 01:00`);
  const msgId = sent.message_id;

  const stepMs = 10_000;
  const timer = setInterval(async () => {
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    const text = left > 0 ? `✅ Твоя минута идёт!\nОсталось: ${fmtHMS(left)}` : `🕊️ Минута завершена. Спасибо!`;
    try {
      await botInstance.editMessageText(text, { chat_id: chatId, message_id: msgId });
    } catch {}
    if (left <= 0) {
      clearInterval(timer);
      activeCountdowns.delete(chatId);
    }
  }, stepMs);

  activeCountdowns.set(chatId, { timer, msgId, endAt });
}


async function readUserProfile(userId) {
  try {
    const snap = await db.collection('users').doc(String(userId)).get();
    if (!snap.exists) return {};
    const u = snap.data() || {};
    return {
      country: (u.country || 'XX').toUpperCase(),
      region : u.region || null,
      gender : u.gender || null,       // только 'male' | 'female'
      ageGroup: u.ageGroup || null,
      lang   : u.lang || null,
    };
  } catch {
    return {};
  }
}



// ---------- API ----------
app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    publicBase: PUBLIC_BASE || null,
    webAppUrl: WEBAPP_URL || null,
    webhookUrl: WEBHOOK_URL || null,
  });
});

// простой healthcheck
app.get('/healthz', (req, res) => {
  res.send('ok');
});


// server.js
app.post('/api/notify', requireKey, (req, res) => {
  try {
    const { type, when, windowTs } = req.body || {};
    console.log('notify:', type, when, windowTs);
    res.json({ ok: true });
  } catch { res.status(500).json({ ok:false }); }
});

// сохранить/обновить профиль
app.post('/api/profile', requireKey, async (req, res) => {
  try {
    const { userId, age, ageGroup, country, region, city, gender, lang } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

    const normalizedGroup = ageGroup || ageToGroup(age);
    await db
      .collection('users')
      .doc(String(userId))
      .set(
        {
          age: age ?? null,
          ageGroup: normalizedGroup ?? null,
          country: country ? String(country).toUpperCase() : null,
          region: region ?? null,
          city: city ?? null,
          gender: gender ?? null, // только male|female
          lang: lang ?? null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    res.json({ ok: true });
  } catch (e) {
    console.error('/api/profile error:', e);
    res.status(500).json({ ok: false, error: 'server' });
  }
});

// --- Подписка/отписка на напоминания (используется колокольчиком)
app.post('/api/remind', requireKey, async (req, res) => {
  try {
    const { userId, on } = req.body || {};
    if (!userId) return res.status(400).json({ ok:false, error:'no userId' });

    // doc.id == chatId (в личке chatId == userId)
    await db.collection('subs').doc(String(userId)).set(
      { on: !!on },
      { merge: true }
    );
    return res.json({ ok:true });
  } catch (e) {
    console.error('/api/remind error', e);
    return res.status(500).json({ ok:false, error:'server' });
  }
});





// --- 8-часовые окна по UTC ---
const WINDOWS_MIN = [0, 8, 16];

function windowKey(ts = Date.now()) {
  const d = new Date(ts);
  const baseUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  const h = d.getUTCHours();
  let slot = 0;
  for (let i = 0; i < WINDOWS_MIN.length; i++) {
    if (h >= WINDOWS_MIN[i]) slot = WINDOWS_MIN[i];
  }
  const start = baseUTC + slot * 3600 * 1000;
  return new Date(start).toISOString(); // ключ окна
}

function nextWindowTs(ts = Date.now()) {
  const startIso = windowKey(ts);
  const start = Date.parse(startIso);
  const h = new Date(start).getUTCHours();
  const idx = WINDOWS_MIN.indexOf(h);
  const nextIdx = (idx + 1) % WINDOWS_MIN.length;
  let next = new Date(start);
  next.setUTCHours(WINDOWS_MIN[nextIdx], 0, 0, 0);
  if (next.getTime() <= start) next = new Date(start + 8 * 3600 * 1000);
  return next.getTime();
}

function fmtUtc(ts) {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} (UTC)`;
}

// Возвращает {action: 'live'|'defer'|'block', targetTs?: number}
async function limitTgClicks(chatId) {
  const db = admin.firestore();
  const now = Date.now();
  const key = windowKey(now);
  const ref = db.collection('users').doc(String(chatId));
  const snap = await ref.get();
  let data = snap.exists ? snap.data() : {};

  // если новое окно — сбрасываем счётчик
  if (data.winKey !== key) {
    data.winKey = key;
    data.winClicks = 0;
    data.deferKey = null;
  }

  // логика 1/2/3 кликов
  if (data.winClicks >= 2) {
    await ref.set({ winKey: data.winKey, winClicks: data.winClicks }, { merge: true });
    return { action: 'block' };
  }

  if (data.winClicks === 1) {
    const targetTs = nextWindowTs(now);
    data.winClicks = 2;
    data.deferKey = windowKey(targetTs);
    await ref.set({ winKey: data.winKey, winClicks: data.winClicks, deferKey: data.deferKey }, { merge: true });
    return { action: 'defer', targetTs };
  }

  // первый клик — «живая» минута
  data.winClicks = 1;
  await ref.set({ winKey: data.winKey, winClicks: data.winClicks }, { merge: true });
  return { action: 'live' };
}




// голос
app.post('/api/vote', requireKey, async (req, res) => {
  try {
    const body = req.body || {};

    // 1) валидируем категорию
    const category = String(body.category || '').toLowerCase();
    const allowed = new Set(['war', 'climate', 'personal', 'family']);
    if (!allowed.has(category)) {
      return res.status(400).json({ ok: false, message: 'invalid_category' });
    }

    // 2) валидируем профиль (никаких дефолтов!)
    const userId   = String(body.userId   ?? '').trim();
    const country  = String(body.country  ?? '').trim().toUpperCase();
    const region   = String(body.region   ?? '').trim();
    const lang     = String(body.lang     ?? '').trim();
    const gender   = String(body.gender   ?? '').trim();
    const ageGroup = String(body.ageGroup ?? '').trim();

    const missing = [];
    if (!country || country === 'XX') missing.push('country');
    if (!region)  missing.push('region');
    if (!lang)    missing.push('lang');
    if (!gender)  missing.push('gender');
    if (!ageGroup) missing.push('ageGroup');

    if (missing.length) {
      return res.status(400).json({ ok: false, message: 'profile_required', missing });
    }

    // 3) пишем голос
    await db.collection('votes').add({
      userId,
      category,
      country,
      region,
      lang,
      gender,
      ageGroup,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('/api/vote error:', e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});


// статистика (категории, страны, регионы, пол, возрастные корзины)
app.get('/api/stats', requireKey, async (req, res) => {
  try {
    const period = (req.query.period || 'day').toLowerCase(); // day|week|month
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const ranges = { day: now - oneDay, week: now - 7 * oneDay, month: now - 30 * oneDay };
    const since = ranges[period] || ranges.day;

    const sinceTS = admin.firestore.Timestamp.fromMillis(since);

    // 1) голоса за период
    const votesSnap = await db.collection('votes').where('createdAt', '>=', sinceTS).get();

    // 2) агрегация
    let total = 0;
    const byCategory = { war: 0, climate: 0, personal: 0, family: 0 };
    const byCountry = new Map(); // RU -> n
    const byRegion = new Map(); // "RU:Запад" -> n
    const byGender = { male: 0, female: 0 }; // только 2 пола
    const ageBuckets = new Map(); // "21-25" -> n

    votesSnap.forEach((doc) => {
      const v = doc.data();
      if (!v || !v.category) return;
      total++;

      // категории
      if (byCategory[v.category] != null) byCategory[v.category]++;

      // страна/регион
      const c = (v.country || '').toUpperCase();
      const goodCountry = c && c !== 'XX';      // игнорируем записи без профиля
      if (goodCountry) {
        byCountry.set(c, (byCountry.get(c) || 0) + 1);
        if (v.region) {
          const k = `${c}:${v.region}`;
          byRegion.set(k, (byRegion.get(k) || 0) + 1);
        }
      }

      // пол
      if (v.gender === 'male') byGender.male++;
      else if (v.gender === 'female') byGender.female++;

      // возраст
      if (v.ageGroup) ageBuckets.set(v.ageGroup, (ageBuckets.get(v.ageGroup) || 0) + 1);
    });

    const topCountries = [...byCountry.entries()]
	  .filter(([country]) => country !== 'XX')
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    const topRegions = [...byRegion.entries()]
      .map(([key, count]) => {
        const [country, region] = key.split(':');
        return { country, region, count };
      })
      .sort((a, b) => b.count - a.count);

    const topAgeGroups = [...ageBuckets.entries()]
      .map(([group, count]) => ({ group, count }))
      .sort((a, b) => a.group.localeCompare(b.group, 'ru'));

    res.json({ ok: true, total, byCategory, byGender, topCountries, topRegions, topAgeGroups });
  } catch (e) {
    console.error('/api/stats error:', e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------- Telegram Bot ----------
const TG_TOKEN    = process.env.TELEGRAM_BOT_TOKEN || '';

let bot = null;
if (TG_TOKEN) {
  bot = new TelegramBot(TG_TOKEN, { polling: false }); // webhook-режим
  if (WEBHOOK_URL) {
    bot.setWebHook(WEBHOOK_URL)
      .then(() => console.log('🤖 Telegram bot webhook set to:', WEBHOOK_URL))
      .catch(e => console.error('setWebHook error:', e.message));
  }
} else {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN is empty — бот отключён.');
}


// webhook приёмник
app.post('/telegram/webhook', (req, res) => {
  try {
    if (bot && req.body) bot.processUpdate(req.body);
  } catch (err) {
    console.error('webhook error:', err);
  } finally {
    res.sendStatus(200);
  }
});

// ---------- Telegram UI ----------
const CATEGORIES = [
  { text: '🕊️ Остановим войны', data: 'vote:war' },
  { text: '🌍 Мир без катастроф', data: 'vote:climate' },
  { text: '💖 Личное счастье', data: 'vote:personal' },
  { text: '🤝 Помочь Близким', data: 'vote:family' },
];

function buildStartKeyboard() {
  const base = WEBAPP_URL || (PUBLIC_BASE ? `${PUBLIC_BASE}/index.html` : null);
  const kb = [
    [
      { text: CATEGORIES[0].text, callback_data: CATEGORIES[0].data },
      { text: CATEGORIES[1].text, callback_data: CATEGORIES[1].data },
    ],
    [
      { text: CATEGORIES[2].text, callback_data: CATEGORIES[2].data },
      { text: CATEGORIES[3].text, callback_data: CATEGORIES[3].data },
    ],
  ];
  
  // ряд с напоминаниями и ссылкой "О проекте"
  kb.push([
    { text: '🔔 Напоминание', callback_data: 'remind:toggle' },
    base
      ? { text: 'ℹ️ О проекте', web_app: { url: `${base}?screen=about` } }
      : { text: 'ℹ️ О проекте', callback_data: 'about:text' },
  ]);
  if (base) {
    kb.push([
      { text: '📊 Статистика', web_app: { url: `${base}?screen=stats` } },
      { text: '👤 Профиль', web_app: { url: base.replace('index.html', 'profile.html') } },
    ]);
  }
  return { inline_keyboard: kb };
}

async function toggleReminders(chatId) {
  const ref = db.collection('subs').doc(String(chatId));
  const snap = await ref.get();
  const curr = snap.exists ? !!snap.data().on : false;
  const next = !curr;
  await ref.set({ on: next }, { merge: true });
  return next;
}
function windowIso(ts) { return new Date(ts).toISOString(); }



// /start — строка до окна + клавиатура
if (bot) {
  bot.onText(/^\/(start|menu)$/i, async (msg) => {
    const chatId = msg.chat.id;
    try {
      await bot.sendMessage(chatId, buildNextWindowLine());
      await bot.sendMessage(chatId, 'Выберите намерение на 1 минуту или откройте экраны:', {
        reply_markup: buildStartKeyboard(),
      });
    } catch (e) {
      console.error('start error:', e.message);
    }
  });

  // /stats — открыть экран статистики
  bot.onText(/^\/stats$/i, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const url = (WEBAPP_URL || `${PUBLIC_BASE}/index.html`) + '?screen=stats';
      await bot.sendMessage(chatId, 'Открыть статистику:', {
        reply_markup: { inline_keyboard: [[{ text: '📈 Статистика', web_app: { url } }]] },
      });
    } catch (e) {
      console.error('/stats error:', e.message);
    }
  });

  // обработка нажатий
  bot.on('callback_query', async (query) => {
    try {
      const chatId = query?.message?.chat?.id;
      const data   = query?.data || '';
      if (!chatId) return;

      // 🔔 подписка на напоминания
      if (data === 'remind:toggle') {
        const on = await toggleReminders(chatId);
        const status = on ? 'включены' : 'выключены';
        await bot.answerCallbackQuery(query.id, { text: `Напоминания ${status}`, show_alert: false });
        await bot.sendMessage(chatId, buildNextWindowLine());
        return;
      }

      // ℹ️ «О проекте» (если нет WEBAPP_URL)
      if (data === 'about:text') {
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          'MINUTE — это короткая коллективная минута внимания три раза в день.\n' +
          'Окна: 00:00 / 08:00 / 16:00 по UTC. Выберите намерение и отмечайтесь.',
        );
        return;
      }

      // Голос из ТГ
      if (data.startsWith('vote:')) {
        const category = data.split(':')[1]; // war|climate|personal|family
        const ok = ['war','climate','personal','family'].includes(category);
        if (!ok) return;

        // профиль (country/region/gender/ageGroup/lang)
        const prof = await readUserProfile(chatId);
        if (!prof?.country) {
          await bot.sendMessage(
            chatId,
            'Пожалуйста, заполните профиль (страна/регион/пол/возраст), после чего голос будет засчитываться.',
            { reply_markup: { inline_keyboard: [[{ text: 'Открыть профиль', web_app: { url: `${PUBLIC_BASE}/profile.html` } }]] } }
          );
          return;
        }

        const country = prof.country;
        const region  = prof.region  ?? null;
        const gender  = prof.gender  ?? null;
        const ageGroup= prof.ageGroup?? null;
        const lang    = prof.lang    ?? null;

        // ограничитель кликов (1 — live; 2 — defer; 3+ — block)
        const lim = await limitTgClicks(chatId);

        if (lim.action === 'live') {
          await bot.answerCallbackQuery(query.id, { text: 'Минута запущена ⏱️', show_alert: false });
          await startMinuteCountdown(bot, chatId);
          setTimeout(async () => {
            try {
              await db.collection('votes').add({
                userId: String(chatId), category, country, region, gender, ageGroup, lang,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            } catch (e) { console.error('save live vote error:', e.message); }
          }, 61_000);

        } else if (lim.action === 'defer') {
          const ts = lim.targetTs;
          await bot.answerCallbackQuery(query.id, { text: `Голос запланирован на ближайшее окно: ${fmtUtc(ts)}`, show_alert: true });
          await db.collection('entries').add({
            type: 'defer', userId: String(chatId), category, country, region, gender, ageGroup, lang,
            applyAt: admin.firestore.Timestamp.fromMillis(ts),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

        } else {
          await bot.answerCallbackQuery(query.id, { text: 'В этом окне уже 2 отметки. Попробуйте в следующем окне.', show_alert: true });
        }
      }
    } catch (e) {
      console.error('callback_query error:', e.message);
      try { await bot.answerCallbackQuery(query.id, { text: 'Ошибка. Попробуйте ещё раз', show_alert: true }); } catch {}
    }
  });
} else {
  console.warn('⚠️ Бот не инициализирован — обработчики Telegram отключены.');
}


// WebApp → sendData: переключение колокольчика и пр.
if (bot) {
  bot.on('message', async (msg) => {
    try {
      const chatId = msg.chat?.id;
      const dataStr = msg.web_app_data?.data;
      if (!chatId || !dataStr) return;

      let payload = {};
      try { payload = JSON.parse(dataStr); } catch { return; }

      if (payload.type === 'reminder:toggle') {
        const on = await toggleReminders(chatId);
        await bot.sendMessage(
          chatId,
          on ? '🔔 Напоминания включены.\n' + buildNextWindowLine()
             : '🔕 Напоминания выключены.'
        );
      }
    } catch (e) {
      console.error('web_app_data error:', e.message);
    }
  });
}


// ——— авто-перелив отложенных заявок в голоса (включается DEFER_LOOP=1) ———
if (process.env.DEFER_LOOP === '1') {
  setInterval(async () => {
    try {
      const now = admin.firestore.Timestamp.fromMillis(Date.now());
      const snap = await db
        .collection('entries')
        .where('type', '==', 'defer')
        .where('applyAt', '<=', now)
        .limit(200)
        .get();

      if (snap.empty) return;
      const batch = db.batch();

      for (const doc of snap.docs) {
        const v = doc.data() || {};
        const voteRef = db.collection('votes').doc();
        batch.set(voteRef, {
          userId: v.userId || null,
          category: v.category,
          country: (v.country || 'XX').toUpperCase(),
          region: v.region || null,
          gender: v.gender || null,
          ageGroup: v.ageGroup || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        batch.delete(doc.ref);
      }
      await batch.commit();
    } catch (e) {
      console.error('defer loop error:', e.message);
    }
  }, 30_000);
}

// ——— рассылка напоминаний (каждые ~30 сек), включается TG_REMINDER_LOOP=1 ———
if (bot && process.env.TG_REMINDER_LOOP === '1') {
  console.log('⏰ TG reminders loop ON');
  setInterval(async () => {
    try {
      const now = new Date();
      const next = nextWindowUTC(now);          // уже есть в файле
      const diffMin = Math.floor((next - now) / 60000);
      //if (![60, 5].includes(diffMin)) return;
	  if (![60, 5, 0].includes(diffMin)) return; // шлёт и когда осталось 0 минут

      const winKey = windowIso(next);
      const subsSnap = await db.collection('subs').where('on', '==', true).get();
      if (subsSnap.empty) return;

      const field = diffMin === 60 ? 'last60' : 'last5';
      const msg   = diffMin === 60
        ? 'Через 60 минут начнётся окно (UTC).'
        : 'Через 5 минут начнётся окно (UTC).';

      // отправляем и помечаем, что пользователю напомнили именно про это окно
      const batch = db.batch();
      for (const doc of subsSnap.docs) {
        const d = doc.data() || {};
        if (d[field] === winKey) continue;      // уже напоминали для этого окна
        const chatId = doc.id;
        try { await bot.sendMessage(chatId, `${msg}\n` + buildNextWindowLine()); } catch {}
        batch.set(doc.ref, { [field]: winKey }, { merge: true });
      }
      await batch.commit();
    } catch (e) {
      console.error('reminders loop error:', e.message);
    }
  }, 30_000);
}

// ===== UTC окна: 00:00 / 08:00 / 16:00 =====
function nextUtcWindowTs(now = Date.now()) {
  const d = new Date(now);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  const WINDOWS = [0, 8 * 60, 16 * 60];
  const next = WINDOWS.find(m => m > mins);
  const total = (next !== undefined ? next : WINDOWS[0] + 24 * 60);
  return midnight + total * 60_000;
}
function minsLeftToWindow(now = Date.now()) {
  return Math.floor((nextUtcWindowTs(now) - now) / 60_000);
}
async function sendTg(bot, chatId, text, opts={}) {
  try { await bot.sendMessage(chatId, text, { disable_web_page_preview:true, ...opts }); }
  catch (e) { console.error('tg send error:', e.message); }
}
// === Основной луп напоминалок (каждую минуту)
function startReminderLoop() {
  if (!process.env.TG_REMINDER_LOOP) {
    console.log('⏳ TG reminders loop OFF (set TG_REMINDER_LOOP=1 to enable)');
    return;
  }
  console.log('🔔 TG reminders loop ON');
  setInterval(async () => {
    try {
      const left = minsLeftToWindow();
      if (left !== 60 && left !== 5) return; // интересуют только 60 и 5 минут
      const winTs = nextUtcWindowTs();
      const winIso = new Date(winTs).toISOString();
      // берём подписанных пользователей
      const snap = await db.collection('subs').where('on','==',true).get();
      if (snap.empty) return;
      const batch = db.batch();
      const text60 = 'Через 60 минут начнётся окно (UTC). Подготовьтесь ✨';
      const text5  = 'Через 5 минут начнётся окно (UTC). Готовы начать минуту?';
      for (const doc of snap.docs) {
        const s = doc.data() || {};
        const chatId = String(doc.id);      // у тебя id документа = chatId
        // дедупликация по окну
        if (left === 60) {
          if (s.last60 === winIso) continue;
          await sendTg(bot, chatId, text60);
          batch.update(doc.ref, { last60: winIso, on: true });
        } else { // 5 минут
          if (s.last5 === winIso) continue;
          // можно одну из кнопок дать ссылкой на твой веб-апп
          await sendTg(bot, chatId, text5, {
            reply_markup: { inline_keyboard: [[
              { text: 'Открыть приложение', url: process.env.PUBLIC_BASE || 'https://minute-app-functions.onrender.com' }
            ]] }
          });
          batch.update(doc.ref, { last5: winIso, on: true });
        }
      }
      await batch.commit();
    } catch (e) {
      console.error('reminder loop error:', e.message);
    }
  }, 60_000);
}




// === ADMIN: wipe test data (votes) ===
// Требует X-App-Key = APP_API_KEY
app.post('/api/admin/reset-demo', requireKey, async (req, res) => {
  try {
    const collections = ['votes'];        // если используешь другое имя — поправь
    for (const name of collections) {
      const snap = await db.collection(name).get();
      if (snap.empty) continue;
      const batchSize = 400;
      let buf = [];
      for (const doc of snap.docs) {
        buf.push(doc);
        if (buf.length >= batchSize) {
          const b = db.batch();
          buf.forEach(d => b.delete(d.ref));
          await b.commit();
          buf = [];
        }
      }
      if (buf.length) {
        const b = db.batch();
        buf.forEach(d => b.delete(d.ref));
        await b.commit();
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('reset-demo:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// === KeepAlive для Render (чтобы сервер не засыпал) ===
if (process.env.KEEPALIVE === '1' && PUBLIC_BASE) {
    console.log('🟢 KEEPALIVE активен: пингуем каждые 50 минут →', PUBLIC_BASE);
    const ping = () => {
        fetch(`${PUBLIC_BASE}/healthz`)
            .then(() => console.log('🕐 keepalive ping OK'))
            .catch(() => console.warn('⚠️ keepalive ping failed'));
    };
    setInterval(ping, 50 * 60 * 1000); // каждые 50 минут
    ping(); // первый вызов сразу
}


// ---------- Запуск ----------
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  if (WEBHOOK_URL) console.log(`🔔 Webhook слушается на ${WEBHOOK_URL}`);
});
