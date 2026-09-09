import React, { useState } from 'react';
import { AppUser, PendingSignup } from '../types';
import {
  getStoredUsers,
  saveStoredUsers,
  getPendingSignups,
  savePendingSignups,
  setActiveSessionUser,
} from '../lib/userStore';
import { generateConfirmationCode } from '../lib/utils';
import { ShieldCheck, User, KeyRound, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

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
  const [pendingSignupData, setPendingSignupData] = useState<PendingSignup | null>(null);

  // Switch mode
  const handleSwitchMode = (newMode: 'admin_login' | 'employee_login' | 'employee_signup') => {
    setMode(newMode);
    setErrorMsg('');
    setSuccessNotice('');
    setPendingSignupData(null);
  };

  // ADMIN LOGIN
  const handleAdminLogin = (e: React.FormEvent) => {
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
  const handleEmployeeLogin = (e: React.FormEvent) => {
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

    setActiveSessionUser(employee);
    onLoginSuccess(employee);
  };

  // EMPLOYEE SIGN UP STEP 1: Request Code
  const handleRequestSignupCode = (e: React.FormEvent) => {
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

    // Generate 6-digit confirmation code and dispatch to Main Admin
    const code = generateConfirmationCode();
    const newPending: PendingSignup = {
      id: `pending-${Date.now()}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      confirmationCode: code,
      timestamp: new Date().toISOString(),
    };

    const pendingList = getPendingSignups();
    const updatedPending = [...pendingList.filter((p) => p.email !== newPending.email), newPending];
    savePendingSignups(updatedPending);

    setPendingSignupData(newPending);
    onAdminConfirmationDispatched(code);

    setSuccessNotice(
      `Security confirmation code has been dispatched to the Main Admin. Please enter the 6-digit code received from Admin to finalize your signup.`
    );
  };

  // EMPLOYEE SIGN UP STEP 2: Verify Code
  const handleVerifySignupCode = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!pendingSignupData) {
      setErrorMsg('Signup session expired. Please submit the form again.');
      return;
    }

    if (confirmationCodeInput.trim() !== pendingSignupData.confirmationCode) {
      setErrorMsg('Incorrect confirmation code. Please obtain the 6-digit code from the administrator.');
      return;
    }

    // Create the approved new employee account
    const newEmployee: AppUser = {
      id: pendingSignupData.id,
      name: pendingSignupData.name,
      email: pendingSignupData.email,
      role: 'employee',
      approved: true,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    };

    const users = getStoredUsers();
    const updatedUsers = [...users, newEmployee];
    saveStoredUsers(updatedUsers);

    // Remove from pending
    const pendingList = getPendingSignups();
    savePendingSignups(pendingList.filter((p) => p.id !== pendingSignupData.id));

    setActiveSessionUser(newEmployee);
    onLoginSuccess(newEmployee);
  };

  return (
    <div className="w-full max-w-md mx-auto my-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden">
      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-3 bg-slate-100 dark:bg-slate-800/80 p-1 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => handleSwitchMode('employee_login')}
          className={`py-2 text-xs font-semibold rounded-lg transition ${
            mode === 'employee_login'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Employee Login
        </button>

        <button
          onClick={() => handleSwitchMode('admin_login')}
          className={`py-2 text-xs font-semibold rounded-lg transition ${
            mode === 'admin_login'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Admin Login
        </button>

        <button
          onClick={() => handleSwitchMode('employee_signup')}
          className={`py-2 text-xs font-semibold rounded-lg transition ${
            mode === 'employee_signup'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Employee Sign Up
        </button>
      </div>

      <div className="p-6 space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1">
            {mode === 'admin_login' ? (
              <>
                <ShieldCheck className="w-4 h-4" /> Administrator Portal
              </>
            ) : (
              <>
                <User className="w-4 h-4" /> Employee Workspace
              </>
            )}
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            {mode === 'admin_login' && 'Sign in as Administrator'}
            {mode === 'employee_login' && 'Sign in as Employee'}
            {mode === 'employee_signup' && 'Register New Employee Account'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {mode === 'admin_login' && 'Configure storage locations, view all team screens & approve sign-ups.'}
            {mode === 'employee_login' && 'Track hours, switch tasks, and capture activity into your date folder.'}
            {mode === 'employee_signup' && 'Requires a 6-digit confirmation code dispatched to the Main Admin.'}
          </p>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success Notice */}
        {successNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* ADMIN LOGIN FORM */}
        {mode === 'admin_login' && (
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Admin Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="henishcodestrokes@gmail.com"
                className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white text-xs font-bold py-3 rounded-xl transition shadow"
            >
              Sign In as Admin
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setEmail('henishcodestrokes@gmail.com')}
                className="text-[11px] text-indigo-600 hover:underline"
              >
                Auto-fill default admin email (henishcodestrokes@gmail.com)
              </button>
            </div>
          </form>
        )}

        {/* EMPLOYEE LOGIN FORM */}
        {mode === 'employee_login' && (
          <form onSubmit={handleEmployeeLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Employee Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. alex.rivera@team.internal"
                className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-3 rounded-xl transition shadow"
            >
              Sign In to Tracker Workspace
            </button>

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2">
              <button
                type="button"
                onClick={() => setEmail('alex.rivera@team.internal')}
                className="text-indigo-600 hover:underline"
              >
                Quick demo: Alex Rivera
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_signup')}
                className="text-slate-700 dark:text-slate-300 hover:underline font-semibold"
              >
                Need an account? Sign up
              </button>
            </div>
          </form>
        )}

        {/* EMPLOYEE SIGN UP FORM */}
        {mode === 'employee_signup' && (
          <div className="space-y-4">
            {!pendingSignupData ? (
              <form onSubmit={handleRequestSignupCode} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Full Name (will be used for Drive Folder & Sheet Tab)
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Daniel Morgan"
                    className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="daniel@company.com"
                    className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
                  <ShieldCheck className="w-4 h-4 text-amber-500 inline mr-1" />
                  Upon clicking submit, a security code is immediately routed to the Main Admin console for validation.
                </div>

                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-3 rounded-xl transition shadow flex items-center justify-center gap-2"
                >
                  <span>Request Admin Verification Code</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              /* Step 2: Fill Code */
              <form onSubmit={handleVerifySignupCode} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                    <span>Enter 6-Digit Code Provided by Admin</span>
                    <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    required
                    value={confirmationCodeInput}
                    onChange={(e) => setConfirmationCodeInput(e.target.value)}
                    placeholder="e.g. 842190"
                    className="w-full text-center tracking-widest text-lg font-mono font-bold border border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-slate-800 rounded-xl py-3 text-indigo-900 dark:text-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[11px] text-slate-400 text-center mt-1">
                    (In this prototype, code is: <code className="font-bold text-slate-800">{pendingSignupData.confirmationCode}</code>)
                  </p>
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-3 rounded-xl transition shadow"
                >
                  Verify Code & Complete Sign Up
                </button>

                <button
                  type="button"
                  onClick={() => setPendingSignupData(null)}
                  className="w-full text-xs text-slate-500 hover:underline"
                >
                  Cancel & Change Details
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
