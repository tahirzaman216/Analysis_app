document.addEventListener('DOMContentLoaded', () => {
  const getDisplayNameFromEmail = (email) => {
    const localPart = email.trim().split('@')[0] || '';
    return localPart
      .replace(/[._+-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const loginEmail = document.getElementById('login-email');
  const profileEmail = document.getElementById('profile-email');
  const loginMessage = document.getElementById('auth-message');
  const passwordInput = document.getElementById('password-input');
  const signInButton = document.getElementById('workspace-signin');
  const modeButton = document.getElementById('toggle-auth-mode');
  let creatingAccount = false;

  modeButton?.addEventListener('click', () => {
    creatingAccount = !creatingAccount;
    document.getElementById('auth-heading').textContent = creatingAccount ? 'Create your account' : 'Welcome back';
    document.getElementById('auth-description').textContent = creatingAccount ? 'Create a private workspace. Your data will only be visible to your account.' : 'Sign in to your private workspace.';
    signInButton.textContent = creatingAccount ? 'Create Private Workspace →' : 'Sign In to Private Workspace →';
    modeButton.textContent = creatingAccount ? 'I already have an account' : 'Create a new account';
    passwordInput.autocomplete = creatingAccount ? 'new-password' : 'current-password';
    passwordInput.minLength = creatingAccount ? 10 : 1;
    loginMessage.textContent = '';
    loginMessage.removeAttribute('data-state');
  });

  signInButton?.addEventListener('click', async () => {
    if (!loginEmail.checkValidity() || !passwordInput.value) {
      loginEmail.reportValidity();
      if (!passwordInput.value) passwordInput.focus();
      return;
    }
    const endpoint = creatingAccount ? '/api/auth/register' : '/api/auth/login';
    signInButton.disabled = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.value, password: passwordInput.value })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not sign in.');
      window.location.assign('/dashboard');
    } catch (error) {
      loginMessage.textContent = error.message;
      loginMessage.dataset.state = 'error';
    } finally {
      signInButton.disabled = false;
    }
  });

  const toggleButton = document.getElementById('toggle-password');

  if (passwordInput && toggleButton) {
    toggleButton.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      toggleButton.textContent = isPassword ? 'Hide' : 'Show';
    });
  }

  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.forEach((item) => item.classList.remove('active'));
      link.classList.add('active');
    });
  });

  const profileTrigger = document.getElementById('profile-trigger');
  const profileMenu = document.getElementById('profile-menu');
  const profileForm = document.getElementById('profile-form');
  const profileName = document.getElementById('profile-name');
  const profileNameInput = document.getElementById('profile-name-input');
  const profileAvatar = document.getElementById('profile-avatar');

  const setProfile = (email, name = getDisplayNameFromEmail(email)) => {
    if (profileName) profileName.textContent = name;
    if (profileEmail) profileEmail.value = email;
    if (profileNameInput) profileNameInput.value = name;
    if (profileAvatar) {
      profileAvatar.textContent = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
    }
  };

  if (profileTrigger && profileMenu) {
    fetch('/api/auth/me').then((response) => {
      if (!response.ok) throw new Error('Not signed in');
      return response.json();
    }).then(({ user }) => setProfile(user.email, user.displayName)).catch(() => window.location.assign('/login'));
    profileTrigger.addEventListener('click', () => {
      const open = profileMenu.hidden;
      profileMenu.hidden = !open;
      profileTrigger.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (event) => {
      if (!profileMenu.hidden && !event.target.closest('.profile-wrap')) {
        profileMenu.hidden = true;
        profileTrigger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        profileMenu.hidden = true;
        profileTrigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  profileEmail?.addEventListener('input', () => {
    if (!profileEmail.checkValidity()) return;
    const detectedName = getDisplayNameFromEmail(profileEmail.value);
    if (profileNameInput) profileNameInput.value = detectedName;
  });

  if (profileForm) {
    profileForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!profileEmail.checkValidity()) {
        profileEmail.reportValidity();
        return;
      }
      const name = profileNameInput.value.trim() || getDisplayNameFromEmail(profileEmail.value);
      fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: profileEmail.value, displayName: name })
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not update profile.');
        setProfile(result.user.email, result.user.displayName);
        profileMenu.hidden = true;
        profileTrigger.setAttribute('aria-expanded', 'false');
      }).catch((error) => {
        profileNameInput.setCustomValidity(error.message);
        profileNameInput.reportValidity();
      });
    });
  }

  document.getElementById('signout-button')?.addEventListener('click', () => {
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => window.location.assign('/login'));
  });

  const formatNumber = (value, digits = 0) => Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });

  const requestJson = async (endpoint) => {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`Request failed: ${endpoint}`);
    return response.json();
  };

  const loadSummary = async () => {
    try {
      const summary = await requestJson('/api/summary');
      const title = document.getElementById('overview-title');
      const subtitle = document.getElementById('overview-subtitle');
      const filename = document.getElementById('dataset-filename');
      if (!summary.hasDataset) {
        if (title) title.textContent = 'Your private workspace is ready';
        if (subtitle) subtitle.textContent = 'Upload a dataset to generate analytics visible only to this account.';
        if (filename) filename.textContent = 'No dataset uploaded';
        const kpis = document.getElementById('generic-kpis');
        if (kpis) kpis.replaceChildren();
        const highlights = document.getElementById('category-highlights');
        if (highlights) highlights.replaceChildren(Object.assign(document.createElement('div'), { className: 'list-item', textContent: 'Upload your first dataset to see private category insights.' }));
        const fields = document.getElementById('field-rows');
        if (fields) fields.replaceChildren(Object.assign(document.createElement('tr'), { innerHTML: '<td colspan="5">No dataset uploaded to this account yet.</td>' }));
        const uploadLink = document.createElement('a');
        uploadLink.href = '/upload';
        uploadLink.className = 'primary-btn';
        uploadLink.textContent = 'Upload your dataset';
        const chart = document.querySelector('.hero .chart-card .chart-box');
        if (chart) chart.replaceChildren(uploadLink);
        return;
      }
      if (title) title.textContent = summary.filename ? `${summary.filename} Overview` : 'Dataset Overview';
      if (subtitle) subtitle.textContent = `${formatNumber(summary.rowCount)} records across ${formatNumber(summary.columnCount)} fields. Metrics are inferred from the active dataset.`;
      if (filename) filename.textContent = summary.filename || 'Active dataset';

      const kpis = document.getElementById('generic-kpis');
      if (kpis) {
        const metrics = [
          ['Records', formatNumber(summary.rowCount), 'Rows analyzed'],
          ['Fields', formatNumber(summary.columnCount), 'Columns detected'],
          ['Completeness', `${formatNumber(summary.completenessPct, 1)}%`, `${formatNumber(summary.missingCells)} missing cells`]
        ];
        const valueMetric = summary.numericMetrics.find((metric) => metric.name === summary.valueField);
        if (valueMetric) metrics.push([`Total ${valueMetric.name}`, formatNumber(valueMetric.sum, 2), `Average ${formatNumber(valueMetric.average, 2)}`]);
        else metrics.push(['Numeric measures', formatNumber(summary.numericMetrics.length), 'No numeric value field inferred']);
        if (summary.delivery) metrics[3] = ['Late rate', `${formatNumber(summary.delivery.lateRatePct, 2)}%`, `${formatNumber(summary.delivery.onTimeOrEarlyPct, 2)}% on-time or early`];
        kpis.replaceChildren(...metrics.map(([label, value, note]) => {
          const card = document.createElement('div');
          card.className = 'card kpi';
          const labelElement = document.createElement('div');
          labelElement.className = 'kpi-label';
          labelElement.textContent = label;
          const valueElement = document.createElement('div');
          valueElement.className = 'kpi-value';
          valueElement.textContent = value;
          const noteElement = document.createElement('div');
          noteElement.className = 'muted';
          noteElement.textContent = note;
          card.append(labelElement, valueElement, noteElement);
          return card;
        }));
      }

      const highlights = document.getElementById('category-highlights');
      if (highlights) {
        const entries = summary.categories.slice(0, 4);
        highlights.replaceChildren(...(entries.length ? entries.map((category) => {
          const item = document.createElement('div');
          item.className = 'list-item';
          const label = document.createElement('strong');
          label.textContent = `${category.name}: ${category.top[0]?.value || 'No values'}`;
          const count = document.createElement('span');
          count.className = 'badge success';
          count.textContent = `${formatNumber(category.top[0]?.count)} of ${formatNumber(summary.rowCount)}`;
          item.append(label, count);
          return item;
        }) : [Object.assign(document.createElement('div'), { className: 'list-item', textContent: 'No categorical fields detected.' })]));
      }

      const fieldRows = document.getElementById('field-rows');
      fillRows(fieldRows, summary.columns, (field) => {
        const tr = document.createElement('tr');
        [field.name, field.kind, formatNumber(field.distinct), formatNumber(field.missing), field.sample.join(', ') || 'No values']
          .forEach((value) => tr.append(makeCell(value)));
        return tr;
      });
      await renderGenericAnalysisPage(summary);
    } catch (error) {
      console.error('Could not load dashboard summary:', error);
    }
  };

  const fillRows = (body, rows, renderRow) => {
    if (!body) return;
    body.replaceChildren(...rows.map(renderRow));
  };

  const makeCell = (value) => {
    const cell = document.createElement('td');
    cell.textContent = value ?? 'Unknown';
    return cell;
  };

  const makeTable = (columns, rows) => {
    const table = document.createElement('table');
    table.className = 'table';
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    columns.forEach((column) => {
      const cell = document.createElement('th');
      cell.textContent = column;
      headerRow.append(cell);
    });
    head.append(headerRow);
    const body = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((value) => tr.append(makeCell(value)));
      body.append(tr);
    });
    table.append(head, body);
    return table;
  };

  const renderGenericAnalysisPage = async (summary) => {
    const configs = {
      '/sales-analytics': ['Business Measures', 'Compare numeric measures detected in the active dataset.'],
      '/product-analytics': ['Category Analysis', 'Explore the largest groups found in the uploaded data.'],
      '/customer-analytics': ['Segment Analysis', 'Compare customer, market, and other categorical segments.'],
      '/forecasting': ['Time Trends', 'Explore observed values over time when a date field is available.'],
      '/reports': ['Dataset Quality Report', 'Review data coverage and inferred field types.']
    };
    const config = configs[window.location.pathname];
    if (!config) return;
    const main = document.querySelector('main.page-shell');
    const intro = main?.querySelector('.page-intro');
    if (!main || !intro) return;

    intro.querySelector('h1').textContent = config[0];
    intro.querySelector('p').textContent = config[1];
    [...main.children].filter((child) => child !== intro).forEach((child) => child.remove());
    const section = document.createElement('section');
    section.className = 'card chart-card';

    if (window.location.pathname === '/sales-analytics') {
      section.append(makeHeading('Numeric Measure Summary'));
      section.append(makeTable(['Measure', 'Values', 'Total', 'Average', 'Minimum', 'Maximum'], summary.numericMetrics.map((metric) => [
        metric.name, formatNumber(metric.count), formatNumber(metric.sum, 2), formatNumber(metric.average, 2), formatNumber(metric.minimum, 2), formatNumber(metric.maximum, 2)
      ])));
    } else if (window.location.pathname === '/product-analytics' || window.location.pathname === '/customer-analytics') {
      const pattern = window.location.pathname === '/product-analytics' ? /product|item|category|service/i : /customer|client|segment|account|region|market/i;
      const category = summary.categories.find((item) => pattern.test(item.name)) || summary.categories[0];
      if (!category) {
        section.append(makeHeading('No categorical breakdown available'));
      } else {
        section.append(makeHeading(`${category.name} Breakdown`));
        const breakdown = await requestJson(`/api/breakdown?column=${encodeURIComponent(category.name)}`);
        section.append(makeTable([category.name, 'Records', 'Share', ...(summary.valueField ? [`Total ${summary.valueField}`] : [])], breakdown.rows.map((row) => [
          row.value, formatNumber(row.count), `${formatNumber(row.count / summary.rowCount * 100, 1)}%`, ...(summary.valueField ? [formatNumber(row.total, 2)] : [])
        ])));
      }
    } else if (window.location.pathname === '/forecasting') {
      if (!summary.dateField) {
        section.append(makeHeading('No date field detected'));
        section.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Upload a dataset containing date or time values to view a time trend.' }));
      } else {
        section.append(makeHeading(`${summary.valueField || 'Record count'} by ${summary.dateField}`));
        const monthly = await requestJson('/api/monthly');
        section.append(makeTable(['Month', 'Records', ...(summary.valueField ? [`Total ${summary.valueField}`, `Average ${summary.valueField}`] : [])], monthly.map((row) => [
          row.period, formatNumber(row.records), ...(summary.valueField ? [formatNumber(row.total, 2), formatNumber(row.average, 2)] : [])
        ])));
      }
    } else {
      section.append(makeHeading('Data Quality'));
      section.append(makeTable(['Measure', 'Result'], [
        ['Dataset', summary.filename],
        ['Records', formatNumber(summary.rowCount)],
        ['Fields', formatNumber(summary.columnCount)],
        ['Completeness', `${formatNumber(summary.completenessPct, 2)}%`],
        ['Missing cells', formatNumber(summary.missingCells)],
        ['Numeric measures', formatNumber(summary.numericMetrics.length)],
        ['Date field', summary.dateField || 'Not detected']
      ]));
      const fields = document.createElement('section');
      fields.className = 'card chart-card mt-16';
      fields.append(makeHeading('Field Profile'));
      fields.append(makeTable(['Field', 'Type', 'Distinct', 'Missing'], summary.columns.map((field) => [field.name, field.kind, formatNumber(field.distinct), formatNumber(field.missing)])));
      main.append(section, fields);
      return;
    }
    main.append(section);
  };

  const makeHeading = (text) => {
    const heading = document.createElement('h2');
    heading.className = 'section-title';
    heading.textContent = text;
    return heading;
  };

  const loadTables = async () => {
    try {
      const result = await requestJson('/api/records?limit=25');
      const sample = result.rows || [];
      const columns = result.columns || [];
      const head = document.getElementById('sample-head');
      const body = document.getElementById('sample-rows');
      if (head) {
        const headerRow = document.createElement('tr');
        columns.forEach((column) => {
          const th = document.createElement('th');
          th.textContent = column;
          headerRow.append(th);
        });
        head.replaceChildren(headerRow);
      }
      fillRows(body, sample, (row) => {
        const tr = document.createElement('tr');
        columns.forEach((column) => tr.append(makeCell(row[column] ?? '')));
        return tr;
      });
    } catch (error) {
      console.error('Could not load the upload preview:', error);
    }
  };

  const loadMonthly = async () => {
    try {
      const rows = await requestJson('/api/monthly');
      const summary = await requestJson('/api/summary');

      const monthCount = document.getElementById('trend-count');
      if (monthCount) monthCount.textContent = rows.length ? `${rows.length} periods` : 'No date field';
      const trendTitle = document.getElementById('trend-title');
      if (trendTitle) trendTitle.textContent = summary.dateField ? `${summary.valueField || 'Record count'} by ${summary.dateField}` : 'No date trend available';

      const line = document.getElementById('monthly-line');
      const area = document.getElementById('monthly-area');
      const latest = document.getElementById('monthly-latest');
      if (line && area && latest && rows.length) {
        const trendValues = rows.map((row) => Number(summary.valueField ? row.total : row.records) || 0);
        const minimum = Math.min(...trendValues);
        const maximum = Math.max(...trendValues);
        const spread = Math.max(maximum - minimum, 1);
        const points = trendValues.map((value, index) => ({
          x: rows.length === 1 ? 280 : index * 560 / (rows.length - 1),
          y: 190 - ((value - minimum) / spread) * 145
        }));
        const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ');
        const lastPoint = points[points.length - 1];
        line.setAttribute('d', path);
        area.setAttribute('d', `${path} L${lastPoint.x} 220 L${points[0].x} 220 Z`);
        latest.setAttribute('cx', String(lastPoint.x));
        latest.setAttribute('cy', String(lastPoint.y));
      }
    } catch (error) {
      console.error('Could not load monthly trend:', error);
    }
  };

  if (window.location.pathname !== '/login') {
    if (window.location.pathname !== '/upload') loadSummary();
    if (window.location.pathname === '/upload') loadTables();
    if (window.location.pathname === '/dashboard') loadMonthly();
  }

  const fileInputs = ['csv-file', 'excel-file'].map((id) => document.getElementById(id)).filter(Boolean);
  const selectedFileName = document.getElementById('selected-file-name');
  const selectedFileSize = document.getElementById('selected-file-size');
  const uploadStatus = document.getElementById('upload-file-status');
  const replaceCheck = document.getElementById('replace-data-check');
  const importButton = document.getElementById('import-file-button');
  const uploadMessage = document.getElementById('upload-message');
  let selectedFile = null;

  const updateImportAvailability = () => {
    if (importButton) importButton.disabled = !selectedFile || !replaceCheck?.checked;
  };

  document.querySelectorAll('[data-file-picker]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.filePicker)?.click());
  });

  fileInputs.forEach((input) => {
    input.addEventListener('change', () => {
      selectedFile = input.files?.[0] || null;
      fileInputs.filter((otherInput) => otherInput !== input).forEach((otherInput) => { otherInput.value = ''; });
      if (selectedFile) {
        selectedFileName.textContent = selectedFile.name;
        selectedFileSize.textContent = `${formatNumber(selectedFile.size / 1024 / 1024, 2)} MB selected`;
        uploadStatus.textContent = 'Ready';
        uploadStatus.className = 'badge warn';
        uploadMessage.textContent = '';
        uploadMessage.removeAttribute('data-state');
      } else {
        selectedFileName.textContent = 'No file selected';
        selectedFileSize.textContent = 'CSV or Excel XLSX • Maximum 50 MB';
        uploadStatus.textContent = 'Waiting';
      }
      updateImportAvailability();
    });
  });

  replaceCheck?.addEventListener('change', updateImportAvailability);

  importButton?.addEventListener('click', async () => {
    if (!selectedFile || !replaceCheck.checked) return;
    const formData = new FormData();
    formData.append('file', selectedFile);
    importButton.disabled = true;
    importButton.textContent = 'Validating and importing...';
    uploadMessage.textContent = 'Inferring field types, checking data quality, and building summaries.';
    uploadMessage.removeAttribute('data-state');
    uploadStatus.textContent = 'Importing';

    try {
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Upload failed.');

      uploadMessage.textContent = `${formatNumber(result.importedRows)} rows and ${formatNumber(result.profile.columnCount)} fields imported from ${result.filename}. Removed ${formatNumber(result.duplicateRowsRemoved)} duplicate rows. Data completeness: ${formatNumber(result.summary.completenessPct, 1)}%.`;
      uploadMessage.dataset.state = 'success';
      uploadStatus.textContent = 'Imported';
      uploadStatus.className = 'badge success';
      selectedFileName.textContent = result.filename;
      replaceCheck.checked = false;
      selectedFile = null;
      fileInputs.forEach((input) => { input.value = ''; });
      selectedFileSize.textContent = `${formatNumber(result.importedRows)} cleaned rows stored in the analytics database`;
      await loadTables();
    } catch (error) {
      uploadMessage.textContent = error.message;
      uploadMessage.dataset.state = 'error';
      uploadStatus.textContent = 'Failed';
      uploadStatus.className = 'badge error';
    } finally {
      importButton.textContent = 'Validate and import';
      updateImportAvailability();
    }
  });
});
