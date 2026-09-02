import { createClient } from "@/lib/supabase/server";
import type { PreviousDecisionEvaluation, PreviousTopRecommendation } from "@/lib/analytics/decision-memory";

export type LoadedDecisionMemory = {
  active: boolean;
  savedLeagueId: string | null;
  previous: PreviousDecisionEvaluation | null;
  previousTop: PreviousTopRecommendation | null;
};

export async function loadPreviousDecisionMemory(providerLeagueId: string): Promise<LoadedDecisionMemory> {
  try {
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return { active: false, savedLeagueId: null, previous: null, previousTop: null };

    const { data: league, error: leagueError } = await supabase
      .from("fantasy_leagues")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("provider", "sleeper")
      .eq("provider_league_id", providerLeagueId)
      .maybeSingle();

    if (leagueError || !league) return { active: false, savedLeagueId: null, previous: null, previousTop: null };

    const { data: evaluation, error: evaluationError } = await supabase
      .from("decision_evaluations")
      .select("id,generated_at,championship_probability,playoff_probability,week_win_probability,alpha_opportunities,urgent_decisions,top_decision_key,top_decision_title,top_championship_delta")
      .eq("league_id", league.id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (evaluationError || !evaluation) {
      return { active: true, savedLeagueId: league.id, previous: null, previousTop: null };
    }

    const { data: topRecommendation } = await supabase
      .from("recommendations")
      .select("decision_key,title,urgency,priority_score,championship_delta,evidence")
      .eq("evaluation_id", evaluation.id)
      .order("priority_rank", { ascending: true })
      .limit(1)
      .maybeSingle();

    return {
      active: true,
      savedLeagueId: league.id,
      previous: {
        id: evaluation.id,
        generatedAt: evaluation.generated_at,
        championshipProbability: evaluation.championship_probability == null ? null : Number(evaluation.championship_probability),
        playoffProbability: evaluation.playoff_probability == null ? null : Number(evaluation.playoff_probability),
        weekWinProbability: evaluation.week_win_probability == null ? null : Number(evaluation.week_win_probability),
        alphaOpportunities: Number(evaluation.alpha_opportunities ?? 0),
        urgentDecisions: Number(evaluation.urgent_decisions ?? 0),
        topDecisionKey: evaluation.top_decision_key,
        topDecisionTitle: evaluation.top_decision_title,
        topChampionshipDelta: evaluation.top_championship_delta == null ? null : Number(evaluation.top_championship_delta),
      },
      previousTop: topRecommendation ? {
        decisionKey: topRecommendation.decision_key,
        title: topRecommendation.title,
        urgency: topRecommendation.urgency == null ? null : Number(topRecommendation.urgency),
        priorityScore: topRecommendation.priority_score == null ? null : Number(topRecommendation.priority_score),
        championshipDelta: topRecommendation.championship_delta == null ? null : Number(topRecommendation.championship_delta),
        reasons: Array.isArray(topRecommendation.evidence) ? topRecommendation.evidence.filter((value): value is string => typeof value === "string") : [],
      } : null,
    };
  } catch {
    return { active: false, savedLeagueId: null, previous: null, previousTop: null };
  }
}
