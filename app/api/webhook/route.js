import { Telegraf } from 'telegraf';
import { NextResponse } from 'next/server';

const bot = new Telegraf(process.env.BOT_TOKEN);

// ======================================================
// Allowed link domains (optional)
// Example:
// ALLOWED_LINK_DOMAINS=apexnetwork.com,telegram.org
// ======================================================

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

// ======================================================
// Check if a message contains a link
// ======================================================

function containsLink(message) {
    const text = message?.text || message?.caption || '';

    const entities = [
        ...(message?.entities || []),
        ...(message?.caption_entities || [])
    ];

    // Visible links
    if (/(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i.test(text)) {
        return true;
    }

    // Telegram clickable URL entities
    return entities.some(
        (entity) =>
            entity.type === 'url' ||
            entity.type === 'text_link'
    );
}

// ======================================================
// Check if links are allowed
// ======================================================

function isAllowedLink(message) {
    // If no whitelist is configured,
    // all links from normal members are blocked.
    if (allowedLinkDomains.length === 0) {
        return false;
    }

    const text = message?.text || message?.caption || '';

    const urls =
        text.match(/(?:https?:\/\/|www\.)[^\s]+/gi) || [];

    const entities = [
        ...(message?.entities || []),
        ...(message?.caption_entities || [])
    ];

    const entityUrls = entities
        .filter((entity) => entity.type === 'text_link')
        .map((entity) => entity.url)
        .filter(Boolean);

    const allUrls = [...urls, ...entityUrls];

    if (allUrls.length === 0) {
        return false;
    }

    return allUrls.every((rawUrl) => {
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

// ======================================================
// Check if user is an administrator or owner
// ======================================================

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

        // Fail-safe:
        // If Telegram cannot confirm the user's status,
        // do not delete the message.
        return true;
    }
}

// ======================================================
// Welcome new members
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

            return name || 'New member';
        });

        await ctx.reply(
            `👋 Welcome ${names.join(' and ')}!\n\n` +
            `Welcome to the Apex Network community 🚀\n` +
            `We’re glad to have you here. We hope you enjoy the community and find it useful.\n\n` +
            `📌 Please respect the community rules and do not post unauthorized links or advertisements.`
        );
    } catch (error) {
        console.error('Welcome message error:', error);
    }
});

// ======================================================
// Moderate links
// Only group and supergroup messages are moderated.
// Private bot messages are NOT affected.
// ======================================================

bot.on('message', async (ctx) => {
    try {
        const message = ctx.message;
        const chatType = ctx.chat?.type;

        // Only moderate groups and supergroups
        if (
            chatType !== 'group' &&
            chatType !== 'supergroup'
        ) {
            return;
        }

        // Ignore messages without links
        if (!containsLink(message)) {
            return;
        }

        // Administrators and owner are exempt
        if (await isAdmin(ctx)) {
            return;
        }

        // Allowed domains are exempt
        if (isAllowedLink(message)) {
            return;
        }

        // Delete unauthorized link message
        await ctx.deleteMessage();

        console.log(
            `Deleted unauthorized link message from user ${ctx.from?.id}`
        );
    } catch (error) {
        console.error('Moderation error:', error);
    }
});

// ======================================================
// /start - Original Apex Miner function
// ======================================================

bot.command('start', async (ctx) => {
    try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL;

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
// Health check
// ======================================================

export async function GET() {
    return NextResponse.json({
        ok: true,
        service: 'Apex Telegram Bot'
    });
}
