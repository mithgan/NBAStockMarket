begin;

-- Serialize the additive schema install with all existing market writers. The
-- v1 tables are intentionally neither locked nor rewritten by this migration.
select pg_advisory_xact_lock(1846237911);

create table public.market_v2_rulesets (
    id varchar(64) primary key,
    version integer not null default 1,
    season_id varchar(32) not null,
    dividend_basis varchar(32) not null,
    dividend_dollars_per_net_point bigint not null,
    long_slot_limit integer not null,
    short_slot_limit integer not null,
    allow_opposing_positions boolean not null default false,
    enforce_roster_lock boolean not null default true,
    roster_mutations_locked boolean not null default true,
    roster_lock_game_date date,
    last_roster_lock_game_date date,
    quote_add_impact_bps integer not null,
    quote_drop_impact_bps integer not null,
    transaction_fee_dollars bigint not null,
    short_term_days integer,
    current_sequence integer not null default 0,
    last_settled_date date,
    next_game_date date,
    event_cursor bigint not null default 0,
    is_active boolean not null default true,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    updated_at timestamp without time zone not null
        default timezone('utc', now()),
    constraint ck_market_v2_ruleset_version check (version >= 1),
    constraint ck_market_v2_ruleset_dividend_basis check (
        dividend_basis in ('raw_net_points', 'surprise_vs_projection')
    ),
    constraint ck_market_v2_ruleset_dividend_rate check (
        dividend_dollars_per_net_point >= 0
        and dividend_dollars_per_net_point <= 1000000000
    ),
    constraint ck_market_v2_ruleset_long_slots check (
        long_slot_limit >= 0 and long_slot_limit <= 100
    ),
    constraint ck_market_v2_ruleset_short_slots check (
        short_slot_limit >= 0 and short_slot_limit <= 100
    ),
    constraint ck_market_v2_ruleset_add_impact check (
        quote_add_impact_bps >= 0 and quote_add_impact_bps <= 10000
    ),
    constraint ck_market_v2_ruleset_drop_impact check (
        quote_drop_impact_bps >= 0 and quote_drop_impact_bps <= 10000
    ),
    constraint ck_market_v2_ruleset_fee check (
        transaction_fee_dollars >= 0
        and transaction_fee_dollars <= 9007199254740991
    ),
    constraint ck_market_v2_ruleset_short_term check (
        short_term_days is null or short_term_days > 0
    ),
    constraint ck_market_v2_ruleset_sequence check (current_sequence >= 0),
    constraint ck_market_v2_ruleset_event_cursor check (event_cursor >= 0)
);

create table public.market_v2_game_boundaries (
    ruleset_id varchar(64) not null,
    game_id varchar(96) not null,
    game_date date not null,
    started_at timestamp without time zone,
    next_game_date date,
    event_sequence integer not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, game_id),
    constraint fk_market_v2_game_boundary_ruleset foreign key (ruleset_id)
        references public.market_v2_rulesets (id) on delete cascade,
    constraint ck_market_v2_game_boundary_sequence check (event_sequence >= 0)
);

create table public.market_v2_player_quotes (
    ruleset_id varchar(64) not null,
    player_id varchar(64) not null,
    current_game_cost_dollars bigint not null,
    prior_season_value_per_game_dollars bigint,
    version integer not null default 0,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    updated_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, player_id),
    constraint fk_market_v2_quote_ruleset foreign key (ruleset_id)
        references public.market_v2_rulesets (id) on delete cascade,
    constraint fk_market_v2_quote_player foreign key (player_id)
        references public.market_players (id) on delete restrict,
    constraint ck_market_v2_quote_current_cost check (
        current_game_cost_dollars > 0
        and current_game_cost_dollars <= 1000000000000
    ),
    constraint ck_market_v2_quote_prior_value check (
        prior_season_value_per_game_dollars is null
        or (prior_season_value_per_game_dollars >= 0
            and prior_season_value_per_game_dollars <= 1000000000000)
    ),
    constraint ck_market_v2_quote_version check (version >= 0)
);

create index ix_market_v2_quotes_player
    on public.market_v2_player_quotes (player_id);

