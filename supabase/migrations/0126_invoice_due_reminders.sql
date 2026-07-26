-- 0126_invoice_due_reminders.sql
-- Soporte para el recordatorio automático "tu factura está por vencer"
-- (WhatsApp, ~3 días antes del vencimiento, con el PDF adjunto).
--
-- 1) invoices.due_reminder_sent_at — marcador de NOTIFICACIÓN ENVIADA.
--    NO confundir con billing_cycles.auto_billed_at, que marca FACTURA EMITIDA.
--    El handler lo escribe ANTES de enviar (at-most-once): si el proceso muere
--    justo después de enviar, el watchdog de la migración 0124 reejecutaría el
--    job y el cliente recibiría un SEGUNDO cobro (facturable). Perder un
--    recordatorio es preferible a duplicarlo. Si el envío falla con error
--    explícito, el handler limpia el marcador y el cron reintenta al día
--    siguiente mientras la factura siga en ventana.
--
-- 2) ai_jobs.invoice_id + índice único parcial — impide DOBLE ENCOLADO del
--    mismo recordatorio.
--
-- 3) Índice de apoyo para el query diario del cron.

alter table public.invoices
  add column if not exists due_reminder_sent_at timestamptz;

comment on column public.invoices.due_reminder_sent_at is
  'Marca cuándo se envió el recordatorio de vencimiento por WhatsApp. Se escribe ANTES del envío (at-most-once) y se limpia si el envío falla explícitamente.';

alter table public.ai_jobs
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

-- Un solo recordatorio vivo por factura (pending o processing).
create unique index if not exists ai_jobs_one_active_due_reminder
  on public.ai_jobs(invoice_id)
  where status in ('pending','processing') and job_type = 'invoice_due_reminder';

-- Query del cron: facturas emitidas, aún sin recordatorio, por vencimiento.
create index if not exists invoices_due_reminder_pending_idx
  on public.invoices(due_date)
  where status = 'issued' and due_reminder_sent_at is null;
