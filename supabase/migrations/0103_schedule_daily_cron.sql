-- Migración 0103: Programar daily-cycle-runner con pg_cron (deja el cron en el repo)
--
-- Contexto: el schedule del Edge Function vivía SOLO en el dashboard de Supabase,
-- así que podía perderse silenciosamente sin dejar rastro en el código. Esto lo
-- deja versionado y reproducible.
--
-- Los secretos (URL del proyecto + service role key) se leen desde Vault para NO
-- hardcodearlos en git. Hay que insertarlos UNA sola vez (ver pasos al pie).
--
-- Invoca el Edge Function todos los días a las 6:00 AM UTC, igual que antes.

-- ── 1. Extensiones (disponibles en Supabase) ─────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 2. (Re)programar el job de forma idempotente ─────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-cycle-runner') then
    perform cron.unschedule('daily-cycle-runner');
  end if;
end $$;

select cron.schedule(
  'daily-cycle-runner',
  '0 6 * * *',                 -- 6:00 AM UTC diario (misma hora que el cron original)
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/daily-cycle-runner',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    timeout_milliseconds := 120000
  );
  $job$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PASOS ÚNICOS (correr en el SQL Editor — NO commitear con los valores reales):
--
-- 1) Guardar los secretos en Vault (reemplazar con tus valores reales):
--      select vault.create_secret('https://TU-PROJECT-REF.supabase.co', 'project_url');
--      select vault.create_secret('TU_SERVICE_ROLE_KEY',                'service_role_key');
--
-- 2) Verificar que el job quedó registrado:
--      select jobid, jobname, schedule, active from cron.job;
--
-- 3) Probarlo YA sin esperar a las 6 AM (dispara la función de inmediato):
--      select net.http_post(
--        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
--               || '/functions/v1/daily-cycle-runner',
--        headers := jsonb_build_object(
--          'Content-Type','application/json',
--          'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
--        )
--      );
--
-- 4) Ver el historial de ejecuciones del cron:
--      select * from cron.job_run_details order by start_time desc limit 10;
--
-- NOTA: si pg_net quedó instalado en el schema `extensions` en lugar de `net`,
-- cambiar `net.http_post(...)` por `extensions.http_post(...)`.
-- ─────────────────────────────────────────────────────────────────────────────
