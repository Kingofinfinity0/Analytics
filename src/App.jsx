import React, { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Analytics from './Analytics'
import Overview from './Overview'
import Settings from './Settings'
import Auth from './Auth'
import { restoreSession, supabase } from './supabase'

const topItems = [
  { id: 'overview', label: 'Overview', icon: OverviewIcon },
  { id: 'analytics', label: 'Analytics', icon: AnalyticsIcon },
  { id: 'canvas', label: 'Canvas', icon: CanvasIcon },
]

const settingsItem = { id: 'settings', label: 'Settings', icon: SettingsIcon }

function loadNavOrder() {
  try {
    const savedOrder = JSON.parse(localStorage.getItem('analytics-nav-order'))
    if (!Array.isArray(savedOrder)) return topItems
    const byId = new Map(topItems.map((item) => [item.id, item]))
    const ordered = savedOrder.map((id) => byId.get(id)).filter(Boolean)
    const missing = topItems.filter((item) => !savedOrder.includes(item.id))
    return [...ordered, ...missing]
  } catch {
    return topItems
  }
}

function App() {
  const [session, setSession] = useState(undefined)
  const [collapsed, setCollapsed] = useState(false)
  const [items, setItems] = useState(loadNavOrder)
  const [draggedId, setDraggedId] = useState(null)

  useEffect(() => {
    localStorage.setItem('analytics-nav-order', JSON.stringify(items.map((item) => item.id)))
  }, [items])

  useEffect(() => {
    let mounted = true
    restoreSession().then((restoredSession) => {
      if (mounted) setSession(restoredSession)
    }).catch(() => {
      if (mounted) setSession(null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') supabase.auth.refreshSession()
    }
    document.addEventListener('visibilitychange', refreshOnFocus)
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      mounted = false
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', refreshOnFocus)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [])

  function moveItem(targetId) {
    if (!draggedId || draggedId === targetId) return
    setItems((current) => {
      const next = [...current]
      const from = next.findIndex((item) => item.id === draggedId)
      const to = next.findIndex((item) => item.id === targetId)
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function reorderItem(id, direction) {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id)
      if (index < 0) return current
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }

  if (session === undefined) return null
  if (!session) return <Routes><Route path="/signup" element={<Auth />} /><Route path="*" element={<Navigate to="/login" replace />} /><Route path="/login" element={<Auth />} /></Routes>

  return (
    <div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-top">
          <div className="brand" aria-label="Analytics dashboard">
            <span className="brand-name">Analytics</span>
          </div>
          <button
            className="menu-toggle"
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <MenuIcon />
          </button>
        </div>

        <nav className="nav-list" aria-label="Dashboard sections">
          {items.map(({ id, label, icon: Icon }) => (
            <NavLink
              key={id}
              to={`/${id}`}
              className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''} ${draggedId === id ? 'is-dragging' : ''}`}
              title={collapsed ? label : undefined}
              aria-label={label}
              aria-description="Press Alt with Up or Down arrow to reorder"
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              aria-roledescription="reorderable navigation item"
              draggable
              onDragStart={(event) => {
                setDraggedId(id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                event.preventDefault()
                moveItem(id)
                setDraggedId(null)
              }}
              onDragEnd={() => setDraggedId(null)}
              onKeyDown={(event) => {
                if (event.altKey && event.key === 'ArrowUp') {
                  event.preventDefault()
                  reorderItem(id, -1)
                } else if (event.altKey && event.key === 'ArrowDown') {
                  event.preventDefault()
                  reorderItem(id, 1)
                }
              }}
            >
              <Icon />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <nav className="nav-bottom" aria-label="Account settings">
          <div className="user-profile" title={session.user.email}>
            <span>{session.user.email?.slice(0, 1).toUpperCase()}</span>
            <div><b>{session.user.email?.split('@')[0]}</b><small>Profile</small></div>
          </div>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
            title={collapsed ? settingsItem.label : undefined}
          >
            <SettingsIcon />
            <span className="nav-label">Settings</span>
          </NavLink>
        </nav>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/overview" element={<Overview />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/canvas" element={<Page title="Canvas" />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function Page({ title }) {
  return <section className="empty-page" aria-label={title} />
}

function Icon({ children }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

function OverviewIcon() { return <Icon><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></Icon> }
function AnalyticsIcon() { return <Icon><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></Icon> }
function CanvasIcon() { return <Icon><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h5M8 16h7" /></Icon> }
function SettingsIcon() { return <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.72 2.72-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.18h-3.84v-.18a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.72-2.72.06-.06A1.7 1.7 0 0 0 5 15a1.7 1.7 0 0 0-1.56-1.04h-.18v-3.84h.18A1.7 1.7 0 0 0 5 9.08a1.7 1.7 0 0 0-.34-1.88L4.6 7.14l2.72-2.72.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.04-1.56v-.18h3.84v.18a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.72 2.72-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.18v3.84h-.18A1.7 1.7 0 0 0 19.4 15Z" /></Icon> }
function MenuIcon() { return <Icon><path d="M4 7h16M4 12h16M4 17h16" /></Icon> }

export default App
