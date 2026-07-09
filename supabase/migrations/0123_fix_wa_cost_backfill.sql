-- 0123_fix_wa_cost_backfill.sql
-- Corrección retroactiva de ai_jobs.cost_usd_cents inflado ~100x.
--
-- CAUSA: el handler whatsappReply.ts calculaba el costo con coeficientes que YA
-- estaban en céntimos por token (0.0003 = $3/M, 0.00003 = $0.30/M, 0.0015 = $15/M)
-- y ADEMÁS multiplicaba la suma por *100, inflando el resultado ~100 veces.
-- El fix del handler (constantes USD_PER_MTOK_* + /1_000_000) ya elimina el *100.
--
-- ALCANCE: SOLO los jobs 'whatsapp_reply' escriben cost_usd_cents. 'whatsapp_template'
-- lo deja NULL y no hay otros handlers que lo escriban → el WHERE es seguro.
--
-- ORDEN DE APLICACIÓN (importante):
--   1) Desplegar PRIMERO el fix del handler a producción (Vercel).
--   2) Aplicar ESTA migración inmediatamente después.
-- v_cutoff = now() captura exactamente las filas viejas (infladas) que existen al
-- aplicar. Las filas nuevas que escribe el código ya corregido tienen created_at
-- >= now() y quedan EXCLUIDAS. La tabla-marcador evita dividir dos veces aunque
-- la migración se ejecute de nuevo.

-- Marcador reusable para correcciones one-shot (idempotencia dura).
create table if not exists public.oneshot_backfills (
  key            text primary key,
  applied_at     timestamptz not null default now(),
  rows_affected  integer
);

do $$
declare
  v_cutoff constant timestamptz := now();  -- momento de aplicación = frontera viejo/nuevo
  v_rows   integer;
begin
  if exists (select 1 from public.oneshot_backfills where key = '0123_wa_cost_100x') then
    raise notice '0123_wa_cost_100x ya aplicado; no se hace nada.';
    return;
  end if;

  update public.ai_jobs
     set cost_usd_cents = ceil(cost_usd_cents / 100.0)  -- 450 -> 5, 396 -> 4, 1890 -> 19
   where job_type = 'whatsapp_reply'
     and cost_usd_cents is not null
     and created_at < v_cutoff;
  get diagnostics v_rows = row_count;

  insert into public.oneshot_backfills(key, rows_affected)
  values ('0123_wa_cost_100x', v_rows);

  raise notice '0123_wa_cost_100x aplicado: % filas corregidas (÷100).', v_rows;
end $$;
