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
} from './lib/userStore';
import {
  initAuth,
  googleSignIn,
  logoutGoogle,
  getAccessToken,
  setCachedToken,
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
  FolderOpen
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

  // Load initial store state
  useEffect(() => {
    const loadedUsers = getStoredUsers();
    setAllUsers(loadedUsers);

    const loadedPending = getPendingSignups();
    setPendingSignups(loadedPending);

    const sessionUser = getActiveSessionUser();
    if (sessionUser) {
      // Refresh user object from latest store
      const freshUser = loadedUsers.find((u) => u.id === sessionUser.id) || sessionUser;
      setCurrentUser(freshUser);
    }

    // Seed mock initial screenshots to populate demo gallery nicely
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

    // Check Firebase Auth state
    initAuth(
      (user, token) => {
        setGoogleAccessToken(token);
      },
      () => {
        // No token
      }
    );
  }, []);

  // Connect Google Drive & Google Sheets with popup
  const handleConnectGoogle = async () => {
    setIsConnectingGoogle(true);
    try {
      const res = await googleSignIn();
      if (res?.accessToken) {
        setGoogleAccessToken(res.accessToken);
        setCachedToken(res.accessToken);
        setNotificationMsg('Google Drive & Sheets connected successfully! Screen logs will sync directly to folders.');
        setTimeout(() => setNotificationMsg(''), 5000);
      }
    } catch (err: any) {
      console.error('Google connect failed:', err);
      setNotificationMsg(`Connection failed: ${err.message || 'Cancelled'}`);
      setTimeout(() => setNotificationMsg(''), 5000);
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
    setTimeout(() => setNotificationMsg(''), 8000);
  };

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
                <span className="bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-semibold px-2 py-0.5 rounded">
                  v2.5 Drive & Sheets
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Automated Screen Capture & Hour Logging Engine
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Google Drive Status Pill */}
            {googleAccessToken ? (
              <div className="hidden sm:flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs px-3 py-1.5 rounded-full font-medium">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>Drive & Sheet Connected</span>
              </div>
            ) : (
              <button
                id="header-connect-drive-btn"
                onClick={handleConnectGoogle}
                disabled={isConnectingGoogle}
                className="hidden sm:flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs px-3.5 py-1.5 rounded-full font-medium hover:bg-indigo-100 transition"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>{isConnectingGoogle ? 'Connecting...' : 'Connect Google Drive'}</span>
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
                  className="p-2 text-slate-500 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
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
          <Bell className="w-4 h-4 animate-bounce" />
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
            }}
            allScreenshots={screenshots}
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
            Storage hierarchy: <code className="text-slate-700 dark:text-slate-300 font-mono">/[Employee]/[YYYY-MM-DD]/[image.{storageSettings.screenshotFormat}]</code>
          </span>
          <span className="text-[11px] text-slate-400">
            Automated Google Drive & Google Sheets Time Tracking System
          </span>
        </div>
      </footer>
    </div>
  );
}
