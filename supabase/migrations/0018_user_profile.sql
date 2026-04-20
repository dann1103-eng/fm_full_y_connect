-- Fase F: avatar de usuario
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Crear el bucket 'user-avatars' manualmente en Supabase Dashboard (Storage > New bucket, public = true)
-- Policies necesarias:
--   INSERT: bucket_id = 'user-avatars' AND (storage.foldername(name))[1] = auth.uid()::text
--   UPDATE: bucket_id = 'user-avatars' AND (storage.foldername(name))[1] = auth.uid()::text
--   DELETE: bucket_id = 'user-avatars' AND (storage.foldername(name))[1] = auth.uid()::text
--   SELECT: bucket_id = 'user-avatars' (public read)
