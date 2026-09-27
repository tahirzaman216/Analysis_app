const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const initSqlJs = require('sql.js');
const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, 'delivery_database.db');
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set when NODE_ENV is production.');
}
const uploadFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});
app.use(express.json({ limit: '32kb' }));
if (isProduction) app.set('trust proxy', 1);
app.use(session({
  name: 'aura.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 8 * 60 * 60 * 1000 }
}));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'styles.css')));
app.get('/main.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'main.js')));

let database;
const userDatasetCache = new Map();

function queryAll(sql, params = []) {
  const statement = database.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || {};
}

function persistDatabase() {
  const temporaryPath = `${databasePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.writeFileSync(temporaryPath, Buffer.from(database.export()));
  fs.renameSync(temporaryPath, databasePath);
}

function getUserDataset(userId) {
  if (userDatasetCache.has(userId)) return userDatasetCache.get(userId);
  const stored = queryOne('SELECT metadata, records FROM user_datasets WHERE user_id = ?', [userId]);
  if (!stored.metadata) return null;
  const metadata = JSON.parse(stored.metadata);
  const rows = JSON.parse(stored.records);
  const dataset = { ...metadata, rows };
  userDatasetCache.set(userId, dataset);
  return dataset;
}

function getCurrentUser(req) {
  if (!req.session.userId) return null;
  return queryOne('SELECT user_id AS userId, email, display_name AS displayName FROM app_users WHERE user_id = ?', [req.session.userId]);
}

function requireAuthentication(req, res, next) {
  if (!req.session.userId || !getCurrentUser(req)?.userId) {
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Sign in to access this workspace.' });
    return res.redirect('/login');
  }
  next();
}

function parseDate(value, dateOrder = 'month-first') {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  if (value === null || value === undefined || String(value).trim() === '') return null;

  const text = String(value).trim();
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const createUtcDate = (year, month, day) => {
    const fullYear = year < 100 ? (year < 50 ? 2000 + year : 1900 + year) : year;
    const date = new Date(Date.UTC(fullYear, month - 1, day));
    return date.getUTCFullYear() === fullYear && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
  };

  let parts = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (parts) return createUtcDate(Number(parts[1]), Number(parts[2]), Number(parts[3]));

  parts = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (parts) return createUtcDate(Number(parts[1]), Number(parts[2]), Number(parts[3]));

  parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const year = Number(parts[3]);
    const dayFirst = first > 12 || (second <= 12 && dateOrder === 'day-first');
    return createUtcDate(year, dayFirst ? second : first, dayFirst ? first : second);
  }

  parts = /^(\d{1,2})[-\s]+([A-Za-z]{3,9})[-,\s]+(\d{2,4})$/.exec(text)
    || /^([A-Za-z]{3,9})[-\s]+(\d{1,2}),?[-\s]+(\d{2,4})$/.exec(text);
  if (parts) {
    const dayFirst = /^\d/.test(parts[1]);
    const day = Number(dayFirst ? parts[1] : parts[2]);
    const monthName = (dayFirst ? parts[2] : parts[1]).toLowerCase().slice(0, 3);
    const month = monthNames.indexOf(monthName) + 1;
    if (month) return createUtcDate(Number(parts[3]), month, day);
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateForDatabase(value, dateOrder) {
  const date = parseDate(value, dateOrder);
  return date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}

function numericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[,$€£¥%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!normalized || !/^[-+]?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueColumnNames(headers) {
  const seen = new Map();
  return headers.map((header, index) => {
    const base = String(header ?? '').trim() || `Column ${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function inferDateOrder(values) {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const value of values) {
    const parts = /^(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{2,4}$/.exec(String(value ?? '').trim());
    if (!parts) continue;
    if (Number(parts[1]) > 12) dayFirst += 1;
    else if (Number(parts[2]) > 12) monthFirst += 1;
  }
  return dayFirst > monthFirst ? 'day-first' : 'month-first';
}

function inferColumnKind(column, values) {
  const populated = values.filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
  if (!populated.length) return 'empty';
  const dateMatches = populated.filter((value) => parseDate(value)).length;
  const dateHint = /(date|time|timestamp)/i.test(column);
  const explicitDatePattern = /^(?:\d{8}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,9}[-,\s]+\d{2,4}|[A-Za-z]{3,9}[-\s]+\d{1,2},?[-\s]+\d{2,4})$/;
  const explicitDateMatches = populated.filter((value) => value instanceof Date || explicitDatePattern.test(String(value).trim())).length;
  if (dateHint && dateMatches / populated.length >= 0.35) return 'date';
  if (explicitDateMatches / populated.length >= 0.9 && dateMatches / populated.length >= 0.9) return 'date';
  const numericMatches = populated.filter((value) => numericValue(value) !== null).length;
  if (numericMatches / populated.length >= 0.8) return 'number';
  return 'category';
}

function prepareUploadedRows(rows, sourceHeaders = null) {
  const headers = sourceHeaders || Object.keys(rows[0] || {});
  const columns = uniqueColumnNames(headers);
  const normalizedRows = rows.map((sourceRow) => {
    const values = Array.isArray(sourceRow) ? sourceRow : headers.map((header) => sourceRow[header]);
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null]));
  }).filter((row) => Object.values(row).some((value) => value !== null && value !== undefined && String(value).trim() !== ''));

  if (!columns.length || !normalizedRows.length) {
    const error = new Error('The selected file must contain a header row and at least one non-empty data row.');
    error.status = 400;
    throw error;
  }
  if (normalizedRows.length > 250000) {
    const error = new Error('The file contains more than the 250,000-row limit.');
    error.status = 400;
    throw error;
  }

  const columnValues = Object.fromEntries(columns.map((column) => [column, normalizedRows.map((row) => row[column])]));
  const kinds = Object.fromEntries(columns.map((column) => [column, inferColumnKind(column, columnValues[column])]));
  const dateOrders = Object.fromEntries(columns.map((column) => [column, inferDateOrder(columnValues[column])]));
  const cleaned = normalizedRows.map((row) => Object.fromEntries(columns.map((column) => {
    const value = row[column];
    if (value === null || value === undefined || String(value).trim() === '') return [column, null];
    if (kinds[column] === 'number') return [column, numericValue(value)];
    if (kinds[column] === 'date') return [column, dateForDatabase(value, dateOrders[column])];
    return [column, String(value).trim()];
  })));

  const duplicateSet = new Set();
  const uniqueRows = cleaned.filter((row) => {
    const signature = JSON.stringify(row);
    if (duplicateSet.has(signature)) return false;
    duplicateSet.add(signature);
    return true;
  });

  const deliverySchedule = columns.find((column) => /scheduled.*(delivery|ship)|expected.*(delivery|ship)|due.*date/i.test(column));
  const deliveryActual = columns.find((column) => /(delivered|actual.*(delivery|ship)|delivery.*date)/i.test(column) && column !== deliverySchedule);
  if (deliverySchedule && deliveryActual) {
    for (const row of uniqueRows) {
      const scheduled = parseDate(row[deliverySchedule]);
      const actual = parseDate(row[deliveryActual]);
      const delay = scheduled && actual ? Math.round((actual - scheduled) / 86400000) : null;
      row.Delivery_Delay_Days = delay;
      row.Delivery_Status = delay === null ? 'Unknown' : delay > 0 ? 'Late' : delay < 0 ? 'Early' : 'On Time';
    }
  }

  const profile = buildDatasetProfile(columns, uniqueRows, kinds, {
    deliverySchedule: deliverySchedule || null,
    deliveryActual: deliveryActual || null
  });
  return { columns: profile.columns.map((item) => item.name), rows: uniqueRows, duplicateRows: normalizedRows.length - uniqueRows.length, profile };
}

