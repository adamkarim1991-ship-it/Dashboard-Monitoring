// HMS API Client with proactive token refresh
// Wraps all HMS API calls with:
// 1. Pre-request expiry check (refresh BEFORE expiry, not after 401)
// 2. Auto-refresh on 401 with rotating refresh_token
// 3. Fallback to local token-store cache
// 4. Explicit error codes for frontend

import { prisma } from '@/lib/prisma';
import { buildHmsHeaders } from '@/lib/hms-headers';
import { saveToken, getToken } from '@/lib/token-store';

const HMS_BASE = process.env.HMS_BASE_URL || 'https://gtl-id.tokgistic.com';
const REFRESH_WINDOW_MS = 30 * 60 * 1000;
const CLIENT_ID = 'gtl-frontend';

export type HmsErrorCode =
  | 'TOKEN_MISSING'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'HMS_AUTH_FAILED'
  | 'HMS_DOWN'
  | 'HMS_INVALID_RESPONSE';

export interface HmsClientResult<T = any> {
  success: boolean;
  status: number;
  data?: T;
  errorCode?: HmsErrorCode;
  errorMessage?: string;
  tokenRefreshed?: boolean;
}

export interface HmsRefreshResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
}

// Core: Refresh HMS token via /auth/token
export async function refreshHmsToken(
  accessToken: string,
  refreshToken: string
): Promise<HmsRefreshResult> {
  try {
    const res = await fetch(`${HMS_BASE}/auth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `HMS ${res.status}: ${text.slice(0, 200)}` };
    }

    const json = await res.json();
    if (!json.access_token) {
      return { success: false, error: 'No access_token in response' };
    }

    return {
      success: true,
      accessToken: json.access_token,
      refreshToken: json.refresh_token || undefined,
      expiresIn: Number(json.expires_in) || 86400,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// Refresh + persist to DB + local store
async function refreshAndPersistUserToken(
  userId: string,
  accessToken: string,
  refreshToken: string
): Promise<HmsRefreshResult> {
  const result = await refreshHmsToken(accessToken, refreshToken);
  if (!result.success) return result;

  const newExpiresAt = new Date(Date.now() + (result.expiresIn || 86400) * 1000);

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        hmsToken: result.accessToken!,
        hmsRefreshToken: result.refreshToken || refreshToken,
        hmsTokenExpiresAt: newExpiresAt,
        hmsRefreshTokenUpdatedAt: new Date(),
        hmsTokenUpdatedAt: new Date(),
      },
    });
  } catch (dbErr) {
    console.warn('[hms-client] DB persist failed, using local only:', (dbErr as Error).message);
  }

  saveToken(`user:${userId}`, {
    accessToken: result.accessToken!,
    refreshToken: result.refreshToken || refreshToken,
    expiresAt: newExpiresAt.getTime(),
  });

  return result;
}

// Main: hmsFetch with proactive refresh
export async function hmsUserFetch<T = any>(
  userId: string,
  path: string,
  options: {
    method?: string;
    body?: any;
    apiId?: string;
    params?: Record<string, any>;
  } = {}
): Promise<HmsClientResult<T>> {
  let user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, hmsToken: true, hmsRefreshToken: true, hmsTokenExpiresAt: true },
  });

  if (!user?.hmsToken) {
    const cached = getToken(`user:${userId}`);
    if (cached && !isExpired(cached)) {
      console.log('[hms-client] Using local cache token for', userId);
      user = {
        id: userId,
        hmsToken: cached.accessToken,
        hmsRefreshToken: cached.refreshToken || null,
        hmsTokenExpiresAt: cached.expiresAt ? new Date(cached.expiresAt) : null,
      };
    }
  }

  if (!user?.hmsToken) {
    return {
      success: false,
      status: 0,
      errorCode: 'TOKEN_MISSING',
      errorMessage: 'No HMS token stored. Login to HMS via extension first.',
    };
  }

  let token = user.hmsToken;
  let tokenRefreshed = false;

  const expiresAt = user.hmsTokenExpiresAt;
  if (expiresAt && user.hmsRefreshToken) {
    const timeUntilExpiry = expiresAt.getTime() - Date.now();
    if (timeUntilExpiry < REFRESH_WINDOW_MS) {
      console.log(`[hms-client] Proactive refresh: expires in ${(timeUntilExpiry / 60000).toFixed(0)} min`);
      const refreshResult = await refreshAndPersistUserToken(userId, token, user.hmsRefreshToken);
      if (refreshResult.success) {
        token = refreshResult.accessToken!;
        tokenRefreshed = true;
      }
    }
  }

  const result = await executeHmsCall<T>(token, path, options);
  tokenRefreshed = result.tokenRefreshed || tokenRefreshed;

  if (!result.success && result.errorCode === 'TOKEN_EXPIRED' && user.hmsRefreshToken) {
    console.log('[hms-client] 401 received, attempting refresh...');
    const refreshResult = await refreshAndPersistUserToken(userId, token, user.hmsRefreshToken);
    if (refreshResult.success) {
      const retryResult = await executeHmsCall<T>(refreshResult.accessToken!, path, options);
      if (retryResult.success) {
        retryResult.tokenRefreshed = true;
        return retryResult;
      }
    }
  }

  if (tokenRefreshed) result.tokenRefreshed = true;
  return result;
}

async function executeHmsCall<T>(
  token: string,
  path: string,
  options: {
    method?: string;
    body?: any;
    apiId?: string;
    params?: Record<string, any>;
  }
): Promise<HmsClientResult<T>> {
  try {
    const url = path.startsWith('http') ? path : `${HMS_BASE}${path}`;
    const headers = buildHmsHeaders(token);

    const fetchOptions: RequestInit = {
      method: options.method || (options.body || options.params || options.apiId ? 'POST' : 'GET'),
      headers,
      cache: 'no-store',
    };

    if (options.apiId) {
      fetchOptions.body = JSON.stringify({
        api_id: options.apiId,
        params: options.params || {},
      });
    } else if (options.body) {
      fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    } else if (options.params) {
      fetchOptions.body = JSON.stringify(options.params);
    }

    const res = await fetch(url, fetchOptions);

    if (res.status === 401) {
      return {
        success: false,
        status: 401,
        errorCode: 'TOKEN_EXPIRED',
        errorMessage: 'HMS token expired',
      };
    }

    if (res.status === 403) {
      return {
        success: false,
        status: 403,
        errorCode: 'TOKEN_INVALID',
        errorMessage: 'HMS token lacks permission',
      };
    }

    if (!res.ok) {
      const text = await res.text();
      return {
        success: false,
        status: res.status,
        errorCode: 'HMS_AUTH_FAILED',
        errorMessage: `HMS returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        success: false,
        status: res.status,
        errorCode: 'HMS_INVALID_RESPONSE',
        errorMessage: 'HMS returned non-JSON response',
      };
    }

    return { success: true, status: res.status, data: data as T };
  } catch (e: any) {
    return {
      success: false,
      status: 0,
      errorCode: 'HMS_DOWN',
      errorMessage: e.message || 'HMS unreachable',
    };
  }
}

function isExpired(entry: { expiresAt?: number }): boolean {
  if (!entry.expiresAt) return false;
  return Date.now() > entry.expiresAt;
}
