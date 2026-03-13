import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createScraper, CompanyTypes } from "israeli-bank-scrapers";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-scraper-secret");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json());

const AUTH_TOKEN = process.env.SCRAPER_SECRET;
const auth = (req, res, next) => {
  if (req.headers["x-scraper-secret"] !== AUTH_TOKEN)
    return res.status(401).json({ error: "Unauthorized" });
  next();
};

// ── Supabase עם JWT של המשתמש — לא Service Role ──────────────────────────────
const makeSupabase = (userJwt) => {
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY   // anon בלבד
  );
  client.auth.setSession({ access_token: userJwt, refresh_token: "" });
  return client;
};

const COMPANY_MAP = {
  leumi:      CompanyTypes.leumi,
  mercantile: CompanyTypes.mercantile,
  mizrahi:    CompanyTypes.mizrahi,
  max:        CompanyTypes.max,
  isracard:   CompanyTypes.isracard,
};

async function scrapeBank({ company, credentials, startDate }) {
  const scraper = createScraper({
    companyId:           COMPANY_MAP[company],
    startDate:           new Date(startDate),
    combineInstallments: false,
    showBrowser:         false,
  });
  const result = await scraper.scrape(credentials);
  if (!result.success)
    throw new Error(result.errorType + ": " + (result.errorMessage || ""));

  const txs = [];
  for (const account of result.accounts) {
    for (const tx of account.txns) {
      txs.push({
        bank:        company,
        account_num: account.accountNumber,
        identifier:  tx.identifier ||
                     `${company}_${tx.date}_${tx.chargedAmount}_${tx.description}`,
        date:        tx.date,
        description: tx.description,
        amount:      Math.abs(tx.chargedAmount),
        type:        tx.chargedAmount < 0 ? "debit" : "credit",
        raw:         tx,
      });
    }
  }
  return txs;
}

async function saveTxs(supabase, userId, txs) {
  if (!txs.length) return { inserted: 0, skipped: 0 };
  const ids = txs.map(t => t.identifier);
  const { data: existing } = await supabase
    .from("raw_transactions").select("identifier")
    .eq("user_id", userId).in("identifier", ids);

  const existingSet = new Set((existing || []).map(r => r.identifier));
  const toInsert = txs
    .filter(t => !existingSet.has(t.identifier))
    .map(t => ({ user_id: userId, ...t, status: "pending" }));

  if (toInsert.length) {
    const { error } = await supabase.from("raw_transactions").insert(toInsert);
    if (error) throw new Error("Supabase insert: " + error.message);
  }
  return { inserted: toInsert.length, skipped: txs.length - toInsert.length };
}

app.get("/health", (_, res) => res.json({ ok: true }));

// שליפה מבנק אחד — לבדיקה ידנית
app.post("/scrape", auth, async (req, res) => {
  const { userId, userJwt, company, credentials, startDate } = req.body;
  if (!userJwt) return res.status(401).json({ error: "Missing userJwt" });
  if (!COMPANY_MAP[company]) return res.status(400).json({ error: `Unknown: ${company}` });

  try {
    const supabase = makeSupabase(userJwt);
    const txs  = await scrapeBank({ company, credentials, startDate });
    const stats = await saveTxs(supabase, userId, txs);
    res.json({ ok: true, company, total: txs.length, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// שליפה מכל הבנקים — זה מה שהאפליקציה קוראת
app.post("/scrape-all", auth, async (req, res) => {
  const { userId, userJwt } = req.body;
  if (!userJwt) return res.status(401).json({ error: "Missing userJwt" });

  const supabase = makeSupabase(userJwt);
  const { data: bankCreds, error } = await supabase
    .from("bank_credentials").select("*")
    .eq("user_id", userId).eq("active", true);

  if (error) return res.status(500).json({ error: error.message });
  if (!bankCreds?.length) return res.json({ ok: true, results: [], message: "No banks configured" });

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);

  const results = [];
  for (const cred of bankCreds) {
    try {
      const txs   = await scrapeBank({ company: cred.company, credentials: cred.credentials, startDate: startDate.toISOString() });
      const stats = await saveTxs(supabase, userId, txs);
      await supabase.from("bank_credentials").update({ last_scraped_at: new Date().toISOString() }).eq("id", cred.id);
      results.push({ company: cred.company, ok: true, ...stats });
    } catch (err) {
      results.push({ company: cred.company, ok: false, error: err.message });
    }
  }
  res.json({ ok: true, results });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Bank scraper running on port ${PORT}`));