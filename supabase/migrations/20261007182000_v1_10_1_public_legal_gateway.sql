-- LIREP V1.10.1 — motor público legal ampliado
-- Requiere V1.10.0. Aditiva: crea sobrecargas nuevas; no elimina firmas históricas.

begin;

create or replace function public.lirep_public_submission_hash(
 p_organization_id uuid,p_establishment_id uuid,p_complaint_book_id uuid,
 p_document_type public.lirep_consumer_document_type,p_document_number text,p_first_names text,p_last_names text,p_email text,
 p_phone text,p_address text,p_is_minor boolean,
 p_representative_first_names text,p_representative_last_names text,
 p_representative_document_type public.lirep_consumer_document_type,p_representative_document_number text,
 p_representative_phone text,p_representative_email text,
 p_complaint_type public.lirep_complaint_type,p_product_service_type text,p_product_service_description text,p_amount numeric,
 p_detail text,p_consumer_request text,p_consumer_conformity boolean,p_preferred_response_channel text
) returns text language sql immutable set search_path to '' as $$
 select encode(extensions.digest(convert_to(concat_ws('|',
  coalesce(p_organization_id::text,''),coalesce(p_establishment_id::text,''),coalesce(p_complaint_book_id::text,''),
  coalesce(p_document_type::text,''),lower(btrim(coalesce(p_document_number,''))),lower(btrim(coalesce(p_first_names,''))),
  lower(btrim(coalesce(p_last_names,''))),lower(btrim(coalesce(p_email,''))),btrim(coalesce(p_phone,'')),lower(btrim(coalesce(p_address,''))),
  coalesce(p_is_minor,false)::text,lower(btrim(coalesce(p_representative_first_names,''))),lower(btrim(coalesce(p_representative_last_names,''))),
  coalesce(p_representative_document_type::text,''),lower(btrim(coalesce(p_representative_document_number,''))),
  btrim(coalesce(p_representative_phone,'')),lower(btrim(coalesce(p_representative_email,''))),coalesce(p_complaint_type::text,''),
  lower(btrim(coalesce(p_product_service_type,''))),lower(btrim(coalesce(p_product_service_description,''))),coalesce(p_amount::text,''),
  btrim(coalesce(p_detail,'')),btrim(coalesce(p_consumer_request,'')),coalesce(p_consumer_conformity,false)::text,
  lower(btrim(coalesce(p_preferred_response_channel,'')))
 ),'UTF8'),'sha256'),'hex');
$$;

create or replace function public.lirep_create_complaint_internal(
 p_organization_id uuid,p_establishment_id uuid,p_complaint_book_id uuid,
 p_document_type public.lirep_consumer_document_type,p_document_number text,p_first_names text,p_last_names text,p_email text,
 p_phone text,p_address text,p_is_minor boolean,
 p_representative_first_names text,p_representative_last_names text,
 p_representative_document_type public.lirep_consumer_document_type,p_representative_document_number text,
 p_representative_phone text,p_representative_email text,
 p_complaint_type public.lirep_complaint_type,p_product_service_type text,p_product_service_description text,p_amount numeric,
 p_detail text,p_consumer_request text,p_consumer_conformity boolean,p_preferred_response_channel text
) returns uuid language plpgsql security definer set search_path to '' as $$
declare v_org public.organizations%rowtype; v_est public.establishments%rowtype; v_book public.complaint_books%rowtype;
 v_legal public.legal_versions%rowtype; v_consumer_id uuid; v_complaint_id uuid; v_sequence bigint; v_public_code text; v_submitted_at timestamptz:=now();
