import React, { useState } from 'react';
import { AppUser } from '../types';
import {
  getStoredUsers,
  saveStoredUsers,
  setActiveSessionUser,
  getStorageSettings,
} from '../lib/userStore';
import { syncUserToFirestore } from '../lib/firebase';
import { provisionEmployeeWorkspace } from '../lib/workspaceProvisioner';
import {
  ShieldCheck,
  User,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  HardDrive,
  Sparkles,
  Users,
  FolderPlus
} from 'lucide-react';

interface AuthScreenProps {
  onLoginSuccess: (user: AppUser) => void;
  onAdminConfirmationDispatched?: (code: string) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLoginSuccess,
}) => {
  const [mode, setMode] = useState<'admin_login' | 'employee_login' | 'employee_signup'>('employee_login');

  // Form states
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [statusNotice, setStatusNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Switch mode
  const handleSwitchMode = (newMode: 'admin_login' | 'employee_login' | 'employee_signup') => {
    setMode(newMode);
    setErrorMsg('');
    setStatusNotice('');
  };

  // ADMIN LOGIN
  const handleAdminLogin = async (overrideEmail?: string) => {
    setErrorMsg('');
    const targetEmail = (overrideEmail || email).trim().toLowerCase();

    if (!targetEmail) {
      setErrorMsg('Please enter your admin email address.');
      return;
    }

    const users = getStoredUsers();
    let admin = users.find((u) => u.role === 'admin' && u.email.toLowerCase() === targetEmail);

    // Auto-allow henishcodestrokes@gmail.com as the Primary Admin
    if (!admin && targetEmail === 'henishcodestrokes@gmail.com') {
      admin = {
        id: 'admin-master',
        name: 'Henish (Main Admin)',
        email: 'henishcodestrokes@gmail.com',
        role: 'admin',
        approved: true,
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
      };
      const updated = [...users, admin];
      saveStoredUsers(updated);
      syncUserToFirestore(admin);
    }

    if (!admin) {
      setErrorMsg('No Admin account found with this email. Primary Admin email is henishcodestrokes@gmail.com');
      return;
    }

    admin.lastActive = new Date().toISOString();
    syncUserToFirestore(admin);
    setActiveSessionUser(admin);
    onLoginSuccess(admin);
  };

  // EMPLOYEE LOGIN - DIRECT (NO VERIFICATION CODE)
  const handleEmployeeLogin = async (e?: React.FormEvent, overrideEmail?: string) => {
    if (e) e.preventDefault();
    setErrorMsg('');
    setStatusNotice('');

    const targetEmail = (overrideEmail || email).trim().toLowerCase();
    if (!targetEmail) {
      setErrorMsg('Please enter your employee email address.');
      return;
    }

    const users = getStoredUsers();
    let employee = users.find(
      (u) => u.role === 'employee' && u.email.toLowerCase() === targetEmail
    );

    if (!employee) {
      setErrorMsg('No employee account found with this email. Please sign up below or check your email.');
      return;
    }

    setIsSubmitting(true);
    setStatusNotice('Authenticating and preparing employee Drive folder & Sheet tab...');

    try {
      // Auto-approve account directly (no verification code required)
      employee.approved = true;
      employee.lastActive = new Date().toISOString();
      setActiveSessionUser(employee);
      syncUserToFirestore(employee).catch((e) => console.warn('User sync note:', e));

      // Provision Drive folder & Sheet tab right on login if token exists
      const storageSettings = getStorageSettings();
      const token = storageSettings.adminAccessToken;
      if (token) {
        try {
          await Promise.race([
            provisionEmployeeWorkspace(
              token,
              employee,
              storageSettings.spreadsheetName,
              storageSettings.centralFolderName
            ),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Provisioning timeout')), 5000)),
          ]);
        } catch (provErr: any) {
          console.warn('Drive/Sheet sync notice on login:', provErr);
        }
      }

      onLoginSuccess(employee);
    } catch (err: any) {
      setErrorMsg(`Login error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // EMPLOYEE SIGN UP - DIRECT (NO VERIFICATION CODE)
  const handleDirectEmployeeSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusNotice('');

    if (!name.trim() || !email.trim()) {
      setErrorMsg('Please enter both your full name and email address.');
      return;
    }

    const users = getStoredUsers();
    const existing = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (existing) {
      setErrorMsg('An account with this email already exists. Please log in directly.');
      return;
    }

    setIsSubmitting(true);
    setStatusNotice('Creating employee account...');

    try {
      // Create approved employee immediately!
      const newEmployee: AppUser = {
        id: `emp-${Date.now()}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: 'employee',
        approved: true, // Directly approved, no confirmation code needed
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
      };

      // 1. Save to local storage & set active session right away
      const updatedUsers = [...users, newEmployee];
      saveStoredUsers(updatedUsers);
      setActiveSessionUser(newEmployee);

      // 2. Sync to Firestore in background with timeout protection
      syncUserToFirestore(newEmployee).catch((e) => console.warn('Firestore sync note:', e));

      // 3. Automatically create Drive folder & employee-wise Sheet tab under Admin's account
      const storageSettings = getStorageSettings();
      const token = storageSettings.adminAccessToken;

      if (token) {
        setStatusNotice(`Setting up Google Drive & Sheet tab for ${newEmployee.name}...`);
        try {
          await Promise.race([
            provisionEmployeeWorkspace(
              token,
              newEmployee,
              storageSettings.spreadsheetName,
              storageSettings.centralFolderName
            ),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Provisioning timeout')), 5000)),
          ]);
        } catch (syncErr: any) {
          console.warn('Drive/Sheet creation warning on signup:', syncErr);
        }
      }

      setStatusNotice(`✅ Account created for ${newEmployee.name}! Entering workstation...`);
      setTimeout(() => {
        setIsSubmitting(false);
        onLoginSuccess(newEmployee);
      }, 350);
    } catch (err: any) {
      setErrorMsg(`Failed to create account: ${err.message}`);
      setIsSubmitting(false);
    }
  };

  const storedUsers = getStoredUsers();
  const existingEmployees = storedUsers.filter((u) => u.role === 'employee');
  const storageSettings = getStorageSettings();
  const isDriveConfigured = Boolean(storageSettings.adminAccessToken);

  return (
    <div className="w-full max-w-lg mx-auto py-8 px-4">
      {/* Central Drive & Sheet Storage Status Indicator */}
      <div className="mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isDriveConfigured ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400'}`}>
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                <span>Central Admin Drive & Sheets</span>
                {isDriveConfigured ? (
                  <span className="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    Active
                  </span>
                ) : (
                  <span className="bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    Setup in Admin
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Destination: {storageSettings.centralAdminEmail || 'henishcodestrokes@gmail.com'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white shadow-lg font-black text-xl mb-1">
            WM
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Employee WorkStation
          </h1>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Direct access to desktop activity tracking, automatic Google Drive screenshots, and Google Sheets time logging.
          </p>
        </div>

        {/* Role & Mode Switcher */}
        <div className="grid grid-cols-3 gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => handleSwitchMode('employee_login')}
            className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
              mode === 'employee_login'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Staff Login
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode('employee_signup')}
            className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
              mode === 'employee_signup'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            New Staff Sign-Up
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode('admin_login')}
            className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
              mode === 'admin_login'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Admin Portal
          </button>
        </div>

        {/* Notifications & Error alerts */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {statusNotice && (
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-300 text-xs rounded-xl flex items-center gap-2">
            <RefreshCw className="w-4 h-4 shrink-0 animate-spin text-indigo-600" />
            <span>{statusNotice}</span>
          </div>
        )}

        {/* MODE 1: EMPLOYEE LOGIN (Direct, No Code) */}
        {mode === 'employee_login' && (
          <form onSubmit={handleEmployeeLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Staff Email Address
              </label>
              <div className="relative">
                <input
                  id="employee-login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. alex.rivera@team.internal"
                  required
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Logging in...</span>
                </>
              ) : (
                <>
                  <span>Log In & Start Tracking</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Quick 1-Click Employee Buttons for Fast Testing on Any Machine */}
            {existingEmployees.length > 0 && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Quick Test Accounts:</span>
                  <span className="text-[10px] text-emerald-600 font-normal">Click to test instantly</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {existingEmployees.slice(0, 4).map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => {
                        setEmail(emp.email);
                        handleEmployeeLogin(undefined, emp.email);
                      }}
                      className="p-2 border border-slate-200 dark:border-slate-700 hover:border-indigo-500 bg-slate-50 dark:bg-slate-800 rounded-xl text-left transition text-xs group cursor-pointer"
                    >
                      <div className="font-bold text-slate-800 dark:text-white group-hover:text-indigo-600 truncate">
                        {emp.name}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">{emp.email}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}

        {/* MODE 2: EMPLOYEE SIGN-UP (Direct, Auto-Approved, No Code Required) */}
        {mode === 'employee_signup' && (
          <form onSubmit={handleDirectEmployeeSignup} className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 rounded-xl text-emerald-900 dark:text-emerald-200 text-xs flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong>Direct Registration Active:</strong> Enter your name and email to immediately begin work. A dedicated Drive folder and Sheet tab will be automatically generated for you.
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Full Legal / Work Name
              </label>
              <input
                id="signup-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. David Miller"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Email Address
              </label>
              <input
                id="signup-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. david.miller@company.com"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Creating Account & Folders...</span>
                </>
              ) : (
                <>
                  <FolderPlus className="w-4 h-4" />
                  <span>Create Account & Start Work</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* MODE 3: ADMIN LOGIN */}
        {mode === 'admin_login' && (
          <div className="space-y-4">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 p-3.5 rounded-xl text-indigo-900 dark:text-indigo-200 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span>Primary Administrator Portal</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-[11px]">
                Authorized for <strong>henishcodestrokes@gmail.com</strong>. Grants full management over Google Drive storage, master Google Sheets, real-time employee monitoring, and capture policies.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Admin Email Address
              </label>
              <input
                id="admin-login-email"
                type="email"
                value={email || 'henishcodestrokes@gmail.com'}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="henishcodestrokes@gmail.com"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white font-mono"
              />
            </div>

            <button
              type="button"
              onClick={() => handleAdminLogin(email || 'henishcodestrokes@gmail.com')}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Enter Admin Dashboard</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
