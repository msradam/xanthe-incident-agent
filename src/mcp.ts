import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const xantheCli = join(repoRoot, "node_modules", "xanthe", "dist", "cli.js");
export const machineSpec = join(repoRoot, "machine", "incident-runbook.ts") + "#incidentRunbook";

export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface Mcp {
  call(name: string, args?: Record<string, unknown>): Promise<any>;
  tools(): Promise<ToolSpec[]>;
  close(): Promise<void>;
}

/**
 * Spawn `xanthe serve` for the incident runbook and connect an MCP client to it.
 * The agent talks to the runbook only through the gated tools, exactly like any
 * other MCP client.
 */
export async function connect(xantheHome: string): Promise<Mcp> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [xantheCli, "serve", machineSpec],
    env: { ...process.env, XANTHE_HOME: xantheHome },
    stderr: "ignore",
  });
  const client = new Client({ name: "incident-agent", version: "0.1.0" });
  await client.connect(transport);

  return {
    async call(name, args = {}) {
      const result: any = await client.callTool({ name, arguments: args });
      return JSON.parse(result.content[0].text);
    },
    async tools() {
      return (await client.listTools()).tools as ToolSpec[];
    },
    close: () => client.close(),
  };
}

export const MACHINE_ID = "incidentRunbook";