create table public.market_v2_accounts (
    ruleset_id varchar(64) not null,
    account_id varchar(128) not null,
    display_name varchar(80) not null,
    version integer not null default 0,
    cumulative_pnl_dollars bigint not null default 0,
    latest_game_pnl_dollars bigint not null default 0,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    updated_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, account_id),
    constraint fk_market_v2_account_ruleset foreign key (ruleset_id)
        references public.market_v2_rulesets (id) on delete cascade,
    constraint ck_market_v2_account_version check (version >= 0),
    constraint ck_market_v2_account_cumulative_pnl check (
        cumulative_pnl_dollars >= -9007199254740991
        and cumulative_pnl_dollars <= 9007199254740991
    ),
    constraint ck_market_v2_account_latest_pnl check (
        latest_game_pnl_dollars >= -9007199254740991
        and latest_game_pnl_dollars <= 9007199254740991
    )
);

create index ix_market_v2_accounts_leaderboard
    on public.market_v2_accounts (ruleset_id, cumulative_pnl_dollars);

create table public.market_v2_positions (
    id varchar(36) primary key,
    ruleset_id varchar(64) not null,
    account_id varchar(128) not null,
    player_id varchar(64) not null,
    side varchar(8) not null,
    status varchar(8) not null,
    locked_game_cost_dollars bigint not null,
    opened_event_sequence integer not null,
    closed_event_sequence integer,
    expires_on date,
    opened_at timestamp without time zone not null
        default timezone('utc', now()),
    closed_at timestamp without time zone,
    constraint fk_market_v2_position_account foreign key (ruleset_id, account_id)
        references public.market_v2_accounts (ruleset_id, account_id)
        on delete cascade,
    constraint fk_market_v2_position_quote foreign key (ruleset_id, player_id)
        references public.market_v2_player_quotes (ruleset_id, player_id)
        on delete restrict,
    constraint uq_market_v2_position_ownership unique (
        id, ruleset_id, account_id, player_id
    ),
    constraint ck_market_v2_position_side check (side in ('long', 'short')),
    constraint ck_market_v2_position_status check (
        status in ('active', 'closed')
    ),
    constraint ck_market_v2_position_locked_cost check (
        locked_game_cost_dollars > 0
        and locked_game_cost_dollars <= 1000000000000
    ),
    constraint ck_market_v2_position_open_sequence check (
        opened_event_sequence >= 0
    ),
    constraint ck_market_v2_position_close_sequence check (
        closed_event_sequence is null
        or closed_event_sequence >= opened_event_sequence
    ),
    constraint ck_market_v2_position_status_boundary check (
        (status = 'active' and closed_event_sequence is null)
        or (status = 'closed' and closed_event_sequence is not null)
    ),
    constraint ck_market_v2_position_long_has_no_expiry check (
        side = 'short' or expires_on is null
    )
);

create index ix_market_v2_positions_account_status
    on public.market_v2_positions (ruleset_id, account_id, status);
create index ix_market_v2_positions_player_status
    on public.market_v2_positions (ruleset_id, player_id, status);
create unique index uq_market_v2_positions_active_side
    on public.market_v2_positions (ruleset_id, account_id, player_id, side)
    where status = 'active';

create table public.market_v2_saved_projections (
    ruleset_id varchar(64) not null,
    game_id varchar(96) not null,
    player_id varchar(64) not null,
    projected_net_points_micros bigint not null,
    model_name varchar(64) not null,
    model_version varchar(64) not null,
    captured_at timestamp without time zone not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, game_id, player_id),
    constraint fk_market_v2_projection_ruleset foreign key (ruleset_id)
        references public.market_v2_rulesets (id) on delete cascade,
    constraint fk_market_v2_projection_quote foreign key (ruleset_id, player_id)
        references public.market_v2_player_quotes (ruleset_id, player_id)
        on delete restrict,
    constraint ck_market_v2_projection_range check (
        projected_net_points_micros >= -1000000000
        and projected_net_points_micros <= 1000000000
    )
);

