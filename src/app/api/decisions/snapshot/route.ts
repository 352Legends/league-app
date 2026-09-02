import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const prioritySchema = z.object({
  decisionKey: z.string().min(1).max(300),
  type: z.enum(["LINEUP", "WAIVER", "TRADE"]),
  horizon: z.enum(["ONE_WEEK", "SUSTAINED"]),
  title: z.string().min(1).max(500),
  summary: z.string().min(1).max(2000),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW", "SPECULATIVE"]),
  weeklyGain: z.number().finite().min(-30).max(30),
  championshipDelta: z.number().finite().min(-100).max(100).nullable(),
  playoffDelta: z.number().finite().min(-100).max(100).nullable(),
  urgency: z.number().finite().min(0).max(100),
  priorityScore: z.number().finite().min(-10000).max(10000),
  sourceHref: z.string().min(1).max(2000),
  reasons: z.array(z.string().min(1).max(1000)).max(8),
});

const snapshotSchema = z.object({
  providerLeagueId: z.string().min(1).max(100),
  season: z.number().int().min(2020).max(2100),
  week: z.number().int().min(0).max(25),
  modelVersion: z.string().min(1).max(100),
  championshipProbability: z.number().finite().min(0).max(100),
  playoffProbability: z.number().finite().min(0).max(100),
  weekWinProbability: z.number().finite().min(0).max(100).nullable(),
  alphaOpportunities: z.number().int().min(0).max(1000),
  urgentDecisions: z.number().int().min(0).max(1000),
  priorities: z.array(prioritySchema).max(25),
});

function stableFingerprint(payload: z.infer<typeof snapshotSchema>): string {
  const normalized = {
    providerLeagueId: payload.providerLeagueId,
    season: payload.season,
    week: payload.week,
    modelVersion: payload.modelVersion,
    championshipProbability: Number(payload.championshipProbability.toFixed(2)),
    playoffProbability: Number(payload.playoffProbability.toFixed(2)),
    weekWinProbability: payload.weekWinProbability == null ? null : Number(payload.weekWinProbability.toFixed(2)),
    alphaOpportunities: payload.alphaOpportunities,
    urgentDecisions: payload.urgentDecisions,
    priorities: payload.priorities.map((priority, index) => ({
      rank: index + 1,
      decisionKey: priority.decisionKey,
      type: priority.type,
      horizon: priority.horizon,
      weeklyGain: Number(priority.weeklyGain.toFixed(2)),
      championshipDelta: priority.championshipDelta == null ? null : Number(priority.championshipDelta.toFixed(2)),
      playoffDelta: priority.playoffDelta == null ? null : Number(priority.playoffDelta.toFixed(2)),
      urgency: Number(priority.urgency.toFixed(1)),
      confidence: priority.confidence,
      reasons: priority.reasons,
    })),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function dbConfidence(value: z.infer<typeof prioritySchema>["confidence"]): string {
  return value.toLowerCase();
}

export async function POST(request: Request) {
  let parsed: z.infer<typeof snapshotSchema>;
  try {
    parsed = snapshotSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: "Invalid decision snapshot", detail: error instanceof Error ? error.message : "validation failed" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: league, error: leagueError } = await supabase
    .from("fantasy_leagues")
    .select("id")
    .eq("user_id", authData.user.id)
    .eq("provider", "sleeper")
    .eq("provider_league_id", parsed.providerLeagueId)
    .maybeSingle();

  if (leagueError) return NextResponse.json({ error: leagueError.message }, { status: 500 });
  if (!league) {
    return NextResponse.json({
      error: "Decision Memory requires a saved WAR ROOM league",
      code: "LEAGUE_NOT_SAVED",
    }, { status: 409 });
  }

  const fingerprint = stableFingerprint(parsed);
  const top = parsed.priorities[0] ?? null;
  const evaluationRow = {
    league_id: league.id,
    user_id: authData.user.id,
    season: parsed.season,
    week: parsed.week,
    model_version: parsed.modelVersion,
    input_fingerprint: fingerprint,
    championship_probability: parsed.championshipProbability,
    playoff_probability: parsed.playoffProbability,
    week_win_probability: parsed.weekWinProbability,
    alpha_opportunities: parsed.alphaOpportunities,
    urgent_decisions: parsed.urgentDecisions,
    top_decision_key: top?.decisionKey ?? null,
    top_decision_title: top?.title ?? null,
    top_championship_delta: top?.championshipDelta ?? null,
  };

  const { data: insertedEvaluation, error: evaluationError } = await supabase
    .from("decision_evaluations")
    .insert(evaluationRow)
    .select("id,generated_at")
    .single();

  if (evaluationError?.code === "23505") {
    const { data: existing, error: existingError } = await supabase
      .from("decision_evaluations")
      .select("id,generated_at")
      .eq("league_id", league.id)
      .eq("input_fingerprint", fingerprint)
      .maybeSingle();
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    return NextResponse.json({ saved: false, duplicate: true, evaluationId: existing?.id ?? null, generatedAt: existing?.generated_at ?? null });
  }

  if (evaluationError || !insertedEvaluation) {
    return NextResponse.json({ error: evaluationError?.message ?? "Unable to save evaluation" }, { status: 500 });
  }

  if (parsed.priorities.length) {
    const generatedAt = new Date().toISOString();
    const rows = parsed.priorities.map((priority, index) => ({
      evaluation_id: insertedEvaluation.id,
      league_id: league.id,
      user_id: authData.user.id,
      recommendation_type: priority.type,
      decision_key: priority.decisionKey,
      priority_rank: index + 1,
      decision_horizon: priority.horizon,
      title: priority.title,
      summary: priority.summary,
      confidence: dbConfidence(priority.confidence),
      weekly_win_delta: null,
      championship_delta: priority.championshipDelta,
      playoff_delta: priority.playoffDelta,
      weekly_gain: priority.weeklyGain,
      urgency: priority.urgency,
      priority_score: priority.priorityScore,
      source_href: priority.sourceHref,
      season: parsed.season,
      week: parsed.week,
      model_version: parsed.modelVersion,
      evidence: priority.reasons,
      risks: [],
      alternatives: [],
      generated_at: generatedAt,
    }));

    const { error: recommendationsError } = await supabase.from("recommendations").insert(rows);
    if (recommendationsError) {
      await supabase.from("decision_evaluations").delete().eq("id", insertedEvaluation.id);
      return NextResponse.json({ error: recommendationsError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    saved: true,
    duplicate: false,
    evaluationId: insertedEvaluation.id,
    generatedAt: insertedEvaluation.generated_at,
  });
}
