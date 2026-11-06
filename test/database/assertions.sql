\set ON_ERROR_STOP on

-- Synthetic canary columns prove the public reader uses a fixed allowlist,
-- including when new private trip fields are added after the migration.
ALTER TABLE public.trips ADD COLUMN language text DEFAULT 'en';
ALTER TABLE public.trips ADD COLUMN client_phone text DEFAULT 'SYNTHETIC-PRIVATE-PHONE';
ALTER TABLE public.trips ADD COLUMN future_private_field text DEFAULT 'SYNTHETIC-PRIVATE-CANARY';

CREATE SCHEMA test_support;
GRANT USAGE ON SCHEMA test_support TO anon, authenticated;

CREATE FUNCTION test_support.assert_true(p_value boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_value IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  PERFORM set_config('test.assertions', (COALESCE(NULLIF(current_setting('test.assertions', true), ''), '0')::int + 1)::text, false);
  RAISE NOTICE 'PASS: %', p_label;
END;
$$;

CREATE FUNCTION test_support.expect_failure(p_sql text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.assert_true(true, p_label);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: expected an error: %', p_label;
END;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test_support TO anon, authenticated;
SELECT set_config('test.assertions', '0', false);
SELECT set_config('test.main_original', itinerary::text, false),
       set_config('test.main_original_updated_at', updated_at::text, false),
       set_config('test.main_changed', jsonb_set(itinerary, '{0,title}', '"Synthetic changed museum"')::text, false)
  FROM public.trips WHERE id = '10000000-0000-0000-0000-000000000001';
CREATE TABLE test_support.original_trips AS SELECT * FROM public.trips;

SELECT test_support.assert_true(
  (SELECT count(*) = 4 AND bool_and(c.relrowsecurity)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('pt_feedback_activity_reports', 'pt_feedback_day_summaries', 'pt_feedback_trip_reviews', 'pt_feedback_change_requests')),
  'all four feedback tables enable RLS');
SELECT test_support.assert_true(
  (SELECT bool_and(NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               AND NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('pt_feedback_activity_reports', 'pt_feedback_day_summaries', 'pt_feedback_trip_reviews', 'pt_feedback_change_requests')),
  'anonymous and authenticated roles have no direct feedback table privileges');
SELECT format('SET ROLE %I; SELECT test_support.expect_failure(%L, %L); RESET ROLE;', role_name,
              'SELECT * FROM public.' || quote_ident(table_name), role_name || ' direct read denied: ' || table_name)
  FROM unnest(ARRAY['anon', 'authenticated']) role_name
 CROSS JOIN unnest(ARRAY['pt_feedback_activity_reports', 'pt_feedback_day_summaries', 'pt_feedback_trip_reviews', 'pt_feedback_change_requests']) table_name
\gexec

SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT test_support.assert_true(
  public.pt_feedback_public_trip('11111111111111111111111111111111')->>'language' = 'en'
  AND public.pt_feedback_public_trip('11111111111111111111111111111111')->>'status' = 'active',
  'scoped public trip reader includes actual language and publication status');
SELECT test_support.assert_true(
  NOT (public.pt_feedback_public_trip('11111111111111111111111111111111') ?| ARRAY['id', 'owner_id', 'client_phone', 'future_private_field'])
  AND (SELECT count(*) = 16 FROM jsonb_object_keys(public.pt_feedback_public_trip('11111111111111111111111111111111'))),
  'scoped public trip reader excludes ownership phone and unknown future fields');
SELECT test_support.assert_true(
  public.pt_feedback_public_trip('11111111111111111111111111111111')->>'public_id' = '11111111111111111111111111111111'
  AND jsonb_array_length(public.pt_feedback_public_trip('11111111111111111111111111111111')->'itinerary') = 4,
  'scoped public trip reader returns only the token-matched itinerary');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_public_trip('22222222222222222222222222222222')$sql$,
  'scoped public trip reader denies draft trips before returning any content');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_public_trip('invalid-synthetic-token')$sql$,
  'scoped public trip reader denies unknown public tokens');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_public_trip('44444444444444444444444444444444')$sql$,
  'scoped public trip reader denies unowned trips');
