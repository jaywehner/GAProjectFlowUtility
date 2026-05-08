import { api } from './api.js';
import { renderGraph } from './graph.js';

const appRoot = document.getElementById('app');

const state = {
  initialized: false,
  theme: localStorage.getItem('ga-theme') === 'dark' ? 'dark' : 'light',
  authMode: 'login',
  pendingAction: '',
  flash: null,
  session: {
    authenticated: false,
    user: null,
  },
  csrfToken: null,
  workFolders: [],
  selectedWorkFolderId: null,
  files: [],
  selectedStartProjectFileName: '',
  graph: null,
  showAdmin: false,
  adminUsers: [],
  showPasswordModal: false,
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function selectedAttr(condition) {
  return condition ? 'selected' : '';
}

function checkedAttr(condition) {
  return condition ? 'checked' : '';
}

function disabledAttr(condition) {
  return condition ? 'disabled' : '';
}

function setTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('ga-theme', state.theme);
  document.documentElement.setAttribute('data-theme', state.theme);
}

function toggleTheme() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark');
  renderApp();
}

function setFlash(type, text) {
  state.flash = text ? { type, text } : null;
}

function clearFlash() {
  state.flash = null;
}

function currentUser() {
  return state.session && state.session.authenticated ? state.session.user : null;
}

function isAuthenticated() {
  return Boolean(currentUser());
}

function resetWorkspaceState() {
  state.workFolders = [];
  state.selectedWorkFolderId = null;
  state.files = [];
  state.selectedStartProjectFileName = '';
  state.graph = null;
  state.showAdmin = false;
  state.adminUsers = [];
}

function setSession(payload) {
  if (!payload || !payload.authenticated || !payload.user) {
    state.session = {
      authenticated: false,
      user: null,
    };
    state.csrfToken = null;
    state.showPasswordModal = false;
    resetWorkspaceState();
    return;
  }

  state.session = {
    authenticated: true,
    user: payload.user,
  };
  state.csrfToken = payload.csrfToken || null;
  state.showPasswordModal = Boolean(payload.user.mustChangePassword) || state.showPasswordModal;
}

function formatDateTime(value) {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleString();
}

