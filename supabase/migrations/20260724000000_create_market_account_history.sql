begin;

-- The NBA-26 market-write barrier is the first lock in every compatible API
-- write. Taking it here drains those transactions before any table lock and
-- prevents account/source lock-order deadlocks during the cutover.
select pg_advisory_xact_lock(1846237911);

lock table public.market_accounts in access exclusive mode;

alter table public.market_accounts
    add column reset_at timestamp without time zone not null
        default timezone('utc', now());

update public.market_accounts
set reset_at = created_at;

-- Close the backfill/trigger-installation race after compatible workers drain.
-- The compatibility triggers below cover their writes after this commit.
lock table public.market_trades,
    public.market_dividends,
    public.market_weekly_shorts,
    public.market_boosts,
    public.market_settlements
    in share row exclusive mode;

create table public.market_account_activity (
    id varchar(36) primary key,
    account_id varchar(128) not null,
    kind varchar(32) not null,
    player_id varchar(64),
    game_date date,
    amount_cents bigint not null,
    source_key varchar(128) not null,
    details json not null,
    occurred_at timestamp without time zone not null
        default timezone('utc', now()),
    constraint fk_market_account_activity_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint fk_market_account_activity_player foreign key (player_id)
        references public.market_players (id) on delete restrict,
    constraint uq_market_account_activity_source unique (account_id, source_key),
    constraint ck_market_account_activity_kind check (
        kind in ('trade_buy', 'trade_sell', 'weekly_short_opened',
            'boost_armed', 'dividend', 'weekly_short_settled',
            'weekly_short_voided', 'boost_consumed', 'boost_refunded')
    ),
    constraint ck_market_account_activity_amount_range check (
        amount_cents >= -9000000000000000000
        and amount_cents <= 9000000000000000000
    )
);

create index ix_market_account_activity_account_occurred
    on public.market_account_activity (account_id, occurred_at, id);
create index ix_market_account_activity_account_kind_occurred
    on public.market_account_activity (account_id, kind, occurred_at, id);

-- Preserve authoritative activity created before this read model existed.
insert into public.market_account_activity (
    id, account_id, kind, player_id, game_date, amount_cents,
    source_key, details, occurred_at
)
select
    md5(t.account_id || ':trade:' || t.id)::uuid::text,
    t.account_id,
    'trade_' || t.side,
    t.player_id,
    null,
    case
        when t.side = 'buy' then -(t.execution_price_cents + t.fee_cents)
        else t.execution_price_cents - t.fee_cents
    end,
    'trade:' || t.id,
    json_build_object(
        'side', t.side,
        'execution_price_cents', t.execution_price_cents,
        'fee_cents', t.fee_cents,
        'new_price_cents', t.new_price_cents
    ),
    t.created_at
from public.market_trades t
on conflict (account_id, source_key) do nothing;

insert into public.market_account_activity (
    id, account_id, kind, player_id, game_date, amount_cents,
    source_key, details, occurred_at
)
select
    md5(
        d.account_id || ':dividend:' || d.game_date::text || ':' || d.player_id
    )::uuid::text,
    d.account_id,
    'dividend',
    d.player_id,
    d.game_date,
    d.amount_cents,
    'dividend:' || d.game_date::text || ':' || d.player_id,
    json_build_object(
        'actual_net_points_micros', e.actual_net_points_micros,
        'expected_net_points_micros', e.expected_net_points_micros
    ),
    d.created_at
from public.market_dividends d
left join public.market_replay_events e
    on e.game_date = d.game_date and e.player_id = d.player_id
on conflict (account_id, source_key) do nothing;

insert into public.market_account_activity (
    id, account_id, kind, player_id, game_date, amount_cents,
    source_key, details, occurred_at
)
select
    md5(s.account_id || ':weekly_short:' || s.id || ':opened')::uuid::text,
    s.account_id,
    'weekly_short_opened',
    s.player_id,
    null,
    -s.fee_cents,
    'weekly_short:' || s.id || ':opened',
    json_build_object(
        'opening_price_cents', s.opening_price_cents,
        'fee_cents', s.fee_cents,
        'collateral_cents', s.collateral_cents,
        'week_start', s.week_start::text
    ),
    s.created_at
from public.market_weekly_shorts s
on conflict (account_id, source_key) do nothing;

