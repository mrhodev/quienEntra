-- quienEntra: esquema inicial (spec §7.3, §7.4)
-- Todas las tablas usan ids generados en el cliente (offline-first) y soft delete.

create extension if not exists pgcrypto;

-- ---------- Tipos ----------
create type player_position as enum ('ARQ', 'DEF', 'MED', 'DEL');
create type member_role as enum ('owner', 'editor');
create type attendance as enum ('present', 'absent', 'injured', 'late');
create type match_status as enum ('draft', 'planned', 'live', 'finished');

-- ---------- Utilidades ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- Tablas ----------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  color text not null default '#16a34a',
  public_slug text unique,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table team_members (
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  nickname text,
  shirt_number smallint check (shirt_number between 0 and 999),
  primary_position player_position not null default 'MED',
  secondary_positions player_position[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on players (team_id);

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  starts_on date,
  ends_on date,
  -- RotationConfig por defecto (lib/rotation/types.ts)
  default_config jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on tournaments (team_id);

create table matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  tournament_id uuid not null references tournaments (id) on delete cascade,
  kickoff_at timestamptz,
  opponent text,
  is_home boolean,
  status match_status not null default 'draft',
  config jsonb not null,
  goals_for smallint not null default 0,
  goals_against smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on matches (team_id);
create index on matches (tournament_id);

create table match_players (
  team_id uuid not null references teams (id) on delete cascade,
  match_id uuid not null references matches (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  attendance attendance not null default 'present',
  available_from_min numeric not null default 0,
  available_until_min numeric,
  updated_at timestamptz not null default now(),
  primary key (match_id, player_id)
);
create index on match_players (team_id);

create table match_plans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  match_id uuid not null references matches (id) on delete cascade,
  version int not null,
  plan jsonb not null,
  locks jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, version)
);
create index on match_plans (team_id);

-- Log de eventos: fuente de verdad del partido (append-only).
create table match_events (
  id uuid primary key,
  team_id uuid not null references teams (id) on delete cascade,
  match_id uuid not null references matches (id) on delete cascade,
  seq int not null,
  type text not null check (type in (
    'lineup_set', 'period_start', 'period_end', 'pause', 'resume', 'sub', 'gk_change',
    'injury', 'player_available', 'goal_for', 'goal_against', 'undo', 'match_end'
  )),
  payload jsonb not null default '{}',
  match_time_ms bigint not null check (match_time_ms >= 0),
  wall_time timestamptz not null,
  device_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on match_events (match_id);
create index on match_events (team_id, updated_at);

-- Resultado derivado del log (lo calcula lib/match/derive.ts al cerrar o sincronizar un partido).
create table match_player_stats (
  team_id uuid not null references teams (id) on delete cascade,
  match_id uuid not null references matches (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  field_seconds int not null default 0,
  goalkeeper_seconds int not null default 0,
  -- Cuota justa del plan (para el % sobre la cuota y el acumulado r_i del torneo).
  target_seconds int not null default 0,
  available_seconds int not null default 0,
  goals smallint not null default 0,
  -- [{ role, position, periodIndex, startMs, endMs }] para la línea de tiempo (RF-28).
  stints jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (match_id, player_id)
);
create index on match_player_stats (team_id);

-- ---------- Triggers ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','teams','players','tournaments','matches','match_players',
                           'match_plans','match_events','match_player_stats']
  loop
    execute format('create trigger set_updated_at before update on %I
                    for each row execute function set_updated_at()', t);
  end loop;
end $$;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function handle_new_team() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into team_members (team_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger on_team_created after insert on teams
  for each row execute function handle_new_team();

-- ---------- RLS ----------
create or replace function is_team_member(p_team_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members where team_id = p_team_id and user_id = auth.uid()
  );
$$;

alter table profiles enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table players enable row level security;
alter table tournaments enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;
alter table match_plans enable row level security;
alter table match_events enable row level security;
alter table match_player_stats enable row level security;

create policy "own profile" on profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- owner_id: el INSERT ... RETURNING se evalúa antes de que el trigger cree la membresía.
create policy "members read team" on teams
  for select to authenticated using (owner_id = auth.uid() or is_team_member(id));
create policy "create own team" on teams
  for insert to authenticated with check (owner_id = auth.uid());
create policy "members update team" on teams
  for update to authenticated using (is_team_member(id)) with check (is_team_member(id));
create policy "owner deletes team" on teams
  for delete to authenticated using (owner_id = auth.uid());

create policy "members read members" on team_members
  for select to authenticated using (is_team_member(team_id));

do $$
declare t text;
begin
  foreach t in array array['players','tournaments','matches','match_players','match_plans',
                           'match_events','match_player_stats']
  loop
    execute format('create policy "team members" on %I for all to authenticated
                    using (is_team_member(team_id)) with check (is_team_member(team_id))', t);
  end loop;
end $$;

-- ---------- Vista pública (RF-31, CA-07) ----------
-- Solo equipos con link público activo y solo partidos finalizados.
create or replace function public_team_stats(p_slug text)
returns table (
  team_name text,
  team_color text,
  tournament_id uuid,
  tournament_name text,
  match_id uuid,
  kickoff_at timestamptz,
  opponent text,
  goals_for smallint,
  goals_against smallint,
  player_id uuid,
  player_name text,
  shirt_number smallint,
  field_seconds int,
  goalkeeper_seconds int,
  target_seconds int,
  available_seconds int,
  goals smallint,
  stints jsonb
)
language sql stable security definer set search_path = public as $$
  select t.name, t.color, tr.id, tr.name, m.id, m.kickoff_at, m.opponent, m.goals_for,
         m.goals_against, p.id, coalesce(p.nickname, p.name), p.shirt_number,
         s.field_seconds, s.goalkeeper_seconds, s.target_seconds, s.available_seconds,
         s.goals, s.stints
  from teams t
  join tournaments tr on tr.team_id = t.id and tr.deleted_at is null
  join matches m on m.tournament_id = tr.id and m.status = 'finished' and m.deleted_at is null
  join match_player_stats s on s.match_id = m.id
  join players p on p.id = s.player_id
  where t.public_slug = p_slug and t.is_public and t.deleted_at is null
  order by m.kickoff_at, p.name;
$$;

revoke all on function public_team_stats(text) from public;
grant execute on function public_team_stats(text) to anon, authenticated;