function formatBytes(value) {
  const size = Number(value || 0);

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAlert() {
  if (!state.flash) {
    return '';
  }

  return `
    <div class="alert alert--${escapeHtml(state.flash.type)}">
      ${escapeHtml(state.flash.text)}
    </div>
  `;
}

function renderBusyOverlay() {
  if (!state.pendingAction) {
    return '';
  }

  return `
    <div class="busy-indicator">
      <div class="busy-indicator__spinner"></div>
      <span>${escapeHtml(state.pendingAction)}</span>
    </div>
  `;
}

function renderThemeButton() {
  return `
    <button type="button" class="button button--ghost" data-action="toggle-theme">
      ${state.theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  `;
}

function renderAuthView() {
  const isLogin = state.authMode === 'login';

  return `
    <div class="auth-page">
      <header class="dashboard-header dashboard-header--auth">
        <div class="app-brand">
          <div class="app-brand__icon">GA</div>
          <div>
            <h1>GA Project Flow Utility</h1>
            <p>Secure GoAnywhere MFT project and module flow visualization</p>
          </div>
        </div>
        <div class="header-actions">
          ${renderThemeButton()}
        </div>
      </header>

      <section class="auth-layout">
        <div class="panel hero-panel">
          <span class="eyebrow">What this app does</span>
          <h2>Upload GoAnywhere XML and generate connected project and module cards.</h2>
          <p>
            Organize uploads into work folders, choose a starting project, and process the full flow including nested
            <code>callProject</code> and <code>callModule</code> nodes.
          </p>
          <div class="feature-list">
            <div class="feature-card">
              <strong>Secure access</strong>
              <span>Hashed passwords, session cookies, rate limiting, and forced admin password rotation.</span>
            </div>
            <div class="feature-card">
              <strong>Work folders</strong>
              <span>Create separate collections of XML files before selecting the starting project.</span>
            </div>
            <div class="feature-card">
              <strong>Visual flow</strong>
              <span>Projects and modules appear as connected cards with missing references clearly highlighted.</span>
            </div>
          </div>
          <div class="panel-note">
            Seeded administrator login: <strong>admin</strong> / <strong>admin</strong>. The first sign-in requires an immediate password change.
          </div>
        </div>

        <div class="panel auth-card">
          <div class="tabs">
            <button type="button" class="tabs__button ${isLogin ? 'is-active' : ''}" data-auth-mode="login">Sign in</button>
            <button type="button" class="tabs__button ${!isLogin ? 'is-active' : ''}" data-auth-mode="register">Register</button>
          </div>
          ${renderAlert()}
          ${isLogin ? renderLoginForm() : renderRegisterForm()}
        </div>
      </section>
      ${renderBusyOverlay()}
    </div>
  `;
}

function renderLoginForm() {
  return `
    <form class="form-stack" data-form="login">
      <label class="field">
        <span>Username</span>
        <input name="username" type="text" autocomplete="username" required maxlength="40" />
      </label>
      <label class="field">
        <span>Password</span>
        <input name="password" type="password" autocomplete="current-password" required />
      </label>
      <button type="submit" class="button button--primary button--block">Sign in</button>
    </form>
  `;
}

function renderRegisterForm() {
  return `
    <form class="form-stack" data-form="register">
      <label class="field">
        <span>Username</span>
        <input name="username" type="text" autocomplete="username" required maxlength="40" />
      </label>
      <label class="field">
        <span>Password</span>
        <input name="password" type="password" autocomplete="new-password" required />
      </label>
      <label class="field">
        <span>Confirm password</span>
        <input name="confirmPassword" type="password" autocomplete="new-password" required />
      </label>
      <div class="password-rules">
        Passwords must be 10-128 characters and include uppercase, lowercase, and a number.
      </div>
      <button type="submit" class="button button--primary button--block">Create account</button>
    </form>
  `;
}

function getSelectedWorkFolder() {
  return state.workFolders.find((folder) => Number(folder.id) === Number(state.selectedWorkFolderId)) || null;
}

function renderWorkFolderOptions() {
  if (!state.workFolders.length) {
    return '<option value="">Create a work folder to begin</option>';
  }

  return state.workFolders.map((folder) => `
    <option value="${folder.id}" ${selectedAttr(Number(folder.id) === Number(state.selectedWorkFolderId))}>
      ${escapeHtml(folder.name)} (${Number(folder.fileCount || 0)})
    </option>
  `).join('');
}

function renderStartProjectOptions() {
  if (!state.files.length) {
    return '<option value="">Upload XML files first</option>';
  }

  return state.files.map((file) => `
    <option value="${escapeHtml(file.originalName)}" ${selectedAttr(file.originalName === state.selectedStartProjectFileName)}>
      ${escapeHtml(file.originalName)}
    </option>
  `).join('');
}

function renderFileList() {
  if (!state.files.length) {
    return `
      <div class="empty-state compact">
        <p>No XML files uploaded to this folder yet.</p>
      </div>
    `;
  }

  return `
    <div class="file-list">
      ${state.files.map((file) => `
        <div class="file-list__item">
          <div>
            <strong>${escapeHtml(file.originalName)}</strong>
            <span>${formatBytes(file.size)}</span>
          </div>
          <span>${escapeHtml(formatDateTime(file.updatedAt || file.uploadedAt))}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderDashboardView() {
  const user = currentUser();
  const selectedFolder = getSelectedWorkFolder();
  const nodeCount = Array.isArray(state.graph?.nodes) ? state.graph.nodes.length : 0;
  const edgeCount = Array.isArray(state.graph?.edges) ? state.graph.edges.length : 0;
  const canProcess = Boolean(state.selectedWorkFolderId && state.selectedStartProjectFileName);

  return `
    <div class="dashboard-page">
      <header class="dashboard-header">
        <div class="app-brand">
          <div class="app-brand__icon">GA</div>
          <div>
            <h1>GA Project Flow Utility</h1>
            <p>Upload GoAnywhere XML, pick a start project, and visualize the complete flow.</p>
          </div>
        </div>
        <div class="header-actions header-actions--wrap">
          <span class="pill">Signed in as ${escapeHtml(user.username)}</span>
          ${user.isAdmin ? '<button type="button" class="button button--ghost" data-action="open-admin">Admin page</button>' : ''}
          <button type="button" class="button button--ghost" data-action="show-password-modal">Change password</button>
          ${renderThemeButton()}
          <button type="button" class="button button--ghost" data-action="logout">Sign out</button>
        </div>
      </header>

      ${renderAlert()}

      <div class="workspace-layout">
        <aside class="sidebar">
          <section class="panel sidebar-section">
            <div class="panel-header">
              <div>
                <h2>Work folders</h2>
                <p>Create a folder, then upload related project files into it.</p>
              </div>
            </div>
            <form class="inline-form" data-form="create-folder">
              <label class="field field--grow">
                <span>New folder name</span>
                <input name="folderName" type="text" maxlength="60" required />
              </label>
              <button type="submit" class="button button--primary">Create</button>
            </form>
            <label class="field">
              <span>Selected work folder</span>
              <select id="work-folder-select" ${disabledAttr(!state.workFolders.length)}>
                ${renderWorkFolderOptions()}
              </select>
            </label>
          </section>

          <section class="panel sidebar-section">
            <div class="panel-header">
              <div>
                <h2>Upload XML files</h2>
                <p>Only GoAnywhere XML files are accepted.</p>
              </div>
            </div>
            <form class="form-stack" data-form="upload-files">
              <label class="field">
                <span>Select XML files</span>
                <input name="files" type="file" accept=".xml,text/xml" multiple ${disabledAttr(!state.selectedWorkFolderId)} />
              </label>
              <button type="submit" class="button button--primary" ${disabledAttr(!state.selectedWorkFolderId)}>
                Upload files
              </button>
            </form>
            ${renderFileList()}
          </section>

          <section class="panel sidebar-section">
            <div class="panel-header">
              <div>
                <h2>Process projects</h2>
                <p>Choose the starting project, then generate the connected cards and lines.</p>
              </div>
            </div>
            <label class="field">
              <span>Starting project</span>
              <select id="start-project-select" ${disabledAttr(!state.files.length)}>
                ${renderStartProjectOptions()}
              </select>
            </label>
            <button type="button" class="button button--primary button--block" data-action="process-projects" ${disabledAttr(!canProcess)}>
              Process projects
            </button>
          </section>
        </aside>

        <main class="main-panel">
          <section class="panel graph-panel">
            <div class="panel-header panel-header--wide">
              <div>
                <h2>Project flow</h2>
                <p>
                  ${selectedFolder ? `Folder: ${escapeHtml(selectedFolder.name)}` : 'Choose a work folder to begin.'}
                </p>
              </div>
              <div class="stats-row">
                <div class="stat-chip">
                  <span>Start project</span>
                  <strong>${escapeHtml(state.selectedStartProjectFileName || 'Not selected')}</strong>
                </div>
                <div class="stat-chip">
                  <span>Nodes</span>
                  <strong>${nodeCount}</strong>
                </div>
                <div class="stat-chip">
                  <span>Connections</span>
                  <strong>${edgeCount}</strong>
                </div>
              </div>
            </div>
            <div id="graph-container" class="graph-container"></div>
          </section>
        </main>
      </div>

      ${state.showAdmin ? renderAdminModal() : ''}
      ${state.showPasswordModal ? renderPasswordModal() : ''}
      ${renderBusyOverlay()}
    </div>
  `;
}

function renderPasswordModal() {
  const forced = Boolean(currentUser() && currentUser().mustChangePassword);

  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div>
            <h2>${forced ? 'Change your password now' : 'Change password'}</h2>
            <p>${forced ? 'Your account is blocked from other actions until your password is updated.' : 'Update your password using current security rules.'}</p>
          </div>
          ${forced ? '' : '<button type="button" class="button button--ghost" data-action="close-password-modal">Close</button>'}
        </div>
        <form class="form-stack" data-form="change-password">
          <label class="field">
            <span>Current password</span>
            <input name="currentPassword" type="password" autocomplete="current-password" required />
          </label>
          <label class="field">
            <span>New password</span>
            <input name="newPassword" type="password" autocomplete="new-password" required />
          </label>
          <label class="field">
            <span>Confirm new password</span>
            <input name="confirmNewPassword" type="password" autocomplete="new-password" required />
          </label>
          <div class="password-rules">
            Passwords must be 10-128 characters and include uppercase, lowercase, and a number.
          </div>
          <button type="submit" class="button button--primary button--block">Update password</button>
        </form>
      </div>
    </div>
  `;
}

function renderAdminModal() {
  return `
    <div class="modal-backdrop modal-backdrop--wide">
      <div class="modal modal--wide">
        <div class="modal-header">
          <div>
            <h2>Admin page</h2>
            <p>Add, edit, or delete users. The primary admin account cannot be deleted.</p>
          </div>
          <button type="button" class="button button--ghost" data-action="close-admin">Close</button>
        </div>
        <div class="admin-layout">
          <section class="panel panel--subtle">
            <h3>Create user</h3>
            <form class="form-stack" data-form="admin-create-user">
              <label class="field">
                <span>Username</span>
                <input name="username" type="text" maxlength="40" required />
              </label>
              <label class="field">
                <span>Password</span>
                <input name="password" type="password" autocomplete="new-password" required />
              </label>
              <label class="checkbox-row">
                <input name="isAdmin" type="checkbox" />
                <span>Administrator</span>
              </label>
              <label class="checkbox-row">
                <input name="mustChangePassword" type="checkbox" checked />
                <span>Require password change on next login</span>
              </label>
              <button type="submit" class="button button--primary">Create user</button>
            </form>
          </section>
          <section class="admin-users">
            ${renderAdminUsers()}
          </section>
        </div>
      </div>
    </div>
  `;
}

function renderAdminUsers() {
  if (!state.adminUsers.length) {
    return `
      <div class="empty-state">
        <p>No users found.</p>
      </div>
    `;
  }

  return state.adminUsers.map((user) => {
    const primaryAdmin = String(user.username || '').toLowerCase() === 'admin';
    return `
      <form class="panel panel--subtle admin-user-card" data-form="admin-update-user" data-user-id="${user.id}">
        <div class="admin-user-card__header">
          <div>
            <h3>${escapeHtml(user.username)}</h3>
            <p>${user.isAdmin ? 'Administrator' : 'Standard user'}</p>
          </div>
          <div class="button-row">
            <button type="submit" class="button button--primary">Save</button>
            <button
              type="button"
              class="button button--ghost button--danger"
              data-action="delete-user"
              data-user-id="${user.id}"
              ${disabledAttr(primaryAdmin)}
            >
              Delete
            </button>
          </div>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>Username</span>
            <input name="username" type="text" maxlength="40" value="${escapeHtml(user.username)}" ${disabledAttr(primaryAdmin)} required />
          </label>
          <label class="field">
            <span>New password</span>
            <input name="password" type="password" autocomplete="new-password" placeholder="Leave blank to keep current password" />
          </label>
        </div>
        <div class="checkbox-grid">
          <label class="checkbox-row">
            <input name="isAdmin" type="checkbox" ${checkedAttr(user.isAdmin)} ${disabledAttr(primaryAdmin)} />
            <span>Administrator</span>
          </label>
          <label class="checkbox-row">
            <input name="mustChangePassword" type="checkbox" ${checkedAttr(user.mustChangePassword)} />
            <span>Require password change</span>
          </label>
        </div>
        <div class="meta-row">
          <span>Created: ${escapeHtml(formatDateTime(user.createdAt))}</span>
          <span>Updated: ${escapeHtml(formatDateTime(user.updatedAt))}</span>
        </div>
      </form>
    `;
  }).join('');
}

function renderLoadingView() {
  return `
    <div class="loading-screen">
      <div class="loading-card panel">
        <div class="busy-indicator__spinner"></div>
        <h2>Loading GA Project Flow Utility</h2>
        <p>Preparing your secure session and workspace.</p>
      </div>
    </div>
  `;
}

function renderApp() {
  setTheme(state.theme);

  if (!state.initialized) {
    appRoot.innerHTML = renderLoadingView();
    return;
  }

  appRoot.innerHTML = isAuthenticated() ? renderDashboardView() : renderAuthView();

  if (isAuthenticated()) {
    renderGraph(document.getElementById('graph-container'), state.graph);
  }
}

function handleApiError(error) {
  if (error && error.status === 401) {
    setSession(null);
    state.authMode = 'login';
    state.initialized = true;
    setFlash('error', 'Your session is no longer valid. Please sign in again.');
    return;
  }

  if (error && error.status === 403 && error.payload && error.payload.code === 'PASSWORD_CHANGE_REQUIRED') {
    if (currentUser()) {
      state.session.user.mustChangePassword = true;
    }
    state.showPasswordModal = true;
    setFlash('error', error.message || 'You must change your password before continuing.');
    return;
  }

  setFlash('error', error && error.message ? error.message : 'An unexpected error occurred.');
}

async function runAction(label, work) {
  state.pendingAction = label;
  renderApp();

  try {
    await work();
  } catch (error) {
    handleApiError(error);
  } finally {
    state.pendingAction = '';
    renderApp();
  }
}

function applyFilesPayload(payload, clearGraph = true) {
  const nextFiles = Array.isArray(payload.files) ? payload.files : [];
  state.files = nextFiles;

  const fileNames = new Set(nextFiles.map((file) => file.originalName));
  if (!fileNames.has(state.selectedStartProjectFileName)) {
    state.selectedStartProjectFileName = payload.defaultStartProjectFileName || nextFiles[0]?.originalName || '';
  }

  if (clearGraph) {
    state.graph = null;
  }
}

async function refreshFiles(workFolderId, options = {}) {
  const payload = await api.listFiles(workFolderId);
  applyFilesPayload(payload, !options.keepGraph);

  if (options.autoProcess && state.selectedStartProjectFileName) {
    await processCurrentProject(false);
  }
}

async function refreshWorkFolders(options = {}) {
  const payload = await api.listWorkFolders();
  state.workFolders = Array.isArray(payload.workFolders) ? payload.workFolders : [];

  const validFolderIds = new Set(state.workFolders.map((folder) => Number(folder.id)));
  if (!validFolderIds.has(Number(state.selectedWorkFolderId))) {
    state.selectedWorkFolderId = payload.defaultWorkFolderId || state.workFolders[0]?.id || null;
  }

  if (state.selectedWorkFolderId) {
    await refreshFiles(state.selectedWorkFolderId, { autoProcess: Boolean(options.autoProcess) });
  } else {
    state.files = [];
    state.selectedStartProjectFileName = '';
    state.graph = null;
  }
}

async function refreshAdminUsers() {
  const payload = await api.listUsers();
  state.adminUsers = Array.isArray(payload.users) ? payload.users : [];
}

async function processCurrentProject(showSuccessMessage = true) {
  if (!state.selectedWorkFolderId || !state.selectedStartProjectFileName) {
    setFlash('error', 'Choose a work folder and starting project before processing.');
    return;
  }

  const payload = await api.processProjects(state.selectedWorkFolderId, state.selectedStartProjectFileName, state.csrfToken);
  state.graph = payload.graph;

  if (showSuccessMessage) {
    setFlash('success', `Processed ${state.selectedStartProjectFileName} successfully.`);
  }
}

async function boot() {
  renderApp();

  try {
    const sessionPayload = await api.getSession();
    setSession(sessionPayload);
    state.initialized = true;
    renderApp();

    if (sessionPayload.authenticated && sessionPayload.user && !sessionPayload.user.mustChangePassword) {
      await runAction('Loading workspace…', async () => {
        await refreshWorkFolders({ autoProcess: true });
      });
      return;
    }
  } catch (error) {
    handleApiError(error);
    state.initialized = true;
  }

  renderApp();
}

appRoot.addEventListener('click', (event) => {
  const authToggle = event.target.closest('[data-auth-mode]');
  if (authToggle) {
    state.authMode = authToggle.getAttribute('data-auth-mode') === 'register' ? 'register' : 'login';
    clearFlash();
    renderApp();
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) {
    return;
  }

  const action = actionButton.getAttribute('data-action');

  if (action === 'toggle-theme') {
    toggleTheme();
    return;
  }

  if (action === 'logout') {
    runAction('Signing out…', async () => {
      await api.logout();
      setSession(null);
      setFlash('success', 'Signed out successfully.');
    });
    return;
  }

  if (action === 'open-admin') {
    state.showAdmin = true;
    renderApp();
    runAction('Loading user administration…', async () => {
      await refreshAdminUsers();
    });
    return;
  }

  if (action === 'close-admin') {
    state.showAdmin = false;
    renderApp();
    return;
  }

  if (action === 'show-password-modal') {
    state.showPasswordModal = true;
    clearFlash();
    renderApp();
    return;
  }

  if (action === 'close-password-modal') {
    if (currentUser() && currentUser().mustChangePassword) {
      return;
    }

    state.showPasswordModal = false;
    renderApp();
    return;
  }

  if (action === 'process-projects') {
    runAction('Processing project flow…', async () => {
      await processCurrentProject(true);
    });
    return;
  }

  if (action === 'delete-user') {
    const userId = Number(actionButton.getAttribute('data-user-id'));
    const targetUser = state.adminUsers.find((user) => Number(user.id) === userId);

    if (!targetUser || !window.confirm(`Delete user ${targetUser.username}? This action cannot be undone.`)) {
      return;
    }

    runAction('Deleting user…', async () => {
      await api.deleteUser(userId, state.csrfToken);
      await refreshAdminUsers();
      setFlash('success', `Deleted ${targetUser.username}.`);
    });
  }
});

appRoot.addEventListener('change', (event) => {
  const target = event.target;

  if (target.id === 'work-folder-select') {
    state.selectedWorkFolderId = target.value ? Number(target.value) : null;
    runAction('Loading folder files…', async () => {
      if (!state.selectedWorkFolderId) {
        state.files = [];
        state.selectedStartProjectFileName = '';
        state.graph = null;
        return;
      }

      await refreshFiles(state.selectedWorkFolderId, { autoProcess: false });
    });
    return;
  }

  if (target.id === 'start-project-select') {
    state.selectedStartProjectFileName = target.value || '';
    renderApp();
  }
});

appRoot.addEventListener('submit', (event) => {
  const form = event.target.closest('form');
  if (!form) {
    return;
  }

  event.preventDefault();
  const formType = form.getAttribute('data-form');
  const formData = new FormData(form);

  if (formType === 'login') {
    runAction('Signing in…', async () => {
      const payload = await api.login(formData.get('username'), formData.get('password'));
      setSession(payload);
      clearFlash();
      if (!payload.user.mustChangePassword) {
        await refreshWorkFolders({ autoProcess: true });
      }
    });
    return;
  }

  if (formType === 'register') {
    const password = String(formData.get('password') || '');
    const confirmPassword = String(formData.get('confirmPassword') || '');

    if (password !== confirmPassword) {
      setFlash('error', 'The password confirmation does not match.');
      renderApp();
      return;
    }

    runAction('Creating account…', async () => {
      const payload = await api.register(formData.get('username'), password);
      setSession(payload);
      clearFlash();
      await refreshWorkFolders({ autoProcess: true });
    });
    return;
  }

  if (formType === 'change-password') {
    const newPassword = String(formData.get('newPassword') || '');
    const confirmNewPassword = String(formData.get('confirmNewPassword') || '');

    if (newPassword !== confirmNewPassword) {
      setFlash('error', 'The new password confirmation does not match.');
      renderApp();
      return;
    }

    runAction('Updating password…', async () => {
      const payload = await api.changePassword(formData.get('currentPassword'), newPassword, state.csrfToken);
      setSession(payload);
      state.showPasswordModal = false;
      setFlash('success', 'Password updated successfully.');
      await refreshWorkFolders({ autoProcess: true });
    });
    return;
  }

  if (formType === 'create-folder') {
    runAction('Creating work folder…', async () => {
      await api.createWorkFolder(formData.get('folderName'), state.csrfToken);
      await refreshWorkFolders({ autoProcess: false });
      const newestFolder = state.workFolders.find((folder) => folder.name.toLowerCase() === String(formData.get('folderName') || '').trim().toLowerCase());
      if (newestFolder) {
        state.selectedWorkFolderId = newestFolder.id;
        await refreshFiles(newestFolder.id, { autoProcess: false });
      }
      form.reset();
      setFlash('success', 'Work folder created.');
    });
    return;
  }

  if (formType === 'upload-files') {
    const files = Array.from(form.querySelector('input[name="files"]')?.files || []);

    if (!files.length) {
      setFlash('error', 'Please select one or more XML files to upload.');
      renderApp();
      return;
    }

    runAction('Uploading XML files…', async () => {
      const payload = await api.uploadFiles(state.selectedWorkFolderId, files, state.csrfToken);
      applyFilesPayload(payload, true);
      form.reset();
      setFlash('success', `Uploaded ${files.length} file${files.length === 1 ? '' : 's'}.`);
    });
    return;
  }

  if (formType === 'admin-create-user') {
    runAction('Creating user…', async () => {
      await api.createUser({
        username: formData.get('username'),
        password: formData.get('password'),
        isAdmin: formData.get('isAdmin') === 'on',
        mustChangePassword: formData.get('mustChangePassword') === 'on',
      }, state.csrfToken);
      form.reset();
      await refreshAdminUsers();
      setFlash('success', 'User created successfully.');
    });
    return;
  }

  if (formType === 'admin-update-user') {
    const userId = Number(form.getAttribute('data-user-id'));

    runAction('Saving user changes…', async () => {
      const payload = await api.updateUser(userId, {
        username: formData.get('username'),
        password: formData.get('password'),
        isAdmin: formData.get('isAdmin') === 'on',
        mustChangePassword: formData.get('mustChangePassword') === 'on',
      }, state.csrfToken);

      if (payload.reauthenticate) {
        setSession(null);
        state.authMode = 'login';
        setFlash('success', 'Your account was updated. Please sign in again.');
        return;
      }

      if (currentUser() && Number(currentUser().id) === userId) {
        state.session.user = payload.user;
      }

      await refreshAdminUsers();
      setFlash('success', 'User updated successfully.');
    });
  }
});

boot();
