import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const mcpUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp_server`
const claudeUrl = (() => {
  const url = new URL('https://claude.ai/new')
  url.searchParams.set('modal', 'add-custom-connector')
  url.searchParams.set('connectorName', 'Analytics')
  url.searchParams.set('connectorUrl', mcpUrl)
  url.hash = 'settings/customize-connectors'
  return url.toString()
})()
const oauthUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram_oauth_start`

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function SettingsCard({ title, action, children, className = '' }) {
  return <article className={`settings-card ${className}`}>
    <header className="settings-card-header"><h2>{title}</h2>{action}</header>
    {children}
  </article>
}

function DataTable({ columns, rows, loading, error, emptyText, rowKey, rowClassName }) {
  return <div className="table-wrap settings-table-scroll"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
    <tbody>
      {loading ? <tr><td className="settings-table-state" colSpan={columns.length}>Loading…</td></tr>
        : error ? <tr><td className="settings-table-state settings-table-error" colSpan={columns.length}>{error}</td></tr>
          : rows.length === 0 ? <tr><td className="settings-table-state" colSpan={columns.length}>{emptyText}</td></tr>
            : rows.map((row, index) => <tr key={rowKey ? rowKey(row) : index} className={rowClassName?.(row)}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}</tr>)}
    </tbody>
  </table></div>
}