create table public.market_v2_player_game_results (
    ruleset_id varchar(64) not null,
    game_id varchar(96) not null,
    player_id varchar(64) not null,
    revision integer not null,
    game_date date not null,
    event_sequence integer not null,
    actual_net_points_micros bigint not null,
    saved_projection_net_points_micros bigint,
    dividend_basis varchar(32) not null,
    dividend_dollars_per_net_point bigint not null,
    status varchar(40) not null,
    kind varchar(16) not null,
    dividend_dollars bigint,
    adjusts_result_revision integer,
    event_cursor bigint not null,
    request_fingerprint varchar(64) not null,
    response_payload json not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, game_id, player_id, revision),
    constraint fk_market_v2_result_ruleset foreign key (ruleset_id)
        references public.market_v2_rulesets (id) on delete cascade,
    constraint fk_market_v2_result_quote foreign key (ruleset_id, player_id)
        references public.market_v2_player_quotes (ruleset_id, player_id)
        on delete restrict,
    constraint fk_market_v2_result_game_boundary foreign key (ruleset_id, game_id)
        references public.market_v2_game_boundaries (ruleset_id, game_id)
        on delete restrict,
    constraint ck_market_v2_result_sequence check (event_sequence >= 0),
    constraint ck_market_v2_result_revision check (revision >= 1),
    constraint ck_market_v2_result_actual_range check (
        actual_net_points_micros >= -1000000000
        and actual_net_points_micros <= 1000000000
    ),
    constraint ck_market_v2_result_dividend_basis check (
        dividend_basis in ('raw_net_points', 'surprise_vs_projection')
    ),
    constraint ck_market_v2_result_dividend_rate check (
        dividend_dollars_per_net_point >= 0
        and dividend_dollars_per_net_point <= 1000000000
    ),
    constraint ck_market_v2_result_projection_range check (
        saved_projection_net_points_micros is null
        or (saved_projection_net_points_micros >= -1000000000
            and saved_projection_net_points_micros <= 1000000000)
    ),
    constraint ck_market_v2_result_status check (
        status in ('settled', 'unsettled_missing_projection')
    ),
    constraint ck_market_v2_result_kind check (kind in ('base', 'correction')),
    constraint ck_market_v2_result_dividend check (
        dividend_dollars is null
        or (dividend_dollars >= -9007199254740991
            and dividend_dollars <= 9007199254740991)
    ),
    constraint ck_market_v2_result_event_cursor check (event_cursor > 0)
);

create index ix_market_v2_results_cursor
    on public.market_v2_player_game_results (ruleset_id, event_cursor);
create index ix_market_v2_results_game
    on public.market_v2_player_game_results (ruleset_id, game_id, player_id);

create table public.market_v2_position_game_accruals (
    ruleset_id varchar(64) not null,
    position_id varchar(36) not null,
    game_id varchar(96) not null,
    account_id varchar(128) not null,
    player_id varchar(64) not null,
    game_date date not null,
    event_sequence integer not null,
    side varchar(8) not null,
    locked_game_cost_dollars bigint not null,
    status varchar(40) not null,
    base_result_revision integer,
    latest_result_revision integer not null,
    game_cost_dollars bigint not null default 0,
    dividend_dollars bigint,
    cumulative_pnl_dollars bigint not null default 0,
    event_cursor bigint not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    updated_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, position_id, game_id),
    constraint fk_market_v2_accrual_position foreign key (
        position_id, ruleset_id, account_id, player_id
    ) references public.market_v2_positions (
        id, ruleset_id, account_id, player_id
    ) on delete cascade,
    constraint fk_market_v2_accrual_account foreign key (ruleset_id, account_id)
        references public.market_v2_accounts (ruleset_id, account_id)
        on delete cascade,
    constraint fk_market_v2_accrual_result foreign key (
        ruleset_id, game_id, player_id, latest_result_revision
    ) references public.market_v2_player_game_results (
        ruleset_id, game_id, player_id, revision
    ) on delete restrict,
    constraint ck_market_v2_accrual_status check (
        status in ('settled', 'unsettled_missing_projection')
    ),
    constraint ck_market_v2_accrual_side check (side in ('long', 'short')),
    constraint ck_market_v2_accrual_locked_cost check (
        locked_game_cost_dollars > 0
        and locked_game_cost_dollars <= 1000000000000
    ),
    constraint ck_market_v2_accrual_sequence check (event_sequence >= 0),
    constraint ck_market_v2_accrual_revision check (latest_result_revision >= 1),
    constraint ck_market_v2_accrual_game_cost check (
        game_cost_dollars >= 0
        and game_cost_dollars <= 1000000000000
    ),
    constraint ck_market_v2_accrual_dividend check (
        dividend_dollars is null
        or (dividend_dollars >= -9007199254740991
            and dividend_dollars <= 9007199254740991)
    ),
    constraint ck_market_v2_accrual_pnl check (
        cumulative_pnl_dollars >= -9007199254740991
        and cumulative_pnl_dollars <= 9007199254740991
    ),
    constraint ck_market_v2_accrual_event_cursor check (event_cursor > 0)
);

