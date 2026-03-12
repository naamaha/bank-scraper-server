-- ── raw_transactions — כל התנועות שנשלפות מהבנק ────────────────────────────
create table if not exists raw_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users not null,
  bank         text not null,           -- leumi | mercantile | mizrahi | max | isracard
  account_num  text,
  identifier   text not null,           -- מזהה ייחודי למניעת כפילויות
  date         text not null,           -- ISO date
  description  text,
  amount       numeric not null,
  type         text not null,           -- debit | credit
  status       text default 'pending',  -- pending | auto_mapped | applied | ignored
  category     text,                    -- קטגוריה אחרי מיפוי
  raw          jsonb,                   -- כל השדות המקוריים מהבנק
  created_at   timestamptz default now(),
  unique(user_id, identifier)
);

alter table raw_transactions enable row level security;
create policy "Users see own raw transactions"
  on raw_transactions for all
  using (auth.uid() = user_id);

-- ── bank_credentials — פרטי התחברות לבנקים ──────────────────────────────────
create table if not exists bank_credentials (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  company     text not null,     -- leumi | mercantile | mizrahi | max | isracard
  label       text,              -- "לאומי עיקרי", "מקס אישי"...
  credentials jsonb not null,    -- { username, password, ... } — מוצפן בשכבת Supabase
  active      boolean default true,
  last_scraped_at timestamptz,
  created_at  timestamptz default now(),
  unique(user_id, company)
);

alter table bank_credentials enable row level security;
create policy "Users see own credentials"
  on bank_credentials for all
  using (auth.uid() = user_id);
