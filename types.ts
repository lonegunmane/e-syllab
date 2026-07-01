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
  gender?: 'Male' | 'Female' | 'Other' | 'Prefer not to say';
  residentialAddress?: string;
  // Teacher specific fields
  teachingGrades?: string[];
  teachingClasses?: string[];
  teachingSubjects?: string[];
  isProfileComplete?: boolean;
  // Student specific fields
  grade?: string;
  className?: string;
  enrolledSubjects?: string[];
  lastViewedCurriculumAt?: string;
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
  lessonId: string;
  title: string;
  dueDate: string;
  status: 'pending' | 'submitted' | 'graded';
  grade?: number;
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

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string; // 'ALL_ADMINS' or specific ID
  content: string;
  timestamp: string;
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
  studentName: string;
  teacherId: string;
  subject: string;
  score: number;
  grade: string;
  comment: string;
  timestamp: string;
}