begin
 if p_organization_id is null or p_establishment_id is null or p_complaint_book_id is null then raise exception 'LIREP_REQUIRED_CONTEXT_MISSING'; end if;
 if p_document_type is null or nullif(btrim(coalesce(p_document_number,'')),'') is null then raise exception 'LIREP_CONSUMER_DOCUMENT_REQUIRED'; end if;
 if nullif(btrim(coalesce(p_first_names,'')),'') is null or nullif(btrim(coalesce(p_last_names,'')),'') is null then raise exception 'LIREP_CONSUMER_NAME_REQUIRED'; end if;
 if nullif(btrim(coalesce(p_phone,'')),'') is null then raise exception 'LIREP_CONSUMER_PHONE_REQUIRED'; end if;
 if nullif(btrim(coalesce(p_address,'')),'') is null then raise exception 'LIREP_CONSUMER_ADDRESS_REQUIRED'; end if;
 if p_complaint_type is null or nullif(btrim(coalesce(p_detail,'')),'') is null or nullif(btrim(coalesce(p_consumer_request,'')),'') is null then raise exception 'LIREP_COMPLAINT_DATA_REQUIRED'; end if;
 if coalesce(p_consumer_conformity,false) is not true then raise exception 'LIREP_CONSUMER_CONFORMITY_REQUIRED'; end if;
 if p_preferred_response_channel not in ('email','phone','physical') then raise exception 'LIREP_INVALID_RESPONSE_CHANNEL'; end if;
 if p_preferred_response_channel='email' and nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'LIREP_EMAIL_REQUIRED_FOR_RESPONSE'; end if;
 if coalesce(p_is_minor,false) and (nullif(btrim(coalesce(p_representative_first_names,'')),'') is null or nullif(btrim(coalesce(p_representative_last_names,'')),'') is null or p_representative_document_type is null or nullif(btrim(coalesce(p_representative_document_number,'')),'') is null) then raise exception 'LIREP_MINOR_REPRESENTATIVE_REQUIRED'; end if;
 select * into v_org from public.organizations where id=p_organization_id and active=true; if not found then raise exception 'LIREP_ORGANIZATION_NOT_AVAILABLE'; end if;
 select * into v_est from public.establishments where id=p_establishment_id and organization_id=p_organization_id and active=true; if not found then raise exception 'LIREP_ESTABLISHMENT_NOT_AVAILABLE'; end if;
 select * into v_book from public.complaint_books where id=p_complaint_book_id and organization_id=p_organization_id and establishment_id=p_establishment_id and active=true; if not found then raise exception 'LIREP_COMPLAINT_BOOK_NOT_AVAILABLE'; end if;
 select * into v_legal from public.legal_versions where active=true and effective_from <= (v_submitted_at at time zone 'America/Lima')::date and (effective_until is null or effective_until >= (v_submitted_at at time zone 'America/Lima')::date) order by effective_from desc,created_at desc limit 1;
 if not found then raise exception 'LIREP_ACTIVE_LEGAL_VERSION_NOT_FOUND'; end if;
 insert into public.consumers(organization_id,document_type,document_number,first_names,last_names,email,phone,address,is_minor,representative_first_names,representative_last_names,representative_document_type,representative_document_number,representative_phone,representative_email)
 values(p_organization_id,p_document_type,btrim(p_document_number),btrim(p_first_names),btrim(p_last_names),nullif(btrim(coalesce(p_email,'')),''),btrim(p_phone),btrim(p_address),coalesce(p_is_minor,false),nullif(btrim(coalesce(p_representative_first_names,'')),''),nullif(btrim(coalesce(p_representative_last_names,'')),''),p_representative_document_type,nullif(btrim(coalesce(p_representative_document_number,'')),''),nullif(btrim(coalesce(p_representative_phone,'')),''),nullif(btrim(coalesce(p_representative_email,'')),''))
 returning id into v_consumer_id;
 v_sequence:=public.lirep_next_book_number(p_organization_id,p_complaint_book_id);
 v_public_code:=public.lirep_build_public_code(v_org.public_prefix,v_book.code,v_sequence,v_submitted_at);
 insert into public.complaints(organization_id,establishment_id,complaint_book_id,consumer_id,legal_version_id,sequence_number,public_code,complaint_type,status,product_service_type,product_service_description,amount,detail,consumer_request,submitted_at,consumer_conformity,consumer_conformity_at,preferred_response_channel)
 values(p_organization_id,p_establishment_id,p_complaint_book_id,v_consumer_id,v_legal.id,v_sequence,v_public_code,p_complaint_type,'submitted',nullif(btrim(coalesce(p_product_service_type,'')),''),nullif(btrim(coalesce(p_product_service_description,'')),''),p_amount,btrim(p_detail),btrim(p_consumer_request),v_submitted_at,true,v_submitted_at,p_preferred_response_channel) returning id into v_complaint_id;
 insert into public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,old_data,new_data)
 values(p_organization_id,auth.uid(),'complaint.created','complaint',v_complaint_id,null,jsonb_build_object('public_code',v_public_code,'sequence_number',v_sequence,'status','submitted','minor',coalesce(p_is_minor,false),'conformity_at',v_submitted_at));
 return v_complaint_id;
