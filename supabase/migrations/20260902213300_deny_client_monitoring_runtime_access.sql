drop policy if exists monitoring_runtime_deny_clients on public.monitoring_runtime;
create policy monitoring_runtime_deny_clients on public.monitoring_runtime
for all to authenticated using (false) with check (false);
