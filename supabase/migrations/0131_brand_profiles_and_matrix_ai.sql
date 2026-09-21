-- 0131_brand_profiles_and_matrix_ai.sql
-- Creador de matrices · Bloque 3 (asistencia con IA). Dos cosas:
--   1) client_brand_profiles — el perfil de marca del cliente, entrada OBLIGATORIA de la generación.
--      Sin él la IA escribe texto genérico y nadie vuelve a apretar el botón.
--   2) Los enlaces que atan un job de IA a su matriz (padre) o a su pieza (hijo), con los candados
--      que impiden dos generaciones vivas sobre la misma matriz o dos redacciones sobre la misma pieza.
-- Spec: docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-3-design.md
--
-- Topes de longitud (checks *_chk): mismos valores que BRAND_TEXT_LIMITS en src/lib/domain/brand.ts,
-- que la UI usa además como `maxLength`. Igual que con MATRIX_TEXT_LIMITS (0129): Postgres char_length
-- cuenta code points y la app mide la longitud UTF-16 (.length, >= code points), así que el check de la
-- base nunca es más estricto que la app; si se cambia un tope, se cambia en los tres lados.
--
-- Lo que la base NO valida: el largo de CADA elemento de base_hashtags (40) y de sample_copies (1000).
-- Un check no puede recorrer un array sin una subconsulta, así que esos dos topes los valida la app
-- (validateBrandPatch) y solo ella. Sí van aquí el jsonb_typeof = 'array', el tope de 5 copys, el de
-- 15 hashtags y el check de `person`.

begin;

-- Los FK (clients/users/content_matrices/content_matrix_items) toman locks breves; preferimos fallar
-- rápido a encolar los writes de la app si una sesión retiene un row lock (convención de 0129/0130).
set local lock_timeout = '5s';

-- ── 1. client_brand_profiles ────────────────────────────────────────────────
create table if not exists public.client_brand_profiles (
  client_id          uuid primary key references public.clients(id) on delete cascade,
  tone               text,
  -- Persona gramatical. En El Salvador esto se equivoca solo y se nota en cada copy.
  person             text,
  audience           text,
  value_proposition  text,
  offerings          text,
  avoid              text,
  base_hashtags      text[],
  sample_copies      jsonb,
  updated_by_user_id uuid references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint client_brand_profiles_tone_chk
    check (tone is null or char_length(tone) <= 500),
  constraint client_brand_profiles_person_chk
    check (person is null or person in ('voseo','tuteo','usted')),
  constraint client_brand_profiles_audience_chk
    check (audience is null or char_length(audience) <= 800),
  constraint client_brand_profiles_value_proposition_chk
    check (value_proposition is null or char_length(value_proposition) <= 800),
  constraint client_brand_profiles_offerings_chk
    check (offerings is null or char_length(offerings) <= 1500),
  constraint client_brand_profiles_avoid_chk
    check (avoid is null or char_length(avoid) <= 1000),
  constraint client_brand_profiles_base_hashtags_chk
    check (array_length(base_hashtags, 1) is null or array_length(base_hashtags, 1) <= 15),
  constraint client_brand_profiles_sample_copies_chk
    check (sample_copies is null or (jsonb_typeof(sample_copies) = 'array' and jsonb_array_length(sample_copies) <= 5))
);

-- updated_at (reusa public.update_updated_at() de 0001_init.sql, como 0129).
drop trigger if exists client_brand_profiles_updated_at on public.client_brand_profiles;
create trigger client_brand_profiles_updated_at
  before update on public.client_brand_profiles
  for each row execute procedure public.update_updated_at();

-- RLS: una sola policy 'for all' para admin/supervisor (patrón de 0129). El handler de IA escribe con
-- service role y bypassa RLS igual.
alter table public.client_brand_profiles enable row level security;

drop policy if exists "client_brand_profiles_manage" on public.client_brand_profiles;
create policy "client_brand_profiles_manage"
  on public.client_brand_profiles for all
  using (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  )
  with check (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  );

-- ── 2. Enlaces de ai_jobs a la matriz y a la pieza ──────────────────────────
-- `on delete cascade` porque un job de una matriz (o de una pieza) borrada no le sirve a nadie. No es
-- por el índice: en btree los nulos no colisionan entre sí.
alter table public.ai_jobs
  add column if not exists content_matrix_id uuid references public.content_matrices(id) on delete cascade,
  add column if not exists content_matrix_item_id uuid references public.content_matrix_items(id) on delete cascade;

-- Los dos índices cubren 'processing' además de 'pending' —la variante de 0126, no la de 0091—: aquí el
-- trabajo EN CURSO también debe bloquear un segundo encolado. Se inserta fila por fila tragando el 23505
-- por código, sin pre-chequeo: en el padre significa "ya hay una generación en curso" y en el hijo "esa
-- pieza ya está en cola" (que no es un error: es lo que hace idempotente el re-encolado y el doble clic).
create unique index if not exists ai_jobs_one_active_matrix_generate
  on public.ai_jobs(content_matrix_id)
  where status in ('pending','processing') and job_type = 'matrix_generate';

create unique index if not exists ai_jobs_one_active_matrix_item_write
  on public.ai_jobs(content_matrix_item_id)
  where status in ('pending','processing') and job_type = 'matrix_item_write';

-- ── 3. Marca de redacción por IA ────────────────────────────────────────────
-- Da dos cosas que no se pueden derivar: qué piezas escribió la IA (auditoría) y la diferencia entre
-- "sin redactar" y "el usuario borró el copy a propósito".
alter table public.content_matrix_items
  add column if not exists ai_written_at timestamptz;

commit;
