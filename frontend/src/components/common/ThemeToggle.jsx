/**
 * components/common/ThemeToggle.jsx — Shared theme switch.
 */

import { Moon, Sun } from 'lucide-react'
import useThemeStore from '../../store/themeStore'

export default function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm theme-toggle"
      onClick={toggleTheme}
      aria-pressed={isDark}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  )
}