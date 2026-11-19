-- QA234 Phase 1. Permission and delivery channel:
-- All changes tenant-scoped; no historical response approved automatically.
alter table public.lirep_admin_official_responses
  drop constraint lirep_a10_distinct_reviewer;

alter table public.complaints
  add column if not exists official_delivery_method text;
alter table public.complaints
  add constraint lirep_official_delivery_method_check
  check (official_delivery_method is null or official_delivery_method in ('email','postal'));
comment on column public.complaints.official_delivery_method is
'Formal written response: email or postal letter, independent from preferred_response_channel. NULL on older complaints is interpreted from existing contact details.';

CREATE OR REPLACE FUNCTION public.lirep_admin_a10_response_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_body text;
BEGIN

  IF TG_OP = 'INSERT' THEN

    IF NEW.status <> 'pending_approval'
      OR NEW.reviewed_by IS NOT NULL
      OR NEW.reviewed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'INVALID_INITIAL_RESPONSE_STATE';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.complaints c
      WHERE c.id = NEW.complaint_id
        AND c.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'CROSS_TENANT_COMPLAINT';
    END IF;

    SELECT e.body
    INTO v_body
    FROM public.lirep_admin_case_entries e
    WHERE e.id = NEW.source_entry_id
      AND e.organization_id = NEW.organization_id
      AND e.complaint_id = NEW.complaint_id
      AND e.kind = 'response_draft'
      AND e.created_by IS NOT NULL;

    IF v_body IS NULL
      OR NEW.body IS DISTINCT FROM v_body
    THEN
      RAISE EXCEPTION 'INVALID_SOURCE_DRAFT';
    END IF;

    RETURN NEW;

  END IF;

  IF TG_OP = 'UPDATE' THEN

    -- Proteger todos los campos excepto
    -- los estrictamente necesarios para revisar.

    IF (
      to_jsonb(NEW) -
        ARRAY[
          'status',
          'reviewed_by',
          'reviewed_at',
          'review_note'
        ]
    ) IS DISTINCT FROM (
      to_jsonb(OLD) -
        ARRAY[
          'status',
          'reviewed_by',
          'reviewed_at',
          'review_note'
        ]
    ) THEN
      RAISE EXCEPTION 'RESPONSE_CONTENT_IMMUTABLE';
    END IF;

    -- Una respuesta revisada nunca se reabre
    -- ni se modifica nuevamente.

    IF OLD.status <> 'pending_approval' THEN
      RAISE EXCEPTION 'RESPONSE_ALREADY_REVIEWED';
    END IF;

    IF NEW.status NOT IN ('approved', 'rejected')
      OR NEW.reviewed_by IS NULL
      OR NEW.reviewed_at IS NULL
    THEN
      RAISE EXCEPTION 'INVALID_REVIEW_TRANSITION';
    END IF;

    IF NEW.status = 'rejected'
      AND nullif(
        btrim(coalesce(NEW.review_note, '')), ''
      ) IS NULL
    THEN
      RAISE EXCEPTION 'REJECTION_REASON_REQUIRED';
    END IF;

    RETURN NEW;

  END IF;

  RAISE EXCEPTION 'RESPONSE_DELETE_FORBIDDEN';

END;
$function$;


CREATE OR REPLACE FUNCTION public.lirep_admin_a10_review(p_organization_id uuid, p_response_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_response
    public.lirep_admin_official_responses%rowtype;

  v_action text;
  v_note text;
BEGIN

  IF (SELECT auth.uid()) IS NULL
    OR NOT (
      public.lirep_admin_is_owner()
      OR EXISTS (
        SELECT 1
        FROM public.lirep_admin_memberships m
        WHERE m.user_id = (SELECT auth.uid())
          AND m.organization_id = p_organization_id
          AND m.active = true
          AND m.role = 'company_admin'
      )
    )
  THEN
    RAISE EXCEPTION 'APPROVAL_ACCESS_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
      AND o.active = true
  ) THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_AVAILABLE'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_response
  FROM public.lirep_admin_official_responses
  WHERE id = p_response_id
    AND organization_id = p_organization_id
  FOR UPDATE;

  IF v_response.id IS NULL THEN
    RAISE EXCEPTION 'RESPONSE_NOT_FOUND'
      USING ERRCODE = '22023';
  END IF;

  IF v_response.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'RESPONSE_NOT_PENDING'
      USING ERRCODE = '22023';
  END IF;
  -- Authorized administrators may approve their own drafts (QA234).


  v_note := nullif(btrim(coalesce(p_note, '')), '');

  IF length(coalesce(v_note, '')) > 2000 THEN
    RAISE EXCEPTION 'REVIEW_NOTE_TOO_LONG'
      USING ERRCODE = '22023';
  END IF;

  IF NOT p_approve
    AND v_note IS NULL
  THEN
    RAISE EXCEPTION 'REJECTION_REASON_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  IF p_approve AND v_response.submitted_by = (SELECT auth.uid()) THEN
    v_note := coalesce(v_note, 'Autoaprobación por administrador autorizado');
  END IF;

  v_action := CASE
    WHEN p_approve THEN 'approved'
    ELSE 'rejected'
  END;

  UPDATE public.lirep_admin_official_responses
  SET
    status = v_action,
    reviewed_by = (SELECT auth.uid()),
    reviewed_at = now(),
    review_note = v_note
  WHERE id = p_response_id;

  INSERT INTO
  public.lirep_admin_response_audit (
    organization_id,
    complaint_id,
    response_id,
    action,
    actor_id,
    note
  )
  VALUES (
    p_organization_id,
    v_response.complaint_id,
    p_response_id,
    v_action,
    (SELECT auth.uid()),
    v_note
  );

  RETURN jsonb_build_object(
    'ok', true,
    'response_id', p_response_id,
    'status', v_action,
    'email_sent', false
  );

