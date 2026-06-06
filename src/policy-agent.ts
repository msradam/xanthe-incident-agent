import type { Mcp } from "./mcp.js";

export interface Beat {
  from: string;
  event: string;
  outcome: string;
  to: unknown;
}

/**
 * A deterministic incident-resolution policy: from each runbook state, the next
 * move toward `closed`, with realistic payloads. This drives the same gated
 * machine the LLM agent drives, with no API key, so the loop and the audit trail
 * can be exercised offline and in tests.
 */
const POLICY: Record<string, { event: string; payload?: Record<string, unknown> }> = {
  detected: { event: "triage", payload: { severity: "sev2" } },
  triaged: { event: "page_oncall" },
  engaged: { event: "form_hypothesis", payload: { hypothesis: "elevated 5xx on orders after deploy #4711" } },
  investigating: { event: "identify_root_cause", payload: { rootCause: "a schema migration took a table lock on orders" } },
  diagnosed: { event: "apply_mitigation", payload: { mitigation: "rolled back deploy #4711 and released the lock" } },
  mitigated: { event: "verify_recovery", payload: { signal: "5xx back to baseline, pager cleared for 10m" } },
  recovered: { event: "resolve", payload: { resolution: "rollback restored service; migration to be reworked offline" } },
  resolved: {
    event: "write_postmortem",
    payload: { summary: "sev2, 22m. Cause: locking migration on orders. Fix: rollback. Action: add a migration-lock lint." },
  },
};

function valueOf(state: { value: unknown }): string {
  return typeof state.value === "string" ? state.value : JSON.stringify(state.value);
}

const stepDelayMs = Number(process.env.STEP_DELAY_MS) || 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function drivePolicy(mcp: Mcp, log: (line: string) => void): Promise<Beat[]> {
  const beats: Beat[] = [];
  let state = await mcp.call("state");
  for (let i = 0; i < 50 && !state.terminal; i += 1) {
    const from = valueOf(state);
    const move = POLICY[from];
    if (!move) {
      log(`no policy for '${from}' (legal: ${state.legal.join(", ")})`);
      break;
    }
    if (stepDelayMs) await sleep(stepDelayMs);
    const result = await mcp.call("step", { event: move.event, payload: move.payload });
    const landed = typeof result.to === "string" ? result.to : JSON.stringify(result.to);
    const outcome = result.outcome === "refused" ? "REFUSED" : `-> ${landed}`;
    log(`  ${from.padEnd(14)} ${move.event.padEnd(20)} ${outcome}`);
    beats.push({ from, event: move.event, outcome: result.outcome, to: result.to });
    state = await mcp.call("state");
  }
  return beats;
}
