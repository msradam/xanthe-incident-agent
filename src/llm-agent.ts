import { query } from "@anthropic-ai/claude-agent-sdk";
import { xantheCli, machineSpec } from "./mcp.js";

const SYSTEM = `You are an on-call incident commander driving an incident-response runbook that is
mounted as a state machine over MCP. You may only take the moves the machine allows.

- mcp__incident__state shows the current state, the context, and the legal moves.
- mcp__incident__step({ event, payload }) takes a move. If refused, the result names the legal moves.

Before each move, say ONE short plain-text line (no markdown, under 12 words) about what you are
doing. Keep each payload realistic but brief, one sentence. Use only the mcp__incident__ tools.
Drive the incident to the 'closed' state, then stop with a one-line summary.`;

const TASK = `Production incident detected: elevated 5xx errors on the orders service.
First prove the runbook enforces order by trying to "resolve" right away (it should refuse,
nothing is mitigated yet). Then drive the incident properly to a written postmortem (the
'closed' state).`;

/**
 * Drive the runbook with Claude through the Claude Agent SDK, which authenticates with the
 * existing Claude Code session (no API key). The Xanthe server is registered as an MCP server,
 * so Claude only ever acts through the gated step/state tools.
 */
export async function driveLLM(home: string, model: string, log: (line: string) => void): Promise<void> {
  const run = query({
    prompt: TASK,
    options: {
      model,
      systemPrompt: SYSTEM,
      mcpServers: {
        incident: {
          command: "node",
          args: [xantheCli, "serve", machineSpec],
          env: { ...process.env, XANTHE_HOME: home } as Record<string, string>,
        },
      },
      allowedTools: ["mcp__incident__step", "mcp__incident__state"],
      maxTurns: 40,
    },
  });

  for await (const message of run as AsyncIterable<any>) {
    if (message.type !== "assistant") continue;
    for (const block of message.message.content) {
      if (block.type === "text" && block.text.trim()) {
        log(block.text.trim());
      } else if (block.type === "tool_use" && typeof block.name === "string" && block.name.startsWith("mcp__")) {
        if (block.name === "mcp__incident__step") {
          log(`  -> step: ${block.input?.event}`);
        } else {
          log(`  -> ${block.name.replace(/^mcp__incident__/, "")}`);
        }
      }
    }
  }
}
