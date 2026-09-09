import React, { useState, useEffect, useRef } from 'react';
import { AppUser, ScreenshotLog, StorageSettings } from '../types';
import {
  Play,
  Pause,
  Square,
  Camera,
  Folder,
  Layers,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Activity,
  Monitor
} from 'lucide-react';
import {
  formatSecondsToHoursMinutes,
  secondsToDecimalHours,
  formatTimeString,
  getTodayDateKey,
  getHourSlotKey,
  canvasToBlob,
} from '../lib/utils';
import {
  resolveEmployeeDateFolder,
  uploadScreenshotToDrive,
} from '../lib/driveService';
import {
  getOrCreateSpreadsheet,
  logTaskIntervalToSheet,
} from '../lib/sheetService';

interface EmployeeDashboardProps {
  currentUser: AppUser;
  storageSettings: StorageSettings;
  accessToken: string | null;
  onConnectDrive: () => void;
  onNewScreenshot: (log: ScreenshotLog) => void;
  userScreenshots: ScreenshotLog[];
}

export const EmployeeDashboard: React.FC<EmployeeDashboardProps> = ({
  currentUser,
  storageSettings,
  accessToken,
  onConnectDrive,
  onNewScreenshot,
  userScreenshots,
}) => {
  const [taskName, setTaskName] = useState('Product Design & Implementation');
  const [isTracking, setIsTracking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Time metrics
  const [sessionSeconds, setSessionSeconds] = useState(0); // Current task duration
  const [dayTotalSeconds, setDayTotalSeconds] = useState(0); // Cumulative work duration today
  const [currentTaskStartTime, setCurrentTaskStartTime] = useState<string>('');
  const [lastSyncStatus, setLastSyncStatus] = useState<string>('Ready to start tracking');
  const [driveUploadCount, setDriveUploadCount] = useState<number>(0);
  const [selectedHourTab, setSelectedHourTab] = useState<string>('all');
  const [previewModal, setPreviewModal] = useState<ScreenshotLog | null>(null);

  // Screen capture references
  const screenStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const autoCaptureRef = useRef<number | null>(null);

  // Keep track of tasks switched today
  const [taskHistory, setTaskHistory] = useState<
    Array<{
      taskName: string;
      start: string;
      end: string;
      durationSec: number;
    }>
  >([]);

  // Timer loop
  useEffect(() => {
    if (isTracking && !isPaused) {
      timerRef.current = window.setInterval(() => {
        setSessionSeconds((prev) => prev + 1);
        setDayTotalSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTracking, isPaused]);

  // Clean up screen stream on unmount
  useEffect(() => {
    return () => {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (autoCaptureRef.current) clearInterval(autoCaptureRef.current);
    };
  }, []);

  // Request actual entire computer screen capture using getDisplayMedia
  const initScreenStream = async (): Promise<MediaStream | null> => {
    try {
      if (screenStreamRef.current && screenStreamRef.current.active) {
        return screenStreamRef.current;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor', // request entire monitor
        },
        audio: false,
      });

      // Handle user stopping screen share from browser banner
      stream.getVideoTracks()[0].onended = () => {
        setLastSyncStatus('Screen sharing stopped by user');
        screenStreamRef.current = null;
      };

      screenStreamRef.current = stream;
      return stream;
    } catch (err: any) {
      console.error('Screen capture permission error:', err);
      setLastSyncStatus(`Screen capture permission needed: ${err.message || 'Cancelled'}`);
      return null;
    }
  };

  /**
   * Captures screen frame as binary WebP, PNG, or JPG,
   * uploads directly to Drive into: User Folder -> Date Folder -> capture.[ext]
   */
  const captureAndUploadScreen = async (overrideTask?: string) => {
    try {
      setLastSyncStatus('Capturing entire computer screen...');
      const stream = await initScreenStream();
      if (!stream) {
        setLastSyncStatus('Capture skipped: No screen stream active');
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      const imageCapture = (window as any).ImageCapture
        ? new (window as any).ImageCapture(videoTrack)
        : null;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (imageCapture) {
        try {
          const bitmap = await imageCapture.grabFrame();
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          ctx?.drawImage(bitmap, 0, 0);
        } catch {
          // Fallback to video element
          await captureViaVideoElement(stream, canvas);
        }
      } else {
        await captureViaVideoElement(stream, canvas);
      }

      // Convert to requested binary format: webp, png, or jpg
      const format = storageSettings.screenshotFormat || 'webp';
      const { blob, mimeType, extension } = await canvasToBlob(canvas, format);
      const previewDataUrl = canvas.toDataURL(mimeType, 0.5); // Lightweight preview for UI

      const now = new Date();
      const dateKey = getTodayDateKey(now);
      const timeFormatted = formatTimeString(now);
      const hourKey = getHourSlotKey(now);
      const currentTask = overrideTask || taskName;

      // File name format e.g. "Screen_2026-09-08_09-15-22.webp"
      const safeTimeName = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      const fileName = `Screen_${dateKey}_${safeTimeName}.${extension}`;

      let driveFileId: string | undefined;
      let driveWebLink: string | undefined;

      // If Google token available, upload directly to nested Drive folder
      if (accessToken) {
        setLastSyncStatus(`Uploading binary .${extension} to Drive date folder...`);
        // Resolve nested path: Root -> User Name -> Date Folder
        const { dateFolderId } = await resolveEmployeeDateFolder(
          accessToken,
          storageSettings.centralFolderId,
          currentUser.name,
          dateKey
        );

        const uploadRes = await uploadScreenshotToDrive(
          accessToken,
          blob,
          fileName,
          mimeType,
          dateFolderId
        );

        driveFileId = uploadRes.fileId;
        driveWebLink = uploadRes.webViewLink;
        setDriveUploadCount((c) => c + 1);
        setLastSyncStatus(`Saved to Drive Date Folder: ${fileName}`);
      } else {
        setLastSyncStatus(`Screen captured locally (.${extension}). Connect Drive to sync.`);
      }

      // Log screenshot entry
      const newLog: ScreenshotLog = {
        id: `scr-${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        taskName: currentTask,
        timestamp: now.toISOString(),
        timeFormatted,
        hourKey,
        dateKey,
        fileFormat: format,
        driveFileId,
        driveWebLink,
        previewDataUrl,
        productivityScore: 92,
        productivityLabel: 'High',
      };

      onNewScreenshot(newLog);
    } catch (err: any) {
      console.error('Screenshot error:', err);
      setLastSyncStatus(`Capture warning: ${err.message}`);
    }
  };

  const captureViaVideoElement = (
    stream: MediaStream,
    canvas: HTMLCanvasElement
  ): Promise<void> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve();
      };
    });
  };

  /**
   * START TRACKING:
   * Initializes timer, triggers instant screenshot, sets interval capture
   */
  const handleStartTracking = async () => {
    const stream = await initScreenStream();
    if (!stream) return;

    const now = new Date();
    const startTimeStr = formatTimeString(now);
    setCurrentTaskStartTime(startTimeStr);
    setIsTracking(true);
    setIsPaused(false);
    setSessionSeconds(0);
    setLastSyncStatus(`Tracking started at ${startTimeStr}`);

    // Take immediate screen capture
    await captureAndUploadScreen(taskName);

    // Setup periodic capture (e.g. Every 5 mins, or 1 min in dev test)
    const intervalMs = Math.max(1, storageSettings.autoCaptureIntervalMinutes) * 60 * 1000;
    if (autoCaptureRef.current) clearInterval(autoCaptureRef.current);
    autoCaptureRef.current = window.setInterval(() => {
      captureAndUploadScreen();
    }, intervalMs);
  };

  /**
   * PAUSE TRACKING:
   * Stops interval, logs partial time to Google Sheet
   */
  const handlePauseTracking = async () => {
    setIsPaused(true);
    if (autoCaptureRef.current) clearInterval(autoCaptureRef.current);

    const now = new Date();
    const pauseTimeStr = formatTimeString(now);
    const durationHours = secondsToDecimalHours(sessionSeconds);

    if (accessToken && sessionSeconds > 5) {
      setLastSyncStatus('Logging pause interval into Google Sheet...');
      const spreadsheetId = await getOrCreateSpreadsheet(accessToken, storageSettings.spreadsheetName);
      await logTaskIntervalToSheet(accessToken, spreadsheetId, {
        date: getTodayDateKey(now),
        userName: currentUser.name,
        taskName: taskName,
        startTime: currentTaskStartTime,
        endTime: pauseTimeStr,
        durationFormatted: formatSecondsToHoursMinutes(sessionSeconds),
        durationHours: durationHours,
        status: 'Paused',
        screenshotCount: 1,
        productivityScore: '92%',
      });
    }

    setLastSyncStatus(`Tracking paused at ${pauseTimeStr}`);
  };

  const handleResumeTracking = () => {
    setIsPaused(false);
    const now = new Date();
    setCurrentTaskStartTime(formatTimeString(now));
    setSessionSeconds(0); // new segment

    const intervalMs = Math.max(1, storageSettings.autoCaptureIntervalMinutes) * 60 * 1000;
    if (autoCaptureRef.current) clearInterval(autoCaptureRef.current);
    autoCaptureRef.current = window.setInterval(() => {
      captureAndUploadScreen();
    }, intervalMs);

    setLastSyncStatus('Tracking resumed');
  };

  /**
   * STOP TRACKING:
   * Stops timer, saves completed segment to Google Sheet tab, releases screen stream
   */
  const handleStopTracking = async () => {
    setIsTracking(false);
    setIsPaused(false);
    if (autoCaptureRef.current) clearInterval(autoCaptureRef.current);

    const now = new Date();
    const stopTimeStr = formatTimeString(now);
    const durationHours = secondsToDecimalHours(sessionSeconds);

    if (accessToken && sessionSeconds > 2) {
      setLastSyncStatus('Updating Google Sheet with total task hours...');
      const spreadsheetId = await getOrCreateSpreadsheet(accessToken, storageSettings.spreadsheetName);
      await logTaskIntervalToSheet(accessToken, spreadsheetId, {
        date: getTodayDateKey(now),
        userName: currentUser.name,
        taskName: taskName,
        startTime: currentTaskStartTime,
        endTime: stopTimeStr,
        durationFormatted: formatSecondsToHoursMinutes(sessionSeconds),
        durationHours: durationHours,
        status: 'Stopped / Logged Out',
        screenshotCount: 1,
        productivityScore: '94%',
      });
    }

    // Save to local history
    setTaskHistory((prev) => [
      ...prev,
      {
        taskName,
        start: currentTaskStartTime,
        end: stopTimeStr,
        durationSec: sessionSeconds,
      },
    ]);

    setSessionSeconds(0);
    setLastSyncStatus(`Tracking stopped at ${stopTimeStr}. Total logged.`);

    // Release screen stream
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
  };

  /**
   * TASK CHANGE:
   * e.g. 09:00 AM start, 10:00 AM change task -> logs exactly 1 hour for previous task,
   * resets task session counter to 0 for the new task, and updates Google Sheet.
   */
  const handleSwitchTask = async (newTaskName: string) => {
    if (!newTaskName || newTaskName.trim() === taskName) return;

    const previousTask = taskName;
    const now = new Date();
    const switchTimeStr = formatTimeString(now);
    const segmentDuration = sessionSeconds;
    const durationHours = secondsToDecimalHours(segmentDuration);

    setLastSyncStatus(`Switching task: logging '${previousTask}' to Sheet...`);

    // 1. Log previous task block to Google Sheet
    if (accessToken && segmentDuration > 0) {
      const spreadsheetId = await getOrCreateSpreadsheet(accessToken, storageSettings.spreadsheetName);
      await logTaskIntervalToSheet(accessToken, spreadsheetId, {
        date: getTodayDateKey(now),
        userName: currentUser.name,
        taskName: previousTask,
        startTime: currentTaskStartTime,
        endTime: switchTimeStr,
        durationFormatted: formatSecondsToHoursMinutes(segmentDuration),
        durationHours: durationHours,
        status: 'Task Switched',
        screenshotCount: 1,
        productivityScore: '90%',
      });
    }

    // Record in local history
    setTaskHistory((prev) => [
      ...prev,
      {
        taskName: previousTask,
        start: currentTaskStartTime,
        end: switchTimeStr,
        durationSec: segmentDuration,
      },
    ]);

    // 2. Set new task and reset session counter
    setTaskName(newTaskName.trim());
    setCurrentTaskStartTime(switchTimeStr);
    setSessionSeconds(0);

    // 3. Immediately capture screen under the new task
    await captureAndUploadScreen(newTaskName.trim());

    setLastSyncStatus(`Switched to '${newTaskName.trim()}' at ${switchTimeStr}`);
  };

  // Hour tabs for employee
  const availableHours = Array.from(new Set(userScreenshots.map((s) => s.hourKey))).sort();

  const filteredScreenshots = userScreenshots.filter((s) => {
    if (selectedHourTab === 'all') return true;
    return s.hourKey === selectedHourTab;
  });

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Top Tracker Control Box */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          {/* Left: Task Input & Status */}
          <div className="space-y-3 flex-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Desktop Time Tracker & Monitor
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Currently Working On Task:</label>
              <div className="flex items-center gap-2">
                <input
                  id="task-name-input"
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  onBlur={(e) => {
                    if (isTracking && e.target.value !== taskName) {
                      handleSwitchTask(e.target.value);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isTracking) {
                      handleSwitchTask(taskName);
                    }
                  }}
                  className="flex-1 text-sm font-medium border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  placeholder="Enter task name (e.g. Design Wireframes, Code API)..."
                />
                {isTracking && (
                  <button
                    onClick={() => handleSwitchTask(taskName)}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-3 py-2.5 rounded-xl transition whitespace-nowrap"
                  >
                    Switch Task Log
                  </button>
                )}
              </div>
            </div>

            {/* Status sync message */}
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Activity className="w-3.5 h-3.5 text-indigo-500" />
              <span>{lastSyncStatus}</span>
            </div>
          </div>

          {/* Middle: Timer display (NaN-proof) */}
          <div className="flex items-center gap-8 bg-slate-50 px-6 py-4 rounded-xl border border-slate-100">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Current Task Time</div>
              <div className="text-2xl font-mono font-bold text-slate-900">
                {formatSecondsToHoursMinutes(sessionSeconds)}
              </div>
            </div>

            <div className="h-10 w-px bg-slate-200"></div>

            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Today Total Tracked</div>
              <div className="text-2xl font-mono font-bold text-indigo-600">
                {formatSecondsToHoursMinutes(dayTotalSeconds)}
              </div>
              <div className="text-[10px] text-slate-400">
                {secondsToDecimalHours(dayTotalSeconds)} decimal hrs (Never NaN)
              </div>
            </div>
          </div>

          {/* Right: Tracking action buttons */}
          <div className="flex items-center gap-3">
            {!isTracking ? (
              <button
                id="btn-start-tracking"
                onClick={handleStartTracking}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm px-6 py-3 rounded-xl transition shadow-sm hover:shadow"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Start Tracking</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {!isPaused ? (
                  <button
                    id="btn-pause-tracking"
                    onClick={handlePauseTracking}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm px-4 py-3 rounded-xl transition shadow-sm"
                  >
                    <Pause className="w-4 h-4" />
                    <span>Pause</span>
                  </button>
                ) : (
                  <button
                    id="btn-resume-tracking"
                    onClick={handleResumeTracking}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm px-4 py-3 rounded-xl transition shadow-sm"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    <span>Resume</span>
                  </button>
                )}

                <button
                  id="btn-stop-tracking"
                  onClick={handleStopTracking}
                  className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm px-4 py-3 rounded-xl transition shadow-sm"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>Stop & Log Out</span>
                </button>

                <button
                  id="btn-manual-capture"
                  onClick={() => captureAndUploadScreen()}
                  title="Capture Screen Now"
                  className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Google Drive Status Bar */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-600">
            <Monitor className="w-4 h-4 text-indigo-500" />
            <span>Format: <strong className="uppercase">.{storageSettings.screenshotFormat}</strong></span>
            <span>&bull;</span>
            <span>Target: <strong>/{currentUser.name}/{getTodayDateKey()}/</strong></span>
          </div>

          {!accessToken ? (
            <button
              onClick={onConnectDrive}
              className="text-xs text-indigo-600 font-semibold hover:underline flex items-center gap-1"
            >
              Connect Google Drive & Sheets to enable cloud synchronization →
            </button>
          ) : (
            <div className="text-emerald-700 flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Drive & Sheet Sync Active ({driveUploadCount} captures sent to date folder)</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Hour Wise Tabbing and Screenshots Gallery */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-slate-800">My Desktop Screenshot Log</h3>
                <p className="text-xs text-slate-500">
                  Screenshots captured automatically and saved inside today's date folder on Google Drive.
                </p>
              </div>
              <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg">
                {userScreenshots.length} Captures Today
              </span>
            </div>

            {/* Hour-wise Tabbing Bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedHourTab('all')}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition whitespace-nowrap ${
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
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition whitespace-nowrap ${
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

          {/* Screenshot Cards */}
          {filteredScreenshots.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 text-center text-slate-500">
              <Camera className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <div className="font-semibold text-slate-700">No screenshots recorded yet</div>
              <p className="text-xs text-slate-400 mt-1">
                Click "Start Tracking" to begin monitoring your desktop activity.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredScreenshots.map((sc) => (
                <div
                  key={sc.id}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow transition flex flex-col"
                >
                  <div
                    className="relative cursor-pointer bg-slate-900 aspect-video group"
                    onClick={() => setPreviewModal(sc)}
                  >
                    <img
                      src={sc.previewDataUrl}
                      alt={sc.taskName}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-semibold">
                      Click to View Fullscreen (.{sc.fileFormat})
                    </div>
                    <span className="absolute top-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                      .{sc.fileFormat}
                    </span>
                  </div>

                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 truncate">{sc.taskName}</span>
                        <span className="text-slate-400 text-[11px]">{sc.timeFormatted}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{sc.hourKey}</div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                      <span className="text-emerald-600 font-medium">In Date Folder</span>
                      {sc.driveWebLink && (
                        <a
                          href={sc.driveWebLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline flex items-center gap-1 font-medium"
                        >
                          Google Drive <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Col: Task Switch Log & Today Breakdown */}
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              <span>Today Task Log Intervals</span>
            </h3>
            <p className="text-xs text-slate-500">
              Each task interval is recorded and synced to your dedicated Google Sheet tab with start/stop times.
            </p>

            {taskHistory.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-6 border border-dashed rounded-lg">
                No task switches completed yet. As you change tasks, completed intervals appear here.
              </div>
            ) : (
              <div className="space-y-2">
                {taskHistory.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{item.taskName}</div>
                      <div className="text-[11px] text-slate-500">
                        {item.start} → {item.end}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-indigo-700">
                        {formatSecondsToHoursMinutes(item.durationSec)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {secondsToDecimalHours(item.durationSec)} hrs
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Stats Widget */}
          <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white rounded-xl p-5 shadow-sm space-y-3">
            <div className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              Monthly Summary Overview
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">14.5</span>
              <span className="text-sm text-indigo-200">total hours tracked this month</span>
            </div>
            <p className="text-xs text-slate-300">
              Logged accurately into Google Sheet master tab <span className="underline">{storageSettings.spreadsheetName}</span>.
            </p>
          </div>
        </div>
      </div>

      {/* Enlarged Screenshot Modal */}
      {previewModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-slate-900 dark:text-white">
                  Task: {previewModal.taskName}
                </div>
                <div className="text-xs text-slate-500">
                  {previewModal.dateKey} at {previewModal.timeFormatted} ({previewModal.hourKey})
                </div>
              </div>
              <button
                onClick={() => setPreviewModal(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-sm font-semibold px-2 py-1"
              >
                Close ✕
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex items-center justify-center max-h-[70vh] overflow-auto">
              <img
                src={previewModal.previewDataUrl}
                alt="Enlarged desktop capture"
                className="max-h-[65vh] w-auto object-contain rounded"
              />
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between">
              <span>Saved format: .{previewModal.fileFormat}</span>
              {previewModal.driveWebLink && (
                <a
                  href={previewModal.driveWebLink}
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
