-- QA-068: inventario SOLO LECTURA en proyecto lirep-staging.
-- Ejecutar únicamente en SQL Editor del proyecto jitcayjaztceglqlmwvl.
-- No contiene INSERT, UPDATE, DELETE, DDL ni datos personales.
SELECT
  current_database() AS database_name,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS public_tables,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f') AS public_functions,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS public_rls_policies,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) AS public_triggers,
  (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity) AS public_tables_without_rls;
