-- LIREP V1.12.0 · Constancia electrónica pública
-- Adds a least-privilege server-only RPC to obtain the immutable receipt data
-- by organization public prefix + public complaint code.

create or replace function public.lirep_public_receipt_data(
  p_public_prefix text,
  p_public_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_public_prefix is null or p_public_prefix !~ '^[A-Z0-9]{8}$' then
    raise exception 'INVALID_PUBLIC_PREFIX';
  end if;

  select jsonb_build_object(
    'public_code', c.public_code,
    'sequence_number', c.sequence_number,
    'submitted_at', c.submitted_at,
    'response_due_at', c.response_due_at,
    'complaint_type', c.complaint_type,
    'product_service_type', c.product_service_type,
    'product_service_description', c.product_service_description,
    'amount', c.amount,
    'detail', c.detail,
    'consumer_request', c.consumer_request,
    'preferred_response_channel', c.preferred_response_channel,
    'consumer_conformity', c.consumer_conformity,
    'consumer_conformity_at', c.consumer_conformity_at,
    'consumer', jsonb_build_object(
      'document_type', co.document_type,
      'document_number', co.document_number,
      'first_names', co.first_names,
      'last_names', co.last_names,
      'email', co.email,
      'phone', co.phone,
      'address', co.address,
      'is_minor', co.is_minor,
      'representative_first_names', co.representative_first_names,
      'representative_last_names', co.representative_last_names,
      'representative_document_type', co.representative_document_type,
      'representative_document_number', co.representative_document_number,
      'representative_phone', co.representative_phone,
      'representative_email', co.representative_email
    ),
    'organization', jsonb_build_object(
      'legal_name', o.legal_name,
      'trade_name', o.trade_name,
      'ruc', o.ruc,
      'public_prefix', o.public_prefix
    ),
    'establishment', jsonb_build_object(
      'code', e.code,
      'name', e.name,
      'address', e.address,
      'district', e.district,
      'province', e.province,
      'department', e.department,
      'is_virtual', e.is_virtual
    ),
    'book', jsonb_build_object('code', cb.code)
  )
  into v_result
  from public.complaints c
  join public.organizations o on o.id = c.organization_id
  join public.consumers co on co.id = c.consumer_id
  join public.complaint_books cb on cb.id = c.complaint_book_id
  join public.establishments e on e.id = cb.establishment_id
  where o.public_prefix = p_public_prefix
    and c.public_code = p_public_code
  limit 1;

  if v_result is null then
    raise exception 'RECEIPT_NOT_FOUND';
  end if;

  return v_result;
end;
$$;

revoke all on function public.lirep_public_receipt_data(text,text) from public, anon, authenticated;
grant execute on function public.lirep_public_receipt_data(text,text) to service_role;

comment on function public.lirep_public_receipt_data(text,text)
is 'Server-only receipt data lookup. Requires both tenant public prefix and complaint public code.';