END;
$function$;


-- Do not enqueue postal responses, even when a secondary email address exists.
create or replace function public.lirep_admin_queue_approved_response()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_email text; v_method text;
begin
  if new.status='approved' and old.status='pending_approval' then
    select nullif(btrim(coalesce(case when c.is_minor then co.representative_email else co.email end,'')),''),
           coalesce(c.official_delivery_method,
             case when nullif(btrim(coalesce(case when c.is_minor then co.representative_email else co.email end,'')),'') is not null
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
end $$;

-- Same gateway signature plus a 26th input, allowing atomic choice of
-- formal delivery method without modifying the previous gateway.
create function public.lirep_submit_public_complaint_gateway(
  p_idempotency_key uuid, p_public_prefix text, p_establishment_code text,
  p_book_code text, p_document_type public.lirep_consumer_document_type,
  p_document_number text, p_first_names text, p_last_names text,
  p_email text, p_phone text, p_address text, p_is_minor boolean,
  p_representative_first_names text, p_representative_last_names text,
  p_representative_document_type public.lirep_consumer_document_type,
  p_representative_document_number text,p_representative_phone text,
  p_representative_email text,p_complaint_type public.lirep_complaint_type,
  p_product_service_type text,p_product_service_description text,p_amount numeric,
  p_detail text,p_consumer_request text,p_consumer_conformity boolean,
  p_preferred_response_channel text,p_official_delivery_method text
)
returns table(complaint_id uuid,public_code text,sequence_number bigint,
              submitted_at timestamptz,response_due_at timestamptz,duplicate boolean)
language plpgsql security definer set search_path=''
as $$
declare v record; v_current text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'LIREP_SUBMISSION_ACCESS_DENIED' using errcode='42501';
  end if;
  if p_official_delivery_method not in ('email','postal') or p_official_delivery_method is null then
    raise exception 'LIREP_INVALID_DELIVERY_METHOD' using errcode='22023';
  end if;
  if p_official_delivery_method='email' and
     (coalesce(nullif(btrim(case when p_is_minor then p_representative_email else p_email end),''),'')='' or
      btrim(case when p_is_minor then p_representative_email else p_email end) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  then
    raise exception 'LIREP_OFFICIAL_EMAIL_REQUIRED' using errcode='22023';
  end if;
  if p_official_delivery_method='postal' and nullif(btrim(coalesce(p_address,'')),'') is null then
    raise exception 'LIREP_POSTAL_ADDRESS_REQUIRED' using errcode='22023';
  end if;
  select * into v from public.lirep_submit_public_complaint_gateway(
    p_idempotency_key,p_public_prefix,p_establishment_code,p_book_code,
    p_document_type,p_document_number,p_first_names,p_last_names,p_email,
    p_phone,p_address,p_is_minor,p_representative_first_names,
    p_representative_last_names,p_representative_document_type,
    p_representative_document_number,p_representative_phone,
    p_representative_email,p_complaint_type,p_product_service_type,
    p_product_service_description,p_amount,p_detail,p_consumer_request,
    p_consumer_conformity,p_preferred_response_channel
  );
  if v.complaint_id is null then raise exception 'LIREP_SUBMISSION_MISSING'; end if;
  select c.official_delivery_method into v_current
  from public.complaints c where c.id=v.complaint_id
    and c.organization_id=(select id from public.organizations where public_prefix=upper(btrim(p_public_prefix)))
  for update;
  if v_current is not null and v_current<>p_official_delivery_method then
    raise exception 'LIREP_IDEMPOTENCY_METHOD_MISMATCH' using errcode='23505';
  end if;
  update public.complaints c set official_delivery_method=p_official_delivery_method
    where c.id=v.complaint_id and c.official_delivery_method is distinct from p_official_delivery_method;
  return query select v.complaint_id::uuid,v.public_code::text,v.sequence_number::bigint,
    v.submitted_at::timestamptz,v.response_due_at::timestamptz,v.duplicate::boolean;
end $$;

revoke all on function public.lirep_submit_public_complaint_gateway(
  uuid,text,text,text,public.lirep_consumer_document_type,text,text,text,text,text,text,boolean,
  text,text,public.lirep_consumer_document_type,text,text,text,public.lirep_complaint_type,
  text,text,numeric,text,text,boolean,text,text
) from PUBLIC,anon,authenticated;
grant execute on function public.lirep_submit_public_complaint_gateway(
  uuid,text,text,text,public.lirep_consumer_document_type,text,text,text,text,text,text,boolean,
  text,text,public.lirep_consumer_document_type,text,text,text,public.lirep_complaint_type,
  text,text,numeric,text,text,boolean,text,text
) to service_role;
