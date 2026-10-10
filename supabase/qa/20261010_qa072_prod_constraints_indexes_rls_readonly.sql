-- LIREP QA-072 · METADATOS ESTRUCTURALES · SOLO LECTURA
-- Ejecutar exclusivamente en lirep-prod (hiidqmrgrioidvemixfe).
-- No consulta filas de tablas de negocio ni extrae datos personales.
WITH objects AS (
 SELECT 'ENUM'::text AS object_type,
        n.nspname||'.'||t.typname AS object_name,
        string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS definition
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 JOIN pg_enum e ON e.enumtypid=t.oid
 WHERE n.nspname='public'
 GROUP BY n.nspname,t.typname
 UNION ALL
 SELECT 'CONSTRAINT', c.relname||'.'||co.conname,
        pg_get_constraintdef(co.oid, true)
 FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'INDEX', tab.relname||'.'||idx.relname, pg_get_indexdef(idx.oid)
 FROM pg_index i JOIN pg_class tab ON tab.oid=i.indrelid
 JOIN pg_class idx ON idx.oid=i.indexrelid
 JOIN pg_namespace n ON n.oid=tab.relnamespace
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'TRIGGER', c.relname||'.'||t.tgname, pg_get_triggerdef(t.oid, true)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL
 SELECT 'RLS_POLICY', schemaname||'.'||tablename||'.'||policyname,
        'command='||cmd||'; roles='||array_to_string(roles,',')||
        '; using='||coalesce(qual,'NULL')||
        '; check='||coalesce(with_check,'NULL')
 FROM pg_policies WHERE schemaname='public'
)
SELECT object_type,object_name,definition
FROM objects ORDER BY object_type,object_name;
