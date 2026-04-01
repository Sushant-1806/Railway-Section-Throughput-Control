/**
 * components/auth/LoginPage.jsx — Login and Register form.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Train, Lock, User, Mail, Eye, EyeOff } from 'lucide-react'
import { login, register } from '../../services/api'
import useAuthStore from '../../store/authStore'

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const [mode, setMode] = useState('login')        // 'login' | 'register'
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({
    username: '', email: '', password: '', role: 'operator',
  })

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      let res
      if (mode === 'login') {
        res = await login({ username: form.username, password: form.password })
      } else {
        res = await register(form)
      }
      const { access_token, role, username } = res.data
      setAuth(access_token, { username: username || form.username, role })
      toast.success(`Welcome, ${username || form.username}!`)
      navigate('/dashboard')
    } catch (err) {
      const msg = err.response?.data?.message
      toast.error(typeof msg === 'string' ? msg : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="icon">🚂</div>
          <h1>Railway Control</h1>
          <p>AI-Powered Traffic Management System</p>
        </div>

        {/* Mode toggle */}
        <div className="tabs" style={{ marginBottom: '28px' }}>
          <button className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>
            Sign In
          </button>
          <button className={`tab ${mode === 'register' ? 'active' : ''}`} onClick={() => setMode('register')}>
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <div className="flex items-center" style={{ position: 'relative' }}>
              <User size={16} style={{ position:'absolute', left:12, color:'var(--text-muted)' }} />
              <input
                className="form-input"
                style={{ paddingLeft: '36px' }}
                type="text"
                name="username"
                placeholder="Enter username"
                value={form.username}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          {mode === 'register' && (
            <div className="form-group">
              <label className="form-label">Email</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} />
                <input
                  className="form-input"
                  style={{ paddingLeft: '36px' }}
                  type="email"
                  name="email"
                  placeholder="Enter email"
                  value={form.email}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} />
              <input
                className="form-input"
                style={{ paddingLeft: '36px', paddingRight: '40px' }}
                type={showPassword ? 'text' : 'password'}
                name="password"
                placeholder="Enter password"
                value={form.password}
                onChange={handleChange}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {mode === 'register' && (
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-select" name="role" value={form.role} onChange={handleChange}>
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          )}

          <button
            className="btn btn-primary w-full btn-lg"
            type="submit"
            disabled={loading}
            style={{ marginTop: '8px' }}
          >
            {loading ? <><span className="spinner" style={{width:18,height:18,borderWidth:2}} /> Loading...</> : (mode === 'login' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <p className="text-muted text-sm" style={{ textAlign:'center', marginTop:'20px' }}>
          Admin: <span className="font-mono">admin / admin123</span> · Operator: <span className="font-mono">operator / operator123</span>
        </p>
      </div>
    </div>
  )
}
