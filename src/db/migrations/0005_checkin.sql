-- F05: check-in não é status do ingresso; é o instante em que a entrada foi liberada (R10).
alter table tickets add column checked_in_at timestamptz;
