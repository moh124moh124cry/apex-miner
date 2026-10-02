import handler from 'vinext/server/fetch-handler';
import { processTelegramNotifications } from '../lib/telegram-notifications.js';

export default {
  async fetch(request, env, ctx) {
    return handler.fetch(request, env, ctx);
  },

  async scheduled() {
    await processTelegramNotifications();
  },
};