SELECT test_support.assert_true(public.pt_feedback_client('11111111111111111111111111111111') - 'trip_updated_at' =
  '{"version":1,"reports":[],"day_summaries":[],"trip_review":null,"requests":[]}'::jsonb,
  'new feedback envelope is empty; elapsed activities are not fabricated as done');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_client('invalid-synthetic-token')$sql$, 'unknown public token rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_client(NULL)$sql$, 'null public token rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_client('22222222222222222222222222222222')$sql$, 'draft trip feedback rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_client('44444444444444444444444444444444')$sql$, 'unowned trip feedback rejected');
SELECT test_support.assert_true((public.pt_feedback_client('55555555555555555555555555555555')->>'version') = '1', 'completed published trip can submit feedback');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_agent('10000000-0000-0000-0000-000000000001')$sql$, 'anonymous agent read denied');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000005','done','',0,5,'')$sql$, 'activity from another trip rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','missing-activity','done','',0,5,'')$sql$, 'unknown activity rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('66666666666666666666666666666666','30000000-0000-0000-0000-000000000001','done','',0,5,'')$sql$, 'legacy unstructured itinerary cannot receive invented activity report');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('77777777777777777777777777777777','activity-index-0','done','',0,5,'')$sql$, 'temporary index activity IDs rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','unknown','',0,NULL,'')$sql$, 'invalid activity status rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','skipped','  ',0,NULL,'')$sql$, 'skipping requires reason');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','deferred','',0,NULL,'')$sql$, 'deferral requires reason');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','done','',-1,NULL,'')$sql$, 'negative delay rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','done','',1441,NULL,'')$sql$, 'delay beyond one day rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','done','',0,6,'')$sql$, 'rating outside 1 to 5 rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','skipped','Synthetic reason',0,4,'')$sql$, 'rating without completion rejected');
SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','done','',12,5,'Synthetic activity comment');
SELECT test_support.assert_true(
  (SELECT jsonb_array_length(data->'reports') = 1
       AND data->'reports'->0->>'activity_id' = '30000000-0000-0000-0000-000000000001'
       AND data->'reports'->0->>'status' = 'done'
       AND data->'reports'->0->>'delay_minutes' = '12'
       AND data->'reports'->0->>'rating' = '5'
     FROM (SELECT public.pt_feedback_client('11111111111111111111111111111111') data) feedback),
  'activity completion delay and rating persist without inventing other reports');
SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000002','skipped','Synthetic skipped reason',0,NULL,'');
SELECT public.pt_feedback_save_activity('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','deferred','Synthetic deferred reason',15,NULL,'Tomorrow please');
SELECT test_support.assert_true(jsonb_array_length(public.pt_feedback_client('11111111111111111111111111111111')->'reports') = 2, 'report corrections upsert without duplicate activity rows');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_day('11111111111111111111111111111111','40000000-0000-0000-0000-000000000005',4,'','')$sql$, 'day from another trip rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_day('11111111111111111111111111111111','missing-day',4,'','')$sql$, 'unknown day rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_day('11111111111111111111111111111111','40000000-0000-0000-0000-000000000001',0,'','')$sql$, 'invalid daily rating rejected');
SELECT public.pt_feedback_save_day('11111111111111111111111111111111','40000000-0000-0000-0000-000000000001',4,'Synthetic daily comment','A slower day tomorrow');
SELECT test_support.assert_true(public.pt_feedback_client('11111111111111111111111111111111')->'day_summaries'->0->>'tomorrow_preferences' = 'A slower day tomorrow', 'daily preferences persist for agent report');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_trip('11111111111111111111111111111111',NULL,4,'')$sql$, 'missing vacation rating rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_save_trip('11111111111111111111111111111111',4,6,'')$sql$, 'invalid service rating rejected');
SELECT public.pt_feedback_save_trip('11111111111111111111111111111111',5,4,'Synthetic trip review');
SELECT test_support.assert_true(public.pt_feedback_client('11111111111111111111111111111111')->'trip_review'->>'vacation_rating' = '5', 'private vacation review persists');
SELECT test_support.assert_true(public.pt_feedback_client('33333333333333333333333333333333') - 'trip_updated_at' =
  '{"version":1,"reports":[],"day_summaries":[],"trip_review":null,"requests":[]}'::jsonb, 'another trip token never receives main trip ratings or reports');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_request_change('11111111111111111111111111111111','missing-activity','Synthetic request','50000000-0000-0000-0000-000000000001')$sql$, 'request cannot target missing activity');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_request_change('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','  ','50000000-0000-0000-0000-000000000001')$sql$, 'empty change request rejected');
