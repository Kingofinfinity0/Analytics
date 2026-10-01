import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

async function appsecretProof(token: string, appSecret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(token))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const errorParam = url.searchParams.get("error")
  const returnedState = url.searchParams.get("state")
  const cookieState = req.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("meta_oauth_state="))?.slice("meta_oauth_state=".length)
  const clearStateCookie = "meta_oauth_state=; Path=/functions/v1/instagram_oauth_callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax"

  if (!returnedState || !cookieState || returnedState !== cookieState) {
    return new Response(html("OAuth state check failed. Please close this tab and try connecting again."), { status: 403, headers: { "Content-Type": "text/html", "Set-Cookie": clearStateCookie } })
  }

  if (errorParam) return new Response(html(`Connection cancelled or denied: ${errorParam}`), { headers: { "Content-Type": "text/html" } })
  if (!code) return new Response(html("Missing authorization code."), { status: 400, headers: { "Content-Type": "text/html" } })

  const clientId = Deno.env.get("INSTAGRAM_APP_ID") ?? ""
  const clientSecret = Deno.env.get("INSTAGRAM_APP_SECRET") ?? ""
  const redirectUri = "https://quwmepqbcfhakvdekmlr.supabase.co/functions/v1/instagram_oauth_callback"
  const appSecret = Deno.env.get("META_APP_SECRET") ?? ""

  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code })
  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form })
  const shortJson = await shortRes.json()
  if (!shortJson.access_token) return new Response(html(`Could not get a short-lived token: ${JSON.stringify(shortJson)}`), { status: 400, headers: { "Content-Type": "text/html" } })

  const longRes = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortJson.access_token}`)
  const longJson = await longRes.json()
  if (!longJson.access_token) return new Response(html(`Could not get a long-lived token: ${JSON.stringify(longJson)}`), { status: 400, headers: { "Content-Type": "text/html" } })

  const token = longJson.access_token
  const profileUrl = new URL("https://graph.instagram.com/v25.0/me")
  profileUrl.searchParams.set("fields", "user_id,username,name,followers_count,follows_count")
  profileUrl.searchParams.set("access_token", token)
  let profileRes = await fetch(profileUrl)
  let profile = await profileRes.json()
  if (profile.error) {
    profileUrl.searchParams.set("fields", "user_id,username,name")
    profileRes = await fetch(profileUrl)
    profile = await profileRes.json()
  }
  if (profile.error) {
    profileUrl.searchParams.set("fields", "user_id,username")
    profileRes = await fetch(profileUrl)
    profile = await profileRes.json()
  }
  const igUserId = String(profile.user_id ?? profile.id ?? shortJson.user_id)
  const username = profile.username ?? `id_${igUserId}`

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!)

  const { data: accountId, error: accountErr } = await supabase.rpc("upsert_instagram_account", { p_external_id: igUserId, p_handle: username, p_display_name: profile.name ?? null })
  if (accountErr) return new Response(html(`Saved the token but failed to store the account: ${accountErr.message}`), { status: 500, headers: { "Content-Type": "text/html" } })

  const expiresAt = new Date(Date.now() + (longJson.expires_in ?? 5184000) * 1000).toISOString()
  const { error: connErr } = await supabase.rpc("upsert_connection", { p_platform: "instagram", p_access_token: token, p_expires_at: expiresAt, p_account_id: accountId, p_external_id: igUserId })
  if (connErr) return new Response(html(`Account stored but saving the token failed: ${connErr.message}`), { status: 500, headers: { "Content-Type": "text/html" } })

  let syncSummary = "Instagram data sync could not be started."
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!serviceRoleKey) {
    syncSummary = "Account connected, but Supabase service role configuration is missing; start the Instagram refresh from Settings."
  } else {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey, { auth: { persistSession: false } })
    const { error: syncErr } = await admin.rpc("trigger_instagram_ingestion")
    syncSummary = syncErr ? `data sync could not start: ${syncErr.message}` : "Instagram data sync started. Check Settings → Refresh for progress."
  }

  const accountLabel = profile.name ? `${profile.name} (@${username})` : `@${username}`
  return new Response(html(`Connected ${accountLabel} successfully. ${syncSummary} You can close this window.`), { headers: { "Content-Type": "text/html" } })
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function html(message: string): string {
  return `<html><body style="font-family: sans-serif; padding: 40px; text-align: center;"><h2>${escapeHtml(message)}</h2></body></html>`
}
