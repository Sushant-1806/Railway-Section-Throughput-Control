/**
 * components/layout/Layout.jsx — App shell with sidebar and topbar.
 */

import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Map, Layers, BrainCircuit, LogOut, Activity, Settings
} from 'lucide-react'
import useAuthStore from '../../store/authStore'
import useRailwayStore from '../../store/railwayStore'
import toast from 'react-hot-toast'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/map',       icon: Map,             label: 'Track Map' },
  { to: '/scenarios', icon: Layers,          label: 'Scenarios' },
  { to: '/analysis',  icon: BrainCircuit,    label: 'AI Analysis' },
]

export default function Layout({ children }) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const conflicts = useRailwayStore((s) => s.conflicts)
  const simulationRunning = useRailwayStore((s) => s.simulationRunning)

  const handleLogout = () => {
    logout()
    toast.success('Logged out')
    navigate('/')
  }

  return (
    <div className="app-layout">
      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-logo">
          <div className="logo-icon">🚂</div>
          <span>Railway Control System</span>
          {simulationRunning && (
            <span style={{
              display:'inline-flex', alignItems:'center', gap:6,
              fontSize:'0.72rem', color:'var(--success)',
              background:'rgba(34,197,94,0.1)', border:'1px solid var(--success)',
              borderRadius:999, padding:'2px 10px', marginLeft:8,
            }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--success)', animation:'blink 2s infinite' }} />
              LIVE
            </span>
          )}
        </div>
        <div className="topbar-right">
          {conflicts.length > 0 && (
            <span style={{
              display:'inline-flex', alignItems:'center', gap:6,
              fontSize:'0.72rem', color:'var(--danger)',
              background:'rgba(239,68,68,0.15)', border:'1px solid var(--danger)',
              borderRadius:999, padding:'4px 12px',
              animation:'conflictBanner 2s infinite',
            }}>
              ⚠️ {conflicts.length} Conflict{conflicts.length > 1 ? 's' : ''}
            </span>
          )}
          {user && (
            <>
              <span className={`badge-role ${user.role}`}>{user.role}</span>
              <span className="text-muted text-sm">{user.username}</span>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
            <LogOut size={15} /> Sign Out
          </button>
        </div>
      </header>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-nav">
          <div className="nav-section-title">Navigation</div>
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <main className="main">
        {children}
      </main>
    </div>
  )
}
