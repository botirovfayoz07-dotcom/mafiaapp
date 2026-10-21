# Mafia — Telegram Mini App

Butun o'yin Telegram ichidagi Mini App'da: xona, chat, ovozli chat. Bot faqat ilovani ochadi.

## Qoidalar (soddalashtirilgan)
- Rollar: Mafiya, Komissar, Shifokor (5+ o'yinchida), Fuqaro. Kamida 4, ko'pi bilan 12 o'yinchi.
- Tun: mafiya o'ldiradi, shifokor qutqaradi, komissar tekshiradi. Kunduz: muhokama, ovoz berish, osilganning so'nggi so'zi.
- O'yin davomida ilovadan chiqqan (yopgan, fonga o'tgan, aloqasi 8 soniyadan ortiq uzilgan) o'yinchining roli hammaga e'lon qilinadi va u shu o'yindan chiqariladi. Keyingi o'yinda yana qatnashadi.
- Chat: kunduz tirik o'yinchilar yozadi; tunda faqat mafiya o'zaro yozadi.
- Ovozli chat: kunduz tirik o'yinchilar gaplashadi; tunda va o'lganlar uchun mikrofon avtomatik o'chadi.

## Ishga tushirish
1. `npm install`
2. `.env.example` ni `.env` ga nusxalab to'ldiring.
3. `npm start`

Server HTTPS manzilda bo'lishi shart (Render, Railway, VPS + Nginx/Caddy). Ovozli chat uchun ham HTTPS kerak.

## @BotFather sozlamalari
1. `/newbot` — token oling.
2. `/mybots` → botingiz → **Bot Settings → Configure Mini App** → URL sifatida `WEBAPP_URL` ni kiriting. Guruhdagi "O'yinga kirish" havolasi (`t.me/bot?startapp=...`) shu sozlamaga tayanadi.
3. Botni guruhga qo'shing va `/game` yozing: bot tugma yuboradi, hamma shu tugma orqali bitta xonaga kiradi.

## Kompyuterda sinash
`DEV=1` qo'yib `npm start`, so'ng turli brauzer oynalarida `http://localhost:3000/?dev=Ali`, `?dev=Vali`, ... oching (4 ta oyna).

## Cheklovlar
- Ovozli chat har kim-har kim bilan ulanadi (mesh), 12 kishigacha yetarli. Ba'zi tarmoqlarda TURN server kerak bo'ladi (`.env` dagi TURN_*).
- Mikrofon o'chirilishi mijoz tomonida bajariladi: dasturni o'zgartirgan o'yinchi tunda ham gapira olishi mumkin.
- Telegram versiyasiga qarab mikrofonga ruxsat so'rovi turlicha ishlaydi; ruxsat berilmasa, Telegram sozlamalaridan yoqing.
- Statistika (g'alaba/o'yin) faqat `MONGO_URI` berilsa saqlanadi.

---

## Yangiliklar

**Profil** (bosh sahifada ism/balans tugmasi): statistika, hisob, do'kon (🛡 Himoya qalqoni, 📄 Soxta hujjat), o'yinlar tarixi, hisob tarixi va barcha rollar qo'llanmasi. Narsani sotib olgach, "Ishlatish"ni yoqing — keyingi o'yin boshida sarflanadi.

**Admin panel**: `.env` da `ADMIN_IDS=123,456` bering. Admin foydalanuvchini ism/ID bo'yicha topadi, balansiga tanga qo'shadi/ayiradi (izoh bilan), narsa sovg'a qiladi, bloklaydi. Foydalanuvchiga darhol bildirishnoma boradi. Barcha amallar serverda qayta tekshiriladi. DEV rejimida (`DEV=1`) `?dev=Admin` bilan kirgan ham admin bo'ladi.

**Ma'lumotlar**: `MONGO_URI` bo'lmasa `data/users.json` ga yoziladi (Render/Railway'da doimiy disk ulang yoki MongoDB ishlating).

**Ko'rinadigan natijalar**: ertalab "tun natijasi" kartochkasi (kim o'ldi, roli, qutqarilganlar), ovoz berishda har bir o'yinchi ostida kim ovoz bergani chiplar bilan, ovozdan keyin ovoz jadvali (chiziqli diagramma). Hammasi chatda ham saqlanadi.

**Kun/tun animatsiyalari**: SVG+CSS sahnalar (oy, yulduzlar, derazalar, kunduz — quyosh, bulut, qush; ovoz — adolat tarozisi). Haqiqiy GIF xohlasangiz `public/gif/night.gif`, `day.gif`, `vote.gif`, `lobby.gif` nomi bilan qo'ying — avtomatik ustiga chiqadi.

## Rollar (16 ta)
Tinch aholi, Don, Mafia, Komissar Katani (tekshirish yoki otish), Serjant, Shifokor, Qotil, Ma'shuqa, Advokat, Suidsid, Daydi, Omadli, Kamikaze, Jurnalist, Tansoqchi, Mer. Rollar soni o'yinchilar soniga qarab tanlanadi (`buildRoles` — game.js); hammasi chiqishi uchun 20 kishi kerak. Omadli omon qolish ehtimoli `LUCK`, vaqtlar `T` konstantalarida.
