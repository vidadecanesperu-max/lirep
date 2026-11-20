-- QA235: El indicador is_minor pertenece a consumers (alias co), no a complaints (alias c).
-- Corrige exclusivamente el trigger de cola; no se aprueban ni reenvían respuestas anteriores.
CREATE OR REPLACE FUNCTION public.lirep_admin_queue_approved_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_email text; v_method text;
begin
  if new.status='approved' and old.status='pending_approval' then
    select nullif(btrim(coalesce(case when co.is_minor then co.representative_email else co.email end,'')),''),
           coalesce(c.official_delivery_method,
             case when nullif(btrim(coalesce(case when co.is_minor then co.representative_email else co.email end,'')),'') is not null
                  then 'email' else 'postal' end)
    into v_email,v_method
    from public.complaints c
    join public.consumers co on co.id=c.consumer_id and co.organization_id=c.organization_id
    where c.id=new.complaint_id and c.organization_id=new.organization_id;

    if v_method='email' and v_email is not null
      and v_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then
      insert into public.lirep_admin_response_delivery(organization_id,complaint_id,response_id,recipient)
      values(new.organization_id,new.complaint_id,new.id,v_email)
      on conflict(response_id) do nothing;
    end if;
  end if;
  return new;
end $function$;
