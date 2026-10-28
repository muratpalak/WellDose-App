-- WellDose | Sağlık Belgeleri (28 Ekim 2026)
-- Çalıştırmadan önce WellDose projesinde olduğunuzu doğrulayın.
-- Mevcut ölçüm, tedavi ve kullanıcı tablolarına dokunmaz.

create table if not exists public.health_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in (
    'blood_test', 'urine_test', 'radiology',
    'doctor_note', 'patient_note', 'prescription'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  document_date date not null,
  provider_name text check (provider_name is null or char_length(provider_name) <= 160),
  doctor_name text check (doctor_name is null or char_length(doctor_name) <= 120),
  notes text check (notes is null or char_length(notes) <= 10000),
  file_path text,
  file_name text check (file_name is null or char_length(file_name) <= 255),
  file_mime text check (file_mime is null or file_mime in (
    'application/pdf','image/jpeg','image/png','image/webp'
  )),
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_documents_content_required check (
    file_path is not null or char_length(btrim(coalesce(notes, ''))) > 0
  ),
  constraint health_documents_file_metadata_consistent check (
    (file_path is null and file_name is null and file_mime is null and file_size_bytes is null)
    or (file_path is not null and file_name is not null and file_mime is not null and file_size_bytes is not null)
  ),
  constraint health_documents_owner_path check (
    file_path is null or left(file_path, char_length(user_id::text) + 1) = user_id::text || '/'
  )
);

create index if not exists health_documents_user_date_idx
  on public.health_documents (user_id, document_date desc, created_at desc);

alter table public.health_documents enable row level security;
revoke all on public.health_documents from anon;
grant select, insert, update, delete on public.health_documents to authenticated;

drop policy if exists "welldose_health_documents_select_own" on public.health_documents;
create policy "welldose_health_documents_select_own"
  on public.health_documents for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "welldose_health_documents_insert_own" on public.health_documents;
create policy "welldose_health_documents_insert_own"
  on public.health_documents for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "welldose_health_documents_update_own" on public.health_documents;
create policy "welldose_health_documents_update_own"
  on public.health_documents for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "welldose_health_documents_delete_own" on public.health_documents;
create policy "welldose_health_documents_delete_own"
  on public.health_documents for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Bu bucket asla public yapılmamalı: sağlık raporları hassas kişisel veridir.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'welldose-health-documents', 'welldose-health-documents', false,
  5242880, array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do nothing;

drop policy if exists "welldose_document_files_select_own" on storage.objects;
create policy "welldose_document_files_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'welldose-health-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "welldose_document_files_insert_own" on storage.objects;
create policy "welldose_document_files_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'welldose-health-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "welldose_document_files_delete_own" on storage.objects;
create policy "welldose_document_files_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'welldose-health-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Hatırlatma: storage.objects tablosunu doğrudan SQL ile silmeyin.
-- Dosyaları istemci Storage API ile kaldırın; metadata ayrı bir tabloda tutulur.
