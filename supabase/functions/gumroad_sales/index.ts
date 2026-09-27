import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const NON_METRIC_SALE_KEYS = new Set(["id", "email", "product_id", "product_name", "created_at"])
const MAX_SALES_PAGES = 100

type GumroadSale = Record<string, unknown>
type GumroadSalesPage = {
  success?: boolean
  sales?: GumroadSale[]
  next_page_key?: string | null
  next_page_url?: string | null
  message?: string
}

function nextPageUrl(page: GumroadSalesPage, token: string): URL | null {
  if (page.next_page_url) {
    const next = new URL(page.next_page_url, "https://api.gumroad.com")
    if (next.origin !== "https://api.gumroad.com" || next.pathname !== "/v2/sales") {
      throw new Error("Gumroad returned an unexpected sales pagination URL")
    }
    next.searchParams.delete("access_token")
    return next
  }
  if (!page.next_page_key) return null
  const next = new URL("https://api.gumroad.com/v2/sales")
  next.searchParams.set("page_key", page.next_page_key)
  return next
}

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

  const token = connections[0].access_token as string
  const allSales: GumroadSale[] = []
  const discoveredFields = new Set<string>()
  const seenPageKeys = new Set<string>()
  let pageUrl: URL | null = new URL("https://api.gumroad.com/v2/sales")
  let pageCount = 0

  try {
    while (pageUrl) {
      if (pageCount >= MAX_SALES_PAGES) throw new Error(`Gumroad sales pagination exceeded ${MAX_SALES_PAGES} pages`)
      const requestUrl = new URL(pageUrl)
      // Use the authorization header so access tokens do not end up in URL logs.
      requestUrl.searchParams.delete("access_token")
      const response = await fetch(requestUrl, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
      const body = await response.text()
      let json: GumroadSalesPage
      try {
        json = JSON.parse(body)
      } catch {
        throw new Error(`Gumroad returned non-JSON response (HTTP ${response.status})`)
      }
      if (!response.ok || json.success !== true) {
        throw new Error(json.message ?? `Gumroad sales request failed (HTTP ${response.status})`)
      }

      const sales = Array.isArray(json.sales) ? json.sales : []
      allSales.push(...sales)
      for (const sale of sales) {
        for (const key of Object.keys(sale)) if (!NON_METRIC_SALE_KEYS.has(key)) discoveredFields.add(key)
      }
      pageCount += 1
      pageUrl = nextPageUrl(json, token)
      if (pageUrl) {
        const pageKey = pageUrl.searchParams.get("page_key")
        if (pageKey && seenPageKeys.has(pageKey)) throw new Error("Gumroad repeated a sales pagination cursor")
        if (pageKey) seenPageKeys.add(pageKey)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown gumroad error"
    await supabase.rpc("log_connection_error", { p_connection_id: connections[0].connection_id, p_raw_error: message })
    await supabase.rpc("log_pipeline_run", { p_function_name: "gumroad_sales", p_source: "gumroad", p_status: "error", p_row_count: 0, p_error_message: message })
    return new Response(JSON.stringify({ status: "error", message }), { status: 502, headers: { "Content-Type": "application/json" } })
  }

  // Persist one normalized sales response so the existing aggregate processes the
  // entire cursor-paginated result in its usual idempotent upsert path.
  await supabase.rpc("log_raw_gumroad_sales", { p_payload: { success: true, sales: allSales } })

  // Field discovery: scan whatever the first real sale actually contains —
  // this is what the "Gumroad might give us more than that" pop-up reads from.
  for (const key of discoveredFields) {
    await supabase.rpc("log_discovered_field", { p_platform: "gumroad", p_level: "sale", p_field_name: key })
  }

  await supabase.rpc("log_pipeline_run", { p_function_name: "gumroad_sales", p_source: "gumroad", p_status: "success", p_row_count: allSales.length, p_error_message: null })

  return new Response(JSON.stringify({ status: "complete", count: allSales.length, pages: pageCount, visits_source: "Gumroad does not expose site visits through the sales API; use the dashboard UTM analytics or tracked link clicks." }), { headers: { "Content-Type": "application/json" } })
})

