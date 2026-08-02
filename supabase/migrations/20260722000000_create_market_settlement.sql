begin;

alter table public.market_accounts
    drop constraint if exists ck_market_account_cash;

create table public.market_replay_events (
    game_date date not null,
    player_id varchar(64) not null,
    actual_net_points_micros bigint not null,
    expected_net_points_micros bigint not null,
    dividend_cents bigint not null,
    primary key (game_date, player_id),
    constraint fk_market_replay_player foreign key (player_id)
        references public.market_players (id) on delete restrict,
    constraint ck_market_replay_actual_range check (
        actual_net_points_micros >= -1000000000 and
        actual_net_points_micros <= 1000000000
    ),
    constraint ck_market_replay_expected_range check (
        expected_net_points_micros >= -1000000000 and
        expected_net_points_micros <= 1000000000
    )
);

create index ix_market_replay_events_player_date
    on public.market_replay_events (player_id, game_date);

create table public.market_game_state (
    id varchar(64) primary key,
    season_id varchar(32) not null,
    last_settled_date date,
    next_game_date date,
    version integer not null default 0,
    created_at timestamp without time zone not null default timezone('utc', now()),
    updated_at timestamp without time zone not null default timezone('utc', now()),
    constraint ck_market_game_state_version check (version >= 0)
);

create table public.market_settlements (
    game_date date primary key,
    season_id varchar(32) not null,
    idempotency_key varchar(128) not null,
    request_fingerprint varchar(64) not null,
    event_count integer not null,
    payout_count integer not null,
    net_cash_cents bigint not null,
    response_payload json not null,
    settled_at timestamp without time zone not null default timezone('utc', now()),
    constraint uq_market_settlement_idempotency unique (idempotency_key),
    constraint ck_market_settlement_event_count check (event_count >= 0),
    constraint ck_market_settlement_payout_count check (payout_count >= 0)
);

create index ix_market_settlements_settled_at
    on public.market_settlements (settled_at);

create table public.market_dividends (
    account_id varchar(128) not null,
    game_date date not null,
    player_id varchar(64) not null,
    amount_cents bigint not null,
    created_at timestamp without time zone not null default timezone('utc', now()),
    primary key (account_id, game_date, player_id),
    constraint fk_market_dividend_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint fk_market_dividend_settlement foreign key (game_date)
        references public.market_settlements (game_date) on delete cascade,
    constraint fk_market_dividend_player foreign key (player_id)
        references public.market_players (id) on delete restrict,
    constraint ck_market_dividend_amount_range check (
        amount_cents >= -100000000000 and amount_cents <= 100000000000
    )
);

create index ix_market_dividends_account_date
    on public.market_dividends (account_id, game_date);

alter table public.market_replay_events enable row level security;
alter table public.market_game_state enable row level security;
alter table public.market_settlements enable row level security;
alter table public.market_dividends enable row level security;

revoke all privileges on table public.market_replay_events
    from public, anon, authenticated;
revoke all privileges on table public.market_game_state
    from public, anon, authenticated;
revoke all privileges on table public.market_settlements
    from public, anon, authenticated;
revoke all privileges on table public.market_dividends
    from public, anon, authenticated;

grant all privileges on table public.market_replay_events to service_role;
grant all privileges on table public.market_game_state to service_role;
grant all privileges on table public.market_settlements to service_role;
grant all privileges on table public.market_dividends to service_role;

comment on table public.market_replay_events is
    'Immutable historical player-game outcomes and canonical signed dividends.';
comment on table public.market_game_state is
    'Singleton server-owned historical replay cursor.';
comment on table public.market_settlements is
    'Idempotent daily settlement audit log and reconciliation totals.';
comment on table public.market_dividends is
    'Per-account signed dividend ledger; clients have no direct table access.';

commit;
