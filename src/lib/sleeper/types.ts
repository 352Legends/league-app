export type SleeperUser = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
};

export type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
  sport: string;
  status: string;
  total_rosters: number;
  draft_id: string | null;
  avatar: string | null;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number | string | null>;
};

export type SleeperLeagueUser = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  metadata?: Record<string, string>;
  is_owner?: boolean;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  settings: Record<string, number | null>;
  metadata?: Record<string, string> | null;
};

export type SleeperMatchup = {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  custom_points: number | null;
  players: string[];
  starters: string[];
};

export type SleeperDraft = {
  draft_id: string;
  league_id: string | null;
  season: string;
  status: string;
  type: string;
  start_time: number | null;
  settings: Record<string, number | null>;
  metadata: Record<string, string>;
};

export type SleeperPlayer = {
  player_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  team?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  status?: string | null;
  injury_status?: string | null;
  depth_chart_position?: number | null;
  number?: number | null;
};

export type SleeperNflState = {
  week: number;
  leg: number;
  season: string;
  season_type: string;
  display_week: number;
  league_season: string;
};
