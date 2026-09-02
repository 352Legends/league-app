import type { PriorityCandidate } from "@/lib/analytics/priorities";

export const DECISION_MEMORY_MODEL_VERSION = "priority-v2-memory";

export type DecisionMemoryPriority = {
  decisionKey: string;
  type: PriorityCandidate["type"];
  horizon: PriorityCandidate["horizon"];
  title: string;
  summary: string;
  confidence: PriorityCandidate["confidence"];
  weeklyGain: number;
  championshipDelta: number | null;
  playoffDelta: number | null;
  urgency: number;
  priorityScore: number;
  sourceHref: string;
  reasons: string[];
};

export type DecisionMemorySnapshotPayload = {
  providerLeagueId: string;
  season: number;
  week: number;
  modelVersion: string;
  championshipProbability: number;
  playoffProbability: number;
  weekWinProbability: number | null;
  alphaOpportunities: number;
  urgentDecisions: number;
  priorities: DecisionMemoryPriority[];
};

export type PreviousDecisionEvaluation = {
  id: string;
  generatedAt: string;
  championshipProbability: number | null;
  playoffProbability: number | null;
  weekWinProbability: number | null;
  alphaOpportunities: number;
  urgentDecisions: number;
  topDecisionKey: string | null;
  topDecisionTitle: string | null;
  topChampionshipDelta: number | null;
};

export type PreviousTopRecommendation = {
  decisionKey: string | null;
  title: string;
  urgency: number | null;
  priorityScore: number | null;
  championshipDelta: number | null;
};

export type DecisionMemoryChange = {
  kind: "FIRST_SNAPSHOT" | "TOP_MOVE_CHANGED" | "MATERIAL_CHANGE" | "STABLE";
  headline: string;
  details: string[];
  previousGeneratedAt: string | null;
};

const signed = (value: number, suffix = " pts") => `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;

export function toDecisionMemoryPriority(candidate: PriorityCandidate): DecisionMemoryPriority {
  return {
    decisionKey: candidate.id,
    type: candidate.type,
    horizon: candidate.horizon,
    title: candidate.title,
    summary: candidate.summary,
    confidence: candidate.confidence,
    weeklyGain: candidate.weeklyGain,
    championshipDelta: candidate.championshipDelta,
    playoffDelta: candidate.playoffDelta,
    urgency: candidate.urgency,
    priorityScore: candidate.priorityScore,
    sourceHref: candidate.href,
    reasons: candidate.reasons,
  };
}

export function compareDecisionMemory(args: {
  current: DecisionMemorySnapshotPayload;
  previous: PreviousDecisionEvaluation | null;
  previousTop: PreviousTopRecommendation | null;
}): DecisionMemoryChange {
  const { current, previous, previousTop } = args;
  const currentTop = current.priorities[0] ?? null;

  if (!previous) {
    return {
      kind: "FIRST_SNAPSHOT",
      headline: "Decision Memory starts with this evaluation.",
      details: ["WAR ROOM will compare the next Mission Control refresh against this board and explain any material change."],
      previousGeneratedAt: null,
    };
  }

  const details: string[] = [];
  const topChanged = Boolean(currentTop && previous.topDecisionKey && currentTop.decisionKey !== previous.topDecisionKey);

  if (topChanged && currentTop) {
    details.push(`The #1 move changed from ${previous.topDecisionTitle ?? previousTop?.title ?? "the previous recommendation"} to ${currentTop.title}.`);
  }

  const championshipShift = current.championshipProbability - Number(previous.championshipProbability ?? current.championshipProbability);
  if (Math.abs(championshipShift) >= 1) {
    details.push(`Baseline championship probability moved ${signed(championshipShift)} since the prior evaluation.`);
  }

  if (current.weekWinProbability != null && previous.weekWinProbability != null) {
    const winShift = current.weekWinProbability - previous.weekWinProbability;
    if (Math.abs(winShift) >= 5) details.push(`This-week win probability moved ${signed(winShift)}.`);
  }

  const alphaShift = current.alphaOpportunities - previous.alphaOpportunities;
  if (Math.abs(alphaShift) >= 1) {
    details.push(`${Math.abs(alphaShift)} ${alphaShift > 0 ? "new" : "fewer"} actionable Alpha opportunity${Math.abs(alphaShift) === 1 ? "" : "ies"} ${alphaShift > 0 ? "entered" : "remain in"} the available-player pool.`);
  }

  const urgentShift = current.urgentDecisions - previous.urgentDecisions;
  if (Math.abs(urgentShift) >= 1) {
    details.push(`Urgent decision count changed from ${previous.urgentDecisions} to ${current.urgentDecisions}.`);
  }

  if (currentTop && previousTop && currentTop.decisionKey === previousTop.decisionKey) {
    const impactShift = (currentTop.championshipDelta ?? 0) - Number(previousTop.championshipDelta ?? 0);
    const urgencyShift = currentTop.urgency - Number(previousTop.urgency ?? currentTop.urgency);
    if (Math.abs(impactShift) >= 0.5) details.push(`The same #1 move now carries ${signed(impactShift)} more modeled championship impact than before.`);
    if (Math.abs(urgencyShift) >= 10) details.push(`Its urgency score moved ${signed(urgencyShift, " points")}, indicating a meaningful timing or market shift.`);
  }

  if (topChanged) {
    return {
      kind: "TOP_MOVE_CHANGED",
      headline: "Automated GM changed the #1 move.",
      details: details.length ? details : ["The cross-decision ranking changed after new league, market, usage, or simulation inputs were evaluated."],
      previousGeneratedAt: previous.generatedAt,
    };
  }

  if (details.length) {
    return {
      kind: "MATERIAL_CHANGE",
      headline: "The recommendation is holding, but the environment changed.",
      details,
      previousGeneratedAt: previous.generatedAt,
    };
  }

  return {
    kind: "STABLE",
    headline: "No material decision change since the last evaluation.",
    details: ["The current #1 move and core probability signals remain inside WAR ROOM's material-change thresholds."],
    previousGeneratedAt: previous.generatedAt,
  };
}
