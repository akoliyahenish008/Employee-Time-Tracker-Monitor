import React, { useState } from 'react';
import { AppUser, PendingSignup } from '../types';
import {
  getStoredUsers,
  saveStoredUsers,
  getPendingSignups,
  savePendingSignups,
  setActiveSessionUser,
  getStorageSettings,
} from '../lib/userStore';
import {
  addPendingSignupToFirestore,
  removePendingSignupFromFirestore,
  syncUserToFirestore,
} from '../lib/firebase';
import { generateConfirmationCode } from '../lib/utils';
import { getOrCreateSpreadsheet, logEmployeeRegistrationToSheet } from '../lib/sheetService';
import { ShieldCheck, User, KeyRound, CheckCircle2, AlertCircle, ArrowRight, RefreshCw, Lock, Sparkles } from 'lucide-react';

interface AuthScreenProps {
  onLoginSuccess: (user: AppUser) => void;
  onAdminConfirmationDispatched: (code: string) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLoginSuccess,
  onAdminConfirmationDispatched,
}) => {
  const [mode, setMode] = useState<'admin_login' | 'employee_login' | 'employee_signup'>('employee_login');

  // Form states
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [confirmationCodeInput, setConfirmationCodeInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSignupData, setPendingSignupData] = useState<PendingSignup | null>(null);

  // Switch mode
  const handleSwitchMode = (newMode: 'admin_login' | 'employee_login' | 'employee_signup') => {
    setMode(newMode);
    setErrorMsg('');
    setSuccessNotice('');
    setPendingSignupData(null);
  };

  // ADMIN LOGIN
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const users = getStoredUsers();
    const admin = users.find((u) => u.role === 'admin' && u.email.toLowerCase() === email.toLowerCase());

    if (!admin) {
      setErrorMsg('No Admin account found with this email. Admin email is henishcodestrokes@gmail.com');
      return;
    }

    setActiveSessionUser(admin);
    onLoginSuccess(admin);
  };

  // EMPLOYEE LOGIN
  const handleEmployeeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const users = getStoredUsers();
    const employee = users.find(
      (u) => u.role === 'employee' && u.email.toLowerCase() === email.toLowerCase()
    );

    if (!employee) {
      setErrorMsg('No employee account found with this email. Please sign up or check spelling.');
      return;
    }

    if (!employee.approved) {
      setErrorMsg('Your account is pending confirmation code approval by the administrator.');
      return;
    }

    // Update lastActive and sync
    employee.lastActive = new Date().toISOString();
    syncUserToFirestore(employee);

    // If Admin Google Drive token exists, also record login event into Admin's Google Sheet
    try {
      const storageSettings = getStorageSettings();
      if (storageSettings.adminAccessToken) {
        const sheetId = await getOrCreateSpreadsheet(storageSettings.adminAccessToken, storageSettings.spreadsheetName);
        await logEmployeeRegistrationToSheet(storageSettings.adminAccessToken, sheetId, employee);
      }
    } catch (e) {
      console.warn('Silent note: Sheet login sync:', e);
    }

    setActiveSessionUser(employee);
    onLoginSuccess(employee);
  };

  // EMPLOYEE SIGN UP STEP 1: Request Code
  const handleRequestSignupCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!name.trim() || !email.trim()) {
      setErrorMsg('Please enter both your full name and email address.');
      return;
    }

    const users = getStoredUsers();
    const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      setErrorMsg('An account with this email already exists. Please login instead.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Generate 6-digit confirmation code and dispatch to Main Admin
      const code = generateConfirmationCode();
      const newPending: PendingSignup = {
        id: `pending-${Date.now()}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        confirmationCode: code,
        timestamp: new Date().toISOString(),
      };

      // Save locally & to live cloud Firestore
      const pendingList = getPendingSignups();
      const updatedPending = [...pendingList.filter((p) => p.email !== newPending.email), newPending];
      savePendingSignups(updatedPending);
      await addPendingSignupToFirestore(newPending);

      setPendingSignupData(newPending);
      onAdminConfirmationDispatched(code);

      setSuccessNotice(
        `Confirmation code generated! The 6-digit verification code has been dispatched to the Main Admin. Please ask your administrator for the code to activate your account.`
      );
    } catch (err: any) {
      setErrorMsg(`Failed to initiate signup: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // EMPLOYEE SIGN UP STEP 2: Verify Code
  const handleVerifySignupCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!pendingSignupData) {
      setErrorMsg('Signup session expired. Please submit the form again.');
      return;
    }

    // Check against latest pending list
    const pendingList = getPendingSignups();
    const activePending = pendingList.find(p => p.id === pendingSignupData.id) || pendingSignupData;

    if (confirmationCodeInput.trim() !== activePending.confirmationCode) {
      setErrorMsg('Incorrect confirmation code. Please obtain the 6-digit code from the administrator.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Create the approved new employee account
      const newEmployee: AppUser = {
        id: activePending.id,
        name: activePending.name,
        email: activePending.email,
        role: 'employee',
        approved: true,
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
      };

      // Save user to cloud Firestore and local storage
      const users = getStoredUsers();
      const updatedUsers = [...users, newEmployee];
      saveStoredUsers(updatedUsers);
      await syncUserToFirestore(newEmployee);

      // Record to Admin Google Sheet if token configured
      try {
        const storageSettings = getStorageSettings();
        if (storageSettings.adminAccessToken) {
          const sheetId = await getOrCreateSpreadsheet(storageSettings.adminAccessToken, storageSettings.spreadsheetName);
          await logEmployeeRegistrationToSheet(storageSettings.adminAccessToken, sheetId, newEmployee);
        }
      } catch (e) {
        console.warn('Silent note: Sheet registration sync:', e);
      }

      // Remove from pending locally and in cloud
      savePendingSignups(pendingList.filter((p) => p.id !== activePending.id));
      await removePendingSignupFromFirestore(activePending.id);

      setActiveSessionUser(newEmployee);
      onLoginSuccess(newEmployee);
    } catch (err: any) {
      setErrorMsg(`Failed to activate employee account: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto my-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden">
      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-3 bg-slate-100 dark:bg-slate-800/80 p-1 border-b border-slate-200 dark:border-slate-800">
        <button
          id="tab-employee-login"
          onClick={() => handleSwitchMode('employee_login')}
          className={`py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
            mode === 'employee_login'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          Employee Login
        </button>
        <button
          id="tab-employee-signup"
          onClick={() => handleSwitchMode('employee_signup')}
          className={`py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
            mode === 'employee_signup'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          New Employee
        </button>
        <button
          id="tab-admin-login"
          onClick={() => handleSwitchMode('admin_login')}
          className={`py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
            mode === 'admin_login'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          Main Admin
        </button>
      </div>

      <div className="p-6 sm:p-8 space-y-6">
        {/* Header Title based on mode */}
        <div>
          {mode === 'employee_login' && (
            <div>
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1">
                <User className="w-4 h-4" /> Employee Workstation
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Sign In to Start Work</h2>
              <p className="text-xs text-slate-500 mt-1">
                Enter your registered employee email. Screenshots & time logs will automatically stream into the Admin Drive.
              </p>
            </div>
          )}

          {mode === 'employee_signup' && (
            <div>
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1">
                <Sparkles className="w-4 h-4" /> Remote Staff Registration
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Request Employee Access</h2>
              <p className="text-xs text-slate-500 mt-1">
                Register with your work email. A 6-digit confirmation code will be dispatched to the Administrator for verification.
              </p>
            </div>
          )}

          {mode === 'admin_login' && (
            <div>
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1">
                <ShieldCheck className="w-4 h-4" /> System Administrator
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Admin Hub Login</h2>
              <p className="text-xs text-slate-500 mt-1">
                Manage team directory, authorize signup codes, and configure the central Google Drive / Sheet.
              </p>
            </div>
          )}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success message */}
        {successNotice && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* FORM 1: Employee Login */}
        {mode === 'employee_login' && (
          <form onSubmit={handleEmployeeLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Employee Email
              </label>
              <input
                id="input-emp-login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. alex.rivera@team.internal"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              id="btn-emp-login-submit"
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm py-3 rounded-xl transition shadow cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Sign In & Open Workstation</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="pt-2 text-center text-xs text-slate-500">
              New team member?{' '}
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_signup')}
                className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer"
              >
                Sign up here
              </button>
            </div>
          </form>
        )}

        {/* FORM 2: Employee Sign Up */}
        {mode === 'employee_signup' && (
          <div className="space-y-4">
            {!pendingSignupData ? (
              <form onSubmit={handleRequestSignupCode} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Full Name
                  </label>
                  <input
                    id="input-signup-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Robert Smith"
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Work Email Address
                  </label>
                  <input
                    id="input-signup-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. robert.smith@company.com"
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <button
                  id="btn-request-signup-code"
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm py-3 rounded-xl transition shadow cursor-pointer flex items-center justify-center gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{isSubmitting ? 'Requesting...' : 'Request Admin Verification Code'}</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifySignupCode} className="space-y-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl space-y-1 text-xs">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    Registration requested for:
                  </div>
                  <div className="text-indigo-600 dark:text-indigo-400 font-bold">{pendingSignupData.name} ({pendingSignupData.email})</div>
                  <p className="text-slate-400 text-[11px] pt-1">
                    Enter the 6-digit confirmation code provided by your administrator.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    6-Digit Security Code
                  </label>
                  <input
                    id="input-confirmation-code"
                    type="text"
                    maxLength={6}
                    required
                    value={confirmationCodeInput}
                    onChange={(e) => setConfirmationCodeInput(e.target.value)}
                    placeholder="e.g. 849201"
                    className="w-full text-center tracking-widest font-mono text-xl font-bold border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-indigo-600 dark:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <button
                  id="btn-verify-signup-code"
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm py-3 rounded-xl transition shadow cursor-pointer flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isSubmitting ? 'Verifying...' : 'Verify Code & Activate Account'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPendingSignupData(null)}
                  className="w-full text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 py-1"
                >
                  &larr; Re-enter email or name
                </button>
              </form>
            )}
          </div>
        )}

        {/* FORM 3: Admin Login */}
        {mode === 'admin_login' && (
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Admin Email
              </label>
              <input
                id="input-admin-login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="henishcodestrokes@gmail.com"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              id="btn-admin-login-submit"
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm py-3 rounded-xl transition shadow cursor-pointer flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              <span>Sign In as Admin</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
