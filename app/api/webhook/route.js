import { Telegraf } from 'telegraf';
import { NextResponse } from 'next/server';

const bot = new Telegraf(process.env.BOT_TOKEN);

// الروابط المسموح بها اختيارية عبر متغير البيئة ALLOWED_LINK_DOMAINS
const allowedLinkDomains = (process.env.ALLOWED_LINK_DOMAINS || '')
    .split(',')
    .map((domain) =>
        domain
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/\/$/, '')
    )
    .filter(Boolean);

// فحص وجود رابط
function containsLink(text = '') {
    return /(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i.test(text);
}

// التحقق من أن الرابط مسموح
function isAllowedLink(text = '') {
    if (allowedLinkDomains.length === 0) return false;

    const urls =
        text.match(/(?:https?:\/\/|www\.)[^\s]+/gi) || [];

    if (urls.length === 0) return false;

    return urls.every((rawUrl) => {
        try {
            const normalized = rawUrl.startsWith('http')
                ? rawUrl
                : `https://${rawUrl}`;

            const hostname = new URL(normalized)
                .hostname
                .toLowerCase()
                .replace(/^www\./, '');

            return allowedLinkDomains.some(
                (domain) =>
                    hostname === domain ||
                    hostname.endsWith(`.${domain}`)
            );
        } catch {
            return false;
        }
    });
}

// الحصول على النص أو وصف الصورة/الفيديو
function getMessageText(message) {
    return message?.text || message?.caption || '';
}

// التحقق من أن صاحب الرسالة مشرف أو مالك
async function isAdmin(ctx) {
    try {
        if (!ctx.chat?.id || !ctx.from?.id) {
            return false;
        }

        const member = await ctx.telegram.getChatMember(
            ctx.chat.id,
            ctx.from.id
        );

        return (
            member.status === 'creator' ||
            member.status === 'administrator'
        );
    } catch (error) {
        console.error('Admin check error:', error);

        // حماية من حذف رسالة إذا تعذر التحقق من صلاحية العضو
        return true;
    }
}

// ======================================================
// ترحيب بالأعضاء الجدد
// ======================================================

bot.on('new_chat_members', async (ctx) => {
    try {
        const members = ctx.message.new_chat_members || [];

        if (members.length === 0) {
            return;
        }

        const names = members.map((member) => {
            const name = [
                member.first_name,
                member.last_name
            ]
                .filter(Boolean)
                .join(' ');

            return name || 'عضو جديد';
        });

        await ctx.reply(
            `👋 مرحبًا ${names.join(' و')}!\n\n` +
            `أهلًا بكم في مجموعة Apex Network 🚀\n` +
            `نتمنى لكم مشاركة مفيدة وممتعة.\n\n` +
            `📌 يرجى احترام قوانين المجموعة وعدم نشر الروابط أو الإعلانات غير المسموح بها.`
        );
    } catch (error) {
        console.error('Welcome message error:', error);
    }
});

// ======================================================
// حذف الروابط من الأعضاء العاديين
// ======================================================

bot.on('message', async (ctx) => {
    try {
        const message = ctx.message;
        const text = getMessageText(message);

        // الرسائل العادية بدون روابط لا يتم لمسها
        if (!text || !containsLink(text)) {
            return;
        }

        // المشرفون والمالك مستثنون
        if (await isAdmin(ctx)) {
            return;
        }

        // إذا كان الرابط ضمن النطاقات المسموح بها
        if (isAllowedLink(text)) {
            return;
        }

        // حذف رسالة العضو العادي
        await ctx.deleteMessage();

        console.log(
            `Deleted link message from user ${ctx.from?.id}`
        );
    } catch (error) {
        console.error('Moderation error:', error);
    }
});

// ======================================================
// /start - وظيفة Apex Miner الأصلية
// ======================================================

bot.command('start', async (ctx) => {
    try {
        const appUrl =
            process.env.NEXT_PUBLIC_APP_URL;

        if (!appUrl) {
            await ctx.reply(
                'Welcome to ApexMiner! 🚀'
            );

            return;
        }

        await ctx.reply(
            'Welcome to ApexMiner! 🚀\n\n' +
            'Start mining APEX coins directly from Telegram. ' +
            'Click below to open your mining dashboard.',
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Start Mining ⛏️',
                                web_app: {
                                    url: appUrl
                                }
                            }
                        ]
                    ]
                }
            }
        );
    } catch (error) {
        console.error(
            'Start command error:',
            error
        );
    }
});

// ======================================================
// Telegram Webhook
// ======================================================

export async function POST(req) {
    try {
        const body = await req.json();

        await bot.handleUpdate(body);

        return NextResponse.json(
            {
                message: 'Success'
            },
            {
                status: 200
            }
        );
    } catch (error) {
        console.error(
            'Webhook Error:',
            error
        );

        return NextResponse.json(
            {
                error: 'Failed to process request'
            },
            {
                status: 500
            }
        );
    }
}

// ======================================================
// اختبار الاتصال
// ======================================================

export async function GET() {
    return NextResponse.json({
        ok: true,
        service: 'Apex Telegram Bot'
    });
}
