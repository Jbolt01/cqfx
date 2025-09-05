-- Users/Teams/RBAC
create table if not exists users(
  id serial primary key,
  email text unique not null,
  handle text,
  role text not null default 'trader'
);

create table if not exists teams(
  id serial primary key,
  name text unique not null
);

create table if not exists team_members(
  team_id int references teams(id),
  user_id int references users(id),
  role text not null default 'member',
  primary key(team_id, user_id)
);

-- Instruments
create table if not exists instruments(
  id serial primary key,
  symbol text unique not null,
  type smallint not null,                      -- 0 equity, 1 etf, 2 option
  currency text default 'USD',
  tick_size_nanos int not null,
  tick_size_ticks int not null,
  lot_size_lots int not null default 1,
  meta bigint not null default 0
);

-- ETF basket
create table if not exists etf_components(
  etf_instrument_id int references instruments(id),
  component_instrument_id int references instruments(id),
  weight_num int not null,
  weight_den int not null,
  primary key(etf_instrument_id, component_instrument_id)
);

-- Options meta
create table if not exists options_meta(
  instrument_id int primary key references instruments(id),
  underlying_instrument_id int not null references instruments(id),
  strike_ticks int not null,
  right smallint not null,                     -- 0 call, 1 put
  expiry date not null,
  multiplier int not null default 100
);

-- Risk limits
create table if not exists risk_limits(
  team_id int references teams(id),
  instrument_id int references instruments(id),
  pos_min_lots bigint not null default -500,
  pos_max_lots bigint not null default  500,
  notional_max_ticks bigint not null default 0, -- 0 = disabled
  max_orders_per_sec int not null default 1000,
  primary key(team_id, instrument_id)
);

-- Sessions
create table if not exists sessions(
  id serial primary key,
  round_no int not null,
  day_no int not null,
  start_ts timestamptz,
  end_ts timestamptz,
  state text not null default 'PreOpen'
);

-- Feature flags / settings
create table if not exists settings(
  key text primary key,
  value jsonb not null
);

