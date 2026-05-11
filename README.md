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

## Run with Docker

### Using Docker Compose (Recommended)

1. Build and start the container:
   ```bash
   docker-compose up -d
   ```

   Open `http://localhost:3300`.

2. View logs:
   ```bash
   docker-compose logs -f
   ```

3. Stop the container:
   ```bash
   docker-compose down
   ```

### Using Docker directly

1. Build the image:
   ```bash
   docker build -t ga-project-flow .
   ```

2. Run the container:
   ```bash
   docker run -d \
     --name ga-project-flow \
     -p 3300:3000 \
     -v $(pwd)/data:/app/data \
     ga-project-flow
   ```

   Open `http://localhost:3300`.

3. View logs:
   ```bash
   docker logs -f ga-project-flow
   ```

4. Stop the container:
   ```bash
   docker stop ga-project-flow
   ```

## Docker Configuration

- **Port**: The application runs on container port 3000 and is exposed on host port 3300 by the provided Docker Compose file
- **Data persistence**: The `data/` directory is mounted as a volume to persist:
  - SQLite database (`data/app.db`)
  - Uploaded XML files (`data/uploads/`)
- **Health check**: Container includes a health check that verifies the application is responding
- **Restart policy**: Configured to restart unless stopped
- **Non-root user**: Application runs as a non-root user for security

## Notes

- Uploaded XML files are stored under `data/uploads/`
- The SQLite database is stored at `data/app.db`
- The sample XML files are automatically imported into the admin user's `Sample Data` work folder
- When using Docker, ensure the `data/` directory has proper write permissions
- The application uses Node.js 18 LTS as the base image
