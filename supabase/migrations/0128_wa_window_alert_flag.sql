-- 0128_wa_window_alert_flag.sql
-- Notificación "la ventana de 24h está por cerrar y nadie ha contestado".
--
-- CONTEXTO: WhatsApp solo permite texto libre dentro de las 24h siguientes al
-- último mensaje del cliente. Se perdió la respuesta a un lead comercial por 28
-- minutos porque nadie notó que la ventana estaba cerrando.
--
-- A diferencia de los handoffs (que van a TODO admin/supervisor), este aviso es
-- dirigido: por decisión del dueño solo lo reciben las personas responsables de
-- contestar (Laura y Samuel). Se modela como flag por usuario y no con nombres
-- en el código, para poder moverlo sin redeploy:
--
--   -- activar a alguien más:
--   update public.users set notify_wa_window = true where email = 'persona@fm.com';
--   -- desactivar (p. ej. vacaciones):
--   update public.users set notify_wa_window = false where email = 'persona@fm.com';

alter table public.users
  add column if not exists notify_wa_window boolean not null default false;

comment on column public.users.notify_wa_window is
  'Recibe el aviso de ventana de 24h de WhatsApp por cerrar sin respuesta. Dirigido a quienes contestan conversaciones, no a todo el staff.';

-- Seed inicial por nombre. Es best-effort: VERIFICA a quién le pegó con la
-- consulta de abajo y corrige con un update si hizo falta.
update public.users
set notify_wa_window = true
where role in ('admin', 'supervisor')
  and (full_name ilike '%laura%' or full_name ilike '%samuel%');

-- VERIFICACIÓN (correr aparte):
--   select id, full_name, email, role, notify_wa_window
--   from public.users
--   where role in ('admin','supervisor')
--   order by notify_wa_window desc, full_name;
