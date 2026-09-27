import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const TOOLS = [
  {
    name: "get_daily_metrics",
    description: "Instagram account metrics (followers, reach, views) for a given date, per account. Defaults to yesterday. Reads stored data — use refresh_live_data first if you need this moment's numbers.",
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD, optional" } } },
  },
  {
    name: "get_sales_summary",
    description: "Gumroad sales count, revenue, and running total for a given date. Defaults to yesterday. Reads stored data — use refresh_live_data first if you need this moment's numbers. Gumroad's sales API does not provide product/site visit counts; visits come from tracked link clicks or Gumroad UTM analytics.",
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD, optional" } } },
  },
  {
    name: "get_funnel_summary",
    description: "Aggregate funnel (reach, engagement, tracked link clicks, sales) over the last N days. Defaults to 7. Visit counts are available only when tracked links record clicks; Gumroad's sales API does not return site visits.",
    inputSchema: { type: "object", properties: { days: { type: "number", description: "Number of days back, optional" } } },
  },
  {
    name: "get_pipeline_health",
    description: "Last run status, row count, and timestamp for each data-ingestion function.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "refresh_live_data",
    description: "Triggers a real, live pull from Instagram or Gumroad right now, waits for it to finish, then returns the fresh numbers. Use this when asked for 'current', 'live', or 'right now' data — otherwise the other tools return whatever was last pulled on schedule. Rate-limited to once per 5 minutes per source to avoid burning through the platform's own API limits.",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string", enum: ["instagram", "gumroad"] } },
      required: ["source"],
    },
  },
]

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method === "GET" || req.method === "DELETE" || req.method === "HEAD") {
    return new Response(null, { status: 405, headers: { ...CORS_HEADERS, "Allow": "POST, OPTIONS" } })
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS })
  }

  const projectUrl = Deno.env.get("SUPABASE_URL")!
  const supabase = createClient(projectUrl, Deno.env.get("SUPABASE_ANON_KEY")!)
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const supabaseAdmin = serviceRoleKey ? createClient(projectUrl, serviceRoleKey) : null
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), {
      status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    })
  }
  const { id, method, params } = body as { id?: string | number | null; method?: string; params?: Record<string, any> }
  const requestVersion = req.headers.get("MCP-Protocol-Version")
  const metaVersion = params?._meta?.["io.modelcontextprotocol/protocolVersion"]
  const protocolVersion = metaVersion ?? requestVersion
  const modern = protocolVersion === "2026-07-28"
  const methodHeader = req.headers.get("Mcp-Method")
  const nameHeader = req.headers.get("Mcp-Name")

  const respond = (result: unknown, status = 200) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
      status, headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
      },
    })
  const rpcError = (code: number, message: string, status = 200) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), {
      status, headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    })
  const logClient = async (clientName: string) => {
    await supabase.rpc("mcp_log_tool_call", { p_client_name: clientName.toLowerCase().includes("claude") ? "claude" : clientName.toLowerCase().includes("chatgpt") || clientName.toLowerCase().includes("openai") ? "chatgpt" : clientName })
  }

  if (modern) {
    if (!methodHeader || methodHeader !== method) return rpcError(-32600, "Mcp-Method header must match the JSON-RPC method", 400)
    if (method === "tools/call" && (!nameHeader || nameHeader !== params?.name)) return rpcError(-32600, "Mcp-Name header must match params.name", 400)
  }

  if (method === "server/discover") {
    if (!modern) return rpcError(-32601, "Method not found")
    const clientName = params?._meta?.["io.modelcontextprotocol/clientInfo"]?.name ?? "unknown"
    await logClient(clientName)
    return respond({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {} },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "analytics", version: "1.2.0" } },
      instructions: "Analytics tools for stored Instagram metrics and Gumroad sales. Gumroad's sales API does not return visits; explain that funnel visit counts represent tracked link clicks or separately configured Gumroad UTM analytics. Use refresh_live_data only when the user asks for live or current data.",
      ttlMs: 0,
      cacheScope: "public",
    })
  }

  if (method === "initialize") {
    const clientName = params?.clientInfo?.name ?? "unknown"
    const requestedVersion = params?.protocolVersion
    const supportedVersions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
    const negotiatedVersion = supportedVersions.includes(requestedVersion) ? requestedVersion : "2025-11-25"
    await logClient(clientName)
    return respond({ protocolVersion: negotiatedVersion, capabilities: { tools: {} }, serverInfo: { name: "analytics", version: "1.2.0" } })
  }

  if (typeof method === "string" && method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: CORS_HEADERS })
  }

  if (method === "ping") return respond({})

  if (method === "tools/list") {
    return respond(modern
      ? { resultType: "complete", tools: TOOLS, ttlMs: 0, cacheScope: "private" }
      : { tools: TOOLS })
  }

  if (method === "tools/call") {
    const toolName = params?.name
    const args = params?.arguments ?? {}
    let data: unknown
    let error: { message: string } | null = null

    if (toolName === "get_daily_metrics") {
      ;({ data, error } = await supabase.rpc("mcp_get_daily_metrics", { p_date: args.date ?? undefined }))
    } else if (toolName === "get_sales_summary") {
      ;({ data, error } = await supabase.rpc("mcp_get_sales_summary", { p_date: args.date ?? undefined }))
    } else if (toolName === "get_funnel_summary") {
      ;({ data, error } = await supabase.rpc("mcp_get_funnel_summary", { p_days: args.days ?? undefined }))
    } else if (toolName === "get_pipeline_health") {
      ;({ data, error } = await supabase.rpc("mcp_get_pipeline_health"))
    } else if (toolName === "refresh_live_data") {
      const source = args.source
      if (source !== "instagram" && source !== "gumroad") {
        return respond({ content: [{ type: "text", text: "source must be 'instagram' or 'gumroad'" }], isError: true })
      }

      // Cooldown check — don't re-hit the real API more than once per 5 min per source
      const { data: lastRun } = await supabase.rpc("mcp_get_pipeline_health")
      const relevant = (lastRun ?? []).find((r: { function_name: string }) =>
        source === "instagram" ? r.function_name === "instagram_insights_and_media" : r.function_name === "gumroad_sales"
      )
      const lastRunAt = relevant ? new Date(relevant.run_at as string) : null
      const cooledDown = !lastRunAt || Date.now() - lastRunAt.getTime() > 5 * 60 * 1000

      if (!cooledDown) {
        const cached = source === "instagram"
          ? (await supabase.rpc("mcp_get_daily_metrics", {})).data
          : (await supabase.rpc("mcp_get_sales_summary", {})).data
        return respond({ content: [{ type: "text", text: JSON.stringify({ note: "Refreshed within the last 5 minutes, returning current stored data instead of re-pulling.", data: cached }) }] })
      }

      if (!supabaseAdmin) {
        return respond({ content: [{ type: "text", text: "Live refresh is not configured on the server." }], isError: true })
      }

      const functionSlug = source === "instagram" ? "instagram_insights_and_media" : "gumroad_sales"
      const triggerRpc = source === "instagram" ? "trigger_instagram_ingestion" : "trigger_gumroad_ingestion"
      const requestedAt = new Date().toISOString()
      const { error: triggerError } = await supabaseAdmin.rpc(triggerRpc)
      if (triggerError) {
        return respond({ content: [{ type: "text", text: `Could not start refresh: ${triggerError.message}` }], isError: true })
      }

      let latestRun: { status: string; row_count: number | null; error_message: string | null; run_at: string } | null = null
      const deadline = Date.now() + 90000
      while (Date.now() < deadline) {
        const { data: run, error: runError } = await supabaseAdmin
          .from("pipeline_logs")
          .select("status,row_count,error_message,run_at")
          .eq("function_name", functionSlug)
          .gte("run_at", requestedAt)
          .order("run_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        if (runError) break
        if (run) {
          latestRun = run
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }

      let aggregateError: string | null = null
      if (latestRun) {
        const { error } = await supabaseAdmin.rpc("process_daily_aggregates")
        aggregateError = error?.message ?? null
      }
      const fresh = source === "instagram"
        ? (await supabase.rpc("mcp_get_daily_metrics", {})).data
        : (await supabase.rpc("mcp_get_sales_summary", {})).data

      return respond({ content: [{ type: "text", text: JSON.stringify({
        refresh_result: latestRun ?? { status: "pending", message: "The pull has not produced a pipeline log yet." },
        aggregation_error: aggregateError,
        fresh_data: fresh,
      }) }] })
    } else {
      return respond({ content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true })
    }

    if (error) {
      return respond({ content: [{ type: "text", text: `Query failed: ${error.message}` }], isError: true })
    }
    return respond({ content: [{ type: "text", text: JSON.stringify(data) }] })
  }

  return rpcError(-32601, "Method not found: " + (method ?? "unknown"))
})
