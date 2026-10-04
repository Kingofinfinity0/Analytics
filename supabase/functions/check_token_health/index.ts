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
    return new Response(JSON.stringify({ status: "error", message: connErr?.message }), { status: 500 })
  }

  for (const conn of connections) {
    // Security: Send access token in Authorization header to prevent token leakage in URL logs
    const res = await fetch(`https://graph.instagram.com/v25.0/${conn.external_id}?fields=id,username`, {
      headers: { Authorization: `Bearer ${conn.access_token}` },
    })
    const json = await res.json()

    if ("error" in json) {
      await supabase.rpc("log_connection_error", { p_connection_id: conn.connection_id, p_raw_error: json.error.message })
      results[conn.connection_id] = `failed: ${json.error.message}`
    } else {
      results[conn.connection_id] = "ok"
    }
  }

  return new Response(JSON.stringify({ status: "complete", results }), { headers: { "Content-Type": "application/json" } })
})

