import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createScraper, CompanyTypes } from "israeli-bank-scrapers";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// ── אימות בקשות ──────────────────────────────────────────────────────────────
const AUTH_TOKEN = process.env.SCRAPER_SECRET;
const auth = (req, res, next) => {
  if (req.headers["x-scraper-secret"] !== AUTH_TOKEN)
    return res.status(401).json({ error: "Unauthorized" });
  next();
};

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key — לא anon
);

// ── מיפוי שמות בנקים ל-CompanyTypes ─────────────────────────────────────────
const COMPANY_MAP = {
  leumi:      CompanyTypes.leumi,
  mercantile: CompanyTypes.mercantile,
  mizrahi:    CompanyTypes.mizrahi,
  max:        CompanyTypes.max,
  isracard:   CompanyTypes.isracard,
};

// ── פונקציית שליפה ─────────────────────────────────────────────────────────
async function scrapeBank({ company, credentials, startDate }) {
  const scraper = createScraper({
    companyId: COMPANY_MAP[company],
    startDate: new Date(startDate),
    combineInstallments: false,
    showBrowser: false,           // headless
  });

  const result = await scraper.scrape(credentials);

  if (!result.success) {
    throw new Error(result.errorType + ": " + (result.errorMessage || ""));
  }

  // אחד חשבון (או כמה) → מאגד את כל התנועות
  const txs = [];
  for (const account of result.accounts) {
    for (const tx of account.txns) {
      txs.push({
        bank:        company,
        account_num: account.accountNumber,
        identifier:  tx.identifier || `${company}_${tx.date}_${tx.chargedAmount}_${tx.description}`,
        date:        tx.date,          // ISO string
        description: tx.description,
        amount:      Math.abs(tx.chargedAmount),
        type:        tx.chargedAmount < 0 ? "debit" : "credit",
        raw:         tx,               // כל השדות המקוריים
      });
    }
  }
  return txs;
}

// ── שמירה ב-Supabase (ללא כפילויות) ─────────────────────────────────────────
async function saveTxs(userId, txs) {
  if (!txs.length) return { inserted: 0, skipped: 0 };

  // בדוק אילו identifiers כבר קיימים
  const ids = txs.map(t => t.identifier);
  const { data: existing } = await supabase
    .from("raw_transactions")
    .select("identifier")
    .eq("user_id", userId)
    .in("identifier", ids);

  const existingSet = new Set((existing || []).map(r => r.identifier));
  const toInsert = txs
    .filter(t => !existingSet.has(t.identifier))
    .map(t => ({
      user_id:     userId,
      bank:        t.bank,
      account_num: t.account_num,
      identifier:  t.identifier,
      date:        t.date,
      description: t.description,
      amount:      t.amount,
      type:        t.type,
      status:      "pending",
      raw:         t.raw,
    }));

  if (toInsert.length) {
    const { error } = await supabase.from("raw_transactions").insert(toInsert);
    if (error) throw new Error("Supabase insert error: " + error.message);
  }

  return { inserted: toInsert.length, skipped: txs.length - toInsert.length };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// בריאות
app.get("/health", (_, res) => res.json({ ok: true }));

// שליפה מבנק אחד
// POST /scrape  { userId, company, credentials: {...}, startDate }
app.post("/scrape", auth, async (req, res) => {
  const { userId, company, credentials, startDate } = req.body;

  if (!COMPANY_MAP[company])
    return res.status(400).json({ error: `Unknown company: ${company}` });

  try {
    console.log(`[scrape] ${company} for user ${userId}`);
    const txs = await scrapeBank({ company, credentials, startDate });
    const { inserted, skipped } = await saveTxs(userId, txs);
    console.log(`[scrape] done — inserted ${inserted}, skipped ${skipped}`);
    res.json({ ok: true, company, total: txs.length, inserted, skipped });
  } catch (err) {
    console.error(`[scrape] error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// שליפה מכל הבנקים של משתמש (קורא את הקרדנציאלים מ-Supabase)
// POST /scrape-all  { userId }
app.post("/scrape-all", auth, async (req, res) => {
  const { userId } = req.body;

  // שלוף קרדנציאלים מוצפנים מ-Supabase
  const { data: bankCreds, error } = await supabase
    .from("bank_credentials")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true);

  if (error) return res.status(500).json({ error: error.message });
  if (!bankCreds?.length) return res.json({ ok: true, results: [], message: "No banks configured" });

  // תאריך התחלה — חודש אחורה
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);

  const results = [];
  for (const cred of bankCreds) {
    try {
      const txs = await scrapeBank({
        company:     cred.company,
        credentials: cred.credentials,  // { username, password, ... }
        startDate:   startDate.toISOString(),
      });
      const stats = await saveTxs(userId, txs);
      results.push({ company: cred.company, ...stats, ok: true });
    } catch (err) {
      results.push({ company: cred.company, ok: false, error: err.message });
    }
  }

  res.json({ ok: true, results });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Bank scraper server running on port ${PORT}`));
