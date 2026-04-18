-- supabase/migrations/0008_consumption_title_cambios.sql

-- Título de consumo (registros existentes quedan con '' — UI requiere uno no vacío)
ALTER TABLE public.consumptions
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

-- Contador de cambios solicitados por el cliente
ALTER TABLE public.consumptions
  ADD COLUMN IF NOT EXISTS cambios_count INTEGER NOT NULL DEFAULT 0;

-- Límite de cambios por defecto por cliente
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS max_cambios INTEGER NOT NULL DEFAULT 2;
