import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const NON_METRIC_SALE_KEYS = new Set(["id", "email", "product_id", "product_name", "created_at"])

Deno.serve(async (req: Request) => {
  // The database validates this value against Vault in get_active_connections.
  // This avoids relying on a separately configured Edge Function secret copy.
  const internalSecret = req.headers.get("x-internal-secret") ?? ""
  if (!internalSecret) {
    return new Response("Unauthorized", { status: 401 })
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!)

  const { data: connections, error: connErr } = await supabase.rpc("get_active_connections", { p_platform: "gumroad", p_internal_secret: internalSecret })
  if (connErr || !connections || connections.length === 0) {
    return new Response(JSON.stringify({ status: "skipped", reason: connErr?.message ?? "no gumroad connection stored yet" }), { headers: { "Content-Type": "application/json" } })
  }

  const token = connections[0].access_token
  const res = await fetch(`https://api.gumroad.com/v2/sales?access_token=${token}`)
  const json = await res.json()

  if (json.success !== true) {
    await supabase.rpc("log_connection_error", { p_connection_id: connections[0].connection_id, p_raw_error: json.message ?? "unknown gumroad error" })
    await supabase.rpc("log_pipeline_run", { p_function_name: "gumroad_sales", p_source: "gumroad", p_status: "error", p_row_count: 0, p_error_message: json.message ?? "unknown gumroad error" })
    return new Response(JSON.stringify({ status: "error", message: json.message }), { status: 502, headers: { "Content-Type": "application/json" } })
  }

  await supabase.rpc("log_raw_gumroad_sales", { p_payload: json })

  // Field discovery: scan whatever the first real sale actually contains —
  // this is what the "Gumroad might give us more than that" pop-up reads from.
  if (json.sales?.length > 0) {
    for (const key of Object.keys(json.sales[0])) {
      if (NON_METRIC_SALE_KEYS.has(key)) continue
      await supabase.rpc("log_discovered_field", { p_platform: "gumroad", p_level: "sale", p_field_name: key })
    }
  }

  await supabase.rpc("log_pipeline_run", { p_function_name: "gumroad_sales", p_source: "gumroad", p_status: "success", p_row_count: json.sales?.length ?? 0, p_error_message: null })

  return new Response(JSON.stringify({ status: "complete", count: json.sales?.length ?? 0 }), { headers: { "Content-Type": "application/json" } })
})

