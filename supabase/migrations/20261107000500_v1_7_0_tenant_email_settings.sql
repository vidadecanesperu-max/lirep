-- LIREP 1.7.0 | activate transactional receipt sender for verified tenants.
BEGIN;
CREATE OR REPLACE FUNCTION public.lirep_onboarding_email_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status='active' AND OLD.status IS DISTINCT FROM 'active'
     AND NEW.organization_id IS NOT NULL THEN
    INSERT INTO public.organization_email_settings
      (organization_id,provider,from_name,from_email,reply_to,internal_notification_emails,is_active)
    VALUES (
      NEW.organization_id,'resend',
      left('Libro de Reclamaciones - ' || coalesce(nullif(NEW.trade_name,''),NEW.legal_name),120),
      'lirep@mail.vidadecanes.pe',
      NEW.contact_email,
      ARRAY[NEW.contact_email],
      true
    )
    ON CONFLICT (organization_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lirep_onboarding_email_settings ON public.lirep_onboarding_requests;
CREATE TRIGGER trg_lirep_onboarding_email_settings
  AFTER UPDATE OF status ON public.lirep_onboarding_requests
  FOR EACH ROW EXECUTE FUNCTION public.lirep_onboarding_email_settings();
REVOKE ALL ON FUNCTION public.lirep_onboarding_email_settings() FROM PUBLIC, anon, authenticated;
COMMIT;
