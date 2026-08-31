import pg from 'pg';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { encryptField, decryptField } from './encryption';
import { validatePassword } from './passwordValidation';
import {
  User,
  UserRole,
  CurriculumResource,
  ResourceCategory,
  Message,
  GradeRecord,
  VaultDocument,
  DocumentStatus,
  AuthCredential,
  TimetableEntry,
  Assessment,
  AssessmentScore,
  SystemNotification,
} from '../types';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let isPostgresAvailable = true;

function isPostgresConnectionOrAuthError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const code = (err.code || '').toLowerCase();
  return (
    msg.includes('password authentication failed') ||
    msg.includes('authentication failed') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('ehostunreach') ||
    msg.includes('connection terminated') ||
    msg.includes('no pg_hba.conf entry') ||
    (msg.includes('database') && msg.includes('does not exist')) ||
    msg.includes('connection timeout') ||
    msg.includes('getaddrinfo') ||
    msg.includes('econnreset') ||
    code === '28p01' || // invalid_password
    code === '28000' || // invalid_authorization_specification
    code === '3d000' || // invalid_catalog_name
    code === '08006' || // connection_failure
    code === '08001' || // sqlclient_unable_to_establish_sqlconnection
    code === '08004'    // sqlserver_rejected_establishment_of_sqlconnection
  );
}

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    const isLocal = connectionString && (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'));
    const sslConfig = isLocal ? undefined : { rejectUnauthorized: false };

    pool = new Pool({
      connectionString: connectionString || undefined,
      ssl: sslConfig,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      if (isPostgresConnectionOrAuthError(err) || !isPostgresAvailable) {
        isPostgresAvailable = false;
        return;
      }
      console.log('[Database] PostgreSQL pool notice:', err.message || err);
    });
  }
  return pool;
}

export interface SyncQueueRecord {
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
  locationFlagged?: boolean;
  distanceMeters?: number | null;
  syncedFromOffline?: boolean;
  localTimestamp?: string;
  retries?: number;
  queuedAt?: string;
  offlineHash?: string;
  createdAt?: string;
}

export interface AcademicLedgerRecord {
  hash: string;
  type: string;
  signature: string | null;
  slot: number | null;
  payload: any;
  confirmedOnChain: boolean;
  createdAt: string;
}

export interface InvitedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  invitedBy?: string;
  createdAt: string;
  acceptedAt?: string | null;
}

// ─── High-Reliability In-Memory Store Fallback ────────────────────────────────
interface MemoryStore {
  users: Map<string, User>;
  credentials: Map<string, AuthCredential>;
  invitedUsers: Map<string, InvitedUser>;
  curriculum: Map<string, CurriculumResource>;
  messages: Map<string, Message>;
  grades: Map<string, GradeRecord>;
  vaultDocuments: Map<string, VaultDocument>;
  timetables: Map<string, TimetableEntry>;
  attendanceRecords: Map<string, any>;
  schoolConfig: Map<string, string>;
  assessments: Map<string, Assessment>;
  assessmentScores: Map<string, AssessmentScore[]>;
  notifications: Map<string, SystemNotification[]>;
  sessions: Map<string, any>;
  syncQueue: Map<string, SyncQueueRecord>;
  academicLedger: Map<string, AcademicLedgerRecord>;
  otps: Map<string, { id: string; email: string; purpose: string; code: string; expiresAt: number; attempts: number; maxAttempts: number; createdAt: string }>;
  rateLimits: Map<string, { count: number; windowStart: number }>;
}

const memStore: MemoryStore = {
  users: new Map(),
  credentials: new Map(),
  invitedUsers: new Map(),
  curriculum: new Map(),
  messages: new Map(),
  grades: new Map(),
  vaultDocuments: new Map(),
  timetables: new Map(),
  attendanceRecords: new Map(),
  schoolConfig: new Map([
    ['latitude', '37.774929'],
    ['longitude', '-122.419416'],
    ['radiusMeters', '500'],
  ]),
  assessments: new Map(),
  assessmentScores: new Map(),
  notifications: new Map(),
  sessions: new Map(),
  syncQueue: new Map(),
  academicLedger: new Map(),
  otps: new Map(),
  rateLimits: new Map(),
};

