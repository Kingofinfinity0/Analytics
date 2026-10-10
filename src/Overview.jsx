import { useEffect, useMemo, useState } from 'react'
import ClientEChart from './ClientEChart'
import SankeyCard from './SankeyCard'
import { supabase } from './supabase'

const goalCents = 40000
const accountColors = { matthew: '#3B82F6', luca: '#F59E0B' }
const salesTimeframes = [{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' }]
const money = (cents) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((cents ?? 0) / 100)
const dollars = (value) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value ?? 0)
const number = (value) => new Intl.NumberFormat().format(value ?? 0)
const metricValue = (row) => Number(row?.value ?? row?.metric_value ?? row?.metric ?? 0)

function defaultRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - 6)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

function colorFor(handle, index) {
  const name = String(handle || '').toLowerCase()
  return name.includes('luca') ? accountColors.luca : name.includes('matthew') ? accountColors.matthew : index === 1 ? accountColors.luca : accountColors.matthew
}

export default function Overview({ dateRange = defaultRange() }) {
  const [data, setData] = useState({ status: 'loading', summary: [], sankey: { status: 'loading' }, posts: [], accounts: [], metrics: [] })
  const [salesData, setSalesData] = useState({ status: 'loading', rows: [] })
  const [reloadKey, setReloadKey] = useState(0)
  const [salesWindow, setSalesWindow] = useState('month')
  const range = useMemo(() => ({ start: dateRange.start, end: dateRange.end }), [dateRange.start, dateRange.end])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setData((current) => ({ ...current, status: 'loading' }))
      try {
        const [summaries, posts, accounts, metrics, sankey] = await Promise.all([
          supabase.from('gumroad_daily_summary').select('*').order('date', { ascending: true }),
          supabase.from('instagram_posts').select('*').not('posted_at', 'is', null).order('posted_at', { ascending: false }).limit(100),
          supabase.from('instagram_accounts').select('account_id,handle,display_name').order('created_at'),
          supabase.from('account_metrics').select('*').gte('date', range.start).lte('date', range.end).order('date', { ascending: true }),
          supabase.rpc('get_overview_sankey_metrics', { p_start_date: range.start, p_end_date: range.end }),
        ])
        for (const result of [summaries, posts, accounts, metrics]) if (result.error) throw result.error
        if (!cancelled) setData({ status: 'ready', summary: summaries.data ?? [], posts: posts.data ?? [], accounts: accounts.data ?? [], metrics: metrics.data ?? [], sankey: sankey.error ? { status: 'error', error: sankey.error.message } : { status: 'ready', ...sankey.data } })
      } catch (error) {
        if (!cancelled) setData((current) => ({ ...current, status: 'error', error: error.message }))
      }
    }
    load()
    return () => { cancelled = true }
  }, [range.end, range.start, reloadKey])

  useEffect(() => {
    const refreshOverview = () => setReloadKey((key) => key + 1)
    const timer = window.setInterval(refreshOverview, 60_000)
    window.addEventListener('focus', refreshOverview)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshOverview)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadSales() {
      setSalesData({ status: 'loading', rows: [] })
      try {
        let query = supabase.from('gumroad_daily_summary').select('date,running_total_cents')
        query = query.order('date', { ascending: true })
        const result = await query
        if (result.error) throw result.error
        const rows = salesWindow === 'max' ? result.data ?? [] : [...(result.data ?? [])].reverse()
        if (!cancelled) setSalesData({ status: 'ready', rows })
      } catch (error) {
        if (!cancelled) setSalesData({ status: 'error', rows: [], error: error.message })
      }
    }
    loadSales()
    return () => { cancelled = true }
  }, [salesWindow, reloadKey])

  const latestSummary = data.summary.at(-1) ?? null
  const revenue = latestSummary?.running_total_cents ?? 0
  const percent = Math.min((revenue / goalCents) * 100, 100)
  const accounts = useMemo(() => data.accounts.map((account, index) => ({ ...account, label: account.display_name || account.handle || 'Account ' + (index + 1), color: colorFor(account.display_name || account.handle, index) })), [data.accounts])
  const trend = useMemo(() => makeTrend(data.metrics, accounts, range), [data.metrics, accounts, range])
  const snapshots = useMemo(() => makeSnapshots(data.metrics, accounts), [data.metrics, accounts])
  const todayKey = formatDateKey(new Date())
  const viewDate = snapshots.map((account) => account.viewsDate).filter(Boolean).sort().at(-1)
  const followsDate = snapshots.map((account) => account.followsDate).filter(Boolean).sort().at(-1)
  const formatMetricDate = (date) => date === todayKey ? 'today' : date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'no data'
  const comparisonSubtitle = `Views ${formatMetricDate(viewDate)} · New follows ${formatMetricDate(followsDate)}`
  const topPost = data.posts[0] ?? null
  const postBenchmark = useMemo(() => (topPost ? getPostBenchmark(topPost, data.posts) : null), [topPost, data.posts])
  // Performance Optimization: Compute total views per account_id in a single pass O(N) using a Map
  // instead of nested O(A * N) filtering and reducing metrics array for each account instance.
  const accountViews = useMemo(() => {
    const viewsByAccount = new Map()
    for (const row of data.metrics) {
      if (row.metric_name === 'views') {
        const current = viewsByAccount.get(row.account_id) || 0
        viewsByAccount.set(row.account_id, current + (finiteNumber(row.metric_value) ?? 0))
      }
    }
    return accounts
      .map((account) => ({
        account_id: account.account_id,
        label: account.label,
        color: account.color,
        views: viewsByAccount.get(account.account_id) || 0,
      }))
      .filter((account) => account.views > 0)
  }, [accounts, data.metrics])
  const sales = useMemo(() => makeSalesSeries(salesData.rows, salesWindow), [salesData.rows, salesWindow])

  if (data.status === 'error') return <section className="overview-page"><p className="data-message">{data.error}</p></section>
  return <section className="overview-page overview-page--new" aria-label="Overview">
    <div className="overview-grid overview-grid--priority">
      <SankeyCard {...data.sankey} accountViews={accountViews} onRetry={() => setReloadKey((key) => key + 1)} />
      <article className="overview-card goal-card"><CardTitle title="Revenue goal" subtitle={money(Math.max(goalCents - revenue, 0)) + ' remaining of ' + money(goalCents)} /><Chart className="overview-chart overview-chart--gauge" option={gaugeOption(percent)} /><strong className="goal-amount">{money(revenue)}</strong></article>
      <article className="overview-card trend-card"><CardTitle title="Daily reach" subtitle="Reach by connected account" /><Chart className="overview-chart overview-chart--trend" option={trendOption(trend)} /></article>
    </div>
    <div className="overview-grid overview-grid--summary">
      <SalesRunningCard sales={sales} status={salesData.status} selectedWindow={salesWindow} onWindowChange={setSalesWindow} />
      {topPost ? <PostInsightsCard post={topPost} benchmark={postBenchmark} /> : <article className="overview-card top-post"><PostCardEmpty /></article>}
      <article className="overview-card comparison-card"><CardTitle title="Account comparison" subtitle={comparisonSubtitle} /><Chart className="overview-chart overview-chart--bar" option={comparisonOption(snapshots)} /></article>
    </div>
  </section>
}