export default function Settings() {
  const [aiState, setAiState] = useState({ loading: true, rows: [], error: '' })
  const [accountState, setAccountState] = useState({ loading: true, rows: [], error: '' })
  const [logs, setLogs] = useState({ loading: true, rows: [], error: '' })
  const [copyState, setCopyState] = useState('Copy URL')
  const [accountOpening, setAccountOpening] = useState(false)
  const [refreshState, setRefreshState] = useState({ status: 'idle', message: '' })
  const [section, setSection] = useState('ai')
  const pollTimer = useRef(null)
  const copyTimer = useRef(null)

  const loadAiConnections = useCallback(async () => {
    const { data, error } = await supabase.from('ai_connections').select('connection_id,client_name,status,last_used_at').order('client_name')
    setAiState({ loading: false, rows: data ?? [], error: error?.message ?? '' })
  }, [])

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase.from('instagram_accounts').select('account_id,display_name,handle,platform,connection_status').order('display_name')
    if (error) {
      setAccountState({ loading: false, rows: [], error: error.message })
      return
    }
    const rows = await Promise.all((data ?? []).map(async (account) => {
      // Connection state is synchronized server-side; the browser never reads
      // the protected connections table or its Vault token reference.
      return { ...account, connectionStatus: account.connection_status?.replace('_', ' ') ?? 'Unknown' }
    }))
    setAccountState({ loading: false, rows, error: '' })
  }, [])

  const loadLogs = useCallback(async (loading = false) => {
    if (loading) setLogs((current) => ({ ...current, loading: true }))
    const { data, error } = await supabase.from('pipeline_logs').select('log_id,function_name,status,row_count,error_message,run_at').order('run_at', { ascending: false }).limit(20)
    setLogs({ loading: false, rows: data ?? [], error: error?.message ?? '' })
    return { rows: data ?? [], error }
  }, [])

  useEffect(() => {
    loadAiConnections()
    loadAccounts()
    loadLogs(true)
    return () => {
      window.clearTimeout(pollTimer.current)
      window.clearTimeout(copyTimer.current)
    }
  }, [loadAiConnections, loadAccounts, loadLogs])

  async function copyMcpUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl)
      setCopyState('Copied')
    } catch {
      setCopyState('Copy failed')
    }
    window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopyState('Copy URL'), 1800)
  }

  function openAccountConnect() {
    setAccountOpening(true)
    window.open(oauthUrl, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => setAccountOpening(false), 2500)
  }

  async function startRefresh() {
    if (refreshState.status === 'starting' || refreshState.status === 'running') return
    window.clearTimeout(pollTimer.current)
    const clickedAt = new Date()
    setRefreshState({ status: 'starting', message: 'Starting refresh…' })
    const { error } = await supabase.rpc('trigger_full_refresh')
    if (error) {
      setRefreshState({ status: 'failed', message: `Refresh failed: ${error.message}` })
      return
    }
    setRefreshState({ status: 'running', message: 'Refresh started…' })
    const deadline = Date.now() + 30000
    const poll = async () => {
      const result = await loadLogs()
      const found = result.rows.some((row) => row.run_at && new Date(row.run_at).getTime() >= clickedAt.getTime())
      if (found) {
        setRefreshState({ status: 'complete', message: 'Refresh complete' })
        return
      }
      if (Date.now() >= deadline) {
        setRefreshState({ status: 'failed', message: 'Refresh may have failed — check the log below' })
        return
      }
      pollTimer.current = window.setTimeout(poll, 3000)
    }
    pollTimer.current = window.setTimeout(poll, 2500)
  }

  const aiColumns = [
    { key: 'client_name', label: 'Client' },
    { key: 'status', label: 'Status' },
    { key: 'last_used_at', label: 'Last used', render: (row) => formatDate(row.last_used_at) },
  ]
  const accountColumns = [
    { key: 'accountName', label: 'Account name', render: (row) => row.display_name || (row.handle ? `@${row.handle.replace(/^@/, '')}` : '—') },
    { key: 'platform', label: 'Platform' },
    { key: 'connectionStatus', label: 'Connection status' },
  ]
  const logColumns = [
    { key: 'function_name', label: 'Function' },
    { key: 'status', label: 'Status', render: (row) => <span className={`status-label ${row.status === 'error' ? 'is-error' : 'is-success'}`}>{row.status}</span> },
    { key: 'row_count', label: 'Rows', render: (row) => row.row_count ?? '—' },
    { key: 'error_message', label: 'Error', render: (row) => row.error_message || '—' },
    { key: 'run_at', label: 'Run at', render: (row) => formatDate(row.run_at) },
  ]

  return <section className="settings-page" aria-label="Settings">
    <header className="overview-header"><div><p className="eyebrow">Settings</p><h1>Connections &amp; refresh</h1></div></header>
    <nav className="settings-section-nav" aria-label="Settings sections">
      {[["ai", "AI connectors"], ["accounts", "Accounts"], ["refresh", "Refresh"]].map(([id, label]) => <button key={id} type="button" className={section === id ? 'is-selected' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>)}
    </nav>
    <div className="settings-stack">
      {section === 'ai' && <SettingsCard title="AI connectors" action={<a className="settings-action" href={claudeUrl} target="_blank" rel="noreferrer" title="Open Claude with the Analytics connector name and URL prefilled">Add to Claude <span aria-hidden="true">↗</span></a>}>
        <div className="connector-instructions">
          <p>Claude opens the Add custom connector dialog with the Analytics name and server URL filled in. Review them, then click Add in Claude.</p>
          <div className="connector-link-row"><div><strong>ChatGPT</strong><code>{mcpUrl}</code></div><button className="settings-action settings-copy" type="button" onClick={copyMcpUrl}>{copyState}</button></div>
          <p>ChatGPT: Settings → Connectors → enable Developer Mode → Create → paste this URL.</p>
        </div>
        <DataTable columns={aiColumns} rows={aiState.rows} loading={aiState.loading} error={aiState.error} emptyText="No AI connectors found." rowKey={(row) => row.connection_id} />
      </SettingsCard>}

      {section === 'accounts' && <SettingsCard title="Add accounts" action={<button className="settings-action" type="button" onClick={openAccountConnect} disabled={accountOpening}>{accountOpening ? <>⟳ Opening…</> : <>Add Account <span aria-hidden="true">↗</span></>}</button>}>
        <DataTable columns={accountColumns} rows={accountState.rows} loading={accountState.loading} error={accountState.error} emptyText="No connected accounts found." rowKey={(row) => row.account_id} />
      </SettingsCard>}

      {section === 'refresh' && <SettingsCard title="Refresh" action={<button className="settings-action" type="button" onClick={startRefresh} disabled={refreshState.status === 'starting' || refreshState.status === 'running'}>Refresh Now</button>}>
        {refreshState.message && <p className={`refresh-message refresh-${refreshState.status}`} role="status">{refreshState.message}</p>}
        <DataTable columns={logColumns} rows={logs.rows} loading={logs.loading} error={logs.error} emptyText="No pipeline runs recorded." rowKey={(row) => row.log_id} rowClassName={(row) => row.status === 'error' ? 'pipeline-error-row' : ''} />
      </SettingsCard>}
    </div>
  </section>
}
