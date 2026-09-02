-- The hosted WAR ROOM project stores the plaintext cron secret in Supabase Vault.
-- Only its SHA-256 digest is stored in monitoring_runtime. The deployment-specific digest
-- is intentionally not committed to source control.
alter table public.monitoring_runtime add column if not exists auth_secret_hash text;
