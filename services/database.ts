import { User, UserRole, CurriculumResource, Message, GradeRecord, ResourceCategory, VaultDocument, DocumentStatus } from '../types';
import { blockchainService } from './blockchain';

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
    VAULT: 'esylab_db_vault'
  },

  // Helper to generate IDs
  generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  },

  /**
   * Initialize the database with seed data if empty
   */
  init() {
    if (!localStorage.getItem(this.tables.USERS)) {
      console.log('[Database] Initializing Schema...');
      
      const initialUsers: User[] = [
        { 
          id: '3', 
          name: 'Primary Admin', 
          role: UserRole.ADMIN, 
          email: 'admin@gmail.com', 
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
          blockchainId: 'sol-genesis-block-3-admin',
          contact: '777-888-9999',
          school: 'ESYLAB Headquarters',
          gender: 'Prefer not to say',
          residentialAddress: '789 Pine Rd, Capital City'
        }
      ];
      
      const initialCreds: AuthCredential[] = [
        { userId: '3', passwordHash: this.hashPassword('1357'), lastLogin: null, createdAt: new Date().toISOString(), passwordResetRequired: true }
      ];

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

      this.saveTable(this.tables.USERS, initialUsers);
      this.saveTable(this.tables.CREDENTIALS, initialCreds);
      this.saveTable(this.tables.CURRICULUM, initialCurriculum);
      this.saveTable(this.tables.MESSAGES, []);
      this.saveTable(this.tables.GRADES, []);
      this.saveTable(this.tables.VAULT, []);
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

  hashPassword(password: string): string {
    return btoa(password); 
  },

  findUserByEmail(email: string): User | undefined {
    const users = this.getTable(this.tables.USERS) as User[];
    return users.find(u => u.email === email);
  },

  getUsersByRole(role: UserRole): User[] {
    const users = this.getTable(this.tables.USERS) as User[];
    return users.filter(u => u.role === role);
  },

  getCredentialByUserId(userId: string): AuthCredential | undefined {
    const credentials = this.getTable(this.tables.CREDENTIALS) as AuthCredential[];
    return credentials.find(c => c.userId === userId);
  },

  authenticateUser(email: string, password: string): { user: User, needsPasswordReset: boolean } | null {
    this.init();
    const allUsers = this.getTable(this.tables.USERS) as User[];
    const potentialUsers = allUsers.filter(u => u.email === email);

    if (potentialUsers.length === 0) return null;

    const allCredentials = this.getTable(this.tables.CREDENTIALS) as AuthCredential[];

    for (const user of potentialUsers) {
      const cred = allCredentials.find(c => c.userId === user.id);
      if (cred && cred.passwordHash === this.hashPassword(password)) {
        const credIndex = allCredentials.findIndex(c => c.userId === user.id);
        if (credIndex > -1) {
          allCredentials[credIndex].lastLogin = new Date().toISOString();
          this.saveTable(this.tables.CREDENTIALS, allCredentials);
        }
        return { user, needsPasswordReset: !!cred.passwordResetRequired };
      }
    }
    return null;
  },
  
  updatePassword(userId: string, newPassword: string): void {
    const credentials = this.getTable(this.tables.CREDENTIALS) as AuthCredential[];
    const credIndex = credentials.findIndex(c => c.userId === userId);
    if (credIndex > -1) {
        credentials[credIndex].passwordHash = this.hashPassword(newPassword);
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
    const credentials = this.getTable(this.tables.CREDENTIALS) as AuthCredential[];
    
    const newUsers = users.filter(u => u.id !== userId);
    const newCreds = credentials.filter(c => c.userId !== userId);
    
    this.saveTable(this.tables.USERS, newUsers);
    this.saveTable(this.tables.CREDENTIALS, newCreds);
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

    const newCred: AuthCredential = {
      userId: newUser.id,
      passwordHash: this.hashPassword(password),
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

  addCurriculum(resource: Omit<CurriculumResource, 'id' | 'createdAt'>): CurriculumResource {
    const items = this.getTable(this.tables.CURRICULUM) as CurriculumResource[];
    const newItem: CurriculumResource = {
      ...resource,
      id: this.generateId(),
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

  saveGrade(grade: Omit<GradeRecord, 'id' | 'timestamp'>): GradeRecord {
    const grades = this.getTable(this.tables.GRADES) as GradeRecord[];
    const newGrade: GradeRecord = {
      ...grade,
      id: this.generateId(),
      timestamp: new Date().toISOString()
    };
    grades.push(newGrade);
    this.saveTable(this.tables.GRADES, grades);
    return newGrade;
  },

  // Vault Methods
  getVaultDocuments(teacherId?: string): VaultDocument[] {
    const list = this.getTable(this.tables.VAULT) as VaultDocument[];
    if (teacherId) {
      return list.filter(d => d.teacherId === teacherId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async addVaultDocument(doc: Omit<VaultDocument, 'id' | 'createdAt' | 'status'>): Promise<VaultDocument> {
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
      id: this.generateId(),
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