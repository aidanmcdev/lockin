/* eslint-disable @typescript-eslint/no-explicit-any */
const STORAGE_KEY = "lockin-auth"

export interface AuthUser {
  id: string
  name: string
  email: string
}

interface AuthData {
  token: string
  user: AuthUser
}

function chromeLocal(): any | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const g = globalThis as any
  return g.chrome?.storage?.local ?? null
}

export async function getAuth(): Promise<AuthData | null> {
  try {
    const store = chromeLocal()
    if (store) {
      const result = await store.get(STORAGE_KEY)
      return (result[STORAGE_KEY] as AuthData) ?? null
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function setAuth(token: string, user: AuthUser): Promise<void> {
  const data: AuthData = { token, user }
  const store = chromeLocal()
  if (store) {
    await store.set({ [STORAGE_KEY]: data })
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

export async function clearAuth(): Promise<void> {
  const store = chromeLocal()
  if (store) {
    await store.remove(STORAGE_KEY)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}
