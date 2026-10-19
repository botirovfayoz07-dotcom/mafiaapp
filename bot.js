'use strict';
const { Telegraf, Markup } = require('telegraf');

/** Botni ishga tushiradi. Bot faqat Mini App'ni ochadi; o'yinning o'zi ilova ichida. */
function startBot(token, webappUrl) {
  const bot = new Telegraf(token);

  bot.start((ctx) => {
    if (ctx.chat.type !== 'private') return;
    ctx.reply(
      '🕴 Mafia o‘yiniga xush kelibsiz!\n\nIlovani oching, xona yarating va do‘stlaringizni taklif qiling. Guruhda /game yozsangiz, guruh uchun xona ochiladi.',
      Markup.inlineKeyboard([[Markup.button.webApp('🎮 O‘ynash', webappUrl)]])
    );
  });

  bot.command('game', (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('Ilovani oching:', Markup.inlineKeyboard([[Markup.button.webApp('🎮 O‘ynash', webappUrl)]]));
    }
    // Guruh xonasi: chat id'dan barqaror kod
    const room = 'g' + String(ctx.chat.id).replace('-', 'm');
    const link = `https://t.me/${ctx.botInfo.username}?startapp=${room}`;
    ctx.reply(
      '🎲 Mafia xonasi ochiq!\nTugmani bosing — ilova shu guruh xonasiga kiradi. Kamida 4 kishi kerak.',
      Markup.inlineKeyboard([[Markup.button.url('🎮 O‘yinga kirish', link)]])
    );
  });

  bot.telegram
    .setChatMenuButton({ menuButton: { type: 'web_app', text: 'O‘ynash', web_app: { url: webappUrl } } })
    .catch(() => {});
  bot.launch().catch((e) => console.error('Bot xatosi:', e.message));
  return bot;
}

module.exports = { startBot };
