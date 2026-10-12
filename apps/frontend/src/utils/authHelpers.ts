export const initiateSignIn = (auth: any, redirectPath: string) => {
  console.log('[AuthHelper] Initiating sign in with redirect:', redirectPath)
  // Use URL-safe base64 encoding
  const state = btoa(
    JSON.stringify({
      redirect: redirectPath,
      timestamp: Date.now(),
    }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  return auth.signinRedirect({ state })
}

/** Host header or window.hostname, with or without a port. */
export function isLocalLoopbackHost(hostname: string | undefined): boolean {
  if (!hostname) return false
  if (hostname.startsWith('[')) {
    const end = hostname.indexOf(']')
    return end >= 0 && hostname.slice(1, end) === '::1'
  }
  if (hostname === '::1' || hostname.startsWith('::1:')) return true
  const host = hostname.split(':')[0]
  return host === 'localhost' || host === '127.0.0.1'
}

/** Keycloak allowlists localhost, not 127.0.0.1. Rewrite loopback IPs. */
export function canonicalLocalAppHref(href: string): string | null {
  const url = new URL(href)
  if (!isLocalLoopbackHost(url.hostname) || url.hostname === 'localhost') {
    return null
  }
  url.hostname = 'localhost'
  return url.toString()
}

// frontend
export const getKeycloakBaseUrl = () => {
  if (
    process.env.NEXT_PUBLIC_KEYCLOAK_URL &&
    process.env.NEXT_PUBLIC_KEYCLOAK_URL.trim() !== ''
  ) {
    return process.env.NEXT_PUBLIC_KEYCLOAK_URL
  }

  if (typeof window === 'undefined') return ''

  const hostname = window.location.hostname

  if (isLocalLoopbackHost(hostname)) {
    return 'http://localhost:8080/'
  }

  if (hostname === 'uiuc.chat') {
    return 'https://login.uiuc.chat/'
  }

  return `${window.location.origin}/keycloak/`
}

// backend
export function getKeycloakBaseFromHost(hostname: string | undefined): string {
  if (process.env.KEYCLOAK_URL && process.env.KEYCLOAK_URL.trim() !== '') {
    return process.env.KEYCLOAK_URL
  }
  if (
    process.env.NEXT_PUBLIC_KEYCLOAK_URL &&
    process.env.NEXT_PUBLIC_KEYCLOAK_URL.trim() !== ''
  ) {
    return process.env.NEXT_PUBLIC_KEYCLOAK_URL
  }
  if (isLocalLoopbackHost(hostname)) return 'http://localhost:8080/'
  if (hostname === 'uiuc.chat') return 'https://login.uiuc.chat/'
  return `https://${hostname}/keycloak/`
}

export function getKeycloakIssuerUrl(hostname: string | undefined): string {
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'illinois_chat_realm'

  if (
    process.env.NEXT_PUBLIC_KEYCLOAK_URL &&
    process.env.NEXT_PUBLIC_KEYCLOAK_URL.trim() !== ''
  ) {
    return `${process.env.NEXT_PUBLIC_KEYCLOAK_URL}realms/${realm}`
  }
  if (isLocalLoopbackHost(hostname))
    return `http://localhost:8080/realms/${realm}`
  if (hostname === 'uiuc.chat') return `https://login.uiuc.chat/realms/${realm}`
  return `https://${hostname}/keycloak/realms/${realm}`
}