function CardTitle({ title, subtitle }) { return <header className="card-heading"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header> }
function Chart({ className, option }) { return <ClientEChart className={className} option={option} /> }
function Empty({ text }) { return <p className="overview-empty">{text}</p> }
function PostInsightsCard({ post, benchmark }) {
  const [activeCard, setActiveCard] = useState(0)
  const insight = choosePostInsight(post, benchmark)
  const mediaType = String(post.media_type || 'post').replaceAll('_', ' ').toLowerCase()
  const platform = String(post.platform || 'instagram').toLowerCase()
  const posted = post.posted_at ? new Date(post.posted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable'
  const metrics = [
    { key: 'reach', label: 'Reach', value: post.reach },
    { key: 'views', label: 'Views', value: post.views },
    { key: 'likes', label: 'Likes', value: post.likes },
    { key: 'comments', label: 'Comments', value: post.comments },
    { key: 'saves', label: 'Saves', value: post.saves },
    { key: 'shares', label: 'Shares', value: post.shares },
  ]
  return <article className="overview-card post-insights-card">
    <div className="post-card-track" role="group" aria-label="Post analytics cards">
      <section className={`post-slide ${activeCard === 0 ? 'is-active' : ''}`} aria-hidden={activeCard !== 0}>
        <header className="post-slide-header"><div className="post-slide-title"><PlatformIcon platform={platform} /><span>Latest post</span></div><span className="post-published">{posted}</span></header>
        <div className="latest-post-body">
          <div className="latest-post-copy"><span className="post-media-type">{mediaType}</span><p>{post.caption || 'No caption available.'}</p><span className="latest-post-handle">{post.permalink ? '@' + (post.handle || 'account') : 'Account post'}</span></div>
          <div className="post-highlight"><span className="post-highlight-value">{insight ? `${insight.rate.toFixed(1)}%` : '—'}</span><span className="post-highlight-label">{insight?.label ?? 'Engagement'}</span></div>
        </div>
        <p className="post-insight-copy">{insight?.description ?? 'There is not enough post data to compare engagement with your other content yet.'}</p>
      </section>
      <section className={`post-slide post-analytics-slide ${activeCard === 1 ? 'is-active' : ''}`} aria-hidden={activeCard !== 1}>
        <header className="post-slide-header"><div className="post-slide-title"><PlatformIcon platform={platform} /><span>Post Analytics</span></div><span className="post-published">{mediaType}</span></header>
        <div className="post-metric-list">{metrics.map((metric) => {
          const current = finiteNumber(metric.value)
          const baseline = finiteNumber(benchmark?.averages?.[metric.key])
          const delta = current != null && baseline != null ? current - baseline : null
          const state = delta == null || Math.abs(delta) < .5 ? 'neutral' : delta > 0 ? 'up' : 'down'
          return <div className={`post-metric-row metric-${state}`} key={metric.key}>
            <span className="post-metric-arrow" aria-hidden="true">{state === 'up' ? '↗' : state === 'down' ? '↘' : '→'}</span>
            <strong>{current == null ? '—' : number(current)}</strong><span className="post-metric-label">{metric.label}</span>
            <small>{delta == null ? 'No baseline' : state === 'neutral' ? 'No change' : `${delta > 0 ? '+' : '−'}${number(Math.abs(delta))} vs avg.`}</small>
          </div>
        })}</div>
        <footer className="post-metric-legend"><span><i className="legend-up" />Improvement</span><span><i className="legend-down" />Decrease</span><span><i className="legend-neutral" />No change</span></footer>
      </section>
    </div>
    <nav className="post-slide-controls" aria-label="Post card navigation">
      <button type="button" aria-label="Show latest post card" disabled={activeCard === 0} onClick={() => setActiveCard(0)}>‹</button>
      <div className="post-slide-dots">{[0, 1].map((index) => <button key={index} type="button" aria-label={`Show ${index === 0 ? 'latest post' : 'post analytics'} card`} aria-current={activeCard === index ? 'true' : undefined} className={activeCard === index ? 'is-active' : ''} onClick={() => setActiveCard(index)} />)}</div>
      <button type="button" aria-label="Show post analytics card" disabled={activeCard === 1} onClick={() => setActiveCard(1)}>›</button>
    </nav>
  </article>
}

function PostCardEmpty() { return <div className="post-card-empty"><span className="post-empty-icon"><PlatformIcon platform="instagram" /></span><h2>Latest post</h2><p>No posts published in this range yet.</p></div> }

function PlatformIcon({ platform }) {
  if (platform.includes('thread')) return <svg className="platform-icon" viewBox="0 0 24 24" fill="currentColor" aria-label="Threads"><path d="M12.16 2C6.54 2 3.2 5.54 3.2 11.52c0 6.34 3.27 10.48 8.96 10.48 3.24 0 5.87-1.36 7.54-3.79l-2.64-1.57c-1.02 1.34-2.44 2.12-4.58 2.12-3.41 0-5.22-2.08-5.22-5.24 0-3.34 1.98-5.39 5.18-5.39 1.9 0 3.2.73 4.1 1.96l2.53-1.9C18.63 3.36 15.78 2 12.16 2Z" /></svg>
  if (platform.includes('facebook')) return <svg className="platform-icon" viewBox="0 0 24 24" fill="currentColor" aria-label="Facebook"><path d="M13.5 21v-8.2h2.76l.41-3.2H13.5V7.56c0-.93.26-1.5 1.54-1.5h1.64V2.92c-.28-.04-1.27-.12-2.41-.12-2.39 0-4.02 1.46-4.02 4.14v2.32H7.5v3.2h2.75V21h3.25Z" /></svg>
  return <svg className="platform-icon platform-icon--instagram" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-label="Instagram"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.1" cy="6.9" r="1.2" fill="currentColor" stroke="none" /></svg>
}

function finiteNumber(value) { const numberValue = Number(value); return value == null || value === '' || !Number.isFinite(numberValue) ? null : numberValue }
function getPostBenchmark(post, posts) {
  const peerPosts = posts.filter((candidate) => candidate.account_id === post.account_id && candidate.post_id !== post.post_id)
  if (!peerPosts.length) return null
  const averages = {}
  for (const key of ['reach', 'views', 'likes', 'comments', 'saves', 'shares']) {
    const values = peerPosts.map((candidate) => finiteNumber(candidate[key])).filter((value) => value != null)
    averages[key] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  }
  return { averages, count: peerPosts.length }
}
function choosePostInsight(post, benchmark) {
  const reach = finiteNumber(post.reach)
  if (reach == null || reach <= 0) return null
  const candidates = [
    { key: 'shares', label: 'Share rate', verb: 'shared' },
    { key: 'saves', label: 'Save rate', verb: 'saved' },
    { key: 'comments', label: 'Comment rate', verb: 'commented on' },
    { key: 'likes', label: 'Like rate', verb: 'liked' },
  ].map((candidate) => ({ ...candidate, count: finiteNumber(post[candidate.key]), average: finiteNumber(benchmark?.averages?.[candidate.key]) }))
    .filter((candidate) => candidate.count != null)
    .map((candidate) => ({ ...candidate, rate: candidate.count / reach * 100, averageRate: benchmark && candidate.average != null && finiteNumber(benchmark.averages.reach) > 0 ? candidate.average / reach * 100 : null }))
    .filter((candidate) => candidate.rate != null)
  if (!candidates.length) return null
  const compared = candidates.filter((candidate) => candidate.averageRate != null)
  const chosen = (compared.length ? compared : candidates).sort((a, b) => compared.length ? (b.rate - b.averageRate) - (a.rate - a.averageRate) : b.rate - a.rate)[0]
  const diff = chosen.averageRate == null ? null : chosen.rate - chosen.averageRate
  const description = diff == null
    ? `${chosen.rate.toFixed(1)}% of people reached ${chosen.verb} this post. There is not enough history yet to compare it with your other posts.`
    : Math.abs(diff) < 0.05
      ? `Your ${chosen.label.toLowerCase()} is about the same as your other posts (${chosen.averageRate.toFixed(1)}% average).`
      : diff > 0
        ? `Your ${chosen.label.toLowerCase()} is ${Math.abs(diff).toFixed(1)} percentage points higher than your other posts (${chosen.averageRate.toFixed(1)}% average).`
        : `Your ${chosen.label.toLowerCase()} is ${Math.abs(diff).toFixed(1)} percentage points lower than your other posts (${chosen.averageRate.toFixed(1)}% average).`
  return { ...chosen, description }
}
function AccountStats({ account, todayKey }) { const dateLabel = (date) => date === todayKey ? 'today' : date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'no data'; return <div className="account-grid--stats"><div><dt>Followers</dt><dd>{number(account.followers ?? 0)}</dd></div><div><dt>Following</dt><dd>{number(account.following ?? 0)}</dd></div><div><dt>Views</dt><dd>{number(account.views ?? 0)} <small>{dateLabel(account.viewsDate)}</small></dd></div><div><dt>New follows</dt><dd>{number(account.newFollowers ?? 0)} <small>{dateLabel(account.followsDate)}</small></dd></div></div> }
function SalesRunningCard({ sales, status, selectedWindow, onWindowChange }) {
  return <article className="overview-card sales-card">
    <header className="sales-card-header">
      <CardTitle title="Sales" subtitle={null} />
      <div className="sales-tabs" role="tablist" aria-label="Sales timeframe">
        {salesTimeframes.map((timeframe) => <button key={timeframe.id} type="button" role="tab" aria-selected={selectedWindow === timeframe.id} className={selectedWindow === timeframe.id ? 'is-selected' : ''} onClick={() => onWindowChange(timeframe.id)}>{timeframe.label}</button>)}
      </div>
    </header>
    <Chart className="overview-chart sales-chart" option={(echarts) => salesOption(sales, echarts)} />
    {status === 'error' && <p className="chart-error">Could not load sales.</p>}
  </article>
}

// Performance Optimization: Use O(N) Hash Map lookups instead of O(A * D * N) nested array searches
function makeTrend(metrics, accounts, range) {
  const reachMap = new Map()
  for (const row of metrics) {
    if (row.metric_name === 'reach') {
      const key = `${row.account_id}_${row.date}`
      if (!reachMap.has(key)) reachMap.set(key, metricValue(row))
    }
  }
  const dates = []
  const cursor = new Date(`${range.start}T00:00:00Z`)
  const end = new Date(`${range.end}T00:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return { dates, series: accounts.map((account) => ({ ...account, data: dates.map((date) => reachMap.get(`${account.account_id}_${date}`) ?? 0) })) }
}

// Performance Optimization: Group metrics in a single pass over date-sorted array instead of repeated array filtering and sorting
function makeSnapshots(metrics, accounts) {
  const sortedMetrics = [...metrics].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const latestByAccountAndMetric = new Map()
  const latestDateByAccount = new Map()

  for (const row of sortedMetrics) {
    const accKey = row.account_id
    if (!latestDateByAccount.has(accKey)) latestDateByAccount.set(accKey, row.date)
    const key = `${accKey}_${row.metric_name}`
    if (!latestByAccountAndMetric.has(key)) latestByAccountAndMetric.set(key, row)
  }

  return accounts.map((account) => {
    const getMetric = (name) => latestByAccountAndMetric.get(`${account.account_id}_${name}`)
    const read = (name) => {
      const row = getMetric(name)
      return { value: finiteNumber(row?.metric_value), date: row?.date ?? null }
    }
    const reachRow = getMetric('reach')
    const views = read('views')
    const follows = read('new_follows')
    return {
      ...account,
      metricDate: latestDateByAccount.get(account.account_id) ?? null,
      reach: metricValue(reachRow),
      followers: read('follower_count').value,
      following: read('follows_count').value,
      views: views.value,
      follows: follows.value,
      viewsDate: views.date,
      followsDate: follows.date,
      newFollowers: follows.value,
    }
  })
}
function makeSalesSeries(summary, selectedWindow) {
  const records = new Map(summary.map((row) => [row.date, Number(row.running_total_cents ?? 0) / 100]))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let dates
  if (selectedWindow === 'week') {
    dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - 6 + index)
      return date
    })
  } else if (selectedWindow === 'month') {
    dates = Array.from({ length: today.getDate() }, (_, index) => new Date(today.getFullYear(), today.getMonth(), index + 1))
  } else {
    dates = Array.from({ length: 12 }, (_, index) => new Date(today.getFullYear(), index + 1, 0))
  }

  let carry = 0
  const allDates = [...records.keys()].sort()
  for (const date of allDates) {
    if (date < formatDateKey(dates[0])) carry = records.get(date)
    else break
  }
  const points = dates.map((date) => {
    const key = formatDateKey(date)
    for (const recordedDate of allDates) {
      if (recordedDate > key) break
      carry = records.get(recordedDate)
    }
    return {
      date: key,
      value: carry,
      label: selectedWindow === 'week'
        ? date.toLocaleDateString(undefined, { weekday: 'short' })
        : selectedWindow === 'month'
          ? String(date.getDate())
          : date.toLocaleDateString(undefined, { month: 'short' }),
      isCurrentMonth: date.getMonth() === today.getMonth(),
    }
  })
  return { points }
}
function formatDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function salesOption(sales, echarts) {
  const currentDate = formatDateKey(new Date())
  const currentPoint = sales.points.find((point) => point.date === currentDate || point.isCurrentMonth)
  const axisLabels = sales.points.map((point) => point.isCurrentMonth ? `{current|${point.label}}` : point.label)
  return { ...baseOption(), tooltip: { trigger: 'axis', valueFormatter: (value) => dollars(Number(value)), backgroundColor: '#FFFFFF', borderColor: '#E4E4E7', textStyle: { color: '#18181B' }, extraCssText: 'border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);' }, grid: { top: 12, right: 10, bottom: 22, left: 8, containLabel: false }, xAxis: { type: 'category', data: sales.points.map((point) => point.label), boundaryGap: false, axisLine: { lineStyle: { color: '#E4E4E7' } }, axisTick: { show: false }, axisLabel: { color: '#8B8B8F', fontSize: 11, hideOverlap: true, formatter: (value, index) => axisLabels[index], rich: { current: { color: '#16A34A', fontWeight: 700 } } }, axisPointer: { show: true, lineStyle: { color: '#A1A1AA', type: 'dashed' } } }, yAxis: { type: 'value', show: false, min: 0, max: (value) => value.max === 0 ? 1 : value.max * 1.08 }, series: [{ type: 'line', smooth: .25, symbol: 'none', showSymbol: false, data: sales.points.map((point) => point.value), lineStyle: { color: '#16A34A', width: 2.5 }, itemStyle: { color: '#16A34A' }, markPoint: { symbol: 'circle', symbolSize: 9, label: { show: false }, itemStyle: { color: '#FFFFFF', borderColor: '#16A34A', borderWidth: 2 }, data: currentPoint ? [{ coord: [currentPoint.label, currentPoint.value] }] : [] }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(22,163,74,.2)' }, { offset: 1, color: 'rgba(22,163,74,0)' }]) } }] }
}
function baseOption() { return { animation: false, textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } } }
function gaugeOption(value) { return { ...baseOption(), series: [{ type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 100, pointer: { show: false }, progress: { show: true, roundCap: true, width: 12, itemStyle: { color: '#16A34A' } }, axisLine: { lineStyle: { width: 12, color: [[1, '#EDEDEA']] } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, anchor: { show: false }, title: { show: false }, detail: { show: true, offsetCenter: [0, '2%'], color: '#18181B', fontSize: 16, fontWeight: 600, formatter: '{value}%' }, data: [{ value: Math.round(value) }] }] } }
function trendOption(trend) { return { ...baseOption(), tooltip: { trigger: 'axis', backgroundColor: '#FFFFFF', borderColor: '#E4E4E7', textStyle: { color: '#18181B' }, extraCssText: 'border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);' }, legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: '#8B8B8F', fontSize: 10 }, data: trend.series.map((account) => account.label) }, grid: { top: 24, right: 12, bottom: 16, left: 8, containLabel: false }, xAxis: { type: 'category', boundaryGap: false, data: trend.dates, axisLine: { lineStyle: { color: '#E4E4E7' } }, axisTick: { show: false }, axisLabel: { color: '#8B8B8F', fontSize: 10, hideOverlap: true } }, yAxis: { type: 'value', show: false }, series: trend.series.map((account) => ({ name: account.label, type: 'line', smooth: true, symbol: 'none', data: account.data, lineStyle: { width: 2 }, itemStyle: { color: account.color } })) } }
function comparisonOption(accounts) {
  const views = accounts.map((account) => finiteNumber(account.views))
  const follows = accounts.map((account) => finiteNumber(account.newFollowers))
  const maxValue = Math.max(1, ...views.filter((value) => value != null), ...follows.filter((value) => value != null))
  return {
    ...baseOption(),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#FFFFFF', borderColor: '#E4E4E7', textStyle: { color: '#18181B' }, extraCssText: 'border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);', formatter: (items) => items.map((item) => `${item.marker}${item.seriesName}: ${item.value == null ? 'No data' : number(item.value)}`).join('<br/>') },
    legend: { top: 0, left: 84, itemWidth: 10, itemHeight: 10, textStyle: { color: '#8B8B8F', fontSize: 10 }, data: ['Views today', 'New followers'] },
    grid: { top: 28, right: 12, bottom: 8, left: 84 },
    xAxis: [
      { type: 'value', max: maxValue * 1.08, splitLine: { lineStyle: { color: '#E4E4E7' } }, axisLabel: { color: '#8B8B8F' } },
    ],
    yAxis: { type: 'category', data: accounts.map((account) => account.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#18181B' } },
    series: [
      { name: 'Views today', type: 'bar', xAxisIndex: 0, barMaxWidth: 14, data: accounts.map((account, index) => ({ value: views[index], itemStyle: { color: account.color, borderRadius: [0, 4, 4, 0] } })) },
      { name: 'New followers', type: 'bar', xAxisIndex: 0, barMaxWidth: 14, data: accounts.map((account, index) => ({ value: follows[index], itemStyle: { color: account.color, opacity: .65, borderRadius: [0, 4, 4, 0] } })) },
    ],
  }
}
