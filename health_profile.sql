-- WellDose | Kullanıcı profili ve hedefler (28 Ekim 2026)
-- Mevcut public.user_profiles tablosunu genişletir; kayıtları silmez.
-- Bu tabloya erişim mevcut owner-only RLS kuralıyla sınırlandırılmıştır.

begin;

alter table public.user_profiles
  add column if not exists birth_date date
    check (birth_date is null or (birth_date >= date '1900-01-01' and birth_date <= current_date)),
  add column if not exists height_cm numeric(4,1)
    check (height_cm is null or (height_cm >= 40 and height_cm <= 260)),
  add column if not exists medical_conditions text
    check (medical_conditions is null or char_length(medical_conditions) <= 4000),
  add column if not exists allergies text
    check (allergies is null or char_length(allergies) <= 2000),
  add column if not exists regular_medications text
    check (regular_medications is null or char_length(regular_medications) <= 4000),
  add column if not exists surgeries text
    check (surgeries is null or char_length(surgeries) <= 4000),
  add column if not exists health_notes text
    check (health_notes is null or char_length(health_notes) <= 5000),
  add column if not exists target_weight_kg numeric(5,1)
    check (target_weight_kg is null or (target_weight_kg >= 20 and target_weight_kg <= 650)),
  add column if not exists goal_notes text
    check (goal_notes is null or char_length(goal_notes) <= 2000);

-- Tablo zaten owner-only RLS korumasına sahip; kuralı değiştirmiyoruz.
alter table public.user_profiles enable row level security;

commit;
