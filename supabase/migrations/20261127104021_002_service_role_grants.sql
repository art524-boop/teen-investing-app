-- Migration 002 — table privileges for server code (service_role)
--
-- This project does not grant new public tables to service_role automatically,
-- so Edge Functions could not read or write them. Grant exactly what server code
-- needs. audit_log stays insert-only (no update/delete for anyone).

grant select, insert, update on public.families, public.parents, public.teens, public.invites to service_role;
grant select, insert on public.audit_log to service_role;
grant select, insert on public.feedback to service_role;
