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
const MEDIA_BASE = process.env.MEDIA_BASE || 'https://yakobel.github.io/minute-app-functions/media';


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


// Короткий отсчёт до начала окна: редактируем одно сообщение каждую секунду (30→0)
async function startThirtyCountdown(botInstance, chatId, untilTs) {
  const fmt = (s) => `00:${String(Math.max(0, s)).padStart(2, '0')}`;
  const left0 = Math.max(0, Math.ceil((untilTs - Date.now()) / 1000));
  const startAt = Math.min(left0, 30); // не больше 30 сек

  const sent = await botInstance.sendMessage(
    chatId,
    `Через 30 секунд начнётся окно (UTC).\n⏳ Осталось: ${fmt(startAt)}`
  );
  const msgId = sent.message_id;

  const timer = setInterval(async () => {
    const left = Math.max(0, Math.ceil((untilTs - Date.now()) / 1000));
    const text = left > 0
      ? `⏳ До начала окна (UTC): ${fmt(left)}`
      : `✅ Начали! Окно открыто.`;
    try {
      await botInstance.editMessageText(text, { chat_id: chatId, message_id: msgId });
    } catch (_) {}

    if (left <= 0) clearInterval(timer);
  }, 1000);
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

// ===== Presence (онлайн за текущее окно) =====
const presence = new Map(); // sessionKey -> Map<clientId, lastTs>

function presenceCleanup() {
  const now = Date.now();
  for (const [win, map] of presence.entries()) {
    for (const [cid, ts] of map.entries()) {
      if (now - ts > 45_000) map.delete(cid);   // TTL клиента ~45с
    }
    if (map.size === 0) presence.delete(win);   // чистим пустые окна
  }
}

function presenceTouch(clientId) {
  const key = windowKey(Date.now());
  let map = presence.get(key);
  if (!map) { map = new Map(); presence.set(key, map); }
  map.set(clientId, Date.now());
  return map.size;
}

// ping от клиента + ответ с текущим числом
app.post('/api/presence/ping', (req, res) => {
  try {
    const clientId = String(req.body?.clientId || '').trim();
    if (!clientId) return res.status(400).json({ ok:false, error:'clientId required' });
    presenceCleanup();
    const count = presenceTouch(clientId);
    return res.json({ ok:true, count });
  } catch (e) {
    console.error('/api/presence/ping', e);
    return res.status(500).json({ ok:false });
  }
});

// просто получить текущее число (на всякий)
app.get('/api/presence', (_req, res) => {
  presenceCleanup();
  const key = windowKey(Date.now());
  const count = presence.get(key)?.size || 0;
  res.json({ ok:true, count });
});

// периодическая уборка
setInterval(presenceCleanup, 30_000);



// голос (live / defer)
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

    // 3) режим: live / defer
    const mode = String(body.mode || 'live').toLowerCase();

    if (mode === 'defer') {
      // планируем голос на СЛЕДУЮЩЕЕ окно (как в Telegram)
      const now = Date.now();
      const applyAtDate = nextWindowTs(now); // функция уже есть выше
      const applyAt = admin.firestore.Timestamp.fromDate(applyAtDate);

      await db.collection('entries').add({
        type: 'defer',
        userId: userId || null,
        category,
        country,
        region,
        lang,
        gender,
        ageGroup,
        applyAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({
        ok: true,
        mode: 'defer',
        applyAt: applyAtDate.toISOString(),
      });
    }

    // по умолчанию — живой голос
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

    return res.json({ ok: true, mode: 'live' });
  } catch (e) {
    console.error('/api/vote error:', e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});



// статистика (категории, страны, регионы, пол, возрастные корзины)
app.get('/api/stats', requireKey, async (req, res) => {
  try {
    const period = String(req.query.period || 'day').toLowerCase(); // day|week|month|3m|6m|year|all
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // поддержка новых периодов
    const map = {
      day  : now - 1  * day,
      week : now - 7  * day,
      month: now - 30 * day,
      '3m' : now - 90  * day,
      '6m' : now - 180 * day,
      year : now - 365 * day
      // all -> особый случай
    };

    let votesSnap;
    if (period === 'all') {
      // без фильтра по дате — берём все документы
      votesSnap = await db.collection('votes').get();
    } else {
      const since = map[period] ?? map['day'];
      const sinceTS = admin.firestore.Timestamp.fromMillis(since);
      votesSnap = await db.collection('votes').where('createdAt', '>=', sinceTS).get();
    }


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
  // Глобальная «синяя» кнопка (Chat Menu Button) — открывает ваш WebApp
  try {
    const menuUrl = WEBAPP_URL || (PUBLIC_BASE ? `${PUBLIC_BASE}/index.html` : '');
    if (menuUrl) {
      bot.setChatMenuButton({
        menu_button: { type: 'web_app', text: 'TimeWorld', web_app: { url: menuUrl } }
      })
      .then(() => console.log('✅ Chat Menu Button установлен'))
      .catch(e => console.error('setChatMenuButton error:', e.message));
    }
  } catch (e) {
    console.error('setChatMenuButton error:', e.message);
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
///const CATEGORIES = [
///  { text: '🕊️ Остановим войны', data: 'vote:war' },
///  { text: '🌍 Мир без катастроф', data: 'vote:climate' },
///  { text: '💖 Личное счастье', data: 'vote:personal' },
///  { text: '🤝 Помочь Близким', data: 'vote:family' },
///];

///function buildStartKeyboard(remOn = false) {
///  const base = WEBAPP_URL || (PUBLIC_BASE ? `${PUBLIC_BASE}/index.html` : null);
///  const bellText = remOn ? '🔔 Напоминание: ВКЛ' : '🔕 Напоминание: ВЫКЛ';
///
///  const kb = [
///    [
///      { text: CATEGORIES[0].text, callback_data: CATEGORIES[0].data },
///      { text: CATEGORIES[1].text, callback_data: CATEGORIES[1].data },
///    ],
///    [
///      { text: CATEGORIES[2].text, callback_data: CATEGORIES[2].data },
///      { text: CATEGORIES[3].text, callback_data: CATEGORIES[3].data },
///    ],
///    [
///      { text: bellText, callback_data: 'remind:toggle' },
///      base
///        ? { text: 'ℹ️ О проекте', web_app: { url: `${base}?screen=about` } }
///        : { text: 'ℹ️ О проекте', callback_data: 'about:text' },
///    ],
///    [
///      { text: '❤️ Поддержать', callback_data: 'donate:text' },
///      base && { text: '📊 Статистика', web_app: { url: `${base}?screen=stats` } },
///    ].filter(Boolean),
///    [
///      base && { text: '👤 Профиль', web_app: { url: base.replace('index.html', 'profile.html') } },
///      base && { text: '⏰ Открыть приложение', web_app: { url: base } },
///    ].filter(Boolean),
///  ];
///
///  return { inline_keyboard: kb };
///}

function buildStartKeyboard(remOn = false) {
  const base = WEBAPP_URL || (PUBLIC_BASE ? `${PUBLIC_BASE}/index.html` : null);
  const bellText = remOn ? '🔔 Напоминание: ВКЛ' : '🔕 Напоминание: ВЫКЛ';

  const kb = [
    // 1) Переключатель напоминаний
    [{ text: bellText, callback_data: 'remind:toggle' }],

    // 2) О проекте + Поддержать
    [
      base
        ? { text: 'ℹ️ О проекте', web_app: { url: `${base}?screen=about` } }
        : { text: 'ℹ️ О проекте', callback_data: 'about:text' },
      { text: '❤️ Поддержать', callback_data: 'donate:text' },
    ],

    // 3) Открыть приложение (если есть base)
    base ? [{ text: '⏰ Приложение Time World', web_app: { url: base } }] : null,
  ].filter(Boolean);

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

async function getRemindersOn(chatId) {
  const snap = await db.collection('subs').doc(String(chatId)).get();
  return snap.exists ? !!snap.data().on : false;
}


// Медиа для Telegram-интро (короткий mp4/гиф)
const TG_TELEG_INTRO =
  process.env.MEDIA_BASE
    ? `${process.env.MEDIA_BASE}/app_teleg.mp4`
    : 'https://yakobel.github.io/minute-app-functions/media/app_teleg.mp4';

// Все Telegram-обработчики объявляем ТОЛЬКО если бот создан
if (bot) {
  // /start (или /menu): короткая заставка + текст «следующее окно» + клавиатура
  bot.onText(/^\/(start|menu)$/i, async (msg) => {
    const chatId = msg.chat.id;
    // 6-сек. интро (можно выключить — просто закомментируй)
    if (TG_TELEG_INTRO) {
      try {
        await sendAndTrack(
          chatId,
          bot.sendVideo,
          [ TG_TELEG_INTRO, { supports_streaming: true, disable_notification: true } ]
        );
      } catch (_) {}
    }
	
    const nextLine = buildNextWindowLine();
    await sendAndTrack(chatId, bot.sendMessage, [nextLine]);
    
    const remOn = await getRemindersOn(chatId);
    await sendAndTrack(chatId, bot.sendMessage, [
      'Откройте приложение → перейдите в «Профиль» → затем откройте «Главная» и выберите одно из четырёх намерений → включите режим «Лайв» → нажмите на круг. Ваш голос будет засчитан через 60 сек. Подробности — в разделе «О проекте». Для повторного запуска основного меню используйте /start   Группа в Телеграмме: t.me/synchroni',
      { reply_markup: buildStartKeyboard(remOn) },
    ]);
  }); // ←←← ЭТОЙ СТРОКИ НЕ ХВАТАЛО

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

  // обработка нажатий (кнопки)
  bot.on('callback_query', async (query) => {
    try {
      const chatId = query?.message?.chat?.id;
      const data   = query?.data || '';
      if (!chatId) return;
      
      // 🔔 переключение напоминаний + перерисовка клавиатуры
      if (data === 'remind:toggle') {
        const on = await toggleReminders(chatId);
        await bot.answerCallbackQuery(query.id, { text: on ? 'Напоминания включены' : 'Напоминания выключены' });
      
        const remOn = await getRemindersOn(chatId);
        await sendAndTrack(chatId, bot.sendMessage, [
          buildNextWindowLine(),
          { reply_markup: buildStartKeyboard(remOn) },
        ]);
        return;
      }
      
      // ℹ️ «О проекте» (текстовый вариант, если нет WEBAPP_URL)
      if (data === 'about:text') {
        await bot.answerCallbackQuery(query.id);
        await sendAndTrack(chatId, bot.sendMessage, [
          'MINUTE — короткая коллективная минута внимания 3 раза в день.\n' +
          'Окна: 00:00 / 08:00 / 16:00 (UTC). Выберите намерение и отмечайтесь.'
        ]);
        return;
      }
      
      // 💙 Донаты — отправляем один информативный пост
      if (data === 'donate:text') {
        await bot.answerCallbackQuery(query.id);
        await sendAndTrack(chatId, bot.sendMessage, [
          'Поддержать проект:\n' +
          '• Monobank: send.monobank.ua/jar/4zfsoPCtfz\n' +
          '• OZON CLIENT: 2204 3201 1733 0961\n' +
          '• ⭐ Telegram Stars: используйте команду /donate — откроется окно перевода звёзд в Telegram\n\n' +
          'Спасибо за поддержку! ❤️'
        ]);
        return;
      }


      // Голос из ТГ
      if (data.startsWith('vote:')) {
        const category = data.split(':')[1]; // war|climate|personal|family
        const ok = ['war','climate','personal','family'].includes(category);
        if (!ok) return;

        const prof = await readUserProfile(chatId);
        if (!prof?.country) {
          await bot.sendMessage(
            chatId,
            'Пожалуйста, заполните профиль (страна/регион/пол/возраст), после чего голос будет засчитываться.',
            { reply_markup: { inline_keyboard: [[{ text: 'Открыть профиль', web_app: { url: `${PUBLIC_BASE}/profile.html` } }]] } }
          );
          return;
        }

        const { country, region=null, gender=null, ageGroup=null, lang=null } = prof;
        const lim = await limitTgClicks(chatId); // 1=live, 2=defer, 3+=block

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
} // <— ВАЖНО: никаких else тут не нужно (варнинг уже был выше при пустом токене)

// ===== DONATE (Telegram Stars) =====

// /donate — меню с вариантами звёзд
bot.onText(/^\/donate$/i, async (msg) => {
  const chatId = msg.chat.id;
  const kb = {
    inline_keyboard: [
      [{ text: 'Поддержать на 100 ⭐️', callback_data: 'donate:100' }],
      [{ text: 'Поддержать на 250 ⭐️', callback_data: 'donate:250' }],
      [{ text: 'Поддержать на 500 ⭐️', callback_data: 'donate:500' }],
    ],
  };
  await bot.sendMessage(chatId, 'Спасибо за поддержку! Выберите сумму:', { reply_markup: kb });
});

// функция для выставления инвойса (Telegram Stars / XTR)
async function sendStarsInvoice(chatId, amount) {
  const title       = `Пожертвование ${amount} ⭐️`;
  const description = 'Поддержка проекта TimeWorld';
  const payload     = `donate:${amount}:${Date.now()}`;
  const currency    = 'XTR';
  const prices      = [{ label: `${amount} Stars`, amount }];

  // ВАЖНО: НИЧЕГО не передаём как provider_token (для Stars он не нужен)
  await bot.sendInvoice(
    chatId,
    title,
    description,
    payload,
    undefined,                  // <-- ключевой момент: никакого provider_token
    currency,
    prices,
    {
      // Фото должно быть картинкой
      photo_url: 'https://yakobel.github.io/minute-app-functions/media/donate.png',
      need_name: false,
      need_email: false,
      is_flexible: false,
    }
  );
}


// обработка нажатия кнопок доната
bot.on('callback_query', async (q) => {
  const data = q.data || '';
  const chatId = q.message?.chat?.id;
  if (!chatId) return;

  if (data.startsWith('donate:')) {
    const amount = Number(data.split(':')[1] || 0);
    if (amount > 0) {
      try {
        await bot.answerCallbackQuery(q.id);
        await sendStarsInvoice(chatId, amount);
      } catch (e) {
        console.error('donate invoice error:', e.message);
        try {
          await bot.answerCallbackQuery(q.id, {
            text: 'Ошибка. Попробуйте ещё раз',
            show_alert: true,
          });
        } catch {}
      }
    }
    return;
  }
});

// подтверждение предчекаута
bot.on('pre_checkout_query', async (query) => {
  try {
    await bot.answerPreCheckoutQuery(query.id, true);
  } catch (e) {
    console.error('pre_checkout error:', e.message);
    try {
      await bot.answerPreCheckoutQuery(query.id, false, 'Ошибка. Попробуйте позже.');
    } catch {}
  }
});

// успешная оплата (Stars)
bot.on('message', async (msg) => {
  const sp = msg.successful_payment;
  if (!sp) return;

  try {
    // 1️⃣ Отправляем благодарность пользователю
    await bot.sendMessage(msg.chat.id, '⭐️ Спасибо! Ваше пожертвование получено 🙏');

    // 2️⃣ Уведомление админу (если указан ADMIN_CHAT_ID в Environment)
    const adminId = Number(process.env.ADMIN_CHAT_ID || 0);
    if (adminId) {
      const text =
        `⭐ New Stars donation\n` +
        `From: ${msg.from?.id}\n` +
        `Amount: ${sp.total_amount} ${sp.currency}\n` +
        `Payload: ${sp.invoice_payload || '—'}`;
      try { await bot.sendMessage(adminId, text); } catch {}
    }

    // 3️⃣ (необязательно) Сохраняем запись о донате в Firestore
    try {
      await db.collection('donations').add({
        userId: String(msg.from?.id || ''),
        amount: sp.total_amount,
        currency: sp.currency,
        payload: sp.invoice_payload || null,
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.error('save donation error:', e.message);
    }

  } catch (e) {
    console.error('thanks error:', e.message);
  }
});




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
        await sendAndTrack(
          chatId, bot.sendMessage,
          [ on ? '🔔 Напоминания включены.\n' + buildNextWindowLine()
               : '🔕 Напоминания выключены.' ]
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

async function pushBotMessage(chatId, messageId) {
  const ref = db.collection('subs').doc(String(chatId));
  await db.runTransaction(async tr => {
    const snap = await tr.get(ref);
    const prev = snap.exists && Array.isArray(snap.data().lastMsgs) ? snap.data().lastMsgs : [];
    const next = [...prev, messageId];
    // оставить только 10 последних (видео + «след. окно» + клавиатура)
    const keep = next.slice(-10);
    tr.set(ref, { lastMsgs: keep }, { merge: true });

    // удалить всё, что старше
    const toDelete = next.slice(0, next.length - keep.length);
    for (const id of toDelete) {
      try { await bot.deleteMessage(chatId, id); } catch(_) {}
    }
  });
}

// Обёртка над sendMessage / sendAnimation / sendVideo для логирования
async function sendAndTrack(chatId, fn, argsObj) {
  const msg = await fn.call(bot, chatId, ...argsObj);
  if (msg?.message_id) { try { await pushBotMessage(chatId, msg.message_id); } catch(_) {} }
  return msg;
}



//// ——— рассылка напоминаний (каждые ~30 сек), включается TG_REMINDER_LOOP=1 ———
//if (bot && process.env.TG_REMINDER_LOOP === '1') {
//  console.log('⏰ TG reminders loop ON');
//  setInterval(async () => {
//    try {
//      const now   = new Date();
//      const next  = nextWindowUTC(now);
//      const diffMs  = next - now;
//      const diffMin = Math.floor(diffMs / 60000);
//      const diffSec = Math.floor(diffMs / 1000);
//
//      // интересуют 60 мин, 5 мин, и промежуток 30..0 секунд (включая 0)
//      const phase60  = (diffMin === 60);
//      const phase5   = (diffMin === 5);
//      const phase30s = (diffSec <= 30 && diffSec >= 0);
//
//      if (!phase60 && !phase5 && !phase30s) return;
//
//      const winKey = windowIso(next);
//      const subsSnap = await db.collection('subs').where('on', '==', true).get();
//      if (subsSnap.empty) return;
//
//      // тексты
//      const text60 = 'Через 60 минут начнётся окно (UTC).';
//      const text5  = 'Через 5 минут начнётся окно (UTC).';
//
//      const batch = db.batch();
//
//      for (const doc of subsSnap.docs) {
//        const s = doc.data() || {};
//        const chatId = String(doc.id);
//
//        if (phase60) {
//          if (s.last60 === winKey) continue;                // уже слали для этого окна
//          try { await bot.sendMessage(chatId, `${text60}\n` + buildNextWindowLine()); } catch {}
//          batch.set(doc.ref, { last60: winKey }, { merge: true });
//          continue;
//        }
//
//        if (phase5) {
//          if (s.last5 === winKey) continue;
//          try {
//            await bot.sendMessage(chatId, `${text5}\n` + buildNextWindowLine(), {
//              disable_web_page_preview: true,
//              reply_markup: { inline_keyboard: [[
//                { text: 'Открыть приложение', url: PUBLIC_BASE || 'https://minute-app-functions.onrender.com' }
//              ]] }
//            });
//          } catch {}
//          batch.set(doc.ref, { last5: winKey }, { merge: true });
//          continue;
//        }
//
//        // 30..0 сек — ПО ОДНОМУ РАЗУ НА ОКНО: запускаем мини-отсчёт
//        if (phase30s) {
//          if (s.last30 === winKey) continue;
//          try { await startThirtyCountdown(bot, chatId, next.getTime()); } catch {}
//          batch.set(doc.ref, { last30: winKey }, { merge: true });
//          continue;
//        }
//      }
//
//      await batch.commit();
//    } catch (e) {
//      console.error('reminders loop error:', e.message);
//    }
//  }, 30_000);
//}


// ——— рассылка напоминаний (оптимизировано, максимум 7 последних сообщений) ———
if (bot && process.env.TG_REMINDER_LOOP === '1') {
  console.log('⏰ TG reminders loop ON');

  const MAX_TELEGRAM_REMINDERS = 7;
  if (!global.sentMessages) global.sentMessages = [];

  async function safeSend(chatId, text, opts = {}) {
    try {
      const msg = await bot.sendMessage(chatId, text, {
        disable_web_page_preview: true,
        ...opts,
      });
      // хранить только последние N сообщений на пользователя
      global.sentMessages.push({ chatId, message_id: msg.message_id });
      const userMsgs = global.sentMessages.filter(m => m.chatId === chatId);
      if (userMsgs.length > MAX_TELEGRAM_REMINDERS) {
        const toDel = userMsgs.slice(0, userMsgs.length - MAX_TELEGRAM_REMINDERS);
        for (const m of toDel) {
          try { await bot.deleteMessage(m.chatId, m.message_id); } catch {}
        }
        global.sentMessages = global.sentMessages.filter(m => !toDel.includes(m));
      }
      return msg;
    } catch (e) {
      console.error('safeSend error:', e.message);
      return null;
    }
  }

  // ВЫНЕСЕНО: единая функция, которую можно дергать и вручную
  async function maybeFireReminders() {
    const now   = new Date();
    const next  = nextWindowUTC(now);
    const diffMs  = next - now;
    const diffMin = Math.floor(diffMs / 60000);
    const diffSec = Math.floor(diffMs / 1000);

    const phase60  = diffMin === 60;
    const phase5   = diffMin === 5;
    const phase30s = diffSec <= 30 && diffSec >= 0;

    if (!phase60 && !phase5 && !phase30s) return;

    const winKey = windowIso(next);
    const subsSnap = await db.collection('subs').where('on', '==', true).get();
    if (subsSnap.empty) return;

    const batch = db.batch();

    for (const doc of subsSnap.docs) {
      const s = doc.data() || {};
      const chatId = String(doc.id);

      // 60 минут
      if (phase60 && s.last60 !== winKey) {
        await safeSend(chatId, '⏰ Через 60 минут начнётся окно (UTC)');
        batch.set(doc.ref, { last60: winKey }, { merge: true });
        continue;
      }

      // 5 минут — ОТКРЫТЬ ВЕБ-ПРИЛОЖЕНИЕ как web_app (без голой ссылки)
      if (phase5 && s.last5 !== winKey) {
        await safeSend(chatId, '⏰ Через 5 минут начнётся окно (UTC)', {
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌍 Открыть приложение Time World',
                web_app: { url: PUBLIC_BASE || 'https://minute-app-functions.onrender.com' },
              },
            ]],
          },
        });
        batch.set(doc.ref, { last5: winKey }, { merge: true });
        continue;
      }

      // 30 секунд — запускаем мини-отсчёт (один раз на окно)
      if (phase30s && s.last30 !== winKey) {
        try { await startThirtyCountdown(bot, chatId, next.getTime()); } catch {}
        batch.set(doc.ref, { last30: winKey }, { merge: true });
        continue;
      }
    }

    await batch.commit();
  }

  // тикать ЧАЩЕ, чтобы не проскочить 30..0 секунд
  setInterval(() => {
    maybeFireReminders().catch(e =>
      console.error('reminders loop error:', e.message)
    );
  }, 5_000);

  // === Админ-эндпойнт для ручного запуска цикла (тест из браузера/DevTools) ===
  app.post('/api/admin/maybe-fire', requireKey, async (_req, res) => {
    try {
      await maybeFireReminders();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
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

// === KeepAlive для Render (не давать уснуть) ===
if (process.env.KEEPALIVE === '1') {
  const base = (PUBLIC_BASE || '').replace(/\/+$/, '');
  console.log('🟢 KEEPALIVE активен: каждые 14 минут', base || '(локально)');
  const doPing = () => {
    const targets = [
      '/healthz',
      base ? `${base}/healthz` : null,
    ].filter(Boolean);
    targets.forEach(u => {
      fetch(u).then(()=>console.log('🕐 keepalive OK →', u))
              .catch(()=>console.warn('⚠️ keepalive FAIL →', u));
    });
  };
  setInterval(doPing, 14 * 60 * 1000);
  doPing();
}


// ---------- Запуск ----------
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  if (WEBHOOK_URL) console.log(`🔔 Webhook слушается на ${WEBHOOK_URL}`);
});
