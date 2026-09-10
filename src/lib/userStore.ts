import { AppUser, PendingSignup, StorageSettings } from '../types';

const USERS_KEY = 'wm_app_users_v2';
const PENDING_SIGNUPS_KEY = 'wm_pending_signups_v2';
const SETTINGS_KEY = 'wm_storage_settings_v2';
const CURRENT_USER_KEY = 'wm_active_session_v2';

export const DEFAULT_ADMIN: AppUser = {
  id: 'admin-master',
  name: 'Henish (Main Admin)',
  email: 'henishcodestrokes@gmail.com',
  password: 'admin123',
  role: 'admin',
  approved: true,
  createdAt: '2026-09-01T08:00:00.000Z',
  lastActive: new Date().toISOString(),
};

export const DEFAULT_EMPLOYEES: AppUser[] = [
  {
    id: 'emp-101',
    name: 'Alex Rivera',
    email: 'alex.rivera@team.internal',
    password: 'password123',
    role: 'employee',
    approved: true,
    createdAt: '2026-09-02T09:00:00.000Z',
    lastActive: new Date().toISOString(),
  },
  {
    id: 'emp-102',
    name: 'Sarah Chen',
    email: 'sarah.chen@team.internal',
    password: 'password123',
    role: 'employee',
    approved: true,
    createdAt: '2026-09-03T09:30:00.000Z',
    lastActive: new Date().toISOString(),
  },
];

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
  destinationMode: 'central_admin_drive',
  centralAdminEmail: 'henishcodestrokes@gmail.com',
  centralFolderName: 'WorkMonitor_Records',
  screenshotFormat: 'webp',
  autoCaptureIntervalMinutes: 7,
  captureIntervalSeconds: 10,
  captureMode: 'fixed_interval',
  allowedIntervals: [10, 20, 60, 300, 600, 900],
  lockIntervalForEmployees: true,
  spreadsheetName: 'Employee_Time_Tracking_Master',
  showWorkspaceDiagnostics: false,
};

export function getStoredUsers(): AppUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) {
      const initial = [DEFAULT_ADMIN, ...DEFAULT_EMPLOYEES];
      localStorage.setItem(USERS_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed: AppUser[] = JSON.parse(raw);
    return parsed.map((u) => ({
      ...u,
      password: u.password || (u.role === 'admin' ? 'admin123' : '123456'),
    }));
  } catch {
    return [DEFAULT_ADMIN, ...DEFAULT_EMPLOYEES];
  }
}

export function saveStoredUsers(users: AppUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function getPendingSignups(): PendingSignup[] {
  try {
    const raw = localStorage.getItem(PENDING_SIGNUPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePendingSignups(signups: PendingSignup[]) {
  localStorage.setItem(PENDING_SIGNUPS_KEY, JSON.stringify(signups));
}

export function getStorageSettings(): StorageSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_STORAGE_SETTINGS, ...JSON.parse(raw) } : DEFAULT_STORAGE_SETTINGS;
  } catch {
    return DEFAULT_STORAGE_SETTINGS;
  }
}

export function saveStorageSettings(settings: StorageSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getActiveSessionUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setActiveSessionUser(user: AppUser | null) {
  if (user) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
  }
}
