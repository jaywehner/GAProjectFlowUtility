# GA Project Flow Utility

A web-based GoAnywhere MFT project flow visualizer with secure login, SQLite storage, work folders, XML upload/processing, and an admin user-management page.

## Features

- Secure login with hashed passwords and HttpOnly session cookies
- Forced password change for the seeded `admin` user on first login
- Self-service registration for new users
- Admin page to add, edit, and delete users
- SQLite-backed storage for users, sessions, work folders, and uploaded file metadata
- XML upload and parsing for GoAnywhere MFT project/module flows
- Graph view with project and module cards plus connecting lines
- Light and dark mode UI
- Seeded sample data from `sample_data/`

## Default Admin Login

- Username: `admin`
- Password: `admin`

The first login requires an immediate password change.

## Run Locally

1. Install dependencies:
   `npm install`
2. Start the application:
   `npm start`
3. Open:
   `http://localhost:3000`

## Notes

- Uploaded XML files are stored under `data/uploads/`
- The SQLite database is stored at `data/app.db`
- The sample XML files are automatically imported into the admin user's `Sample Data` work folder
