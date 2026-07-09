-- 0124_claim_ai_job_watchdog.sql
-- Watchdog para jobs colgados en status='processing'.
--
-- PROBLEMA: claim_ai_job (0082) solo reclama status='pending'. Si la función
-- serverless muere entre claim_ai_job (que ya puso 'processing' + incrementó
-- attempts) y completeJob/failJob, la fila queda 'processing' PARA SIEMPRE:
-- nunca se completa, nunca reintenta. locked_at/locked_by se escriben pero
-- nunca se usaban para recuperar. Efectos: filas huérfanas acumuladas, el turno
-- que se cayó no se reintenta, y posible doble-respuesta si murió tras enviar.
-- (El índice de dedupe ai_jobs_one_pending_per_wa_conv solo mira 'pending', así
-- que una conversación NO queda muda; por eso es un hallazgo secundario.)
--
-- FIX: la misma RPC también reclama jobs 'processing' cuyo locked_at es más viejo
-- que el umbral (5 min, muy por encima del máximo de una invocación serverless)
-- y que aún no agotaron attempts. Al reclamarlos se re-ejecutan (retry real) o,
-- si vuelven a fallar hasta max_attempts, failJob los marca 'failed'.
--
-- Se mantiene la firma (text, text[]) → create or replace reemplaza el cuerpo sin
-- crear overload; los grants/revokes de 0082 siguen vigentes.

create or replace function public.claim_ai_job(
  p_worker_id text,
  p_job_types text[] default null
)
returns public.ai_jobs
language plpgsql
security definer
as $$
declare
  j public.ai_jobs;
begin
  update public.ai_jobs
     set status      = 'processing',
         locked_at   = now(),
         locked_by   = p_worker_id,
         started_at  = coalesce(started_at, now()),
         attempts    = attempts + 1
   where id = (
     select id
       from public.ai_jobs
      where (p_job_types is null or job_type = any(p_job_types))
        and (
              -- caso normal: pendiente y ya elegible
              (status = 'pending' and scheduled_for <= now())
              -- rescate: colgado en processing más de 5 min y con reintentos disponibles
           or (status = 'processing'
               and locked_at < now() - interval '5 minutes'
               and attempts < max_attempts)
        )
      order by (status = 'processing') desc,  -- rescatar colgados antes que tomar nuevos
               priority asc,
               scheduled_for asc
      for update skip locked
      limit 1
   )
   returning * into j;

  return j;
end
$$;
