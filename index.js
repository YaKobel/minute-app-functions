
const functionsV1 = require('firebase-functions/v1'); // Gen1 для Spark
const functions = require('firebase-functions');      // для config и типов
const admin = require("firebase-admin");
const express = require("express");
const crypto = require("crypto");
const qs = require("qs");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const ANCHORS_UTC = [0, 8, 16];

function activeSessionIdNow(now = new Date()) {
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  if (m !== 0) return null;
  if (!ANCHORS_UTC.includes(h)) return null;
  return now.toISOString().slice(0, 13).replace(/[-:T]/g, "");
}

function previousSessionId(now = new Date()) {
  const prev = new Date(now.getTime() - 8 * 3600 * 1000);
  prev.setUTCMinutes(0, 0, 0, 0);
  return prev.toISOString().slice(0, 13).replace(/[-:T]/g, "");
}

function validateTelegramInitData(initData, botToken) {
  if (!initData) throw new Error("No initData");
  const urlData = qs.parse(initData);
  const hash = urlData.hash;
  delete urlData.hash;

  const sorted = Object.keys(urlData)
    .sort()
    .map((k) => `${k}=${urlData[k]}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const check = crypto.createHmac("sha256", secret).update(sorted).digest("hex");
  if (check !== hash) throw new Error("Bad Telegram signature");
  const user = JSON.parse(urlData.user);
  if (!user || !user.id) throw new Error("No tg user");
  return user;
}

// STATUS
app.get("/status", async (req, res) => {
  const now = new Date();
  const activeId = activeSessionIdNow(now);
  const prevId = previousSessionId(now);
  const prevDoc = await db.collection("sessions").doc(prevId).get();

  res.json({
    nowUtc: now.toISOString(),
    active: Boolean(activeId),
    activeSessionId: activeId,
    prevSessionId: prevId,
    prevCount: prevDoc.exists ? prevDoc.data().total || 0 : 0,
    anchorsUTC: ANCHORS_UTC,
  });
});

// PARTICIPATE
app.post("/participate", async (req, res) => {
  try {
    const { initData, category, profile } = req.body || {};
    if (!initData || !category) return res.status(400).json({ error: "initData & category required" });

    const tgUser = validateTelegramInitData(initData, functions.config().telegram.token);
    const uid = String(tgUser.id);

    const now = new Date();
    const sessionId = activeSessionIdNow(now);
    if (!sessionId) return res.status(409).json({ error: "window_closed" });

    const partId = `${sessionId}_${uid}`;
    const partRef = db.collection("participations").doc(partId);
    const sessionRef = db.collection("sessions").doc(sessionId);
    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async (tx) => {
      const already = await tx.get(partRef);
      if (already.exists) return;

      const userDoc = await tx.get(userRef);
      const snapshot = userDoc.exists ? userDoc.data() : (profile || {});

      tx.set(partRef, {
        uid,
        sessionId,
        category,
        ts: admin.firestore.Timestamp.fromDate(now),
        snapshot,
      });

      const base = (await tx.get(sessionRef)).data() || { total: 0, byCategory: {} };
      base.total = (base.total || 0) + 1;
      base.byCategory[category] = (base.byCategory[category] || 0) + 1;

      tx.set(sessionRef, {
        windowStartUTC: now.toISOString().slice(0, 16) + ":00",
        ...base,
      }, { merge: true });
    });

    res.json({ ok: true, sessionId });
  } catch (e) {
    console.error(e);
    res.status(401).json({ error: "auth_failed" });
  }
});

// STATS
app.get("/stats", async (req, res) => {
  const period = (req.query.period || "day").toString();
  const now = new Date();
  const start = new Date(now);
  if (period === "day") start.setUTCHours(0, 0, 0, 0);
  else if (period === "week") {
    const d = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - d);
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === "month") {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
  }

  const snap = await db
    .collection("sessions")
    .where("windowStartUTC", ">=", start.toISOString())
    .get();

  let total = 0;
  const byCategory = {};
  snap.forEach((doc) => {
    const data = doc.data();
    total += data.total || 0;
    Object.entries(data.byCategory || {}).forEach(([k, v]) => {
      byCategory[k] = (byCategory[k] || 0) + v;
    });
  });

  res.json({ period, start: start.toISOString(), total, byCategory });
});

// PROFILE
app.post("/profile/save", async (req, res) => {
  try {
    const user = validateTelegramInitData(req.body.initData, functions.config().telegram.token);
    const uid = String(user.id);
    const data = {
      country: req.body.country || null,
      city: req.body.city || null,
      age: req.body.age ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection("users").doc(uid).set(data, { merge: true });
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: "auth_failed" });
  }
});

app.get("/profile/me", async (req, res) => {
  try {
    const user = validateTelegramInitData(req.query.initData, functions.config().telegram.token);
    const doc = await db.collection("users").doc(String(user.id)).get();
    res.json({ ok: true, profile: doc.exists ? doc.data() : null });
  } catch {
    res.status(401).json({ error: "auth_failed" });
  }
});

// EXPORT (Gen1)
exports.api = functionsV1.region("europe-west1").https.onRequest(app);
