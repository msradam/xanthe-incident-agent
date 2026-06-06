import Anthropic from "@anthropic-ai/sdk";
import type { Mcp } from "./mcp.js";

const SYSTEM = `You are an incident commander driving an incident-response runbook that is
mounted as a state machine. You may only take the moves the machine allows.

- Call state() to see the current state value, the accumulated context, and the legal moves.
- Call step({ event, payload }) to act. If a move is refused, the result lists the legal
  moves; pick a valid one and continue. Do not try to skip steps; the machine will refuse.
- Walk the runbook from detection to a written postmortem (the 'closed' terminal state).
- Supply realistic payloads where an event asks for them: severity, hypothesis, root cause,
  mitigation, recovery signal, resolution, and a short postmortem summary.

When the incident reaches 'closed', stop and give a one-paragraph summary of what happened.`;

const FIRST_MESSAGE =
  "A production incident was just detected: elevated 5xx errors on the orders service. Drive it to resolution.";

/**
 * Drive the runbook with a real model over MCP. The MCP tools (step/state/reset/fork)
 * are handed to Claude as tool-use tools; every tool call goes to the gated Xanthe
 * server, so the model is held to the runbook. Requires ANTHROPIC_API_KEY.
 */
export async function driveLLM(mcp: Mcp, opts: { model: string; log: (line: string) => void }): Promise<void> {
  const anthropic = new Anthropic();
  const tools: Anthropic.Tool[] = (await mcp.tools()).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: FIRST_MESSAGE }];

  for (let turn = 0; turn < 40; turn += 1) {
    const response = await anthropic.messages.create({
      model: opts.model,
      max_tokens: 1024,
      system: SYSTEM,
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: response.content });

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) opts.log(`agent: ${block.text.trim()}`);
    }

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const output = await mcp.call(use.name, (use.input ?? {}) as Record<string, unknown>);
      const label = output.outcome ?? (output.value !== undefined ? `state ${JSON.stringify(output.value)}` : "ok");
      opts.log(`  ${use.name}(${JSON.stringify(use.input)}) -> ${label}`);
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output) });
    }
    messages.push({ role: "user", content: results });
  }
}
