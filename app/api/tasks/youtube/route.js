// GitHub path: app/api/tasks/youtube/route.js
// Branch: cloudflare-migration
// New file: paste this entire content into route.js (not .txt in GitHub).

import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { validateTelegramInitData } from '../../../../lib/telegram-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

function validYouTubeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const parsed = new URL(raw.trim());
    if (
      parsed.protocol !== 'https:' ||
      !YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase()) ||
      parsed.username ||
      parsed.password
    ) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function youtubeLinks() {
  // Public links are read from Cloudflare Worker runtime variables.
  // Update DAILY_YOUTUBE_VIDEO_URL in Cloudflare whenever a new video is posted.
  return {
    channelUrl: validYouTubeUrl(env.YOUTUBE_CHANNEL_URL),
    videoUrl: validYouTubeUrl(env.DAILY_YOUTUBE_VIDEO_URL),
  };
}

function reply(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const initData = body?.initData;
    const action = body?.action;

    if (typeof initData !== 'string' || !initData) {
      return reply({ error: 'Telegram init data is required' }, 400);
    }

    // Reuse the application's existing, verified Telegram HMAC authentication.
    const telegram = validateTelegramInitData(initData);
    const telegramId = String(telegram.user.id);
    const links = youtubeLinks();

    if (action === 'status') {
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('youtube_subscribed, youtube_video_last_claim_date')
        .eq('telegram_id', telegramId)
        .maybeSingle();

      if (error) {
        console.error('YouTube status database error:', error.code);
        return reply({ error: 'Database error' }, 500);
      }
      if (!user) return reply({ error: 'User not found' }, 404);

      const today = utcDay();
      return reply({
        success: true,
        today,
        channelUrl: links.channelUrl,
        videoUrl: links.videoUrl,
        subscribed: Boolean(user.youtube_subscribed),
        videoDone: user.youtube_video_last_claim_date === today,
      });
    }

    if (action !== 'claim') {
      return reply({ error: 'Invalid action' }, 400);
    }

    const task = body?.task;
    if (task !== 'subscribe' && task !== 'video') {
      return reply({ error: 'Invalid task' }, 400);
    }

    if (task === 'subscribe' && !links.channelUrl) {
      return reply({ error: 'YouTube channel URL is not configured' }, 503);
    }
    if (task === 'video' && !links.videoUrl) {
      return reply({ error: 'Today’s YouTube video is not available' }, 503);
    }

    // Postgres handles the balance update and duplicate prevention atomically.
    const { data, error } = await supabaseAdmin.rpc(
      'apex_claim_youtube_task',
      { p_telegram_id: telegramId, p_task: task }
    );

    if (error) {
      console.error('YouTube reward RPC error:', error.code);
      return reply({ error: 'Database error' }, 500);
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) return reply({ error: 'Invalid reward response' }, 500);

    if (!result.success) {
      const already = result.error_code === 'ALREADY_CLAIMED';
      return reply({
        error: already ? 'Task already claimed' : 'YouTube task could not be completed',
        completed: already,
        balance: Number(result.balance ?? 0),
      }, already ? 409 : result.error_code === 'USER_NOT_FOUND' ? 404 : 400);
    }

    return reply({
      success: true,
      task,
      completed: true,
      reward: Number(result.reward ?? 0),
      balance: Number(result.balance ?? 0),
      today: utcDay(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const invalidAuth = /Telegram|Expired|BOT_TOKEN|signature|auth/i.test(message);
    if (!invalidAuth) console.error('YouTube task request error:', message);
    return reply({ error: invalidAuth ? 'Invalid Telegram authentication' : 'Internal server error' }, invalidAuth ? 401 : 500);
  }
}

