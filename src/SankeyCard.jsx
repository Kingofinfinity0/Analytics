import { useEffect, useState } from 'react'
import ClientEChart from './ClientEChart'

function tokenPalette() {
  const style = getComputedStyle(document.documentElement)
  return { views: style.getPropertyValue('--color-flow-views').trim() || '#2DD4BF', visits: style.getPropertyValue('--color-flow-visits').trim() || '#6366F1', sales: style.getPropertyValue('--color-flow-sales').trim() || '#7C3AED', muted: style.getPropertyValue('--color-text-tertiary').trim() || '#A1A1AA' }
}
function rgba(hex, alpha) {
  const value = hex.replace('#', '')
  return 'rgba(' + parseInt(value.slice(0, 2), 16) + ', ' + parseInt(value.slice(2, 4), 16) + ', ' + parseInt(value.slice(4, 6), 16) + ', ' + alpha + ')'
}

export default function SankeyCard({ status, values, accountViews = [], error, onRetry }) {
  const [palette, setPalette] = useState(null)
  useEffect(() => setPalette(tokenPalette()), [])
  if (status === 'loading' || !palette) return <article className="overview-card overview-card--sankey"><div className="sankey-skeleton" aria-label="Loading cashflow" /></article>
  if (status === 'error') return <article className="overview-card overview-card--sankey sankey-state"><div><span className="sankey-state-icon">!</span><h2>Could not load cashflow</h2><p>{error}</p><button type="button" onClick={onRetry}>Retry</button></div></article>
  const hasFlow = values && [values.views, values.visits, values.sales].some((value) => Number(value) > 0)
  if (!hasFlow) return <article className="overview-card overview-card--sankey sankey-state"><div><span className="sankey-state-icon">↝</span><h2>No cashflow in this period</h2></div></article>
  return <article className="overview-card overview-card--sankey"><header className="card-heading"><h2>Cashflow</h2><p>Account views → Gumroad visits → sales</p></header><ClientEChart className="overview-chart overview-chart--sankey" option={sankeyOption(values, accountViews, palette)} /></article>
}

function sankeyOption(values, accountViews, palette) {
  const totals = { views: Number(values.views ?? 0), visits: Number(values.visits ?? 0), sales: Number(values.sales ?? 0) }
  const accounts = accountViews.length ? accountViews : [{ label: 'Instagram views', color: palette.views, views: totals.views }]
  const sourceNames = accounts.map((account, index) => `${account.label || `Account ${index + 1}`} views`)
  const data = accounts.map((account, index) => ({ name: sourceNames[index], value: Number(account.views ?? 0), itemStyle: { color: account.color || palette.views }, label: { position: 'left', align: 'right' } }))
  data.push({ name: 'Total Views', value: totals.views, itemStyle: { color: palette.views } }, { name: 'Gumroad Visits', value: totals.visits, itemStyle: { color: palette.visits } }, { name: 'Sales', value: totals.sales, itemStyle: { color: palette.sales }, label: { position: 'right', align: 'left' } })
  const flows = accounts.map((account, index) => ({ source: sourceNames[index], target: 'Total Views', value: Number(account.views ?? 0), lineStyle: { color: rgba(account.color || palette.views, .42) } }))
  flows.push(
    { source: 'Total Views', target: 'Gumroad Visits', value: totals.visits, lineStyle: { color: rgba(palette.views, .4) } },
    { source: 'Gumroad Visits', target: 'Sales', value: totals.sales, lineStyle: { color: rgba(palette.visits, .4) } },
  )
  const valueByName = new Map(data.map((node) => [node.name, node.value]))
  return {
    animation: false,
    textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
    tooltip: { trigger: 'item', backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-hairline)', borderWidth: 1, padding: 12, extraCssText: 'border-radius:8px; box-shadow:var(--shadow-1); color:var(--color-text);', formatter: (params) => params.dataType === 'edge' ? params.data.source + ' → ' + params.data.target + ': ' + Number(params.data.value).toLocaleString() : params.name + ': ' + Number(valueByName.get(params.name) ?? 0).toLocaleString() },
    series: [{
      type: 'sankey', left: 91, right: 68, top: 24, bottom: 24, nodeWidth: 14, nodeGap: 20, draggable: false,
      emphasis: { focus: 'adjacency' },
      label: { color: palette.muted, fontSize: 10, formatter: (params) => params.name + '\n' + Number(valueByName.get(params.name) ?? 0).toLocaleString() },
      lineStyle: { curveness: .45, opacity: .4 },
      data,
      links: flows,
    }],
  }
}