create index ix_market_v2_accruals_account_cursor
    on public.market_v2_position_game_accruals (
        ruleset_id, account_id, event_cursor
    );

create table public.market_v2_ledger_entries (
    id varchar(36) primary key,
    ruleset_id varchar(64) not null,
    account_id varchar(128) not null,
    position_id varchar(36) not null,
    player_id varchar(64) not null,
    game_id varchar(96),
    game_date date,
    result_revision integer,
    kind varchar(32) not null,
    amount_dollars bigint not null,
    source_key varchar(200) not null,
    adjusts_entry_id varchar(36),
    event_cursor bigint not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    constraint fk_market_v2_ledger_position foreign key (
        position_id, ruleset_id, account_id, player_id
    ) references public.market_v2_positions (
        id, ruleset_id, account_id, player_id
    ) on delete cascade,
    constraint fk_market_v2_ledger_account foreign key (ruleset_id, account_id)
        references public.market_v2_accounts (ruleset_id, account_id)
        on delete cascade,
    constraint fk_market_v2_ledger_result foreign key (
        ruleset_id, game_id, player_id, result_revision
    ) references public.market_v2_player_game_results (
        ruleset_id, game_id, player_id, revision
    ) on delete restrict,
    constraint fk_market_v2_ledger_adjustment foreign key (adjusts_entry_id)
        references public.market_v2_ledger_entries (id) on delete restrict,
    constraint uq_market_v2_ledger_source unique (ruleset_id, source_key),
    constraint ck_market_v2_ledger_kind check (
        kind in ('game_cost', 'game_dividend', 'dividend_correction',
            'open_fee', 'drop_fee')
    ),
    constraint ck_market_v2_ledger_amount check (
        amount_dollars >= -9007199254740991
        and amount_dollars <= 9007199254740991
    ),
    constraint ck_market_v2_ledger_event_cursor check (event_cursor > 0)
);

create index ix_market_v2_ledger_account_cursor
    on public.market_v2_ledger_entries (ruleset_id, account_id, event_cursor);
create index ix_market_v2_ledger_game
    on public.market_v2_ledger_entries (ruleset_id, game_id, player_id);

create table public.market_v2_idempotency_commands (
    id varchar(36) primary key,
    ruleset_id varchar(64) not null,
    account_id varchar(128) not null,
    command_kind varchar(48) not null,
    idempotency_key varchar(128) not null,
    request_fingerprint varchar(64) not null,
    schema_version integer not null default 2,
    response_payload json not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    constraint fk_market_v2_command_ruleset foreign key (ruleset_id)
        references public.market_v2_rulesets (id) on delete cascade,
    constraint uq_market_v2_command_idempotency unique (
        ruleset_id, account_id, command_kind, idempotency_key
    ),
    constraint ck_market_v2_command_schema_version check (schema_version = 2)
);

create index ix_market_v2_commands_account_created
    on public.market_v2_idempotency_commands (
        ruleset_id, account_id, created_at
    );

create table public.market_v2_pnl_snapshots (
    ruleset_id varchar(64) not null,
    account_id varchar(128) not null,
    event_cursor bigint not null,
    game_id varchar(96),
    game_date date,
    cumulative_pnl_dollars bigint not null,
    latest_game_pnl_dollars bigint not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, account_id, event_cursor),
    constraint fk_market_v2_snapshot_account foreign key (ruleset_id, account_id)
        references public.market_v2_accounts (ruleset_id, account_id)
        on delete cascade,
    constraint ck_market_v2_snapshot_event_cursor check (event_cursor > 0),
    constraint ck_market_v2_snapshot_cumulative_pnl check (
        cumulative_pnl_dollars >= -9007199254740991
        and cumulative_pnl_dollars <= 9007199254740991
    ),
    constraint ck_market_v2_snapshot_latest_pnl check (
        latest_game_pnl_dollars >= -9007199254740991
        and latest_game_pnl_dollars <= 9007199254740991
    )
);