SELECT public.pt_feedback_request_change('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','Synthetic request to change museum','50000000-0000-0000-0000-000000000001');
SELECT set_config('test.request_id', public.pt_feedback_client('11111111111111111111111111111111')->'requests'->0->>'id', false);
SELECT public.pt_feedback_request_change('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','Synthetic request to change museum','50000000-0000-0000-0000-000000000001');
SELECT test_support.assert_true(
  jsonb_array_length(public.pt_feedback_client('11111111111111111111111111111111')->'requests') = 1
  AND public.pt_feedback_client('11111111111111111111111111111111')->'requests'->0->>'id' = current_setting('test.request_id'),
  'identical request retry is idempotent');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_request_change('11111111111111111111111111111111','30000000-0000-0000-0000-000000000001','Different request with reused key','50000000-0000-0000-0000-000000000001')$sql$, 'reused idempotency key with different payload rejected');
SELECT test_support.assert_true(public.pt_feedback_client('11111111111111111111111111111111')->'requests'->0->>'activity_title' = 'Synthetic museum', 'request stores official title snapshot');
SELECT test_support.assert_true(public.pt_feedback_client('11111111111111111111111111111111')->'requests'->0->>'request_text' = 'Synthetic request to change museum', 'client receives canonical request text');
RESET ROLE;
SELECT test_support.assert_true(NOT EXISTS(
  (SELECT * FROM public.trips EXCEPT SELECT * FROM test_support.original_trips)
  UNION ALL (SELECT * FROM test_support.original_trips EXCEPT SELECT * FROM public.trips)),
  'activity reports ratings daily summaries and requests never modify official trips');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_agent('10000000-0000-0000-0000-000000000001')$sql$, 'another agent cannot read trip feedback');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_resolve_request(current_setting('test.request_id')::uuid,'rejected','Unauthorized reply')$sql$, 'another agent cannot answer change request');
SELECT test_support.assert_true(public.pt_feedback_agent('10000000-0000-0000-0000-000000000003')->'reports' = '[]'::jsonb, 'other agent sees only their own trip');
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_agent('10000000-0000-0000-0000-000000000001')$sql$, 'authenticated role without verified user denied');
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
SELECT test_support.assert_true(jsonb_array_length(public.pt_feedback_agent('10000000-0000-0000-0000-000000000001')->'reports') = 2, 'owning agent reads client activity report');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_resolve_request(current_setting('test.request_id')::uuid,'approved','Synthetic approval')$sql$, 'approval without official itinerary rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_resolve_request(current_setting('test.request_id')::uuid,'approved','Synthetic approval', current_setting('test.main_original')::jsonb, current_setting('test.main_original_updated_at')::timestamptz)$sql$, 'approval without actual itinerary change rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_resolve_request(current_setting('test.request_id')::uuid,'approved','Synthetic approval', current_setting('test.main_changed')::jsonb, '2020-01-01T00:00:00Z')$sql$, 'stale official itinerary revision rejected');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_resolve_request(current_setting('test.request_id')::uuid,'approved','Synthetic approval', '[{"day":"No persisted IDs","title":"Unstable activity"}]'::jsonb, current_setting('test.main_original_updated_at')::timestamptz)$sql$, 'approval rejects itinerary without stable activity and day IDs');
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_resolve_request(current_setting('test.request_id')::uuid,'approved','Synthetic approval', '[{"activity_id":"activity-index-0","day_id":"day-index-0","day":"Temporary IDs","title":"Synthetic activity"}]'::jsonb, current_setting('test.main_original_updated_at')::timestamptz)$sql$, 'approval rejects generated index IDs');
SELECT test_support.assert_true(public.pt_feedback_agent('10000000-0000-0000-0000-000000000001')->'requests'->0->>'status' = 'pending', 'invalid approvals leave request pending');
RESET ROLE;
SELECT test_support.assert_true(
  (SELECT itinerary = current_setting('test.main_original')::jsonb AND updated_at = current_setting('test.main_original_updated_at')::timestamptz
     FROM public.trips WHERE id = '10000000-0000-0000-0000-000000000001'),
  'invalid and conflicting approvals leave official itinerary and revision untouched');
