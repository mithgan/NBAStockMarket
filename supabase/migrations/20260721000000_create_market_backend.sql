begin;

create table public.market_accounts (
    id varchar(128) primary key,
    display_name varchar(80) not null,
    cash_cents bigint not null default 14000000000,
    version integer not null default 0,
    created_at timestamp without time zone not null default timezone('utc', now()),
    updated_at timestamp without time zone not null default timezone('utc', now()),
    constraint ck_market_account_cash check (cash_cents >= 0),
    constraint ck_market_account_version check (version >= 0)
);

create table public.market_players (
    id varchar(64) primary key,
    name varchar(120) not null,
    tier varchar(32) not null,
    current_price_cents bigint not null,
    opening_price_cents bigint not null,
    actual_salary_cents bigint not null,
    shares_outstanding integer not null default 100,
    held_shares integer not null default 0,
    version integer not null default 0,
    created_at timestamp without time zone not null default timezone('utc', now()),
    updated_at timestamp without time zone not null default timezone('utc', now()),
    constraint ck_market_player_price check (current_price_cents > 0),
    constraint ck_market_player_opening_price check (opening_price_cents > 0),
    constraint ck_market_player_salary check (actual_salary_cents >= 0),
    constraint ck_market_player_float check (shares_outstanding > 0),
    constraint ck_market_player_held_shares check (
        held_shares >= 0 and held_shares <= shares_outstanding
    ),
    constraint ck_market_player_version check (version >= 0)
);

create index ix_market_players_name on public.market_players (name);

create table public.market_holdings (
    account_id varchar(128) not null,
    player_id varchar(64) not null,
    shares integer not null default 1,
    average_cost_cents bigint not null,
    created_at timestamp without time zone not null default timezone('utc', now()),
    primary key (account_id, player_id),
    constraint fk_market_holding_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint fk_market_holding_player foreign key (player_id)
        references public.market_players (id) on delete cascade,
    constraint ck_market_holding_whole_player check (shares = 1),
    constraint ck_market_holding_cost check (average_cost_cents > 0)
);

create table public.market_trades (
    id varchar(36) primary key,
    account_id varchar(128) not null,
    player_id varchar(64) not null,
    side varchar(4) not null,
    execution_price_cents bigint not null,
    fee_cents bigint not null,
    new_price_cents bigint not null,
    idempotency_key varchar(128) not null,
    request_fingerprint varchar(64) not null,
    is_roundtrip boolean not null default false,
    response_payload json not null,
    created_at timestamp without time zone not null default timezone('utc', now()),
    constraint fk_market_trade_account foreign key (account_id)
        references public.market_accounts (id) on delete cascade,
    constraint fk_market_trade_player foreign key (player_id)
        references public.market_players (id) on delete restrict,
    constraint uq_market_trade_account_idempotency
        unique (account_id, idempotency_key),
    constraint ck_market_trade_side check (side in ('buy', 'sell')),
    constraint ck_market_trade_execution_price check (execution_price_cents > 0),
    constraint ck_market_trade_fee check (fee_cents >= 0),
    constraint ck_market_trade_new_price check (new_price_cents > 0)
);

create index ix_market_trades_account_created
    on public.market_trades (account_id, created_at);
create index ix_market_trades_account_player
    on public.market_trades (account_id, player_id, created_at);
create index ix_market_trades_player_created
    on public.market_trades (player_id, created_at);

alter table public.market_accounts enable row level security;
alter table public.market_players enable row level security;
alter table public.market_holdings enable row level security;
alter table public.market_trades enable row level security;

revoke all privileges on table public.market_accounts from public, anon, authenticated;
revoke all privileges on table public.market_players from public, anon, authenticated;
revoke all privileges on table public.market_holdings from public, anon, authenticated;
revoke all privileges on table public.market_trades from public, anon, authenticated;

grant all privileges on table public.market_accounts to service_role;
grant all privileges on table public.market_players to service_role;
grant all privileges on table public.market_holdings to service_role;
grant all privileges on table public.market_trades to service_role;

comment on table public.market_accounts is
    'Server-owned NBA Stock Market accounts keyed by the external Databallr auth user id.';
comment on table public.market_players is
    'Server-owned player listings and whole-player share availability.';
comment on table public.market_holdings is
    'Authoritative whole-player holdings; clients have no direct table access.';
comment on table public.market_trades is
    'Immutable idempotent trade ledger; clients have no direct table access.';

commit;
