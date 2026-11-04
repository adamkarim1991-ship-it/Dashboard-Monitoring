export function decodeJwtPayload(token: string): any {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return {}
    return JSON.parse(Buffer.from(parts[1], "base64").toString())
  } catch {
    return {}
  }
}

// Build HMS auth headers from an access token.
// HMS rejects (401) a request whose x-token-id / x-device-id do not belong to
// the bearer token, so those headers are only sent when they can be read from a
// real JWT. Tokens that are not JWTs are sent with Authorization alone, which
// HMS accepts.
export function buildHmsHeaders(accessToken: string): Record<string, string> {
  const p = decodeJwtPayload(accessToken)
  const auth = p["x-user-authorization"] || {}

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "*/*",
    "x-location": "Asia/Jakarta",
    "x-request-source": "web",
    Origin: "https://gtl-id.tokgistic.com",
    Referer: "https://gtl-id.tokgistic.com/tms/operation-performance-central",
  }

  const claims: Record<string, string> = {
    "x-token-id": String(auth["x-token-id"] || p["x-token-id"] || ""),
    "x-device-id": String(auth["x-device-id"] || p["x-device-id"] || ""),
    "x-user-id": String(auth["x-user-id"] || ""),
    "x-facility-id": String(auth["x-facility-id"] || ""),
    "x-company-id": String(auth["x-company-id"] || ""),
  }

  for (const [key, value] of Object.entries(claims)) {
    if (value && value !== "undefined" && value !== "null") {
      headers[key] = value
    }
  }

  return headers
}