SET ROLE authenticated;
SELECT public.pt_feedback_resolve_request(current_setting('test.request_id')::uuid,'approved','Synthetic approved itinerary', current_setting('test.main_changed')::jsonb, current_setting('test.main_original_updated_at')::timestamptz);
SELECT test_support.assert_true(public.pt_feedback_agent('10000000-0000-0000-0000-000000000001')->'requests'->0->>'status' = 'approved', 'approval updates request status');
RESET ROLE;
SELECT test_support.assert_true(
  (SELECT itinerary = current_setting('test.main_changed')::jsonb AND updated_at > current_setting('test.main_original_updated_at')::timestamptz
     FROM public.trips WHERE id = '10000000-0000-0000-0000-000000000001'),
  'approval changes official itinerary and revision in same transaction');
SET ROLE anon;
SELECT test_support.assert_true(public.pt_feedback_client('11111111111111111111111111111111')->'requests'->0->>'agent_reply' = 'Synthetic approved itinerary', 'client receives agent reply for their own request');
SELECT test_support.assert_true(public.pt_feedback_client('11111111111111111111111111111111')->'requests'->0->>'activity_title' = 'Synthetic museum', 'request keeps original title snapshot after official itinerary change');
SELECT public.pt_feedback_request_change('11111111111111111111111111111111','30000000-0000-0000-0000-000000000002','Synthetic alternative request','50000000-0000-0000-0000-000000000002');
SELECT set_config('test.alternative_request_id', value->>'id', false)
  FROM jsonb_array_elements(public.pt_feedback_client('11111111111111111111111111111111')->'requests')
 WHERE value->>'client_request_id' = '50000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT set_config('test.post_approval', itinerary::text, false), set_config('test.post_approval_updated_at', updated_at::text, false)
  FROM public.trips WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT test_support.expect_failure($sql$SELECT public.pt_feedback_resolve_request(current_setting('test.alternative_request_id')::uuid,'alternative','  ')$sql$, 'agent response requires explanation');
SELECT public.pt_feedback_resolve_request(current_setting('test.alternative_request_id')::uuid,'alternative','Synthetic suggested alternative');
RESET ROLE;
SELECT test_support.assert_true(
  (SELECT itinerary = current_setting('test.post_approval')::jsonb AND updated_at = current_setting('test.post_approval_updated_at')::timestamptz
     FROM public.trips WHERE id = '10000000-0000-0000-0000-000000000001'),
  'offering alternative does not silently modify official itinerary');
SET ROLE anon;
SELECT public.pt_feedback_request_change('11111111111111111111111111111111','30000000-0000-0000-0000-000000000002','Synthetic rejected request','50000000-0000-0000-0000-000000000003');
SELECT set_config('test.rejected_request_id', value->>'id', false)
  FROM jsonb_array_elements(public.pt_feedback_client('11111111111111111111111111111111')->'requests')
 WHERE value->>'client_request_id' = '50000000-0000-0000-0000-000000000003';
RESET ROLE;
SET ROLE authenticated;
SELECT public.pt_feedback_resolve_request(current_setting('test.rejected_request_id')::uuid,'rejected','Synthetic rejection explanation');
RESET ROLE;
SELECT test_support.assert_true(
  (SELECT itinerary = current_setting('test.post_approval')::jsonb AND updated_at = current_setting('test.post_approval_updated_at')::timestamptz
     FROM public.trips WHERE id = '10000000-0000-0000-0000-000000000001'),
  'rejecting request does not modify official itinerary');