function buildDatasetProfile(columns, rows, knownKinds = null, options = {}) {
  const fields = columns.map((column) => {
    const values = rows.map((row) => row[column]);
    const kind = knownKinds?.[column] || inferColumnKind(column, values);
    const populated = values.filter((value) => value !== null && value !== undefined && value !== '');
    const distinct = new Set(populated.map((value) => String(value))).size;
    return {
      name: column,
      kind,
      missing: values.length - populated.length,
      distinct,
      sample: [...new Set(populated.map((value) => String(value)))].slice(0, 4)
    };
  });
  const numericFields = fields.filter((field) => field.kind === 'number' && !/(^id$|\bid\b|code|zip|postal|phone|account|index|sequence)/i.test(field.name));
  const dateFields = fields.filter((field) => field.kind === 'date');
  const categoryFields = fields.filter((field) => field.kind === 'category' && field.distinct > 1 && field.distinct <= Math.max(100, Math.sqrt(rows.length) * 5));
  const valueField = numericFields.find((field) => /(revenue|sales|amount|value|price|cost|spend|total|profit|income)/i.test(field.name)) || numericFields[0] || null;
  const businessDateField = dateFields.find((field) => /(date|time|timestamp|created|order|transaction|sale)/i.test(field.name)) || dateFields[0] || null;
  const deliveryAvailable = Boolean(options.deliverySchedule && options.deliveryActual && rows.some((row) => row.Delivery_Status));

  return {
    rowCount: rows.length,
    columnCount: fields.length,
    columns: fields,
    numericFields,
    dateFields,
    categoryFields,
    valueField: valueField?.name || null,
    dateField: businessDateField?.name || null,
    deliveryAvailable,
    deliverySchedule: options.deliverySchedule || null,
    deliveryActual: options.deliveryActual || null
  };
}

