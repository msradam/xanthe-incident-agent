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

const mcp = await connect(home);
log(`incident-response agent (${mode} mode), ledger at ${home}\n`);

const start = await mcp.call("state");
const sessionId: string = start.session_id;

// The runbook is the source of truth: a premature resolve is refused, not trusted to judgment.
const premature = await mcp.call("step", { event: "resolve", payload: { resolution: "looks fine" } });
log(`gate check: resolve before mitigating -> ${premature.outcome} (legal here: ${premature.legal.join(", ")})\n`);

log("driving the runbook:");
if (mode === "llm") {
  await driveLLM(mcp, { model, log });
} else {
  await drivePolicy(mcp, log);
}

const final = await mcp.call("state");
log(`\nfinal state: ${JSON.stringify(final.value)} (terminal: ${final.terminal})`);
log("postmortem assembled by being forced through the runbook:");
log(JSON.stringify(final.context, null, 2));

await mcp.close();

const entries = new FileLedgerStore(home).read(MACHINE_ID, sessionId);
const result = verifyChain(entries, sessionId);
log(`\nledger: ${result.ok ? "intact" : `BROKEN at seq ${result.brokenSeq}: ${result.reason}`} (${result.count} entries, including the refused gate check)`);
log(`head: ${result.headHash}`);
