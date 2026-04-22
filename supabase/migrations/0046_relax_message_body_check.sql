-- Permitir body vacío en requirement_messages cuando el mensaje trae un adjunto.
-- El constraint original (0010_chat_timesheet) exigía body no vacío; 0026 agregó
-- los campos de attachment pero no relajó el check. El proyecto viejo tenía el
-- cambio aplicado manualmente, así que al migrar al proyecto Pro se perdió.

alter table public.requirement_messages
  drop constraint if exists requirement_messages_body_check;

alter table public.requirement_messages
  add constraint requirement_messages_body_check
  check (char_length(trim(body)) > 0 or attachment_path is not null);
