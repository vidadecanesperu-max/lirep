-- QA-070 · INVENTARIO DE ESQUEMA EN PRODUCCIÓN · SOLO LECTURA
-- Ejecutar EXCLUSIVAMENTE en SQL Editor de lirep-prod (hiidqmrgrioidvemixfe).
-- No extrae filas, documentos, correos, teléfonos, contraseñas ni tokens.
-- Resultados: nombres de objetos y definiciones estructurales sin valores.
WITH tables AS (
 SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name,
        c.relrowsecurity AS rls_enabled
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
)
SELECT 'TABLE' AS object_type, table_name AS object_name,
       CASE WHEN rls_enabled THEN 'RLS_ON' ELSE 'RLS_OFF' END AS detail
FROM tables
UNION ALL
SELECT 'COLUMN', t.table_name||'.'||a.attname,
       pg_catalog.format_type(a.atttypid,a.atttypmod)||
       CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
FROM tables t JOIN pg_attribute a ON a.attrelid=t.oid
WHERE a.attnum>0 AND NOT a.attisdropped
UNION ALL
SELECT 'CONSTRAINT', t.table_name||'.'||con.conname,
       con.contype::text
FROM tables t JOIN pg_constraint con ON con.conrelid=t.oid
UNION ALL
SELECT 'FUNCTION', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind='f'
ORDER BY object_type,object_name;
