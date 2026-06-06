import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLedgerStore, verifyChain } from "xanthe";
import { connect, MACHINE_ID } from "./mcp.js";
import { drivePolicy } from "./policy-agent.js";
import { driveLLM } from "./llm-agent.js";

const mode = process.argv.includes("--llm") ? "llm" : "policy";
const model = process.env.MODEL ?? "claude-sonnet-4-6";
const home = mkdtempSync(join(tmpdir(), "incident-agent-"));
const log = (line: string) => console.log(line);

if (mode === "llm") {
  log("incident-response agent (Claude via the Agent SDK, using your Claude auth)\n");
  await driveLLM(home, model, log);
} else {
  log("incident-response agent (offline policy driver)\n");
  const mcp = await connect(home);
  // The runbook is the source of truth: a premature resolve is refused, not trusted to judgment.
  const premature = await mcp.call("step", { event: "resolve", payload: { resolution: "looks fine" } });
  log(`gate check: resolve before mitigating -> ${premature.outcome} (legal: ${premature.legal.join(", ")})\n`);
  log("driving the runbook:");
  await drivePolicy(mcp, log);
  await mcp.close();
}

// The ledger is a tamper-evident record of the whole response, refused steps included.
const store = new FileLedgerStore(home);
log("");
for (const sessionId of store.listSessions(MACHINE_ID)) {
  const entries = store.read(MACHINE_ID, sessionId);
  const result = verifyChain(entries, sessionId);
  const last = entries[entries.length - 1];
  log(`ledger: ${result.ok ? "intact" : `BROKEN at seq ${result.brokenSeq}`} (${result.count} entries) | final state: ${JSON.stringify(last?.state.value)}`);
}
