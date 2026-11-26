BEGIN;
-- Conditional points are tracked separately from normal rewards.
CREATE TABLE public.apxn_ambassadors (
  telegram_id text PRIMARY KEY REFERENCES public.users(telegram_id),
  active boolean NOT NULL DEFAULT false,
  reward_ever_granted boolean NOT NULL DEFAULT false,
  credited numeric NOT NULL DEFAULT 0 CHECK (credited >= 0),
  checked_at timestamptz,
  verified_until timestamptz
);
CREATE TABLE public.apxn_ambassador_periods (
  telegram_id text NOT NULL REFERENCES public.apxn_ambassadors(telegram_id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  PRIMARY KEY (telegram_id, starts_at)
);
ALTER TABLE public.apxn_ambassadors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apxn_ambassador_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apxn_ambassadors, public.apxn_ambassador_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apxn_ambassadors, public.apxn_ambassador_periods TO service_role;

-- Authenticated server calls only. Null means read status; false means
-- Telegram returned a successful private-chat response without the APXN tag.
CREATE FUNCTION public.apxn_ambassador_sync(p_id text, p_matches boolean DEFAULT NULL,
  p_observed_at timestamptz DEFAULT NULL, p_activate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  a public.apxn_ambassadors%ROWTYPE;
  u public.users%ROWTYPE;
  t timestamptz := clock_timestamp();
  changed boolean := false;
  cutoff timestamptz;
  periods jsonb;
BEGIN
  SELECT * INTO u FROM public.users WHERE telegram_id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  SELECT * INTO a FROM public.apxn_ambassadors WHERE telegram_id = p_id;
  IF p_matches IS NOT NULL THEN
    IF p_observed_at IS NULL OR p_observed_at < t - interval '2 minutes'
       OR p_observed_at > t + interval '5 seconds' THEN
      RAISE EXCEPTION 'STALE_OBSERVATION';
    END IF;
    IF a.checked_at IS NULL OR p_observed_at > a.checked_at THEN
      IF p_matches AND (coalesce(a.active,false) OR p_activate) THEN
        IF a.telegram_id IS NULL THEN
          INSERT INTO public.apxn_ambassadors(telegram_id) VALUES (p_id) RETURNING * INTO a;
        END IF;
        IF NOT a.reward_ever_granted THEN
          UPDATE public.users SET balance = coalesce(balance,0)+5000 WHERE telegram_id=p_id RETURNING * INTO u;
          a.credited := a.credited + 5000;
          a.reward_ever_granted := true;
          changed := true;
        END IF;
        cutoff := p_observed_at + interval '24 hours';
        IF a.active AND a.verified_until >= p_observed_at THEN
          UPDATE public.apxn_ambassador_periods SET ends_at=cutoff
            WHERE telegram_id=p_id AND ends_at=a.verified_until;
          IF NOT FOUND THEN RAISE EXCEPTION 'PERIOD_MISSING'; END IF;
        ELSE
          INSERT INTO public.apxn_ambassador_periods VALUES(p_id,p_observed_at,cutoff);
        END IF;
        a.active := true;
        a.verified_until := cutoff;
      ELSIF NOT p_matches AND coalesce(a.active,false) THEN
        -- Revoke exactly the credited Ambassador amount; other rewards stay intact.
        -- Abort rather than take unrelated points if an external debit spent the conditional amount.
        IF coalesce(u.balance,0) < a.credited THEN RAISE EXCEPTION 'AMBASSADOR_BALANCE_REVIEW'; END IF;
        UPDATE public.users SET balance=balance-a.credited WHERE telegram_id=p_id RETURNING * INTO u;
        DELETE FROM public.apxn_ambassador_periods WHERE telegram_id=p_id;
        a.active := false; a.credited := 0; a.verified_until := NULL;
        changed := true;
      END IF;
      -- Store negative observations too, so a delayed positive reply cannot override them.
      IF a.telegram_id IS NULL THEN
        INSERT INTO public.apxn_ambassadors(telegram_id,checked_at) VALUES(p_id,p_observed_at) RETURNING * INTO a;
      ELSE
        UPDATE public.apxn_ambassadors SET active=a.active, reward_ever_granted=a.reward_ever_granted,
          credited=a.credited, checked_at=p_observed_at, verified_until=a.verified_until
          WHERE telegram_id=p_id RETURNING * INTO a;
      END IF;
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('start',starts_at,'end',ends_at) ORDER BY starts_at),'[]'::jsonb)
    INTO periods FROM public.apxn_ambassador_periods
    WHERE telegram_id=p_id AND ends_at > coalesce(u.last_claim,t);
  RETURN jsonb_build_object('active',coalesce(a.active,false),'rewardEverGranted',coalesce(a.reward_ever_granted,false),
    'credited',coalesce(a.credited,0),'verifiedUntil',a.verified_until,'checkedAt',a.checked_at,
    'balance',coalesce(u.balance,0),'changed',changed,'lastClaim',u.last_claim,
    'sessionEnd',u.mining_session_ends_at,'periods',periods,'serverNow',t);
END $$;
REVOKE EXECUTE ON FUNCTION public.apxn_ambassador_sync(text,boolean,timestamptz,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apxn_ambassador_sync(text,boolean,timestamptz,boolean) TO service_role;

-- Called only inside existing mining RPCs, while the user's row is locked.
-- The extra 0.003 is not multiplied by referrals or x3; it stops at session end.
CREATE FUNCTION public.apxn_ambassador_settle(p_id text,p_start timestamptz,p_end timestamptz)
RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE amount numeric := 0;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN RETURN 0; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.apxn_ambassadors WHERE telegram_id=p_id AND active) THEN RETURN 0; END IF;
  SELECT coalesce(sum(greatest(0::numeric, extract(epoch from (least(p_end,ends_at)-greatest(p_start,starts_at))))),0)*0.003
    INTO amount FROM public.apxn_ambassador_periods WHERE telegram_id=p_id AND starts_at<p_end AND ends_at>p_start;
  UPDATE public.apxn_ambassadors SET credited=credited+amount WHERE telegram_id=p_id;
  -- Keep the last interval for re-verification; remove old, already paid periods.
  DELETE FROM public.apxn_ambassador_periods p WHERE p.telegram_id=p_id AND p.ends_at<=p_end
    AND p.ends_at < (SELECT a.verified_until FROM public.apxn_ambassadors a WHERE a.telegram_id=p_id);
  RETURN amount;
END $$;
REVOKE EXECUTE ON FUNCTION public.apxn_ambassador_settle(text,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apxn_ambassador_settle(text,timestamptz,timestamptz) TO service_role;

-- Preserve the exact existing RPC implementations, changing only their reward sum.
-- If either current definition differs from the reviewed anchor, abort all DDL.
DO $patch$
DECLARE f regprocedure; src text; anchor text := 'v_claimed := v_claimed + v_stars_bonus;';
BEGIN
  FOREACH f IN ARRAY ARRAY['public.apex_mining_claim(bigint)'::regprocedure,'public.apex_restart_mining_session(bigint)'::regprocedure] LOOP
    src := pg_get_functiondef(f);
    IF (length(src)-length(replace(src,anchor,'')))/length(anchor) <> 1
      OR position('v_accrual_end' in src)=0 OR position('for update' in lower(src))=0 THEN
      RAISE EXCEPTION 'Unexpected mining function: %',f;
    END IF;
    EXECUTE replace(src,anchor,'v_claimed := v_claimed + v_stars_bonus + public.apxn_ambassador_settle(p_telegram_id::text, v_last_claim, v_accrual_end);');
  END LOOP;
END $patch$;
COMMIT;
