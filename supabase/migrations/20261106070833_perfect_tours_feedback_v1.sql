-- Perfect Tours feedback v1. Apply only after reviewing the prerequisite checks.
-- This migration never converts itineraries, backfills ownership, or changes existing rows.
BEGIN;

DO $preflight$
DECLARE
  expected record;
  actual oid;
BEGIN
  IF pg_catalog.to_regclass('public.trips') IS NULL THEN
    RAISE EXCEPTION 'Feedback prerequisite failed: public.trips does not exist. Review the real schema before applying this migration.';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('id', 'uuid'::regtype), ('owner_id', 'uuid'::regtype),
    ('public_id', 'text'::regtype), ('itinerary', 'jsonb'::regtype),
    ('updated_at', 'timestamp with time zone'::regtype)
  ) AS required(name, type_oid)
  LOOP
    SELECT a.atttypid INTO actual FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.trips'::regclass AND a.attname = expected.name
      AND a.attnum > 0 AND NOT a.attisdropped;
    IF actual IS DISTINCT FROM expected.type_oid::oid THEN
      RAISE EXCEPTION 'Feedback prerequisite failed: trips.% must have type %. No ownership is inferred or backfilled.', expected.name, expected.type_oid::regtype;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public.trips'::regclass
    AND a.attname = 'status' AND a.atttypid IN ('text'::regtype, 'character varying'::regtype)
    AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'Feedback prerequisite failed: trips.status must be a text column.';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.trips'::regclass) THEN
    RAISE EXCEPTION 'Feedback prerequisite failed: RLS must be enabled on public.trips. Existing policies still need a separate ownership review.';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Feedback prerequisite failed: Supabase auth.uid(), anon and authenticated roles are required.';
  END IF;
END;
$preflight$;

CREATE TABLE public.pt_feedback_activity_reports (
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  activity_id text NOT NULL,
  day_id text NOT NULL,
  activity_title text NOT NULL,
  day_label text NOT NULL,
  status text NOT NULL CHECK (status IN ('done', 'skipped', 'deferred')),
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 2000),
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes BETWEEN 0 AND 1440),
  rating integer CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (trip_id, activity_id, day_id),
  CHECK (status = 'done' OR char_length(btrim(reason)) > 0),
  CHECK (rating IS NULL OR status = 'done')
);

CREATE TABLE public.pt_feedback_day_summaries (
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_id text NOT NULL,
  day_label text NOT NULL,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 2000),
  tomorrow_preferences text NOT NULL DEFAULT '' CHECK (char_length(tomorrow_preferences) <= 2000),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (trip_id, day_id)
);

CREATE TABLE public.pt_feedback_trip_reviews (
  trip_id uuid PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  vacation_rating integer NOT NULL CHECK (vacation_rating BETWEEN 1 AND 5),
  service_rating integer NOT NULL CHECK (service_rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 2000),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.pt_feedback_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  activity_id text NOT NULL,
  day_id text NOT NULL,
  activity_title text NOT NULL,
  day_label text NOT NULL,
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'alternative', 'rejected')),
  reply text NOT NULL DEFAULT '' CHECK (char_length(reply) <= 4000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  UNIQUE (trip_id, client_request_id),
  CHECK ((status = 'pending' AND resolved_at IS NULL) OR
         (status <> 'pending' AND resolved_at IS NOT NULL AND char_length(btrim(reply)) > 0))
);
CREATE INDEX pt_feedback_requests_trip_created ON public.pt_feedback_change_requests (trip_id, created_at);

