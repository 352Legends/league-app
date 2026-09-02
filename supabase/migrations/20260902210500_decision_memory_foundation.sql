create table public.decision_evaluations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.fantasy_leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  season integer not null,
  week integer not null check (week between 0 and 25),
  model_version text not null default 'priority-v1',
  input_fingerprint text not null,
  championship_probability numeric(8,3),
  playoff_probability numeric(8,3),
  week_win_probability numeric(8,3),
  alpha_opportunities integer not null default 0,
  urgent_decisions integer not null default 0,
  top_decision_key text,
  top_decision_title text,
  top_championship_delta numeric(8,3),
  generated_at timestamptz not null default now(),
  unique (user_id, league_id, input_fingerprint)
);

create index decision_evaluations_league_time_idx
  on public.decision_evaluations(league_id, generated_at desc);
create index decision_evaluations_user_time_idx
  on public.decision_evaluations(user_id, generated_at desc);

alter table public.decision_evaluations enable row level security;

revoke all on table public.decision_evaluations from anon, authenticated;
grant select, insert, delete on table public.decision_evaluations to authenticated;

create policy decision_evaluations_select_own
  on public.decision_evaluations for select to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.fantasy_leagues l
      where l.id = league_id and l.user_id = (select auth.uid())
    )
  );

create policy decision_evaluations_insert_own
  on public.decision_evaluations for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.fantasy_leagues l
      where l.id = league_id and l.user_id = (select auth.uid())
    )
  );

create policy decision_evaluations_delete_own
  on public.decision_evaluations for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.fantasy_leagues l
      where l.id = league_id and l.user_id = (select auth.uid())
    )
  );

alter table public.recommendations
  add column evaluation_id uuid references public.decision_evaluations(id) on delete cascade,
  add column decision_key text,
  add column priority_rank smallint check (priority_rank between 1 and 25),
  add column decision_horizon text check (decision_horizon in ('ONE_WEEK','SUSTAINED')),
  add column weekly_gain numeric(10,3),
  add column playoff_delta numeric(8,3),
  add column urgency numeric(8,3),
  add column priority_score numeric(10,3),
  add column source_href text,
  add column season integer,
  add column week integer check (week between 0 and 25),
  add column model_version text;

create index recommendations_evaluation_rank_idx
  on public.recommendations(evaluation_id, priority_rank);
create index recommendations_decision_history_idx
  on public.recommendations(user_id, league_id, decision_key, generated_at desc);

revoke insert on table public.recommendations from anon;
grant insert on table public.recommendations to authenticated;

create policy recommendations_insert_own
  on public.recommendations for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.fantasy_leagues l
      where l.id = league_id and l.user_id = (select auth.uid())
    )
    and (
      evaluation_id is null
      or exists (
        select 1 from public.decision_evaluations e
        where e.id = evaluation_id
          and e.user_id = (select auth.uid())
          and e.league_id = league_id
      )
    )
  );
