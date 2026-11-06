\set ON_ERROR_STOP on

-- Synthetic local fixture only. No production credentials or customer data.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.trips (
  id uuid PRIMARY KEY,
  owner_id uuid,
  public_id text UNIQUE NOT NULL,
  itinerary jsonb,
  status text NOT NULL DEFAULT 'draft',
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY trips_owner ON public.trips TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO authenticated;

INSERT INTO public.trips (id, owner_id, public_id, itinerary, status, updated_at) VALUES
('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '11111111111111111111111111111111',
 '[{"activity_id":"30000000-0000-0000-0000-000000000001","day_id":"40000000-0000-0000-0000-000000000001","day":"Synthetic day one","time":"09:00","title":"Synthetic museum","description":"Local SQL test only"},{"activity_id":"30000000-0000-0000-0000-000000000002","day_id":"40000000-0000-0000-0000-000000000001","day":"Synthetic day one","time":"12:00","title":"Synthetic lunch"},{"activity_id":"30000000-0000-0000-0000-000000000003","day_id":"40000000-0000-0000-0000-000000000002","day":"Synthetic day two","time":"10:00","title":"Synthetic garden"},{"kind":"day","day_id":"40000000-0000-0000-0000-000000000003","day":"Synthetic empty day"}]', 'active', '2026-11-06T00:00:00Z'),
('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '22222222222222222222222222222222',
 '[{"activity_id":"30000000-0000-0000-0000-000000000004","day_id":"40000000-0000-0000-0000-000000000004","day":"Draft test day","title":"Draft test activity"}]', 'draft', '2026-11-06T00:00:00Z'),
('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '33333333333333333333333333333333',
 '[{"activity_id":"30000000-0000-0000-0000-000000000005","day_id":"40000000-0000-0000-0000-000000000005","day":"Other owner test day","title":"Other owner test activity"}]', 'active', '2026-11-06T00:00:00Z'),
('10000000-0000-0000-0000-000000000004', NULL, '44444444444444444444444444444444',
 '[{"activity_id":"30000000-0000-0000-0000-000000000006","day_id":"40000000-0000-0000-0000-000000000006","day":"Unowned test day","title":"Unowned test activity"}]', 'active', '2026-11-06T00:00:00Z'),
('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '55555555555555555555555555555555',
 '[{"activity_id":"30000000-0000-0000-0000-000000000007","day_id":"40000000-0000-0000-0000-000000000007","day":"Completed trip test day","title":"Completed trip test activity"}]', 'done', '2026-11-06T00:00:00Z'),
('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001', '66666666666666666666666666666666',
 '"Preserved unstructured synthetic itinerary"', 'active', '2026-11-06T00:00:00Z'),
('10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '77777777777777777777777777777777',
 '[{"activity_id":"activity-index-0","day_id":"day-index-0","day":"Temporary IDs test day","title":"Temporary IDs test activity"}]', 'active', '2026-11-06T00:00:00Z');
