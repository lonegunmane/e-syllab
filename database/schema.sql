-- =============================================================================
-- E-SYLLAB — PostgreSQL Database Schema Definition
-- Matches createTables() in services/serverDatabase.ts
-- =============================================================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('STUDENT', 'TEACHER', 'ADMIN')),
  avatar TEXT,
  "blockchainId" TEXT,
  contact TEXT,
  school TEXT,
  gender TEXT,
  "residentialAddress" TEXT,
  "teachingGrades" TEXT,
  "teachingClasses" TEXT,
  "teachingSubjects" TEXT,
  grade TEXT,
  "className" TEXT,
  "enrolledSubjects" TEXT,
  "isProfileComplete" BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  "consentGivenAt" TEXT,
  "emailVerifiedAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 2. Auth Credentials Table
CREATE TABLE IF NOT EXISTS auth_credentials (
  "userId" TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  "passwordHash" TEXT NOT NULL,
  "lastLogin" TEXT,
  "passwordResetRequired" BOOLEAN DEFAULT FALSE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 3. Curriculum Resources Table
CREATE TABLE IF NOT EXISTS curriculum_resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  "gradeLevel" TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK(category IN ('DOCUMENT', 'ANNOUNCEMENT')),
  "authorRole" TEXT NOT NULL CHECK("authorRole" IN ('STUDENT', 'TEACHER', 'ADMIN')),
  "uploadedById" TEXT REFERENCES users(id) ON DELETE SET NULL,
  "uploadedByName" TEXT,
  "fileName" TEXT,
  "fileType" TEXT,
  "fileData" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 4. Messages Table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  "senderId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "senderName" TEXT NOT NULL,
  "recipientId" TEXT,
  "recipientName" TEXT,
  subject TEXT,
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  "createdAt" TEXT NOT NULL
);

-- 5. Academic Grades Table
CREATE TABLE IF NOT EXISTS grades (
  id TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "teacherId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  grade REAL NOT NULL,
  feedback TEXT,
  "recordedAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);

-- 6. Teacher Vault Documents Table
CREATE TABLE IF NOT EXISTS vault_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  "teacherId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "teacherName" TEXT NOT NULL,
  "fileName" TEXT,
  "fileType" TEXT,
  "fileData" TEXT,
  "createdAt" TEXT NOT NULL
);

-- 7. School Timetables Table
CREATE TABLE IF NOT EXISTS timetables (
  id TEXT PRIMARY KEY,
  "className" TEXT NOT NULL,
  "dayOfWeek" TEXT NOT NULL,
  period TEXT NOT NULL,
  subject TEXT NOT NULL,
  "teacherId" TEXT,
  room TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 8. Attendance Records Table
CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  "staffId" TEXT NOT NULL,
  "staffName" TEXT,
  date TEXT NOT NULL,
  time TEXT,
  "className" TEXT,
  status TEXT NOT NULL,
  "schoolId" TEXT,
  latitude REAL,
  longitude REAL,
  "locationFlagged" BOOLEAN DEFAULT FALSE,
  "distanceMeters" REAL,
  signature TEXT,
  "offlineHash" TEXT,
  "createdAt" TEXT NOT NULL
);

-- 9. School Configuration Table
CREATE TABLE IF NOT EXISTS school_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 10. Assessments Table
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  "className" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "maxScore" REAL NOT NULL,
  "createdAt" TEXT NOT NULL
);

-- 11. Assessment Scores Table
CREATE TABLE IF NOT EXISTS assessment_scores (
  id TEXT PRIMARY KEY,
  "assessmentId" TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  "studentId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  feedback TEXT,
  "createdAt" TEXT NOT NULL
);

-- 12. In-App Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  "relatedId" TEXT,
  read BOOLEAN DEFAULT FALSE,
  "createdAt" TEXT NOT NULL
);

-- 13. User Authentication Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT,
  "deviceInfo" TEXT NOT NULL,
  "ipAddress" TEXT NOT NULL,
  "loginAt" TEXT NOT NULL,
  "lastActiveAt" TEXT NOT NULL,
  revoked BOOLEAN DEFAULT FALSE
);

-- 14. Offline Attendance Sync Queue Table
CREATE TABLE IF NOT EXISTS attendance_sync_queue (
  id TEXT PRIMARY KEY,
  "staffId" TEXT NOT NULL,
  "staffName" TEXT,
  date TEXT NOT NULL,
  time TEXT,
  "className" TEXT,
  status TEXT NOT NULL,
  "schoolId" TEXT,
  latitude REAL,
  longitude REAL,
  "locationFlagged" BOOLEAN DEFAULT FALSE,
  "distanceMeters" REAL,
  "offlineHash" TEXT,
  "localTimestamp" TEXT,
  "queuedAt" TEXT,
  "createdAt" TEXT NOT NULL
);

-- 15. One-Time Passwords (OTP) Table & Index
CREATE TABLE IF NOT EXISTS auth_otps (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code TEXT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  attempts INTEGER DEFAULT 0,
  "maxAttempts" INTEGER DEFAULT 5,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_otps_email_purpose ON auth_otps(email, purpose);

-- 16. Academic Ledger (Solana Devnet Memo & Cryptographic Ledger) Table & Indexes
CREATE TABLE IF NOT EXISTS academic_ledger (
  hash TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  signature TEXT,
  slot BIGINT,
  payload JSONB NOT NULL,
  "confirmedOnChain" BOOLEAN DEFAULT FALSE,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_academic_ledger_type ON academic_ledger(type);
CREATE INDEX IF NOT EXISTS idx_academic_ledger_created_at ON academic_ledger("createdAt" DESC);

-- 17. Invited Users Table & Index (Admin-invited Faculty & Staff)
CREATE TABLE IF NOT EXISTS invited_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('TEACHER', 'ADMIN')),
  "invitedBy" TEXT,
  "createdAt" TEXT NOT NULL,
  "acceptedAt" TEXT
);
CREATE INDEX IF NOT EXISTS idx_invited_users_email ON invited_users(LOWER(email));

-- 18. Auth Email Rate Limits Table
CREATE TABLE IF NOT EXISTS auth_email_rate_limits (
  email TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  "windowStart" BIGINT NOT NULL
);

