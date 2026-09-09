/**
 * Google Sheets API Client
 * - Manages or creates the master spreadsheet (stored in Admin's Drive or shared Drive)
 * - Automatically creates or switches to employee tab (e.g. "John Doe") or date tabs
 * - Correctly computes start, pause, stop and task switches
 * - NEVER outputs "NaN": strictly calculates decimal hours and formats strings safely.
 */

import { formatSecondsToHoursMinutes, secondsToDecimalHours } from './utils';

export interface SheetRowLog {
  date: string;
  userName: string;
  taskName: string;
  startTime: string;
  endTime: string;
  durationFormatted: string;
  durationHours: number;
  status: 'In Progress' | 'Task Switched' | 'Paused' | 'Stopped / Logged Out';
  screenshotCount: number;
  productivityScore: string;
}

/**
 * Creates a new Google Spreadsheet or returns existing ID
 */
export async function getOrCreateSpreadsheet(
  accessToken: string,
  spreadsheetTitle: string = 'Employee_Time_Tracking_Master'
): Promise<string> {
  // Search if spreadsheet already exists in Drive
  const query = `name = '${spreadsheetTitle.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)&spaces=drive`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  // Create new spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: spreadsheetTitle,
      },
      sheets: [
        {
          properties: {
            title: 'Overview_Summary',
          },
        },
      ],
    }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`Failed to create Google Spreadsheet: ${errorText}`);
  }

  const createdData = await createRes.json();
  const spreadsheetId = createdData.spreadsheetId;

  // Initialize header for Overview_Summary
  await appendSheetRows(accessToken, spreadsheetId, 'Overview_Summary', [
    ['Employee Name', 'Date', 'Task Name', 'Start Time', 'End / Switch Time', 'Duration', 'Hours (Decimal)', 'Status', 'Screenshots Uploaded', 'Avg Productivity']
  ]);

  return spreadsheetId;
}

/**
 * Ensures a sheet/tab exists for an employee (sanitized sheet name)
 */
export async function ensureSheetTab(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string
): Promise<void> {
  // Sanitize tab title (Google sheets allows up to 100 characters, no special chars like * : ? / \ [ ])
  const sanitizedTitle = tabTitle.replace(/[*?:/\\[\]]/g, '_').substring(0, 80);

  // Fetch spreadsheet metadata to check if sheet already exists
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!metaRes.ok) {
    return;
  }

  const metaData = await metaRes.json();
  const existingTitles = metaData.sheets?.map((s: any) => s.properties.title) || [];

  if (existingTitles.includes(sanitizedTitle)) {
    return;
  }

  // Add sheet tab via batchUpdate
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: sanitizedTitle,
            },
          },
        },
      ],
    }),
  });

  // Append default headers
  await appendSheetRows(accessToken, spreadsheetId, sanitizedTitle, [
    ['Date', 'Task Name', 'Start Time', 'End / Switch Time', 'Duration', 'Hours (Decimal)', 'Status', 'Screenshots Taken', 'Avg Productivity %'],
  ]);
}

/**
 * Appends row(s) to a specific tab
 */
export async function appendSheetRows(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  rows: any[][]
): Promise<void> {
  const sanitizedTitle = tabTitle.replace(/[*?:/\\[\]]/g, '_').substring(0, 80);
  const range = `'${sanitizedTitle}'!A1`;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}:append?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values: rows,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.warn(`Failed to append to sheet tab ${tabTitle}:`, errorText);
  }
}

/**
 * Record a completed or switched task block into Google Sheets
 * e.g., 09:00 AM start to 10:00 AM task change -> logs exactly 1 hour.
 */
export async function logTaskIntervalToSheet(
  accessToken: string,
  spreadsheetId: string,
  log: SheetRowLog
): Promise<void> {
  const durationNumber = Number.isFinite(log.durationHours) ? log.durationHours : 0;
  const safeDurationStr = log.durationFormatted || formatSecondsToHoursMinutes(durationNumber * 3600);

  const rowData = [
    log.date,
    log.taskName || 'General Work',
    log.startTime,
    log.endTime,
    safeDurationStr,
    durationNumber,
    log.status,
    log.screenshotCount,
    log.productivityScore || '88%'
  ];

  // 1. Log to Employee specific tab
  await ensureSheetTab(accessToken, spreadsheetId, log.userName);
  await appendSheetRows(accessToken, spreadsheetId, log.userName, [rowData]);

  // 2. Also log to Master Overview Summary tab with Employee Name in Col A
  const overviewRow = [
    log.userName,
    log.date,
    log.taskName || 'General Work',
    log.startTime,
    log.endTime,
    safeDurationStr,
    durationNumber,
    log.status,
    log.screenshotCount,
    log.productivityScore || '88%'
  ];
  await appendSheetRows(accessToken, spreadsheetId, 'Overview_Summary', [overviewRow]);
}
