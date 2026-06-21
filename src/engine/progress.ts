/**
 * Progress rollup (native port of gsd-progress). A single read-only status view that composes the existing
 * engines: the milestone/phase table (roadmap + plan counts + UAT verdict), the next action (route()), and the
 * open-artifact audit. No new state — it's the at-a-glance "where am I" the orchestrator and the user both read.
 */
import { route } from "./route.js";
import { roadmapPhases } from "./verify.js";
import { scanUat, auditOpen } from "./audit.js";

export interface PhaseProgress {
  number: string;
  name: string;
  verification: "passed" | "failed" | "missing";
}

export interface Progress {
  nextAction: string;
  nextPhase: string | null;
  reason: string;
  phases: PhaseProgress[];
  completedPhases: number;
  totalPhases: number;
  open: ReturnType<typeof auditOpen>;
}

/** Build the progress rollup for a `.planning/` dir. */
export function buildProgress(planningDir: string): Progress {
  const r = route(planningDir);
  const rp = roadmapPhases(planningDir);
  const uat = new Map(scanUat(planningDir).map((u) => [u.phase, u.verification]));
  const phases: PhaseProgress[] = rp.map((p) => ({
    number: p.number,
    name: p.name,
    verification: uat.get(p.number) ?? "missing",
  }));
  const completedPhases = phases.filter((p) => p.verification === "passed").length;
  return {
    nextAction: r.action,
    nextPhase: r.phase ?? null,
    reason: r.reason ?? "",
    phases,
    completedPhases,
    totalPhases: phases.length,
    open: auditOpen(planningDir),
  };
}
