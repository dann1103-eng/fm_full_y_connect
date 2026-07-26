-- 0083_ai_jobs_bot_user_fix.sql
-- Crea la fila auth.users para FM Bot antes de insertar en public.users.
-- Necesario porque public.users.id tiene FK a auth.users.id (ver 0001_init.sql).
-- El bot nunca se autentica: encrypted_password queda nulo y email_confirmed_at = now().
--
-- También re-aplica la relajación del CHECK de role (idempotente) por si la
-- 0082 hizo rollback al fallar la inserción original.

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('admin','supervisor','operator','client','agent'));

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000b07',
  'authenticated',
  'authenticated',
  'bot@fullefm.site',
  null,
  now(),
  null,
  null,
  '{"provider":"system","providers":[]}'::jsonb,
  '{"full_name":"FM Bot","is_system":true}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

-- Ahora sí, la fila en public.users (idempotente).
insert into public.users (id, email, full_name, role)
values (
  '00000000-0000-0000-0000-000000000b07',
  'bot@fullefm.site',
  'FM Bot',
  'agent'
)
on conflict (id) do update
  set role      = 'agent',
      full_name = excluded.full_name;
