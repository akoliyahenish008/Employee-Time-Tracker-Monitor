export type UserRole = 'admin' | 'employee';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  approved: boolean;
  avatar?: string;
  createdAt: string;
  lastActive?: string;
}

export interface PendingSignup {
  id: string;
  name: string;
  email: string;
  confirmationCode: string;
  timestamp: string;
}

export interface ScreenshotLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  taskName: string;
  timestamp: string; // ISO string
  timeFormatted: string; // e.g. "09:15 AM"
  hourKey: string; // e.g. "09:00 AM - 10:00 AM" or "09"
  dateKey: string; // e.g. "2026-09-08"
  fileFormat: 'webp' | 'png' | 'jpg';
  driveFileId?: string;
  driveFolderId?: string;
  driveWebLink?: string;
  previewDataUrl: string;
  productivityScore?: number; // 0-100
  productivityLabel?: 'High' | 'Normal' | 'Distracted';
  productivityNotes?: string;
  windowTitle?: string;
}

export interface TaskSession {
  id: string;
  userId: string;
  userName: string;
  taskName: string;
  dateKey: string; // YYYY-MM-DD
  startTime: string; // ISO or formatted
  endTime?: string;
  durationSeconds: number;
  paused: boolean;
}

export interface DailyEmployeeSummary {
  userId: string;
  userName: string;
  userEmail: string;
  dateKey: string;
  totalTrackedSeconds: number;
  formattedTotalHours: string; // e.g. "4h 15m" or "4.25 hrs"
  tasksBreakdown: { [taskName: string]: number }; // task -> seconds
  screenshotsCount: number;
  averageProductivity: number;
}

export interface StorageSettings {
  destinationMode: 'central_admin_drive' | 'individual_user_drive';
  centralAdminEmail: string;
  centralFolderId?: string;
  centralFolderName: string;
  screenshotFormat: 'webp' | 'png' | 'jpg';
  autoCaptureIntervalMinutes: number; // base fallback
  captureMode: 'random_5_to_10_min' | 'fixed_interval';
  adminAccessToken?: string; // Shared central Admin Google OAuth Token stored in cloud settings
  adminTokenExpiry?: string;
  googleSpreadsheetId?: string;
  spreadsheetName: string;
}
