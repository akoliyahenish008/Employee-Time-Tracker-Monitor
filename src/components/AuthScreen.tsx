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
import { updateUserPasswordInSheet, getOrCreateSpreadsheet } from '../lib/sheetService';
import {
  ShieldCheck,
  User,
  Lock,
  Eye,
  EyeOff,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  HardDrive,
  Sparkles,
  Users,
  FolderPlus,
  RotateCcw
} from 'lucide-react';

interface AuthScreenProps {
  onLoginSuccess: (user: AppUser) => void;
  onAdminConfirmationDispatched?: (code: string) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLoginSuccess,
}) => {
  const [mode, setMode] = useState<
    'admin_login' | 'employee_login' | 'employee_signup' | 'reset_password' | 'change_password'
  >('employee_login');

  // Form states
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [statusNotice, setStatusNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Switch mode
  const handleSwitchMode = (
    newMode: 'admin_login' | 'employee_login' | 'employee_signup' | 'reset_password' | 'change_password'
  ) => {
    setMode(newMode);
    setErrorMsg('');
    setStatusNotice('');
    setPassword('');
    setConfirmPassword('');
    setOldPassword('');
    setNewPassword('');
    setShowPassword(false);
    setAdminPassword('');
  };

  // ADMIN LOGIN
  const handleAdminLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');
    const targetEmail = (email || 'henishcodestrokes@gmail.com').trim().toLowerCase();

    if (!targetEmail) {
      setErrorMsg('Please enter your admin email address.');
      return;
    }

    if (!adminPassword) {
      setErrorMsg('Please enter your admin password.');
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
        password: 'admin123',
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

    const expectedAdminPassword = admin.password || 'admin123';
    if (adminPassword !== expectedAdminPassword) {
      setErrorMsg('Incorrect admin password. Please try again.');
      return;
    }

    admin.lastActive = new Date().toISOString();
    syncUserToFirestore(admin);
    setActiveSessionUser(admin);
    onLoginSuccess(admin);
  };

  // EMPLOYEE LOGIN - STRICT PASSWORD VERIFICATION
  const handleEmployeeLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');
    setStatusNotice('');

    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      setErrorMsg('Please enter your employee email address.');
      return;
    }

    if (!password) {
      setErrorMsg('Password is required. Please enter your password to log in.');
      return;
    }

    const users = getStoredUsers();
    let employee = users.find(
      (u) => u.role === 'employee' && u.email.toLowerCase() === targetEmail
    );

    if (!employee) {
      setErrorMsg('No employee account found with this email. Please sign up first via New Staff Sign-Up.');
      return;
    }

    // Strict password verification
    const expectedPassword = employee.password || '123456';
    if (password !== expectedPassword) {
      setErrorMsg('Incorrect password. Please verify your credentials and try again.');
      return;
    }

    setIsSubmitting(true);
    setStatusNotice('Authenticating employee and checking workstation...');

    try {
      // Auto-approve account directly
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

  // EMPLOYEE SIGN UP - WITH PASSWORD CREATION
  const handleDirectEmployeeSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusNotice('');

    if (!name.trim() || !email.trim()) {
      setErrorMsg('Please enter both your full name and email address.');
      return;
    }

    if (!password) {
      setErrorMsg('Please create a password for your account.');
      return;
    }

    if (password.length < 4) {
      setErrorMsg('Password must be at least 4 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please verify your password confirmation.');
      return;
    }

    const users = getStoredUsers();
    const existing = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (existing) {
      setErrorMsg('An account with this email already exists. Please log in with your password.');
      return;
    }

    setIsSubmitting(true);
    setStatusNotice('Creating employee account and securing credentials...');

    try {
      // Create approved employee with password!
      const newEmployee: AppUser = {
        id: `emp-${Date.now()}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: password,
        role: 'employee',
        approved: true,
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

  // PASSWORD RESET: Resets password to "admin123" and syncs to Google Sheets
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusNotice('');

    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      setErrorMsg('Please enter your account email address to reset your password.');
      return;
    }

    const users = getStoredUsers();
    let targetUser = users.find((u) => u.email.toLowerCase() === targetEmail);

    if (!targetUser) {
      setErrorMsg('No account found with this email address. Please verify your email.');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Reset password strictly to "admin123"
      targetUser.password = 'admin123';
      targetUser.lastActive = new Date().toISOString();
      saveStoredUsers(users);
      await syncUserToFirestore(targetUser);

      // 2. Sync reset password "admin123" into the Google Sheet Employee_Credentials tab
      const storageSettings = getStorageSettings();
      const token = storageSettings.adminAccessToken;
      if (token) {
        try {
          const spreadsheetId = await getOrCreateSpreadsheet(token, storageSettings.spreadsheetName);
          await updateUserPasswordInSheet(token, spreadsheetId, targetUser);
        } catch (sheetErr) {
          console.warn('Google Sheet password sync note on reset:', sheetErr);
        }
      }

      setStatusNotice('✅ Password has been reset to: admin123. You can now log in using your email and admin123.');
      setPassword('admin123');
      setAdminPassword('admin123');
    } catch (err: any) {
      setErrorMsg(`Failed to reset password: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // PASSWORD CHANGE: Requires Old Password, creates New Password, and syncs to Google Sheet
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusNotice('');

    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      setErrorMsg('Please enter your account email address.');
      return;
    }

    if (!oldPassword) {
      setErrorMsg('Please enter your current (old) password.');
      return;
    }

    if (!newPassword || newPassword.length < 4) {
      setErrorMsg('New password must be at least 4 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }

    const users = getStoredUsers();
    let targetUser = users.find((u) => u.email.toLowerCase() === targetEmail);

    if (!targetUser) {
      setErrorMsg('No account found with this email address.');
      return;
    }

    // Verify old password
    const currentExpectedPassword = targetUser.password || (targetUser.role === 'admin' ? 'admin123' : '123456');
    if (oldPassword !== currentExpectedPassword) {
      setErrorMsg('Old password is incorrect. Please verify your current password.');
      return;
    }

    setIsSubmitting(true);
    try {
      targetUser.password = newPassword;
      targetUser.lastActive = new Date().toISOString();
      saveStoredUsers(users);
      await syncUserToFirestore(targetUser);

      // Sync new password into the Google Sheet Employee_Credentials tab
      const storageSettings = getStorageSettings();
      const token = storageSettings.adminAccessToken;
      if (token) {
        try {
          const spreadsheetId = await getOrCreateSpreadsheet(token, storageSettings.spreadsheetName);
          await updateUserPasswordInSheet(token, spreadsheetId, targetUser);
        } catch (sheetErr) {
          console.warn('Google Sheet password sync note on change:', sheetErr);
        }
      }

      setStatusNotice('✅ Password changed successfully and updated in Google Sheet! Please log in with your new password.');
      setPassword(newPassword);
    } catch (err: any) {
      setErrorMsg(`Failed to update password: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

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

        {/* MODE 1: EMPLOYEE LOGIN (Requires Email and Password) */}
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
                  placeholder="e.g. david.miller@company.com"
                  required
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <span className="text-[11px] text-slate-400">Required for access</span>
              </div>
              <div className="relative">
                <input
                  id="employee-login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your personal account password"
                  required
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center justify-between pt-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => handleSwitchMode('reset_password')}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer"
                >
                  Forgot / Reset to default?
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('change_password')}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium cursor-pointer"
                >
                  Change password
                </button>
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

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_signup')}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                New employee on this PC? Create your account & password →
              </button>
            </div>
          </form>
        )}

        {/* MODE 2: EMPLOYEE SIGN-UP (Name, Email, Password, Confirm Password) */}
        {mode === 'employee_signup' && (
          <form onSubmit={handleDirectEmployeeSignup} className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 rounded-xl text-emerald-900 dark:text-emerald-200 text-xs flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong>Personal Account Setup:</strong> Create your secure credentials. A dedicated Google Drive folder and Sheet tab will be prepared for your desktop activity.
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

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Create Account Password
              </label>
              <div className="relative">
                <input
                  id="signup-password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 4 characters"
                  required
                  minLength={4}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Confirm Password
              </label>
              <input
                id="signup-confirm-password-input"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
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

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_login')}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                Already have an account? Sign in here →
              </button>
            </div>
          </form>
        )}

        {/* MODE 3: ADMIN LOGIN */}
        {mode === 'admin_login' && (
          <form onSubmit={handleAdminLogin} className="space-y-4">
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
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Admin Master Password
              </label>
              <div className="relative">
                <input
                  id="admin-login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Enter admin password (default: admin123)"
                  required
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="text-[11px] text-slate-400">
                Default master password: <code className="text-indigo-600 font-semibold">admin123</code>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Enter Admin Dashboard</span>
            </button>
          </form>
        )}

        {/* MODE 4: RESET PASSWORD (Resets password to "admin123" and syncs to Google Sheets) */}
        {mode === 'reset_password' && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3.5 rounded-xl text-amber-900 dark:text-amber-200 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4 text-amber-600" />
                <span>Reset Password to Default</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-[11px]">
                Forgot your password? Enter your email address below. Your password will be immediately reset to the system default: <strong className="text-indigo-600 font-mono">admin123</strong>, and synced to your Google Sheet credentials record.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Registered Account Email
              </label>
              <input
                id="reset-password-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. employee@company.com"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400">
              New Default Password will be set to: <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">admin123</span>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Resetting Password to admin123...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  <span>Reset My Password to admin123</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_login')}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                ← Back to Staff Login
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('change_password')}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                Remember old password? Change it instead →
              </button>
            </div>
          </form>
        )}

        {/* MODE 5: CHANGE PASSWORD (Requires Old Password, Creates New Password, Syncs to Google Sheet) */}
        {mode === 'change_password' && (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 p-3.5 rounded-xl text-indigo-900 dark:text-indigo-200 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-indigo-600" />
                <span>Change Your Password</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-[11px]">
                Enter your existing old password and set a new password. The new password will automatically update in your local account, Firestore database, and Google Sheets credentials tab.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Account Email Address
              </label>
              <input
                id="change-password-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. employee@company.com"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Current (Old) Password
              </label>
              <input
                id="change-password-old"
                type={showPassword ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Enter your current password"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                New Password
              </label>
              <input
                id="change-password-new"
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 4 characters"
                required
                minLength={4}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Confirm New Password
              </label>
              <input
                id="change-password-confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Updating & Syncing to Google Sheets...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Update Password & Sync to Sheets</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_login')}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                ← Back to Staff Login
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('reset_password')}
                className="text-xs text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              >
                Forgot old password? Reset to admin123 →
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
