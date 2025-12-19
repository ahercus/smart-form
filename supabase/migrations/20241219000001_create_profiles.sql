-- Create profiles table for user data and auto-fill information
create table profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,

  -- Saved profile data for auto-fill
  -- Example: { "name": "Sarah Johnson", "address": {...}, "phone": "...", "email": "...", "date_of_birth": "..." }
  core_data jsonb default '{}',

  -- Unstructured context for Gemini
  -- Example: "I have two children: Emma (7) and Jack (4). Emma has a peanut allergy."
  extended_context text,

  -- Saved signatures (references to storage)
  -- Example: [{ "id": "sig_1", "name": "Formal", "storage_path": "signatures/user_123/formal.png" }]
  signatures jsonb default '[]',

  -- Account settings
  subscription_tier text default 'free' check (subscription_tier in ('free', 'pro', 'team')),
  stripe_customer_id text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create unique constraint on user_id
create unique index idx_profiles_user_id on profiles(user_id);
