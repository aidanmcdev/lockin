const API_URL = "/api";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("focusup_token");
}

export function setToken(token: string) {
  localStorage.setItem("focusup_token", token);
}

export function removeToken() {
  localStorage.removeItem("focusup_token");
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Login failed");
  setToken(data.token);
  return data;
}

export async function signup(name: string, email: string, password: string) {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Registration failed");
  setToken(data.token);
  return data;
}

export async function fetchWithAuth(
  endpoint: string,
  options?: { method?: string; body?: unknown }
) {
  const token = getToken();
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    removeToken();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  return res.json();
}