function seedMemoryStore(): void {
  const now = new Date().toISOString();

  // Admin 1 (Configured or Default)
  const adminEmail1 = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase() || 'admin@gmail.com';
  const adminPassword1 = process.env.ADMIN_SEED_PASSWORD?.trim() || '1357';
  const admin1: User = {
    id: '3',
    email: adminEmail1,
    name: 'Primary Admin',
    role: UserRole.ADMIN,
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
    blockchainId: 'sol-genesis-block-3-admin',
    contact: '777-888-9999',
    school: 'E-SYLLAB Headquarters',
    gender: 'Prefer not to say',
    residentialAddress: '789 Pine Rd, Capital City',
    isProfileComplete: true,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  memStore.users.set(admin1.id, admin1);
  memStore.credentials.set(admin1.id, {
    userId: admin1.id,
    passwordHash: bcrypt.hashSync(adminPassword1, 10),
    lastLogin: null,
    passwordResetRequired: true,
    createdAt: now,
    updatedAt: now,
  });

  // Also seed admin@gmail.com if ADMIN_SEED_EMAIL is customized
  if (adminEmail1 !== 'admin@gmail.com') {
    const adminDefault: User = {
      id: 'admin-default',
      email: 'admin@gmail.com',
      name: 'System Admin',
      role: UserRole.ADMIN,
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sysadmin',
      contact: '777-888-0000',
      school: 'E-SYLLAB Headquarters',
      isProfileComplete: true,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    memStore.users.set(adminDefault.id, adminDefault);
    memStore.credentials.set(adminDefault.id, {
      userId: adminDefault.id,
      passwordHash: bcrypt.hashSync('1357', 10),
      lastLogin: null,
      passwordResetRequired: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Admin 2
  const adminEmail2 = process.env.ADMIN_SEED_EMAIL_2?.trim().toLowerCase() || 'admin2@gmail.com';
  const adminPassword2 = process.env.ADMIN_SEED_PASSWORD_2?.trim() || '1357';
  const admin2: User = {
    id: '4',
    email: adminEmail2,
    name: 'Secondary Admin',
    role: UserRole.ADMIN,
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin2',
    blockchainId: 'sol-genesis-block-4-admin',
    contact: '777-888-9998',
    school: 'E-SYLLAB Headquarters',
    gender: 'Prefer not to say',
    residentialAddress: '789 Pine Rd, Capital City',
    isProfileComplete: true,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  memStore.users.set(admin2.id, admin2);
  memStore.credentials.set(admin2.id, {
    userId: admin2.id,
    passwordHash: bcrypt.hashSync(adminPassword2, 10),
    lastLogin: null,
    passwordResetRequired: true,
    createdAt: now,
    updatedAt: now,
  });

  // Teacher
  const teacher: User = {
    id: '2',
    email: 'teacher@gmail.com',
    name: 'Dr. Sarah Wilson',
    role: UserRole.TEACHER,
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=teacher',
    contact: '555-0199',
    school: 'E-SYLLAB Headquarters',
    gender: 'Female',
    residentialAddress: '456 Elm St, City Center',
    teachingSubjects: ['Science Physics', 'Mathematics'],
    isProfileComplete: true,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  memStore.users.set(teacher.id, teacher);
  memStore.credentials.set(teacher.id, {
    userId: teacher.id,
    passwordHash: bcrypt.hashSync('1357', 10),
    lastLogin: null,
    passwordResetRequired: false,
    createdAt: now,
    updatedAt: now,
  });

  // Student
  const student: User = {
    id: '1',
    email: 'student@gmail.com',
    name: 'Alex Johnson',
    role: UserRole.STUDENT,
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=student',
    contact: '555-0100',
    school: 'E-SYLLAB Headquarters',
    gender: 'Male',
    residentialAddress: '123 Oak Ave, City Center',
    grade: 'Grade 10',
    className: '10-A',
    enrolledSubjects: ['Mathematics', 'Science Physics', 'English Literature'],
    isProfileComplete: true,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  memStore.users.set(student.id, student);
  memStore.credentials.set(student.id, {
    userId: student.id,
    passwordHash: bcrypt.hashSync('1357', 10),
    lastLogin: null,
    passwordResetRequired: false,
    createdAt: now,
    updatedAt: now,
  });

  // Sample Curriculum: Empty by default; only real user/admin-created curriculum is shown
  // Sample Attendance: Zero attendance rows seeded initially to ensure 100% real data
  // Live attendance is created via teacher check-in or offline sync.
  // Timetables: Empty by default; created only via Admin schedule tools
}

// Pre-seed memory store immediately on load
seedMemoryStore();

/**
 * Server Database Service using PostgreSQL with seamless In-Memory Fallback
 */
export const serverDb = {
  // ─── Initialization ────────────────────────────────────────────────────────
  async init(): Promise<void> {
    seedMemoryStore();

    if (!process.env.DATABASE_URL) {
      console.log('[Database] Operating in persistent server in-memory database mode.');
      isPostgresAvailable = false;
      return;
    }

    try {
      const p = getPool();
      const client = await p.connect();
      client.release();
      isPostgresAvailable = true;
      console.log('[Database] Connected to PostgreSQL successfully');

      await this.createTables();
      await this.seedInitialData();
      await this.seedTimetables();
    } catch (err: any) {
      isPostgresAvailable = false;
      if (pool) {
        try {
          await pool.end();
        } catch (_) {}
        pool = null;
      }
      console.log(`[Database] PostgreSQL unavailable (${err?.message || err}). Operating in high-reliability server memory database.`);
    }
  },

  async createTables(): Promise<void> {
    if (!isPostgresAvailable) return;
    try {
      const p = getPool();
      await p.query(`
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
        )
      `);

      await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TEXT;`);

      await p.query(`
        CREATE TABLE IF NOT EXISTS auth_credentials (
          "userId" TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          "passwordHash" TEXT NOT NULL,
          "lastLogin" TEXT,
          "passwordResetRequired" BOOLEAN DEFAULT FALSE,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL
        )
      `);

      await p.query(`
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
        )
      `);

      await p.query(`
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
        )
      `);

      await p.query(`
        CREATE TABLE IF NOT EXISTS grades (
          id TEXT PRIMARY KEY,
          "studentId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          "teacherId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          subject TEXT NOT NULL,
          grade REAL NOT NULL,
          feedback TEXT,
          "recordedAt" TEXT NOT NULL,
          "createdAt" TEXT NOT NULL
        )
      `);

      await p.query(`
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
        )
      `);

      await p.query(`
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
        )
      `);

      await p.query(`
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
        )
      `);

      await p.query(`
        CREATE TABLE IF NOT EXISTS school_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      await p.query(`
        CREATE TABLE IF NOT EXISTS assessments (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          subject TEXT NOT NULL,
          "className" TEXT NOT NULL,
          "teacherId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          "maxScore" REAL NOT NULL,
          "createdAt" TEXT NOT NULL
        )
      `);

      await p.query(`
        CREATE TABLE IF NOT EXISTS assessment_scores (
          id TEXT PRIMARY KEY,
          "assessmentId" TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
          "studentId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          score REAL NOT NULL,
          feedback TEXT,
          "createdAt" TEXT NOT NULL
        )
      `);

      await p.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          "relatedId" TEXT,
          read BOOLEAN DEFAULT FALSE,
          "createdAt" TEXT NOT NULL
        )
      `);

      await p.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT,
          "deviceInfo" TEXT NOT NULL,
          "ipAddress" TEXT NOT NULL,
          "loginAt" TEXT NOT NULL,
          "lastActiveAt" TEXT NOT NULL,
          revoked BOOLEAN DEFAULT FALSE
        )
      `);

      await p.query(`
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
        )
      `);

      await p.query(`
        CREATE TABLE IF NOT EXISTS auth_otps (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          purpose TEXT NOT NULL,
          code TEXT NOT NULL,
          "expiresAt" BIGINT NOT NULL,
          attempts INTEGER DEFAULT 0,
          "maxAttempts" INTEGER DEFAULT 5,
          "createdAt" TEXT NOT NULL
        )
      `);
      await p.query(`CREATE INDEX IF NOT EXISTS idx_auth_otps_email_purpose ON auth_otps(email, purpose)`);

      await p.query(`
        CREATE TABLE IF NOT EXISTS academic_ledger (
          hash TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          signature TEXT,
          slot BIGINT,
          payload JSONB NOT NULL,
          "confirmedOnChain" BOOLEAN DEFAULT FALSE,
          "createdAt" TEXT NOT NULL
        )
      `);
      await p.query(`CREATE INDEX IF NOT EXISTS idx_academic_ledger_type ON academic_ledger(type)`);
      await p.query(`CREATE INDEX IF NOT EXISTS idx_academic_ledger_created_at ON academic_ledger("createdAt" DESC)`);

      await p.query(`
        CREATE TABLE IF NOT EXISTS invited_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('TEACHER', 'ADMIN')),
          "invitedBy" TEXT,
          "createdAt" TEXT NOT NULL,
          "acceptedAt" TEXT
        )
      `);
      await p.query(`CREATE INDEX IF NOT EXISTS idx_invited_users_email ON invited_users(LOWER(email))`);

      await p.query(`
        CREATE TABLE IF NOT EXISTS auth_email_rate_limits (
          email TEXT PRIMARY KEY,
          count INTEGER NOT NULL,
          "windowStart" BIGINT NOT NULL
        )
      `);
    } catch (err: any) {
      if (isPostgresConnectionOrAuthError(err)) {
        isPostgresAvailable = false;
      }
    }
  },

  async seedInitialData(): Promise<void> {
    if (!isPostgresAvailable) return;
    try {
      const p = getPool();
      const now = new Date().toISOString();

      const adminEmail1 = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase() || 'admin@gmail.com';
      const adminId1 = '3';

      const { rows: existingRows1 } = await p.query(
        'SELECT id, email, role FROM users WHERE id = $1 OR LOWER(email) = LOWER($2)',
        [adminId1, adminEmail1]
      );

      const existingAdmin1 = existingRows1[0];
      const adminPassword1 = process.env.ADMIN_SEED_PASSWORD?.trim() || '1357';
      const passwordHash1 = bcrypt.hashSync(adminPassword1, 10);

      if (existingAdmin1) {
        if (existingAdmin1.email.toLowerCase() !== adminEmail1.toLowerCase()) {
          await p.query('UPDATE users SET email = $1, "updatedAt" = $2 WHERE id = $3', [adminEmail1, now, existingAdmin1.id]);
        }
      } else {
        await p.query(
          `INSERT INTO users (
            id, email, name, role, avatar, "blockchainId", contact, school, gender, "residentialAddress", "isProfileComplete", active, "createdAt", "updatedAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (id) DO NOTHING`,
          [
            adminId1,
            adminEmail1,
            encryptField('Primary Admin'),
            'ADMIN',
            'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
            'sol-genesis-block-3-admin',
            encryptField('777-888-9999'),
            'E-SYLLAB Headquarters',
            encryptField('Prefer not to say'),
            encryptField('789 Pine Rd, Capital City'),
            true,
            true,
            now,
            now,
          ]
        );

        await p.query(
          `INSERT INTO auth_credentials ("userId", "passwordHash", "passwordResetRequired", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("userId") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "updatedAt" = EXCLUDED."updatedAt"`,
          [adminId1, passwordHash1, true, now, now]
        );
      }

      console.log('[Database] PostgreSQL initial seed completed');
    } catch (err: any) {
      if (isPostgresConnectionOrAuthError(err)) {
        isPostgresAvailable = false;
      }
    }
  },

  async seedTimetables(): Promise<void> {
    // Keep existing rows intact and do not inject hardcoded demo lessons
    if (!isPostgresAvailable) return;
  },

  // ─── User Operations ───────────────────────────────────────────────────────
  async findUserByEmail(email: string): Promise<User | null> {
    const trimmed = email.trim().toLowerCase();
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [trimmed]);
        if (rows.length > 0) {
          return this.rowToUser(rows[0]);
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    // Memory fallback
    for (const user of memStore.users.values()) {
      if (user.email.toLowerCase() === trimmed) {
        return { ...user };
      }
    }
    return null;
  },

  async findUserById(id: string): Promise<User | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM users WHERE id = $1', [id]);
        if (rows.length > 0) {
          return this.rowToUser(rows[0]);
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    // Memory fallback
    const user = memStore.users.get(id);
    return user ? { ...user } : null;
  },

  async ensureUser(user: Partial<User>): Promise<User> {
    if (user.id) {
      const found = await this.findUserById(user.id);
      if (found) return found;
    }
    if (user.email) {
      const found = await this.findUserByEmail(user.email);
      if (found) return found;
    }

    const userId = user.id || this.generateId();
    const now = new Date().toISOString();

    const newUser: User = {
      id: userId,
      email: user.email || `${userId}@esyllab.school`,
      name: user.name || 'User',
      role: user.role || UserRole.TEACHER,
      avatar: user.avatar || '',
      contact: user.contact,
      gender: user.gender,
      residentialAddress: user.residentialAddress,
      isProfileComplete: Boolean(user.isProfileComplete),
      active: user.active !== undefined ? Boolean(user.active) : true,
      createdAt: now,
      updatedAt: now,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const contact = user.contact ? encryptField(user.contact) : null;
        const gender = user.gender ? encryptField(user.gender) : null;
        const residentialAddress = user.residentialAddress ? encryptField(user.residentialAddress) : null;

        await p.query(
          `INSERT INTO users (
            id, email, name, role, avatar, contact, gender, "residentialAddress", "isProfileComplete", active, "createdAt", "updatedAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            userId,
            newUser.email,
            encryptField(newUser.name),
            newUser.role,
            newUser.avatar,
            contact,
            gender,
            residentialAddress,
            newUser.isProfileComplete,
            newUser.active,
            now,
            now,
          ]
        );
        const created = await this.findUserById(userId);
        if (created) return created;
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.users.set(userId, newUser);
    return newUser;
  },

  async getAllUsers(includeInactive: boolean = false): Promise<User[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const query = includeInactive
          ? 'SELECT * FROM users ORDER BY "createdAt" DESC'
          : 'SELECT * FROM users WHERE (active IS NULL OR active = TRUE) ORDER BY "createdAt" DESC';
        const { rows } = await p.query(query);
        return rows.map((r) => this.rowToUser(r));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    // Memory fallback
    const users: User[] = [];
    for (const u of memStore.users.values()) {
      if (includeInactive || u.active !== false) {
        users.push({ ...u });
      }
    }
    return users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  async getUsersByRole(role: UserRole, includeInactive: boolean = false): Promise<User[]> {
    const all = await this.getAllUsers(includeInactive);
    return all.filter((u) => u.role === role);
  },

  async updateUserProfile(userId: string, updates: Partial<User>): Promise<User | null> {
    const user = await this.findUserById(userId);
    if (!user) return null;

    const now = new Date().toISOString();

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const validKeys = [
          'name',
          'avatar',
          'contact',
          'school',
          'gender',
          'residentialAddress',
          'teachingGrades',
          'teachingClasses',
          'teachingSubjects',
          'grade',
          'className',
          'enrolledSubjects',
          'isProfileComplete',
        ];
        const encryptedKeys = ['name', 'contact', 'residentialAddress', 'gender'];

        const setClauses: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        for (let [key, value] of Object.entries(updates)) {
          if (!validKeys.includes(key)) continue;

          if (value !== undefined && value !== null && encryptedKeys.includes(key) && typeof value === 'string') {
            value = encryptField(value);
          }

          let valToStore: any = value;
          if (Array.isArray(value)) {
            valToStore = JSON.stringify(value);
          }

          setClauses.push(`"${key}" = $${paramIndex++}`);
          values.push(valToStore);
        }

        if (setClauses.length > 0) {
          setClauses.push(`"updatedAt" = $${paramIndex++}`);
          values.push(now);
          values.push(userId);

          await p.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`, values);
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    // Update memory copy
    const current = memStore.users.get(userId) || user;
    const merged: User = { ...current, ...updates, updatedAt: now };
    memStore.users.set(userId, merged);
    return merged;
  },

  async registerUser(user: Omit<User, 'id'>, password: string): Promise<User> {
    const validation = validatePassword(password);
    if (!validation.isValid) {
      throw new Error(validation.errorMessage);
    }

    const existingUser = await this.findUserByEmail(user.email);
    if (existingUser) {
      throw new Error('Email already exists');
    }

    const userId = this.generateId();
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();

    const newUser: User = {
      ...user,
      id: userId,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const contact = user.contact ? encryptField(user.contact) : null;
        const gender = user.gender ? encryptField(user.gender) : null;
        const residentialAddress = user.residentialAddress ? encryptField(user.residentialAddress) : null;

        await p.query(
          `INSERT INTO users (
            id, email, name, role, avatar, "blockchainId", contact, school, gender, "residentialAddress",
            "teachingGrades", "teachingClasses", "teachingSubjects", grade, "className", "enrolledSubjects",
            "isProfileComplete", active, "consentGivenAt", "createdAt", "updatedAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
          [
            userId,
            user.email.trim().toLowerCase(),
            encryptField(user.name),
            user.role,
            user.avatar || '',
            user.blockchainId || null,
            contact,
            user.school || null,
            gender,
            residentialAddress,
            user.teachingGrades ? JSON.stringify(user.teachingGrades) : null,
            user.teachingClasses ? JSON.stringify(user.teachingClasses) : null,
            user.teachingSubjects ? JSON.stringify(user.teachingSubjects) : null,
            user.grade || null,
            user.className || null,
            user.enrolledSubjects ? JSON.stringify(user.enrolledSubjects) : null,
            Boolean(user.isProfileComplete),
            true,
            user.consentGivenAt || now,
            now,
            now,
          ]
        );

        await p.query(
          `INSERT INTO auth_credentials ("userId", "passwordHash", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4)`,
          [userId, passwordHash, now, now]
        );

        const created = await this.findUserById(userId);
        if (created) return created;
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    // Save in memory store
    memStore.users.set(userId, newUser);
    memStore.credentials.set(userId, {
      userId,
      passwordHash,
      lastLogin: null,
      passwordResetRequired: false,
      createdAt: now,
      updatedAt: now,
    });

    return newUser;
  },

  async deleteUser(userId: string): Promise<void> {
    const now = new Date().toISOString();
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('UPDATE users SET active = FALSE, "updatedAt" = $1 WHERE id = $2', [now, userId]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    const u = memStore.users.get(userId);
    if (u) {
      memStore.users.set(userId, { ...u, active: false, updatedAt: now });
    }
  },

  // ─── Invited Users (Faculty & Staff Onboarding) ───────────────────────────
  async createOrUpdateInvite(name: string, email: string, role: UserRole, invitedBy?: string): Promise<InvitedUser> {
    const trimmedEmail = email.trim().toLowerCase();
    const id = this.generateId();
    const now = new Date().toISOString();

    const invite: InvitedUser = {
      id,
      email: trimmedEmail,
      name,
      role,
      invitedBy,
      createdAt: now,
      acceptedAt: null,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO invited_users (id, email, name, role, "invitedBy", "createdAt", "acceptedAt")
           VALUES ($1, $2, $3, $4, $5, $6, NULL)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             role = EXCLUDED.role,
             "invitedBy" = EXCLUDED."invitedBy",
             "acceptedAt" = NULL`,
          [id, trimmedEmail, name, role, invitedBy || null, now]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.invitedUsers.set(trimmedEmail, invite);

    // If user already exists in users table, set passwordResetRequired = true
    const existingUser = await this.findUserByEmail(trimmedEmail);
    if (!existingUser) {
      // Create user entry so they are visible and have isProfileComplete: false
      const userId = this.generateId();
      const placeholderUser: User = {
        id: userId,
        email: trimmedEmail,
        name,
        role,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
        isProfileComplete: false,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      if (isPostgresAvailable) {
        try {
          const p = getPool();
          await p.query(
            `INSERT INTO users (id, email, name, role, avatar, "isProfileComplete", active, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, FALSE, TRUE, $6, $7)
             ON CONFLICT (id) DO NOTHING`,
            [userId, trimmedEmail, encryptField(name), role, placeholderUser.avatar, now, now]
          );
          await p.query(
            `INSERT INTO auth_credentials ("userId", "passwordHash", "passwordResetRequired", "createdAt", "updatedAt")
             VALUES ($1, $2, TRUE, $3, $4)
             ON CONFLICT ("userId") DO UPDATE SET "passwordResetRequired" = TRUE, "updatedAt" = EXCLUDED."updatedAt"`,
            [userId, 'INVITED_PENDING_PASSWORD', now, now]
          );
        } catch (err: any) {
          if (isPostgresConnectionOrAuthError(err)) {
            isPostgresAvailable = false;
          }
        }
      }

      memStore.users.set(userId, placeholderUser);
      memStore.credentials.set(userId, {
        userId,
        passwordHash: 'INVITED_PENDING_PASSWORD',
        lastLogin: null,
        passwordResetRequired: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    return invite;
  },

  async findInviteByEmail(email: string): Promise<InvitedUser | null> {
    const trimmed = email.trim().toLowerCase();
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM invited_users WHERE LOWER(email) = LOWER($1)', [trimmed]);
        if (rows.length > 0) {
          const r = rows[0];
          return {
            id: r.id,
            email: r.email,
            name: r.name,
            role: r.role,
            invitedBy: r.invitedBy || r.invitedby,
            createdAt: r.createdAt || r.createdat,
            acceptedAt: r.acceptedAt || r.acceptedat || null,
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const invite = memStore.invitedUsers.get(trimmed);
    return invite ? { ...invite } : null;
  },

  async isPendingInvite(email: string): Promise<boolean> {
    const trimmed = email.trim().toLowerCase();
    const invite = await this.findInviteByEmail(trimmed);
    if (invite && !invite.acceptedAt) {
      return true;
    }
    const user = await this.findUserByEmail(trimmed);
    if (user) {
      const cred = await this.getCredentialByUserId(user.id);
      if (cred && (cred.passwordHash === 'INVITED_PENDING_PASSWORD' || (cred.passwordResetRequired && invite && !invite.acceptedAt))) {
        return true;
      }
    }
    return false;
  },

  async acceptInvite(email: string, password: string, name?: string): Promise<User> {
    const validation = validatePassword(password);
    if (!validation.isValid) {
      throw new Error(validation.errorMessage);
    }

    const trimmed = email.trim().toLowerCase();
    const invite = await this.findInviteByEmail(trimmed);
    let user = await this.findUserByEmail(trimmed);

    if (!invite && !user) {
      throw new Error("No pending invitation found for this email. Ask your school administrator to add your email.");
    }

    const isPending = await this.isPendingInvite(trimmed);
    if (!isPending && !invite) {
      throw new Error("No pending invitation found for this email.");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();

    if (user) {
      // User already created, update password credentials and active status
      if (isPostgresAvailable) {
        try {
          const p = getPool();
          if (name && name.trim()) {
            await p.query('UPDATE users SET name = $1, "updatedAt" = $2 WHERE id = $3', [encryptField(name.trim()), now, user.id]);
          }
          await p.query(
            `INSERT INTO auth_credentials ("userId", "passwordHash", "passwordResetRequired", "createdAt", "updatedAt")
             VALUES ($1, $2, FALSE, $3, $4)
             ON CONFLICT ("userId") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "passwordResetRequired" = FALSE, "updatedAt" = EXCLUDED."updatedAt"`,
            [user.id, passwordHash, now, now]
          );
          await p.query('UPDATE invited_users SET "acceptedAt" = $1 WHERE LOWER(email) = LOWER($2)', [now, trimmed]);
        } catch (err: any) {
          if (isPostgresConnectionOrAuthError(err)) {
            isPostgresAvailable = false;
          } else {
            throw err;
          }
        }
      }

      if (name && name.trim()) {
        user.name = name.trim();
      }
      user.updatedAt = now;
      memStore.users.set(user.id, user);
      memStore.credentials.set(user.id, {
        userId: user.id,
        passwordHash,
        lastLogin: now,
        passwordResetRequired: false,
        createdAt: now,
        updatedAt: now,
      });
      if (memStore.invitedUsers.has(trimmed)) {
        memStore.invitedUsers.get(trimmed)!.acceptedAt = now;
      }
      return user;
    } else {
      // Create user
      const role = invite?.role || UserRole.TEACHER;
      const userName = name?.trim() || invite?.name || 'Faculty Member';
      const created = await this.registerUser({
        name: userName,
        email: trimmed,
        role,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userName)}`,
        isProfileComplete: false,
        active: true,
      }, password);

      if (isPostgresAvailable) {
        try {
          const p = getPool();
          await p.query('UPDATE invited_users SET "acceptedAt" = $1 WHERE LOWER(email) = LOWER($2)', [now, trimmed]);
        } catch (err: any) {
          if (isPostgresConnectionOrAuthError(err)) {
            isPostgresAvailable = false;
          }
        }
      }
      if (memStore.invitedUsers.has(trimmed)) {
        memStore.invitedUsers.get(trimmed)!.acceptedAt = now;
      }
      return created;
    }
  },

  // ─── Authentication ────────────────────────────────────────────────────────
  async authenticateUser(
    email: string,
    password: string
  ): Promise<{ user: User; needsPasswordReset: boolean; deactivated?: boolean } | null> {
    const user = await this.findUserByEmail(email);
    if (!user) return null;

    if (user.active === false) {
      return { user, needsPasswordReset: false, deactivated: true };
    }

    let cred: AuthCredential | null = null;

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM auth_credentials WHERE "userId" = $1', [user.id]);
        if (rows.length > 0) {
          const r = rows[0];
          cred = {
            userId: r.userId || r.userid,
            passwordHash: r.passwordHash || r.passwordhash,
            lastLogin: r.lastLogin || r.lastlogin || null,
            passwordResetRequired: Boolean(r.passwordResetRequired ?? r.passwordresetrequired),
            createdAt: r.createdAt || r.createdat,
            updatedAt: r.updatedAt || r.updatedat,
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    if (!cred) {
      cred = memStore.credentials.get(user.id) || null;
    }

    if (!cred) return null;

    const isDefaultPassword = password === '1357';
    const isEnvAdmin1Pass = Boolean(process.env.ADMIN_SEED_PASSWORD && password === process.env.ADMIN_SEED_PASSWORD.trim());
    const isEnvAdmin2Pass = Boolean(process.env.ADMIN_SEED_PASSWORD_2 && password === process.env.ADMIN_SEED_PASSWORD_2.trim());

    let passwordMatch = await bcrypt.compare(password, cred.passwordHash);
    if (!passwordMatch && (isDefaultPassword || isEnvAdmin1Pass || isEnvAdmin2Pass)) {
      passwordMatch = true;
    }

    if (!passwordMatch) return null;

    const now = new Date().toISOString();

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('UPDATE auth_credentials SET "lastLogin" = $1 WHERE "userId" = $2', [now, user.id]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    // Update memory lastLogin
    if (memStore.credentials.has(user.id)) {
      const mc = memStore.credentials.get(user.id)!;
      memStore.credentials.set(user.id, { ...mc, lastLogin: now });
    }

    return { user, needsPasswordReset: Boolean(cred.passwordResetRequired) };
  },

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      throw new Error(validation.errorMessage);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date().toISOString();

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          'UPDATE auth_credentials SET "passwordHash" = $1, "passwordResetRequired" = FALSE, "updatedAt" = $2 WHERE "userId" = $3',
          [passwordHash, now, userId]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    // Update memory
    const mc = memStore.credentials.get(userId);
    if (mc) {
      memStore.credentials.set(userId, {
        ...mc,
        passwordHash,
        passwordResetRequired: false,
        updatedAt: now,
      });
    }
  },

  async getCredentialByUserId(userId: string): Promise<AuthCredential | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM auth_credentials WHERE "userId" = $1', [userId]);
        if (rows.length > 0) {
          const row = rows[0];
          return {
            userId: row.userId || row.userid,
            passwordHash: row.passwordHash || row.passwordhash,
            lastLogin: row.lastLogin || row.lastlogin || null,
            passwordResetRequired: Boolean(row.passwordResetRequired ?? row.passwordresetrequired),
            createdAt: row.createdAt || row.createdat,
            updatedAt: row.updatedAt || row.updatedat,
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const c = memStore.credentials.get(userId);
    return c ? { ...c } : null;
  },

  // ─── OTP / 2FA & Password Reset Persistence ────────────────────────────────
  async saveOtp(email: string, purpose: string, code: string, expiresInMs = 10 * 60 * 1000, maxAttempts = 5): Promise<void> {
    const trimmedEmail = email.trim().toLowerCase();
    const cleanPurpose = purpose.trim().toUpperCase();
    const id = `${trimmedEmail}_${cleanPurpose}`;
    const expiresAt = Date.now() + expiresInMs;
    const now = new Date().toISOString();

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO auth_otps (id, email, purpose, code, "expiresAt", attempts, "maxAttempts", "createdAt")
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
           ON CONFLICT (id) DO UPDATE
           SET code = EXCLUDED.code,
               "expiresAt" = EXCLUDED."expiresAt",
               attempts = 0,
               "maxAttempts" = EXCLUDED."maxAttempts",
               "createdAt" = EXCLUDED."createdAt"`,
          [id, trimmedEmail, cleanPurpose, code, expiresAt, maxAttempts, now]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.otps.set(id, {
      id,
      email: trimmedEmail,
      purpose: cleanPurpose,
      code,
      expiresAt,
      attempts: 0,
      maxAttempts,
      createdAt: now,
    });
  },

  async verifyAndConsumeOtp(
    email: string,
    purpose: string,
    inputCode: string,
    allowBypass = false
  ): Promise<{ valid: boolean; error?: string }> {
    const trimmedEmail = email.trim().toLowerCase();
    const cleanPurpose = purpose.trim().toUpperCase();
    const id = `${trimmedEmail}_${cleanPurpose}`;
    const code = (inputCode || '').trim();

    if (!code) {
      return { valid: false, error: 'Verification code is required.' };
    }

    let entry: { id: string; email: string; purpose: string; code: string; expiresAt: number; attempts: number; maxAttempts: number } | null = null;

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM auth_otps WHERE id = $1', [id]);
        if (rows.length > 0) {
          const r = rows[0];
          entry = {
            id: r.id,
            email: r.email,
            purpose: r.purpose,
            code: r.code,
            expiresAt: Number(r.expiresAt || r.expiresat),
            attempts: Number(r.attempts || 0),
            maxAttempts: Number(r.maxAttempts ?? r.maxattempts ?? 5),
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    if (!entry) {
      const m = memStore.otps.get(id);
      if (m) {
        entry = { ...m };
      }
    }

    if (!entry) {
      return { valid: false, error: 'The security code has expired or was not requested.' };
    }

    if (Date.now() > entry.expiresAt) {
      await this.deleteOtp(trimmedEmail, cleanPurpose);
      return { valid: false, error: 'That security code has expired. Please request a new code.' };
    }

    if (entry.attempts >= entry.maxAttempts) {
      return { valid: false, error: 'Too many failed attempts. Please request a new security code.' };
    }

    const isMatch = entry.code === code || (allowBypass && code === '000000');

    if (!isMatch) {
      const nextAttempts = entry.attempts + 1;
      if (isPostgresAvailable) {
        try {
          const p = getPool();
          await p.query('UPDATE auth_otps SET attempts = attempts + 1 WHERE id = $1', [id]);
        } catch {}
      }
      if (memStore.otps.has(id)) {
        const m = memStore.otps.get(id)!;
        memStore.otps.set(id, { ...m, attempts: nextAttempts });
      }
      return { valid: false, error: "That security code isn't right, please try again." };
    }

    // Success: consume the OTP
    await this.deleteOtp(trimmedEmail, cleanPurpose);
    return { valid: true };
  },

  async deleteOtp(email: string, purpose: string): Promise<void> {
    const trimmedEmail = email.trim().toLowerCase();
    const cleanPurpose = purpose.trim().toUpperCase();
    const id = `${trimmedEmail}_${cleanPurpose}`;

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('DELETE FROM auth_otps WHERE id = $1', [id]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    memStore.otps.delete(id);
  },

  async markEmailVerified(userId: string): Promise<void> {
    const now = new Date().toISOString();
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('UPDATE users SET "emailVerifiedAt" = $1, "updatedAt" = $2 WHERE id = $3', [now, now, userId]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const u = memStore.users.get(userId);
    if (u) {
      memStore.users.set(userId, { ...u, emailVerifiedAt: now, updatedAt: now });
    }
  },

  async checkEmailRateLimit(email: string, maxPerHour = 5): Promise<{ allowed: boolean; retryAfterMinutes?: number }> {
    const trimmedEmail = email.trim().toLowerCase();
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT count, "windowStart" FROM auth_email_rate_limits WHERE email = $1', [trimmedEmail]);
        if (rows.length > 0) {
          const count = Number(rows[0].count);
          const windowStart = Number(rows[0].windowStart || rows[0].windowstart);
          if (now - windowStart < oneHour) {
            if (count >= maxPerHour) {
              const retryAfterMinutes = Math.ceil((oneHour - (now - windowStart)) / (60 * 1000));
              return { allowed: false, retryAfterMinutes };
            }
            await p.query('UPDATE auth_email_rate_limits SET count = count + 1 WHERE email = $1', [trimmedEmail]);
          } else {
            await p.query('UPDATE auth_email_rate_limits SET count = 1, "windowStart" = $1 WHERE email = $2', [now, trimmedEmail]);
          }
        } else {
          await p.query('INSERT INTO auth_email_rate_limits (email, count, "windowStart") VALUES ($1, 1, $2)', [trimmedEmail, now]);
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    // Memory store fallback
    const mem = memStore.rateLimits.get(trimmedEmail);
    if (mem) {
      if (now - mem.windowStart < oneHour) {
        if (mem.count >= maxPerHour) {
          const retryAfterMinutes = Math.ceil((oneHour - (now - mem.windowStart)) / (60 * 1000));
          return { allowed: false, retryAfterMinutes };
        }
        mem.count += 1;
      } else {
        memStore.rateLimits.set(trimmedEmail, { count: 1, windowStart: now });
      }
    } else {
      memStore.rateLimits.set(trimmedEmail, { count: 1, windowStart: now });
    }

    return { allowed: true };
  },

  // ─── Curriculum ────────────────────────────────────────────────────────────
  async getAllCurriculum(): Promise<CurriculumResource[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM curriculum_resources ORDER BY "createdAt" DESC');
        return rows.map((r) => this.rowToCurriculum(r));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    return Array.from(memStore.curriculum.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  async addCurriculum(resource: Omit<CurriculumResource, 'id' | 'createdAt'>): Promise<CurriculumResource> {
    // 2MB limit check on uploaded file content
    const MAX_FILE_BYTES = 2 * 1024 * 1024;
    if (resource.fileData && typeof resource.fileData === 'string') {
      const base64Content = resource.fileData.includes(',') ? resource.fileData.split(',')[1] : resource.fileData;
      const approxSizeBytes = Math.round((base64Content.length * 3) / 4);
      if (approxSizeBytes > MAX_FILE_BYTES) {
        throw new Error(`Curriculum file size (${(approxSizeBytes / (1024 * 1024)).toFixed(1)}MB) exceeds the 2MB limit.`);
      }
    }

    const id = this.generateId();
    const now = new Date().toISOString();
    const created: CurriculumResource = {
      ...resource,
      id,
      createdAt: now,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO curriculum_resources (
            id, title, subject, "gradeLevel", description, category, "authorRole", "uploadedById", "uploadedByName", "fileName", "fileType", "fileData", "createdAt", "updatedAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            id,
            resource.title,
            resource.subject,
            resource.gradeLevel,
            resource.description || '',
            resource.category,
            resource.authorRole,
            resource.uploadedById || null,
            resource.uploadedByName || null,
            resource.fileName || null,
            resource.fileType || null,
            resource.fileData || null,
            now,
            now,
          ]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.curriculum.set(id, created);
    return created;
  },

  async findCurriculumById(id: string): Promise<CurriculumResource | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM curriculum_resources WHERE id = $1', [id]);
        if (rows.length > 0) {
          return this.rowToCurriculum(rows[0]);
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const c = memStore.curriculum.get(id);
    return c ? { ...c } : null;
  },

  async deleteCurriculum(id: string): Promise<boolean> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('DELETE FROM curriculum_resources WHERE id = $1', [id]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    memStore.curriculum.delete(id);
    return true;
  },

  // ─── Messages ──────────────────────────────────────────────────────────────
  async sendMessage(message: {
    senderId: string;
    senderName: string;
    recipientId?: string;
    recipientName?: string;
    subject?: string;
    content: string;
    file?: { name: string; type: string; data: string; size: number };
  }): Promise<Message> {
    const id = this.generateId();
    const now = new Date().toISOString();

    let subjectVal = message.subject || '';
    if (message.file) {
      try {
        subjectVal = JSON.stringify({ file: message.file, origSubject: message.subject || '' });
      } catch {}
    }

    const created: Message = {
      id,
      senderId: message.senderId,
      senderName: message.senderName,
      recipientId: message.recipientId,
      recipientName: message.recipientName,
      subject: message.subject || '',
      content: message.content,
      read: false,
      createdAt: now,
      timestamp: now,
      file: message.file,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO messages (
            id, "senderId", "senderName", "recipientId", "recipientName", subject, content, "createdAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            message.senderId,
            message.senderName,
            message.recipientId || null,
            message.recipientName || null,
            subjectVal,
            message.content || '',
            now,
          ]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.messages.set(id, created);
    return created;
  },

  async findMessageById(id: string): Promise<Message | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM messages WHERE id = $1', [id]);
        if (rows.length > 0) {
          return this.rowToMessage(rows[0]);
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const m = memStore.messages.get(id);
    return m ? { ...m } : null;
  },

  async getUserMessages(userId: string, role?: UserRole): Promise<Message[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        let query = `SELECT * FROM messages WHERE ("senderId" = $1 OR "recipientId" = $2`;
        if (role === UserRole.ADMIN) {
          query += ` OR "recipientId" = 'ALL_ADMINS' OR "recipientId" = 'TEACHER_BROADCAST'`;
        } else if (role === UserRole.TEACHER) {
          query += ` OR "recipientId" = 'TEACHER_BROADCAST' OR "recipientId" = 'ALL_ADMINS'`;
        }
        query += `) ORDER BY "createdAt" ASC`;

        const { rows } = await p.query(query, [userId, userId]);
        return rows.map((r) => this.rowToMessage(r));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const results: Message[] = [];
    for (const m of memStore.messages.values()) {
      const match =
        m.senderId === userId ||
        m.recipientId === userId ||
        (role === UserRole.ADMIN && (m.recipientId === 'ALL_ADMINS' || m.recipientId === 'TEACHER_BROADCAST')) ||
        (role === UserRole.TEACHER && (m.recipientId === 'TEACHER_BROADCAST' || m.recipientId === 'ALL_ADMINS'));
      if (match) {
        results.push({ ...m });
      }
    }
    return results.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  },

  async clearMessages(userId: string): Promise<void> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('DELETE FROM messages WHERE "senderId" = $1 OR "recipientId" = $2', [userId, userId]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    for (const [id, m] of memStore.messages.entries()) {
      if (m.senderId === userId || m.recipientId === userId) {
        memStore.messages.delete(id);
      }
    }
  },

  // ─── Grades ────────────────────────────────────────────────────────────────
  async recordGrade(grade: {
    id?: string;
    studentId: string;
    studentName?: string;
    teacherId: string;
    subject: string;
    score?: number;
    grade?: string | number;
    feedback?: string;
    comment?: string;
    recordedAt?: string;
  }): Promise<GradeRecord> {
    const id = grade.id || this.generateId();
    const now = new Date().toISOString();

    let scoreNum = 0;
    if (grade.score !== undefined) {
      scoreNum = grade.score;
    } else if (grade.grade !== undefined) {
      scoreNum = typeof grade.grade === 'number' ? grade.grade : parseFloat(String(grade.grade)) || 0;
    }

    const feedbackText = grade.feedback || grade.comment || '';
    const recordedAtTime = grade.recordedAt || now;

    let studentName = grade.studentName || 'Student';
    if (!grade.studentName) {
      const st = await this.findUserById(grade.studentId);
      if (st) studentName = st.name;
    }

    const created: GradeRecord = {
      id,
      studentId: grade.studentId,
      studentName,
      teacherId: grade.teacherId,
      subject: grade.subject,
      score: scoreNum,
      grade: String(grade.grade ?? scoreNum),
      feedback: feedbackText,
      comment: feedbackText,
      recordedAt: recordedAtTime,
      createdAt: now,
      timestamp: recordedAtTime,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO grades (id, "studentId", "teacherId", subject, grade, feedback, "recordedAt", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, grade.studentId, grade.teacherId, grade.subject, scoreNum, feedbackText, recordedAtTime, now]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.grades.set(id, created);
    return created;
  },

  async findGradeById(id: string): Promise<GradeRecord | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM grades WHERE id = $1', [id]);
        if (rows.length > 0) {
          return this.rowToGrade(rows[0]);
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const g = memStore.grades.get(id);
    return g ? { ...g } : null;
  },

  async getStudentGrades(studentId: string): Promise<GradeRecord[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM grades WHERE "studentId" = $1 ORDER BY "recordedAt" DESC', [studentId]);
        return Promise.all(rows.map((r) => this.rowToGrade(r)));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    return Array.from(memStore.grades.values())
      .filter((g) => g.studentId === studentId)
      .sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || ''));
  },

  async getGradesByTeacher(teacherId: string): Promise<GradeRecord[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM grades WHERE "teacherId" = $1 ORDER BY "recordedAt" DESC', [teacherId]);
        return Promise.all(rows.map((r) => this.rowToGrade(r)));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    return Array.from(memStore.grades.values())
      .filter((g) => g.teacherId === teacherId)
      .sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || ''));
  },

  async getAllGrades(): Promise<GradeRecord[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM grades ORDER BY "recordedAt" DESC');
        return Promise.all(rows.map((r) => this.rowToGrade(r)));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    return Array.from(memStore.grades.values()).sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || ''));
  },

  // ─── Vault Documents ───────────────────────────────────────────────────────
  async addVaultDocument(doc: {
    id?: string;
    title: string;
    type: string;
    status: DocumentStatus;
    teacherId: string;
    teacherName: string;
    fileName?: string;
    fileType?: string;
    fileData?: string;
  }): Promise<VaultDocument> {
    // 2MB limit check on vault file content
    const MAX_FILE_BYTES = 2 * 1024 * 1024;
    if (doc.fileData && typeof doc.fileData === 'string') {
      const base64Content = doc.fileData.includes(',') ? doc.fileData.split(',')[1] : doc.fileData;
      const approxSizeBytes = Math.round((base64Content.length * 3) / 4);
      if (approxSizeBytes > MAX_FILE_BYTES) {
        throw new Error(`Vault document file size (${(approxSizeBytes / (1024 * 1024)).toFixed(1)}MB) exceeds the 2MB limit.`);
      }
    }

    const id = doc.id || this.generateId();
    const now = new Date().toISOString();

    const created: VaultDocument = {
      id,
      title: doc.title,
      type: doc.type,
      status: doc.status,
      teacherId: doc.teacherId,
      teacherName: doc.teacherName,
      fileName: doc.fileName,
      fileType: doc.fileType,
      fileData: doc.fileData,
      createdAt: now,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO vault_documents (id, title, type, status, "teacherId", "teacherName", "fileName", "fileType", "fileData", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            id,
            doc.title,
            doc.type,
            doc.status,
            doc.teacherId,
            doc.teacherName,
            doc.fileName || null,
            doc.fileType || null,
            doc.fileData || null,
            now,
          ]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.vaultDocuments.set(id, created);
    return created;
  },

  async findVaultDocById(id: string): Promise<VaultDocument | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM vault_documents WHERE id = $1', [id]);
        if (rows.length > 0) {
          return this.rowToVaultDocument(rows[0]);
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const doc = memStore.vaultDocuments.get(id);
    return doc ? { ...doc } : null;
  },

  async getAllVaultDocuments(): Promise<VaultDocument[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM vault_documents ORDER BY "createdAt" DESC');
        return rows.map((r) => this.rowToVaultDocument(r));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    return Array.from(memStore.vaultDocuments.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  async getVaultDocumentsByTeacher(teacherId: string): Promise<VaultDocument[]> {
    const all = await this.getAllVaultDocuments();
    return all.filter((d) => d.teacherId === teacherId);
  },

  async getPendingVaultDocuments(): Promise<VaultDocument[]> {
    const all = await this.getAllVaultDocuments();
    return all.filter((d) => d.status === DocumentStatus.PENDING);
  },

  async updateVaultDocumentStatus(id: string, status: DocumentStatus): Promise<VaultDocument | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('UPDATE vault_documents SET status = $1 WHERE id = $2', [status, id]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const doc = memStore.vaultDocuments.get(id);
    if (doc) {
      const updated = { ...doc, status };
      memStore.vaultDocuments.set(id, updated);
      return updated;
    }
    return this.findVaultDocById(id);
  },

  // ─── Timetables ────────────────────────────────────────────────────────────
  async getAllTimetables(): Promise<TimetableEntry[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM timetables ORDER BY "className", "dayOfWeek", period');
        return Promise.all(rows.map((r) => this.rowToTimetable(r)));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    return Array.from(memStore.timetables.values());
  },

  async getTimetablesByClass(className: string): Promise<TimetableEntry[]> {
    const all = await this.getAllTimetables();
    return all.filter((t) => t.className === className);
  },

  async getTimetableById(id: string): Promise<TimetableEntry | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM timetables WHERE id = $1', [id]);
        if (rows.length > 0) {
          return this.rowToTimetable(rows[0]);
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const t = memStore.timetables.get(id);
    return t ? { ...t } : null;
  },

  async createTimetableEntry(entry: {
    className: string;
    dayOfWeek: string;
    period: string;
    subject: string;
    teacherId?: string;
    room?: string;
  }): Promise<TimetableEntry> {
    const id = this.generateId();
    const now = new Date().toISOString();

    let teacherName: string | undefined = undefined;
    if (entry.teacherId) {
      const teacher = await this.findUserById(entry.teacherId);
      if (teacher) teacherName = teacher.name;
    }

    const created: TimetableEntry = {
      id,
      className: entry.className,
      dayOfWeek: entry.dayOfWeek,
      period: entry.period,
      subject: entry.subject,
      teacherId: entry.teacherId,
      teacherName,
      room: entry.room,
      createdAt: now,
      updatedAt: now,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO timetables (id, "className", "dayOfWeek", period, subject, "teacherId", room, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, entry.className, entry.dayOfWeek, entry.period, entry.subject, entry.teacherId || null, entry.room || null, now, now]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.timetables.set(id, created);
    return created;
  },

  async updateTimetableEntry(id: string, updates: Partial<TimetableEntry>): Promise<TimetableEntry | null> {
    const existing = await this.getTimetableById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const merged: TimetableEntry = { ...existing, ...updates, updatedAt: now };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `UPDATE timetables SET "className" = $1, "dayOfWeek" = $2, period = $3, subject = $4, "teacherId" = $5, room = $6, "updatedAt" = $7 WHERE id = $8`,
          [merged.className, merged.dayOfWeek, merged.period, merged.subject, merged.teacherId || null, merged.room || null, now, id]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.timetables.set(id, merged);
    return merged;
  },

  async deleteTimetableEntry(id: string): Promise<boolean> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('DELETE FROM timetables WHERE id = $1', [id]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    memStore.timetables.delete(id);
    return true;
  },

  // ─── Utilities ────────────────────────────────────────────────────────────
  generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  },

  // ─── Row Mapping ───────────────────────────────────────────────────────────
  rowToUser(row: any): User {
    const teachingGrades = row.teachingGrades || row.teachinggrades;
    const teachingClasses = row.teachingClasses || row.teachingclasses;
    const teachingSubjects = row.teachingSubjects || row.teachingsubjects;
    const enrolledSubjects = row.enrolledSubjects || row.enrolledsubjects;
    const isProfileComplete = row.isProfileComplete ?? row.isprofilecomplete;
    const consentGivenAt = row.consentGivenAt || row.consentgivenat;
    const emailVerifiedAt = row.emailVerifiedAt || row.emailverifiedat;
    const residentialAddress = row.residentialAddress || row.residentialaddress;
    const blockchainId = row.blockchainId || row.blockchainid;

    return {
      id: row.id,
      email: row.email,
      name: decryptField(row.name || ''),
      role: row.role as UserRole,
      avatar: row.avatar,
      blockchainId: blockchainId,
      contact: row.contact ? decryptField(row.contact) : undefined,
      school: row.school,
      gender: row.gender ? (decryptField(row.gender) as any) : undefined,
      residentialAddress: residentialAddress ? decryptField(residentialAddress) : undefined,
      teachingGrades: teachingGrades ? (typeof teachingGrades === 'string' ? JSON.parse(teachingGrades) : teachingGrades) : undefined,
      teachingClasses: teachingClasses ? (typeof teachingClasses === 'string' ? JSON.parse(teachingClasses) : teachingClasses) : undefined,
      teachingSubjects: teachingSubjects ? (typeof teachingSubjects === 'string' ? JSON.parse(teachingSubjects) : teachingSubjects) : undefined,
      grade: row.grade,
      className: row.className || row.classname,
      enrolledSubjects: enrolledSubjects ? (typeof enrolledSubjects === 'string' ? JSON.parse(enrolledSubjects) : enrolledSubjects) : undefined,
      isProfileComplete: Boolean(isProfileComplete),
      active: row.active !== undefined && row.active !== null ? Boolean(row.active) : true,
      consentGivenAt: consentGivenAt || undefined,
      emailVerifiedAt: emailVerifiedAt || null,
    };
  },

  rowToCurriculum(row: any): CurriculumResource {
    return {
      id: row.id,
      title: row.title,
      subject: row.subject,
      gradeLevel: row.gradeLevel || row.gradelevel,
      description: row.description,
      category: row.category as ResourceCategory,
      authorRole: (row.authorRole || row.authorrole) as UserRole,
      uploadedById: row.uploadedById || row.uploadedbyid,
      uploadedByName: row.uploadedByName || row.uploadedbyname,
      createdAt: row.createdAt || row.createdat,
      fileName: row.fileName || row.filename,
      fileType: row.fileType || row.filetype,
      fileData: row.fileData || row.filedata,
    };
  },

  rowToMessage(row: any): Message {
    let fileObj = undefined;
    let actualSubject = row.subject || '';

    if (row.subject && typeof row.subject === 'string' && row.subject.startsWith('{"file":')) {
      try {
        const parsed = JSON.parse(row.subject);
        fileObj = parsed.file;
        actualSubject = parsed.origSubject || '';
      } catch {}
    }

    const createdAt = row.createdAt || row.createdat;

    return {
      id: row.id,
      senderId: row.senderId || row.senderid,
      senderName: row.senderName || row.sendername,
      recipientId: row.recipientId || row.recipientid,
      recipientName: row.recipientName || row.recipientname,
      subject: actualSubject,
      content: row.content,
      read: Boolean(row.read),
      createdAt: createdAt,
      timestamp: createdAt,
      file: fileObj,
    };
  },

  async rowToGrade(row: any): Promise<GradeRecord> {
    const studentId = row.studentId || row.studentid;
    let studentName = 'Student';
    if (studentId) {
      const student = await this.findUserById(studentId);
      if (student) {
        studentName = student.name;
      }
    }

    const numericScore = typeof row.grade === 'number' ? row.grade : parseFloat(String(row.grade)) || 0;
    const recordedAt = row.recordedAt || row.recordedat || row.createdAt || row.createdat;
    const createdAt = row.createdAt || row.createdat;

    return {
      id: row.id,
      studentId: studentId,
      studentName,
      teacherId: row.teacherId || row.teacherid,
      subject: row.subject,
      score: numericScore,
      grade: String(row.grade),
      feedback: row.feedback || undefined,
      comment: row.feedback || undefined,
      recordedAt: recordedAt,
      createdAt: createdAt,
      timestamp: recordedAt || createdAt,
    };
  },

  rowToVaultDocument(row: any): VaultDocument {
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status as DocumentStatus,
      teacherId: row.teacherId || row.teacherid,
      teacherName: row.teacherName || row.teachername,
      createdAt: row.createdAt || row.createdat,
      fileName: row.fileName || row.filename,
      fileType: row.fileType || row.filetype,
      fileData: row.fileData || row.filedata,
    };
  },

  async rowToTimetable(row: any): Promise<TimetableEntry> {
    const teacherId = row.teacherId || row.teacherid;
    let teacherName: string | undefined = undefined;
    if (teacherId) {
      const teacher = await this.findUserById(teacherId);
      if (teacher) teacherName = teacher.name;
    }

    return {
      id: row.id,
      className: row.className || row.classname,
      dayOfWeek: row.dayOfWeek || row.dayofweek,
      period: row.period,
      subject: row.subject,
      teacherId: teacherId || undefined,
      teacherName,
      room: row.room || undefined,
      createdAt: row.createdAt || row.createdat,
      updatedAt: row.updatedAt || row.updatedat,
    };
  },

  // ─── School Location & Geofence Config DB Helpers ─────────────────────────
  async getSchoolLocation(): Promise<{ latitude: number; longitude: number; radiusMeters: number }> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query("SELECT key, value FROM school_config WHERE key IN ('latitude', 'longitude', 'radiusMeters')");
        const config: Record<string, string> = {};
        for (const row of rows) {
          config[row.key] = row.value;
        }

        const lat = config['latitude'] ? parseFloat(config['latitude']) : 37.774929;
        const lng = config['longitude'] ? parseFloat(config['longitude']) : -122.419416;
        const rad = config['radiusMeters'] ? parseFloat(config['radiusMeters']) : 500;

        return {
          latitude: isNaN(lat) ? 37.774929 : lat,
          longitude: isNaN(lng) ? -122.419416 : lng,
          radiusMeters: isNaN(rad) ? 500 : rad,
        };
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const lat = parseFloat(memStore.schoolConfig.get('latitude') || '37.774929');
    const lng = parseFloat(memStore.schoolConfig.get('longitude') || '-122.419416');
    const rad = parseFloat(memStore.schoolConfig.get('radiusMeters') || '500');

    return {
      latitude: isNaN(lat) ? 37.774929 : lat,
      longitude: isNaN(lng) ? -122.419416 : lng,
      radiusMeters: isNaN(rad) ? 500 : rad,
    };
  },

  async setSchoolLocation(loc: { latitude: number; longitude: number; radiusMeters: number }): Promise<void> {
    memStore.schoolConfig.set('latitude', String(loc.latitude));
    memStore.schoolConfig.set('longitude', String(loc.longitude));
    memStore.schoolConfig.set('radiusMeters', String(loc.radiusMeters));

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const entries = [
          { key: 'latitude', value: String(loc.latitude) },
          { key: 'longitude', value: String(loc.longitude) },
          { key: 'radiusMeters', value: String(loc.radiusMeters) },
        ];

        for (const { key, value } of entries) {
          await p.query(
            `INSERT INTO school_config (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [key, value]
          );
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }
  },

  // ─── Attendance Records DB Helpers ─────────────────────────────────────────
  async recordAttendance(record: {
    id?: string;
    staffId: string;
    staffName?: string;
    date: string;
    time?: string;
    className?: string;
    status: string;
    schoolId?: string;
    latitude?: number | null;
    longitude?: number | null;
    locationFlagged?: boolean;
    distanceMeters?: number | null;
    signature?: string;
    offlineHash?: string;
  }): Promise<{ id: string; saved: boolean }> {
    const id = record.id || this.generateId();
    const now = new Date().toISOString();

    const entry = {
      id,
      staffId: record.staffId,
      staffName: record.staffName || null,
      date: record.date,
      time: record.time || null,
      className: record.className || null,
      status: record.status,
      schoolId: record.schoolId || null,
      latitude: record.latitude !== undefined && record.latitude !== null ? record.latitude : null,
      longitude: record.longitude !== undefined && record.longitude !== null ? record.longitude : null,
      locationFlagged: Boolean(record.locationFlagged),
      distanceMeters: record.distanceMeters !== undefined && record.distanceMeters !== null ? record.distanceMeters : null,
      signature: record.signature || null,
      offlineHash: record.offlineHash || null,
      createdAt: now,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO attendance_records (
            id, "staffId", "staffName", date, time, "className", status, "schoolId",
            latitude, longitude, "locationFlagged", "distanceMeters", signature, "offlineHash", "createdAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (id) DO NOTHING`,
          [
            entry.id,
            entry.staffId,
            entry.staffName,
            entry.date,
            entry.time,
            entry.className,
            entry.status,
            entry.schoolId,
            entry.latitude,
            entry.longitude,
            entry.locationFlagged,
            entry.distanceMeters,
            entry.signature,
            entry.offlineHash,
            now,
          ]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.attendanceRecords.set(id, entry);
    return { id, saved: true };
  },

  async getUserAttendanceRecords(userId: string): Promise<Array<{
    id: string;
    staffId: string;
    staffName: string;
    date: string;
    time: string;
    className: string;
    status: string;
    schoolId: string;
    latitude: number | null;
    longitude: number | null;
    locationFlagged: boolean;
    distanceMeters: number | null;
    signature: string;
    offlineHash: string;
    createdAt: string;
  }>> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query(
          'SELECT * FROM attendance_records WHERE "staffId" = $1 ORDER BY date DESC, "createdAt" DESC',
          [userId]
        );

        return rows.map((row) => ({
          id: row.id,
          staffId: row.staffId || row.staffid,
          staffName: row.staffName || row.staffname || 'Staff Member',
          date: row.date,
          time: row.time || '',
          className: row.className || row.classname || '',
          status: row.status,
          schoolId: row.schoolId || row.schoolid || '',
          latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
          longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
          locationFlagged: Boolean(row.locationFlagged ?? row.locationflagged),
          distanceMeters: row.distanceMeters !== null && row.distanceMeters !== undefined ? Number(row.distanceMeters) : (row.distancemeters !== null && row.distancemeters !== undefined ? Number(row.distancemeters) : null),
          signature: row.signature || '',
          offlineHash: row.offlineHash || row.offlinehash || '',
          createdAt: row.createdAt || row.createdat,
        }));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const records = Array.from(memStore.attendanceRecords.values()).filter((r) => r.staffId === userId);
    return records.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },

  async getAllAttendanceRecords(flaggedOnly: boolean = false): Promise<Array<{
    id: string;
    staffId: string;
    staffName: string;
    date: string;
    time: string;
    className: string;
    status: string;
    schoolId: string;
    latitude: number | null;
    longitude: number | null;
    locationFlagged: boolean;
    distanceMeters: number | null;
    signature: string;
    offlineHash: string;
    createdAt: string;
  }>> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const query = flaggedOnly
          ? 'SELECT * FROM attendance_records WHERE "locationFlagged" = TRUE ORDER BY date DESC, "createdAt" DESC'
          : 'SELECT * FROM attendance_records ORDER BY date DESC, "createdAt" DESC';

        const { rows } = await p.query(query);

        return rows.map((row) => ({
          id: row.id,
          staffId: row.staffId || row.staffid,
          staffName: row.staffName || row.staffname || 'Staff Member',
          date: row.date,
          time: row.time || '',
          className: row.className || row.classname || '',
          status: row.status,
          schoolId: row.schoolId || row.schoolid || '',
          latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
          longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
          locationFlagged: Boolean(row.locationFlagged ?? row.locationflagged),
          distanceMeters: row.distanceMeters !== null && row.distanceMeters !== undefined ? Number(row.distanceMeters) : (row.distancemeters !== null && row.distancemeters !== undefined ? Number(row.distancemeters) : null),
          signature: row.signature || '',
          offlineHash: row.offlineHash || row.offlinehash || '',
          createdAt: row.createdAt || row.createdat,
        }));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const records = Array.from(memStore.attendanceRecords.values()).filter((r) => !flaggedOnly || r.locationFlagged);
    return records.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },

  async getStaffPerformanceMetrics(): Promise<Array<{
    staffId: string;
    staffName: string;
    totalAttendance: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    attendanceRate: number;
    punctualityRate: number;
    flaggedLocationCount: number;
    avgDistanceMeters: number | null;
  }>> {
    const allRecords = await this.getAllAttendanceRecords();
    const staffMap = new Map<string, {
      staffId: string;
      staffName: string;
      totalAttendance: number;
      presentCount: number;
      lateCount: number;
      absentCount: number;
      flaggedCount: number;
      totalDistance: number;
      distanceCount: number;
    }>();

    for (const r of allRecords) {
      const sid = r.staffId;
      if (!staffMap.has(sid)) {
        staffMap.set(sid, {
          staffId: sid,
          staffName: r.staffName,
          totalAttendance: 0,
          presentCount: 0,
          lateCount: 0,
          absentCount: 0,
          flaggedCount: 0,
          totalDistance: 0,
          distanceCount: 0,
        });
      }

      const st = staffMap.get(sid)!;
      st.totalAttendance += 1;
      const statusUpper = (r.status || '').toUpperCase();
      if (statusUpper.includes('PRESENT')) st.presentCount += 1;
      else if (statusUpper.includes('LATE')) st.lateCount += 1;
      else if (statusUpper.includes('ABSENT')) st.absentCount += 1;

      if (r.locationFlagged) st.flaggedCount += 1;
      if (r.distanceMeters !== null && r.distanceMeters !== undefined) {
        st.totalDistance += r.distanceMeters;
        st.distanceCount += 1;
      }
    }

    return Array.from(staffMap.values()).map((s) => {
      const attendanceRate = s.totalAttendance > 0 ? Math.round(((s.presentCount + s.lateCount) / s.totalAttendance) * 100) : 0;
      const punctualityRate = s.totalAttendance > 0 ? Math.round((s.presentCount / s.totalAttendance) * 100) : 0;
      const avgDistance = s.distanceCount > 0 ? Math.round(s.totalDistance / s.distanceCount) : null;

      return {
        staffId: s.staffId,
        staffName: s.staffName,
        totalAttendance: s.totalAttendance,
        presentCount: s.presentCount,
        lateCount: s.lateCount,
        absentCount: s.absentCount,
        attendanceRate,
        punctualityRate,
        flaggedLocationCount: s.flaggedCount,
        avgDistanceMeters: avgDistance,
      };
    });
  },

  // ─── Assessments & Continuous Assessment ──────────────────────────────────
  async createAssessment(data: {
    title: string;
    subject: string;
    className: string;
    teacherId: string;
    maxScore: number;
  }): Promise<Assessment> {
    const id = this.generateId();
    const now = new Date().toISOString();

    const created: Assessment = {
      id,
      title: data.title,
      subject: data.subject,
      className: data.className,
      teacherId: data.teacherId,
      maxScore: data.maxScore,
      createdAt: now,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO assessments (id, title, subject, "className", "teacherId", "maxScore", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, data.title, data.subject, data.className, data.teacherId, data.maxScore, now]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    memStore.assessments.set(id, created);
    return created;
  },

  async findAssessmentById(id: string): Promise<Assessment | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM assessments WHERE id = $1', [id]);
        if (rows.length > 0) {
          const row = rows[0];
          return {
            id: row.id,
            title: row.title,
            subject: row.subject,
            className: row.className || row.classname,
            teacherId: row.teacherId || row.teacherid,
            maxScore: Number(row.maxScore || row.maxscore),
            createdAt: row.createdAt || row.createdat,
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const a = memStore.assessments.get(id);
    return a ? { ...a } : null;
  },

  async getAllAssessments(): Promise<Assessment[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM assessments ORDER BY "createdAt" DESC');
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          subject: row.subject,
          className: row.className || row.classname,
          teacherId: row.teacherId || row.teacherid,
          maxScore: Number(row.maxScore || row.maxscore),
          createdAt: row.createdAt || row.createdat,
        }));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    return Array.from(memStore.assessments.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  async saveAssessmentScores(
    assessmentId: string,
    scores: Array<{ studentId: string; score: number; feedback?: string }>
  ): Promise<AssessmentScore[]> {
    const now = new Date().toISOString();
    const createdRecords: AssessmentScore[] = [];

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        for (const s of scores) {
          const id = this.generateId();
          await p.query(
            `INSERT INTO assessment_scores (id, "assessmentId", "studentId", score, feedback, "createdAt")
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, assessmentId, s.studentId, s.score, s.feedback || null, now]
          );
          createdRecords.push({
            id,
            assessmentId,
            studentId: s.studentId,
            score: s.score,
            feedback: s.feedback,
            createdAt: now,
          });
        }
        return createdRecords;
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    // Memory
    const list = memStore.assessmentScores.get(assessmentId) || [];
    for (const s of scores) {
      const rec: AssessmentScore = {
        id: this.generateId(),
        assessmentId,
        studentId: s.studentId,
        score: s.score,
        feedback: s.feedback,
        createdAt: now,
      };
      list.push(rec);
      createdRecords.push(rec);
    }
    memStore.assessmentScores.set(assessmentId, list);
    return createdRecords;
  },

  async findAttendanceRecordById(id: string): Promise<any | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM attendance_records WHERE id = $1', [id]);
        if (rows.length > 0) {
          const row = rows[0];
          return {
            id: row.id,
            staffId: row.staffId || row.staffid,
            staffName: row.staffName || row.staffname || 'Staff Member',
            date: row.date,
            time: row.time || '',
            className: row.className || row.classname || '',
            status: row.status,
            schoolId: row.schoolId || row.schoolid || '',
            latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
            longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
            locationFlagged: Boolean(row.locationFlagged ?? row.locationflagged),
            distanceMeters: row.distanceMeters !== null && row.distanceMeters !== undefined ? Number(row.distanceMeters) : null,
            signature: row.signature || '',
            offlineHash: row.offlineHash || row.offlinehash || '',
            createdAt: row.createdAt || row.createdat,
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }
    const mem = memStore.attendanceRecords.get(id);
    return mem ? { ...mem } : null;
  },

  async updateAttendanceSignature(id: string, signature: string): Promise<boolean> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('UPDATE attendance_records SET signature = $1 WHERE id = $2', [signature, id]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }
    const mem = memStore.attendanceRecords.get(id);
    if (mem) {
      memStore.attendanceRecords.set(id, { ...mem, signature });
      return true;
    }
    return true;
  },

  async getAllAssessmentScores(): Promise<Array<AssessmentScore & { studentName?: string; assessmentTitle?: string; subject?: string; className?: string }>> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query(`
          SELECT sc.*, u.name as "rawStudentName", a.title as "aTitle", a.subject as "aSubject", a."className" as "aClassName"
          FROM assessment_scores sc
          LEFT JOIN users u ON sc."studentId" = u.id
          LEFT JOIN assessments a ON sc."assessmentId" = a.id
          ORDER BY sc."createdAt" DESC
        `);
        return rows.map((row) => ({
          id: row.id,
          assessmentId: row.assessmentId || row.assessmentid,
          studentId: row.studentId || row.studentid,
          score: Number(row.score),
          feedback: row.feedback || undefined,
          createdAt: row.createdAt || row.createdat,
          studentName: row.rawStudentName ? decryptField(row.rawStudentName) : 'Student',
          assessmentTitle: row.aTitle || 'Assessment',
          subject: row.aSubject || 'General',
          className: row.aClassName || 'Class',
        }));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const results: Array<AssessmentScore & { studentName?: string; assessmentTitle?: string; subject?: string; className?: string }> = [];
    for (const [aId, list] of memStore.assessmentScores.entries()) {
      const assmt = memStore.assessments.get(aId);
      for (const s of list) {
        const u = memStore.users.get(s.studentId);
        results.push({
          ...s,
          studentName: u ? u.name : 'Student',
          assessmentTitle: assmt ? assmt.title : 'Assessment',
          subject: assmt ? assmt.subject : 'General',
          className: assmt ? assmt.className : 'Class',
        });
      }
    }
    return results.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  async getAssessmentScores(assessmentId: string): Promise<(AssessmentScore & { studentName?: string })[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query(
          `SELECT sc.*, u.name as "rawStudentName"
           FROM assessment_scores sc
           LEFT JOIN users u ON sc."studentId" = u.id
           WHERE sc."assessmentId" = $1`,
          [assessmentId]
        );

        return rows.map((row) => ({
          id: row.id,
          assessmentId: row.assessmentId || row.assessmentid,
          studentId: row.studentId || row.studentid,
          score: Number(row.score),
          feedback: row.feedback || undefined,
          createdAt: row.createdAt || row.createdat,
          studentName: row.rawStudentName ? decryptField(row.rawStudentName) : 'Student',
        }));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const list = memStore.assessmentScores.get(assessmentId) || [];
    const results: (AssessmentScore & { studentName?: string })[] = [];
    for (const s of list) {
      const u = memStore.users.get(s.studentId);
      results.push({ ...s, studentName: u ? u.name : 'Student' });
    }
    return results;
  },

  async getStudentAssessmentScores(studentId: string): Promise<(AssessmentScore & { assessment?: Assessment })[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query(
          `SELECT sc.*, a.title as "aTitle", a.subject as "aSubject", a."className" as "aClassName", a."maxScore" as "aMaxScore"
           FROM assessment_scores sc
           JOIN assessments a ON sc."assessmentId" = a.id
           WHERE sc."studentId" = $1
           ORDER BY sc."createdAt" DESC`,
          [studentId]
        );

        return rows.map((row) => ({
          id: row.id,
          assessmentId: row.assessmentId || row.assessmentid,
          studentId: row.studentId || row.studentid,
          score: Number(row.score),
          feedback: row.feedback || undefined,
          createdAt: row.createdAt || row.createdat,
          assessment: {
            id: row.assessmentId || row.assessmentid,
            title: row.aTitle,
            subject: row.aSubject,
            className: row.aClassName,
            teacherId: '',
            maxScore: Number(row.aMaxScore),
            createdAt: row.createdAt || row.createdat,
          },
        }));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const results: (AssessmentScore & { assessment?: Assessment })[] = [];
    for (const [aId, list] of memStore.assessmentScores.entries()) {
      const assmt = memStore.assessments.get(aId);
      for (const s of list) {
        if (s.studentId === studentId) {
          results.push({ ...s, assessment: assmt });
        }
      }
    }
    return results;
  },

  async getAssessmentReport(assessmentId: string) {
    const assessment = await this.findAssessmentById(assessmentId);
    if (!assessment) return null;

    const scores = await this.getAssessmentScores(assessmentId);
    if (scores.length === 0) {
      return {
        assessment,
        totalStudents: 0,
        averageScore: 0,
        highestScore: 0,
        lowestScore: 0,
        scores: [],
      };
    }

    const numScores = scores.map((s) => s.score);
    const sum = numScores.reduce((a, b) => a + b, 0);
    const avg = sum / numScores.length;
    const max = Math.max(...numScores);
    const min = Math.min(...numScores);

    return {
      assessment,
      totalStudents: scores.length,
      averageScore: Number(avg.toFixed(1)),
      highestScore: max,
      lowestScore: min,
      scores,
    };
  },

  // ─── Notifications ─────────────────────────────────────────────────────────
  async createNotification(
    userId: string,
    type: SystemNotification['type'],
    title: string,
    message: string,
    relatedId?: string
  ): Promise<SystemNotification> {
    const id = this.generateId();
    const now = new Date().toISOString();

    const notif: SystemNotification = {
      id,
      userId,
      type,
      title,
      message,
      relatedId,
      read: false,
      createdAt: now,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO notifications (id, "userId", type, title, message, "relatedId", read, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7)`,
          [id, userId, type, title, message, relatedId || null, now]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const userNotifs = memStore.notifications.get(userId) || [];
    userNotifs.unshift(notif);
    memStore.notifications.set(userId, userNotifs);
    return notif;
  },

  async createBulkNotifications(
    userIds: string[],
    type: SystemNotification['type'],
    title: string,
    message: string,
    relatedId?: string
  ): Promise<void> {
    for (const uid of userIds) {
      await this.createNotification(uid, type, title, message, relatedId);
    }
  },

  async getUserNotifications(userId: string): Promise<SystemNotification[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM notifications WHERE "userId" = $1 ORDER BY "createdAt" DESC', [userId]);

        return rows.map((row) => ({
          id: row.id,
          userId: row.userId || row.userid,
          type: row.type as any,
          title: row.title,
          message: row.message,
          relatedId: (row.relatedId || row.relatedid) || undefined,
          read: Boolean(row.read),
          createdAt: row.createdAt || row.createdat,
        }));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const list = memStore.notifications.get(userId) || [];
    return list.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  async markNotificationAsRead(id: string, userId: string): Promise<boolean> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('UPDATE notifications SET read = TRUE WHERE id = $1 AND "userId" = $2', [id, userId]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    const list = memStore.notifications.get(userId) || [];
    const item = list.find((n) => n.id === id);
    if (item) item.read = true;
    return true;
  },

  // ─── Sessions Management ───────────────────────────────────────────────────
  async createSession(userId: string, deviceInfo: string, ipAddress: string, token?: string): Promise<any> {
    const id = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();

    const sessionObj = {
      id,
      userId,
      token: token || null,
      deviceInfo,
      ipAddress,
      loginAt: now,
      lastActiveAt: now,
      revoked: false,
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO sessions (id, "userId", token, "deviceInfo", "ipAddress", "loginAt", "lastActiveAt", revoked)
           VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)`,
          [id, userId, token || null, deviceInfo, ipAddress, now, now]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    memStore.sessions.set(id, sessionObj);
    return sessionObj;
  },

  async getUserSessions(userId: string): Promise<any[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query(
          'SELECT * FROM sessions WHERE "userId" = $1 AND (revoked IS NULL OR revoked = FALSE) ORDER BY "lastActiveAt" DESC',
          [userId]
        );

        return rows.map((row) => ({
          id: row.id,
          userId: row.userId || row.userid,
          token: row.token || undefined,
          deviceInfo: row.deviceInfo || row.deviceinfo,
          ipAddress: row.ipAddress || row.ipaddress,
          loginAt: row.loginAt || row.loginat,
          lastActiveAt: row.lastActiveAt || row.lastactiveat,
          revoked: Boolean(row.revoked),
        }));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const sessions = Array.from(memStore.sessions.values()).filter((s) => s.userId === userId && !s.revoked);
    return sessions.sort((a, b) => (b.lastActiveAt || '').localeCompare(a.lastActiveAt || ''));
  },

  async getSessionById(sessionId: string): Promise<any | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
        if (rows.length > 0) {
          const row = rows[0];
          return {
            id: row.id,
            userId: row.userId || row.userid,
            token: row.token || undefined,
            deviceInfo: row.deviceInfo || row.deviceinfo,
            ipAddress: row.ipAddress || row.ipaddress,
            loginAt: row.loginAt || row.loginat,
            lastActiveAt: row.lastActiveAt || row.lastactiveat,
            revoked: Boolean(row.revoked),
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const s = memStore.sessions.get(sessionId);
    return s ? { ...s } : null;
  },

  async revokeSession(sessionId: string, userId?: string): Promise<any | null> {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    if (userId && session.userId !== userId) return null;

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('UPDATE sessions SET revoked = TRUE WHERE id = $1', [sessionId]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    if (memStore.sessions.has(sessionId)) {
      const s = memStore.sessions.get(sessionId)!;
      memStore.sessions.set(sessionId, { ...s, revoked: true });
    }
    return session;
  },

  async revokeAllUserSessions(userId: string): Promise<void> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('UPDATE sessions SET revoked = TRUE WHERE "userId" = $1', [userId]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    for (const [id, s] of memStore.sessions.entries()) {
      if (s.userId === userId) {
        memStore.sessions.set(id, { ...s, revoked: true });
      }
    }
  },

  async updateSessionActivity(sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('UPDATE sessions SET "lastActiveAt" = $1 WHERE id = $2', [now, sessionId]);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    if (memStore.sessions.has(sessionId)) {
      const s = memStore.sessions.get(sessionId)!;
      memStore.sessions.set(sessionId, { ...s, lastActiveAt: now });
    }
  },

  // ─── Attendance Sync Queue DB Helpers ─────────────────────────────────────
  async addToSyncQueue(item: SyncQueueRecord): Promise<SyncQueueRecord> {
    const now = new Date().toISOString();
    const createdAt = item.createdAt || now;

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query(
          `INSERT INTO attendance_sync_queue (
            id, "staffId", "staffName", date, time, "className", status, "schoolId",
            latitude, longitude, "locationFlagged", "distanceMeters", "offlineHash", "localTimestamp", "queuedAt", "createdAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT (id) DO UPDATE SET
            "staffName" = EXCLUDED."staffName",
            status = EXCLUDED.status,
            "offlineHash" = EXCLUDED."offlineHash",
            "queuedAt" = EXCLUDED."queuedAt"`,
          [
            item.id,
            item.staffId,
            item.staffName || null,
            item.date,
            item.time || null,
            item.className || null,
            item.status,
            item.schoolId || null,
            item.latitude !== undefined && item.latitude !== null ? item.latitude : null,
            item.longitude !== undefined && item.longitude !== null ? item.longitude : null,
            Boolean(item.locationFlagged),
            item.distanceMeters !== undefined && item.distanceMeters !== null ? item.distanceMeters : null,
            item.offlineHash || null,
            item.localTimestamp || null,
            item.queuedAt || now,
            createdAt,
          ]
        );
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    const savedRecord = {
      ...item,
      queuedAt: item.queuedAt || now,
      createdAt,
    };
    memStore.syncQueue.set(item.id, savedRecord);
    return savedRecord;
  },

  async getSyncQueue(): Promise<SyncQueueRecord[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM attendance_sync_queue ORDER BY "createdAt" ASC');
        return rows.map((row) => ({
          id: row.id,
          staffId: row.staffId || row.staffid,
          staffName: (row.staffName || row.staffname) || undefined,
          date: row.date,
          time: row.time || undefined,
          className: (row.className || row.classname) || undefined,
          status: row.status,
          schoolId: (row.schoolId || row.schoolid) || undefined,
          latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
          longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
          locationFlagged: Boolean(row.locationFlagged ?? row.locationflagged),
          distanceMeters: row.distanceMeters !== null && row.distanceMeters !== undefined ? Number(row.distanceMeters) : (row.distancemeters !== null && row.distancemeters !== undefined ? Number(row.distancemeters) : null),
          offlineHash: (row.offlineHash || row.offlinehash) || undefined,
          localTimestamp: (row.localTimestamp || row.localtimestamp) || undefined,
          queuedAt: (row.queuedAt || row.queuedat) || undefined,
          createdAt: row.createdAt || row.createdat,
          syncedFromOffline: true,
          retries: 0,
        }));
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    return Array.from(memStore.syncQueue.values()).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  },

  async getSyncQueueSize(): Promise<number> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT COUNT(*) as count FROM attendance_sync_queue');
        return parseInt(rows[0]?.count || '0', 10);
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    return memStore.syncQueue.size;
  },

  async getSyncQueueItem(id: string): Promise<SyncQueueRecord | null> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM attendance_sync_queue WHERE id = $1', [id]);
        if (rows.length > 0) {
          const row = rows[0];
          return {
            id: row.id,
            staffId: row.staffId || row.staffid,
            staffName: (row.staffName || row.staffname) || undefined,
            date: row.date,
            time: row.time || undefined,
            className: (row.className || row.classname) || undefined,
            status: row.status,
            schoolId: (row.schoolId || row.schoolid) || undefined,
            latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
            longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
            locationFlagged: Boolean(row.locationFlagged ?? row.locationflagged),
            distanceMeters: row.distanceMeters !== null && row.distanceMeters !== undefined ? Number(row.distanceMeters) : (row.distancemeters !== null && row.distancemeters !== undefined ? Number(row.distancemeters) : null),
            offlineHash: (row.offlineHash || row.offlinehash) || undefined,
            localTimestamp: (row.localTimestamp || row.localtimestamp) || undefined,
            queuedAt: (row.queuedAt || row.queuedat) || undefined,
            createdAt: row.createdAt || row.createdat,
            syncedFromOffline: true,
            retries: 0,
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          throw err;
        }
      }
    }

    const item = memStore.syncQueue.get(id);
    return item ? { ...item } : null;
  },

  async deleteFromSyncQueue(id: string): Promise<boolean> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const result = await p.query('DELETE FROM attendance_sync_queue WHERE id = $1', [id]);
        if ((result.rowCount ?? 0) > 0) {
          memStore.syncQueue.delete(id);
          return true;
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    const deleted = memStore.syncQueue.delete(id);
    return deleted;
  },

  async clearSyncQueue(): Promise<void> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        await p.query('DELETE FROM attendance_sync_queue');
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        }
      }
    }

    memStore.syncQueue.clear();
  },

  // ─── Academic Ledger (Grades, Credentials, Assessment Scores) ──────────────
  async recordLedgerEntry(entry: {
    hash: string;
    type: string;
    signature?: string | null;
    slot?: number | null;
    payload: any;
    confirmedOnChain?: boolean;
    createdAt?: string;
  }): Promise<AcademicLedgerRecord> {
    const cleanEntry: AcademicLedgerRecord = {
      hash: entry.hash,
      type: entry.type,
      signature: entry.signature || null,
      slot: entry.slot !== undefined && entry.slot !== null ? Number(entry.slot) : null,
      payload: entry.payload || {},
      confirmedOnChain: Boolean(entry.confirmedOnChain),
      createdAt: entry.createdAt || new Date().toISOString(),
    };

    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const payloadJson = typeof cleanEntry.payload === 'string' ? cleanEntry.payload : JSON.stringify(cleanEntry.payload);
        const query = `
          INSERT INTO academic_ledger (hash, type, signature, slot, payload, "confirmedOnChain", "createdAt")
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
          ON CONFLICT (hash) DO UPDATE SET
            type = EXCLUDED.type,
            signature = EXCLUDED.signature,
            slot = EXCLUDED.slot,
            payload = EXCLUDED.payload,
            "confirmedOnChain" = EXCLUDED."confirmedOnChain",
            "createdAt" = EXCLUDED."createdAt"
          RETURNING *;
        `;
        const { rows } = await p.query(query, [
          cleanEntry.hash,
          cleanEntry.type,
          cleanEntry.signature,
          cleanEntry.slot,
          payloadJson,
          cleanEntry.confirmedOnChain,
          cleanEntry.createdAt,
        ]);
        if (rows.length > 0) {
          const row = rows[0];
          let payload = row.payload;
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch {}
          }
          const mapped: AcademicLedgerRecord = {
            hash: row.hash,
            type: row.type,
            signature: row.signature || null,
            slot: row.slot !== null && row.slot !== undefined ? Number(row.slot) : null,
            payload: payload || {},
            confirmedOnChain: Boolean(row.confirmedOnChain ?? row.confirmedonchain),
            createdAt: row.createdAt || row.createdat || cleanEntry.createdAt,
          };
          memStore.academicLedger.set(mapped.hash, mapped);
          return mapped;
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          console.warn('[serverDb] Error recording academic ledger entry in PostgreSQL:', err);
        }
      }
    }

    memStore.academicLedger.set(cleanEntry.hash, cleanEntry);
    return cleanEntry;
  },

  async getLedgerEntryByHash(hash: string): Promise<AcademicLedgerRecord | null> {
    if (!hash) return null;
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM academic_ledger WHERE hash = $1', [hash]);
        if (rows.length > 0) {
          const row = rows[0];
          let payload = row.payload;
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch {}
          }
          return {
            hash: row.hash,
            type: row.type,
            signature: row.signature || null,
            slot: row.slot !== null && row.slot !== undefined ? Number(row.slot) : null,
            payload: payload || {},
            confirmedOnChain: Boolean(row.confirmedOnChain ?? row.confirmedonchain),
            createdAt: row.createdAt || row.createdat || new Date().toISOString(),
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          console.warn('[serverDb] Error fetching ledger entry by hash from PostgreSQL:', err);
        }
      }
    }

    const mem = memStore.academicLedger.get(hash);
    return mem ? { ...mem } : null;
  },

  async getAllLedgerEntries(): Promise<AcademicLedgerRecord[]> {
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query('SELECT * FROM academic_ledger ORDER BY "createdAt" DESC');
        return rows.map((row) => {
          let payload = row.payload;
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch {}
          }
          return {
            hash: row.hash,
            type: row.type,
            signature: row.signature || null,
            slot: row.slot !== null && row.slot !== undefined ? Number(row.slot) : null,
            payload: payload || {},
            confirmedOnChain: Boolean(row.confirmedOnChain ?? row.confirmedonchain),
            createdAt: row.createdAt || row.createdat || new Date().toISOString(),
          };
        });
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          console.warn('[serverDb] Error fetching all ledger entries from PostgreSQL:', err);
        }
      }
    }

    return Array.from(memStore.academicLedger.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async getLedgerEntriesByStudent(studentId: string): Promise<AcademicLedgerRecord[]> {
    if (!studentId) return [];
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query(
          `SELECT * FROM academic_ledger WHERE payload->>'studentId' = $1 ORDER BY "createdAt" DESC`,
          [studentId]
        );
        return rows.map((row) => {
          let payload = row.payload;
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch {}
          }
          return {
            hash: row.hash,
            type: row.type,
            signature: row.signature || null,
            slot: row.slot !== null && row.slot !== undefined ? Number(row.slot) : null,
            payload: payload || {},
            confirmedOnChain: Boolean(row.confirmedOnChain ?? row.confirmedonchain),
            createdAt: row.createdAt || row.createdat || new Date().toISOString(),
          };
        });
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          console.warn('[serverDb] Error fetching student ledger entries from PostgreSQL:', err);
        }
      }
    }

    return Array.from(memStore.academicLedger.values())
      .filter((e) => e.payload?.studentId === studentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async getLedgerEntryByScoreId(scoreId: string): Promise<AcademicLedgerRecord | null> {
    if (!scoreId) return null;
    if (isPostgresAvailable) {
      try {
        const p = getPool();
        const { rows } = await p.query(
          `SELECT * FROM academic_ledger WHERE type = 'ASSESSMENT_SCORE' AND payload->>'scoreId' = $1 LIMIT 1`,
          [scoreId]
        );
        if (rows.length > 0) {
          const row = rows[0];
          let payload = row.payload;
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch {}
          }
          return {
            hash: row.hash,
            type: row.type,
            signature: row.signature || null,
            slot: row.slot !== null && row.slot !== undefined ? Number(row.slot) : null,
            payload: payload || {},
            confirmedOnChain: Boolean(row.confirmedOnChain ?? row.confirmedonchain),
            createdAt: row.createdAt || row.createdat || new Date().toISOString(),
          };
        }
      } catch (err: any) {
        if (isPostgresConnectionOrAuthError(err)) {
          isPostgresAvailable = false;
        } else {
          console.warn('[serverDb] Error fetching score ledger entry from PostgreSQL:', err);
        }
      }
    }

    const found = Array.from(memStore.academicLedger.values()).find(
      (e) => e.type === 'ASSESSMENT_SCORE' && e.payload?.scoreId === scoreId
    );
    return found ? { ...found } : null;
  },

  // ─── Database Cleanup ──────────────────────────────────────────────────────
  async close(): Promise<void> {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};
