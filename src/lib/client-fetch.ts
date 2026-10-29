/**
 * Dashboard data fetch with a short retry window.
 *
 * The GTL Bridge extension pushes the HMS token on page load, which can land a
 * few hundred milliseconds after the first data request. While the token is
 * still missing the API answers 401/403, so retry briefly instead of waiting
 * for the next poll interval (30-60s) to show real numbers.
 */
export async function fetchDashboardJson<T = unknown>(
  url: string,
  retries = 4,
  delayMs = 2500
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 401 && res.status !== 403) return null;
    } catch {
      // network hiccup, retry below
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}
