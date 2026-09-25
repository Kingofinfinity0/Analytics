import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

async function appsecretProof(token: string, appSecret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(token))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

type InstagramProfile = {
  user_id?: string
  id?: string
  username?: string
  name?: string
  followers_count?: number | string
  follows_count?: number | string
}

function metricValue(metric: any): number | null {
  const value = metric.total_value?.value ?? metric.total_value ?? metric.values?.[0]?.value ?? metric.value
  return typeof value === "number" ? value : null
}

function followerAddsValue(metric: any): number | null {
  const roots = [metric.total_value?.breakdowns, metric.breakdowns, metric.values]
  let total = 0
  let found = false
  const visit = (value: any) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== "object") return
    const dimensions = Array.isArray(value.dimension_values) ? value.dimension_values.map(String).join(" ").toLowerCase() : ""
    const numeric = Number(value.value)
    if (dimensions && Number.isFinite(numeric) && /follow/.test(dimensions) && !/unfollow/.test(dimensions)) {
      total += numeric
      found = true
    }
    for (const [key, child] of Object.entries(value)) {
      if (["FOLLOWER", "FOLLOWERS", "FOLLOW"].includes(key.toUpperCase()) && Number.isFinite(Number(child))) {
        total += Number(child)
        found = true
      } else visit(child)
    }
  }
  roots.forEach(visit)
  return found ? total : null
}

async function fetchProfile(token: string): Promise<{ profile?: InstagramProfile; error?: string }> {
  const url = new URL("https://graph.instagram.com/v25.0/me")
  url.searchParams.set("fields", "user_id,username,name,followers_count,follows_count")
  url.searchParams.set("access_token", token)
  let response = await fetch(url)
  let result = await response.json()
  if (result.error) {
    // Keep the profile name if count fields are unavailable for this app.
    url.searchParams.set("fields", "user_id,username,name")
    response = await fetch(url)
    result = await response.json()
  }
  if (result.error) {
    url.searchParams.set("fields", "user_id,username")
    response = await fetch(url)
    result = await response.json()
  }
  if (result.error) return { error: result.error.message ?? "Instagram profile lookup failed." }
  return { profile: result }
}

