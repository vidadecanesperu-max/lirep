-- Ejecutar manualmente SOLO en el proyecto LIREP y tras aplicar migraciones A1 y A2.
-- OWNER_EMAIL: sustituir por el correo verificado de tu usuario Supabase Auth.
-- Nunca ejecutar en un proyecto ajeno. No reemplazar con UUID ficticio.
do $onboarding$
declare
  v_user_id uuid;
begin
 select id into v_user_id from auth.users
 where lower(email)=lower('REEMPLAZAR_CON_EMAIL_VERIFICADO')
   and email_confirmed_at is not null;
 if v_user_id is null then
  raise exception 'LIREP_OWNER_AUTH_USER_NOT_FOUND_OR_EMAIL_NOT_CONFIRMED';
 end if;
 insert into public.lirep_admin_platform_owners(user_id,active)
 values(v_user_id,true)
 on conflict(user_id) do update set active=true;
 raise notice 'OWNER_ACTIVATED: %',v_user_id;
end;
$onboarding$;

-- Control de propiedad (no expone datos de terceros)
select count(*) as active_owner_count from public.lirep_admin_platform_owners where active;
