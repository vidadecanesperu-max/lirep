-- LIREP QA233: contacto complementario por WhatsApp sin sustituir el correo oficial.
-- Es una ampliación de valores admitidos, no una modificación de expedientes previos.
alter table public.complaints
  drop constraint complaints_preferred_response_channel_check;
alter table public.complaints
  add constraint complaints_preferred_response_channel_check
  check (
    preferred_response_channel is null
    or preferred_response_channel in ('email','phone','physical','whatsapp')
  );
comment on column public.complaints.preferred_response_channel is
  'Canal elegido en el registro: desde QA233 es preferencia de contacto complementario; la respuesta formal del formulario electrónico se notifica por email. Los registros anteriores conservan su significado histórico.';
