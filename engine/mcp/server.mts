// MCP server for the Crew engine. stdio by default; `--http` (or CREW_MCP_PORT) = Streamable HTTP with Bearer CREW_API_TOKEN.
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./tools.mts";

const port = process.argv.includes("--http") || process.env.CREW_MCP_PORT ? Number(process.env.CREW_MCP_PORT ?? 3801) : 0;

if (!port) {
  await createServer().connect(new StdioServerTransport());
} else {
  const token = Buffer.from(process.env.CREW_API_TOKEN ?? "");
  if (!token.length) throw new Error("CREW_API_TOKEN is required for the HTTP transport");
  const ok = (h?: string) => {
    const given = Buffer.from(h?.match(/^Bearer (.+)$/)?.[1] ?? "");
    return given.length === token.length && timingSafeEqual(given, token);
  };
  http.createServer(async (req, res) => {
    if (!ok(req.headers.authorization)) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" }).end('{"error":"unauthorized"}');
      return;
    }
    if (req.url?.split("?")[0] !== "/mcp") return void res.writeHead(404).end();
    // Stateless: a fresh server + transport per request.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close().then(() => server.close()));
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }).listen(port, process.env.CREW_MCP_HOST ?? "0.0.0.0", () => console.error(`crew-engine MCP on :${port}/mcp`));
}
