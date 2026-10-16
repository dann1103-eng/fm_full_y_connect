-- 0132_users_skip_idle_prompt.sql
-- Marca a los usuarios que NO deben recibir el aviso "¿Sigues en línea?".
--
-- CONTEXTO: a las 18:00 y cada 2 h de noche el sistema muestra un aviso con cuenta
-- regresiva de 60 s; si nadie responde, cierra los timers, la jornada y la sesión.
-- Los agentes de IA entran por navegador como una persona más (rol admin), nadie ve ese
-- aviso y quedaban desconectados. El rol no sirve para distinguirlos, así que se modela
-- como flag por usuario, movible con un update y sin redeploy.
--
-- No se siembra ningún valor: por defecto todos siguen recibiendo el aviso.
--
--   -- 1) Identificar a los agentes:
--   select id, full_name, email, role, skip_idle_prompt from public.users order by full_name;
--   -- 2) Marcarlos (ajustar el filtro a sus correos reales):
--   update public.users set skip_idle_prompt = true where email in ('a@x.com', 'b@x.com');
--   -- 3) Revertir:
--   update public.users set skip_idle_prompt = false where email = 'a@x.com';

alter table public.users
  add column if not exists skip_idle_prompt boolean not null default false;

comment on column public.users.skip_idle_prompt is
  'No recibe el aviso "¿Sigues en línea?" ni el cierre de sesión por falta de respuesta. Para agentes de IA que operan por navegador.';