-- Moving a saved activity to another official day must preserve its report for
-- the original day. A stale client cannot silently report against the new day.
SELECT set_config('test.dayone_summary', to_jsonb(s)::text, false)
  FROM public.pt_feedback_day_summaries s WHERE trip_id = '10000000-0000-0000-0000-000000000001'
    AND day_id = '40000000-0000-0000-0000-000000000001';
UPDATE public.trips SET itinerary = jsonb_set(jsonb_set(itinerary,
  '{0,day_id}', '"40000000-0000-0000-0000-000000000002"'), '{0,day}', '"Synthetic day two"'),
  updated_at = clock_timestamp() WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT set_config('test.moved_itinerary', itinerary::text, false)
  FROM public.trips WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT test_support.assert_true(
  (SELECT count(*) = 1 AND bool_and(value->>'day_id' = '40000000-0000-0000-0000-000000000001')
    FROM jsonb_array_elements(public.pt_feedback_client('11111111111111111111111111111111')->'reports')
    WHERE value->>'activity_id' = '30000000-0000-0000-0000-000000000001'),
  'moving official activity preserves its original-day report without inventing a new-day report');
DO $test$
BEGIN
  BEGIN
    PERFORM public.pt_feedback_save_activity('11111111111111111111111111111111',
      '30000000-0000-0000-0000-000000000001', 'done', '', 0, 5, 'Stale day client',
      '40000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: stale day report should raise SQLSTATE 40001';
  EXCEPTION WHEN serialization_failure THEN
    PERFORM test_support.assert_true(true, 'stale expected activity day is rejected with revision conflict');
  END;
END;
$test$;
SELECT public.pt_feedback_save_activity('11111111111111111111111111111111',
  '30000000-0000-0000-0000-000000000001', 'done', '', 0, 5, 'Completed on new official day',
  '40000000-0000-0000-0000-000000000002');
SELECT test_support.assert_true(
  (SELECT count(*) = 2
    AND count(*) FILTER (WHERE value->>'day_id' = '40000000-0000-0000-0000-000000000001' AND value->>'status' = 'deferred') = 1
    AND count(*) FILTER (WHERE value->>'day_id' = '40000000-0000-0000-0000-000000000002' AND value->>'status' = 'done') = 1
    FROM jsonb_array_elements(public.pt_feedback_client('11111111111111111111111111111111')->'reports')
    WHERE value->>'activity_id' = '30000000-0000-0000-0000-000000000001'),
  'same activity can have separate historical reports on two official days');
RESET ROLE;
SELECT test_support.assert_true(
  (SELECT itinerary = current_setting('test.moved_itinerary')::jsonb FROM public.trips
    WHERE id = '10000000-0000-0000-0000-000000000001'),
  'reporting on the new day does not modify the official itinerary');
SELECT test_support.assert_true(
  (SELECT to_jsonb(s) = current_setting('test.dayone_summary')::jsonb
    FROM public.pt_feedback_day_summaries s WHERE trip_id = '10000000-0000-0000-0000-000000000001'
      AND day_id = '40000000-0000-0000-0000-000000000001'),
  'moving activity preserves the original-day summary unchanged');
UPDATE public.trips t SET itinerary =
  (SELECT jsonb_agg(a) FROM jsonb_array_elements(t.itinerary) a
    WHERE a->>'day_id' <> '40000000-0000-0000-0000-000000000001'), updated_at = clock_timestamp()
  WHERE t.id = '10000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT test_support.assert_true(
  public.pt_feedback_client('11111111111111111111111111111111')->'day_summaries'->0->>'day_id' = '40000000-0000-0000-0000-000000000001'
  AND public.pt_feedback_client('11111111111111111111111111111111')->'day_summaries'->0->>'day_label' = 'Synthetic day one',
  'removed official day retains its archived summary and original day label');
RESET ROLE;
SELECT 'Database security and persistence assertions passed: ' || current_setting('test.assertions') AS result;
