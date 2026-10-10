import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

Deno.serve(async (req: Request) => {
  // The database validates this value against Vault in get_active_connections.
  // This avoids relying on a separately configured Edge Function secret copy.
  const internalSecret = req.headers.get("x-internal-secret") ?? ""
  if (!internalSecret) {
    return new Response("Unauthorized", { status: 401 })
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!)
  const results: Record<string, string> = {}

  const { data: connections, error: connErr } = await supabase.rpc("get_active_connections", { p_platform: "instagram", p_internal_secret: internalSecret })
  if (connErr || !connections) {
    if (connErr?.message?.includes("invalid internal secret")) {
      return new Response("Unauthorized", { status: 401 })
    }
    return new Response(JSON.stringify({ status: "error", message: "Failed to fetch active connections" }), { status: 500 })
  }

  for (const conn of connections) {
    // Use Authorization header so access tokens do not end up in URL logs
    const res = await fetch(`https://graph.instagram.com/v25.0/${conn.external_id}?fields=id,username`, {
      headers: { Authorization: `Bearer ${conn.access_token}` },
    })
    const json = await res.json()

    if ("error" in json) {
      const errMsg = json.error?.message ?? "Token health check failed"
      await supabase.rpc("log_connection_error", { p_connection_id: conn.connection_id, p_raw_error: errMsg })
      results[conn.connection_id] = `failed: ${errMsg}`
    } else {
      results[conn.connection_id] = "ok"
    }
  }

  return new Response(JSON.stringify({ status: "complete", results }), { headers: { "Content-Type": "application/json" } })
})