insert into public.market_account_activity (
    id, account_id, kind, player_id, game_date, amount_cents,
    source_key, details, occurred_at
)
select
    md5(s.account_id || ':weekly_short:' || s.id || ':' || s.status)::uuid::text,
    s.account_id,
    case
        when s.status = 'settled' then 'weekly_short_settled'
        else 'weekly_short_voided'
    end,
    s.player_id,
    s.settled_game_date,
    case when s.status = 'voided' then s.fee_cents else s.payout_cents end,
    'weekly_short:' || s.id || ':' || s.status,
    json_build_object(
        'fee_cents', s.fee_cents,
        'collateral_cents', s.collateral_cents,
        'qualifying_games', s.qualifying_games,
        'accrued_net_points_micros', s.accrued_net_points_micros
    ),
    s.updated_at
from public.market_weekly_shorts s
where s.status in ('settled', 'voided')
on conflict (account_id, source_key) do nothing;

insert into public.market_account_activity (
    id, account_id, kind, player_id, game_date, amount_cents,
    source_key, details, occurred_at
)
select
    md5(b.account_id || ':boost:' || b.id || ':armed')::uuid::text,
    b.account_id,
    'boost_armed',
    b.player_id,
    b.target_game_date,
    -b.fee_cents,
    'boost:' || b.id || ':armed',
    json_build_object(
        'opening_price_cents', b.opening_price_cents,
        'fee_cents', b.fee_cents,
        'week_start', b.week_start::text,
        'target_game_date', b.target_game_date::text
    ),
    b.created_at
from public.market_boosts b
on conflict (account_id, source_key) do nothing;

insert into public.market_account_activity (
    id, account_id, kind, player_id, game_date, amount_cents,
    source_key, details, occurred_at
)
select
    md5(b.account_id || ':boost:' || b.id || ':' || b.status)::uuid::text,
    b.account_id,
    case when b.status = 'consumed' then 'boost_consumed' else 'boost_refunded' end,
    b.player_id,
    b.settled_game_date,
    case when b.status = 'consumed' then b.payout_cents else b.fee_cents end,
    'boost:' || b.id || ':' || b.status,
    json_build_object(
        'fee_cents', b.fee_cents,
        'payout_cents', b.payout_cents,
        'target_game_date', b.target_game_date::text
    ),
    b.updated_at
from public.market_boosts b
where b.status in ('consumed', 'refunded')
on conflict (account_id, source_key) do nothing;

-- Preserve legacy settlement visibility as durable membership. New settlements
-- use portfolio snapshots as their account membership record.
create table public.market_account_settlement_memberships (
    account_id varchar(128) not null,
    game_date date not null,
    primary key (account_id, game_date),
    constraint fk_market_account_settlement_membership_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint fk_market_account_settlement_membership_settlement foreign key (game_date)
        references public.market_settlements (game_date) on delete cascade
);

insert into public.market_account_settlement_memberships (account_id, game_date)
select a.id, s.game_date
from public.market_accounts a
cross join public.market_settlements s
on conflict (account_id, game_date) do nothing;

create table public.market_portfolio_snapshots (
    account_id varchar(128) not null,
    game_date date not null,
    cash_cents bigint not null,
    free_cash_cents bigint not null,
    reserved_collateral_cents bigint not null,
    market_value_cents bigint not null,
    total_value_cents bigint not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    primary key (account_id, game_date),
    constraint fk_market_portfolio_snapshot_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint fk_market_portfolio_snapshot_settlement foreign key (game_date)
        references public.market_settlements (game_date) on delete cascade,
    constraint ck_market_portfolio_snapshot_reserved check (
        reserved_collateral_cents >= 0
    ),
    constraint ck_market_portfolio_snapshot_market_value check (
        market_value_cents >= 0
    ),
    constraint ck_market_portfolio_snapshot_free_cash check (
        free_cash_cents = cash_cents - reserved_collateral_cents
    ),
    constraint ck_market_portfolio_snapshot_total_value check (
        total_value_cents = cash_cents + market_value_cents
    )
);

create table public.market_account_reset_commands (
    id varchar(36) primary key,
    account_id varchar(128) not null,
    idempotency_key varchar(128) not null,
    request_fingerprint varchar(64) not null,
    response_payload json not null,
    created_at timestamp without time zone not null
        default timezone('utc', now()),
    constraint fk_market_account_reset_command_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint uq_market_reset_account_idempotency
        unique (account_id, idempotency_key)
);

create index ix_market_account_reset_commands_account_created
    on public.market_account_reset_commands (account_id, created_at);

