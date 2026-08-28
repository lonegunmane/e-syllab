import { User, UserRole, CurriculumResource, Message, GradeRecord, ResourceCategory, VaultDocument, DocumentStatus, Assignment } from '../types';
import { blockchainService } from './blockchain';
import { validatePassword } from './passwordValidation';
import bcrypt from 'bcryptjs';

// Interface matching the 'auth_credentials' table
export interface AuthCredential {
  userId: string; // Foreign Key
  passwordHash: string;
  lastLogin: string | null;
  createdAt: string;
  passwordResetRequired?: boolean;
}

/**
 * Database Service
 * Simulates a relational database engine using localStorage
 */
export const db = {
  // Table definitions
  tables: {
    USERS: 'esylab_db_users',
    CREDENTIALS: 'esylab_db_credentials',
    CURRICULUM: 'esylab_db_curriculum',
    MESSAGES: 'esylab_db_messages',
    GRADES: 'esylab_db_grades',
    VAULT: 'esylab_db_vault',
    ASSIGNMENTS: 'esylab_db_assignments'
  },

  // Helper to generate IDs
  generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  },

  /**
   * Initialize the database with seed data if empty (offline cache only)
   */
  init() {
    if (!localStorage.getItem(this.tables.CURRICULUM)) {
      const initialCurriculum: CurriculumResource[] = [
        {
          id: 'curr-1',
          title: 'Mathematics Core Syllabus 2025',
          subject: 'Mathematics',
          gradeLevel: 'Grade 10',
          description: 'Official 2025 syllabus for Algebra and Geometry fundamentals. Includes learning objectives and required textbooks.',
          category: ResourceCategory.DOCUMENT,
          authorRole: UserRole.ADMIN,
          createdAt: new Date().toISOString()
        }
      ];

      const now = new Date();
      const in5Hours = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
      const in20Hours = new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString();
      const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

      const initialAssignments: Assignment[] = [
        {
          id: 'asgn-1',
          title: 'Physics Lab Report - Pendulum Oscillation',
          subject: 'Science Physics',
          gradeLevel: 'Grade 10',
          description: 'Submit calculated experimental values for gravitational acceleration (g) and attach error analysis spreadsheet.',
          dueDate: in5Hours,
          priority: 'urgent',
          createdByName: 'Dr. Sarah Wilson',
          createdAt: new Date().toISOString()
        },
        {
          id: 'asgn-2',
          title: 'Quadratic Equations Problem Set',
          subject: 'Mathematics',
          gradeLevel: 'Grade 10',
          description: 'Complete exercises 1-15 on Page 142. Solve using the quadratic formula and factoring techniques.',
          dueDate: in20Hours,
          priority: 'high',
          createdByName: 'Mr. James Blake',
          createdAt: new Date().toISOString()
        },
        {
          id: 'asgn-3',
          title: 'Cellular Respiration Diagram & Summary',
          subject: 'Biology',
          gradeLevel: 'All Grades',
          description: 'Draw and label the Krebs cycle and electron transport chain. Write a 300-word overview of ATP yield.',
          dueDate: in3Days,
          priority: 'medium',
          createdByName: 'Prof. Alice Green',
          createdAt: new Date().toISOString()
        }
      ];

      this.saveTable(this.tables.USERS, []);
      this.saveTable(this.tables.CREDENTIALS, []);
      this.saveTable(this.tables.CURRICULUM, initialCurriculum);
      this.saveTable(this.tables.MESSAGES, []);
      this.saveTable(this.tables.GRADES, []);
      this.saveTable(this.tables.VAULT, []);
      this.saveTable(this.tables.ASSIGNMENTS, initialAssignments);
    }
  },

  getTable<T>(tableName: string): T[] {
    return JSON.parse(localStorage.getItem(tableName) || '[]');
  },

  saveTable<T>(tableName: string, data: T[]): void {
    try {
      const jsonData = JSON.stringify(data);
      localStorage.setItem(tableName, jsonData);
    } catch (e) {
      console.error(`[Database] Error saving to ${tableName}:`, e);
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        alert('Data storage limit exceeded. This usually happens when the local storage (often 5MB-10MB) is full. Try deleting some messages or uploading smaller files.');
      } else {
        alert('An error occurred while saving data to the browser storage.');
      }
      throw e; // Re-throw to allow component-level handling if needed
    }
  },

  // Deprecated: Use bcrypt directly instead. This is kept for backward compatibility only.
  hashPassword(password: string): string {
    return bcrypt.hashSync(password, 10);
  },

  findUserByEmail(email: string): User | undefined {
    const users = this.getTable(this.tables.USERS) as User[];
    return users.find(u => u.email === email);
  },

  getUsersByRole(role: UserRole, includeInactive: boolean = false): User[] {
    const users = this.getTable(this.tables.USERS) as User[];
    return users.filter(u => u.role === role && (includeInactive || u.active !== false));
  },

  getCredentialByUserId(userId: string): AuthCredential | undefined {
    const credentials = this.getTable(this.tables.CREDENTIALS) as AuthCredential[];
    return credentials.find(c => c.userId === userId);
  },

  async authenticateUser(email: string, password: string): Promise<{ user: User, needsPasswordReset: boolean } | null> {
    this.init();
    const allUsers = this.getTable(this.tables.USERS) as User[];
    const potentialUsers = allUsers.filter(u => u.email === email && u.active !== false);

    if (potentialUsers.length === 0) return null;

    const allCredentials = this.getTable(this.tables.CREDENTIALS) as AuthCredential[];

    for (const user of potentialUsers) {
      const cred = allCredentials.find(c => c.userId === user.id);
      if (cred) {
        // Use bcryptjs to compare passwords securely
        const passwordMatch = await bcrypt.compare(password, cred.passwordHash);
        if (passwordMatch) {
          const credIndex = allCredentials.findIndex(c => c.userId === user.id);
          if (credIndex > -1) {
            allCredentials[credIndex].lastLogin = new Date().toISOString();
            this.saveTable(this.tables.CREDENTIALS, allCredentials);
          }
          return { user, needsPasswordReset: !!cred.passwordResetRequired };
        }
      }
    }
    return null;
  },
  
  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      throw new Error(validation.errorMessage);
    }

    const credentials = this.getTable(this.tables.CREDENTIALS) as AuthCredential[];
    const credIndex = credentials.findIndex(c => c.userId === userId);
    if (credIndex > -1) {
        // Use bcryptjs to hash the new password securely
        credentials[credIndex].passwordHash = await bcrypt.hash(newPassword, 10);
        credentials[credIndex].passwordResetRequired = false;
        this.saveTable(this.tables.CREDENTIALS, credentials);
    }
  },

  updateUserProfile(userId: string, updates: Partial<User>): User | null {
    const users = this.getTable(this.tables.USERS) as User[];
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex > -1) {
      const updatedUser = { ...users[userIndex], ...updates };
      users[userIndex] = updatedUser;
      this.saveTable(this.tables.USERS, users);
      return updatedUser;
    }
    return null;
  },

  deleteUser(userId: string): void {
    const users = this.getTable(this.tables.USERS) as User[];
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex > -1) {
      users[userIndex].active = false;
      this.saveTable(this.tables.USERS, users);
    }
  },

  getTotalUsersByRole(role: UserRole): number {
    return this.getUsersByRole(role).length;
  },

  getUnreadCurriculumCount(user: User): number {
    const items = this.getAllCurriculum();
    if (!user.lastViewedCurriculumAt) return items.length;
    return items.filter(i => new Date(i.createdAt) > new Date(user.lastViewedCurriculumAt!)).length;
  },

  async registerUser(user: Omit<User, 'id'>, password: string): Promise<User> {
    this.init();
    const validation = validatePassword(password);
    if (!validation.isValid) {
      throw new Error(validation.errorMessage);
    }

    if (this.findUserByEmail(user.email)) {
      throw new Error("Email already exists");
    }

    // Limit Admin accounts to 2
    if (user.role === UserRole.ADMIN) {
      const admins = this.getUsersByRole(UserRole.ADMIN);
      if (admins.length >= 2) {
        throw new Error("Maximum of 2 administrator accounts allowed in this system.");
      }
    }

    const users = this.getTable(this.tables.USERS) as User[];
    const credentials = this.getTable(this.tables.CREDENTIALS) as AuthCredential[];

    const newUser: User = {
      ...user,
      id: this.generateId(),
      contact: (user as User).contact || '', 
      school: (user as User).school || '',
      gender: (user as User).gender || 'Prefer not to say',
      residentialAddress: (user as User).residentialAddress || '',
      grade: (user as User).grade || 'Grade 10', 
      className: (user as User).className || 'Class A',
      isProfileComplete: (user.role === UserRole.TEACHER || user.role === UserRole.STUDENT) ? false : true,
    };

    try {
      const txHash = await blockchainService.commitHash(JSON.stringify({
        action: 'REGISTER_IDENTITY',
        email: newUser.email,
        timestamp: Date.now()
      }));
      newUser.blockchainId = txHash;
    } catch (e) {
      newUser.blockchainId = `pending-${Date.now()}`;
    }

    // Use bcryptjs to hash the password securely
    const passwordHash = await bcrypt.hash(password, 10);

    const newCred: AuthCredential = {
      userId: newUser.id,
      passwordHash: passwordHash,
      lastLogin: null,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    credentials.push(newCred);
    this.saveTable(this.tables.USERS, users);
    this.saveTable(this.tables.CREDENTIALS, credentials);
    return newUser;
  },

  // Curriculum Methods
  getAllCurriculum(): CurriculumResource[] {
    const list = this.getTable(this.tables.CURRICULUM) as CurriculumResource[];
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  addCurriculum(resource: Omit<CurriculumResource, 'id' | 'createdAt'> & { id?: string }): CurriculumResource {
    const items = this.getTable(this.tables.CURRICULUM) as CurriculumResource[];
    const newItem: CurriculumResource = {
      ...resource,
      id: resource.id || this.generateId(),
      createdAt: new Date().toISOString()
    };
    items.push(newItem);
    this.saveTable(this.tables.CURRICULUM, items);
    return newItem;
  },

  getAdminNotificationCount(): number {
    const items = this.getAllCurriculum();
    return items.filter(i => i.authorRole === UserRole.ADMIN).length;
  },

  deleteCurriculum(id: string): void {
    const items = this.getTable(this.tables.CURRICULUM) as CurriculumResource[];
    const newItems = items.filter(i => i.id !== id);
    this.saveTable(this.tables.CURRICULUM, newItems);
  },

  // Messaging Methods
  getMessages(userId: string): Message[] {
    const messages = this.getTable(this.tables.MESSAGES) as Message[];
    const user = (this.getTable(this.tables.USERS) as User[]).find(u => u.id === userId);
    
    return messages.filter(m => 
      m.senderId === userId || 
      m.recipientId === userId || 
      m.recipientId === 'ALL_ADMINS' ||
      (user?.role === UserRole.TEACHER && m.recipientId === 'TEACHER_BROADCAST')
    ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  },

  sendMessage(message: Omit<Message, 'id' | 'timestamp'>): Message {
    const messages = this.getTable(this.tables.MESSAGES) as Message[];
    const newMessage: Message = {
      ...message,
      id: this.generateId(),
      timestamp: new Date().toISOString()
    };
    messages.push(newMessage);
    this.saveTable(this.tables.MESSAGES, messages);
    return newMessage;
  },

  clearMessages(userId: string): void {
    const messages = this.getTable(this.tables.MESSAGES) as Message[];
    const filtered = messages.filter(m => m.senderId !== userId && m.recipientId !== userId);
    this.saveTable(this.tables.MESSAGES, filtered);
  },

  // Grading Methods
  getGradesByStudent(studentId: string): GradeRecord[] {
    const grades = this.getTable(this.tables.GRADES) as GradeRecord[];
    return grades.filter(g => g.studentId === studentId);
  },

  getGradesByTeacher(teacherId: string): GradeRecord[] {
    const grades = this.getTable(this.tables.GRADES) as GradeRecord[];
    return grades.filter(g => g.teacherId === teacherId);
  },

  getAllGrades(): GradeRecord[] {
    return this.getTable(this.tables.GRADES) as GradeRecord[];
  },

  saveGrade(grade: Omit<GradeRecord, 'id' | 'timestamp'> & { id?: string }): GradeRecord {
    const grades = this.getTable(this.tables.GRADES) as GradeRecord[];
    const newGrade: GradeRecord = {
      ...grade,
      id: grade.id || this.generateId(),
      timestamp: new Date().toISOString()
    };
    grades.push(newGrade);
    this.saveTable(this.tables.GRADES, grades);
    return newGrade;
  },

  // Assignment & Deadline Methods
  getAssignments(gradeLevel?: string): Assignment[] {
    const list = this.getTable(this.tables.ASSIGNMENTS) as Assignment[];
    if (gradeLevel && gradeLevel !== 'All Grades') {
      return list.filter(a => a.gradeLevel === 'All Grades' || a.gradeLevel === gradeLevel)
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    }
    return list.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  },

  addAssignment(assignment: Omit<Assignment, 'id' | 'createdAt'>): Assignment {
    const items = this.getTable(this.tables.ASSIGNMENTS) as Assignment[];
    const newItem: Assignment = {
      ...assignment,
      id: this.generateId(),
      createdAt: new Date().toISOString()
    };
    items.push(newItem);
    this.saveTable(this.tables.ASSIGNMENTS, items);
    return newItem;
  },

  deleteAssignment(id: string): void {
    const items = this.getTable(this.tables.ASSIGNMENTS) as Assignment[];
    const newItems = items.filter(a => a.id !== id);
    this.saveTable(this.tables.ASSIGNMENTS, newItems);
  },

  // Vault Methods
  getVaultDocuments(teacherId?: string): VaultDocument[] {
    const list = this.getTable(this.tables.VAULT) as VaultDocument[];
    if (teacherId) {
      return list.filter(d => d.teacherId === teacherId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async addVaultDocument(doc: Omit<VaultDocument, 'id' | 'createdAt' | 'status'> & { id?: string }): Promise<VaultDocument> {
    const items = this.getTable(this.tables.VAULT) as VaultDocument[];
    
    let hash = '';
    try {
      hash = await blockchainService.commitHash(JSON.stringify({
        title: doc.title,
        teacherId: doc.teacherId,
        timestamp: Date.now()
      }));
    } catch (e) {
      hash = `vault-hash-${Date.now()}`;
    }

    const newItem: VaultDocument = {
      ...doc,
      id: doc.id || this.generateId(),
      status: DocumentStatus.PENDING,
      createdAt: new Date().toISOString(),
      hash
    };
    items.push(newItem);
    this.saveTable(this.tables.VAULT, items);
    return newItem;
  },

  updateVaultDocumentStatus(docId: string, status: DocumentStatus): VaultDocument | null {
    const items = this.getTable(this.tables.VAULT) as VaultDocument[];
    const index = items.findIndex(d => d.id === docId);
    if (index > -1) {
      items[index].status = status;
      this.saveTable(this.tables.VAULT, items);
      return items[index];
    }
    return null;
  },

  getPendingVaultDocuments(): VaultDocument[] {
    const items = this.getTable(this.tables.VAULT) as VaultDocument[];
    return items.filter(d => d.status === DocumentStatus.PENDING).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  /**
   * Clears all data and re-initializes defaults
   */
  reset() {
    localStorage.removeItem(this.tables.USERS);
    localStorage.removeItem(this.tables.CREDENTIALS);
    localStorage.removeItem(this.tables.CURRICULUM);
    localStorage.removeItem(this.tables.MESSAGES);
    localStorage.removeItem(this.tables.GRADES);
    localStorage.removeItem(this.tables.VAULT);
    // Session cleanup
    localStorage.removeItem('educhain_session');
    localStorage.removeItem('esylab_session');
    
    // Re-init with defaults
    this.init();
  }
};