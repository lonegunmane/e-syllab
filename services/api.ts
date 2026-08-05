import { UserRole, GradeRecord, Message, CurriculumResource, VaultDocument, DocumentStatus, ResourceCategory } from '../types';

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
  } catch (err: any) {
    console.warn("[Auth] Unable to reach session token endpoint:", err?.message || err);
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
export async function sendTwoFactorOtp(email: string, purpose: 'LOGIN' | 'REGISTER') {
  const response = await fetch(`${API_BASE_URL}/auth/2fa/send-otp`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ email, purpose })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not send verification code, please try again.");
  }

  return data;
}

export async function register(
  userData: { name: string; email: string; avatar?: string; role?: UserRole }, 
  password: string, 
  twoFactorCode?: string
) {
  const response = await fetch(`${API_BASE_URL}/register`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...userData, password, twoFactorCode })
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Could not create account, please try again.");
  }

  const data = await response.json();

  if (data.token) {
    setToken(data.token);
  }

  return data;
}

export async function createUserByAdmin(
  userData: { name: string; email: string; role: UserRole; avatar?: string }, 
  password: string,
  twoFactorCode?: string
) {
  const response = await authFetch(`${API_BASE_URL}/admin/create-user`, {
    method: "POST",
    body: JSON.stringify({ ...userData, password, twoFactorCode })
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Could not create user account, please try again.");
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
    throw new Error(data.error || "That username or password doesn’t look right");
  }

  const data = await response.json();
  
  // If token returned directly (e.g. bypass or 2FA pre-cleared)
  if (data.token) {
    setToken(data.token);
  }
  
  return data;
}

export async function verifyLoginTwoFactor(email: string, twoFactorCode: string) {
  const response = await fetch(`${API_BASE_URL}/login/verify-2fa`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ email, twoFactorCode })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "That security code isn't right, please try again.");
  }

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
    throw new Error("Could not sign out, please try again.");
  }

  // Clear the token from localStorage
  clearToken();
  
  return response.json();
}

// ─── Profile APIs ──────────────────────────────────────────────────────────────
export async function getProfile() {
  try {
    const response = await fetch(`${API_BASE_URL}/profile`, {
      method: "GET",
      headers: getAuthHeaders(false)
    });

    if (!response.ok) {
      if (response.status === 401) {
        clearToken();
        return { success: false, error: "Your login has ended, please sign in again" };
      }
      return { success: false, error: "Could not load profile" };
    }

    return response.json();
  } catch (err: any) {
    return { success: false, error: err?.message || "Something went wrong, please try again" };
  }
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
      throw new Error("Your login has ended, please sign in again.");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not update profile, please try again.");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not update password, please try again.");
  }

  return response.json();
}

// ─── Sessions & Device Management ─────────────────────────────────────────────
export async function getSessions() {
  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: "GET",
    headers: getAuthHeaders(false)
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Your login has ended, please sign in again.");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not fetch connected devices.");
  }

  return response.json();
}

