-- Seed demo team and basic instruments (AAA, BBB, CCC, CTCETF)
insert into teams(name) values ('Demo Team') on conflict do nothing;

-- Equities
insert into instruments(symbol, type, currency, tick_size_nanos, tick_size_ticks, lot_size_lots, meta)
values
  ('AAA', 0, 'USD', 1000, 1, 1, 0),
  ('BBB', 0, 'USD', 1000, 1, 1, 0),
  ('CCC', 0, 'USD', 1000, 1, 1, 0)
on conflict (symbol) do nothing;

-- ETF
insert into instruments(symbol, type, currency, tick_size_nanos, tick_size_ticks, lot_size_lots, meta)
values ('CTCETF', 1, 'USD', 1000, 1, 1, 0)
on conflict (symbol) do nothing;

-- ETF components (simple 1:1:1 basket)
with ids as (
  select
    (select id from instruments where symbol='CTCETF') as etf_id,
    (select id from instruments where symbol='AAA') as aaa_id,
    (select id from instruments where symbol='BBB') as bbb_id,
    (select id from instruments where symbol='CCC') as ccc_id
)
insert into etf_components(etf_instrument_id, component_instrument_id, weight_num, weight_den)
select etf_id, aaa_id, 1, 1 from ids
on conflict do nothing;

with ids as (
  select
    (select id from instruments where symbol='CTCETF') as etf_id,
    (select id from instruments where symbol='BBB') as bbb_id
)
insert into etf_components(etf_instrument_id, component_instrument_id, weight_num, weight_den)
select etf_id, bbb_id, 1, 1 from ids
on conflict do nothing;

with ids as (
  select
    (select id from instruments where symbol='CTCETF') as etf_id,
    (select id from instruments where symbol='CCC') as ccc_id
)
insert into etf_components(etf_instrument_id, component_instrument_id, weight_num, weight_den)
select etf_id, ccc_id, 1, 1 from ids
on conflict do nothing;

-- Default risk limits for Demo Team across instruments
with t as (select id as team_id from teams where name='Demo Team')
insert into risk_limits(team_id, instrument_id, pos_min_lots, pos_max_lots, notional_max_ticks, max_orders_per_sec)
select t.team_id, i.id, -500, 500, 0, 1000
from t cross join instruments i
on conflict do nothing;

-- Initialize config version setting
insert into settings(key, value) values ('configVersion', jsonb_build_object('version', 0))
on conflict (key) do nothing;