Deno.serve(async (req: Request) => {
  const internalSecret = req.headers.get("x-internal-secret") ?? ""
  if (!internalSecret) return new Response("Unauthorized", { status: 401 })

  const appSecret = Deno.env.get("META_APP_SECRET") ?? ""
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!)
  const results: Record<string, string> = {}
  const { data: connections, error: connErr } = await supabase.rpc("get_active_connections", {
    p_platform: "instagram",
    p_internal_secret: internalSecret,
  })
  if (connErr || !connections) {
    return new Response(JSON.stringify({ status: "error", message: connErr?.message ?? "no connections found" }), { status: 500 })
  }
  if (connections.length === 0) {
    const message = "No Instagram account is connected. Use Settings → Add Account and complete Meta authorization."
    await supabase.rpc("log_pipeline_run", { p_function_name: "instagram_insights_and_media", p_source: "instagram", p_status: "error", p_row_count: 0, p_error_message: message })
    return new Response(JSON.stringify({ status: "skipped", message }), { headers: { "Content-Type": "application/json" } })
  }

  for (const conn of connections) {
    const { profile, error: profileError } = await fetchProfile(conn.access_token)
    if (profileError || !profile?.username) {
      const message = profileError ?? "Instagram did not return a username for this account."
      await supabase.rpc("log_connection_error", { p_connection_id: conn.connection_id, p_raw_error: message })
      await supabase.rpc("log_pipeline_run", { p_function_name: "instagram_insights_and_media", p_source: "instagram", p_status: "error", p_row_count: 0, p_error_message: message })
      results[conn.account_id] = `profile error: ${message}`
      continue
    }

    const igUserId = String(profile.user_id ?? profile.id ?? conn.external_id)
    const { error: accountError } = await supabase.rpc("upsert_instagram_account", {
      p_external_id: conn.external_id,
      p_handle: profile.username,
      p_display_name: profile.name ?? null,
    })
    if (accountError) {
      await supabase.rpc("log_pipeline_run", { p_function_name: "instagram_insights_and_media", p_source: "instagram", p_status: "error", p_row_count: 0, p_error_message: `Could not save Instagram profile name: ${accountError.message}` })
    }
    const proof = appSecret ? await appsecretProof(conn.access_token, appSecret) : ""

    const insightsUrl = new URL(`https://graph.instagram.com/v25.0/${igUserId}/insights`)
    insightsUrl.searchParams.set("metric", "reach,follower_count,profile_views,accounts_engaged,views")
    insightsUrl.searchParams.set("period", "day")
    insightsUrl.searchParams.set("metric_type", "total_value")
    insightsUrl.searchParams.set("access_token", conn.access_token)
    if (proof) insightsUrl.searchParams.set("appsecret_proof", proof)
    const insightsRes = await fetch(insightsUrl)
    const insightsJson = await insightsRes.json()
    let accountInsightsOk = true
    if (insightsJson.error) {
      accountInsightsOk = false
      const message = insightsJson.error.message ?? "Instagram account insights request failed."
      await supabase.rpc("log_connection_error", { p_connection_id: conn.connection_id, p_raw_error: message })
      await supabase.rpc("log_pipeline_run", { p_function_name: "instagram_insights_and_media", p_source: "instagram", p_status: "error", p_row_count: 0, p_error_message: message })
      results[conn.account_id] = `insights error: ${message}`
    } else {
      await supabase.rpc("log_raw_instagram_insights", { p_account_id: conn.account_id, p_payload: insightsJson })
      const today = new Date().toISOString().slice(0, 10)
      for (const metric of insightsJson.data ?? []) {
        await supabase.rpc("log_discovered_field", { p_platform: "instagram", p_level: "account", p_field_name: metric.name })
        await supabase.rpc("log_account_metric", { p_account_id: conn.account_id, p_date: today, p_metric_name: metric.name, p_metric_value: metricValue(metric) })
      }
      await supabase.rpc("log_pipeline_run", { p_function_name: "instagram_insights_and_media", p_source: "instagram", p_status: "success", p_row_count: insightsJson.data?.length ?? 0, p_error_message: null })
    }

    // Profile-level counts are separate from Insights metrics. Save them even
    // when the Insights endpoint is unavailable so comparison chips can use them.
    const profileCounts: Array<["followers_count" | "follows_count", string]> = [["followers_count", "follower_count"], ["follows_count", "follows_count"]]
    for (const [fieldName, metricName] of profileCounts) {
      const value = Number(profile[fieldName])
      if (profile[fieldName] != null && Number.isFinite(value)) {
        await supabase.rpc("log_discovered_field", { p_platform: "instagram", p_level: "account", p_field_name: metricName })
        await supabase.rpc("log_account_metric", { p_account_id: conn.account_id, p_date: new Date().toISOString().slice(0, 10), p_metric_name: metricName, p_metric_value: value })
      }
    }

    // This is the number of new followers for the day, separate from the
    // profile's cumulative follower_count and follows_count fields.
    const followsUrl = new URL(`https://graph.instagram.com/v25.0/${igUserId}/insights`)
    followsUrl.searchParams.set("metric", "follows_and_unfollows")
    followsUrl.searchParams.set("period", "day")
    followsUrl.searchParams.set("metric_type", "total_value")
    followsUrl.searchParams.set("breakdown", "follow_type")
    followsUrl.searchParams.set("access_token", conn.access_token)
    if (proof) followsUrl.searchParams.set("appsecret_proof", proof)
    const followsRes = await fetch(followsUrl)
    const followsJson = await followsRes.json()
    const followsMetric = (followsJson.data ?? []).find((metric: any) => metric.name === "follows_and_unfollows")
    const follows = followsMetric ? followerAddsValue(followsMetric) : null
    if (!followsJson.error && follows != null) {
      const endTime = followsMetric.values?.at(-1)?.end_time
      const metricDate = endTime ? new Date(endTime).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
      await supabase.rpc("log_discovered_field", { p_platform: "instagram", p_level: "account", p_field_name: "follows" })
      await supabase.rpc("log_account_metric", { p_account_id: conn.account_id, p_date: metricDate, p_metric_name: "follows", p_metric_value: follows })
    }

    const mediaUrl = new URL(`https://graph.instagram.com/v25.0/${igUserId}/media`)
    mediaUrl.searchParams.set("fields", "id,caption,media_type,timestamp,permalink,like_count,comments_count")
    mediaUrl.searchParams.set("access_token", conn.access_token)
    if (proof) mediaUrl.searchParams.set("appsecret_proof", proof)
    const mediaRes = await fetch(mediaUrl)
    const mediaJson = await mediaRes.json()
    if (mediaJson.error) {
      const message = mediaJson.error.message ?? "Instagram media request failed."
      await supabase.rpc("log_connection_error", { p_connection_id: conn.connection_id, p_raw_error: message })
      await supabase.rpc("log_pipeline_run", { p_function_name: "instagram_insights_and_media", p_source: "instagram", p_status: "error", p_row_count: 0, p_error_message: message })
      results[conn.account_id] = `media error: ${message}`
      continue
    }

    let count = 0
    let metricsErrorCount = 0
    let firstMetricsError = ""
    for (const item of mediaJson.data ?? []) {
      const postInsightsUrl = new URL(`https://graph.instagram.com/v25.0/${item.id}/insights`)
      postInsightsUrl.searchParams.set("metric", "reach,saved,shares,total_interactions,views")
      postInsightsUrl.searchParams.set("metric_type", "total_value")
      postInsightsUrl.searchParams.set("access_token", conn.access_token)
      if (proof) postInsightsUrl.searchParams.set("appsecret_proof", proof)
      const postInsightsRes = await fetch(postInsightsUrl)
      const postInsightsJson = await postInsightsRes.json()

      const rawFlat: Record<string, unknown> = {
        id: item.id,
        caption: item.caption,
        media_type: item.media_type,
        timestamp: item.timestamp,
        permalink: item.permalink,
        like_count: item.like_count,
        comments_count: item.comments_count,
      }
      const metrics: Record<string, number | null> = {
        likes: typeof item.like_count === "number" ? item.like_count : null,
        comments: typeof item.comments_count === "number" ? item.comments_count : null,
      }
      if (!postInsightsJson.error) {
        for (const metric of postInsightsJson.data ?? []) {
          const value = metricValue(metric)
          rawFlat[metric.name] = value
          metrics[metric.name] = value
        }
      } else {
        metricsErrorCount++
        if (!firstMetricsError) firstMetricsError = postInsightsJson.error.message ?? "Instagram post insights request failed."
      }
      if (!postInsightsJson.error && (postInsightsJson.data ?? []).length === 0) {
        metricsErrorCount++
        if (!firstMetricsError) firstMetricsError = "Meta returned no Insights metrics for this media request."
      }

      await supabase.rpc("log_raw_instagram_media", { p_account_id: conn.account_id, p_media_id: item.id, p_payload: rawFlat })
      const { error: upsertError } = await supabase.rpc("upsert_post_and_log_metrics", {
        p_account_id: conn.account_id,
        p_media_id: item.id,
        p_posted_at: item.timestamp,
        p_media_type: item.media_type,
        p_caption: item.caption,
        p_permalink: item.permalink,
        p_metrics: metrics,
      })
      if (upsertError) {
        await supabase.rpc("log_pipeline_run", { p_function_name: "instagram_insights_and_media", p_source: "instagram", p_status: "error", p_row_count: count, p_error_message: `Failed to save media ${item.id}: ${upsertError.message}` })
        accountInsightsOk = false
      } else {
        count++
      }
    }
    const partialMessage = metricsErrorCount
      ? `Saved directly available likes/comments; insights unavailable for ${metricsErrorCount} of ${count} posts: ${firstMetricsError}`
      : null
    await supabase.rpc("log_pipeline_run", { p_function_name: "instagram_insights_and_media", p_source: "instagram", p_status: "success", p_row_count: count, p_error_message: partialMessage })
    if (accountInsightsOk) {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      if (serviceRoleKey) {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey, { auth: { persistSession: false } })
        await admin.rpc("mark_connection_success", { p_connection_id: conn.connection_id })
      }
    }
    results[conn.account_id] = partialMessage ?? "ok"
  }

  return new Response(JSON.stringify({ status: "complete", results }), { headers: { "Content-Type": "application/json" } })
})
