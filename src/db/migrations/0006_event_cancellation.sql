-- F06: cancelamento de evento (momento do cancelamento; o status 'cancelled' já existe desde 0002).
alter table events add column cancelled_at timestamptz;
