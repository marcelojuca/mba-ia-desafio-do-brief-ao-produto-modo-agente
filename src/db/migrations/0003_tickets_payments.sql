-- F03: ingressos e tentativas de pagamento (gateway simulado).
create table tickets (
  id text primary key,
  event_id text not null references events(id),
  user_id text references users(id),
  buyer_email text not null,
  code text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'declined', 'cancelled', 'refunded')),
  price_cents integer not null check (price_cents > 0),
  channel text not null check (channel in ('web', 'partner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tickets(event_id, status);
create index on tickets(user_id);

create table payment_attempts (
  id text primary key,
  ticket_id text not null unique references tickets(id),
  card_last4 text not null,
  outcome text not null check (outcome in ('approved', 'declined')),
  respond_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on payment_attempts(respond_at) where processed_at is null;
