export function decodeJwtPayload(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return {}
    return JSON.parse(Buffer.from(parts[1], 'base64').toString())
  } catch {
    return {}
  }
}

/**
 * Bangun HMS auth headers dari access token.
 * Wajib: x-token-id & x-device-id dari JWT payload (kalau tidak, HMS balas 401).
 */
export function buildHmsHeaders(accessToken: string): Record<string, string> {
  const p = decodeJwtPayload(accessToken)
  const auth = p['x-user-authorization'] || {}

  return {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'x-location': 'Asia/Jakarta',
    'x-request-source': 'web',
    'x-token-id': String(auth['x-token-id'] || p['x-token-id'] || ''),
    'x-device-id': String(auth['x-device-id'] || p['x-device-id'] || ''),
    'x-user-id': String(auth['x-user-id'] || ''),
    'x-facility-id': String(auth['x-facility-id'] || ''),
    'x-company-id': String(auth['x-company-id'] || ''),
    'Origin': 'https://gtl-id.tokgistic.com',
    'Referer': 'https://gtl-id.tokgistic.com/tms/operation-performance-central',
  }
}
