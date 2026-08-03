import { UserRole } from '../types';

const API_BASE_URL = "/api";

// ─── Token Management ─────────────────────────────────────────────────────────
const TOKEN_KEY = 'esylab_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function ensureSessionToken(userParam?: any): Promise<string | null> {
  let token = getToken();
  if (token) return token;

  let savedUser = userParam;
  if (!savedUser) {
    const savedUserStr = localStorage.getItem('esylab_session') || localStorage.getItem('user');
    if (savedUserStr) {
      try { savedUser = JSON.parse(savedUserStr); } catch {}
    }
  }

  if (!savedUser) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/token/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: savedUser })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        return data.token;
      }
    }
  } catch (err) {
    console.error("[Auth] Failed to acquire session token:", err);
  }
  return null;
}

// ─── Helper to build Authorization header ──────────────────────────────────────
function getAuthHeaders(includeContentType = true): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let token = getToken();
  if (!token) {
    token = await ensureSessionToken();
  }

  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  let response = await fetch(url, { ...options, headers });

  // If 401 Unauthorized, try auto-refreshing token from active session and retrying once
  if (response.status === 401) {
    clearToken();
    const newToken = await ensureSessionToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(url, { ...options, headers });
    }
  }

  return response;
}

// ─── Authentication APIs ─────────────────────────────────────────────────────
export async function register(userData: { name: string; email: string; avatar?: string; role?: UserRole }, password: string) {
  const response = await fetch(`${API_BASE_URL}/register`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...userData, password })
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Registration failed");
  }

  const data = await response.json();

  if (data.token) {
    setToken(data.token);
  }

  return data;
}

export async function createUserByAdmin(userData: { name: string; email: string; role: UserRole; avatar?: string }, password: string) {
  const response = await authFetch(`${API_BASE_URL}/admin/create-user`, {
    method: "POST",
    body: JSON.stringify({ ...userData, password })
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "User creation failed");
  }

  return await response.json();
}

export async function login(email: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/login`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Login failed");
  }

  const data = await response.json();
  
  // Store the JWT token
  if (data.token) {
    setToken(data.token);
  }
  
  return data;
}

export async function logout() {
  const response = await fetch(`${API_BASE_URL}/logout`, {
    method: "POST",
    headers: getAuthHeaders()
  });

  if (!response.ok) {
    throw new Error("Logout failed");
  }

  // Clear the token from localStorage
  clearToken();
  
  return response.json();
}

// ─── Profile APIs ──────────────────────────────────────────────────────────────
export async function getProfile() {
  const response = await fetch(`${API_BASE_URL}/profile`, {
    method: "GET",
    headers: getAuthHeaders(false)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    throw new Error("Failed to load profile");
  }

  return response.json();
}

export async function updateProfile(updates: Record<string, any>) {
  const response = await fetch(`${API_BASE_URL}/profile`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(updates)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    const data = await response.json();
    throw new Error(data.error || "Failed to update profile");
  }

  return response.json();
}

export async function resetPassword(newPassword: string) {
  const response = await fetch(`${API_BASE_URL}/reset-password`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ newPassword })
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    const data = await response.json();
    throw new Error(data.error || "Failed to reset password");
  }

  return response.json();
}

// ─── Blockchain APIs (all require authentication) ─────────────────────────────
export async function getBlockchainStatus() {
  const response = await fetch(`${API_BASE_URL}/blockchain/status`, {
    method: "GET",
    headers: getAuthHeaders(false)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    throw new Error("Failed to get blockchain status");
  }

  return response.json();
}

export async function getBlockchainBlockhash() {
  const response = await fetch(`${API_BASE_URL}/blockchain/blockhash`, {
    method: "GET",
    headers: getAuthHeaders(false)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    throw new Error("Failed to get blockhash");
  }

  return response.json();
}

export async function getBlockchainBalance(pubkey: string) {
  const response = await fetch(`${API_BASE_URL}/blockchain/balance?pubkey=${encodeURIComponent(pubkey)}`, {
    method: "GET",
    headers: getAuthHeaders(false)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    throw new Error("Failed to get balance");
  }

  return response.json();
}

export async function recordAttendanceOnline(data: Record<string, any>) {
  const response = await authFetch(`${API_BASE_URL}/blockchain/attendance/record`, {
    method: "POST",
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const errData = await response.json();
    throw new Error(errData.error || "Failed to record attendance");
  }

  return response.json();
}

export async function prepareAttendanceTransaction(data: Record<string, any>) {
  const response = await fetch(`${API_BASE_URL}/blockchain/attendance/prepare`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Failed to prepare transaction");
  }

  return response.json();
}

export async function confirmAttendanceTransaction(data: Record<string, any>) {
  const response = await fetch(`${API_BASE_URL}/blockchain/attendance/confirm`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Failed to confirm transaction");
  }

  return response.json();
}

export async function queueAttendanceRecord(data: Record<string, any>) {
  const response = await fetch(`${API_BASE_URL}/blockchain/attendance/queue`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Failed to queue attendance");
  }

  return response.json();
}

export async function getAttendanceQueue() {
  const response = await fetch(`${API_BASE_URL}/blockchain/attendance/queue`, {
    method: "GET",
    headers: getAuthHeaders(false)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    throw new Error("Failed to get attendance queue");
  }

  return response.json();
}

export async function removeFromAttendanceQueue(queueId: string) {
  const response = await fetch(`${API_BASE_URL}/blockchain/attendance/queue/${encodeURIComponent(queueId)}`, {
    method: "DELETE",
    headers: getAuthHeaders(false)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Failed to remove from queue");
  }

  return response.json();
}

export async function syncAllAttendance() {
  const response = await fetch(`${API_BASE_URL}/blockchain/attendance/sync-all`, {
    method: "POST",
    headers: getAuthHeaders()
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Failed to sync attendance");
  }

  return response.json();
}

export async function verifyAttendanceHash(data: Record<string, any>) {
  const response = await fetch(`${API_BASE_URL}/blockchain/attendance/verify-hash`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Session expired. Please login again.");
    }
    const data = await response.json();
    throw new Error(data.error || "Failed to verify hash");
  }

  return response.json();
}

// ─── Timetable API Methods ──────────────────────────────────────────────────
export async function getTimetables(className?: string) {
  const url = className
    ? `${API_BASE_URL}/timetables?className=${encodeURIComponent(className)}`
    : `${API_BASE_URL}/timetables`;
  
  const response = await authFetch(url);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch timetables");
  }
  return response.json();
}

export async function createTimetable(timetableData: {
  className: string;
  dayOfWeek: string;
  period: string;
  subject: string;
  teacherId?: string;
  room?: string;
}) {
  const response = await authFetch(`${API_BASE_URL}/timetables`, {
    method: "POST",
    body: JSON.stringify(timetableData),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to create timetable entry");
  }
  return response.json();
}

export async function updateTimetable(id: string, updates: Partial<{
  className: string;
  dayOfWeek: string;
  period: string;
  subject: string;
  teacherId?: string;
  room?: string;
}>) {
  const response = await authFetch(`${API_BASE_URL}/timetables/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to update timetable entry");
  }
  return response.json();
}

export async function deleteTimetable(id: string) {
  const response = await authFetch(`${API_BASE_URL}/timetables/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete timetable entry");
  }
  return response.json();
}

export async function getStaffPerformance() {
  const response = await authFetch(`${API_BASE_URL}/admin/staff-performance`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch staff performance metrics");
  }
  return response.json();
}


