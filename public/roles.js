'use strict';
/* Rollar: nom, belgi, jamoa va tavsif (rol kartasi va qo'llanma uchun) */
const ROLE = {
  tinch: { n: 'Tinch aholi', e: '👨🏼', team: 'town', d: 'Sizning vazifangiz mafiyani topish va ovoz berish jarayonida ularni osish.' },
  don: { n: 'Don', e: '🤵🏻', team: 'mafia', d: 'Mafiya sardori! Bu tunda kim o‘lishini siz hal qilasiz.' },
  mafia: { n: 'Mafia', e: '🤵🏼', team: 'mafia', d: 'Donga bo‘ysunasiz va sizga qarshilik qilganlarni o‘ldirasiz. Don o‘lsa, siz yangi Don bo‘lishingiz mumkin.' },
  komissar: { n: 'Komissar Katani', e: '🕵️', team: 'town', d: 'Shaharning asosiy himoyachisi va mafiya qo‘shandasi. Har tunda bir kishini tekshirasiz yoki otasiz.' },
  serjant: { n: 'Serjant', e: '👮🏼‍♂️', team: 'town', d: 'Komissar Katanining yordamchisi. U sizni o‘zining ishlaridan xabardor qilib turadi. Komissar o‘lsa, uning o‘rnini siz egallaysiz.' },
  shifokor: { n: 'Shifokor', e: '👨🏼‍⚕️', team: 'town', d: 'Tunda kimnidir qutqarib qolishingiz mumkin (o‘zingizni ham).' },
  qotil: { n: 'Qotil', e: '🔪', team: 'qotil', d: 'Shahardagi hamma o‘lishi kerak, sizdan tashqari albatta :) Yolg‘iz o‘ynaysiz: har tunda bir kishini o‘ldirasiz.' },
  mashuqa: { n: 'Ma’shuqa', e: '💃🏼', team: 'town', d: 'Bu shafqatsiz shaharda tirik qolishingiz kerak. Bir kun davomida har qanday shaxsni zararsizlantiring: u tunda harakat qila olmaydi, kunduzi gapira va ovoz bera olmaydi.' },
  advokat: { n: 'Advokat', e: '👨🏼‍💼', team: 'mafia', d: 'Tunda kimni himoya qilishni tanlaysiz. Mafiyani tanlasangiz, Komissar uni taniy olmaydi va u tinch aholi bo‘lib ko‘rinadi. Siz mafiya tarafdasiz.' },
  suidsid: { n: 'Suidsid', e: '🤦🏼‍♂️', team: 'suidsid', d: 'Maqsadingiz — shahar sizni kunduzgi yig‘ilishda osishi. Lekin buni so‘ramang: tan olishga hech kim ishonmaydi. Shubhali tuting, lekin me’yorida — mafiya deb o‘ylashsin.' },
  daydi: { n: 'Daydi', e: '🧙🏼‍♂️', team: 'town', d: 'Xohlagan odamning uyiga shisha olgani borasiz va qotillikka guvoh bo‘lib qolishingiz mumkin.' },
  omadli: { n: 'Omadli', e: '🤞', team: 'town', d: 'Mafiya va yovuzlarni shahar yig‘ilishida osing. Tunda hujum bo‘lsa, omadingiz kelsa (50%) omon qolasiz.' },
  kamikaze: { n: 'Kamikaze', e: '💣', team: 'town', d: 'Tun va kunda siz tinch aholisiz, ammo sizni osishganda, xohlagan o‘yinchini o‘zingiz bilan qabrga olib ketishingiz mumkin.' },
  jurnalist: { n: 'Jurnalist', e: '📰', team: 'town', d: 'Tunda ikki fuqaroni tanlang: manbalaringiz ular bir qayiqdami yoki turli qayiqdami — shivirlab aytadi. Manbalar ism va rollarni aytmaydi.' },
  tansoqchi: { n: 'Tansoqchi', e: '🛡', team: 'town', d: 'Mijoz bilan o‘q orasida turish. Tunda kimni qo‘riqlashni tanlaysiz: unga hujum bo‘lsa, uning o‘rniga siz halok bo‘lasiz.' },
  mer: { n: 'Mer', e: '🏛', team: 'town', d: 'Ma’muriy ta’sirga ega oddiy aholi: kunduzgi ovoz berishda sizning ovozingiz ikki ovoz sifatida hisoblanadi.' },
};
const TEAM = { town: 'Shahar', mafia: 'Mafiya', qotil: 'Yakka (Qotil)', suidsid: 'Yakka (Suidsid)' };
const isMafiaRole = (r) => !!ROLE[r] && ROLE[r].team === 'mafia';
