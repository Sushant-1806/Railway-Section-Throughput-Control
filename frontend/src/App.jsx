/**
 * App.jsx — Root router with auth-protected routes.
 */

import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import useAuthStore from './store/authStore'
import Layout from './components/layout/Layout'
import LoginPage from './components/auth/LoginPage'
import Dashboard from './pages/Dashboard'
import MapPage from './pages/MapPage'
import ScenariosPage from './pages/ScenariosPage'
import AnalysisPage from './pages/AnalysisPage'

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token)
  const location = useLocation()
  if (!token) return <Navigate to="/" state={{ from: location }} replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />

      <Route path="/dashboard" element={
        <RequireAuth><Layout><Dashboard /></Layout></RequireAuth>
      } />
      <Route path="/map" element={
        <RequireAuth><Layout><MapPage /></Layout></RequireAuth>
      } />
      <Route path="/scenarios" element={
        <RequireAuth><Layout><ScenariosPage /></Layout></RequireAuth>
      } />
      <Route path="/analysis" element={
        <RequireAuth><Layout><AnalysisPage /></Layout></RequireAuth>
      } />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