-- Compatibility triggers keep the new read models complete while older API
-- workers drain during a rolling deployment. New workers detect these rows by
-- source key and do not insert duplicates.
create function public.market_history_trade_activity_compat()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    insert into public.market_account_activity (
        id, account_id, kind, player_id, game_date, amount_cents,
        source_key, details, occurred_at
    ) values (
        md5(new.account_id || ':trade:' || new.id)::uuid::text,
        new.account_id,
        'trade_' || new.side,
        new.player_id,
        null,
        case
            when new.side = 'buy' then -(new.execution_price_cents + new.fee_cents)
            else new.execution_price_cents - new.fee_cents
        end,
        'trade:' || new.id,
        json_build_object(
            'side', new.side,
            'execution_price_cents', new.execution_price_cents,
            'fee_cents', new.fee_cents,
            'new_price_cents', new.new_price_cents
        ),
        new.created_at
    ) on conflict (account_id, source_key) do nothing;
    return new;
end;
$$;

create trigger market_history_trade_activity_compat
after insert on public.market_trades
for each row execute function public.market_history_trade_activity_compat();

create function public.market_history_dividend_activity_compat()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
    actual_micros bigint;
    expected_micros bigint;
begin
    select e.actual_net_points_micros, e.expected_net_points_micros
    into actual_micros, expected_micros
    from public.market_replay_events e
    where e.game_date = new.game_date and e.player_id = new.player_id;

    insert into public.market_account_activity (
        id, account_id, kind, player_id, game_date, amount_cents,
        source_key, details, occurred_at
    ) values (
        md5(
            new.account_id || ':dividend:' || new.game_date::text || ':'
            || new.player_id
        )::uuid::text,
        new.account_id,
        'dividend',
        new.player_id,
        new.game_date,
        new.amount_cents,
        'dividend:' || new.game_date::text || ':' || new.player_id,
        json_build_object(
            'actual_net_points_micros', actual_micros,
            'expected_net_points_micros', expected_micros
        ),
        new.created_at
    ) on conflict (account_id, source_key) do nothing;
    return new;
end;
$$;

create trigger market_history_dividend_activity_compat
after insert on public.market_dividends
for each row execute function public.market_history_dividend_activity_compat();

create function public.market_history_short_opened_compat()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    insert into public.market_account_activity (
        id, account_id, kind, player_id, game_date, amount_cents,
        source_key, details, occurred_at
    ) values (
        md5(new.account_id || ':weekly_short:' || new.id || ':opened')::uuid::text,
        new.account_id,
        'weekly_short_opened',
        new.player_id,
        null,
        -new.fee_cents,
        'weekly_short:' || new.id || ':opened',
        json_build_object(
            'opening_price_cents', new.opening_price_cents,
            'fee_cents', new.fee_cents,
            'collateral_cents', new.collateral_cents,
            'week_start', new.week_start::text
        ),
        new.created_at
    ) on conflict (account_id, source_key) do nothing;
    return new;
end;
$$;

create trigger market_history_short_opened_compat
after insert on public.market_weekly_shorts
for each row execute function public.market_history_short_opened_compat();

create function public.market_history_short_terminal_compat()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    insert into public.market_account_activity (
        id, account_id, kind, player_id, game_date, amount_cents,
        source_key, details, occurred_at
    ) values (
        md5(
            new.account_id || ':weekly_short:' || new.id || ':' || new.status
        )::uuid::text,
        new.account_id,
        case
            when new.status = 'settled' then 'weekly_short_settled'
            else 'weekly_short_voided'
        end,
        new.player_id,
        new.settled_game_date,
        case
            when new.status = 'voided' then new.fee_cents
            else coalesce(new.payout_cents, 0)
        end,
        'weekly_short:' || new.id || ':' || new.status,
        json_build_object(
            'fee_cents', new.fee_cents,
            'collateral_cents', new.collateral_cents,
            'qualifying_games', new.qualifying_games,
            'accrued_net_points_micros', new.accrued_net_points_micros
        ),
        new.updated_at
    ) on conflict (account_id, source_key) do nothing;
    return new;
end;
$$;

create trigger market_history_short_terminal_compat
after update of status on public.market_weekly_shorts
for each row
when (
    old.status is distinct from new.status
    and new.status in ('settled', 'voided')
)
execute function public.market_history_short_terminal_compat();

