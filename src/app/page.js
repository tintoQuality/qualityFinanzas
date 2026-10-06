'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [pin, setPin] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const router = useRouter()

  const handleLogin = async (e) => {
    e?.preventDefault()
    setError('')

    const cleanPin = pin.trim()
    if (!cleanPin) {
      setError('Ingresa tu código de acceso')
      return
    }

    setIsLoading(true)

    try {
      // Consulta a la tabla usuarios por PIN único
      const { data, error: sbError } = await supabase
        .from('usuarios')
        .select('*')
        .eq('pin_hash', cleanPin)

      if (sbError || !data || data.length === 0) {
        setError('Código de acceso incorrecto')
        setIsLoading(false)
        return
      }

      const usuario = data[0]

      if (usuario.activo === false) {
        setError('Usuario inactivo. Contacte al administrador.')
        setIsLoading(false)
        return
      }

      // Guardar sesión multi-cuenta y redirigir
      localStorage.setItem('usuario_id', usuario.id)
      localStorage.setItem('usuario_nombre', usuario.nombre || 'Usuario')
      localStorage.setItem('usuario_rol', usuario.rol || 'usuario')
      router.push('/finanzas')
    } catch (err) {
      console.error(err)
      setError('Error al conectar con la base de datos')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="quality-login-viewport">
      <div className="quality-auth-card">
        {/* Top Geometric Luxury Emblem Badge */}
        <div className="quality-emblem-badge" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            {/* Minimalist Geometric Flower / Aperture Spiral like in the reference image */}
            <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.4)" strokeDasharray="3 3" />
            <circle cx="12" cy="12" r="5" stroke="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="rgba(255,255,255,0.6)" strokeLinecap="round" />
            <path d="m5.6 5.6 2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="rgba(255,255,255,0.35)" strokeLinecap="round" />
          </svg>
        </div>

        {/* Title & Subtitle */}
        <header className="quality-card-header">
          <h1 className="quality-card-title">Finanzas Quality</h1>
          <p className="quality-card-subtitle">Ingresa tu código único de acceso</p>
        </header>

        {/* Single Input Form */}
        <form onSubmit={handleLogin} className="quality-auth-form" noValidate>
          {/* Single PIN / Access Code Field */}
          <div className={`quality-input-wrapper ${isFocused ? 'focused' : ''}`}>
            {/* Lock icon */}
            <svg
              className="quality-input-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>

            <input
              id="quality-access-code"
              type={showPassword ? 'text' : 'password'}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Código de acceso"
              className="quality-single-input"
              autoFocus
              autoComplete="current-password"
            />

            {/* Visibility Toggle Button */}
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="quality-toggle-visibility-btn"
              aria-label={showPassword ? 'Ocultar código' : 'Mostrar código'}
            >
              {showPassword ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="quality-error-msg" role="alert">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Solid White High-Contrast Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="quality-submit-btn"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" opacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span>Validando...</span>
              </>
            ) : (
              'Ingresar'
            )}
          </button>
        </form>

        {/* Security Footnote */}
        <footer className="quality-card-footer">
          <span>Acceso seguro</span>
          <span className="quality-footer-dot" aria-hidden="true" />
          <span>Sistema Quality</span>
        </footer>
      </div>
    </main>
  )
}