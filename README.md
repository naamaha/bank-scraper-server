# Bank Scraper Server

## Deploy על Railway — שלב אחר שלב

### 1. Supabase — הרץ את ה-SQL
פתחי Supabase → SQL Editor → הדבקי את `supabase_migration.sql` → Run.

### 2. GitHub — צרי repo חדש
```bash
git init
git add .
git commit -m "bank scraper server"
git remote add origin https://github.com/YOUR_USERNAME/bank-scraper.git
git push -u origin main
```

### 3. Railway — חיבור
1. כנסי ל-railway.app → New Project → Deploy from GitHub
2. בחרי את ה-repo שיצרת
3. ב-Variables הוסיפי:
   - `SCRAPER_SECRET` — סיסמא ארוכה שתמציאי (לדוגמה: `kh8f2mNpQ7...`)
   - `SUPABASE_URL` — מ-Supabase → Settings → API
   - `SUPABASE_SERVICE_KEY` — Service Role Key (לא anon!)
4. Deploy — תוך 2 דקות השרת עולה

### 4. קבלי את ה-URL של השרת
Railway יתן לך URL כמו: `https://bank-scraper-production.up.railway.app`
שמרי אותו — נזין אותו לאפליקציה.

## API

### בדיקה
```
GET /health
```

### שליפה מבנק אחד (בדיקה ידנית)
```json
POST /scrape
x-scraper-secret: YOUR_SECRET

{
  "userId": "uuid-of-user",
  "company": "leumi",
  "credentials": {
    "username": "123456789",
    "password": "mypassword"
  },
  "startDate": "2026-02-01"
}
```

### שליפה מכל הבנקים (זה מה שהאפליקציה קוראת)
```json
POST /scrape-all
x-scraper-secret: YOUR_SECRET

{
  "userId": "uuid-of-user"
}
```

## שדות credentials לפי בנק

| בנק | שדות |
|-----|------|
| leumi | `username`, `password` |
| mercantile | `username`, `password` |
| mizrahi | `username`, `password` |
| max | `username`, `password` |
| isracard | `id` (ת.ז.), `password`, `num6Digits` |