-- Default-deny RLS plus no table privileges: only the narrowly scoped RPCs below
-- can access these tables. Future tenant policies must not grant broad table access.
ALTER TABLE public.pt_feedback_activity_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_feedback_day_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_feedback_trip_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_feedback_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pt_feedback_activity_reports, public.pt_feedback_day_summaries,
  public.pt_feedback_trip_reviews, public.pt_feedback_change_requests FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._pt_feedback_text(p_value text, p_min integer, p_max integer, p_label text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE result text := pg_catalog.btrim(coalesce(p_value, ''));
BEGIN
  IF pg_catalog.char_length(result) < p_min OR pg_catalog.char_length(result) > p_max THEN
    RAISE EXCEPTION '% must contain % to % characters.', p_label, p_min, p_max USING ERRCODE = '22023';
  END IF;
  RETURN result;
END;
$function$;

CREATE FUNCTION public._pt_feedback_stable_id(p_value text, p_kind text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT p_value IS NOT NULL AND p_value = pg_catalog.btrim(p_value)
    AND pg_catalog.char_length(p_value) BETWEEN 1 AND 128
    AND p_value !~ ('^' || p_kind || '-index-[0-9]+$');
$function$;

CREATE FUNCTION public._pt_feedback_public_trip(p_public_id text)
RETURNS public.trips LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE result public.trips;
BEGIN
  IF p_public_id IS NULL OR pg_catalog.char_length(p_public_id) NOT BETWEEN 16 AND 256 THEN
    RAISE EXCEPTION 'Trip unavailable.' USING ERRCODE = '42501';
  END IF;
  BEGIN
    SELECT t.* INTO STRICT result FROM public.trips t
      WHERE t.public_id = p_public_id AND t.status IN ('active', 'done') AND t.owner_id IS NOT NULL
      FOR SHARE;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Trip unavailable.' USING ERRCODE = '42501';
  END;
  RETURN result;
END;
$function$;

CREATE FUNCTION public._pt_feedback_owner_trip(p_trip_id uuid)
RETURNS public.trips LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE result public.trips;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Trip unavailable.' USING ERRCODE = '42501'; END IF;
  SELECT t.* INTO result FROM public.trips t
    WHERE t.id = p_trip_id AND t.owner_id = auth.uid() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip unavailable.' USING ERRCODE = '42501'; END IF;
  RETURN result;
END;
$function$;

CREATE FUNCTION public._pt_feedback_activity(p_itinerary jsonb, p_activity_id text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_itinerary) IS DISTINCT FROM 'array' OR
     NOT public._pt_feedback_stable_id(p_activity_id, 'activity') THEN
    RAISE EXCEPTION 'Activity requires a saved structured itinerary with stable IDs.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT a INTO STRICT result FROM pg_catalog.jsonb_array_elements(p_itinerary) a
      WHERE pg_catalog.jsonb_typeof(a) = 'object' AND a->>'kind' IS DISTINCT FROM 'day'
      AND pg_catalog.jsonb_typeof(a->'activity_id') = 'string' AND a->>'activity_id' = p_activity_id;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Activity unavailable.' USING ERRCODE = '22023';
  END;
  IF pg_catalog.jsonb_typeof(result->'day_id') IS DISTINCT FROM 'string' OR
     NOT public._pt_feedback_stable_id(result->>'day_id', 'day') OR
     pg_catalog.char_length(pg_catalog.btrim(coalesce(result->>'title', ''))) = 0 THEN
    RAISE EXCEPTION 'Activity requires saved stable day and activity IDs.' USING ERRCODE = '22023';
  END IF;
  RETURN result;
END;
$function$;

CREATE FUNCTION public._pt_feedback_day(p_itinerary jsonb, p_day_id text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_itinerary) IS DISTINCT FROM 'array' OR
     NOT public._pt_feedback_stable_id(p_day_id, 'day') THEN
    RAISE EXCEPTION 'Day requires a saved structured itinerary with stable IDs.' USING ERRCODE = '22023';
  END IF;
  SELECT a INTO result FROM pg_catalog.jsonb_array_elements(p_itinerary) a
    WHERE pg_catalog.jsonb_typeof(a) = 'object' AND pg_catalog.jsonb_typeof(a->'day_id') = 'string'
    AND a->>'day_id' = p_day_id ORDER BY (a->>'kind' = 'day') DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Day unavailable.' USING ERRCODE = '22023'; END IF;
  RETURN result;
END;
$function$;

CREATE FUNCTION public._pt_feedback_snapshot(p_trip_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'version', 1,
    'trip_updated_at', (SELECT t.updated_at FROM public.trips t WHERE t.id = p_trip_id),
    'reports', coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) - 'trip_id' ORDER BY r.updated_at, r.activity_id)
      FROM public.pt_feedback_activity_reports r WHERE r.trip_id = p_trip_id), '[]'::jsonb),
    'day_summaries', coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) - 'trip_id' ORDER BY d.submitted_at, d.day_id)
      FROM public.pt_feedback_day_summaries d WHERE d.trip_id = p_trip_id), '[]'::jsonb),
    'trip_review', (SELECT pg_catalog.to_jsonb(v) - 'trip_id' FROM public.pt_feedback_trip_reviews v WHERE v.trip_id = p_trip_id),
    'requests', coalesce((SELECT pg_catalog.jsonb_agg(
        (pg_catalog.to_jsonb(q) - 'trip_id' - 'message' - 'reply') ||
        pg_catalog.jsonb_build_object('request_text', q.message, 'agent_reply', q.reply)
        ORDER BY q.created_at, q.id)
      FROM public.pt_feedback_change_requests q WHERE q.trip_id = p_trip_id), '[]'::jsonb)
  );