function summarizeDataset(profile, rows, filename = 'Dataset') {
  const numericMetrics = profile.numericFields.map((field) => {
    const values = rows.map((row) => numericValue(row[field.name])).filter((value) => value !== null);
    const sum = values.reduce((total, value) => total + value, 0);
    return {
      name: field.name,
      count: values.length,
      sum,
      average: values.length ? sum / values.length : null,
      minimum: values.length ? Math.min(...values) : null,
      maximum: values.length ? Math.max(...values) : null
    };
  });
  const categories = profile.categoryFields.map((field) => {
    const counts = new Map();
    rows.forEach((row) => {
      if (row[field.name] === null || row[field.name] === undefined || row[field.name] === '') return;
      const value = String(row[field.name]);
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return {
      name: field.name,
      distinct: counts.size,
      top: [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([value, count]) => ({ value, count }))
    };
  });
  const missingCells = profile.columns.reduce((total, field) => total + field.missing, 0);
  const cellCount = profile.rowCount * profile.columnCount;
  let delivery = null;
  if (profile.deliveryAvailable) {
    const classified = rows.filter((row) => ['Late', 'Early', 'On Time'].includes(row.Delivery_Status));
    const late = classified.filter((row) => row.Delivery_Status === 'Late').length;
    const delays = classified.map((row) => row.Delivery_Delay_Days).filter(Number.isFinite);
    delivery = {
      lateRatePct: classified.length ? late / classified.length * 100 : 0,
      onTimeOrEarlyPct: classified.length ? (classified.length - late) / classified.length * 100 : 0,
      averageDelayDays: delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null
    };
  }
  return {
    filename,
    rowCount: profile.rowCount,
    columnCount: profile.columnCount,
    columns: profile.columns,
    missingCells,
    completenessPct: cellCount ? (cellCount - missingCells) / cellCount * 100 : 100,
    valueField: profile.valueField,
    dateField: profile.dateField,
    numericMetrics,
    categories,
    delivery
  };
}

function persistDataset(userId, columns, rows, profile, filename) {
  const metadata = {
    filename,
    columns,
    profile,
    importedAt: new Date().toISOString()
  };
  const existing = database.prepare('SELECT user_id FROM user_datasets WHERE user_id = ?');
  existing.bind([userId]);
  const hasDataset = existing.step();
  existing.free();
  const statement = database.prepare(hasDataset
    ? 'UPDATE user_datasets SET metadata = ?, records = ? WHERE user_id = ?'
    : 'INSERT INTO user_datasets (metadata, records, user_id) VALUES (?, ?, ?)');
  try {
    statement.run([JSON.stringify(metadata), JSON.stringify(rows), userId]);
  } finally {
    statement.free();
  }
  persistDatabase();
  userDatasetCache.set(userId, { ...metadata, rows });
}

function api(handler) {
  return (req, res) => {
    try {
      res.json(handler(req));
    } catch (error) {
      console.error('API request failed:', error);
      res.status(500).json({ error: 'Unable to read the active dataset.' });
    }
  };
}

function safeUser(user) {
  return { id: user.userId, email: user.email, displayName: user.displayName };
}

function displayNameFromEmail(email) {
  return email.split('@')[0].replace(/[._+-]+/g, ' ').trim().split(/\s+/)
    .filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') || 'User';
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

app.get('/api/auth/me', (req, res) => {
  const user = getCurrentUser(req);
  if (!user?.userId) return res.status(401).json({ error: 'Sign in required.' });
  res.json({ user: safeUser(user) });
});

app.post('/api/auth/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10) return res.status(400).json({ error: 'Password must contain at least 10 characters.' });
  if (queryAll('SELECT user_id FROM app_users WHERE email = ?', [email]).length) {
    return res.status(409).json({ error: 'An account already exists for this email. Sign in instead.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const displayName = displayNameFromEmail(email);
    const insertUser = database.prepare('INSERT INTO app_users (email, display_name, password_hash) VALUES (?, ?, ?)');
    try {
      insertUser.run([email, displayName, passwordHash]);
    } finally {
      insertUser.free();
    }
    const user = queryOne('SELECT user_id AS userId, email, display_name AS displayName FROM app_users WHERE email = ?', [email]);
    await regenerateSession(req);
    req.session.userId = user.userId;
    persistDatabase();
    req.session.save((error) => {
      if (error) return res.status(500).json({ error: 'Could not create a sign-in session.' });
      res.status(201).json({ user: safeUser(user) });
    });
  } catch (error) {
    console.error('Account registration failed:', error);
    res.status(500).json({ error: 'Could not create this account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const account = queryOne('SELECT user_id AS userId, email, display_name AS displayName, password_hash AS passwordHash FROM app_users WHERE email = ?', [email]);
  if (!account.userId || !(await bcrypt.compare(password, account.passwordHash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  try {
    await regenerateSession(req);
    req.session.userId = account.userId;
    req.session.save((error) => {
      if (error) return res.status(500).json({ error: 'Could not create a sign-in session.' });
      res.json({ user: safeUser(account) });
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not create a sign-in session.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'Could not sign out.' });
    res.clearCookie('aura.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.status(204).end();
  });
});

app.patch('/api/profile', requireAuthentication, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const displayName = String(req.body.displayName || '').trim().slice(0, 50);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!displayName) return res.status(400).json({ error: 'Display name is required.' });
  const duplicate = queryAll('SELECT user_id FROM app_users WHERE email = ? AND user_id <> ?', [email, req.session.userId]);
  if (duplicate.length) return res.status(409).json({ error: 'That email is already used by another account.' });
  const updateUser = database.prepare('UPDATE app_users SET email = ?, display_name = ? WHERE user_id = ?');
  try {
    updateUser.run([email, displayName, req.session.userId]);
  } finally {
    updateUser.free();
  }
  persistDatabase();
  res.json({ user: safeUser(getCurrentUser(req)) });
});

app.use('/api', requireAuthentication);

app.get('/api/summary', api((req) => {
  const dataset = getUserDataset(req.session.userId);
  if (!dataset) return { hasDataset: false, rowCount: 0, columnCount: 0, columns: [], numericMetrics: [], categories: [], filename: null };
  const summary = summarizeDataset(dataset.profile, dataset.rows, dataset.filename);
  const valueMetric = summary.numericMetrics.find((metric) => metric.name === summary.valueField);
  return {
    hasDataset: true,
    ...summary,
    totalShipments: summary.rowCount,
    lateRatePct: summary.delivery?.lateRatePct ?? null,
    onTimeRatePct: summary.delivery?.onTimeOrEarlyPct ?? null,
    averageDelayDays: summary.delivery?.averageDelayDays ?? null,
    totalItemValue: valueMetric?.sum ?? null,
    averageItemValue: valueMetric?.average ?? null
  };
}));

function getBreakdown(dataset, column) {
  if (!dataset?.profile.columns.some((field) => field.name === column)) return [];
  const groups = new Map();
  for (const row of dataset.rows) {
    const key = row[column] === null || row[column] === undefined || row[column] === '' ? '(blank)' : String(row[column]);
    const current = groups.get(key) || { value: key, count: 0, total: 0, valueCount: 0 };
    current.count += 1;
    if (dataset.profile.valueField) {
      const number = numericValue(row[dataset.profile.valueField]);
      if (number !== null) {
        current.total += number;
        current.valueCount += 1;
      }
    }
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) => right.count - left.count).slice(0, 25).map((group) => ({
    ...group,
    average: group.valueCount ? group.total / group.valueCount : null
  }));
}

function getDateTrend(dataset) {
  const dateField = dataset?.profile.dateField;
  if (!dateField) return [];
  const groups = new Map();
  for (const row of dataset.rows) {
    const date = parseDate(row[dateField]);
    if (!date) continue;
    const period = date.toISOString().slice(0, 7);
    const group = groups.get(period) || { period, records: 0, total: 0, valueCount: 0 };
    group.records += 1;
    if (dataset.profile.valueField) {
      const value = numericValue(row[dataset.profile.valueField]);
      if (value !== null) {
        group.total += value;
        group.valueCount += 1;
      }
    }
    groups.set(period, group);
  }
  return [...groups.values()].sort((left, right) => left.period.localeCompare(right.period)).map((group) => ({
    ...group,
    average: group.valueCount ? group.total / group.valueCount : null
  }));
}

app.get('/api/columns', api((req) => getUserDataset(req.session.userId)?.profile.columns || []));
app.get('/api/records', api((req) => {
  const dataset = getUserDataset(req.session.userId);
  return {
    columns: dataset?.profile.columns.map((field) => field.name) || [],
    rows: dataset?.rows.slice(0, Math.min(Number(req.query.limit) || 25, 100)) || []
  };
}));
app.get('/api/breakdown', api((req) => ({
  column: req.query.column || '',
  rows: getBreakdown(getUserDataset(req.session.userId), String(req.query.column || ''))
})));
app.get('/api/monthly', api((req) => getDateTrend(getUserDataset(req.session.userId))));
app.get('/api/countries', api((req) => { const dataset = getUserDataset(req.session.userId); return getBreakdown(dataset, dataset?.profile.categoryFields.find((field) => /country|region|state|city|location|market/i.test(field.name))?.name || dataset?.profile.categoryFields[0]?.name || ''); }));
app.get('/api/vendors', api((req) => { const dataset = getUserDataset(req.session.userId); return getBreakdown(dataset, dataset?.profile.categoryFields.find((field) => /vendor|supplier|company|customer|client/i.test(field.name))?.name || dataset?.profile.categoryFields[1]?.name || dataset?.profile.categoryFields[0]?.name || ''); }));
app.get('/api/products', api((req) => { const dataset = getUserDataset(req.session.userId); return getBreakdown(dataset, dataset?.profile.categoryFields.find((field) => /product|item|category|service/i.test(field.name))?.name || dataset?.profile.categoryFields[0]?.name || ''); }));
app.get('/api/sample', api((req) => getUserDataset(req.session.userId)?.rows.slice(0, 25) || []));

app.post('/api/upload', (req, res, next) => {
  uploadFile.single('file')(req, res, (error) => {
    if (error) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Maximum upload size is 50 MB.' : error.message });
      return;
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a CSV or Excel file first.' });
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (!['.csv', '.xlsx'].includes(extension)) {
      return res.status(400).json({ error: 'Use a CSV file or an Excel workbook saved as XLSX.' });
    }

    let sourceRows;
    let sourceHeaders;
    if (extension === '.csv') {
      const csvRows = parseCsv(req.file.buffer, {
        columns: false,
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false
      });
      sourceHeaders = csvRows.shift();
      sourceRows = csvRows;
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const firstSheet = workbook.worksheets[0];
      if (!firstSheet || firstSheet.rowCount < 2) return res.status(400).json({ error: 'The workbook has no readable data rows.' });
      sourceHeaders = firstSheet.getRow(1).values.slice(1).map((header) => String(header ?? '').trim());
      sourceRows = [];
      firstSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        sourceRows.push(row.values.slice(1));
      });
    }
    const prepared = prepareUploadedRows(sourceRows, sourceHeaders);
    persistDataset(req.session.userId, prepared.columns, prepared.rows, prepared.profile, req.file.originalname);
    const summary = summarizeDataset(prepared.profile, prepared.rows, req.file.originalname);
    res.json({
      filename: req.file.originalname,
      importedRows: prepared.rows.length,
      duplicateRowsRemoved: prepared.duplicateRows,
      profile: prepared.profile,
      summary
    });
  } catch (error) {
    console.error('Dataset upload failed:', error);
    res.status(error.status || 400).json({ error: error.status ? error.message : 'Could not process this file. Confirm it is a valid CSV or Excel workbook.' });
  }
});

app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/dashboard' : '/login');
});

app.get('/login', (req, res) => {
  if (req.session.userId && getCurrentUser(req)?.userId) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', requireAuthentication, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/upload', requireAuthentication, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/sales-analytics', requireAuthentication, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sales-analytics.html'));
});

app.get('/product-analytics', requireAuthentication, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'product-analytics.html'));
});

app.get('/customer-analytics', requireAuthentication, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer-analytics.html'));
});

app.get('/forecasting', requireAuthentication, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forecasting.html'));
});

app.get('/reports', requireAuthentication, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

initSqlJs().then((SQL) => {
  database = fs.existsSync(databasePath)
    ? new SQL.Database(fs.readFileSync(databasePath))
    : new SQL.Database();
  database.run(`CREATE TABLE IF NOT EXISTS app_users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS user_datasets (
    user_id INTEGER PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
    metadata TEXT NOT NULL,
    records TEXT NOT NULL
  )`);
  persistDatabase();
  app.listen(port, () => {
    console.log(`FYP analytics app running at http://localhost:${port}`);
  });
}).catch((error) => {
  console.error('Unable to start the analytics app:', error.message);
  process.exitCode = 1;
});
