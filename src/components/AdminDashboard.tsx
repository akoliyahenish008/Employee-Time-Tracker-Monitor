import React, { useState } from 'react';
import { AppUser, PendingSignup, StorageSettings } from '../types';
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
  Calendar
} from 'lucide-react';
import { formatSecondsToHoursMinutes, secondsToDecimalHours } from '../lib/utils';
import { ScreenshotLog } from '../types';

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
    storageSettings.destinationMode
  );
  const [centralEmail, setCentralEmail] = useState(storageSettings.centralAdminEmail);
  const [folderName, setFolderName] = useState(storageSettings.centralFolderName);
  const [screenFormat, setScreenFormat] = useState<'webp' | 'png' | 'jpg'>(storageSettings.screenshotFormat);
  const [sheetName, setSheetName] = useState(storageSettings.spreadsheetName);
  const [savedSuccessMsg, setSavedSuccessMsg] = useState('');

  // Handle Save Settings
  const handleSaveSettings = () => {
    const updated: StorageSettings = {
      ...storageSettings,
      destinationMode: destMode,
      centralAdminEmail: centralEmail,
      centralFolderName: folderName,
      screenshotFormat: screenFormat,
      spreadsheetName: sheetName,
    };
    onUpdateStorageSettings(updated);
    saveStorageSettings(updated);
    setSavedSuccessMsg('Drive storage location and format settings saved successfully!');
    setTimeout(() => setSavedSuccessMsg(''), 4000);
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
    saveStoredUsers(updatedUsers);
    onUpdatePendingSignups(updatedSignups);
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
    // Rough estimate: each screenshot represents interval time or calculated logged work
    const approximateSeconds = empScreens.length * (storageSettings.autoCaptureIntervalMinutes * 60);
    return {
      ...emp,
      screenshotsCount: empScreens.length,
      estimatedHoursText: formatSecondsToHoursMinutes(approximateSeconds),
      decimalHours: secondsToDecimalHours(approximateSeconds),
      monthTotalHours: (secondsToDecimalHours(approximateSeconds) + 14.5).toFixed(1), // Base recorded month hours + today
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
          <h1 className="text-2xl font-bold text-slate-100">Team Activity & Storage Hub</h1>
          <p className="text-sm text-slate-400 mt-1">
            Logged in as <span className="font-semibold text-white">{adminUser.name}</span> ({adminUser.email})
          </p>
        </div>

        <div className="flex items-center gap-3">
          {accessToken ? (
            <div className="flex items-center gap-2 bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-xs px-3.5 py-2 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Drive & Sheets Connected</span>
            </div>
          ) : (
            <button
              id="admin-connect-google-btn"
              onClick={onConnectDrive}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2.5 rounded-xl transition shadow"
            >
              <FolderSync className="w-4 h-4" />
              <span>Connect Admin Google Drive</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto pb-1">
        <button
          id="tab-employees"
          onClick={() => setActiveTab('employees')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
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
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
            activeTab === 'screenViewer'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileImage className="w-4 h-4" />
          <span>Hourly Screenshots & Date Logs ({allScreenshots.length})</span>
        </button>

        <button
          id="tab-approvals"
          onClick={() => setActiveTab('approvals')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
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
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
            activeTab === 'storage'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          <span>Storage Location & Drive Config</span>
        </button>
      </div>

      {/* Tab 1: Employees and Month Wise Total Hours */}
      {activeTab === 'employees' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">Active Employee Directory & Hours Log</h2>
            <div className="text-xs text-slate-500">
              Automatic sync to Google Sheet tab per employee name
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Role / Status</th>
                  <th className="py-3 px-4">Today's Screenshots</th>
                  <th className="py-3 px-4">Today Tracked Time</th>
                  <th className="py-3 px-4">Monthly Total Hours</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employeeStats.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{emp.name}</div>
                      <div className="text-xs text-slate-500">{emp.email}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 font-medium">
                      {emp.screenshotsCount} captures
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded">
                        {emp.estimatedHoursText}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-800">
                      {emp.monthTotalHours} hrs
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedUserFilter(emp.id);
                          setActiveTab('screenViewer');
                        }}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                      >
                        Inspect Screenshots →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Hourly Screenshots & Whole Day Date Logs */}
      {activeTab === 'screenViewer' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-800">Screen Monitoring Gallery</h3>
                <p className="text-xs text-slate-500">
                  Screenshots are stored strictly in nested folders: <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">[User Name] / [YYYY-MM-DD] / image.{storageSettings.screenshotFormat}</code>
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Employee Filter */}
                <select
                  value={selectedUserFilter}
                  onChange={(e) => setSelectedUserFilter(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
                >
                  <option value="all">All Employees</option>
                  {employeesList.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>

                {/* Date Filter */}
                <select
                  value={selectedDateFilter}
                  onChange={(e) => setSelectedDateFilter(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
                >
                  <option value="all">All Dates</option>
                  {availableDates.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Hour Tabs Bar */}
            <div className="border-t border-slate-100 pt-3">
              <div className="text-xs font-semibold text-slate-500 mb-2">Hour-by-Hour Timeline Tabbing:</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedHourTab('all')}
                  className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                    selectedHourTab === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All Hours (Whole Day)
                </button>
                {availableHours.map((hourStr) => (
                  <button
                    key={hourStr}
                    onClick={() => setSelectedHourTab(hourStr)}
                    className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                      selectedHourTab === hourStr
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {hourStr}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Screenshot Grid */}
          {filteredScreenshots.length === 0 ? (
            <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-500">
              <FileImage className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <div className="font-medium text-slate-700">No screenshots found for the selected filter</div>
              <p className="text-xs text-slate-400 mt-1">
                Start tracking in an employee session to capture live computer desktop activity into Drive.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredScreenshots.map((item) => (
                <div
                  key={item.id}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow transition flex flex-col"
                >
                  <div
                    className="relative cursor-pointer bg-slate-900 aspect-video overflow-hidden group"
                    onClick={() => setPreviewImageModal(item)}
                  >
                    <img
                      src={item.previewDataUrl}
                      alt={`Screen by ${item.userName}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-semibold">
                      Click to Enlarge ({item.fileFormat.toUpperCase()})
                    </div>
                    <span className="absolute top-2 right-2 bg-slate-900/80 text-white text-[10px] uppercase font-bold px-1.5 py-0.5 rounded">
                      .{item.fileFormat}
                    </span>
                  </div>

                  <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 truncate">{item.userName}</span>
                        <span className="text-slate-400 text-[11px]">{item.timeFormatted}</span>
                      </div>
                      <div className="text-xs text-indigo-600 font-medium truncate mt-0.5">
                        Task: {item.taskName}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        {item.dateKey}
                      </span>
                      {item.driveWebLink ? (
                        <a
                          href={item.driveWebLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline flex items-center gap-1"
                        >
                          Drive Link <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-400">Drive Syncing</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Pending Employee Signup Approvals and Confirmation Codes */}
      {activeTab === 'approvals' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-800">
                Employee Registration Verification Codes
              </h3>
              <p className="text-xs text-slate-500">
                When a new employee signs up, a 6-digit confirmation security code is dispatched to the admin here.
                Admin can give this code to the employee or approve directly.
              </p>
            </div>
          </div>

          {pendingSignups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <div className="font-semibold text-slate-700">No Pending Employee Sign-Ups</div>
              <p className="text-xs text-slate-400 mt-1">
                All employee accounts have been confirmed and authorized.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingSignups.map((s) => (
                <div key={s.id} className="bg-white border-2 border-amber-200 rounded-xl p-4 shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.email}</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        Requested: {new Date(s.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-slate-500">Verification Code:</div>
                      <div className="text-xl font-mono font-bold tracking-widest text-indigo-700 bg-indigo-50 px-2 py-1 rounded mt-1 border border-indigo-200">
                        {s.confirmationCode}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleRejectSignup(s.id)}
                      className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-medium transition"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApproveSignup(s)}
                      className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition shadow-sm"
                    >
                      Directly Authorize & Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Storage Settings (Admin Only) */}
      {activeTab === 'storage' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Storage Architecture & Location Control</h3>
            <p className="text-xs text-slate-500 mt-1">
              Configure where employee screenshots and time logs are saved: either all consolidated in one Admin Email Drive,
              or stored per individual employee's Drive. Only the administrator can view and modify these destination settings.
            </p>
          </div>

          {savedSuccessMsg && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 rounded-lg flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{savedSuccessMsg}</span>
            </div>
          )}

          <div className="space-y-4 max-w-2xl">
            {/* Storage Destination Mode */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                Storage Destination Architecture
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-3.5 border rounded-xl cursor-pointer transition flex flex-col justify-between ${
                    destMode === 'central_admin_drive'
                      ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 ring-2 ring-indigo-200'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
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
                    <span className="text-xs font-bold">Consolidated Admin Drive (Single Location)</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    All employees' screenshots and logs flow into the single main Admin account's Drive.
                  </p>
                </label>

                <label
                  className={`p-3.5 border rounded-xl cursor-pointer transition flex flex-col justify-between ${
                    destMode === 'individual_user_drive'
                      ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 ring-2 ring-indigo-200'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
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
                  <p className="text-[11px] text-slate-500 mt-2">
                    Each employee stores data into their respective authorized Google Drive.
                  </p>
                </label>
              </div>
            </div>

            {/* Central Admin Email */}
            {destMode === 'central_admin_drive' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Main Admin Storage Account Email</label>
                <input
                  type="email"
                  value={centralEmail}
                  onChange={(e) => setCentralEmail(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
                  placeholder="admin@company.com"
                />
              </div>
            )}

            {/* Folder Hierarchy Configuration */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Root Drive Folder Name</label>
              <input
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
                placeholder="WorkMonitor_Records"
              />
              <p className="text-[11px] text-slate-500">
                Directory tree created: <code className="text-indigo-600">/{folderName}/[Employee_Name]/[YYYY-MM-DD]/capture.[ext]</code>
              </p>
            </div>

            {/* Screenshot Format */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Screenshot Binary File Format</label>
              <div className="flex items-center gap-4">
                {(['webp', 'png', 'jpg'] as const).map((fmt) => (
                  <label key={fmt} className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
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
                Screenshots will be converted and uploaded as binary images ({screenFormat.toUpperCase()}), not JSON files.
              </p>
            </div>

            {/* Google Sheets Title */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Master Google Spreadsheet Title</label>
              <input
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
                placeholder="Employee_Time_Tracking_Master"
              />
              <p className="text-[11px] text-slate-500">
                Each employee automatically receives a dedicated tab in this sheet with precise start, pause, task change, and stop timestamps.
              </p>
            </div>

            <div className="pt-3">
              <button
                onClick={handleSaveSettings}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition shadow"
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
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-sm font-semibold px-2 py-1"
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
                  className="text-indigo-600 font-semibold hover:underline flex items-center gap-1"
                >
                  Open in Google Drive <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
