-- ============================================================
-- SEED: Cliente de prueba para testing de renovación
-- Ejecutar en Supabase Dashboard → SQL Editor
-- Hoy: 2026-04-19  |  Ciclo vence: 2026-04-15 → 4 días moroso
-- ============================================================

DO $$
DECLARE
  v_plan_id       uuid;
  v_plan_limits   jsonb;
  v_plan_cambios  int;
  v_client_id     uuid;
  v_cycle_id      uuid;
  v_admin_id      uuid;
BEGIN

  -- 1. Obtener plan Básico
  SELECT id, limits_json, cambios_included
  INTO v_plan_id, v_plan_limits, v_plan_cambios
  FROM public.plans
  WHERE price_usd = 200 AND active = true
  LIMIT 1;

  -- 2. Obtener primer admin para registered_by
  SELECT id INTO v_admin_id
  FROM public.users
  WHERE role = 'admin'
  LIMIT 1;

  -- 3. Crear cliente con datos completos
  INSERT INTO public.clients (
    name,
    contact_email,
    contact_phone,
    ig_handle,
    fb_handle,
    tiktok_handle,
    yt_handle,
    linkedin_handle,
    website_url,
    other_contact,
    notes,
    current_plan_id,
    billing_day,
    billing_period,
    start_date,
    status,
    weekly_targets_json
  ) VALUES (
    'TIENDA MODELO PRUEBA',
    'contacto@tiendamodelo.com',
    '+503 7123 4567',
    '@tiendamodelo',
    'Tienda Modelo Oficial',
    '@tiendamodelo.sv',
    '@TiendaModeloSV',
    'Tienda Modelo S.A. de C.V.',
    'https://tiendamodelo.com',
    'WhatsApp: +503 7123 4567',
    'Cliente de prueba para testing. Plan Básico mensual con ciclo vencido hace 4 días. Tiene rollover de historias del ciclo anterior y contenido extra vendido.',
    v_plan_id,
    15,
    'monthly',
    '2026-02-15',
    'active',
    '{"historia": 4, "estatico": 1, "video_corto": 1}'::jsonb
  )
  RETURNING id INTO v_client_id;

  -- 4. Crear ciclo actual VENCIDO (period_end = 2026-04-15, hoy = 2026-04-19)
  --    Con rollover de +2 historias del ciclo anterior
  --    Con 1 paquete extra de cambios y 1 video corto extra vendido
  INSERT INTO public.billing_cycles (
    client_id,
    plan_id_snapshot,
    limits_snapshot_json,
    rollover_from_previous_json,
    period_start,
    period_end,
    status,
    payment_status,
    payment_date,
    cambios_budget,
    cambios_packages_json,
    extra_content_json,
    content_limits_override_json
  ) VALUES (
    v_client_id,
    v_plan_id,
    v_plan_limits,
    '{"historias": 2}'::jsonb,           -- rollover: +2 historias del ciclo anterior
    '2026-03-15',
    '2026-04-15',
    'current',
    'paid',
    '2026-03-16',
    v_plan_cambios + 5,                  -- 8 del plan + 5 paquete extra = 13 total
    '[{"qty": 5, "price_usd": 50.00, "note": "Paquete extra acordado en reunión", "created_at": "2026-03-20T14:00:00Z"}]'::jsonb,
    '[{"content_type": "video_corto", "label": "Videos Cortos", "qty": 1, "price_per_unit": 25, "note": "Video extra para campaña especial", "created_at": "2026-04-01T10:00:00Z"}]'::jsonb,
    NULL
  )
  RETURNING id INTO v_cycle_id;

  -- 5. Insertar requerimientos incompletos (deja varias piezas sin usar)
  --    Límites efectivos: historias 12+2=14, estaticos 4, video_corto 2+1extra, reels 2, producciones 1, reuniones 1
  --    Usados: 7 historias, 2 estáticos, 1 video_corto, 1 reel, 0 producciones, 1 reunión

  INSERT INTO public.requirements
    (billing_cycle_id, content_type, registered_by_user_id, title, phase, over_limit, carried_over, cambios_count, registered_at)
  VALUES
    -- Historias: 7 de 14 posibles
    (v_cycle_id, 'historia', v_admin_id, 'Historia S1 — Lanzamiento de temporada',    'publicado',         false, false, 0, '2026-03-16 09:00:00+00'),
    (v_cycle_id, 'historia', v_admin_id, 'Historia S1 — Producto destacado',           'publicado',         false, false, 1, '2026-03-17 10:00:00+00'),
    (v_cycle_id, 'historia', v_admin_id, 'Historia S2 — Promoción especial 2x1',       'publicado',         false, false, 0, '2026-03-24 09:00:00+00'),
    (v_cycle_id, 'historia', v_admin_id, 'Historia S2 — Beneficios del producto',      'publicado',         false, false, 2, '2026-03-25 11:00:00+00'),
    (v_cycle_id, 'historia', v_admin_id, 'Historia S3 — Behind the scenes',            'publicado',         false, false, 0, '2026-04-01 09:00:00+00'),
    (v_cycle_id, 'historia', v_admin_id, 'Historia S3 — Testimonio de cliente',        'revision_cliente',  false, false, 1, '2026-04-02 10:00:00+00'),
    (v_cycle_id, 'historia', v_admin_id, 'Historia S4 — Cierre de mes',                'en_produccion',     false, false, 0, '2026-04-10 09:00:00+00'),

    -- Estáticos: 2 de 4
    (v_cycle_id, 'estatico', v_admin_id, 'Banner principal — Temporada abril',         'publicado',         false, false, 3, '2026-03-18 09:00:00+00'),
    (v_cycle_id, 'estatico', v_admin_id, 'Post cuadrado — Producto destacado',         'revision_interna',  false, false, 1, '2026-04-08 14:00:00+00'),

    -- Video corto: 1 de 2 (más 1 extra vendido)
    (v_cycle_id, 'video_corto', v_admin_id, 'Video 30s — Presentación de marca',      'publicado',         false, false, 2, '2026-03-22 10:00:00+00'),

    -- Reel: 1 de 2
    (v_cycle_id, 'reel', v_admin_id, 'Video largo — Transformación del mes',           'aprobado',          false, false, 0, '2026-04-05 09:00:00+00'),

    -- Reunión: 1 de 1 (usada)
    (v_cycle_id, 'reunion', v_admin_id, 'Reunión mensual de estrategia',               'publicado',         false, false, 0, '2026-03-16 15:00:00+00');

  RAISE NOTICE 'Cliente creado: TIENDA MODELO PRUEBA (id: %)', v_client_id;
  RAISE NOTICE 'Ciclo creado: % – % (id: %)', '2026-03-15', '2026-04-15', v_cycle_id;
  RAISE NOTICE 'Requerimientos: 11 insertados';

END $$;
