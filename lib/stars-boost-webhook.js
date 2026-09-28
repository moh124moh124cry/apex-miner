import {
  APXN_STARS_BOOST_PRICE,
  APXN_STARS_BOOST_DURATION_HOURS,
  APXN_STARS_BOOST_REWARD_LABEL,
  validateStarsBoostPreCheckout,
  activateStarsBoostFromSuccessfulPayment,
} from './stars-boost';

export function registerStarsBoostPaymentHandlers(bot) {
  // Telegram requires pre-checkout queries to be answered quickly.
  bot.on('pre_checkout_query', async (ctx) => {
    try {
      const query =
        ctx.update?.pre_checkout_query;

      const validation =
        validateStarsBoostPreCheckout(
          query
        );

      if (!validation.valid) {
        await ctx.telegram.callApi(
          'answerPreCheckoutQuery',
          {
            pre_checkout_query_id:
              query.id,
            ok: false,
            error_message:
              validation.error,
          }
        );

        return;
      }

      await ctx.telegram.callApi(
        'answerPreCheckoutQuery',
        {
          pre_checkout_query_id:
            query.id,
          ok: true,
        }
      );
    } catch (error) {
      console.error(
        'Stars boost pre-checkout error:',
        error instanceof Error
          ? error.message
          : 'Unknown error'
      );

      try {
        const query =
          ctx.update?.pre_checkout_query;

        if (query?.id) {
          await ctx.telegram.callApi(
            'answerPreCheckoutQuery',
            {
              pre_checkout_query_id:
                query.id,
              ok: false,
              error_message:
                'Payment verification failed. Please try again.',
            }
          );
        }
      } catch {
        // Telegram may already have closed the pre-checkout query.
      }
    }
  });

  // Handle successful Telegram Stars payments before the normal
  // group-moderation message handler.
  bot.on(
    'message',
    async (ctx, next) => {
      const successfulPayment =
        ctx.message?.successful_payment;

      if (!successfulPayment) {
        return next();
      }

      const payload = String(
        successfulPayment.invoice_payload ||
          ''
      );

      // Ignore unrelated payments if other digital products
      // are added to the bot in the future.
      if (
        !payload.startsWith(
          'apxn48:'
        )
      ) {
        return next();
      }

      try {
        const result =
          await activateStarsBoostFromSuccessfulPayment(
            {
              from: ctx.from,
              successfulPayment,
            }
          );

        await ctx.reply(
          '✅ APXN 48H Mining Boost activated!\n\n' +
            `⭐ Paid: ${APXN_STARS_BOOST_PRICE} Telegram Stars\n` +
            `⏱ Duration: ${APXN_STARS_BOOST_DURATION_HOURS} hours\n` +
            `⛏ Reward: ${APXN_STARS_BOOST_REWARD_LABEL}\n\n` +
            'Your 10,000 APXN POINTS are mined progressively during the 48-hour boost. ' +
            'Free mining and ad mining remain active.'
        );

        console.log(
          JSON.stringify({
            tag:
              'APXN_STARS_BOOST_ACTIVATED',
            telegramId:
              result.telegramId,
            stars:
              result.stars,
            rewardPoints:
              result.rewardPoints,
            durationHours:
              result.durationHours,
          })
        );
      } catch (error) {
        console.error(
          'Stars boost successful payment activation error:',
          error instanceof Error
            ? error.message
            : 'Unknown error'
        );

        // Do not claim success if database activation failed.
        // The Telegram payment itself is already final at this point,
        // so the charge ID remains available for safe recovery.
        await ctx.reply(
          '⚠️ Your Telegram Stars payment was received, but the mining boost could not be activated automatically. Please contact APXN support.'
        );
      }
    }
  );
}