create function public.market_history_boost_armed_compat()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    insert into public.market_account_activity (
        id, account_id, kind, player_id, game_date, amount_cents,
        source_key, details, occurred_at
    ) values (
        md5(new.account_id || ':boost:' || new.id || ':armed')::uuid::text,
        new.account_id,
        'boost_armed',
        new.player_id,
        new.target_game_date,
        -new.fee_cents,
        'boost:' || new.id || ':armed',
        json_build_object(
            'opening_price_cents', new.opening_price_cents,
            'fee_cents', new.fee_cents,
            'week_start', new.week_start::text,
            'target_game_date', new.target_game_date::text
        ),
        new.created_at
    ) on conflict (account_id, source_key) do nothing;
    return new;
end;
$$;

create trigger market_history_boost_armed_compat
after insert on public.market_boosts
for each row execute function public.market_history_boost_armed_compat();

create function public.market_history_boost_terminal_compat()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    insert into public.market_account_activity (
        id, account_id, kind, player_id, game_date, amount_cents,
        source_key, details, occurred_at
    ) values (
        md5(new.account_id || ':boost:' || new.id || ':' || new.status)::uuid::text,
        new.account_id,
        case
            when new.status = 'consumed' then 'boost_consumed'
            else 'boost_refunded'
        end,
        new.player_id,
        new.settled_game_date,
        case
            when new.status = 'consumed' then coalesce(new.payout_cents, 0)
            else new.fee_cents
        end,
        'boost:' || new.id || ':' || new.status,
        json_build_object(
            'fee_cents', new.fee_cents,
            'payout_cents', new.payout_cents,
            'target_game_date', new.target_game_date::text
        ),
        new.updated_at
    ) on conflict (account_id, source_key) do nothing;
    return new;
end;
$$;

create trigger market_history_boost_terminal_compat
after update of status on public.market_boosts
for each row
when (
    old.status is distinct from new.status
    and new.status in ('consumed', 'refunded')
)
execute function public.market_history_boost_terminal_compat();

create function public.market_history_settlement_snapshot_compat()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    if not exists (
        select 1
        from public.market_accounts a
        left join public.market_portfolio_snapshots snapshot
            on snapshot.account_id = a.id
            and snapshot.game_date = new.game_date
        where snapshot.account_id is null
    ) then
        return new;
    end if;

    insert into public.market_portfolio_snapshots (
        account_id, game_date, cash_cents, free_cash_cents,
        reserved_collateral_cents, market_value_cents,
        total_value_cents, created_at
    )
    select
        a.id,
        new.game_date,
        a.cash_cents,
        a.cash_cents - coalesce(r.reserved_cents, 0),
        coalesce(r.reserved_cents, 0),
        coalesce(h.market_value_cents, 0),
        a.cash_cents + coalesce(h.market_value_cents, 0),
        new.settled_at
    from public.market_accounts a
    left join (
        select
            holding.account_id,
            sum(holding.shares * player.current_price_cents)::bigint
                as market_value_cents
        from public.market_holdings holding
        join public.market_players player on player.id = holding.player_id
        group by holding.account_id
    ) h on h.account_id = a.id
    left join (
        select
            position.account_id,
            sum(position.collateral_cents)::bigint as reserved_cents
        from public.market_weekly_shorts position
        where position.status = 'active'
        group by position.account_id
    ) r on r.account_id = a.id
    on conflict (account_id, game_date) do nothing;
    return new;
end;
$$;

create constraint trigger market_history_settlement_snapshot_compat
after insert on public.market_settlements
deferrable initially deferred
for each row execute function public.market_history_settlement_snapshot_compat();

alter table public.market_account_activity enable row level security;
alter table public.market_account_settlement_memberships enable row level security;
alter table public.market_portfolio_snapshots enable row level security;
alter table public.market_account_reset_commands enable row level security;

revoke all privileges on table public.market_account_activity
    from public, anon, authenticated;
revoke all privileges on table public.market_account_settlement_memberships
    from public, anon, authenticated;
revoke all privileges on table public.market_portfolio_snapshots
    from public, anon, authenticated;
revoke all privileges on table public.market_account_reset_commands
    from public, anon, authenticated;

grant all privileges on table public.market_account_activity to service_role;
grant all privileges on table public.market_account_settlement_memberships
    to service_role;
grant all privileges on table public.market_portfolio_snapshots to service_role;
grant all privileges on table public.market_account_reset_commands to service_role;

comment on table public.market_account_activity is
    'Append-only server-owned account activity used by authenticated history APIs.';
comment on table public.market_account_settlement_memberships is
    'Durable legacy settlement visibility captured before exact snapshots existed.';
comment on table public.market_portfolio_snapshots is
    'One server-computed closing portfolio value per account and replay date.';
comment on table public.market_account_reset_commands is
    'Idempotent self-account reset command records.';

commit;
