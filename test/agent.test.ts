import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLedgerStore, verifyChain } from "xanthe";
import { connect, MACHINE_ID } from "../src/mcp.js";
import { drivePolicy } from "../src/policy-agent.js";

describe("incident agent drives the runbook on rails", () => {
  it("is gated, reaches a complete postmortem, and the ledger verifies", async () => {
    const home = mkdtempSync(join(tmpdir(), "incident-agent-test-"));
    const mcp = await connect(home);
    const start = await mcp.call("state");
    const sessionId = start.session_id;
    expect(start.value).toBe("detected");

    // The gate is structural: resolve before mitigating is refused, not advanced.
    const premature = await mcp.call("step", { event: "resolve", payload: { resolution: "noop" } });
    expect(premature.outcome).toBe("refused");
    expect((await mcp.call("state")).value).toBe("detected");

    // The policy agent walks the runbook to the terminal state.
    const beats = await drivePolicy(mcp, () => {});
    expect(beats.every((b) => b.outcome === "allowed")).toBe(true);

    const final = await mcp.call("state");
    expect(final.value).toBe("closed");
    expect(final.terminal).toBe(true);

    // Every gated step recorded its field; by `closed` the postmortem is complete.
    for (const key of ["severity", "hypothesis", "rootCause", "mitigation", "verifiedBy", "resolution", "postmortem"]) {
      expect(final.context[key]).toBeTruthy();
    }

    await mcp.close();

    // The ledger is a tamper-evident record of the whole response, refusal included.
    const entries = new FileLedgerStore(home).read(MACHINE_ID, sessionId);
    expect(verifyChain(entries, sessionId).ok).toBe(true);
    expect(entries.some((e) => e.outcome === "refused" && e.action === "resolve")).toBe(true);
  });
});
