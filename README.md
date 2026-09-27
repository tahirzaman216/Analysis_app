# Aura Telemetry

A Node.js analytics dashboard with CSV/XLSX uploads, per-account workspaces, and a separate Python analysis pipeline.

## Web app

Requirements: Node.js 20 or newer.

```powershell
npm ci
npm start
```

Open `http://localhost:3000`. The app creates a fresh SQLite database on first launch; create an account, then upload a CSV or XLSX dataset. The default database path is `delivery_database.db` in the project folder.

For hosting, configure these environment variables:

- `NODE_ENV=production`
- `SESSION_SECRET` to a long, random secret stored in the host's secret manager
- `DATABASE_PATH` to a file on persistent storage
- `PORT` is supplied by most Node hosts

This app uses a local SQLite database and in-memory Express sessions. Deploy it as a single persistent service, not a serverless or horizontally scaled app. Account datasets are lost if the database volume is ephemeral; users will need to sign in again after a process restart.

Do not commit `.env` files, SQLite databases, or `node_modules`.

## Python analysis

The Python scripts and notebook use `delivery_history.csv.csv` from the project folder.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python database_setup.py
python dashboard_summary.py
python forecasting.py
```

Open `01_EDA.ipynb` in VS Code to run the exploratory analysis.
