'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { getPerfilAutenticado } from '@/lib/session'
import { ALIAS_REGEX, CODIGO_REGEX, correoInterno, rutaInicio } from '@/lib/permisos'

export default function LoginPage() {
  const [alias, setAlias] = useState('')
  const [codigo, setCodigo] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [aliasFocused, setAliasFocused] = useState(false)
  const [codigoFocused, setCodigoFocused] = useState(false)
  const [aliasStatus, setAliasStatus] = useState(null)
  const [codigoStatus, setCodigoStatus] = useState(null)
  const router = useRouter()

  const validarAlias = () => {
    const cleanAlias = alias.trim().toLowerCase()
    if (!cleanAlias) {
      setAliasStatus({ tipo: 'error', texto: 'Ingresa tu usuario.' })
      return false
    }
    if (!ALIAS_REGEX.test(cleanAlias)) {
      setAliasStatus({ tipo: 'error', texto: 'Usa de 3 a 30 caracteres: letras, números, . _ o -.' })
      return false
    }
    setAliasStatus({ tipo: 'success', texto: 'Usuario con formato válido.' })
    return true
  }

  const validarCodigo = () => {
    if (!codigo) {
      setCodigoStatus({ tipo: 'error', texto: 'Ingresa tu código de acceso.' })
      return false
    }
    if (!CODIGO_REGEX.test(codigo)) {
      setCodigoStatus({ tipo: 'error', texto: 'El código debe tener exactamente 6 dígitos.' })
      return false
    }
    setCodigoStatus({ tipo: 'success', texto: 'Código con formato válido.' })
    return true
  }

  const handleLogin = async (e) => {
    e?.preventDefault()
    setAliasStatus(null)
    setCodigoStatus(null)

    const cleanAlias = alias.trim().toLowerCase()
    const aliasValido = validarAlias()
    const codigoValido = validarCodigo()
    if (!aliasValido || !codigoValido) {
      return
    }

    setIsLoading(true)

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: correoInterno(cleanAlias),
        password: codigo,
      })

      if (authError || !authData.user) {
        if (authError?.code === 'user_banned') {
          setAliasStatus({ tipo: 'error', texto: 'Usuario inactivo. Contacta al administrador.' })
        } else {
          setAliasStatus({ tipo: 'error', texto: 'Verifica que el usuario sea correcto.' })
          setCodigoStatus({ tipo: 'error', texto: 'Verifica que el código sea correcto.' })
        }
        return
      }

      const usuario = await getPerfilAutenticado()
      if (!usuario || !usuario.activo) {
        await supabase.auth.signOut()
        setAliasStatus(usuario
          ? { tipo: 'error', texto: 'Usuario inactivo. Contacta al administrador.' }
          : { tipo: 'error', texto: 'Tu cuenta no tiene un perfil configurado.' })
        return
      }

      // Supabase Auth conserva la sesión; cada página vuelve a leer el perfil desde la base de datos.
      router.push(rutaInicio(usuario))
    } catch (err) {
      console.error(err)
      setCodigoStatus({ tipo: 'error', texto: 'No se pudo conectar con el servicio de acceso.' })
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
          <p className="quality-card-subtitle">Accede con tu usuario y código</p>
        </header>

        {/* Single Input Form */}
        <form onSubmit={handleLogin} className="quality-auth-form" noValidate>
          <label className="quality-field-label" htmlFor="quality-alias">Usuario</label>
          <div className={`quality-input-wrapper ${aliasFocused ? 'focused' : ''} ${aliasStatus?.tipo === 'error' ? 'invalid' : ''} ${aliasStatus?.tipo === 'success' ? 'valid' : ''}`}>
            <input
              id="quality-alias"
              type="text"
              value={alias}
              onChange={(e) => {
                const value = e.target.value
                setAlias(value)
                if (ALIAS_REGEX.test(value.trim().toLowerCase())) {
                  setAliasStatus({ tipo: 'success', texto: 'Usuario con formato válido.' })
                } else {
                  setAliasStatus(null)
                }
              }}
              onFocus={() => setAliasFocused(true)}
              onBlur={() => {
                setAliasFocused(false)
                validarAlias()
              }}
              placeholder="ej. jperez"
              className="quality-single-input"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
            />
          </div>
          {aliasStatus && (
            <p className={`quality-field-status ${aliasStatus.tipo}`} role={aliasStatus.tipo === 'error' ? 'alert' : 'status'}>
              {aliasStatus.tipo === 'success' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 12l2.5 2.5L16.5 9" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
              <span>{aliasStatus.texto}</span>
            </p>
          )}

          <label className="quality-field-label" htmlFor="quality-access-code">Código de acceso</label>
          <div className={`quality-input-wrapper ${codigoFocused ? 'focused' : ''} ${codigoStatus?.tipo === 'error' ? 'invalid' : ''} ${codigoStatus?.tipo === 'success' ? 'valid' : ''}`}>
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
              value={codigo}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 6)
                setCodigo(value)
                if (CODIGO_REGEX.test(value)) {
                  setCodigoStatus({ tipo: 'success', texto: 'Código con formato válido.' })
                } else {
                  setCodigoStatus(null)
                }
              }}
              onFocus={() => setCodigoFocused(true)}
              onBlur={() => {
                setCodigoFocused(false)
                validarCodigo()
              }}
              placeholder="6 dígitos"
              className="quality-single-input"
              inputMode="numeric"
              maxLength={6}
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
          {codigoStatus && (
            <p className={`quality-field-status ${codigoStatus.tipo}`} role={codigoStatus.tipo === 'error' ? 'alert' : 'status'}>
              {codigoStatus.tipo === 'success' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 12l2.5 2.5L16.5 9" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
              <span>{codigoStatus.texto}</span>
            </p>
          )}
          <p className="quality-login-hint">¿Olvidaste tu código? Pide a tu administrador que te genere uno nuevo.</p>

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