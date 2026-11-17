// Login único pelo SaintSSO (OpenID Connect, Authorization Code + PKCE).
// O servidor faz a troca do código e valida o id_token; a sessão local (JWT) continua a mesma de sempre.
import crypto from 'node:crypto'

const issuer = (process.env.SSO_ISSUER || 'http://localhost:8080').replace(/\/+$/, '')
const clientId = process.env.SSO_CLIENT_ID || 'campo-certo-web'
const clientSecret = process.env.SSO_CLIENT_SECRET || ''
const enabled = process.env.SSO_ENABLED !== 'false'
const pending = new Map() // state -> { verifier, nonce, redirectUri, exp }
const b64u = buffer => buffer.toString('base64url')

let discovered = null
async function discovery() {
  if (discovered && discovered.at > Date.now() - 600_000) return discovered.doc
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error('O SaintSSO está indisponível.')
  const doc = await res.json()
  if (doc.issuer !== issuer) throw new Error('Emissor do SaintSSO inesperado.')
  discovered = { doc, at: Date.now() }
  return doc
}

export const ssoEnabled = () => enabled

export async function ssoStart(redirectUri) {
  const doc = await discovery()
  const now = Date.now()
  for (const [key, value] of pending) if (value.exp < now) pending.delete(key)
  const state = b64u(crypto.randomBytes(24)), nonce = b64u(crypto.randomBytes(24)), verifier = b64u(crypto.randomBytes(48))
  pending.set(state, { verifier, nonce, redirectUri, exp: now + 10 * 60_000 })
  const url = new URL(doc.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid profile email plan',
    state, nonce, code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

/** Troca o código por tokens e devolve as claims validadas do id_token. */
export async function ssoFinish(code, state) {
  const flow = pending.get(state)
  pending.delete(state)
  if (!flow || flow.exp < Date.now()) throw new Error('O pedido de login expirou. Tente entrar novamente.')
  const doc = await discovery()
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, client_id: clientId, code_verifier: flow.verifier })
  const headers = { 'content-type': 'application/x-www-form-urlencoded' }
  if (clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`
  const res = await fetch(doc.token_endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) })
  const tokens = await res.json().catch(() => ({}))
  if (!res.ok || !tokens.id_token) throw new Error('O SaintSSO recusou o login.')
  // O id_token vem direto do endpoint de token por TLS; ainda assim conferimos emissor, público, nonce e validade.
  const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
  const audience = [].concat(claims.aud)
  if (claims.iss !== issuer || !audience.includes(clientId) || claims.nonce !== flow.nonce || claims.exp * 1000 < Date.now()) throw new Error('Resposta do SaintSSO inválida.')
  if (!claims.sub) throw new Error('Resposta do SaintSSO sem identificação.')
  return claims
}
