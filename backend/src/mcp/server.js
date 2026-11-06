const fs = require("fs");
const path = require("path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { routeCoverage } = require("./tools/coverageTool");
const { checkLimits } = require("./tools/limitsTool");
const { listRoutes } = require("./tools/routesTool");
const { describeSchema } = require("./tools/schemaTool");
const { runTests } = require("./tools/testsTool");

const BACKEND_DIR = path.join(__dirname, "..", "..");
const ROOT_DIR = path.join(BACKEND_DIR, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const SRC_DIR = path.join(BACKEND_DIR, "src");
const SCHEMA_FILE = path.join(BACKEND_DIR, "schema.sql");
const server = new McpServer({ name: "mcp", version: "1.0.0" });

// Wraps a string as an MCP text result
function textResult(text) {
  return { content: [{ type: "text", text }] };
}

// Registers every tool on the server
function registerTools() {
  server.registerTool(
    "list_routes",
    {
      description: "List the backend API routes (method, full path, route-specific middleware such as limiters), grouped by route file with the middleware shared by the whole file. Use this instead of reading route files.",
      inputSchema: z.object({
        filter: z.string().max(100).optional().describe("Only routes whose path contains this text, for example \"jobs\" or \"/tailor\"")
      })
    },
    async ({ filter }) => textResult(listRoutes(SRC_DIR, filter))
  );

  server.registerTool(
    "route_coverage",
    {
      description: "Check which API routes the database tests call, and which signed-in routes have no test that creates a second user (the cross-user check CLAUDE.md requires). A heuristic that follows test helper functions, so confirm a flagged route by reading its tests. Use this instead of cross-reading list_routes against the test files.",
      inputSchema: z.object({
        filter: z.string().max(100).optional().describe("Only routes whose path contains this text, for example \"jobs\" or \"/tailor\"")
      })
    },
    async ({ filter }) => textResult(routeCoverage(SRC_DIR, filter))
  );

  server.registerTool(
    "describe_schema",
    {
      description: "Describe the database schema from schema.sql. Without a table it lists every table with its column names; with a table it gives the full columns, constraints and indexes, including later ALTER statements. Use this instead of reading schema.sql.",
      inputSchema: z.object({
        table: z.string().max(100).optional().describe("Table name, for example \"applications\"")
      })
    },
    async ({ table }) => textResult(describeSchema(fs.readFileSync(SCHEMA_FILE, "utf8"), table))
  );

  server.registerTool(
    "check_limits",
    {
      description: "List every character and count limit in the project (limit maps, limits written inline on the server, and form maxLength values), and flag form limits that are above the matching server limit. Matches are by field name, so check the lines it points to. Use this instead of grepping for maxLength and MAX_LENGTH across files.",
      inputSchema: z.object({})
    },
    async () => textResult(checkLimits(ROOT_DIR))
  );

  server.registerTool(
    "run_tests",
    {
      description: "Run the unit tests of the backend (default) or the frontend, never the database tests, and return a short summary: the pass count and only the failing tests with trimmed messages. Use this instead of running npm test and reading its full output.",
      inputSchema: z.object({
        project: z.enum(["backend", "frontend"]).optional().describe("Which project to test, backend by default"),
        filter: z.string().max(200).optional().describe("Only test files whose path contains this text, for example \"applicationFields\"")
      })
    },
    async ({ project, filter }) => textResult(await runTests(project === "frontend" ? FRONTEND_DIR : BACKEND_DIR, filter))
  );
}

// Starts the server on stdio
async function main() {
  registerTools();
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
