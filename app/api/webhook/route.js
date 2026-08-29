import { Telegraf } from 'telegraf';
import { NextResponse } from 'next/server';

// استدعاء التوكن من متغيرات البيئة
const bot = new Telegraf(process.env.BOT_TOKEN);

// الأمر /start
bot.command('start', (ctx) => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL; // رابط تطبيقك المصغر
    
    ctx.reply('Welcome to ApexMiner! 🚀\n\nStart mining APEX coins directly from Telegram. Click below to open your mining dashboard.', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Start Mining ⛏️', web_app: { url: appUrl } }]
            ]
        }
    });
});

// دالة استقبال الطلبات (POST) من تليجرام عبر Webhook
export async function POST(req) {
    try {
        const body = await req.json();
        await bot.handleUpdate(body);
        return NextResponse.json({ message: 'Success' }, { status: 200 });
    } catch (error) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
    }
}
