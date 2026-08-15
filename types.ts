export enum UserRole {
  STUDENT = 'STUDENT',
  TEACHER = 'TEACHER',
  ADMIN = 'ADMIN'
}

export enum ResourceCategory {
  DOCUMENT = 'DOCUMENT',
  ANNOUNCEMENT = 'ANNOUNCEMENT'
}

export enum DocumentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  email: string;
  avatar: string;
  blockchainId?: string;
  contact?: string;
  school?: string;
  gender?: 'Male' | 'Female' | string;
  residentialAddress?: string;
  consentGivenAt?: string;
  // Teacher specific fields
  teachingGrades?: string[];
  teachingClasses?: string[];
  teachingSubjects?: string[];
  isProfileComplete?: boolean;
  // Student specific fields
  grade?: string;
  gradeLevel?: string;
  className?: string;
  enrolledSubjects?: string[];
  lastViewedCurriculumAt?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CurriculumResource {
  id: string;
  title: string;
  subject: string;
  gradeLevel: string;
  description: string;
  category: ResourceCategory;
  authorRole: UserRole;
  uploadedById?: string;
  uploadedByName?: string;
  createdAt: string;
  fileName?: string;
  fileType?: string;
  fileData?: string;
}

export interface Lesson {
  id: string;
  title: string;
  subject: string;
  content: string;
  authorId: string;
  isOffline: boolean;
  blockchainHash?: string;
}

export interface Assignment {
  id: string;
  title: string;
  subject: string;
  gradeLevel: string;
  description: string;
  dueDate: string; // ISO string e.g. "2026-08-05T18:00:00.000Z"
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdById?: string;
  createdByName?: string;
  createdAt: string;
  status?: 'pending' | 'submitted' | 'graded';
  lessonId?: string;
  grade?: number;
}

export interface LocalNotification {
  id: string;
  userId?: string;
  title: string;
  body: string;
  type: 'ASSIGNMENT_DUE' | 'ASSIGNMENT_NEW' | 'OVERDUE_ALERT' | 'SYSTEM_ALERT';
  relatedId?: string;
  dueDate?: string;
  timestamp: string;
  read: boolean;
  priority?: 'normal' | 'high' | 'urgent';
}

export interface ApprovalRequest {
  id: string;
  teacherId: string;
  type: 'leave' | 'resource' | 'permission';
  status: 'pending' | 'approved' | 'rejected';
  description: string;
  timestamp: string;
}

export interface SyncStatus {
  isOnline: boolean;
  pendingChanges: number;
}

export interface VaultDocument {
  id: string;
  title: string;
  type: 'Scheme of Work' | 'Record of Work' | string;
  status: DocumentStatus;
  teacherId: string;
  teacherName: string;
  createdAt: string;
  fileName?: string;
  fileType?: string;
  fileData?: string;
  hash?: string;
}

export interface AuthCredential {
  userId: string;
  email: string;
  passwordHash: string;
  passwordResetRequired?: boolean;
  lastLogin?: string | null;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string; // 'ALL_ADMINS' or specific ID
  recipientName?: string;
  subject?: string;
  content: string;
  timestamp?: string;
  createdAt?: string;
  read?: boolean;
  file?: {
    name: string;
    type: string;
    data: string; // base64
    size: number;
  };
}

export interface GradeRecord {
  id: string;
  studentId: string;
  studentName?: string;
  teacherId: string;
  subject: string;
  score?: number;
  grade: string;
  comment?: string;
  feedback?: string;
  recordedAt?: string;
  createdAt?: string;
  timestamp?: string;
}

export interface TimetableEntry {
  id: string;
  className: string;
  dayOfWeek: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | string;
  period: string; // e.g. "Period 1 (08:00 - 08:45)"
  subject: string;
  teacherId?: string;
  teacherName?: string;
  room?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Assessment {
  id: string;
  title: string;
  subject: string;
  className: string;
  teacherId: string;
  maxScore: number;
  createdAt: string;
}

export interface AssessmentScore {
  id: string;
  assessmentId: string;
  studentId: string;
  score: number;
  feedback?: string;
  createdAt: string;
  studentName?: string;
  offlineHash?: string;
  signature?: string;
  explorerUrl?: string;
  assessment?: Assessment;
}

export interface SystemNotification {
  id: string;
  userId: string;
  type: 'deadline' | 'meeting' | 'misconduct' | 'general';
  title: string;
  message: string;
  relatedId?: string;
  read: boolean;
  createdAt: string;
}

export interface UserSession {
  id: string;
  userId: string;
  deviceInfo: string;
  ipAddress: string;
  loginAt: string;
  lastActiveAt: string;
  isCurrent?: boolean;
}

export interface SchoolLocationConfig {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface AttendanceRecordItem {
  id: string;
  staffId: string;
  staffName?: string;
  date: string;
  time?: string;
  className?: string;
  status: string;
  schoolId?: string;
  latitude?: number | null;
  longitude?: number | null;
  locationFlagged: boolean;
  distanceMeters?: number | null;
  offlineHash?: string;
  signature?: string;
  txSignature?: string;
  explorerUrl?: string;
  createdAt: string;
}


