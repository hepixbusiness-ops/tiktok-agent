-- Jetons TikTok de l'agent (à exécuter une fois dans Supabase > SQL Editor).
-- Accessible uniquement avec la clé service_role : RLS activé, aucune policy publique.
create table if not exists public.tiktok_tokens (
  account_id    text primary key,
  open_id       text,
  access_token  text,
  refresh_token text not null,
  scope         text,
  expires_at    timestamptz,
  updated_at    timestamptz default now()
);

alter table public.tiktok_tokens enable row level security;