$function$;

-- Add a scoped public trip reader without replacing the legacy RPC. Keep this
-- allowlist explicit: future trip columns must never become public by default.
CREATE FUNCTION public.pt_feedback_public_trip(p_public_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE trip public.trips; data jsonb;
BEGIN
  trip := public._pt_feedback_public_trip(p_public_id);
  data := pg_catalog.to_jsonb(trip);
  RETURN pg_catalog.jsonb_build_object(
    'public_id', data->'public_id',
    'client_name', data->'client_name',
    'partner_name', data->'partner_name',
    'destination', data->'destination',
    'booking_number', data->'booking_number',
    'start_date', data->'start_date',
    'end_date', data->'end_date',
    'hotel_name', data->'hotel_name',
    'hotel_map', data->'hotel_map',
    'outbound_flight', data->'outbound_flight',
    'return_flight', data->'return_flight',
    'welcome_message', data->'welcome_message',
    'itinerary', data->'itinerary',
    'documents', data->'documents',
    'language', data->'language',
    'status', data->'status'
  );
END;
$function$;

CREATE FUNCTION public.pt_feedback_client(p_public_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE trip public.trips;
BEGIN
  trip := public._pt_feedback_public_trip(p_public_id);
  RETURN public._pt_feedback_snapshot(trip.id);
END;
$function$;

CREATE FUNCTION public.pt_feedback_save_activity(p_public_id text, p_activity_id text, p_status text,
  p_reason text, p_delay_minutes integer, p_rating integer, p_comment text, p_day_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE trip public.trips; activity jsonb; reason text; comment_text text;
BEGIN
  trip := public._pt_feedback_public_trip(p_public_id);
  activity := public._pt_feedback_activity(trip.itinerary, p_activity_id);
  IF p_day_id IS NOT NULL AND p_day_id IS DISTINCT FROM activity->>'day_id' THEN
    RAISE EXCEPTION 'Activity moved to another day. Reload the itinerary before reporting.' USING ERRCODE = '40001';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('done', 'skipped', 'deferred') THEN
    RAISE EXCEPTION 'Invalid activity report status.' USING ERRCODE = '22023';
  END IF;
  reason := public._pt_feedback_text(p_reason, CASE WHEN p_status = 'done' THEN 0 ELSE 1 END, 2000, 'Reason');
  comment_text := public._pt_feedback_text(p_comment, 0, 2000, 'Comment');
  IF p_delay_minutes IS NULL OR p_delay_minutes NOT BETWEEN 0 AND 1440 THEN
    RAISE EXCEPTION 'Delay must be between 0 and 1440 minutes.' USING ERRCODE = '22023';
  END IF;
  IF p_rating IS NOT NULL AND (p_rating NOT BETWEEN 1 AND 5 OR p_status <> 'done') THEN
    RAISE EXCEPTION 'Rating must be 1 to 5 and requires an explicitly completed activity.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.pt_feedback_activity_reports AS existing
    (trip_id, activity_id, day_id, activity_title, day_label, status, reason, delay_minutes, rating, comment)
    VALUES (trip.id, p_activity_id, activity->>'day_id', activity->>'title', coalesce(activity->>'day', ''),
      p_status, reason, p_delay_minutes, p_rating, comment_text)
    ON CONFLICT (trip_id, activity_id, day_id) DO UPDATE SET
      day_id = excluded.day_id, activity_title = excluded.activity_title, day_label = excluded.day_label,
      status = excluded.status, reason = excluded.reason, delay_minutes = excluded.delay_minutes,
      rating = excluded.rating, comment = excluded.comment, updated_at = pg_catalog.clock_timestamp();
  RETURN public._pt_feedback_snapshot(trip.id);
END;
$function$;

CREATE FUNCTION public.pt_feedback_save_day(p_public_id text, p_day_id text, p_rating integer,
  p_comment text, p_tomorrow_preferences text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE trip public.trips; day jsonb; comment_text text; preferences text;
BEGIN
  trip := public._pt_feedback_public_trip(p_public_id);
  day := public._pt_feedback_day(trip.itinerary, p_day_id);
  IF p_rating IS NOT NULL AND p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Rating must be 1 to 5.' USING ERRCODE = '22023'; END IF;
  comment_text := public._pt_feedback_text(p_comment, 0, 2000, 'Comment');
  preferences := public._pt_feedback_text(p_tomorrow_preferences, 0, 2000, 'Tomorrow preferences');
  INSERT INTO public.pt_feedback_day_summaries (trip_id, day_id, day_label, rating, comment, tomorrow_preferences)
    VALUES (trip.id, p_day_id, coalesce(day->>'day', ''), p_rating, comment_text, preferences)
    ON CONFLICT (trip_id, day_id) DO UPDATE SET day_label = excluded.day_label, rating = excluded.rating,
      comment = excluded.comment, tomorrow_preferences = excluded.tomorrow_preferences, submitted_at = pg_catalog.clock_timestamp();
  RETURN public._pt_feedback_snapshot(trip.id);
END;
$function$;

CREATE FUNCTION public.pt_feedback_save_trip(p_public_id text, p_vacation_rating integer,
  p_service_rating integer, p_comment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE trip public.trips; comment_text text;
BEGIN
  trip := public._pt_feedback_public_trip(p_public_id);
  IF p_vacation_rating IS NULL OR p_vacation_rating NOT BETWEEN 1 AND 5 OR
     p_service_rating IS NULL OR p_service_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Vacation and service ratings must be 1 to 5.' USING ERRCODE = '22023';
  END IF;
  comment_text := public._pt_feedback_text(p_comment, 0, 2000, 'Comment');
  INSERT INTO public.pt_feedback_trip_reviews (trip_id, vacation_rating, service_rating, comment)
    VALUES (trip.id, p_vacation_rating, p_service_rating, comment_text)
    ON CONFLICT (trip_id) DO UPDATE SET vacation_rating = excluded.vacation_rating,
      service_rating = excluded.service_rating, comment = excluded.comment, submitted_at = pg_catalog.clock_timestamp();
  RETURN public._pt_feedback_snapshot(trip.id);
END;
$function$;

CREATE FUNCTION public.pt_feedback_request_change(p_public_id text, p_activity_id text,
  p_message text, p_client_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE trip public.trips; activity jsonb; message_text text; prior public.pt_feedback_change_requests;
BEGIN
  trip := public._pt_feedback_public_trip(p_public_id);
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'A retry-safe request ID is required.' USING ERRCODE = '22023'; END IF;
  message_text := public._pt_feedback_text(p_message, 1, 4000, 'Request');
  -- Resolve retries before membership checks: an approved request may have removed
  -- its original activity. Retrying still returns the original request unchanged.
  SELECT q.* INTO prior FROM public.pt_feedback_change_requests q
    WHERE q.trip_id = trip.id AND q.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF prior.activity_id IS DISTINCT FROM p_activity_id OR prior.message IS DISTINCT FROM message_text THEN
      RAISE EXCEPTION 'Request ID was already used for different content.' USING ERRCODE = '22023';
    END IF;
    RETURN public._pt_feedback_snapshot(trip.id);
  END IF;
  activity := public._pt_feedback_activity(trip.itinerary, p_activity_id);
  INSERT INTO public.pt_feedback_change_requests
    (trip_id, client_request_id, activity_id, day_id, activity_title, day_label, message)
    VALUES (trip.id, p_client_request_id, p_activity_id, activity->>'day_id', activity->>'title',
      coalesce(activity->>'day', ''), message_text)
    ON CONFLICT (trip_id, client_request_id) DO NOTHING;
  SELECT q.* INTO prior FROM public.pt_feedback_change_requests q
    WHERE q.trip_id = trip.id AND q.client_request_id = p_client_request_id;
  IF prior.activity_id IS DISTINCT FROM p_activity_id OR prior.message IS DISTINCT FROM message_text THEN
    RAISE EXCEPTION 'Request ID was already used for different content.' USING ERRCODE = '22023';
  END IF;
  RETURN public._pt_feedback_snapshot(trip.id);
END;
$function$;

CREATE FUNCTION public.pt_feedback_agent(p_trip_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE trip public.trips;
BEGIN
  trip := public._pt_feedback_owner_trip(p_trip_id);
  RETURN public._pt_feedback_snapshot(trip.id);
END;
$function$;

CREATE FUNCTION public._pt_feedback_validate_itinerary(p_itinerary jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE item jsonb; key text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_itinerary) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(p_itinerary) > 2000 THEN
    RAISE EXCEPTION 'A structured itinerary array is required (at most 2000 rows).' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT a FROM pg_catalog.jsonb_array_elements(p_itinerary) a LOOP
    IF pg_catalog.jsonb_typeof(item) IS DISTINCT FROM 'object' OR
       pg_catalog.jsonb_typeof(item->'day_id') IS DISTINCT FROM 'string' OR
       NOT public._pt_feedback_stable_id(item->>'day_id', 'day') OR
       pg_catalog.jsonb_typeof(item->'day') IS DISTINCT FROM 'string' OR
       pg_catalog.char_length(pg_catalog.btrim(coalesce(item->>'day', ''))) = 0 THEN
      RAISE EXCEPTION 'Every itinerary row requires a saved stable day ID and a day label.' USING ERRCODE = '22023';
    END IF;
    IF item->>'kind' = 'day' THEN CONTINUE; END IF;
    IF pg_catalog.jsonb_typeof(item->'activity_id') IS DISTINCT FROM 'string' OR
       NOT public._pt_feedback_stable_id(item->>'activity_id', 'activity') OR
       pg_catalog.jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR
       pg_catalog.char_length(pg_catalog.btrim(coalesce(item->>'title', ''))) = 0 THEN
      RAISE EXCEPTION 'Every activity requires a saved stable activity ID and a title.' USING ERRCODE = '22023';
    END IF;
    FOREACH key IN ARRAY ARRAY['time', 'entry_time'] LOOP
      IF item ? key AND item->key <> 'null'::jsonb AND
        (pg_catalog.jsonb_typeof(item->key) <> 'string' OR
         (item->>key <> '' AND item->>key !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) THEN
        RAISE EXCEPTION 'Itinerary times must be HH:mm or empty.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT a->>'activity_id' FROM pg_catalog.jsonb_array_elements(p_itinerary) a
      WHERE a->>'kind' IS DISTINCT FROM 'day' GROUP BY a->>'activity_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Activity IDs must be unique within the itinerary.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT a->>'day_id' FROM pg_catalog.jsonb_array_elements(p_itinerary) a
      GROUP BY a->>'day_id' HAVING count(DISTINCT pg_catalog.jsonb_build_array(a->'day', a->'day_date')) > 1) THEN
    RAISE EXCEPTION 'Rows sharing a day ID must share the same day label and date.' USING ERRCODE = '22023';
  END IF;
END;
$function$;

CREATE FUNCTION public.pt_feedback_resolve_request(p_request_id uuid, p_status text, p_reply text,
  p_itinerary jsonb DEFAULT NULL, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE request public.pt_feedback_change_requests; trip public.trips; reply_text text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Request unavailable.' USING ERRCODE = '42501'; END IF;
  -- Lock the trip first, consistently with public writes, before locking a request.
  SELECT t.* INTO trip FROM public.trips t JOIN public.pt_feedback_change_requests q ON q.trip_id = t.id
    WHERE q.id = p_request_id AND t.owner_id = auth.uid() FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable.' USING ERRCODE = '42501'; END IF;
  SELECT q.* INTO request FROM public.pt_feedback_change_requests q WHERE q.id = p_request_id FOR UPDATE;
  IF request.status <> 'pending' THEN RAISE EXCEPTION 'Request was already resolved.' USING ERRCODE = '40001'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'alternative', 'rejected') THEN
    RAISE EXCEPTION 'Invalid request resolution.' USING ERRCODE = '22023';
  END IF;
  reply_text := public._pt_feedback_text(p_reply, 1, 4000, 'Agent reply');
  IF p_status = 'approved' THEN
    IF trip.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'Itinerary changed since it was loaded. Reload before approving.' USING ERRCODE = '40001';
    END IF;
    PERFORM public._pt_feedback_validate_itinerary(p_itinerary);
    IF p_itinerary IS NOT DISTINCT FROM trip.itinerary THEN
      RAISE EXCEPTION 'Approval requires an actual itinerary change.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.trips SET itinerary = p_itinerary, updated_at = pg_catalog.clock_timestamp()
      WHERE id = trip.id AND owner_id = auth.uid() AND updated_at IS NOT DISTINCT FROM p_expected_updated_at;
    IF NOT FOUND THEN RAISE EXCEPTION 'Itinerary changed. Reload before approving.' USING ERRCODE = '40001'; END IF;
  ELSIF p_itinerary IS NOT NULL THEN
    RAISE EXCEPTION 'Only approval can modify the official itinerary.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.pt_feedback_change_requests SET status = p_status, reply = reply_text,
    resolved_at = pg_catalog.clock_timestamp() WHERE id = request.id;
  RETURN public._pt_feedback_snapshot(trip.id);
END;
$function$;

-- PostgreSQL grants function EXECUTE to PUBLIC by default; remove it from every
-- helper and wrapper before granting only the intended entry points.
REVOKE ALL ON FUNCTION public._pt_feedback_text(text, integer, integer, text),
  public._pt_feedback_stable_id(text, text), public._pt_feedback_public_trip(text),
  public._pt_feedback_owner_trip(uuid), public._pt_feedback_activity(jsonb, text),
  public._pt_feedback_day(jsonb, text), public._pt_feedback_snapshot(uuid),
  public._pt_feedback_validate_itinerary(jsonb), public.pt_feedback_public_trip(text),
  public.pt_feedback_client(text),
  public.pt_feedback_save_activity(text, text, text, text, integer, integer, text, text),
  public.pt_feedback_save_day(text, text, integer, text, text),
  public.pt_feedback_save_trip(text, integer, integer, text),
  public.pt_feedback_request_change(text, text, text, uuid), public.pt_feedback_agent(uuid),
  public.pt_feedback_resolve_request(uuid, text, text, jsonb, timestamptz)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pt_feedback_public_trip(text), public.pt_feedback_client(text),
  public.pt_feedback_save_activity(text, text, text, text, integer, integer, text, text),
  public.pt_feedback_save_day(text, text, integer, text, text),
  public.pt_feedback_save_trip(text, integer, integer, text),
  public.pt_feedback_request_change(text, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pt_feedback_agent(uuid),
  public.pt_feedback_resolve_request(uuid, text, text, jsonb, timestamptz) TO authenticated;

COMMENT ON TABLE public.pt_feedback_activity_reports IS 'Explicit client reports per activity and official day. Moving an activity retains its previous-day history. Missing rows mean unreported, never completed by elapsed time.';
COMMENT ON FUNCTION public.pt_feedback_resolve_request(uuid, text, text, jsonb, timestamptz) IS 'Owner-only. Approval updates official itinerary and request atomically with revision conflict detection. Never cancels supplier bookings.';
COMMIT;
