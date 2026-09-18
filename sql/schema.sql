create table if not exists customers (
  id uuid primary key,
  company_name text not null,
  website_url text not null,
  vapi_assistant_id text not null,
  phone_number text not null,
  profile jsonb not null,
  created_at timestamptz default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  caller_name text,
  caller_phone text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  transcript text,
  summary text,
  ended_reason text,
  created_at timestamptz default now()
);
