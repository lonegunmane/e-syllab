import pg from 'pg';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { encryptField, decryptField } from './encryption';
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

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    const isLocal = connectionString && (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'));
    const sslConfig = isLocal ? undefined : { rejectUnauthorized: false };

    pool = new Pool({
      connectionString: connectionString || undefined,
      ssl: sslConfig,
    });

    pool.on('error', (err) => {
      console.error('[Database] Unexpected error on idle PostgreSQL client:', err.message || err);
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

/**
 * Server Database Service using PostgreSQL (pg Pool)
 * Manages all persistent data in PostgreSQL with parameterized queries
 */
export const serverDb = {
  // ─── Initialization ────────────────────────────────────────────────────────
  async init(): Promise<void> {
    const p = getPool();
    try {
      // Test connectivity
      const client = await p.connect();
      client.release();
      console.log('[Database] Connected to PostgreSQL successfully');
    } catch (err: any) {
      console.warn('[Database] Initial PostgreSQL connection check note:', err?.message || err);
    }

    try {
      await this.createTables();
      await this.seedInitialData();
      await this.seedTimetables();
    } catch (err: any) {
      console.error('[Database] Error during schema initialization:', err);
    }
  },

  async createTables(): Promise<void> {
    const p = getPool();

    // Users table
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
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      )
    `);

    // Auth credentials table
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

    // Curriculum resources table
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

    // Messages table
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

    // Grades table
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

    // Vault documents table
    await p.query(`
      CREATE TABLE IF NOT EXISTS vault_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
        "teacherId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "teacherName" TEXT NOT NULL,
        "fileName" TEXT,
        "fileType" TEXT,
        "fileData" TEXT,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      )
    `);

    // Timetables table
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

    // Attendance records table
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

    // School config table for campus location and geofencing radius
    await p.query(`
      CREATE TABLE IF NOT EXISTS school_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Assessments table
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

    // Assessment scores table
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

    // Notifications table
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

    // Sessions table
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

    // Attendance Sync Queue table (Persisted Offline Sync Queue)
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
  },

  async seedInitialData(): Promise<void> {
    const p = getPool();
    try {
      const adminEmail = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase() || 'admin@gmail.com';
      const adminId = '3';
      const now = new Date().toISOString();

      // Check if admin or user with adminId, adminEmail, or role ADMIN already exists
      const { rows: existingRows } = await p.query(
        'SELECT id, email, role FROM users WHERE id = $1 OR LOWER(email) = LOWER($2) OR role = $3',
        [adminId, adminEmail, 'ADMIN']
      );

      const existingAdmin = existingRows[0];

      if (existingAdmin) {
        // If the seeded admin exists but email differs from ADMIN_SEED_EMAIL, sync it
        if (existingAdmin.email.toLowerCase() !== adminEmail.toLowerCase()) {
          await p.query('UPDATE users SET email = $1, "updatedAt" = $2 WHERE id = $3', [
            adminEmail,
            now,
            existingAdmin.id,
          ]);
        }

        // If ADMIN_SEED_PASSWORD is provided in environment, update the credentials
        const envPassword = process.env.ADMIN_SEED_PASSWORD?.trim();
        if (envPassword) {
          const passwordHash = bcrypt.hashSync(envPassword, 10);
          const { rows: credRows } = await p.query(
            'SELECT "userId" FROM auth_credentials WHERE "userId" = $1',
            [existingAdmin.id]
          );

          if (credRows.length > 0) {
            await p.query(
              'UPDATE auth_credentials SET "passwordHash" = $1, "updatedAt" = $2 WHERE "userId" = $3',
              [passwordHash, now, existingAdmin.id]
            );
          } else {
            await p.query(
              'INSERT INTO auth_credentials ("userId", "passwordHash", "passwordResetRequired", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
              [existingAdmin.id, passwordHash, true, now, now]
            );
          }
        }
        return; // Existing admin handled successfully
      }

      let adminPassword = process.env.ADMIN_SEED_PASSWORD?.trim();
      if (!adminPassword) {
        adminPassword = crypto.randomBytes(16).toString('hex');
        console.warn('================================================================================');
        console.warn('[Security] No ADMIN_SEED_PASSWORD set — generated a random one-time admin password, check server logs now, it will not be shown again.');
        console.warn(`[Security] Admin Email: ${adminEmail} | Temporary One-Time Password: ${adminPassword}`);
        console.warn('================================================================================');
      }

      const passwordHash = bcrypt.hashSync(adminPassword, 10);

      // Insert admin user
      await p.query(
        `INSERT INTO users (
          id, email, name, role, avatar, "blockchainId", contact, school, gender, "residentialAddress", "isProfileComplete", active, "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO NOTHING`,
        [
          adminId,
          adminEmail,
          encryptField('Primary Admin'),
          'ADMIN',
          'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
          'sol-genesis-block-3-admin',
          encryptField('777-888-9999'),
          'ESYLAB Headquarters',
          encryptField('Prefer not to say'),
          encryptField('789 Pine Rd, Capital City'),
          true,
          true,
          now,
          now,
        ]
      );

      // Insert admin credentials
      await p.query(
        `INSERT INTO auth_credentials ("userId", "passwordHash", "passwordResetRequired", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("userId") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "updatedAt" = EXCLUDED."updatedAt"`,
        [adminId, passwordHash, true, now, now]
      );

      // Insert sample curriculum if not exists
      const { rows: currRows } = await p.query('SELECT id FROM curriculum_resources WHERE id = $1', ['curr-1']);
      if (currRows.length === 0) {
        await p.query(
          `INSERT INTO curriculum_resources (
            id, title, subject, "gradeLevel", description, category, "authorRole", "createdAt", "updatedAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            'curr-1',
            'Mathematics Core Syllabus 2025',
            'Mathematics',
            'Grade 10',
            'Official 2025 syllabus for Algebra and Geometry fundamentals. Includes learning objectives and required textbooks.',
            'DOCUMENT',
            'ADMIN',
            now,
            now,
          ]
        );
      }

      // Seed sample attendance records if none exist
      const { rows: countRows } = await p.query('SELECT COUNT(*) as count FROM attendance_records');
      const attCount = parseInt(countRows[0]?.count || '0', 10);

      if (attCount === 0) {
        const seedRows = [
          {
            id: 'att-1',
            staffId: '2',
            staffName: 'Dr. Sarah Wilson',
            date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
            time: '08:15 AM',
            className: 'Grade 10 Physics',
            status: 'PRESENT',
            schoolId: 'ESYLAB-MAIN',
            latitude: 37.785000,
            longitude: -122.408000,
            locationFlagged: true,
            distanceMeters: 1540,
            signature: '5wK1yP9hJmZ4b7nQ8rT2vW6xY3uC1aD8eF9gH2kL4mP7qR9sT1uV3wX5yZ7aB9cD4eF5gH6jK7mN8pQ',
          },
          {
            id: 'att-2',
            staffId: '2',
            staffName: 'Dr. Sarah Wilson',
            date: new Date(Date.now() - 172800000).toISOString().slice(0, 10),
            time: '08:02 AM',
            className: 'Grade 10 Physics',
            status: 'PRESENT',
            schoolId: 'ESYLAB-MAIN',
            latitude: 37.774929,
            longitude: -122.419416,
            locationFlagged: false,
            distanceMeters: 12,
            signature: '4rN8xK2mP9hJ5wQ1yZ7aB9cD8eF9gH2kL4mP7qR9sT1uV3wX5yZ7aB9cD1aD8eF9aB2cD3eF4gH5j',
          },
          {
            id: 'att-3',
            staffId: '4',
            staffName: 'Mr. James Blake',
            date: new Date(Date.now() - 259200000).toISOString().slice(0, 10),
            time: '08:45 AM',
            className: 'Grade 10 Mathematics',
            status: 'LATE',
            schoolId: 'ESYLAB-MAIN',
            latitude: 37.791200,
            longitude: -122.401500,
            locationFlagged: true,
            distanceMeters: 2380,
            signature: '3mP7qR9sT1uV3wX5yZ7aB9cD4eF5gH6jK7mN8pQ5wK1yP9hJmZ4b7nQ8rT2vW6xY3uC1aD8eF9gH2k',
          },
        ];

        for (const row of seedRows) {
          const locStr = `LOC:${Number(row.latitude).toFixed(6)},${Number(row.longitude).toFixed(6)}`;
          const input = `${row.staffId}:${row.date}:${row.status.toUpperCase().replace(" ", "_")}:${locStr}`;
          const offlineHash = crypto.createHash('sha256').update(input).digest('hex');

          await p.query(
            `INSERT INTO attendance_records (
              id, "staffId", "staffName", date, time, "className", status, "schoolId",
              latitude, longitude, "locationFlagged", "distanceMeters", signature, "offlineHash", "createdAt"
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (id) DO NOTHING`,
            [
              row.id,
              row.staffId,
              row.staffName,
              row.date,
              row.time,
              row.className,
              row.status,
              row.schoolId,
              row.latitude,
              row.longitude,
              row.locationFlagged,
              row.distanceMeters,
              row.signature,
              offlineHash,
              now,
            ]
          );
        }
      }

      console.log('[Database] Seeded initial data');
    } catch (err) {
      console.error('[Database] Seeding error:', err);
    }
  },

  async seedTimetables(): Promise<void> {
    const p = getPool();
    try {
      // The timetable starts clean
      await p.query('DELETE FROM timetables');
    } catch (err) {
      console.error('[Database] Timetable clearing error:', err);
    }
  },

  // ─── User Operations ───────────────────────────────────────────────────────
  async findUserByEmail(email: string): Promise<User | null> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (rows.length > 0) {
      return this.rowToUser(rows[0]);
    }
    return null;
  },

  async findUserById(id: string): Promise<User | null> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM users WHERE id = $1', [id]);
    if (rows.length > 0) {
      return this.rowToUser(rows[0]);
    }
    return null;
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

    const p = getPool();
    const userId = user.id || this.generateId();
    const now = new Date().toISOString();

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
        user.email || `${userId}@esylab.school`,
        encryptField(user.name || 'User'),
        user.role || UserRole.TEACHER,
        user.avatar || '',
        contact,
        gender,
        residentialAddress,
        Boolean(user.isProfileComplete),
        user.active !== undefined ? Boolean(user.active) : true,
        now,
        now,
      ]
    );

    const created = await this.findUserById(userId);
    return created!;
  },

  async getAllUsers(includeInactive: boolean = false): Promise<User[]> {
    const p = getPool();
    const query = includeInactive
      ? 'SELECT * FROM users ORDER BY "createdAt" DESC'
      : 'SELECT * FROM users WHERE (active IS NULL OR active = TRUE) ORDER BY "createdAt" DESC';
    const { rows } = await p.query(query);
    return rows.map((r) => this.rowToUser(r));
  },

  async getUsersByRole(role: UserRole, includeInactive: boolean = false): Promise<User[]> {
    const p = getPool();
    const query = includeInactive
      ? 'SELECT * FROM users WHERE role = $1 ORDER BY "createdAt" DESC'
      : 'SELECT * FROM users WHERE role = $1 AND (active IS NULL OR active = TRUE) ORDER BY "createdAt" DESC';
    const { rows } = await p.query(query, [role]);
    return rows.map((r) => this.rowToUser(r));
  },

  async updateUserProfile(userId: string, updates: Partial<User>): Promise<User | null> {
    const user = await this.findUserById(userId);
    if (!user) return null;

    const p = getPool();
    const now = new Date().toISOString();
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

      await p.query(
        `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }

    return this.findUserById(userId);
  },

  async registerUser(user: Omit<User, 'id'>, password: string): Promise<User> {
    const existingUser = await this.findUserByEmail(user.email);
    if (existingUser) {
      throw new Error('Email already exists');
    }

    if (user.role === UserRole.ADMIN) {
      const admins = await this.getUsersByRole(UserRole.ADMIN);
      if (admins.length >= 2) {
        throw new Error('Maximum of 2 administrator accounts allowed');
      }
    }

    const p = getPool();
    const userId = this.generateId();
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash(password, 10);

    const contact = user.contact ? encryptField(user.contact) : null;
    const gender = user.gender ? encryptField(user.gender) : null;
    const residentialAddress = user.residentialAddress ? encryptField(user.residentialAddress) : null;

    await p.query(
      `INSERT INTO users (
        id, email, name, role, avatar, contact, gender, "residentialAddress", "isProfileComplete", active, "consentGivenAt", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        userId,
        user.email,
        encryptField(user.name),
        user.role,
        user.avatar || '',
        contact,
        gender,
        residentialAddress,
        user.role === UserRole.ADMIN,
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
    return created!;
  },

  async deleteUser(userId: string): Promise<void> {
    try {
      const p = getPool();
      const now = new Date().toISOString();
      await p.query('UPDATE users SET active = FALSE, "updatedAt" = $1 WHERE id = $2', [now, userId]);
    } catch (e) {
      console.error('[serverDb] Error deactivating user:', e);
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

    const p = getPool();
    const { rows } = await p.query('SELECT * FROM auth_credentials WHERE "userId" = $1', [user.id]);
    const cred = rows[0];

    if (!cred) return null;

    const passwordHash = cred.passwordHash || cred.passwordhash;
    const passwordMatch = await bcrypt.compare(password, passwordHash);
    if (!passwordMatch) return null;

    // Update lastLogin
    await p.query('UPDATE auth_credentials SET "lastLogin" = $1 WHERE "userId" = $2', [
      new Date().toISOString(),
      user.id,
    ]);

    const resetReq = cred.passwordResetRequired ?? cred.passwordresetrequired;
    return { user, needsPasswordReset: Boolean(resetReq) };
  },

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const p = getPool();
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date().toISOString();

    await p.query(
      `UPDATE auth_credentials SET "passwordHash" = $1, "passwordResetRequired" = FALSE, "updatedAt" = $2 WHERE "userId" = $3`,
      [passwordHash, now, userId]
    );
  },

  async getCredentialByUserId(userId: string): Promise<AuthCredential | null> {
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
      } as unknown as AuthCredential;
    }
    return null;
  },

  // ─── Curriculum ────────────────────────────────────────────────────────────
  async getAllCurriculum(): Promise<CurriculumResource[]> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM curriculum_resources ORDER BY "createdAt" DESC');
    return rows.map((r) => this.rowToCurriculum(r));
  },

  async addCurriculum(resource: Omit<CurriculumResource, 'id' | 'createdAt'>): Promise<CurriculumResource> {
    const p = getPool();
    const id = this.generateId();
    const now = new Date().toISOString();

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

    const created = await this.findCurriculumById(id);
    return created!;
  },

  async findCurriculumById(id: string): Promise<CurriculumResource | null> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM curriculum_resources WHERE id = $1', [id]);
    if (rows.length > 0) {
      return this.rowToCurriculum(rows[0]);
    }
    return null;
  },

  async deleteCurriculum(id: string): Promise<boolean> {
    const p = getPool();
    await p.query('DELETE FROM curriculum_resources WHERE id = $1', [id]);
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
    const p = getPool();
    const id = this.generateId();
    const now = new Date().toISOString();

    let subjectVal = message.subject || '';
    if (message.file) {
      try {
        subjectVal = JSON.stringify({ file: message.file, origSubject: message.subject || '' });
      } catch {}
    }

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

    const created = await this.findMessageById(id);
    return created!;
  },

  async findMessageById(id: string): Promise<Message | null> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM messages WHERE id = $1', [id]);
    if (rows.length > 0) {
      return this.rowToMessage(rows[0]);
    }
    return null;
  },

  async getUserMessages(userId: string, role?: UserRole): Promise<Message[]> {
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
  },

  async clearMessages(userId: string): Promise<void> {
    const p = getPool();
    await p.query('DELETE FROM messages WHERE "senderId" = $1 OR "recipientId" = $2', [userId, userId]);
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
    const p = getPool();
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

    await p.query(
      `INSERT INTO grades (id, "studentId", "teacherId", subject, grade, feedback, "recordedAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        grade.studentId,
        grade.teacherId,
        grade.subject,
        scoreNum,
        feedbackText,
        recordedAtTime,
        now,
      ]
    );

    const created = await this.findGradeById(id);
    return created!;
  },

  async findGradeById(id: string): Promise<GradeRecord | null> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM grades WHERE id = $1', [id]);
    if (rows.length > 0) {
      return this.rowToGrade(rows[0]);
    }
    return null;
  },

  async getStudentGrades(studentId: string): Promise<GradeRecord[]> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM grades WHERE "studentId" = $1 ORDER BY "recordedAt" DESC', [
      studentId,
    ]);
    return Promise.all(rows.map((r) => this.rowToGrade(r)));
  },

  async getGradesByTeacher(teacherId: string): Promise<GradeRecord[]> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM grades WHERE "teacherId" = $1 ORDER BY "recordedAt" DESC', [
      teacherId,
    ]);
    return Promise.all(rows.map((r) => this.rowToGrade(r)));
  },

  async getAllGrades(): Promise<GradeRecord[]> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM grades ORDER BY "recordedAt" DESC');
    return Promise.all(rows.map((r) => this.rowToGrade(r)));
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
    const p = getPool();
    const id = doc.id || this.generateId();
    const now = new Date().toISOString();

    await p.query(
      `INSERT INTO vault_documents (
        id, title, type, status, "teacherId", "teacherName", "fileName", "fileType", "fileData", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        now,
      ]
    );

    const created = await this.findVaultDocById(id);
    return created!;
  },

  async findVaultDocById(id: string): Promise<VaultDocument | null> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM vault_documents WHERE id = $1', [id]);
    if (rows.length > 0) {
      return this.rowToVaultDocument(rows[0]);
    }
    return null;
  },

  async getAllVaultDocuments(): Promise<VaultDocument[]> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM vault_documents ORDER BY "createdAt" DESC');
    return rows.map((r) => this.rowToVaultDocument(r));
  },

  async getVaultDocumentsByTeacher(teacherId: string): Promise<VaultDocument[]> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM vault_documents WHERE "teacherId" = $1 ORDER BY "createdAt" DESC', [
      teacherId,
    ]);
    return rows.map((r) => this.rowToVaultDocument(r));
  },

  async getPendingVaultDocuments(): Promise<VaultDocument[]> {
    const p = getPool();
    const { rows } = await p.query("SELECT * FROM vault_documents WHERE status = 'PENDING' ORDER BY \"createdAt\" DESC");
    return rows.map((r) => this.rowToVaultDocument(r));
  },

  async updateVaultDocumentStatus(id: string, status: DocumentStatus): Promise<VaultDocument | null> {
    const p = getPool();
    const now = new Date().toISOString();
    await p.query('UPDATE vault_documents SET status = $1, "updatedAt" = $2 WHERE id = $3', [status, now, id]);
    return this.findVaultDocById(id);
  },

  // ─── Timetable Operations ──────────────────────────────────────────────────
  async getAllTimetables(): Promise<TimetableEntry[]> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM timetables ORDER BY "className", "dayOfWeek", period');
    return Promise.all(rows.map((r) => this.rowToTimetable(r)));
  },

  async getTimetablesByClass(className: string): Promise<TimetableEntry[]> {
    const p = getPool();
    const { rows } = await p.query(
      'SELECT * FROM timetables WHERE "className" = $1 ORDER BY "dayOfWeek", period',
      [className]
    );
    return Promise.all(rows.map((r) => this.rowToTimetable(r)));
  },

  async getTimetableById(id: string): Promise<TimetableEntry | null> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM timetables WHERE id = $1', [id]);
    if (rows.length > 0) {
      return this.rowToTimetable(rows[0]);
    }
    return null;
  },

  async createTimetableEntry(entry: {
    id?: string;
    className: string;
    dayOfWeek: string;
    period: string;
    subject: string;
    teacherId?: string;
    room?: string;
  }): Promise<TimetableEntry> {
    const p = getPool();
    const id = entry.id || this.generateId();
    const now = new Date().toISOString();

    await p.query(
      `INSERT INTO timetables (id, "className", "dayOfWeek", period, subject, "teacherId", room, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        entry.className,
        entry.dayOfWeek,
        entry.period,
        entry.subject,
        entry.teacherId || '',
        entry.room || '',
        now,
        now,
      ]
    );

    const created = await this.getTimetableById(id);
    return created!;
  },

  async updateTimetableEntry(id: string, updates: Partial<TimetableEntry>): Promise<TimetableEntry | null> {
    const existing = await this.getTimetableById(id);
    if (!existing) return null;

    const p = getPool();
    const now = new Date().toISOString();
    const className = updates.className !== undefined ? updates.className : existing.className;
    const dayOfWeek = updates.dayOfWeek !== undefined ? updates.dayOfWeek : existing.dayOfWeek;
    const period = updates.period !== undefined ? updates.period : existing.period;
    const subject = updates.subject !== undefined ? updates.subject : existing.subject;
    const teacherId = updates.teacherId !== undefined ? updates.teacherId : existing.teacherId || '';
    const room = updates.room !== undefined ? updates.room : existing.room || '';

    await p.query(
      `UPDATE timetables
       SET "className" = $1, "dayOfWeek" = $2, period = $3, subject = $4, "teacherId" = $5, room = $6, "updatedAt" = $7
       WHERE id = $8`,
      [className, dayOfWeek, period, subject, teacherId, room, now, id]
    );

    return this.getTimetableById(id);
  },

  async deleteTimetableEntry(id: string): Promise<boolean> {
    const p = getPool();
    await p.query('DELETE FROM timetables WHERE id = $1', [id]);
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
    try {
      const p = getPool();
      const { rows } = await p.query(
        "SELECT key, value FROM school_config WHERE key IN ('latitude', 'longitude', 'radiusMeters')"
      );
      const config: Record<string, string> = {};
      for (const row of rows) {
        config[row.key] = row.value;
      }

      return {
        latitude: config.latitude !== undefined && config.latitude !== '' ? Number(config.latitude) : -15.3875,
        longitude: config.longitude !== undefined && config.longitude !== '' ? Number(config.longitude) : 28.3228,
        radiusMeters: config.radiusMeters !== undefined && config.radiusMeters !== '' ? Number(config.radiusMeters) : 150,
      };
    } catch (err) {
      console.error('[Database] getSchoolLocation error:', err);
      return {
        latitude: -15.3875,
        longitude: 28.3228,
        radiusMeters: 150,
      };
    }
  },

  async setSchoolLocation(loc: { latitude: number; longitude: number; radiusMeters: number }): Promise<void> {
    try {
      const p = getPool();
      const items = [
        { key: 'latitude', value: String(loc.latitude) },
        { key: 'longitude', value: String(loc.longitude) },
        { key: 'radiusMeters', value: String(loc.radiusMeters) },
      ];
      for (const item of items) {
        await p.query(
          `INSERT INTO school_config (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [item.key, item.value]
        );
      }
    } catch (err) {
      console.error('[Database] setSchoolLocation error:', err);
    }
  },

  // ─── Staff Performance & Attendance DB Helpers ─────────────────────────────
  async recordAttendance(record: {
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
  }): Promise<void> {
    const id = this.generateId();
    const now = new Date().toISOString();
    try {
      const p = getPool();
      await p.query(
        `INSERT INTO attendance_records (
          id, "staffId", "staffName", date, time, "className", status, "schoolId",
          latitude, longitude, "locationFlagged", "distanceMeters", signature, "offlineHash", "createdAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          id,
          record.staffId,
          record.staffName || null,
          record.date,
          record.time || null,
          record.className || null,
          record.status,
          record.schoolId || null,
          record.latitude !== undefined && record.latitude !== null ? record.latitude : null,
          record.longitude !== undefined && record.longitude !== null ? record.longitude : null,
          Boolean(record.locationFlagged),
          record.distanceMeters !== undefined && record.distanceMeters !== null ? record.distanceMeters : null,
          record.signature || null,
          record.offlineHash || null,
          now,
        ]
      );
    } catch (err) {
      console.error('[Database] Attendance insert error:', err);
    }
  },

  async getUserAttendanceRecords(userId: string): Promise<Array<{
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
    signature?: string;
    offlineHash?: string;
    createdAt: string;
  }>> {
    const p = getPool();
    const { rows } = await p.query(
      'SELECT * FROM attendance_records WHERE "staffId" = $1 ORDER BY date DESC, "createdAt" DESC',
      [userId]
    );
    return rows.map((row) => ({
      id: row.id,
      staffId: row.staffId || row.staffid,
      staffName: (row.staffName || row.staffname) || undefined,
      date: row.date,
      time: (row.time) || undefined,
      className: (row.className || row.classname) || undefined,
      status: row.status,
      schoolId: (row.schoolId || row.schoolid) || undefined,
      latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
      longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
      locationFlagged: Boolean(row.locationFlagged ?? row.locationflagged),
      distanceMeters: row.distanceMeters !== null && row.distanceMeters !== undefined ? Number(row.distanceMeters) : (row.distancemeters !== null && row.distancemeters !== undefined ? Number(row.distancemeters) : null),
      signature: (row.signature) || undefined,
      offlineHash: (row.offlineHash || row.offlinehash) || undefined,
      createdAt: row.createdAt || row.createdat,
    }));
  },

  async getAllAttendanceRecords(flaggedOnly: boolean = false): Promise<Array<{
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
    signature?: string;
    offlineHash?: string;
    createdAt: string;
  }>> {
    const p = getPool();
    const query = flaggedOnly
      ? 'SELECT * FROM attendance_records WHERE "locationFlagged" = TRUE ORDER BY date DESC, "createdAt" DESC'
      : 'SELECT * FROM attendance_records ORDER BY date DESC, "createdAt" DESC';
    const { rows } = await p.query(query);
    return rows.map((row) => ({
      id: row.id,
      staffId: row.staffId || row.staffid,
      staffName: (row.staffName || row.staffname) || undefined,
      date: row.date,
      time: (row.time) || undefined,
      className: (row.className || row.classname) || undefined,
      status: row.status,
      schoolId: (row.schoolId || row.schoolid) || undefined,
      latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
      longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
      locationFlagged: Boolean(row.locationFlagged ?? row.locationflagged),
      distanceMeters: row.distanceMeters !== null && row.distanceMeters !== undefined ? Number(row.distanceMeters) : (row.distancemeters !== null && row.distancemeters !== undefined ? Number(row.distancemeters) : null),
      signature: (row.signature) || undefined,
      offlineHash: (row.offlineHash || row.offlinehash) || undefined,
      createdAt: row.createdAt || row.createdat,
    }));
  },

  async getStaffPerformanceMetrics(): Promise<Array<{
    id: string;
    name: string;
    email: string;
    avatar?: string;
    attendanceCount30Days: number;
    gradesCount30Days: number;
    vaultDocsSubmitted: number;
    vaultDocsApproved: number;
    weeklyWorkload: number;
  }>> {
    const p = getPool();
    const teachers = await this.getUsersByRole(UserRole.TEACHER);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const metricsList = [];
    for (const teacher of teachers) {
      // 1. Attendance marked in last 30 days
      let attendanceCount30Days = 0;
      try {
        const { rows } = await p.query(
          'SELECT COUNT(*) as count FROM attendance_records WHERE "staffId" = $1 AND "createdAt" >= $2',
          [teacher.id, thirtyDaysAgo]
        );
        attendanceCount30Days = parseInt(rows[0]?.count || '0', 10);
      } catch {}

      // 2. Grades submitted in last 30 days
      let gradesCount30Days = 0;
      try {
        const { rows } = await p.query(
          'SELECT COUNT(*) as count FROM grades WHERE "teacherId" = $1 AND "createdAt" >= $2',
          [teacher.id, thirtyDaysAgo]
        );
        gradesCount30Days = parseInt(rows[0]?.count || '0', 10);
      } catch {}

      // 3. Vault docs submitted & approved
      let vaultDocsSubmitted = 0;
      let vaultDocsApproved = 0;
      try {
        const { rows: subRows } = await p.query(
          'SELECT COUNT(*) as count FROM vault_documents WHERE "teacherId" = $1',
          [teacher.id]
        );
        vaultDocsSubmitted = parseInt(subRows[0]?.count || '0', 10);

        const { rows: appRows } = await p.query(
          "SELECT COUNT(*) as count FROM vault_documents WHERE \"teacherId\" = $1 AND status = 'APPROVED'",
          [teacher.id]
        );
        vaultDocsApproved = parseInt(appRows[0]?.count || '0', 10);
      } catch {}

      // 4. Weekly workload (timetable periods assigned)
      let weeklyWorkload = 0;
      try {
        const { rows } = await p.query(
          'SELECT COUNT(*) as count FROM timetables WHERE "teacherId" = $1',
          [teacher.id]
        );
        weeklyWorkload = parseInt(rows[0]?.count || '0', 10);
      } catch {}

      metricsList.push({
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        avatar: teacher.avatar,
        attendanceCount30Days,
        gradesCount30Days,
        vaultDocsSubmitted,
        vaultDocsApproved,
        weeklyWorkload,
      });
    }

    return metricsList;
  },

  // ─── Assessments & Assessment Scores ─────────────────────────────────────
  async createAssessment(data: {
    title: string;
    subject: string;
    className: string;
    teacherId: string;
    maxScore: number;
  }): Promise<Assessment> {
    const p = getPool();
    const id = this.generateId();
    const now = new Date().toISOString();

    await p.query(
      `INSERT INTO assessments (id, title, subject, "className", "teacherId", "maxScore", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, data.title, data.subject, data.className, data.teacherId, data.maxScore, now]
    );

    const created = await this.findAssessmentById(id);
    return created!;
  },

  async findAssessmentById(id: string): Promise<Assessment | null> {
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
        maxScore: Number(row.maxScore ?? row.maxscore),
        createdAt: row.createdAt || row.createdat,
      };
    }
    return null;
  },

  async getAllAssessments(): Promise<Assessment[]> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM assessments ORDER BY "createdAt" DESC');
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      subject: row.subject,
      className: row.className || row.classname,
      teacherId: row.teacherId || row.teacherid,
      maxScore: Number(row.maxScore ?? row.maxscore),
      createdAt: row.createdAt || row.createdat,
    }));
  },

  async saveAssessmentScores(
    assessmentId: string,
    scores: Array<{ studentId: string; score: number; feedback?: string }>
  ): Promise<AssessmentScore[]> {
    const p = getPool();
    const now = new Date().toISOString();
    const results: AssessmentScore[] = [];

    for (const item of scores) {
      const { rows } = await p.query(
        'SELECT id FROM assessment_scores WHERE "assessmentId" = $1 AND "studentId" = $2',
        [assessmentId, item.studentId]
      );

      let scoreId: string;
      if (rows.length > 0) {
        scoreId = rows[0].id;
        await p.query(
          `UPDATE assessment_scores SET score = $1, feedback = $2, "createdAt" = $3 WHERE id = $4`,
          [item.score, item.feedback || '', now, scoreId]
        );
      } else {
        scoreId = this.generateId();
        await p.query(
          `INSERT INTO assessment_scores (id, "assessmentId", "studentId", score, feedback, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [scoreId, assessmentId, item.studentId, item.score, item.feedback || '', now]
        );
      }

      results.push({
        id: scoreId,
        assessmentId,
        studentId: item.studentId,
        score: item.score,
        feedback: item.feedback || '',
        createdAt: now,
      });
    }

    return results;
  },

  async getAssessmentScores(assessmentId: string): Promise<(AssessmentScore & { studentName?: string })[]> {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT s.*, u.name as "studentName" 
       FROM assessment_scores s
       LEFT JOIN users u ON s."studentId" = u.id
       WHERE s."assessmentId" = $1
       ORDER BY s."createdAt" DESC`,
      [assessmentId]
    );

    return rows.map((row) => ({
      id: row.id,
      assessmentId: row.assessmentId || row.assessmentid,
      studentId: row.studentId || row.studentid,
      score: Number(row.score),
      feedback: row.feedback,
      createdAt: row.createdAt || row.createdat,
      studentName: row.studentName ? decryptField(row.studentName) : 'Student',
    }));
  },

  async getStudentAssessmentScores(studentId: string): Promise<(AssessmentScore & { assessment?: Assessment })[]> {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT s.*, a.title, a.subject, a."className", a."teacherId", a."maxScore", a."createdAt" as "assessmentCreatedAt"
       FROM assessment_scores s
       JOIN assessments a ON s."assessmentId" = a.id
       WHERE s."studentId" = $1
       ORDER BY s."createdAt" DESC`,
      [studentId]
    );

    return rows.map((row) => ({
      id: row.id,
      assessmentId: row.assessmentId || row.assessmentid,
      studentId: row.studentId || row.studentid,
      score: Number(row.score),
      feedback: row.feedback,
      createdAt: row.createdAt || row.createdat,
      assessment: {
        id: row.assessmentId || row.assessmentid,
        title: row.title,
        subject: row.subject,
        className: row.className || row.classname,
        teacherId: row.teacherId || row.teacherid,
        maxScore: Number(row.maxScore ?? row.maxscore),
        createdAt: row.assessmentCreatedAt || row.assessmentcreatedat,
      },
    }));
  },

  async getAssessmentReport(assessmentId: string) {
    const assessment = await this.findAssessmentById(assessmentId);
    if (!assessment) return null;

    const scores = await this.getAssessmentScores(assessmentId);
    if (scores.length === 0) {
      return {
        average: 0,
        highest: 0,
        lowest: 0,
        passRate: 0,
        totalStudents: 0,
        maxScore: assessment.maxScore,
      };
    }

    const totalStudents = scores.length;
    const scoreValues = scores.map((s) => s.score);
    const sum = scoreValues.reduce((a, b) => a + b, 0);
    const average = Number((sum / totalStudents).toFixed(1));
    const highest = Math.max(...scoreValues);
    const lowest = Math.min(...scoreValues);
    const passThreshold = assessment.maxScore * 0.5;
    const passingCount = scores.filter((s) => s.score >= passThreshold).length;
    const passRate = Number(((passingCount / totalStudents) * 100).toFixed(1));

    return {
      average,
      highest,
      lowest,
      passRate,
      totalStudents,
      maxScore: assessment.maxScore,
    };
  },

  // ─── Notifications ──────────────────────────────────────────────────────────
  async createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    relatedId?: string
  ): Promise<SystemNotification> {
    const p = getPool();
    const id = this.generateId();
    const createdAt = new Date().toISOString();

    await p.query(
      `INSERT INTO notifications (id, "userId", type, title, message, "relatedId", read, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7)`,
      [id, userId, type, title, message, relatedId || null, createdAt]
    );

    return {
      id,
      userId,
      type: type as any,
      title,
      message,
      relatedId,
      read: false,
      createdAt,
    };
  },

  async createBulkNotifications(
    userIds: string[],
    type: string,
    title: string,
    message: string,
    relatedId?: string
  ): Promise<SystemNotification[]> {
    const notifications: SystemNotification[] = [];
    for (const userId of userIds) {
      notifications.push(await this.createNotification(userId, type, title, message, relatedId));
    }
    return notifications;
  },

  async getUserNotifications(userId: string): Promise<SystemNotification[]> {
    const p = getPool();
    const { rows } = await p.query(
      'SELECT * FROM notifications WHERE "userId" = $1 ORDER BY "createdAt" DESC',
      [userId]
    );

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
  },

  async markNotificationAsRead(id: string, userId: string): Promise<boolean> {
    const p = getPool();
    await p.query('UPDATE notifications SET read = TRUE WHERE id = $1 AND "userId" = $2', [id, userId]);
    return true;
  },

  // ─── Sessions Management ───────────────────────────────────────────────────
  async createSession(userId: string, deviceInfo: string, ipAddress: string, token?: string): Promise<any> {
    const p = getPool();
    const id = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();

    await p.query(
      `INSERT INTO sessions (id, "userId", token, "deviceInfo", "ipAddress", "loginAt", "lastActiveAt", revoked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)`,
      [id, userId, token || null, deviceInfo, ipAddress, now, now]
    );

    return {
      id,
      userId,
      token,
      deviceInfo,
      ipAddress,
      loginAt: now,
      lastActiveAt: now,
      revoked: false,
    };
  },

  async getUserSessions(userId: string): Promise<any[]> {
    const p = getPool();
    const { rows } = await p.query(
      'SELECT * FROM sessions WHERE "userId" = $1 AND (revoked IS NULL OR revoked = FALSE) ORDER BY "lastActiveAt" DESC',
      [userId]
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId || row.userid,
      token: (row.token) || undefined,
      deviceInfo: row.deviceInfo || row.deviceinfo,
      ipAddress: row.ipAddress || row.ipaddress,
      loginAt: row.loginAt || row.loginat,
      lastActiveAt: row.lastActiveAt || row.lastactiveat,
      revoked: Boolean(row.revoked),
    }));
  },

  async getSessionById(sessionId: string): Promise<any | null> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      userId: row.userId || row.userid,
      token: (row.token) || undefined,
      deviceInfo: row.deviceInfo || row.deviceinfo,
      ipAddress: row.ipAddress || row.ipaddress,
      loginAt: row.loginAt || row.loginat,
      lastActiveAt: row.lastActiveAt || row.lastactiveat,
      revoked: Boolean(row.revoked),
    };
  },

  async revokeSession(sessionId: string, userId?: string): Promise<any | null> {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    if (userId && session.userId !== userId) return null;

    const p = getPool();
    await p.query('UPDATE sessions SET revoked = TRUE WHERE id = $1', [sessionId]);
    return session;
  },

  async revokeAllUserSessions(userId: string): Promise<void> {
    const p = getPool();
    await p.query('UPDATE sessions SET revoked = TRUE WHERE "userId" = $1', [userId]);
  },

  async updateSessionActivity(sessionId: string): Promise<void> {
    const p = getPool();
    const now = new Date().toISOString();
    await p.query('UPDATE sessions SET "lastActiveAt" = $1 WHERE id = $2', [now, sessionId]);
  },

  // ─── Attendance Sync Queue DB Helpers ─────────────────────────────────────
  async addToSyncQueue(item: SyncQueueRecord): Promise<SyncQueueRecord> {
    const p = getPool();
    const now = new Date().toISOString();
    const createdAt = item.createdAt || now;

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

    return {
      ...item,
      queuedAt: item.queuedAt || now,
      createdAt,
    };
  },

  async getSyncQueue(): Promise<SyncQueueRecord[]> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM attendance_sync_queue ORDER BY "createdAt" ASC');
    return rows.map((row) => ({
      id: row.id,
      staffId: row.staffId || row.staffid,
      staffName: (row.staffName || row.staffname) || undefined,
      date: row.date,
      time: (row.time) || undefined,
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
  },

  async getSyncQueueSize(): Promise<number> {
    const p = getPool();
    const { rows } = await p.query('SELECT COUNT(*) as count FROM attendance_sync_queue');
    return parseInt(rows[0]?.count || '0', 10);
  },

  async getSyncQueueItem(id: string): Promise<SyncQueueRecord | null> {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM attendance_sync_queue WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      staffId: row.staffId || row.staffid,
      staffName: (row.staffName || row.staffname) || undefined,
      date: row.date,
      time: (row.time) || undefined,
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
  },

  async deleteFromSyncQueue(id: string): Promise<boolean> {
    const p = getPool();
    const result = await p.query('DELETE FROM attendance_sync_queue WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },

  async clearSyncQueue(): Promise<void> {
    const p = getPool();
    await p.query('DELETE FROM attendance_sync_queue');
  },

  // ─── Database Cleanup ──────────────────────────────────────────────────────
  async close(): Promise<void> {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};
