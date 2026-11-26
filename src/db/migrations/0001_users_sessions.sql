create table users (
  id text primary key,
  name text not null,
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  role text not null check (role in ('participant', 'organizer')),
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on sessions(user_id);
