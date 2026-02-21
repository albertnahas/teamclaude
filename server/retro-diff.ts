import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { historyDir } from "./storage.js";
import { parseRetro } from "./retro.js";

export interface RetroMetrics {
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  avgReviewRounds: number;
}

export interface RetroDiff {
  sprintA: { id: string; metrics: RetroMetrics };
  sprintB: { id: string; metrics: RetroMetrics };
  delta: {
    completionRate: number;   // B - A (positive = improved)
    avgReviewRounds: number;  // B - A (negative = improved)
    taskCount: number;        // B - A
  };
  commonIssues: string[];   // recommendations in both A and B
  resolved: string[];       // in A but not B
  newIssues: string[];      // in B but not A
}

async function loadRetroMarkdown(sprintId: string): Promise<string | null> {
  const path = join(historyDir(), sprintId, "retro.md");
  return readFile(path, "utf-8").catch(() => null);
}

export async function diffRetros(idA: string, idB: string): Promise<RetroDiff | null> {
  const [mdA, mdB] = await Promise.all([
    loadRetroMarkdown(idA),
    loadRetroMarkdown(idB),
  ]);

  if (!mdA || !mdB) return null;

  const retroA = parseRetro(mdA);
  const retroB = parseRetro(mdB);

  const metricsA: RetroMetrics = retroA.summary;
  const metricsB: RetroMetrics = retroB.summary;

  const setA = new Set(retroA.recommendations);
  const setB = new Set(retroB.recommendations);

  const commonIssues = retroA.recommendations.filter((r) => setB.has(r));
  const resolved = retroA.recommendations.filter((r) => !setB.has(r));
  const newIssues = retroB.recommendations.filter((r) => !setA.has(r));

  return {
    sprintA: { id: idA, metrics: metricsA },
    sprintB: { id: idB, metrics: metricsB },
    delta: {
      completionRate: metricsB.completionRate - metricsA.completionRate,
      avgReviewRounds: metricsB.avgReviewRounds - metricsA.avgReviewRounds,
      taskCount: metricsB.totalTasks - metricsA.totalTasks,
    },
    commonIssues,
    resolved,
    newIssues,
  };
}
