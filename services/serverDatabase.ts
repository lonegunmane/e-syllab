import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { encryptField, decryptField } from './encryption';
import { User, UserRole, CurriculumResource, ResourceCategory, Message, GradeRecord, VaultDocument, DocumentStatus, AuthCredential, TimetableEntry, Assessment, AssessmentScore, SystemNotification } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'data', 'esylab.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let sqlDb: SqlJsDatabase;
let SQL: any;

/**
 * Server Database Service using sql.js
 * Manages all persistent data in SQLite
 */
export const serverDb = {
  // ─── Initialization ────────────────────────────────────────────────────────
  async init(): Promise<void> {
    // Initialize sql.js
    if (!SQL) {
      SQL = await initSqlJs();
    }

    // Load existing database or create new one
    if (fs.existsSync(dbPath)) {
      const buf = fs.readFileSync(dbPath);
      sqlDb = new SQL.Database(buf);
    } else {
      sqlDb = new SQL.Database();
    }

    this.createTables();
    this.seedInitialData();
    this.seedTimetables();
    this.save();
  },

  save(): void {
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  },

  createTables(): void {
    // Users table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('STUDENT', 'TEACHER', 'ADMIN')),
        avatar TEXT,
        blockchainId TEXT,
        contact TEXT,
        school TEXT,
        gender TEXT,
        residentialAddress TEXT,
        teachingGrades TEXT,
        teachingClasses TEXT,
        teachingSubjects TEXT,
        grade TEXT,
        className TEXT,
        enrolledSubjects TEXT,
        isProfileComplete BOOLEAN DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // Auth credentials table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS auth_credentials (
        userId TEXT PRIMARY KEY,
        passwordHash TEXT NOT NULL,
        lastLogin TEXT,
        passwordResetRequired BOOLEAN DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Curriculum resources table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS curriculum_resources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        gradeLevel TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL CHECK(category IN ('DOCUMENT', 'ANNOUNCEMENT')),
        authorRole TEXT NOT NULL CHECK(authorRole IN ('STUDENT', 'TEACHER', 'ADMIN')),
        uploadedById TEXT,
        uploadedByName TEXT,
        fileName TEXT,
        fileType TEXT,
        fileData BLOB,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (uploadedById) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Messages table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        senderId TEXT NOT NULL,
        senderName TEXT NOT NULL,
        recipientId TEXT,
        recipientName TEXT,
        subject TEXT,
        content TEXT NOT NULL,
        \`read\` BOOLEAN DEFAULT 0,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (senderId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (recipientId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Grades table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS grades (
        id TEXT PRIMARY KEY,
        studentId TEXT NOT NULL,
        teacherId TEXT NOT NULL,
        subject TEXT NOT NULL,
        grade REAL NOT NULL,
        feedback TEXT,
        recordedAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (studentId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (teacherId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Vault documents table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS vault_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
        teacherId TEXT NOT NULL,
        teacherName TEXT NOT NULL,
        fileName TEXT,
        fileType TEXT,
        fileData BLOB,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (teacherId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Timetables table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS timetables (
        id TEXT PRIMARY KEY,
        className TEXT NOT NULL,
        dayOfWeek TEXT NOT NULL,
        period TEXT NOT NULL,
        subject TEXT NOT NULL,
        teacherId TEXT,
        room TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // Attendance records table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id TEXT PRIMARY KEY,
        staffId TEXT NOT NULL,
        staffName TEXT,
        date TEXT NOT NULL,
        time TEXT,
        className TEXT,
        status TEXT NOT NULL,
        schoolId TEXT,
        createdAt TEXT NOT NULL
      )
    `);

    // Assessments table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS assessments (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        className TEXT NOT NULL,
        teacherId TEXT NOT NULL,
        maxScore REAL NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (teacherId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Assessment scores table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS assessment_scores (
        id TEXT PRIMARY KEY,
        assessmentId TEXT NOT NULL,
        studentId TEXT NOT NULL,
        score REAL NOT NULL,
        feedback TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (assessmentId) REFERENCES assessments(id) ON DELETE CASCADE,
        FOREIGN KEY (studentId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Notifications table
    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        relatedId TEXT,
        read INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  },

  seedInitialData(): void {
    try {
      // Check if admin exists
      const stmt = sqlDb.prepare('SELECT id FROM users WHERE email = ?');
      stmt.bind(['admin@gmail.com']);
      const hasAdmin = stmt.step();
      stmt.free();

      if (hasAdmin) {
        return; // Already seeded
      }

      const adminId = '3';
      const now = new Date().toISOString();
      const passwordHash = bcrypt.hashSync('1357', 10);

      // Insert admin user
      let insertStmt = sqlDb.prepare(`
        INSERT INTO users (id, email, name, role, avatar, blockchainId, contact, school, gender, residentialAddress, isProfileComplete, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.bind([
        adminId,
        'admin@gmail.com',
        encryptField('Primary Admin'),
        'ADMIN',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
        'sol-genesis-block-3-admin',
        encryptField('777-888-9999'),
        'ESYLAB Headquarters',
        encryptField('Prefer not to say'),
        encryptField('789 Pine Rd, Capital City'),
        1,
        now,
        now,
      ]);
      insertStmt.step();
      insertStmt.free();

      // Insert admin credentials
      insertStmt = sqlDb.prepare(`
        INSERT INTO auth_credentials (userId, passwordHash, passwordResetRequired, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertStmt.bind([adminId, passwordHash, 1, now, now]);
      insertStmt.step();
      insertStmt.free();

      // Insert sample curriculum
      insertStmt = sqlDb.prepare(`
        INSERT INTO curriculum_resources (id, title, subject, gradeLevel, description, category, authorRole, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.bind([
        'curr-1',
        'Mathematics Core Syllabus 2025',
        'Mathematics',
        'Grade 10',
        'Official 2025 syllabus for Algebra and Geometry fundamentals. Includes learning objectives and required textbooks.',
        'DOCUMENT',
        'ADMIN',
        now,
        now,
      ]);
      insertStmt.step();
      insertStmt.free();

      console.log('[Database] Seeded initial data');
    } catch (err) {
      console.error('[Database] Seeding error:', err);
    }
  },

  seedTimetables(): void {
    try {
      // The timetable must start completely empty for every class
      sqlDb.run('DELETE FROM timetables');
      this.save();
    } catch (err) {
      console.error('[Database] Timetable clearing error:', err);
    }
  },

  // ─── User Operations ───────────────────────────────────────────────────────
  findUserByEmail(email: string): User | null {
    const stmt = sqlDb.prepare('SELECT * FROM users WHERE email = ?');
    stmt.bind([email]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.rowToUser(row as any);
    }

    stmt.free();
    return null;
  },

  findUserById(id: string): User | null {
    const stmt = sqlDb.prepare('SELECT * FROM users WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.rowToUser(row as any);
    }

    stmt.free();
    return null;
  },

  ensureUser(user: Partial<User>): User {
    if (user.id) {
      const found = this.findUserById(user.id);
      if (found) return found;
    }
    if (user.email) {
      const found = this.findUserByEmail(user.email);
      if (found) return found;
    }

    const userId = user.id || this.generateId();
    const now = new Date().toISOString();

    const contact = user.contact ? encryptField(user.contact) : null;
    const gender = user.gender ? encryptField(user.gender) : null;
    const residentialAddress = user.residentialAddress ? encryptField(user.residentialAddress) : null;

    const insertStmt = sqlDb.prepare(`
      INSERT INTO users (id, email, name, role, avatar, contact, gender, residentialAddress, isProfileComplete, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.bind([
      userId,
      user.email || `${userId}@esylab.school`,
      encryptField(user.name || 'User'),
      user.role || UserRole.TEACHER,
      user.avatar || '',
      contact,
      gender,
      residentialAddress,
      user.isProfileComplete ? 1 : 0,
      now,
      now,
    ]);
    insertStmt.step();
    insertStmt.free();
    this.save();

    return this.findUserById(userId)!;
  },

  getAllUsers(): User[] {
    const stmt = sqlDb.prepare('SELECT * FROM users ORDER BY createdAt DESC');
    const users: User[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      users.push(this.rowToUser(row as any));
    }

    stmt.free();
    return users;
  },

  getUsersByRole(role: UserRole): User[] {
    const stmt = sqlDb.prepare('SELECT * FROM users WHERE role = ? ORDER BY createdAt DESC');
    stmt.bind([role]);

    const users: User[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      users.push(this.rowToUser(row as any));
    }

    stmt.free();
    return users;
  },

  updateUserProfile(userId: string, updates: Partial<User>): User | null {
    const user = this.findUserById(userId);
    if (!user) return null;

    const now = new Date().toISOString();
    const validKeys = ['name', 'avatar', 'contact', 'school', 'gender', 'residentialAddress', 'teachingGrades', 'teachingClasses', 'teachingSubjects', 'grade', 'className', 'enrolledSubjects', 'isProfileComplete'];
    const encryptedKeys = ['name', 'contact', 'residentialAddress', 'gender'];

    for (let [key, value] of Object.entries(updates)) {
      if (!validKeys.includes(key)) continue;

      if (value !== undefined && value !== null && encryptedKeys.includes(key) && typeof value === 'string') {
        value = encryptField(value);
      }

      let updateStmt: any;
      if (Array.isArray(value)) {
        updateStmt = sqlDb.prepare(`UPDATE users SET ${key} = ?, updatedAt = ? WHERE id = ?`);
        updateStmt.bind([JSON.stringify(value), now, userId]);
      } else {
        updateStmt = sqlDb.prepare(`UPDATE users SET ${key} = ?, updatedAt = ? WHERE id = ?`);
        updateStmt.bind([value, now, userId]);
      }
      updateStmt.step();
      updateStmt.free();
    }

    this.save();
    return this.findUserById(userId);
  },

  async registerUser(user: Omit<User, 'id'>, password: string): Promise<User> {
    const existingUser = this.findUserByEmail(user.email);
    if (existingUser) {
      throw new Error('Email already exists');
    }

    if (user.role === UserRole.ADMIN) {
      const adminCount = this.getUsersByRole(UserRole.ADMIN).length;
      if (adminCount >= 2) {
        throw new Error('Maximum of 2 administrator accounts allowed');
      }
    }

    const userId = this.generateId();
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash(password, 10);

    const contact = user.contact ? encryptField(user.contact) : null;
    const gender = user.gender ? encryptField(user.gender) : null;
    const residentialAddress = user.residentialAddress ? encryptField(user.residentialAddress) : null;

    const insertStmt = sqlDb.prepare(`
      INSERT INTO users (id, email, name, role, avatar, contact, gender, residentialAddress, isProfileComplete, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.bind([
      userId,
      user.email,
      encryptField(user.name),
      user.role,
      user.avatar || '',
      contact,
      gender,
      residentialAddress,
      user.role === UserRole.ADMIN ? 1 : 0,
      now,
      now,
    ]);
    insertStmt.step();
    insertStmt.free();

    const credStmt = sqlDb.prepare(`
      INSERT INTO auth_credentials (userId, passwordHash, createdAt, updatedAt)
      VALUES (?, ?, ?, ?)
    `);
    credStmt.bind([userId, passwordHash, now, now]);
    credStmt.step();
    credStmt.free();

    this.save();
    return this.findUserById(userId)!;
  },

  deleteUser(userId: string): void {
    const stmt = sqlDb.prepare('DELETE FROM users WHERE id = ?');
    stmt.bind([userId]);
    stmt.step();
    stmt.free();
    this.save();
  },

  // ─── Authentication ────────────────────────────────────────────────────────
  async authenticateUser(email: string, password: string): Promise<{ user: User; needsPasswordReset: boolean } | null> {
    const user = this.findUserByEmail(email);
    if (!user) return null;

    const stmt = sqlDb.prepare('SELECT * FROM auth_credentials WHERE userId = ?');
    stmt.bind([user.id]);

    let cred = null;
    if (stmt.step()) {
      cred = stmt.getAsObject();
    }
    stmt.free();

    if (!cred) return null;

    const passwordMatch = await bcrypt.compare(password, (cred as any).passwordHash);
    if (!passwordMatch) return null;

    // Update lastLogin
    const updateStmt = sqlDb.prepare('UPDATE auth_credentials SET lastLogin = ? WHERE userId = ?');
    updateStmt.bind([new Date().toISOString(), user.id]);
    updateStmt.step();
    updateStmt.free();
    this.save();

    return { user, needsPasswordReset: !!(cred as any).passwordResetRequired };
  },

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date().toISOString();

    const stmt = sqlDb.prepare(`
      UPDATE auth_credentials SET passwordHash = ?, passwordResetRequired = 0, updatedAt = ? WHERE userId = ?
    `);
    stmt.bind([passwordHash, now, userId]);
    stmt.step();
    stmt.free();
    this.save();
  },

  getCredentialByUserId(userId: string): AuthCredential | null {
    const stmt = sqlDb.prepare('SELECT * FROM auth_credentials WHERE userId = ?');
    stmt.bind([userId]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return { ...row, lastLogin: (row as any).lastLogin || null } as unknown as AuthCredential;
    }

    stmt.free();
    return null;
  },

  // ─── Curriculum ────────────────────────────────────────────────────────────
  getAllCurriculum(): CurriculumResource[] {
    const stmt = sqlDb.prepare('SELECT * FROM curriculum_resources ORDER BY createdAt DESC');
    const resources: CurriculumResource[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      resources.push(this.rowToCurriculum(row as any));
    }

    stmt.free();
    return resources;
  },

  addCurriculum(resource: Omit<CurriculumResource, 'id' | 'createdAt'>): CurriculumResource {
    const id = this.generateId();
    const now = new Date().toISOString();

    const stmt = sqlDb.prepare(`
      INSERT INTO curriculum_resources (id, title, subject, gradeLevel, description, category, authorRole, uploadedById, uploadedByName, fileName, fileType, fileData, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([
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
    ]);
    stmt.step();
    stmt.free();
    this.save();

    return this.findCurriculumById(id)!;
  },

  findCurriculumById(id: string): CurriculumResource | null {
    const stmt = sqlDb.prepare('SELECT * FROM curriculum_resources WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.rowToCurriculum(row as any);
    }

    stmt.free();
    return null;
  },

  // ─── Messages ──────────────────────────────────────────────────────────────
  sendMessage(message: Omit<Message, 'id' | 'read' | 'createdAt'>): Message {
    const id = this.generateId();
    const now = new Date().toISOString();

    const stmt = sqlDb.prepare(`
      INSERT INTO messages (id, senderId, senderName, recipientId, recipientName, subject, content, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([
      id,
      message.senderId,
      message.senderName,
      message.recipientId || null,
      message.recipientName || null,
      message.subject || '',
      message.content,
      now,
    ]);
    stmt.step();
    stmt.free();
    this.save();

    return this.findMessageById(id)!;
  },

  findMessageById(id: string): Message | null {
    const stmt = sqlDb.prepare('SELECT * FROM messages WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.rowToMessage(row as any);
    }

    stmt.free();
    return null;
  },

  getUserMessages(userId: string): Message[] {
    const stmt = sqlDb.prepare(`
      SELECT * FROM messages WHERE senderId = ? OR recipientId = ? ORDER BY createdAt DESC
    `);
    stmt.bind([userId, userId]);

    const messages: Message[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      messages.push(this.rowToMessage(row as any));
    }

    stmt.free();
    return messages;
  },

  // ─── Grades ────────────────────────────────────────────────────────────────
  recordGrade(grade: Omit<GradeRecord, 'id' | 'createdAt'>): GradeRecord {
    const id = this.generateId();
    const now = new Date().toISOString();

    const stmt = sqlDb.prepare(`
      INSERT INTO grades (id, studentId, teacherId, subject, grade, feedback, recordedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([
      id,
      grade.studentId,
      grade.teacherId,
      grade.subject,
      grade.grade,
      grade.feedback || '',
      grade.recordedAt,
      now,
    ]);
    stmt.step();
    stmt.free();
    this.save();

    return this.findGradeById(id)!;
  },

  findGradeById(id: string): GradeRecord | null {
    const stmt = sqlDb.prepare('SELECT * FROM grades WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.rowToGrade(row as any);
    }

    stmt.free();
    return null;
  },

  getStudentGrades(studentId: string): GradeRecord[] {
    const stmt = sqlDb.prepare('SELECT * FROM grades WHERE studentId = ? ORDER BY recordedAt DESC');
    stmt.bind([studentId]);

    const grades: GradeRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      grades.push(this.rowToGrade(row as any));
    }

    stmt.free();
    return grades;
  },

  // ─── Vault Documents ───────────────────────────────────────────────────────
  addVaultDocument(doc: Omit<VaultDocument, 'id' | 'createdAt'>): VaultDocument {
    const id = this.generateId();
    const now = new Date().toISOString();

    const stmt = sqlDb.prepare(`
      INSERT INTO vault_documents (id, title, type, status, teacherId, teacherName, fileName, fileType, fileData, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([
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
    ]);
    stmt.step();
    stmt.free();
    this.save();

    return this.findVaultDocById(id)!;
  },

  findVaultDocById(id: string): VaultDocument | null {
    const stmt = sqlDb.prepare('SELECT * FROM vault_documents WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.rowToVaultDocument(row as any);
    }

    stmt.free();
    return null;
  },

  getAllVaultDocuments(): VaultDocument[] {
    const stmt = sqlDb.prepare('SELECT * FROM vault_documents ORDER BY createdAt DESC');
    const docs: VaultDocument[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      docs.push(this.rowToVaultDocument(row as any));
    }

    stmt.free();
    return docs;
  },

  // ─── Timetable Operations ──────────────────────────────────────────────────
  getAllTimetables(): TimetableEntry[] {
    const stmt = sqlDb.prepare('SELECT * FROM timetables ORDER BY className, dayOfWeek, period');
    const items: TimetableEntry[] = [];
    while (stmt.step()) {
      items.push(this.rowToTimetable(stmt.getAsObject()));
    }
    stmt.free();
    return items;
  },

  getTimetablesByClass(className: string): TimetableEntry[] {
    const stmt = sqlDb.prepare('SELECT * FROM timetables WHERE className = ? ORDER BY dayOfWeek, period');
    stmt.bind([className]);
    const items: TimetableEntry[] = [];
    while (stmt.step()) {
      items.push(this.rowToTimetable(stmt.getAsObject()));
    }
    stmt.free();
    return items;
  },

  getTimetableById(id: string): TimetableEntry | null {
    const stmt = sqlDb.prepare('SELECT * FROM timetables WHERE id = ?');
    stmt.bind([id]);
    let found: TimetableEntry | null = null;
    if (stmt.step()) {
      found = this.rowToTimetable(stmt.getAsObject());
    }
    stmt.free();
    return found;
  },

  createTimetableEntry(entry: {
    id?: string;
    className: string;
    dayOfWeek: string;
    period: string;
    subject: string;
    teacherId?: string;
    room?: string;
  }): TimetableEntry {
    const id = entry.id || this.generateId();
    const now = new Date().toISOString();

    const stmt = sqlDb.prepare(`
      INSERT INTO timetables (id, className, dayOfWeek, period, subject, teacherId, room, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([
      id,
      entry.className,
      entry.dayOfWeek,
      entry.period,
      entry.subject,
      entry.teacherId || '',
      entry.room || '',
      now,
      now,
    ]);
    stmt.step();
    stmt.free();
    this.save();

    return this.getTimetableById(id)!;
  },

  updateTimetableEntry(id: string, updates: Partial<TimetableEntry>): TimetableEntry | null {
    const existing = this.getTimetableById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const className = updates.className !== undefined ? updates.className : existing.className;
    const dayOfWeek = updates.dayOfWeek !== undefined ? updates.dayOfWeek : existing.dayOfWeek;
    const period = updates.period !== undefined ? updates.period : existing.period;
    const subject = updates.subject !== undefined ? updates.subject : existing.subject;
    const teacherId = updates.teacherId !== undefined ? updates.teacherId : (existing.teacherId || '');
    const room = updates.room !== undefined ? updates.room : (existing.room || '');

    const stmt = sqlDb.prepare(`
      UPDATE timetables
      SET className = ?, dayOfWeek = ?, period = ?, subject = ?, teacherId = ?, room = ?, updatedAt = ?
      WHERE id = ?
    `);
    stmt.bind([className, dayOfWeek, period, subject, teacherId, room, now, id]);
    stmt.step();
    stmt.free();
    this.save();

    return this.getTimetableById(id);
  },

  deleteTimetableEntry(id: string): boolean {
    const stmt = sqlDb.prepare('DELETE FROM timetables WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    stmt.free();
    this.save();
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
    return {
      id: row.id,
      email: row.email,
      name: decryptField(row.name || ''),
      role: row.role as UserRole,
      avatar: row.avatar,
      blockchainId: row.blockchainId,
      contact: row.contact ? decryptField(row.contact) : undefined,
      school: row.school,
      gender: row.gender ? (decryptField(row.gender) as any) : undefined,
      residentialAddress: row.residentialAddress ? decryptField(row.residentialAddress) : undefined,
      teachingGrades: row.teachingGrades ? JSON.parse(row.teachingGrades) : undefined,
      teachingClasses: row.teachingClasses ? JSON.parse(row.teachingClasses) : undefined,
      teachingSubjects: row.teachingSubjects ? JSON.parse(row.teachingSubjects) : undefined,
      grade: row.grade,
      className: row.className,
      enrolledSubjects: row.enrolledSubjects ? JSON.parse(row.enrolledSubjects) : undefined,
      isProfileComplete: Boolean(row.isProfileComplete),
    };
  },

  rowToCurriculum(row: any): CurriculumResource {
    return {
      id: row.id,
      title: row.title,
      subject: row.subject,
      gradeLevel: row.gradeLevel,
      description: row.description,
      category: row.category as ResourceCategory,
      authorRole: row.authorRole as UserRole,
      uploadedById: row.uploadedById,
      uploadedByName: row.uploadedByName,
      createdAt: row.createdAt,
      fileName: row.fileName,
      fileType: row.fileType,
      fileData: row.fileData,
    };
  },

  rowToMessage(row: any): Message {
    return {
      id: row.id,
      senderId: row.senderId,
      senderName: row.senderName,
      recipientId: row.recipientId,
      recipientName: row.recipientName,
      subject: row.subject,
      content: row.content,
      read: Boolean(row.read),
      createdAt: row.createdAt,
    };
  },

  rowToGrade(row: any): GradeRecord {
    return {
      id: row.id,
      studentId: row.studentId,
      teacherId: row.teacherId,
      subject: row.subject,
      grade: row.grade,
      feedback: row.feedback,
      recordedAt: row.recordedAt,
      createdAt: row.createdAt,
    };
  },

  rowToVaultDocument(row: any): VaultDocument {
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status as DocumentStatus,
      teacherId: row.teacherId,
      teacherName: row.teacherName,
      createdAt: row.createdAt,
      fileName: row.fileName,
      fileType: row.fileType,
      fileData: row.fileData,
    };
  },

  rowToTimetable(row: any): TimetableEntry {
    let teacherName: string | undefined = undefined;
    if (row.teacherId) {
      const teacher = this.findUserById(row.teacherId);
      if (teacher) teacherName = teacher.name;
    }

    return {
      id: row.id,
      className: row.className,
      dayOfWeek: row.dayOfWeek,
      period: row.period,
      subject: row.subject,
      teacherId: row.teacherId || undefined,
      teacherName,
      room: row.room || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  // ─── Staff Performance & Attendance DB Helpers ─────────────────────────────
  recordAttendance(record: { staffId: string; staffName?: string; date: string; time?: string; className?: string; status: string; schoolId?: string }): void {
    const id = this.generateId();
    const now = new Date().toISOString();
    try {
      const stmt = sqlDb.prepare(`
        INSERT INTO attendance_records (id, staffId, staffName, date, time, className, status, schoolId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.bind([
        id,
        record.staffId,
        record.staffName || null,
        record.date,
        record.time || null,
        record.className || null,
        record.status,
        record.schoolId || null,
        now,
      ]);
      stmt.step();
      stmt.free();
      this.save();
    } catch (err) {
      console.error('[Database] Attendance insert error:', err);
    }
  },

  getStaffPerformanceMetrics(): Array<{
    id: string;
    name: string;
    email: string;
    avatar?: string;
    attendanceCount30Days: number;
    gradesCount30Days: number;
    vaultDocsSubmitted: number;
    vaultDocsApproved: number;
    weeklyWorkload: number;
  }> {
    const teachers = this.getUsersByRole(UserRole.TEACHER);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    return teachers.map(teacher => {
      // 1. Attendance marked in last 30 days
      let attendanceCount30Days = 0;
      try {
        const stmt = sqlDb.prepare('SELECT COUNT(*) as count FROM attendance_records WHERE staffId = ? AND createdAt >= ?');
        stmt.bind([teacher.id, thirtyDaysAgo]);
        if (stmt.step()) {
          attendanceCount30Days = (stmt.getAsObject() as any).count || 0;
        }
        stmt.free();
      } catch {}

      // 2. Grades submitted in last 30 days
      let gradesCount30Days = 0;
      try {
        const stmt = sqlDb.prepare('SELECT COUNT(*) as count FROM grades WHERE teacherId = ? AND createdAt >= ?');
        stmt.bind([teacher.id, thirtyDaysAgo]);
        if (stmt.step()) {
          gradesCount30Days = (stmt.getAsObject() as any).count || 0;
        }
        stmt.free();
      } catch {}

      // 3. Vault docs submitted & approved
      let vaultDocsSubmitted = 0;
      let vaultDocsApproved = 0;
      try {
        const stmtSubmitted = sqlDb.prepare('SELECT COUNT(*) as count FROM vault_documents WHERE teacherId = ?');
        stmtSubmitted.bind([teacher.id]);
        if (stmtSubmitted.step()) {
          vaultDocsSubmitted = (stmtSubmitted.getAsObject() as any).count || 0;
        }
        stmtSubmitted.free();

        const stmtApproved = sqlDb.prepare("SELECT COUNT(*) as count FROM vault_documents WHERE teacherId = ? AND status = 'APPROVED'");
        stmtApproved.bind([teacher.id]);
        if (stmtApproved.step()) {
          vaultDocsApproved = (stmtApproved.getAsObject() as any).count || 0;
        }
        stmtApproved.free();
      } catch {}

      // 4. Weekly workload (timetable periods assigned)
      let weeklyWorkload = 0;
      try {
        const stmtWorkload = sqlDb.prepare('SELECT COUNT(*) as count FROM timetables WHERE teacherId = ?');
        stmtWorkload.bind([teacher.id]);
        if (stmtWorkload.step()) {
          weeklyWorkload = (stmtWorkload.getAsObject() as any).count || 0;
        }
        stmtWorkload.free();
      } catch {}

      return {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        avatar: teacher.avatar,
        attendanceCount30Days,
        gradesCount30Days,
        vaultDocsSubmitted,
        vaultDocsApproved,
        weeklyWorkload,
      };
    });
  },

  // ─── Assessments & Assessment Scores ─────────────────────────────────────
  createAssessment(data: { title: string; subject: string; className: string; teacherId: string; maxScore: number }): Assessment {
    const id = this.generateId();
    const now = new Date().toISOString();

    const stmt = sqlDb.prepare(`
      INSERT INTO assessments (id, title, subject, className, teacherId, maxScore, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([
      id,
      data.title,
      data.subject,
      data.className,
      data.teacherId,
      data.maxScore,
      now,
    ]);
    stmt.step();
    stmt.free();
    this.save();

    return this.findAssessmentById(id)!;
  },

  findAssessmentById(id: string): Assessment | null {
    const stmt = sqlDb.prepare('SELECT * FROM assessments WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return {
        id: row.id as string,
        title: row.title as string,
        subject: row.subject as string,
        className: row.className as string,
        teacherId: row.teacherId as string,
        maxScore: Number(row.maxScore),
        createdAt: row.createdAt as string,
      };
    }

    stmt.free();
    return null;
  },

  getAllAssessments(): Assessment[] {
    const stmt = sqlDb.prepare('SELECT * FROM assessments ORDER BY createdAt DESC');
    const items: Assessment[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      items.push({
        id: row.id as string,
        title: row.title as string,
        subject: row.subject as string,
        className: row.className as string,
        teacherId: row.teacherId as string,
        maxScore: Number(row.maxScore),
        createdAt: row.createdAt as string,
      });
    }
    stmt.free();
    return items;
  },

  saveAssessmentScores(assessmentId: string, scores: Array<{ studentId: string; score: number; feedback?: string }>): AssessmentScore[] {
    const now = new Date().toISOString();
    const results: AssessmentScore[] = [];

    for (const item of scores) {
      const checkStmt = sqlDb.prepare('SELECT id FROM assessment_scores WHERE assessmentId = ? AND studentId = ?');
      checkStmt.bind([assessmentId, item.studentId]);
      let scoreId: string | null = null;
      if (checkStmt.step()) {
        scoreId = checkStmt.getAsObject().id as string;
      }
      checkStmt.free();

      if (scoreId) {
        const updateStmt = sqlDb.prepare(`
          UPDATE assessment_scores SET score = ?, feedback = ?, createdAt = ? WHERE id = ?
        `);
        updateStmt.bind([item.score, item.feedback || '', now, scoreId]);
        updateStmt.step();
        updateStmt.free();
      } else {
        scoreId = this.generateId();
        const insertStmt = sqlDb.prepare(`
          INSERT INTO assessment_scores (id, assessmentId, studentId, score, feedback, createdAt)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertStmt.bind([scoreId, assessmentId, item.studentId, item.score, item.feedback || '', now]);
        insertStmt.step();
        insertStmt.free();
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

    this.save();
    return results;
  },

  getAssessmentScores(assessmentId: string): (AssessmentScore & { studentName?: string })[] {
    const stmt = sqlDb.prepare(`
      SELECT s.*, u.name as studentName 
      FROM assessment_scores s
      LEFT JOIN users u ON s.studentId = u.id
      WHERE s.assessmentId = ?
      ORDER BY s.createdAt DESC
    `);
    stmt.bind([assessmentId]);

    const items: (AssessmentScore & { studentName?: string })[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      items.push({
        id: row.id as string,
        assessmentId: row.assessmentId as string,
        studentId: row.studentId as string,
        score: Number(row.score),
        feedback: row.feedback as string,
        createdAt: row.createdAt as string,
        studentName: row.studentName ? decryptField(row.studentName as string) : 'Student',
      });
    }
    stmt.free();
    return items;
  },

  getStudentAssessmentScores(studentId: string): (AssessmentScore & { assessment?: Assessment })[] {
    const stmt = sqlDb.prepare(`
      SELECT s.*, a.title, a.subject, a.className, a.teacherId, a.maxScore, a.createdAt as assessmentCreatedAt
      FROM assessment_scores s
      JOIN assessments a ON s.assessmentId = a.id
      WHERE s.studentId = ?
      ORDER BY s.createdAt DESC
    `);
    stmt.bind([studentId]);

    const items: (AssessmentScore & { assessment?: Assessment })[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      items.push({
        id: row.id as string,
        assessmentId: row.assessmentId as string,
        studentId: row.studentId as string,
        score: Number(row.score),
        feedback: row.feedback as string,
        createdAt: row.createdAt as string,
        assessment: {
          id: row.assessmentId as string,
          title: row.title as string,
          subject: row.subject as string,
          className: row.className as string,
          teacherId: row.teacherId as string,
          maxScore: Number(row.maxScore),
          createdAt: row.assessmentCreatedAt as string,
        },
      });
    }
    stmt.free();
    return items;
  },

  getAssessmentReport(assessmentId: string) {
    const assessment = this.findAssessmentById(assessmentId);
    if (!assessment) return null;

    const scores = this.getAssessmentScores(assessmentId);
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
    const scoreValues = scores.map(s => s.score);
    const sum = scoreValues.reduce((a, b) => a + b, 0);
    const average = Number((sum / totalStudents).toFixed(1));
    const highest = Math.max(...scoreValues);
    const lowest = Math.min(...scoreValues);
    const passThreshold = assessment.maxScore * 0.5;
    const passingCount = scores.filter(s => s.score >= passThreshold).length;
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
  createNotification(userId: string, type: string, title: string, message: string, relatedId?: string): SystemNotification {
    const id = this.generateId();
    const createdAt = new Date().toISOString();
    const stmt = sqlDb.prepare(`
      INSERT INTO notifications (id, userId, type, title, message, relatedId, read, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `);
    stmt.bind([id, userId, type, title, message, relatedId || null, createdAt]);
    stmt.step();
    stmt.free();
    this.save();
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

  createBulkNotifications(userIds: string[], type: string, title: string, message: string, relatedId?: string): SystemNotification[] {
    const notifications: SystemNotification[] = [];
    for (const userId of userIds) {
      notifications.push(this.createNotification(userId, type, title, message, relatedId));
    }
    return notifications;
  },

  getUserNotifications(userId: string): SystemNotification[] {
    const stmt = sqlDb.prepare('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC');
    stmt.bind([userId]);
    const items: SystemNotification[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      items.push({
        id: row.id as string,
        userId: row.userId as string,
        type: row.type as any,
        title: row.title as string,
        message: row.message as string,
        relatedId: (row.relatedId as string) || undefined,
        read: Boolean(row.read),
        createdAt: row.createdAt as string,
      });
    }
    stmt.free();
    return items;
  },

  markNotificationAsRead(id: string, userId: string): boolean {
    const stmt = sqlDb.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND userId = ?');
    stmt.bind([id, userId]);
    stmt.step();
    stmt.free();
    this.save();
    return true;
  },

  // ─── Database Cleanup ──────────────────────────────────────────────────────
  close(): void {
    // sql.js doesn't need explicit closing, but save final state
    this.save();
  },
};
