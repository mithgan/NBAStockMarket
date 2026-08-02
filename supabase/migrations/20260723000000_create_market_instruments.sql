begin;

alter table public.market_replay_events
    add column actual_minutes_micros bigint not null default 0,
    add column projected_minutes_micros bigint,
    add column qualifies_for_instruments boolean not null default false,
    add constraint ck_market_replay_actual_minutes check (
        actual_minutes_micros >= 0 and actual_minutes_micros <= 100000000
    ),
    add constraint ck_market_replay_projected_minutes check (
        projected_minutes_micros is null or
        (projected_minutes_micros > 0 and projected_minutes_micros <= 100000000)
    ),
    add constraint ck_market_replay_qualification_projection check (
        not qualifies_for_instruments or projected_minutes_micros is not null
    );

create table public.market_weekly_shorts (
    id varchar(36) primary key,
    account_id varchar(128) not null,
    player_id varchar(64) not null,
    week_start date not null,
    status varchar(16) not null default 'active',
    opening_price_cents bigint not null,
    fee_cents bigint not null,
    collateral_cents bigint not null,
    accrued_net_points_micros bigint not null default 0,
    qualifying_games integer not null default 0,
    payout_cents bigint,
    settled_game_date date,
    created_at timestamp without time zone not null default timezone('utc', now()),
    updated_at timestamp without time zone not null default timezone('utc', now()),
    constraint fk_market_weekly_short_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint fk_market_weekly_short_player foreign key (player_id)
        references public.market_players (id) on delete restrict,
    constraint uq_market_weekly_short_account_player_week
        unique (account_id, player_id, week_start),
    constraint ck_market_weekly_short_status check (
        status in ('active', 'settled', 'voided')
    ),
    constraint ck_market_weekly_short_opening_price check (
        opening_price_cents > 0
    ),
    constraint ck_market_weekly_short_fee check (fee_cents >= 0),
    constraint ck_market_weekly_short_collateral check (
        collateral_cents = 200000000
    ),
    constraint ck_market_weekly_short_games check (qualifying_games >= 0),
    constraint ck_market_weekly_short_terminal check (
        (status = 'active' and payout_cents is null and settled_game_date is null)
        or (status in ('settled', 'voided') and payout_cents is not null
            and settled_game_date is not null)
    )
);

create index ix_market_weekly_shorts_account_week_status
    on public.market_weekly_shorts (account_id, week_start, status);
create index ix_market_weekly_shorts_player_week_status
    on public.market_weekly_shorts (player_id, week_start, status);

create table public.market_boosts (
    id varchar(36) primary key,
    account_id varchar(128) not null,
    player_id varchar(64) not null,
    week_start date not null,
    target_game_date date not null,
    status varchar(16) not null default 'armed',
    opening_price_cents bigint not null,
    fee_cents bigint not null,
    payout_cents bigint,
    settled_game_date date,
    created_at timestamp without time zone not null default timezone('utc', now()),
    updated_at timestamp without time zone not null default timezone('utc', now()),
    constraint fk_market_boost_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint fk_market_boost_player foreign key (player_id)
        references public.market_players (id) on delete restrict,
    constraint uq_market_boost_account_player_game
        unique (account_id, player_id, target_game_date),
    constraint ck_market_boost_status check (
        status in ('armed', 'consumed', 'refunded')
    ),
    constraint ck_market_boost_opening_price check (opening_price_cents > 0),
    constraint ck_market_boost_fee check (fee_cents >= 0),
    constraint ck_market_boost_terminal check (
        (status = 'armed' and payout_cents is null and settled_game_date is null)
        or (status in ('consumed', 'refunded') and payout_cents is not null
            and settled_game_date is not null)
    )
);

create index ix_market_boosts_account_week_status
    on public.market_boosts (account_id, week_start, status);
create index ix_market_boosts_game_status
    on public.market_boosts (target_game_date, status);

create table public.market_instrument_commands (
    id varchar(36) primary key,
    account_id varchar(128) not null,
    kind varchar(16) not null,
    position_id varchar(36) not null,
    idempotency_key varchar(128) not null,
    request_fingerprint varchar(64) not null,
    response_payload json not null,
    created_at timestamp without time zone not null default timezone('utc', now()),
    constraint fk_market_instrument_command_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint uq_market_instrument_command_account_idempotency
        unique (account_id, idempotency_key),
    constraint ck_market_instrument_command_kind check (
        kind in ('weekly_short', 'boost')
    )
);

create index ix_market_instrument_commands_account_created
    on public.market_instrument_commands (account_id, created_at);

alter table public.market_weekly_shorts enable row level security;
alter table public.market_boosts enable row level security;
alter table public.market_instrument_commands enable row level security;

revoke all privileges on table public.market_weekly_shorts
    from public, anon, authenticated;
revoke all privileges on table public.market_boosts
    from public, anon, authenticated;
revoke all privileges on table public.market_instrument_commands
    from public, anon, authenticated;

grant all privileges on table public.market_weekly_shorts to service_role;
grant all privileges on table public.market_boosts to service_role;
grant all privileges on table public.market_instrument_commands to service_role;

comment on table public.market_weekly_shorts is
    'Server-owned weekly performance shorts with bounded collateral and payouts.';
comment on table public.market_boosts is
    'Server-owned one-game signed dividend boosts.';
comment on table public.market_instrument_commands is
    'Cross-instrument idempotency records; clients have no direct table access.';

commit;