end; $$;

create or replace function public.lirep_submit_public_complaint_server(
 p_idempotency_key uuid,p_organization_id uuid,p_establishment_id uuid,p_complaint_book_id uuid,
 p_document_type public.lirep_consumer_document_type,p_document_number text,p_first_names text,p_last_names text,p_email text,
 p_phone text,p_address text,p_is_minor boolean,p_representative_first_names text,p_representative_last_names text,
 p_representative_document_type public.lirep_consumer_document_type,p_representative_document_number text,p_representative_phone text,p_representative_email text,
 p_complaint_type public.lirep_complaint_type,p_product_service_type text,p_product_service_description text,p_amount numeric,p_detail text,p_consumer_request text,
 p_consumer_conformity boolean,p_preferred_response_channel text
) returns table(complaint_id uuid,public_code text,sequence_number bigint,submitted_at timestamptz,response_due_at timestamptz,duplicate boolean)
language plpgsql security definer set search_path to '' as $$
declare v_hash text; v_request public.public_submission_requests%rowtype; v_complaint_id uuid;
begin
 if p_idempotency_key is null then raise exception 'LIREP_IDEMPOTENCY_KEY_REQUIRED'; end if;
 v_hash:=public.lirep_public_submission_hash(p_organization_id,p_establishment_id,p_complaint_book_id,p_document_type,p_document_number,p_first_names,p_last_names,p_email,p_phone,p_address,p_is_minor,p_representative_first_names,p_representative_last_names,p_representative_document_type,p_representative_document_number,p_representative_phone,p_representative_email,p_complaint_type,p_product_service_type,p_product_service_description,p_amount,p_detail,p_consumer_request,p_consumer_conformity,p_preferred_response_channel);
 insert into public.public_submission_requests(organization_id,establishment_id,complaint_book_id,idempotency_key,request_hash,status)
 values(p_organization_id,p_establishment_id,p_complaint_book_id,p_idempotency_key,v_hash,'processing') on conflict(organization_id,idempotency_key) do nothing;
 select * into v_request from public.public_submission_requests where organization_id=p_organization_id and idempotency_key=p_idempotency_key for update;
 if not found then raise exception 'LIREP_IDEMPOTENCY_RESERVATION_FAILED'; end if;
 if v_request.request_hash is distinct from v_hash then raise exception 'LIREP_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST'; end if;
 if v_request.status='completed' and v_request.complaint_id is not null then
  return query select c.id,c.public_code,c.sequence_number,c.submitted_at,c.response_due_at,true from public.complaints c where c.organization_id=p_organization_id and c.id=v_request.complaint_id; return;
 end if;
 v_complaint_id:=public.lirep_create_complaint_internal(p_organization_id,p_establishment_id,p_complaint_book_id,p_document_type,p_document_number,p_first_names,p_last_names,p_email,p_phone,p_address,p_is_minor,p_representative_first_names,p_representative_last_names,p_representative_document_type,p_representative_document_number,p_representative_phone,p_representative_email,p_complaint_type,p_product_service_type,p_product_service_description,p_amount,p_detail,p_consumer_request,p_consumer_conformity,p_preferred_response_channel);
 update public.public_submission_requests set complaint_id=v_complaint_id,status='completed',completed_at=now() where id=v_request.id;
 return query select c.id,c.public_code,c.sequence_number,c.submitted_at,c.response_due_at,false from public.complaints c where c.organization_id=p_organization_id and c.id=v_complaint_id;
