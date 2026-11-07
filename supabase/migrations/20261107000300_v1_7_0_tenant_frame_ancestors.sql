-- LIREP v1.7.0 | iframe origins scoped to each active tenant.
BEGIN;
CREATE OR REPLACE FUNCTION public.lirep_public_allowed_origins(p_public_prefix text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(array_agg('https://' || d.hostname ORDER BY d.hostname), ARRAY[]::text[])
  FROM public.organizations o
  JOIN public.organization_domains d ON d.organization_id=o.id AND d.active=true
  WHERE o.public_prefix=upper(btrim(coalesce(p_public_prefix,''))) AND o.active=true;
$$;
REVOKE ALL ON FUNCTION public.lirep_public_allowed_origins(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_public_allowed_origins(text) TO service_role;
COMMIT;