export async function revokeSession(sessionId: string) {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/revoke`, {
    method: "POST",
    headers: getAuthHeaders()
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Your login has ended, please sign in again.");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not log out device.");
  }

  return response.json();
}

// ─── Account Deletion ─────────────────────────────────────────────────────────
export async function deleteAccount(password: string) {
  const response = await fetch(`${API_BASE_URL}/users/me`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify({ password })
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      throw new Error("Your login has ended, please sign in again.");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not delete account.");
  }

  // Clear local session storage
  clearToken();

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
      throw new Error("Your login has ended, please sign in again.");
    }
    throw new Error("Could not check secure sync status");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    throw new Error("Could not connect to secure network");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    throw new Error("Could not check balance");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const errData = await response.json();
    throw new Error(errData.error || "Could not record attendance, please try again.");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not prepare attendance record");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not confirm attendance record");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not save attendance for later");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    throw new Error("Could not load pending attendance");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not remove pending record");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    if (response.status === 403) {
      throw new Error("You don't have permission to perform this action");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not sync attendance records");
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
      throw new Error("Your login has ended, please sign in again.");
    }
    const data = await response.json();
    throw new Error(data.error || "Could not verify attendance record");
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

// ─── Blockchain Ledger Methods ──────────────────────────────────────────────
export async function getAllLedgerRecords() {
  const response = await authFetch(`${API_BASE_URL}/blockchain/ledger/all`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch ledger transactions");
  }
  return response.json();
}

export async function verifyLedgerRecord(offlineHash: string) {
  const response = await authFetch(`${API_BASE_URL}/blockchain/ledger/verify`, {
    method: "POST",
    body: JSON.stringify({ offlineHash }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to verify ledger record");
  }
  return response.json();
}

// ─── Notification API Methods ──────────────────────────────────────────────
export async function getSystemNotifications() {
  const response = await authFetch(`${API_BASE_URL}/notifications`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch notifications");
  }
  return response.json();
}

export async function markSystemNotificationRead(id: string) {
  const response = await authFetch(`${API_BASE_URL}/notifications/${encodeURIComponent(id)}/read`, {
    method: "POST",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to mark notification as read");
  }
  return response.json();
}

export async function createSystemNotification(data: {
  recipientId?: string;
  className?: string;
  type: 'deadline' | 'meeting' | 'misconduct' | 'general' | string;
  title: string;
  message: string;
  relatedId?: string;
}) {
  const response = await authFetch(`${API_BASE_URL}/notifications`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to create notification");
  }
  return response.json();
}

// ─── Academic Grades API Methods ─────────────────────────────────────────────
export async function getGrades(): Promise<{ success: boolean; count: number; grades: GradeRecord[] }> {
  const response = await authFetch(`${API_BASE_URL}/grades`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch grades");
  }
  return response.json();
}

export async function recordGrade(gradeData: {
  studentId: string;
  subject: string;
  score?: number;
  grade?: string;
  feedback?: string;
  comment?: string;
  recordedAt?: string;
}): Promise<{ success: boolean; grade: GradeRecord; message?: string }> {
  const response = await authFetch(`${API_BASE_URL}/grades`, {
    method: "POST",
    body: JSON.stringify(gradeData),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to record grade");
  }
  return response.json();
}

// ─── Messaging API Methods ───────────────────────────────────────────────────
export async function getMessages(): Promise<{ success: boolean; count: number; messages: Message[] }> {
  const response = await authFetch(`${API_BASE_URL}/messages`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch messages");
  }
  return response.json();
}

export async function sendMessage(messageData: {
  recipientId?: string;
  recipientName?: string;
  subject?: string;
  content: string;
  file?: { name: string; type: string; data: string; size: number };
}): Promise<{ success: boolean; message: Message }> {
  const response = await authFetch(`${API_BASE_URL}/messages`, {
    method: "POST",
    body: JSON.stringify(messageData),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to send message");
  }
  return response.json();
}

export async function clearMessages(): Promise<{ success: boolean; message?: string }> {
  const response = await authFetch(`${API_BASE_URL}/messages`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to clear messages");
  }
  return response.json();
}

// ─── Curriculum API Methods ──────────────────────────────────────────────────
export async function getCurriculum(): Promise<{ success: boolean; count: number; curriculum: CurriculumResource[] }> {
  const response = await authFetch(`${API_BASE_URL}/curriculum`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch curriculum");
  }
  return response.json();
}

export async function addCurriculum(resourceData: {
  title: string;
  subject: string;
  gradeLevel: string;
  description?: string;
  category: ResourceCategory;
  fileName?: string;
  fileType?: string;
  fileData?: string;
}): Promise<{ success: boolean; resource: CurriculumResource }> {
  const response = await authFetch(`${API_BASE_URL}/curriculum`, {
    method: "POST",
    body: JSON.stringify(resourceData),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to add curriculum material");
  }
  return response.json();
}

export async function deleteCurriculum(id: string): Promise<{ success: boolean; message?: string }> {
  const response = await authFetch(`${API_BASE_URL}/curriculum/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete curriculum material");
  }
  return response.json();
}

// ─── Vault Documents API Methods ─────────────────────────────────────────────
export async function getVaultDocuments(): Promise<{ success: boolean; count: number; documents: VaultDocument[] }> {
  const response = await authFetch(`${API_BASE_URL}/vault`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch vault documents");
  }
  return response.json();
}

export async function addVaultDocument(docData: {
  title: string;
  type: string;
  fileName?: string;
  fileType?: string;
  fileData?: string;
}): Promise<{ success: boolean; document: VaultDocument }> {
  const response = await authFetch(`${API_BASE_URL}/vault`, {
    method: "POST",
    body: JSON.stringify(docData),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to submit document to vault");
  }
  return response.json();
}

export async function approveVaultDocument(id: string): Promise<{ success: boolean; document: VaultDocument }> {
  const response = await authFetch(`${API_BASE_URL}/vault/${encodeURIComponent(id)}/approve`, {
    method: "PUT",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to approve vault document");
  }
  return response.json();
}

export async function rejectVaultDocument(id: string): Promise<{ success: boolean; document: VaultDocument }> {
  const response = await authFetch(`${API_BASE_URL}/vault/${encodeURIComponent(id)}/reject`, {
    method: "PUT",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to reject vault document");
  }
  return response.json();
}

export async function updateVaultDocumentStatus(id: string, status: DocumentStatus): Promise<{ success: boolean; document: VaultDocument }> {
  const response = await authFetch(`${API_BASE_URL}/vault/${encodeURIComponent(id)}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to update vault document status");
  }
  return response.json();
}


