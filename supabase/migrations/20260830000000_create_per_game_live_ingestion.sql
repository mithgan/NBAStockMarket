begin;

select pg_advisory_xact_lock(1846237911);

create table public.market_v2_live_slates (
    ruleset_id varchar(64) not null,
    provider varchar(32) not null,
    game_date date not null,
    next_game_date date,
    next_game_date_resolved boolean not null default false,
    schedule_complete boolean not null default false,
    expected_game_ids json not null,
    manifest_fingerprint varchar(64) not null,
    lock_succeeded boolean not null default false,
    completion_succeeded boolean not null default false,
    completion_next_event_sequence integer,
    unlock_succeeded boolean not null default false,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    updated_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, provider, game_date),
    constraint ck_market_v2_live_slate_completion_sequence check (
        completion_next_event_sequence is null
        or completion_next_event_sequence >= 0
    ),
    constraint fk_market_v2_live_slate_ruleset foreign key (ruleset_id)
        references public.market_v2_rulesets (id) on delete cascade
);

create index ix_market_v2_live_slates_date
    on public.market_v2_live_slates (ruleset_id, game_date);

create table public.market_v2_live_games (
    ruleset_id varchar(64) not null,
    provider varchar(32) not null,
    provider_game_id varchar(96) not null,
    game_id varchar(96) not null,
    season_id varchar(32) not null,
    game_date date not null,
    started_at timestamp without time zone not null,
    next_game_date date,
    event_sequence integer not null,
    status varchar(16) not null,
    home_team_id varchar(32) not null,
    away_team_id varchar(32) not null,
    expected_player_ids json not null,
    ignored_player_ids json not null default '[]'::json,
    schedule_history json not null default '[]'::json,
    source_fingerprint varchar(64) not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    updated_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, provider, provider_game_id),
    constraint fk_market_v2_live_game_ruleset foreign key (ruleset_id)
        references public.market_v2_rulesets (id) on delete cascade,
    constraint uq_market_v2_live_game_identity unique (ruleset_id, game_id),
    constraint ck_market_v2_live_game_sequence check (event_sequence >= 0),
    constraint ck_market_v2_live_game_status check (
        status in ('scheduled', 'in_progress', 'final', 'postponed', 'cancelled')
    )
);

create index ix_market_v2_live_games_date
    on public.market_v2_live_games (ruleset_id, provider, game_date);

create table public.market_v2_provider_player_map (
    provider varchar(32) not null,
    provider_player_id varchar(96) not null,
    player_id varchar(64) not null,
    player_name varchar(120) not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (provider, provider_player_id),
    constraint fk_market_v2_provider_player_listing foreign key (player_id)
        references public.market_players (id) on delete restrict,
    constraint uq_market_v2_provider_player_identity unique (provider, player_id)
);

create table public.market_v2_live_result_commands (
    ruleset_id varchar(64) not null,
    provider varchar(32) not null,
    provider_game_id varchar(96) not null,
    provider_player_id varchar(96) not null,
    revision integer not null,
    game_id varchar(96) not null,
    player_id varchar(64) not null,
    result_fingerprint varchar(64) not null,
    actual_net_points_micros bigint not null,
    idempotency_key varchar(128) not null,
    request_payload json not null,
    status varchar(32) not null default 'pending',
    error_code varchar(64),
    attempt_count integer not null default 0,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    updated_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (ruleset_id, provider, provider_game_id, provider_player_id, revision),
    constraint fk_market_v2_live_result_game foreign key (
        ruleset_id, provider, provider_game_id
    ) references public.market_v2_live_games (
        ruleset_id, provider, provider_game_id
    ) on delete restrict,
    constraint fk_market_v2_live_result_player_map foreign key (
        provider, provider_player_id
    ) references public.market_v2_provider_player_map (
        provider, provider_player_id
    ) on delete restrict,
    constraint fk_market_v2_live_result_quote foreign key (ruleset_id, player_id)
        references public.market_v2_player_quotes (ruleset_id, player_id)
        on delete restrict,
    constraint uq_market_v2_live_result_idempotency unique (
        ruleset_id, idempotency_key
    ),
    constraint ck_market_v2_live_result_revision check (revision >= 1),
    constraint ck_market_v2_live_result_actual_range check (
        actual_net_points_micros >= -1000000000
        and actual_net_points_micros <= 1000000000
    ),
    constraint ck_market_v2_live_result_status check (
        status in ('pending', 'succeeded', 'permanent_failure')
    ),
    constraint ck_market_v2_live_result_attempts check (attempt_count >= 0)
);

create index ix_market_v2_live_results_pending
    on public.market_v2_live_result_commands (
        ruleset_id, status, created_at
    );

alter table public.market_v2_live_slates enable row level security;
alter table public.market_v2_live_games enable row level security;
alter table public.market_v2_provider_player_map enable row level security;
alter table public.market_v2_live_result_commands enable row level security;

revoke all privileges on table public.market_v2_live_slates
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_live_games
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_provider_player_map
    from public, anon, authenticated;
revoke all privileges on table public.market_v2_live_result_commands
    from public, anon, authenticated;

grant all privileges on table public.market_v2_live_slates to service_role;
grant all privileges on table public.market_v2_live_games to service_role;
grant all privileges on table public.market_v2_provider_player_map to service_role;
grant all privileges on table public.market_v2_live_result_commands to service_role;

comment on table public.market_v2_live_slates is
    'Complete provider manifests and lock, date-completion, and unlock delivery state.';
comment on table public.market_v2_live_games is
    'Provider game identities, auditable schedule revisions, and v2 settlement boundaries.';
comment on table public.market_v2_provider_player_map is
    'Stable provider-to-market player crosswalk; ambiguous names fail closed.';
comment on table public.market_v2_live_result_commands is
    'Durable append-only provider fingerprints and retryable v2 commands.';

commit;
