import React, { useState, useEffect } from 'react';
import { AppUser, PendingSignup, ScreenshotLog, StorageSettings } from './types';
import {
  getStoredUsers,
  saveStoredUsers,
  getPendingSignups,
  savePendingSignups,
  getStorageSettings,
  saveStorageSettings,
  getActiveSessionUser,
  setActiveSessionUser,
  DEFAULT_ADMIN,
  DEFAULT_EMPLOYEES,
} from './lib/userStore';
import {
  initAuth,
  googleSignIn,
  logoutGoogle,
  getAccessToken,
  setCachedToken,
  subscribeToUsers,
  subscribeToPendingSignups,
  subscribeToStorageSettings,
  subscribeToScreenshots,
  saveStorageSettingsToFirestore,
  syncUserToFirestore,
  testFirestoreConnection,
} from './lib/firebase';
import { AdminDashboard } from './components/AdminDashboard';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { AuthScreen } from './components/AuthScreen';
import {
  LogOut,
  Shield,
  User as UserIcon,
  HardDrive,
  CheckCircle,
  Bell,
  RefreshCw,
  FolderOpen,
  Wifi,
  Cloud,
  Shuffle
} from 'lucide-react';
import { getTodayDateKey } from './lib/utils';

export default function App() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [pendingSignups, setPendingSignups] = useState<PendingSignup[]>([]);
  const [storageSettings, setStorageSettings] = useState<StorageSettings>(getStorageSettings());

  // OAuth token state
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [notificationMsg, setNotificationMsg] = useState<string>('');

  // Screenshots collection across app
  const [screenshots, setScreenshots] = useState<ScreenshotLog[]>([]);

  // Load initial store state & live real-time cloud listeners
  useEffect(() => {
    // 1. Initial local load
    const loadedUsers = getStoredUsers();
    setAllUsers(loadedUsers);

    const loadedPending = getPendingSignups();
    setPendingSignups(loadedPending);

    const sessionUser = getActiveSessionUser();
    if (sessionUser) {
      const freshUser = loadedUsers.find((u) => u.id === sessionUser.id) || sessionUser;
      setCurrentUser(freshUser);
    }

    // Seed mock initial screenshots if empty
    const today = getTodayDateKey();
    const seedScreenshots: ScreenshotLog[] = [
      {
        id: 'seed-1',
        userId: 'emp-101',
        userName: 'Alex Rivera',
        userEmail: 'alex.rivera@team.internal',
        taskName: 'UI Layout Redesign',
        timestamp: new Date(Date.now() - 3600 * 1000 * 3).toISOString(),
        timeFormatted: '09:15 AM',
        hourKey: '09:00 AM - 10:00 AM',
        dateKey: today,
        fileFormat: 'webp',
        previewDataUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&auto=format&fit=crop&q=60',
        productivityScore: 95,
        productivityLabel: 'High',
      },
      {
        id: 'seed-2',
        userId: 'emp-101',
        userName: 'Alex Rivera',
        userEmail: 'alex.rivera@team.internal',
        taskName: 'API Endpoint Optimization',
        timestamp: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
        timeFormatted: '10:30 AM',
        hourKey: '10:00 AM - 11:00 AM',
        dateKey: today,
        fileFormat: 'png',
        previewDataUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=60',
        productivityScore: 88,
        productivityLabel: 'Normal',
      },
      {
        id: 'seed-3',
        userId: 'emp-102',
        userName: 'Sarah Chen',
        userEmail: 'sarah.chen@team.internal',
        taskName: 'Cloud Drive Integration Module',
        timestamp: new Date(Date.now() - 3600 * 1000 * 1.5).toISOString(),
        timeFormatted: '11:15 AM',
        hourKey: '11:00 AM - 12:00 PM',
        dateKey: today,
        fileFormat: 'jpg',
        previewDataUrl: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=600&auto=format&fit=crop&q=60',
        productivityScore: 92,
        productivityLabel: 'High',
      },
    ];
    setScreenshots(seedScreenshots);

    // Test Firestore connection on boot
    testFirestoreConnection();

    // Check cached token
    getAccessToken().then((token) => {
      if (token) setGoogleAccessToken(token);
    });

    // Check Firebase Auth state
    initAuth(
      (user, token) => {
        setGoogleAccessToken(token);
        setCachedToken(token);
      },
      () => {}
    );

    // 2. Real-time Cloud Firestore Subscriptions for Multi-Device synchronization!
    const unsubUsers = subscribeToUsers((cloudUsers) => {
      if (cloudUsers && cloudUsers.length > 0) {
        const map = new Map<string, AppUser>();
        [DEFAULT_ADMIN, ...DEFAULT_EMPLOYEES].forEach(u => map.set(u.id, u));
        cloudUsers.forEach(u => map.set(u.id, u));
        const merged = Array.from(map.values());
        setAllUsers(merged);
        saveStoredUsers(merged);
      } else {
        syncUserToFirestore(DEFAULT_ADMIN);
      }
    });

    const unsubPending = subscribeToPendingSignups((cloudPending) => {
      if (cloudPending) {
        setPendingSignups(cloudPending);
        savePendingSignups(cloudPending);
      }
    });

    const unsubSettings = subscribeToStorageSettings((cloudSettings) => {
      if (cloudSettings) {
        setStorageSettings(cloudSettings);
        saveStorageSettings(cloudSettings);
        // If admin stored their access token in cloudSettings, keep local token in sync
        if (cloudSettings.adminAccessToken) {
          setGoogleAccessToken(cloudSettings.adminAccessToken);
          setCachedToken(cloudSettings.adminAccessToken);
        }
      }
    });

    const unsubScreenshots = subscribeToScreenshots((cloudScreens) => {
      if (cloudScreens && cloudScreens.length > 0) {
        setScreenshots((prev) => {
          const ids = new Set(cloudScreens.map(s => s.id));
          const rest = prev.filter(p => !ids.has(p.id));
          return [...cloudScreens, ...rest];
        });
      }
    });

    return () => {
      unsubUsers();
      unsubPending();
      unsubSettings();
      unsubScreenshots();
    };
  }, []);

  // Connect Google Drive & Google Sheets with popup
  const handleConnectGoogle = async () => {
    setIsConnectingGoogle(true);
    try {
      const res = await googleSignIn();
      if (res?.accessToken) {
        setGoogleAccessToken(res.accessToken);
        setCachedToken(res.accessToken);

        // If current user is Admin, share this token into central StorageSettings in Firestore
        // so ALL remote employees automatically save to Admin's Drive without having to connect anything!
        if (currentUser?.role === 'admin') {
          const updatedSettings: StorageSettings = {
            ...storageSettings,
            adminAccessToken: res.accessToken,
            centralAdminEmail: currentUser.email || 'henishcodestrokes@gmail.com',
          };
          setStorageSettings(updatedSettings);
          saveStorageSettings(updatedSettings);
          await saveStorageSettingsToFirestore(updatedSettings);
        }

        setNotificationMsg('Admin Google Drive & Sheets connected! Remote employees will now automatically sync to your Drive.');
        setTimeout(() => setNotificationMsg(''), 7000);
      }
    } catch (err: any) {
      console.error('Google connect failed:', err);
      setNotificationMsg(`Connection failed: ${err.message || 'Cancelled'}`);
      setTimeout(() => setNotificationMsg(''), 6000);
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  // Sign out
  const handleLogout = async () => {
    setActiveSessionUser(null);
    setCurrentUser(null);
    await logoutGoogle();
    setGoogleAccessToken(null);
  };

  // Handle new incoming screenshot
  const handleNewScreenshot = (log: ScreenshotLog) => {
    setScreenshots((prev) => [log, ...prev]);
  };

  // Employee signup code notification banner for admin
  const handleAdminCodeDispatched = (code: string) => {
    setNotificationMsg(`Admin Alert: A new employee requested sign up. Security verification code: ${code}`);
    setTimeout(() => setNotificationMsg(''), 10000);
  };

  const isDriveConfigured = Boolean(googleAccessToken || storageSettings.adminAccessToken);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Application Bar */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black shadow">
              WM
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <span>WorkMonitor Desktop</span>
                <span className="bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold px-2 py-0.5 rounded flex items-center gap-1">
                  <Cloud className="w-3 h-3" /> Live Multi-User Server
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Random 5–10 Min Screen Captures & Central Admin Drive Sync
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Google Drive Status Pill */}
            {isDriveConfigured ? (
              <div className="hidden sm:flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs px-3.5 py-1.5 rounded-full font-medium">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>Admin Drive Synced</span>
              </div>
            ) : (
              <button
                id="header-connect-drive-btn"
                onClick={handleConnectGoogle}
                disabled={isConnectingGoogle}
                className="hidden sm:flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs px-3.5 py-1.5 rounded-full font-medium hover:bg-indigo-100 transition cursor-pointer"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>{isConnectingGoogle ? 'Connecting...' : 'Connect Admin Google Drive'}</span>
              </button>
            )}

            {/* Current user & Logout */}
            {currentUser && (
              <div className="flex items-center gap-2 border-l border-slate-200 dark:border-slate-800 pl-3">
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {currentUser.name}
                  </div>
                  <div className="text-[10px] uppercase font-semibold text-indigo-600 dark:text-indigo-400">
                    {currentUser.role}
                  </div>
                </div>

                <button
                  id="btn-logout"
                  onClick={handleLogout}
                  title="Sign Out"
                  className="p-2 text-slate-500 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global Toast / Notification Bar */}
      {notificationMsg && (
        <div className="bg-indigo-600 text-white text-xs py-2 px-4 text-center font-medium shadow flex items-center justify-center gap-2">
          <Bell className="w-4 h-4 animate-bounce shrink-0" />
          <span>{notificationMsg}</span>
        </div>
      )}

      {/* Main App Body */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        {!currentUser ? (
          <AuthScreen
            onLoginSuccess={(user) => {
              setCurrentUser(user);
              setAllUsers(getStoredUsers());
            }}
            onAdminConfirmationDispatched={handleAdminCodeDispatched}
          />
        ) : currentUser.role === 'admin' ? (
          <AdminDashboard
            adminUser={currentUser}
            allUsers={allUsers}
            onUpdateUsers={(u) => {
              setAllUsers(u);
              saveStoredUsers(u);
              u.forEach((user) => syncUserToFirestore(user));
            }}
            pendingSignups={pendingSignups}
            onUpdatePendingSignups={(p) => {
              setPendingSignups(p);
              savePendingSignups(p);
            }}
            storageSettings={storageSettings}
            onUpdateStorageSettings={(s) => {
              setStorageSettings(s);
              saveStorageSettings(s);
              saveStorageSettingsToFirestore(s);
            }}
            allScreenshots={screenshots}
            onUpdateScreenshots={setScreenshots}
            accessToken={googleAccessToken}
            onConnectDrive={handleConnectGoogle}
          />
        ) : (
          <EmployeeDashboard
            currentUser={currentUser}
            storageSettings={storageSettings}
            accessToken={googleAccessToken}
            onConnectDrive={handleConnectGoogle}
            onNewScreenshot={handleNewScreenshot}
            userScreenshots={screenshots.filter((s) => s.userId === currentUser.id)}
          />
        )}
      </main>

      {/* Footer Info */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-3 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Central Admin: <strong className="text-slate-700 dark:text-slate-300 font-mono">{storageSettings.centralAdminEmail}</strong> &bull; Mode: <strong className="text-indigo-600">{storageSettings.captureMode === 'random_5_to_10_min' ? 'Random 5–10 Min Intervals' : `${storageSettings.autoCaptureIntervalMinutes} min intervals`}</strong>
          </span>
          <span className="text-[11px] text-slate-400">
            /{storageSettings.centralFolderName}/[Employee]/[YYYY-MM-DD]/[image.{storageSettings.screenshotFormat}]
          </span>
        </div>
      </footer>
    </div>
  );
}
