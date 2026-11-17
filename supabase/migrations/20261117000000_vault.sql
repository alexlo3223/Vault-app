-- Vault in the cloud: every note, folder and attachment of a user is one row; attachment bytes live in Storage.
-- Paths are vault-relative, like on disk: "Proyectos/Plan.md", "Proyectos", "attachments/foto.png".
create table public.vault_files (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null check (length(path) between 1 and 400),
  kind text not null check (kind in ('note', 'folder', 'asset')),
  content text,                         -- notes only
  size bigint not null default 0,
  hash text,                            -- sha-256 of the content/bytes, used by the desktop sync
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false, -- the trash: kept so other devices learn about the delete
  primary key (user_id, path)
);
create index vault_files_updated on public.vault_files (user_id, updated_at);

create function public.vault_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger vault_files_touch before update on public.vault_files for each row execute function public.vault_touch();

alter table public.vault_files enable row level security;
create policy "Each user owns their vault"
  on public.vault_files for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Moves a path and everything under it ("A.md" with "A/..." or a folder "A" with "A/...") in one transaction.
-- A deleted row at the destination is replaced; a live one makes the move fail.
create function public.vault_move(src text, dst text) returns void language plpgsql security invoker as $$
declare
  src_key text := regexp_replace(src, '\.md$', '');
  dst_key text := regexp_replace(dst, '\.md$', '');
begin
  delete from public.vault_files
   where user_id = auth.uid() and deleted
     and (path = dst or path = dst_key or path like dst_key || '/%');
  -- the old rows stay behind as deleted, so a syncing device removes them too
  insert into public.vault_files (user_id, path, kind, content, size, hash, created_at)
  select user_id, dst_key || substr(path, length(src_key) + 1), kind, content, size, hash, created_at
    from public.vault_files
   where user_id = auth.uid() and not deleted
     and (path = src or path = src_key or path like src_key || '/%');
  update public.vault_files set deleted = true, content = null
   where user_id = auth.uid() and not deleted
     and (path = src or path = src_key or path like src_key || '/%');
end $$;

-- Attachment bytes: private bucket, stored by content as "<user id>/<sha-256>", so moving a row never moves a file.
insert into storage.buckets (id, name, public) values ('vault', 'vault', false) on conflict do nothing;
create policy "Each user owns their attachments"
  on storage.objects for all to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = (select auth.uid())::text);
