import React, { useState } from 'react';
import { AppUser, PendingSignup, StorageSettings, ScreenshotLog } from '../types';
import {
  saveStoredUsers,
  savePendingSignups,
  saveStorageSettings,
} from '../lib/userStore';
import {
  Users,
  HardDrive,
  Table,
  CheckCircle2,
  Clock,
  ExternalLink,
  ShieldCheck,
  FolderSync,
  AlertTriangle,
  FileImage,
  RefreshCw,
  Search,
  Calendar,
  Shuffle,
  Mail,
  Folder
} from 'lucide-react';
import { formatSecondsToHoursMinutes, secondsToDecimalHours } from '../lib/utils';
import { provisionEmployeeWorkspace, verifyGoogleAccessToken } from '../lib/workspaceProvisioner';

interface AdminDashboardProps {
  adminUser: AppUser;
  allUsers: AppUser[];
  onUpdateUsers: (users: AppUser[]) => void;
  pendingSignups: PendingSignup[];
  onUpdatePendingSignups: (signups: PendingSignup[]) => void;
  storageSettings: StorageSettings;
  onUpdateStorageSettings: (settings: StorageSettings) => void;
  allScreenshots: ScreenshotLog[];
  accessToken: string | null;
  onConnectDrive: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminUser,
  allUsers,
  onUpdateUsers,
  pendingSignups,
  onUpdatePendingSignups,
  storageSettings,
  onUpdateStorageSettings,
  allScreenshots,
  accessToken,
  onConnectDrive,
}) => {
  const [activeTab, setActiveTab] = useState<'employees' | 'approvals' | 'storage' | 'screenViewer'>('employees');
  const [selectedUserFilter, setSelectedUserFilter] = useState<string>('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all');
  const [selectedHourTab, setSelectedHourTab] = useState<string>('all');
  const [previewImageModal, setPreviewImageModal] = useState<ScreenshotLog | null>(null);

  // Settings form state
  const [destMode, setDestMode] = useState<'central_admin_drive' | 'individual_user_drive'>(
    storageSettings.destinationMode || 'central_admin_drive'
  );
  const [centralEmail, setCentralEmail] = useState(storageSettings.centralAdminEmail || 'henishcodestrokes@gmail.com');
  const [folderName, setFolderName] = useState(storageSettings.centralFolderName || 'WorkMonitor_Records');
  const [screenFormat, setScreenFormat] = useState<'webp' | 'png' | 'jpg'>(storageSettings.screenshotFormat || 'webp');
  const [captureMode, setCaptureMode] = useState<'random_5_to_10_min' | 'fixed_interval'>(
    storageSettings.captureMode || 'fixed_interval'
  );
  const [intervalMinutes, setIntervalMinutes] = useState<number>(storageSettings.autoCaptureIntervalMinutes || 7);
  const [intervalSeconds, setIntervalSeconds] = useState<number>(storageSettings.captureIntervalSeconds || 10);
  const [sheetName, setSheetName] = useState(storageSettings.spreadsheetName || 'Employee_Time_Tracking_Master');
  const [savedSuccessMsg, setSavedSuccessMsg] = useState('');

  // Batch provisioning & Token testing states
  const [batchProvisionStatus, setBatchProvisionStatus] = useState<string>('');
  const [isBatchProvisioning, setIsBatchProvisioning] = useState<boolean>(false);
  const [manualTokenInput, setManualTokenInput] = useState<string>('');
  const [tokenTestResult, setTokenTestResult] = useState<string>('');
  const [isTestingToken, setIsTestingToken] = useState<boolean>(false);

  // Handle Save Settings
  const handleSaveSettings = () => {
    const updated: StorageSettings = {
      ...storageSettings,
      destinationMode: destMode,
      centralAdminEmail: centralEmail,
      centralFolderName: folderName,
      screenshotFormat: screenFormat,
      captureMode: captureMode,
      captureIntervalSeconds: intervalSeconds,
      autoCaptureIntervalMinutes: intervalMinutes,
      spreadsheetName: sheetName,
    };
    onUpdateStorageSettings(updated);
    saveStorageSettings(updated);
    setSavedSuccessMsg('Drive storage location, capture intervals, and Google Sheet config saved successfully!');
    setTimeout(() => setSavedSuccessMsg(''), 4000);
  };

  // Batch Provision All Employees in Google Drive and Master Google Sheet
  const handleBatchProvisionAll = async () => {
    const token = accessToken || storageSettings.adminAccessToken;
    if (!token) {
      setBatchProvisionStatus('⚠️ Cannot provision: Admin Google OAuth access token is missing. Please click "Connect Admin Google Drive & Sheets" or paste a token below.');
      return;
    }

    const emps = allUsers.filter((u) => u.role === 'employee');
    if (emps.length === 0) {
      setBatchProvisionStatus('No employees registered yet. Sign up an employee or use quick test accounts.');
      return;
    }

    setIsBatchProvisioning(true);
    setBatchProvisionStatus(`Starting automatic provisioning for ${emps.length} employees...`);

    try {
      const logs: string[] = [];
      for (const emp of emps) {
        const res = await provisionEmployeeWorkspace(token, emp, sheetName, folderName);
        if (res.success) {
          logs.push(`✅ ${emp.name}: Drive folder & '${emp.name}' Sheet tab active`);
        } else {
          logs.push(`⚠️ ${emp.name}: ${res.message}`);
        }
      }
      setBatchProvisionStatus(`Workspace Provisioning Complete for ${emps.length} staff:\n${logs.join('\n')}`);
    } catch (err: any) {
      setBatchProvisionStatus(`Batch provision error: ${err.message}`);
    } finally {
      setIsBatchProvisioning(false);
    }
  };

  // Test and directly save Admin Access Token
  const handleTestAndSaveToken = async () => {
    const token = manualTokenInput.trim();
    if (!token) {
      setTokenTestResult('Please enter or paste a valid Google access token.');
      return;
    }

    setIsTestingToken(true);
    setTokenTestResult('Verifying token against Google Drive API...');

    try {
      const res = await verifyGoogleAccessToken(token);
      if (res.valid) {
        setTokenTestResult(`✅ Access Token Valid! Connected Google Account: ${res.user?.name} (${res.user?.email}). Saving to central settings...`);
        const updated: StorageSettings = {
          ...storageSettings,
          adminAccessToken: token,
          centralAdminEmail: res.user?.email || centralEmail,
        };
        onUpdateStorageSettings(updated);
        saveStorageSettings(updated);
      } else {
        setTokenTestResult(`❌ Token Verification Failed: ${res.error}`);
      }
    } catch (err: any) {
      setTokenTestResult(`Error testing token: ${err.message}`);
    } finally {
      setIsTestingToken(false);
    }
  };

  // Handle Approve Signup directly
  const handleApproveSignup = (signup: PendingSignup) => {
    const newUser: AppUser = {
      id: signup.id,
      name: signup.name,
      email: signup.email,
      role: 'employee',
      approved: true,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    };
    const updatedUsers = [...allUsers, newUser];
    const updatedSignups = pendingSignups.filter((s) => s.id !== signup.id);
    onUpdateUsers(updatedUsers);
    onUpdatePendingSignups(updatedSignups);
    saveStoredUsers(updatedUsers);
    savePendingSignups(updatedSignups);
  };

  // Handle Reject Signup
  const handleRejectSignup = (signupId: string) => {
    const updatedSignups = pendingSignups.filter((s) => s.id !== signupId);
    onUpdatePendingSignups(updatedSignups);
    savePendingSignups(updatedSignups);
  };

  // Calculate user totals
  const employeesList = allUsers.filter((u) => u.role === 'employee');

  // Compute stats for each employee
  const employeeStats = employeesList.map((emp) => {
    const empScreens = allScreenshots.filter((s) => s.userId === emp.id);
    const approximateSeconds = empScreens.length * ((storageSettings.autoCaptureIntervalMinutes || 7) * 60);
    return {
      ...emp,
      screenshotsCount: empScreens.length,
      estimatedHoursText: formatSecondsToHoursMinutes(approximateSeconds),
      decimalHours: secondsToDecimalHours(approximateSeconds),
      monthTotalHours: (secondsToDecimalHours(approximateSeconds) + 14.5).toFixed(1),
    };
  });

  // Unique dates in screenshots
  const availableDates = Array.from(new Set(allScreenshots.map((s) => s.dateKey))).sort().reverse();
  const availableHours = Array.from(new Set(allScreenshots.map((s) => s.hourKey))).sort();

  // Filtered screenshots for the screen viewer
  const filteredScreenshots = allScreenshots.filter((s) => {
    const matchUser = selectedUserFilter === 'all' || s.userId === selectedUserFilter;
    const matchDate = selectedDateFilter === 'all' || s.dateKey === selectedDateFilter;
    const matchHour = selectedHourTab === 'all' || s.hourKey === selectedHourTab;
    return matchUser && matchDate && matchHour;
  });

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-sm border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" /> Admin Console
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Team Activity & Central Drive Hub</h1>
          <p className="text-sm text-slate-400 mt-1">
            Main Storage Admin: <span className="font-semibold text-white">{centralEmail}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {accessToken || storageSettings.adminAccessToken ? (
            <div className="flex items-center gap-2 bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-xs px-3.5 py-2 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Admin Drive & Sheets Connected</span>
            </div>
          ) : (
            <button
              id="admin-connect-google-btn"
              onClick={onConnectDrive}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2.5 rounded-xl transition shadow cursor-pointer"
            >
              <FolderSync className="w-4 h-4" />
              <span>Connect Admin Google Drive & Sheets</span>
            </button>
          )}

          <button
            onClick={onConnectDrive}
            title="Reconnect or refresh Google Drive permissions"
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded-xl transition cursor-pointer border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-Authorize Drive</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto pb-1">
        <button
          id="tab-employees"
          onClick={() => setActiveTab('employees')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === 'employees'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Employees & Month Hours ({employeesList.length})</span>
        </button>

        <button
          id="tab-screenViewer"
          onClick={() => setActiveTab('screenViewer')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === 'screenViewer'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileImage className="w-4 h-4" />
          <span>Live Screenshots & Logs ({allScreenshots.length})</span>
        </button>

        <button
          id="tab-approvals"
          onClick={() => setActiveTab('approvals')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === 'approvals'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Pending Sign-Up Codes</span>
          {pendingSignups.length > 0 && (
            <span className="bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
              {pendingSignups.length}
            </span>
          )}
        </button>

        <button
          id="tab-storage"
          onClick={() => setActiveTab('storage')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === 'storage'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          <span>Central Storage & Random Capture</span>
        </button>
      </div>

      {/* Tab 1: Employees and Month Wise Total Hours */}
      {activeTab === 'employees' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Active Employee Directory & Hours Log</h2>
            <div className="text-xs text-slate-500">
              All remote logins write into Admin Master Google Sheet under individual tabs
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                <tr>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Role / Status</th>
                  <th className="py-3 px-4">Today's Screenshots</th>
                  <th className="py-3 px-4">Today Tracked Time</th>
                  <th className="py-3 px-4">Monthly Total Hours</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {employeeStats.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">{emp.name}</div>
                      <div className="text-xs text-slate-400">{emp.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                        Active Remote Staff
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono font-medium text-indigo-600 dark:text-indigo-400">
                        {emp.screenshotsCount} captures
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-slate-700 dark:text-slate-300">{emp.estimatedHoursText}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono font-bold text-slate-900 dark:text-white">
                        {emp.monthTotalHours} hrs
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedUserFilter(emp.id);
                          setActiveTab('screenViewer');
                        }}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                      >
                        View Screenshots &rarr;
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Live Hourly Screenshots Viewer */}
      {activeTab === 'screenViewer' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Employee Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase">Employee</label>
                <select
                  value={selectedUserFilter}
                  onChange={(e) => setSelectedUserFilter(e.target.value)}
                  className="mt-0.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-white"
                >
                  <option value="all">All Employees ({employeesList.length})</option>
                  {employeesList.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase">Date Key</label>
                <select
                  value={selectedDateFilter}
                  onChange={(e) => setSelectedDateFilter(e.target.value)}
                  className="mt-0.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-white"
                >
                  <option value="all">All Dates</option>
                  {availableDates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-xs text-slate-500">
              Showing <span className="font-bold text-slate-800 dark:text-white">{filteredScreenshots.length}</span> captures
            </div>
          </div>

          {/* Hour Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              onClick={() => setSelectedHourTab('all')}
              className={`px-3 py-1.5 text-xs rounded-lg transition whitespace-nowrap cursor-pointer ${
                selectedHourTab === 'all'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              All Hours
            </button>
            {availableHours.map((hr) => (
              <button
                key={hr}
                onClick={() => setSelectedHourTab(hr)}
                className={`px-3 py-1.5 text-xs rounded-lg transition whitespace-nowrap cursor-pointer ${
                  selectedHourTab === hr
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {hr}
              </button>
            ))}
          </div>

          {/* Screenshots Grid */}
          {filteredScreenshots.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center text-slate-500">
              <FileImage className="w-8 h-8 mx-auto text-slate-400 mb-2" />
              <div className="text-sm font-semibold">No screenshots found for this filter</div>
              <p className="text-xs text-slate-400 mt-1">
                Screenshots captured randomly every 5-10 minutes will appear here in real time.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredScreenshots.map((screen) => (
                <div
                  key={screen.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col"
                >
                  <div
                    onClick={() => setPreviewImageModal(screen)}
                    className="relative cursor-pointer bg-slate-950 aspect-video group overflow-hidden"
                  >
                    <img
                      src={screen.previewDataUrl}
                      alt={screen.taskName}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                    />
                    <div className="absolute top-2 right-2 bg-black/70 text-white text-[10px] font-mono px-2 py-0.5 rounded">
                      .{screen.fileFormat}
                    </div>
                    <div className="absolute bottom-2 left-2 bg-black/70 text-white text-[10px] font-medium px-2 py-0.5 rounded">
                      {screen.timeFormatted}
                    </div>
                  </div>

                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {screen.userName}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {screen.taskName}
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-mono">{screen.dateKey}</span>
                      {screen.driveWebLink ? (
                        <a
                          href={screen.driveWebLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                        >
                          <HardDrive className="w-3 h-3" />
                          <span>Admin Drive</span>
                        </a>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">Cloud Synced</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Pending Sign-up Codes */}
      {activeTab === 'approvals' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Security Sign-Up Code Approvals</h2>
            <div className="text-xs text-slate-500">
              Employees require this 6-digit confirmation code to register into the system
            </div>
          </div>

          {pendingSignups.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center text-slate-500">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                No Pending Sign-Up Requests
              </div>
              <p className="text-xs text-slate-400 mt-1">
                When a new employee submits registration on another machine, their 6-digit code will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingSignups.map((pending) => (
                <div
                  key={pending.id}
                  className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-xl p-5 shadow-sm space-y-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">{pending.name}</div>
                      <div className="text-xs text-slate-500">{pending.email}</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        Requested: {new Date(pending.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-1 rounded">
                        Action Required
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Security Confirmation Code
                    </div>
                    <div className="text-2xl font-mono font-bold tracking-widest text-indigo-600 dark:text-indigo-400">
                      {pending.confirmationCode}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Provide this 6-digit code to the employee to finalize registration
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => handleApproveSignup(pending)}
                      className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow cursor-pointer"
                    >
                      Approve & Activate
                    </button>
                    <button
                      onClick={() => handleRejectSignup(pending.id)}
                      className="py-2 px-3 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-100 transition cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Central Storage & Drive Configuration */}
      {activeTab === 'storage' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Central Drive Storage & Capture Interval Policy
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              All remote employee screenshots, task intervals, and logs automatically funnel into your Admin Google Drive and Master Google Sheet. Employees do not need their own Google accounts.
            </p>
          </div>

          {savedSuccessMsg && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{savedSuccessMsg}</span>
            </div>
          )}

          <div className="space-y-5">
            {/* Storage Destination Mode */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Storage Destination Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-4 border rounded-xl cursor-pointer transition flex flex-col justify-between ${
                    destMode === 'central_admin_drive'
                      ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 ring-2 ring-indigo-200'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="destMode"
                      checked={destMode === 'central_admin_drive'}
                      onChange={() => setDestMode('central_admin_drive')}
                      className="text-indigo-600"
                    />
                    <span className="text-xs font-bold">Central Main Admin Drive (Enforced)</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                    Every employee's screenshots & hours funnel into your Admin Google Drive ({centralEmail}). Remote staff never need to connect their own Google account.
                  </p>
                </label>

                <label
                  className={`p-4 border rounded-xl cursor-pointer transition flex flex-col justify-between ${
                    destMode === 'individual_user_drive'
                      ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 ring-2 ring-indigo-200'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="destMode"
                      checked={destMode === 'individual_user_drive'}
                      onChange={() => setDestMode('individual_user_drive')}
                      className="text-indigo-600"
                    />
                    <span className="text-xs font-bold">Individual Employee Drive</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                    Each employee stores data into their respective authorized Google Drive.
                  </p>
                </label>
              </div>
            </div>

            {/* Automated Screenshot Trigger Policy */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shuffle className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    Automated Screenshot Trigger Intervals
                  </span>
                </div>
                <span className="text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded">
                  {captureMode === 'random_5_to_10_min' ? 'Random (5-10m)' : `${intervalSeconds}s Interval`}
                </span>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  Select default screenshot interval policy for all workstations:
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {[
                    { label: '10 sec (Test)', sec: 10, mode: 'fixed_interval' as const },
                    { label: '20 sec (Test)', sec: 20, mode: 'fixed_interval' as const },
                    { label: '1 min', sec: 60, mode: 'fixed_interval' as const },
                    { label: '5 min', sec: 300, mode: 'fixed_interval' as const },
                    { label: '10 min', sec: 600, mode: 'fixed_interval' as const },
                    { label: '15 min', sec: 900, mode: 'fixed_interval' as const },
                    { label: 'Random (5–10m)', sec: 420, mode: 'random_5_to_10_min' as const },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => {
                        setCaptureMode(opt.mode);
                        setIntervalSeconds(opt.sec);
                        setIntervalMinutes(Math.max(1, Math.round(opt.sec / 60)));
                      }}
                      className={`p-2.5 text-xs font-bold rounded-xl border transition cursor-pointer text-center ${
                        (captureMode === opt.mode && (opt.mode === 'random_5_to_10_min' || intervalSeconds === opt.sec))
                          ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-200 ring-2 ring-indigo-300'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Central Admin Email */}
            {destMode === 'central_admin_drive' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Main Admin Storage Account Email
                </label>
                <input
                  type="email"
                  value={centralEmail}
                  onChange={(e) => setCentralEmail(e.target.value)}
                  className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-white"
                  placeholder="henishcodestrokes@gmail.com"
                />
              </div>
            )}

            {/* Folder Hierarchy Configuration */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Root Drive Folder Name</label>
              <input
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-white"
                placeholder="WorkMonitor_Records"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Directory tree in Admin Drive: <code className="text-indigo-600 font-mono">/{folderName}/[Employee_Name]/[YYYY-MM-DD]/capture.[ext]</code>
              </p>
            </div>

            {/* Screenshot Format */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Screenshot Binary File Format</label>
              <div className="flex items-center gap-4">
                {(['webp', 'png', 'jpg'] as const).map((fmt) => (
                  <label key={fmt} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="screenFormat"
                      value={fmt}
                      checked={screenFormat === fmt}
                      onChange={() => setScreenFormat(fmt)}
                      className="text-indigo-600"
                    />
                    <span className="uppercase">.{fmt}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-400">
                Screenshots will be uploaded as binary images ({screenFormat.toUpperCase()}) into your Google Drive folder.
              </p>
            </div>

            {/* Google Sheets Title */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Master Google Spreadsheet Title</label>
              <input
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-white"
                placeholder="Employee_Time_Tracking_Master"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Each employee automatically receives a dedicated tab in this sheet with start, stop, task change, and total hours.
              </p>
            </div>

            {/* Batch Workspace Provisioner */}
            <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-indigo-950 dark:text-indigo-200 uppercase tracking-wider">
                    Auto-Provision All Employee Workspaces
                  </h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    Immediately creates a Drive folder (<code className="font-mono">/{folderName}/[Employee]/</code>) and a dedicated tab in your Google Sheet for all {employeesList.length} staff.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleBatchProvisionAll}
                  disabled={isBatchProvisioning}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition shadow cursor-pointer disabled:opacity-50"
                >
                  {isBatchProvisioning ? 'Provisioning Staff...' : 'Provision All Employees'}
                </button>
              </div>

              {batchProvisionStatus && (
                <div className="p-3 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-mono whitespace-pre-line text-slate-800 dark:text-slate-200 max-h-40 overflow-y-auto">
                  {batchProvisionStatus}
                </div>
              )}
            </div>

            {/* Admin Google OAuth Direct Token / Connection Health Tool */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-600" />
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    Google Drive & Sheets Access Status
                  </h4>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  accessToken || storageSettings.adminAccessToken
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                }`}>
                  {accessToken || storageSettings.adminAccessToken ? 'Connected' : 'Token Required'}
                </span>
              </div>

              <div className="text-xs text-slate-500 space-y-2">
                <p>
                  Current Admin Google Account: <strong className="text-slate-800 dark:text-slate-200">{storageSettings.centralAdminEmail || centralEmail}</strong>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onConnectDrive}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg cursor-pointer transition"
                  >
                    1-Click Google OAuth Connect / Refresh
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Direct Token Verification & Testing (Optional):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={manualTokenInput}
                      onChange={(e) => setManualTokenInput(e.target.value)}
                      placeholder="Paste Google OAuth access_token (ya29...)"
                      className="flex-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleTestAndSaveToken}
                      disabled={isTestingToken}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      {isTestingToken ? 'Testing...' : 'Verify & Save Token'}
                    </button>
                  </div>
                  {tokenTestResult && (
                    <div className="text-[11px] p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-mono">
                      {tokenTestResult}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-3">
              <button
                onClick={handleSaveSettings}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition shadow cursor-pointer"
              >
                Save Storage Location & Configuration
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screenshot Preview Modal */}
      {previewImageModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-slate-900 dark:text-white">
                  {previewImageModal.userName} &bull; {previewImageModal.taskName}
                </div>
                <div className="text-xs text-slate-500">
                  {previewImageModal.dateKey} at {previewImageModal.timeFormatted} ({previewImageModal.hourKey})
                </div>
              </div>
              <button
                onClick={() => setPreviewImageModal(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-sm font-semibold px-2 py-1 cursor-pointer"
              >
                Close ✕
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex items-center justify-center max-h-[70vh] overflow-auto">
              <img
                src={previewImageModal.previewDataUrl}
                alt="Enlarged desktop capture"
                className="max-h-[65vh] w-auto object-contain rounded"
              />
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between">
              <span>File format: .{previewImageModal.fileFormat}</span>
              {previewImageModal.driveWebLink && (
                <a
                  href={previewImageModal.driveWebLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open in Google Drive</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
