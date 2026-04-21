-- Incluye 'matriz_contenido' en el CHECK constraint de requirements.content_type.
-- La migración 0022 añadió el tipo en plans y cycles, pero nunca actualizó el
-- CHECK de la tabla requirements (originalmente definido en 0004), lo que hacía
-- fallar la inserción de cualquier requerimiento con content_type = 'matriz_contenido'.

ALTER TABLE public.requirements DROP CONSTRAINT IF EXISTS requirements_content_type_check;

ALTER TABLE public.requirements ADD CONSTRAINT requirements_content_type_check
  CHECK (content_type IN (
    'historia',
    'estatico',
    'video_corto',
    'reel',
    'short',
    'produccion',
    'reunion',
    'matriz_contenido'
  ));
