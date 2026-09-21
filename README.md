# 🤖 Telegram AI Bot

Telegraf + SQLite asosidagi AI chatbot. Private chatda ham, guruhda ham ishlaydi.

## Imkoniyatlar
- `/start` menyu: `🤖 AI`, `ℹ️ Help`
- `🤖 AI` tugmasi: AI rejimi, oddiy matn bilan savol, suhbat konteksti
- `❌ Chiqish`: AI rejimidan chiqish
- Guruhda faqat `AI ...` yoki `/ai ...` xabarlariga javob beradi
- Admin panel: Users, Groups, Statistics, Broadcast, Add Group, Settings
- SQLite baza: users, groups, suhbat tarixi, sozlamalar

## Buyruqlar
- `/start`, `/help`, `/ai`, `/id`, `/clear` (hamma)
- `/admin`, `/addgroup`, `/stats` (faqat admin)

## Ishga tushirish
```bash
npm install
cp .env.example .env   # va .env ni to‘ldiring
npm start
```

## Guruhda ishlatish
1. `/addgroup` yozing va havola orqali botni guruhga qo‘shing.
2. @BotFather → /mybots → botingiz → Bot Settings → Group Privacy → Turn off.
3. Botni guruhdan chiqarib qayta qo‘shing.
4. Guruhda: `AI Python nima?` yoki `/ai Python nima?`

## Doimiy ishlatish
```bash
npm install -g pm2
pm2 start index.js --name ai-bot
pm2 save
```
