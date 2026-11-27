-- Migration 003 — fix the audit_log guard
--
-- The BEFORE DELETE trigger returned NULL even when deleting was allowed
-- (app.deleting_family = 'on'). In Postgres a NULL from a BEFORE row trigger
-- silently skips the row, so deleting a family left its audit rows behind.
-- Return OLD for allowed deletes. Updates and other deletes are still refused.

create or replace function private.audit_log_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_log rows cannot be changed';
  end if;
  if coalesce(current_setting('app.deleting_family', true), '') <> 'on' then
    raise exception 'audit_log rows cannot be deleted';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return null; -- TRUNCATE (statement level): return value is ignored
end $$;
