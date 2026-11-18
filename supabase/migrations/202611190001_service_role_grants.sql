-- The Cloud Run worker authenticates with a Supabase secret key mapped to
-- service_role. Supabase grants vary by project; make the worker's required
-- privileges explicit so it is not dependent on default grants.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