create index ix_market_v2_snapshots_account_cursor
    on public.market_v2_pnl_snapshots (ruleset_id, account_id, event_cursor);

-- Provision a usable historical-preview ruleset before the client cuts over to
-- /api/v2. New live rulesets keep the schema's fail-closed roster-lock defaults.
insert into public.market_v2_rulesets (
    id,
    version,
    season_id,
    dividend_basis,
    dividend_dollars_per_net_point,
    long_slot_limit,
    short_slot_limit,
    allow_opposing_positions,
    enforce_roster_lock,
    roster_mutations_locked,
    quote_add_impact_bps,
    quote_drop_impact_bps,
    transaction_fee_dollars,
    short_term_days,
    current_sequence,
    last_settled_date,
    next_game_date,
    event_cursor,
    is_active
) values (
    'per-game-v2-staging',
    1,
    coalesce((
        select season_id
        from public.market_game_state
        order by updated_at desc
        limit 1
    ), '2025-26'),
    'raw_net_points',
    40000,
    10,
    5,
    false,
    false,
    false,
    25,
    25,
    0,
    7,
    0,
    null,
    (select next_game_date
        from public.market_game_state
        order by updated_at desc
        limit 1),
    0,
    true
) on conflict (id) do nothing;

insert into public.market_v2_player_quotes (
    ruleset_id,
    player_id,
    current_game_cost_dollars,
    prior_season_value_per_game_dollars,
    version
)
select
    'per-game-v2-staging',
    id,
    least(1000000000000, greatest(1,
        round(opening_price_cents::numeric / 8200)::bigint
    )),
    least(1000000000000, greatest(1,
        round(opening_price_cents::numeric / 8200)::bigint
    )),
    0
from public.market_players
on conflict (ruleset_id, player_id) do nothing;

alter table public.market_v2_rulesets enable row level security;
alter table public.market_v2_game_boundaries enable row level security;
alter table public.market_v2_player_quotes enable row level security;
alter table public.market_v2_accounts enable row level security;
alter table public.market_v2_positions enable row level security;
alter table public.market_v2_saved_projections enable row level security;
alter table public.market_v2_player_game_results enable row level security;
alter table public.market_v2_position_game_accruals enable row level security;
alter table public.market_v2_ledger_entries enable row level security;
alter table public.market_v2_idempotency_commands enable row level security;
alter table public.market_v2_pnl_snapshots enable row level security;

revoke all privileges on table public.market_v2_rulesets
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_game_boundaries
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_player_quotes
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_accounts
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_positions
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_saved_projections
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_player_game_results
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_position_game_accruals
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_ledger_entries
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_idempotency_commands
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_pnl_snapshots
    from public, anon, authenticated;

grant all privileges on table public.market_v2_rulesets to service_role;
grant all privileges on table public.market_v2_game_boundaries to service_role;
grant all privileges on table public.market_v2_player_quotes to service_role;
grant all privileges on table public.market_v2_accounts to service_role;
grant all privileges on table public.market_v2_positions to service_role;
grant all privileges on table public.market_v2_saved_projections to service_role;
grant all privileges on table public.market_v2_player_game_results to service_role;
grant all privileges on table public.market_v2_position_game_accruals to service_role;
grant all privileges on table public.market_v2_ledger_entries to service_role;
grant all privileges on table public.market_v2_idempotency_commands to service_role;
grant all privileges on table public.market_v2_pnl_snapshots to service_role;

comment on table public.market_v2_ledger_entries is
    'Append-only integer-dollar ledger for per-game economy v2.';
comment on table public.market_v2_player_game_results is
    'Immutable provider result revisions; corrections append later revisions.';
comment on table public.market_v2_game_boundaries is
    'Canonical date and event sequence shared by every player result in a game.';
comment on table public.market_v2_position_game_accruals is
    'Durable position exposure and current reconciliation for each player-game.';

commit;
