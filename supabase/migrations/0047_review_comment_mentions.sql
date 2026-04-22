-- Menciones en comentarios de la feature de Revisión (0044).
-- Paralela a `requirement_mentions` (0041): cada fila es una mención específica
-- de un usuario dentro de un comentario de pin. El notif feed la expone como
-- `kind: 'mention'` con campos extra que identifican el pin y el asset.

create table if not exists public.review_comment_mentions (
  id                    uuid primary key default gen_random_uuid(),
  comment_id            uuid not null references public.review_comments(id) on delete cascade,
  requirement_id        uuid not null references public.requirements(id) on delete cascade,
  mentioned_user_id     uuid not null references public.users(id) on delete cascade,
  mentioned_by_user_id  uuid references public.users(id) on delete set null,
  read_at               timestamptz,
  created_at            timestamptz not null default now(),
  unique (comment_id, mentioned_user_id)
);

create index if not exists review_comment_mentions_user_unread_idx
  on public.review_comment_mentions (mentioned_user_id, created_at desc)
  where read_at is null;

create index if not exists review_comment_mentions_comment_idx
  on public.review_comment_mentions (comment_id);

alter table public.review_comment_mentions enable row level security;

-- SELECT: usuario mencionado, quien menciona, o admin
create policy "review_mentions_select"
  on public.review_comment_mentions for select
  using (
    mentioned_user_id = auth.uid()
    or mentioned_by_user_id = auth.uid()
    or public.is_admin()
  );

-- INSERT: cualquier agency user (lo inserta el server action con admin client,
-- pero dejamos la policy por consistencia con el patrón del resto del CRM)
create policy "review_mentions_insert"
  on public.review_comment_mentions for insert
  with check (public.is_agency_user());

-- UPDATE: el propio usuario mencionado (para marcar como leída)
create policy "review_mentions_update_own"
  on public.review_comment_mentions for update
  using (mentioned_user_id = auth.uid());

-- GRANTs requeridos para PostgREST
grant all on public.review_comment_mentions to anon, authenticated, service_role;

-- Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.review_comment_mentions';
  end if;
exception when duplicate_object then
  null;
end$$;

notify pgrst, 'reload schema';
