create table events (
  id text primary key,
  organizer_id text not null references users(id),
  name text not null,
  starts_at timestamptz not null,
  venue text not null,
  capacity integer not null check (capacity >= 1),
  price_cents integer not null check (price_cents > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on events(organizer_id);
create index on events(status);