end; $$;

create or replace function public.lirep_submit_public_complaint_gateway(
 p_idempotency_key uuid,p_public_prefix text,p_establishment_code text,p_book_code text,
 p_document_type public.lirep_consumer_document_type,p_document_number text,p_first_names text,p_last_names text,p_email text,
 p_phone text,p_address text,p_is_minor boolean,p_representative_first_names text,p_representative_last_names text,
 p_representative_document_type public.lirep_consumer_document_type,p_representative_document_number text,p_representative_phone text,p_representative_email text,
 p_complaint_type public.lirep_complaint_type,p_product_service_type text,p_product_service_description text,p_amount numeric,p_detail text,p_consumer_request text,
 p_consumer_conformity boolean,p_preferred_response_channel text
) returns table(complaint_id uuid,public_code text,sequence_number bigint,submitted_at timestamptz,response_due_at timestamptz,duplicate boolean)
language plpgsql security definer set search_path to '' as $$
declare v_prefix text:=upper(btrim(coalesce(p_public_prefix,''))); v_est_code text:=upper(btrim(coalesce(p_establishment_code,''))); v_book_code text:=upper(btrim(coalesce(p_book_code,''))); v_org uuid; v_est uuid; v_book uuid;
begin
 if p_idempotency_key is null then raise exception 'LIREP_IDEMPOTENCY_KEY_REQUIRED'; end if;
 if v_prefix !~ '^[A-Z0-9]{8}$' then raise exception 'LIREP_INVALID_PUBLIC_PREFIX'; end if;
 select id into v_org from public.organizations where public_prefix=v_prefix and active=true limit 1; if not found then raise exception 'LIREP_PUBLIC_FORM_NOT_AVAILABLE'; end if;
 select id into v_est from public.establishments where organization_id=v_org and upper(code)=v_est_code and active=true limit 1; if not found then raise exception 'LIREP_ESTABLISHMENT_NOT_AVAILABLE'; end if;
 select id into v_book from public.complaint_books where organization_id=v_org and establishment_id=v_est and upper(code)=v_book_code and active=true limit 1; if not found then raise exception 'LIREP_COMPLAINT_BOOK_NOT_AVAILABLE'; end if;
 return query select * from public.lirep_submit_public_complaint_server(p_idempotency_key,v_org,v_est,v_book,p_document_type,p_document_number,p_first_names,p_last_names,p_email,p_phone,p_address,p_is_minor,p_representative_first_names,p_representative_last_names,p_representative_document_type,p_representative_document_number,p_representative_phone,p_representative_email,p_complaint_type,p_product_service_type,p_product_service_description,p_amount,p_detail,p_consumer_request,p_consumer_conformity,p_preferred_response_channel);
end; $$;

revoke all on function public.lirep_submit_public_complaint_gateway(uuid,text,text,text,public.lirep_consumer_document_type,text,text,text,text,text,text,boolean,text,text,public.lirep_consumer_document_type,text,text,text,public.lirep_complaint_type,text,text,numeric,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.lirep_submit_public_complaint_gateway(uuid,text,text,text,public.lirep_consumer_document_type,text,text,text,text,text,text,boolean,text,text,public.lirep_consumer_document_type,text,text,text,public.lirep_complaint_type,text,text,numeric,text,text,boolean,text) to service_role;

revoke all on function public.lirep_submit_public_complaint_server(uuid,uuid,uuid,uuid,public.lirep_consumer_document_type,text,text,text,text,text,text,boolean,text,text,public.lirep_consumer_document_type,text,text,text,public.lirep_complaint_type,text,text,numeric,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.lirep_submit_public_complaint_server(uuid,uuid,uuid,uuid,public.lirep_consumer_document_type,text,text,text,text,text,text,boolean,text,text,public.lirep_consumer_document_type,text,text,text,public.lirep_complaint_type,text,text,numeric,text,text,boolean,text) to service_role;

commit;
