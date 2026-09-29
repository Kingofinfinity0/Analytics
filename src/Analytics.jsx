import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const fallbacks = {
  instagram: ['posted_at', 'media_type', 'reach', 'likes', 'comments', 'saves', 'shares'],
  gumroad: ['created_at', 'product_name', 'price_cents', 'refunded', 'referral_source', 'utm_source'],
}

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function labelFor(value) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatValue(value, field = '') {
  if (value === null || value === undefined || value === '') return '—'
  if (field.includes('cents')) return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value) / 100)
  if (typeof value === 'number') return new Intl.NumberFormat().format(value)
  if (field.endsWith('_at') || field === 'created_at') return new Date(value).toLocaleDateString()
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

export default function Analytics() {
  const [platform, setPlatform] = useState('instagram')
  const [targetDate, setTargetDate] = useState(today)
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState(null)
  const [chips, setChips] = useState([])
  const [columns, setColumns] = useState(fallbacks.instagram)
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadAnalytics() {
      setStatus('loading')
      setError('')
      try {
        const isInstagram = platform === 'instagram'
        const fieldsRequest = supabase.from('field_selections').select('field_name, display_as, display_order').eq('platform', platform).order('display_order')
        const accountsRequest = isInstagram
          ? supabase.from('instagram_accounts').select('account_id, handle, display_name').order('created_at')
          : Promise.resolve({ data: [], error: null })
        const [fieldsResult, accountsResult] = await Promise.all([fieldsRequest, accountsRequest])
        if (fieldsResult.error) throw fieldsResult.error
        if (accountsResult.error) throw accountsResult.error
        if (cancelled) return

        const availableAccounts = accountsResult.data ?? []
        setAccounts(availableAccounts)
        const activeAccountId = isInstagram ? (accountId ?? availableAccounts[0]?.account_id ?? null) : null
        if (isInstagram && activeAccountId !== accountId) {
          setAccountId(activeAccountId)
          if (!activeAccountId) {
            setChips([])
            setColumns(fallbacks.instagram)
            setRows([])
            setStatus('ready')
          }
          return
        }

        const fields = fieldsResult.data ?? []
        const selectedChips = fields.filter((field) => field.display_as === 'chip')
        const selectedColumns = fields.filter((field) => field.display_as === 'column').map((field) => field.field_name)
        const table = isInstagram ? 'instagram_posts' : 'gumroad_sales'
        const dateColumn = isInstagram ? 'posted_at' : 'created_at'
        let tableQuery = supabase.from(table).select('*').order(dateColumn, { ascending: false }).limit(100)
        if (isInstagram && activeAccountId) tableQuery = tableQuery.eq('account_id', activeAccountId)
        if (targetDate) {
          tableQuery = tableQuery.gte(dateColumn, `${targetDate}T00:00:00.000Z`).lte(dateColumn, `${targetDate}T23:59:59.999Z`)
        }

        const [tableResult, ...metricResults] = await Promise.all([
          tableQuery,
          ...selectedChips.map((field) => isInstagram
            ? supabase.rpc('get_metric_delta', {
              p_account_id: activeAccountId,
              p_metric_name: field.field_name,
              p_target_date: targetDate,
            })
            : supabase.rpc('get_platform_metric_delta', {
              p_platform: 'gumroad',
              p_metric_name: field.field_name,
              p_target_date: targetDate,
            })),
        ])
        if (tableResult.error) throw tableResult.error
        const dynamicChips = selectedChips.map((field, index) => {
          const result = metricResults[index]
          if (result.error) throw result.error
          return { ...field, metric: result.data?.[0] ?? null }
        })
        if (!cancelled) {
          setChips(dynamicChips)
          setColumns(platform === 'gumroad'
            ? [...new Set([...fallbacks.gumroad, ...selectedColumns])]
            : selectedColumns.length ? selectedColumns : fallbacks[platform])
          setRows(tableResult.data ?? [])
          setStatus('ready')
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Could not load analytics.')
          setStatus('error')
        }
      }
    }

    loadAnalytics()
    return () => { cancelled = true }
  }, [platform, targetDate, accountId])

  const placeholderChips = chips.length === 0

  return (
    <section className="analytics-page" aria-label="Analytics">
      <header className="analytics-header">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>{platform === 'instagram' ? 'Instagram' : 'Gumroad'}</h1>
        </div>
        <div className="analytics-controls">
          <label className="date-control">Date <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
          <div className="workbook-tabs" role="tablist" aria-label="Data sources">
            {['instagram', 'gumroad'].map((name) => <button key={name} type="button" role="tab" aria-selected={platform === name} className={platform === name ? 'is-selected' : ''} onClick={() => { setPlatform(name); setAccountId(null); setRows([]); setChips([]) }} >{name === 'instagram' ? 'Instagram' : 'Gumroad'}</button>)}
          </div>
        </div>
      </header>

      {platform === 'instagram' && accounts.length > 0 && <div className="profile-switcher" aria-label="Instagram profile">
        {accounts.map((account) => <button key={account.account_id} type="button" className={accountId === account.account_id ? 'is-selected' : ''} onClick={() => setAccountId(account.account_id)}>{account.display_name || account.handle}</button>)}
      </div>}

      <div className="metric-grid" aria-busy={status === 'loading'}>
        {chips.map((chip) => <MetricChip key={chip.field_name} chip={chip} />)}
        {placeholderChips && Array.from({ length: 3 }, (_, index) => <div className="metric-chip metric-chip--empty" key={index}><MetricIcon /><span>Metric</span><strong>—</strong><small>Awaiting data</small></div>)}
      </div>

      <section className="data-card">
        <div className="table-header"><div><span className="table-kicker">Workbook</span><h2>{labelFor(platform)} data</h2></div><span className="row-count">{rows.length} rows</span></div>
        {status === 'error' ? <p className="data-message">{error}</p> : <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{labelFor(column)}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.post_id ?? row.sale_id ?? index}>{columns.map((column) => <td key={column}>{formatValue(row[column], column)}</td>)}</tr>) : <tr><td className="empty-table" colSpan={columns.length || 1}>{status === 'loading' ? 'Loading data…' : 'No records yet.'}</td></tr>}</tbody></table></div>}
      </section>
    </section>
  )
}

function MetricChip({ chip }) {
  const metric = chip.metric
  const delta = metric?.delta == null ? null : Number(metric.delta)
  const positive = delta != null && delta >= 0
  const comparison = metric?.previous_value == null ? 'No previous snapshot' : `${positive ? '↑' : '↓'} ${formatValue(Math.abs(delta), chip.field_name)} vs previous snapshot`
  return <article className="metric-chip"><MetricIcon /><span>{labelFor(chip.field_name)}</span><strong>{formatValue(metric?.current_value, chip.field_name)}</strong><small className={delta == null ? 'neutral' : positive ? 'up' : 'down'}>{comparison}</small></article>
}

function MetricIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 15l2.5-3 2 2 3.5-5" /><path d="M16 8h2v2" /></svg> }
