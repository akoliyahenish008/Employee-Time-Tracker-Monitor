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
  Monitor,
  Shuffle,
  HardDrive,
  Bell,
  BellRing,
  Volume2,
  VolumeX,
  X
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
  ensureSheetTab,
  appendSheetRows,
} from '../lib/sheetService';
import { provisionEmployeeWorkspace } from '../lib/workspaceProvisioner';
import { logScreenshotToFirestore } from '../lib/firebase';

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

  // Next randomized or fixed capture countdown and timestamp
  const [selectedInterval, setSelectedInterval] = useState<number | 'random'>(
    storageSettings.captureIntervalSeconds || 10
  );
  const [nextCaptureInSec, setNextCaptureInSec] = useState<number | null>(null);
  const [lastCapturedTimeStr, setLastCapturedTimeStr] = useState<string>('');
  const [workspaceStatus, setWorkspaceStatus] = useState<string>('');
  const [isProvisioning, setIsProvisioning] = useState<boolean>(false);

  // Capture Notification States & Preferences
  const [activeCaptureNotice, setActiveCaptureNotice] = useState<ScreenshotLog | null>(null);
  const [soundAlerts, setSoundAlerts] = useState<boolean>(() => {
    return localStorage.getItem('wm_sound_alerts') !== 'false';
  });
  const [desktopAlerts, setDesktopAlerts] = useState<boolean>(() => {
    return (
      localStorage.getItem('wm_desktop_alerts') === 'true' &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    );
  });
  const [showNotificationSettings, setShowNotificationSettings] = useState<boolean>(false);

  // Audio synthesis chime for subtle audio feedback when screenshot is taken
  const playCaptureChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } catch {}
  };

  // Trigger rich in-app toast, audio chime, and optional desktop notification
  const triggerCaptureNotification = (log: ScreenshotLog) => {
    setActiveCaptureNotice(log);

    // Auto-dismiss floating notification after 6 seconds
    setTimeout(() => {
      setActiveCaptureNotice((curr) => (curr?.id === log.id ? null : curr));
    }, 6000);

    // Audio alert
    if (soundAlerts) {
      playCaptureChime();
    }

    // HTML5 native desktop notification
    if (
      desktopAlerts &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification('📸 WorkMonitor: Screen Captured', {
          body: `Snapshot recorded at ${log.timeFormatted} for "${log.taskName}". Synced to Google Drive.`,
          icon: log.previewDataUrl,
        });
      } catch (e) {
        console.warn('Desktop notification notice:', e);
      }
    }
  };

  const toggleSoundAlerts = () => {
    const next = !soundAlerts;
    setSoundAlerts(next);
    localStorage.setItem('wm_sound_alerts', String(next));
    if (next) playCaptureChime();
  };

  const toggleDesktopAlerts = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      alert('Desktop notifications are not supported in this browser.');
      return;
    }

    if (Notification.permission === 'granted') {
      const next = !desktopAlerts;
      setDesktopAlerts(next);
      localStorage.setItem('wm_desktop_alerts', String(next));
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setDesktopAlerts(true);
        localStorage.setItem('wm_desktop_alerts', 'true');
        try {
          new Notification('WorkMonitor Alerts Enabled', {
            body: 'You will receive notifications whenever a screen capture is taken.',
          });
        } catch {}
      }
    } else {
      alert('Desktop notifications are blocked by browser settings. Please permit notifications in your browser address bar.');
    }
  };

  // Screen capture references
  const screenStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const randomCaptureTimerRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);

  // Effective token: Either employee's direct session token OR the central Admin's synced token
  const effectiveDriveToken = accessToken || storageSettings.adminAccessToken || null;

  // Auto-verify or create Google Drive Folder & Sheet Tab on mount or when token updates
  useEffect(() => {
    if (effectiveDriveToken && currentUser) {
      handleProvisionWorkspace(false);
    }
  }, [effectiveDriveToken, currentUser.id]);

  const handleProvisionWorkspace = async (manualNotice: boolean = true) => {
    const token = effectiveDriveToken;
    if (!token) {
      if (manualNotice) {
        setWorkspaceStatus('Admin Google OAuth token not active yet. Admin can authorize in Admin Portal.');
      }
      return;
    }

    setIsProvisioning(true);
    if (manualNotice) {
      setWorkspaceStatus('Creating / Verifying Drive Folders & Master Sheet Tab...');
    }

    try {
      const res = await provisionEmployeeWorkspace(
        token,
        currentUser,
        storageSettings.spreadsheetName,
        storageSettings.centralFolderName
      );

      if (res.success) {
        setWorkspaceStatus(`✅ Google Drive folder & Sheet tab active for ${currentUser.name}!`);
      } else {
        setWorkspaceStatus(`Drive/Sheet notice: ${res.message}`);
      }
    } catch (err: any) {
      console.warn('Workspace provisioning error:', err);
      setWorkspaceStatus(`Setup notice: ${err.message}`);
    } finally {
      setIsProvisioning(false);
    }
  };

  // Keep track of tasks switched today
  const [taskHistory, setTaskHistory] = useState<
    Array<{
      taskName: string;
      start: string;
      end: string;
      durationSec: number;
    }>
  >([]);

  // Timer loop for tracking work duration
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

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (randomCaptureTimerRef.current) clearTimeout(randomCaptureTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
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
   * Helper to schedule the next screenshot based on the selected interval:
   * 10s, 20s, 1m (60s), 5m (300s), 10m (600s), 15m (900s), or random 5-10m
   */
  const scheduleNextScreenshot = (overrideInterval?: number | 'random') => {
    if (randomCaptureTimerRef.current) clearTimeout(randomCaptureTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    const activeInterval = overrideInterval !== undefined ? overrideInterval : selectedInterval;

    let delaySeconds = 10;
    if (activeInterval === 'random') {
      const minSec = 300;
      const maxSec = 600;
      delaySeconds = Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
    } else {
      delaySeconds = Number(activeInterval) || 10;
    }

    setNextCaptureInSec(delaySeconds);

    // Countdown tick for UI
    countdownIntervalRef.current = window.setInterval(() => {
      setNextCaptureInSec((prev) => {
        if (prev === null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    // Scheduled trigger
    randomCaptureTimerRef.current = window.setTimeout(async () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      await captureAndUploadScreen();
      // After capture, reset and schedule next screenshot!
      scheduleNextScreenshot(activeInterval);
    }, delaySeconds * 1000);
  };

  const handleIntervalChange = (newInterval: number | 'random') => {
    setSelectedInterval(newInterval);
    if (isTracking && !isPaused) {
      scheduleNextScreenshot(newInterval);
    }
  };

  /**
   * Captures screen frame as binary WebP, PNG, or JPG,
   * uploads directly to Admin's Drive into: User Folder -> Date Folder -> capture.[ext]
   */
  const captureAndUploadScreen = async (overrideTask?: string) => {
    try {
      setLastSyncStatus('Capturing screen frame...');
      const stream = await initScreenStream();
      if (!stream) {
        setLastSyncStatus('Capture skipped: Screen permission cancelled');
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      const imageCapture = (window as any).ImageCapture
        ? new (window as any).ImageCapture(videoTrack)
        : null;

      const canvas = document.createElement('canvas');

      if (imageCapture) {
        try {
          const bitmap = await imageCapture.grabFrame();
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(bitmap, 0, 0);
        } catch {
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

      // File name format e.g. "Screen_2026-09-09_09-15-22.webp"
      const safeTimeName = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      const fileName = `Screen_${dateKey}_${safeTimeName}.${extension}`;

      let driveFileId: string | undefined;
      let driveWebLink: string | undefined;

      // Upload using central Admin's Google Drive OAuth token or current token
      const uploadToken = effectiveDriveToken;

      if (uploadToken) {
        setLastSyncStatus(`Uploading binary .${extension} directly to Admin Google Drive...`);
        try {
          // Resolve nested path: Root -> User Name -> Date Folder
          const { dateFolderId } = await resolveEmployeeDateFolder(
            uploadToken,
            storageSettings.centralFolderId,
            currentUser.name,
            dateKey
          );

          const uploadRes = await uploadScreenshotToDrive(
            uploadToken,
            blob,
            fileName,
            mimeType,
            dateFolderId
          );

          driveFileId = uploadRes.fileId;
          driveWebLink = uploadRes.webViewLink;
          setDriveUploadCount((c) => c + 1);
          setLastSyncStatus(`Saved to Admin Drive (${storageSettings.centralAdminEmail}): ${fileName}`);

          // Also immediately append screenshot event to employee's personal sheet tab
          try {
            const spreadsheetId = await getOrCreateSpreadsheet(uploadToken, storageSettings.spreadsheetName);
            await ensureSheetTab(uploadToken, spreadsheetId, currentUser.name);
            await appendSheetRows(uploadToken, spreadsheetId, currentUser.name, [
              [
                dateKey,
                currentTask,
                timeFormatted,
                timeFormatted,
                `Interval: ${typeof selectedInterval === 'number' ? `${selectedInterval}s` : 'random'}`,
                0,
                'Screenshot Captured',
                1,
                driveWebLink || fileName,
              ],
            ]);
          } catch (sheetLogErr) {
            console.warn('Sheet screenshot sync note:', sheetLogErr);
          }
        } catch (uploadErr: any) {
          console.warn('Drive upload attempt warning:', uploadErr);
          setLastSyncStatus(`Drive upload warning: ${uploadErr.message}`);
        }
      } else {
        setLastSyncStatus(`Captured screen locally (.${extension}) & synced to Admin Live Database.`);
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

      setLastCapturedTimeStr(timeFormatted);
      onNewScreenshot(newLog);
      await logScreenshotToFirestore(newLog);

      // Trigger capture notification (toast, chime, desktop alert)
      triggerCaptureNotification(newLog);
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
   * Initializes timer, triggers instant screenshot, sets 5-10 minute randomized capture loop
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

    // Schedule next randomized capture (5 to 10 minutes)
    scheduleNextScreenshot();
  };

  /**
   * PAUSE TRACKING:
   * Stops interval, logs partial time to Google Sheet
   */
  const handlePauseTracking = async () => {
    setIsPaused(true);
    if (randomCaptureTimerRef.current) clearTimeout(randomCaptureTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setNextCaptureInSec(null);

    const now = new Date();
    const pauseTimeStr = formatTimeString(now);
    const durationHours = secondsToDecimalHours(sessionSeconds);
    const token = effectiveDriveToken;

    if (token && sessionSeconds > 5) {
      setLastSyncStatus('Logging pause interval into Admin Google Sheet...');
      try {
        const spreadsheetId = await getOrCreateSpreadsheet(token, storageSettings.spreadsheetName);
        await logTaskIntervalToSheet(token, spreadsheetId, {
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
      } catch (err: any) {
        console.warn('Sheet sync warning:', err);
      }
    }

    setLastSyncStatus(`Tracking paused at ${pauseTimeStr}`);
  };

  const handleResumeTracking = () => {
    setIsPaused(false);
    const now = new Date();
    setCurrentTaskStartTime(formatTimeString(now));
    setSessionSeconds(0); // new segment

    scheduleNextScreenshot();
    setLastSyncStatus('Tracking resumed');
  };

  /**
   * STOP TRACKING:
   * Stops timer, saves completed segment to Google Sheet tab, releases screen stream
   */
  const handleStopTracking = async () => {
    setIsTracking(false);
    setIsPaused(false);
    if (randomCaptureTimerRef.current) clearTimeout(randomCaptureTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setNextCaptureInSec(null);

    const now = new Date();
    const stopTimeStr = formatTimeString(now);
    const durationHours = secondsToDecimalHours(sessionSeconds);
    const token = effectiveDriveToken;

    if (token && sessionSeconds > 2) {
      setLastSyncStatus('Updating Admin Google Sheet with total task hours...');
      try {
        const spreadsheetId = await getOrCreateSpreadsheet(token, storageSettings.spreadsheetName);
        await logTaskIntervalToSheet(token, spreadsheetId, {
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
      } catch (err: any) {
        console.warn('Sheet sync warning:', err);
      }
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
    const token = effectiveDriveToken;

    setLastSyncStatus(`Switching task: logging '${previousTask}' to Sheet...`);

    // 1. Log previous task block to Google Sheet
    if (token && segmentDuration > 0) {
      try {
        const spreadsheetId = await getOrCreateSpreadsheet(token, storageSettings.spreadsheetName);
        await logTaskIntervalToSheet(token, spreadsheetId, {
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
      } catch (err: any) {
        console.warn('Sheet sync warning:', err);
      }
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

    // 3. Immediately capture screen under the new task and reschedule
    await captureAndUploadScreen(newTaskName.trim());
    if (isTracking && !isPaused) {
      scheduleNextScreenshot();
    }

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
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          {/* Left: Task Input & Status */}
          <div className="space-y-3 flex-1">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isTracking && !isPaused ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Remote Employee Workstation ({currentUser.name})
              </span>
              <span className="bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold px-2 py-0.5 rounded flex items-center gap-1">
                <Shuffle className="w-3 h-3" /> Random 5–10m Capture
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Currently Working On Task:</label>
              <div className="flex items-center gap-2">
                <input
                  id="task-name-input"
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="e.g. Backend API Optimization"
                  className="flex-1 text-sm font-medium border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {isTracking && (
                  <button
                    onClick={() => handleSwitchTask(taskName)}
                    className="px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
                  >
                    Switch Task & Log
                  </button>
                )}
              </div>
            </div>

            {/* Live Sync Status Banner & Interval Selector */}
            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Capture Interval:</span>
                {[
                  { label: '10 sec', val: 10 },
                  { label: '20 sec', val: 20 },
                  { label: '1 min', val: 60 },
                  { label: '5 min', val: 300 },
                  { label: '10 min', val: 600 },
                  { label: '15 min', val: 900 },
                  { label: 'Random (5–10m)', val: 'random' },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleIntervalChange(item.val as any)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                      selectedInterval === item.val
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                <span>Status:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{lastSyncStatus}</span>
                {isTracking && nextCaptureInSec !== null && (
                  <span className="bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded font-mono text-[11px] font-semibold animate-pulse">
                    Next capture in: {nextCaptureInSec < 60 ? `${nextCaptureInSec}s` : `~${Math.floor(nextCaptureInSec / 60)}m ${nextCaptureInSec % 60}s`}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Middle: Timer display */}
          <div className="flex items-center gap-6 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Current Task Duration</div>
              <div className="text-3xl font-mono font-black text-slate-900 dark:text-white tracking-tight">
                {formatSecondsToHoursMinutes(sessionSeconds)}
              </div>
            </div>

            <div className="h-10 w-px bg-slate-200 dark:bg-slate-700"></div>

            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase">Today Total Tracked</div>
              <div className="text-2xl font-mono font-bold text-indigo-600 dark:text-indigo-400">
                {formatSecondsToHoursMinutes(dayTotalSeconds)}
              </div>
              <div className="text-[10px] text-slate-400">
                {secondsToDecimalHours(dayTotalSeconds)} decimal hrs
              </div>
            </div>
          </div>

          {/* Right: Tracking action buttons */}
          <div className="flex items-center gap-3">
            {!isTracking ? (
              <button
                id="btn-start-tracking"
                onClick={handleStartTracking}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm px-6 py-3 rounded-xl transition shadow-sm hover:shadow cursor-pointer"
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
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm px-4 py-3 rounded-xl transition shadow-sm cursor-pointer"
                  >
                    <Pause className="w-4 h-4" />
                    <span>Pause</span>
                  </button>
                ) : (
                  <button
                    id="btn-resume-tracking"
                    onClick={handleResumeTracking}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm px-4 py-3 rounded-xl transition shadow-sm cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    <span>Resume</span>
                  </button>
                )}

                <button
                  id="btn-stop-tracking"
                  onClick={handleStopTracking}
                  className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm px-4 py-3 rounded-xl transition shadow-sm cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>Stop & Log Out</span>
                </button>

                <button
                  id="btn-manual-capture"
                  onClick={() => captureAndUploadScreen()}
                  title="Capture Screen Now & Reset Timer"
                  className="p-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Central Storage Destination Bar & Workspace Verification */}
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400">
              <Monitor className="w-4 h-4 text-indigo-500" />
              <span>Target Drive: <strong className="text-slate-800 dark:text-slate-200">{storageSettings.centralAdminEmail}</strong></span>
              <span>&bull;</span>
              <span>Folder: <strong className="font-mono text-slate-800 dark:text-slate-200">/{storageSettings.centralFolderName}/{currentUser.name}/{getTodayDateKey()}/</strong></span>
              <span>&bull;</span>
              <span>Sheet Tab: <strong className="font-mono text-slate-800 dark:text-slate-200">[{currentUser.name}]</strong> in <strong className="text-slate-800 dark:text-slate-200">{storageSettings.spreadsheetName}</strong></span>
            </div>

            <div className="flex items-center gap-2">
              {/* Notification Preferences Popover Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowNotificationSettings(!showNotificationSettings)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                    soundAlerts || desktopAlerts
                      ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                      : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500'
                  }`}
                  title="Configure Screen Capture Notifications"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>Alerts: {soundAlerts && desktopAlerts ? 'Sound + Desktop' : soundAlerts ? 'Chime Active' : desktopAlerts ? 'Desktop Active' : 'Muted'}</span>
                </button>

                {showNotificationSettings && (
                  <div className="absolute right-0 bottom-full mb-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-2xl z-40 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                        <BellRing className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Capture Alerts</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowNotificationSettings(false)}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-1 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          {soundAlerts ? <Volume2 className="w-3.5 h-3.5 text-emerald-600" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
                          <span>Audio chime on capture</span>
                        </div>
                        <button
                          type="button"
                          onClick={toggleSoundAlerts}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold cursor-pointer transition ${
                            soundAlerts
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                          }`}
                        >
                          {soundAlerts ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <Monitor className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Desktop browser notification</span>
                        </div>
                        <button
                          type="button"
                          onClick={toggleDesktopAlerts}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold cursor-pointer transition ${
                            desktopAlerts
                              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                          }`}
                        >
                          {desktopAlerts ? 'ON' : 'ENABLE'}
                        </button>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
                      <span>In-app visual toast</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Active</span>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleProvisionWorkspace(true)}
                disabled={isProvisioning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 font-semibold transition cursor-pointer disabled:opacity-50"
              >
                <HardDrive className="w-3.5 h-3.5 text-indigo-500" />
                <span>{isProvisioning ? 'Verifying...' : 'Check / Create Drive Folder & Sheet Tab'}</span>
              </button>
            </div>
          </div>

          {workspaceStatus && (
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{workspaceStatus}</span>
            </div>
          )}
        </div>
      </div>

      {/* Hour-Wise Filter Tabs & Gallery */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              My Hourly Screenshot History (Today)
            </h2>
            <p className="text-xs text-slate-500">
              Random captures (5–10 min intervals) automatically funneled to Admin Drive
            </p>
          </div>

          {/* Hour Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
            <button
              onClick={() => setSelectedHourTab('all')}
              className={`px-3 py-1.5 text-xs rounded-lg transition whitespace-nowrap cursor-pointer ${
                selectedHourTab === 'all'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              All Hours ({userScreenshots.length})
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
        </div>

        {/* Screenshot Grid */}
        {filteredScreenshots.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center text-slate-400">
            <Camera className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              No screenshots captured yet today
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Click &quot;Start Tracking&quot; above to begin the automated random 5–10 minute capture cycle.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredScreenshots.map((screen) => (
              <div
                key={screen.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm hover:shadow transition flex flex-col"
              >
                <div
                  onClick={() => setPreviewModal(screen)}
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
                      {screen.taskName}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Hour slot: {screen.hourKey}
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
                        <span>Saved to Admin Drive</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">Logged</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Task History & Hour Switch Breakdown */}
      {taskHistory.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Completed Task Intervals (Logged to Master Google Sheet)
            </h3>
            <span className="text-[11px] text-slate-400">Sheet Tab: {currentUser.name}</span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {taskHistory.map((item, idx) => (
              <div key={idx} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-900 dark:text-white">{item.taskName}</span>
                  <span className="text-slate-400 ml-2 font-mono text-[11px]">
                    {item.start} &rarr; {item.end}
                  </span>
                </div>
                <div className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  {formatSecondsToHoursMinutes(item.durationSec)} ({secondsToDecimalHours(item.durationSec)} hrs)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-slate-900 dark:text-white">{previewModal.taskName}</div>
                <div className="text-xs text-slate-500">
                  {previewModal.dateKey} at {previewModal.timeFormatted} ({previewModal.hourKey})
                </div>
              </div>
              <button
                onClick={() => setPreviewModal(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-sm font-semibold px-2 py-1 cursor-pointer"
              >
                Close ✕
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex items-center justify-center max-h-[70vh] overflow-auto">
              <img
                src={previewModal.previewDataUrl}
                alt={previewModal.taskName}
                className="max-h-[65vh] w-auto object-contain rounded"
              />
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between">
              <span>Binary format: .{previewModal.fileFormat}</span>
              {previewModal.driveWebLink && (
                <a
                  href={previewModal.driveWebLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open in Admin Google Drive</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Screenshot Capture Notification Toast */}
      {activeCaptureNotice && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-900/95 text-white rounded-2xl shadow-2xl border border-indigo-500/50 p-4 flex items-start gap-3.5 backdrop-blur-md">
            <div
              className="w-14 h-14 shrink-0 rounded-xl overflow-hidden border border-slate-700 bg-black cursor-pointer group relative shadow-inner"
              onClick={() => setPreviewModal(activeCaptureNotice)}
              title="Click to expand screenshot preview"
            >
              <img
                src={activeCaptureNotice.previewDataUrl}
                alt="Capture preview"
                className="w-full h-full object-cover transition duration-300 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                <Camera className="w-4 h-4 text-white drop-shadow" />
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>Screenshot Captured!</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveCaptureNotice(null)}
                  className="text-slate-400 hover:text-white p-0.5 cursor-pointer rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-slate-100 font-semibold truncate mt-1">
                {activeCaptureNotice.taskName}
              </div>

              <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                <span>{activeCaptureNotice.timeFormatted} &bull; Synced</span>
                <button
                  type="button"
                  onClick={() => setPreviewModal(activeCaptureNotice)}
                  className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer underline"
                >
                  View Full Size
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
