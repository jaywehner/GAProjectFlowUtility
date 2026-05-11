import { api } from './api.js';
import { mountGraph, getGraphMetrics } from './graphController.js';
import {
  applySavedGraphLayout,
  clearGraphLayout,
  getSavedGraphLayout,
  saveGraphNodePosition,
  saveGraphViewport,
} from './graphPersistence.js';

const appRoot = document.getElementById('app');

let graphController = null;
let sidebarResizeState = null;

const SIDEBAR_WIDTH_STORAGE_KEY = 'ga-workspace-sidebar-width';
const SIDEBAR_DEFAULT_WIDTH = 400;
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 760;

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
  graphSearchTerm: '',
  graphFilterOnly: false,
  graphViewport: null,
  showAdmin: false,
  adminUsers: [],
  showPasswordModal: false,
  sidebarWidth: readStoredSidebarWidth(),
  sidebarCollapsed: readStoredSidebarCollapsed(),
  selectedFileIds: new Set(),
  showXmlPasteModal: false,
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

function readStoredSidebarCollapsed() {
  try {
    return window.localStorage.getItem('ga-workspace-sidebar-collapsed') === 'true';
  } catch (error) {
    return false;
  }
}

function persistSidebarCollapsed(collapsed) {
  try {
    window.localStorage.setItem('ga-workspace-sidebar-collapsed', String(collapsed));
  } catch (error) {
    return;
  }
}

function toggleSidebarCollapsed() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  applySidebarCollapsedToLayout();
  persistSidebarCollapsed(state.sidebarCollapsed);
}

function applySidebarCollapsedToLayout() {
  const layout = document.querySelector('.workspace-layout');

  if (!layout) {
    return;
  }

  layout.classList.toggle('is-sidebar-collapsed', state.sidebarCollapsed);
}

function toggleFileSelection(fileId) {
  if (state.selectedFileIds.has(fileId)) {
    state.selectedFileIds.delete(fileId);
  } else {
    state.selectedFileIds.add(fileId);
  }
}

function selectAllFiles() {
  state.selectedFileIds = new Set(state.files.map((file) => file.id));
}

function deselectAllFiles() {
  state.selectedFileIds.clear();
}

function getSelectedFilesForDelete() {
  return state.files.filter((file) => state.selectedFileIds.has(file.id));
}

function hasAnyFilesSelected() {
  return state.selectedFileIds.size > 0;
}

function clampSidebarWidth(value) {
  const numericValue = Math.round(Number(value || SIDEBAR_DEFAULT_WIDTH));
  return Math.min(Math.max(numericValue, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

function readStoredSidebarWidth() {
  try {
    return clampSidebarWidth(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || SIDEBAR_DEFAULT_WIDTH);
  } catch (error) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function persistSidebarWidth(width) {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
  } catch (error) {
    return;
  }
}

function applySidebarWidthToLayout() {
  const layout = document.querySelector('.workspace-layout');

  if (!layout) {
    return;
  }

  layout.style.setProperty('--workspace-sidebar-width', `${clampSidebarWidth(state.sidebarWidth)}px`);
}

function handleSidebarResizePointerMove(event) {
  if (!sidebarResizeState) {
    return;
  }

  state.sidebarWidth = clampSidebarWidth(sidebarResizeState.startWidth + (event.clientX - sidebarResizeState.startClientX));
  applySidebarWidthToLayout();
}

function stopSidebarResize() {
  if (!sidebarResizeState) {
    return;
  }

  persistSidebarWidth(state.sidebarWidth);
  sidebarResizeState = null;
  document.body.classList.remove('is-resizing-sidebar');
  window.removeEventListener('pointermove', handleSidebarResizePointerMove);
  window.removeEventListener('pointerup', stopSidebarResize);
}

function startSidebarResize(event) {
  const layout = event.target.closest('.workspace-layout');
  const sidebar = layout ? layout.querySelector('.sidebar') : null;

  if (!layout || !sidebar) {
    return;
  }

  sidebarResizeState = {
    startClientX: event.clientX,
    startWidth: sidebar.getBoundingClientRect().width || state.sidebarWidth,
  };
  document.body.classList.add('is-resizing-sidebar');
  window.addEventListener('pointermove', handleSidebarResizePointerMove);
  window.addEventListener('pointerup', stopSidebarResize);
  event.preventDefault();
}

function nudgeSidebarWidth(direction) {
  state.sidebarWidth = clampSidebarWidth(state.sidebarWidth + (direction * 24));
  applySidebarWidthToLayout();
  persistSidebarWidth(state.sidebarWidth);
}

function destroyGraphController() {
  if (graphController) {
    graphController.destroy();
    graphController = null;
  }
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
  destroyGraphController();
  state.workFolders = [];
  state.selectedWorkFolderId = null;
  state.files = [];
  state.selectedStartProjectFileName = '';
  state.graph = null;
  state.graphSearchTerm = '';
  state.graphFilterOnly = false;
  state.graphViewport = null;
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

function getGraphContext() {
  const user = currentUser();

  return {
    userId: user ? user.id : null,
    workFolderId: state.selectedWorkFolderId,
    startProjectFileName: state.selectedStartProjectFileName,
  };
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

function toSlug(value) {
  return String(value || 'ga-project-flow')
    .trim()
    .replace(/\.xml$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'ga-project-flow';
}

function getSelectedWorkFolder() {
  return state.workFolders.find((folder) => Number(folder.id) === Number(state.selectedWorkFolderId)) || null;
}

function getSelectedStartFile() {
  return state.files.find((file) => file.originalName === state.selectedStartProjectFileName) || null;
}

function applyStoredGraphState(graph) {
  if (!graph) {
    state.graphViewport = null;
    return null;
  }

  const context = getGraphContext();
  const saved = getSavedGraphLayout(context);
  state.graphViewport = saved.viewport || null;
  return applySavedGraphLayout(graph, context);
}

function updateGraphNodePosition(nodeId, position) {
  const context = getGraphContext();

  if (!state.graph || !Array.isArray(state.graph.nodes)) {
    return;
  }

  const targetNode = state.graph.nodes.find((node) => node.id === nodeId);

  if (!targetNode) {
    return;
  }

  targetNode.position = {
    x: Number(position.x || 0),
    y: Number(position.y || 0),
  };
  saveGraphNodePosition(context, nodeId, targetNode.position);
}

function updateGraphViewport(viewport) {
  state.graphViewport = viewport || null;
  saveGraphViewport(getGraphContext(), state.graphViewport);
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
              <span>Hashed passwords, session cookies, rate limiting, encrypted file storage, and forced admin password rotation.</span>
            </div>
            <div class="feature-card">
              <strong>Interactive graph</strong>
              <span>Drag cards, pan the canvas, zoom, search, filter, and export the graph as SVG, PNG, or PDF.</span>
            </div>
            <div class="feature-card">
              <strong>Work folders</strong>
              <span>Create separate collections of XML files before selecting the starting project and processing the flow.</span>
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

  const selectedFilesForDelete = getSelectedFilesForDelete();
  const hasSelection = hasAnyFilesSelected();
  const allSelected = state.selectedFileIds.size === state.files.length;

  return `
    <div class="file-list-shell">
      <div class="file-list__summary">
        <strong>${escapeHtml(`${state.files.length} file${state.files.length === 1 ? '' : 's'}`)}</strong>
        <span>${escapeHtml(state.selectedStartProjectFileName || 'No starting project selected')}</span>
      </div>
      <div class="file-list">
        <div class="file-list__controls">
          <label class="checkbox-row checkbox-row--compact">
            <input type="checkbox" ${checkedAttr(allSelected)} data-action="toggle-all-files">
            <span>Select all</span>
          </label>
        </div>
        ${state.files.map((file) => `
          <div class="file-list__row ${file.originalName === state.selectedStartProjectFileName ? 'is-active' : ''}">
            <label class="file-list__checkbox">
              <input type="checkbox" ${checkedAttr(state.selectedFileIds.has(file.id))} data-action="toggle-file-selection" data-file-id="${file.id}">
            </label>
            <div class="file-list__details">
              <strong title="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</strong>
              <span>${formatBytes(file.size)}</span>
            </div>
          </div>
        `).join('')}
      </div>
      ${hasSelection ? `
        <div class="file-list__bulk-actions">
          <div class="file-list__bulk-summary">
            <span>${escapeHtml(`${selectedFilesForDelete.length} file${selectedFilesForDelete.length === 1 ? '' : 's'} selected`)}</span>
          </div>
          <button type="button" class="button button--danger button--small" data-action="delete-selected-files">
            Delete selected
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderGraphToolbar() {
  const canUseGraphActions = Boolean(state.graph);
  const selectedFile = getSelectedStartFile();
  const fileNameBase = toSlug(selectedFile ? selectedFile.originalName : state.selectedStartProjectFileName || 'ga-project-flow');
  const zoomPercent = state.graphViewport && state.graphViewport.zoom
    ? `${Math.round(state.graphViewport.zoom * 100)}%`
    : 'Auto';

  return `
    <div class="graph-toolbar">
      <div class="graph-toolbar__section graph-toolbar__search">
        <label class="field field--search">
          <span>Search graph</span>
          <input id="graph-search-input" type="text" value="${escapeHtml(state.graphSearchTerm)}" placeholder="Search nodes, status, or text" ${disabledAttr(!canUseGraphActions)} />
        </label>
        <label class="checkbox-row checkbox-row--compact">
          <input id="graph-filter-only" type="checkbox" ${checkedAttr(state.graphFilterOnly)} ${disabledAttr(!canUseGraphActions)} />
          <span>Show matches only</span>
        </label>
      </div>
      <div class="graph-toolbar__section graph-toolbar__zoom">
        <span class="pill pill--muted">Zoom ${escapeHtml(zoomPercent)}</span>
        <button type="button" class="button button--ghost button--small" data-action="graph-zoom-out" ${disabledAttr(!canUseGraphActions)} aria-label="Zoom out">−</button>
        <button type="button" class="button button--ghost button--small" data-action="graph-zoom-in" ${disabledAttr(!canUseGraphActions)} aria-label="Zoom in">+</button>
        <button type="button" class="button button--ghost button--small" data-action="graph-fit-view" ${disabledAttr(!canUseGraphActions)}>Fit view</button>
        <button type="button" class="button button--ghost button--small" data-action="graph-reset-layout" ${disabledAttr(!canUseGraphActions)}>Reset layout</button>
      </div>
      <div class="graph-toolbar__section graph-toolbar__export">
        <button type="button" class="button button--ghost button--small" data-action="graph-export-svg" data-export-name="${escapeHtml(fileNameBase)}" ${disabledAttr(!canUseGraphActions)}>Export SVG</button>
        <button type="button" class="button button--ghost button--small" data-action="graph-export-png" data-export-name="${escapeHtml(fileNameBase)}" ${disabledAttr(!canUseGraphActions)}>Export PNG</button>
        <button type="button" class="button button--ghost button--small" data-action="graph-export-pdf" data-export-name="${escapeHtml(fileNameBase)}" ${disabledAttr(!canUseGraphActions)}>Export PDF</button>
      </div>
    </div>
  `;
}

function renderDashboardView() {
  const user = currentUser();
  const selectedFolder = getSelectedWorkFolder();
  const graphMetrics = getGraphMetrics(state.graph, state.graphSearchTerm, state.graphFilterOnly);
  const canProcess = Boolean(state.selectedWorkFolderId && state.selectedStartProjectFileName);
  const nodeMetric = (state.graphSearchTerm || state.graphFilterOnly)
    ? `${graphMetrics.visibleNodes} / ${graphMetrics.totalNodes}`
    : `${graphMetrics.totalNodes}`;
  const edgeMetric = (state.graphSearchTerm || state.graphFilterOnly)
    ? `${graphMetrics.visibleEdges} / ${graphMetrics.totalEdges}`
    : `${graphMetrics.totalEdges}`;

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

      <div class="workspace-layout ${state.sidebarCollapsed ? 'is-sidebar-collapsed' : ''}" style="--workspace-sidebar-width: ${clampSidebarWidth(state.sidebarWidth)}px;">
        <aside class="sidebar">
          <button type="button" class="sidebar__toggle" data-action="toggle-sidebar" aria-label="${state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}">
            <span class="sidebar__toggle-icon">${state.sidebarCollapsed ? '→' : '←'}</span>
          </button>
          <section class="panel sidebar-section">
            <div class="panel-header">
              <div>
                <h2>Work folders</h2>
                <p>Create a folder, then upload related project files into it.</p>
              </div>
              <button type="button" class="button button--ghost button--danger button--small" data-action="delete-folder" ${disabledAttr(!state.selectedWorkFolderId)}>
                Delete folder
              </button>
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
                <p>All uploads are stored encrypted at rest.</p>
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
            <div class="form-stack">
              <button type="button" class="button button--ghost" data-action="show-xml-paste-modal" ${disabledAttr(!state.selectedWorkFolderId)}>
                Paste XML content
              </button>
            </div>
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

        <div class="workspace-resizer" data-resize="workspace-sidebar" role="separator" aria-orientation="vertical" aria-label="Resize left sidebar" tabindex="0"></div>

        <main class="main-panel">
          <section class="panel graph-panel">
            <div class="graph-panel__header">
              <div class="graph-panel__title">
                <h2>Project flow</h2>
                <p>${selectedFolder ? `Folder: ${escapeHtml(selectedFolder.name)}` : 'Choose a work folder to begin.'}</p>
              </div>
              <div class="graph-panel__stats">
                <div class="stat-chip">
                  <span>Start project</span>
                  <strong>${escapeHtml(state.selectedStartProjectFileName || 'Not selected')}</strong>
                </div>
                <div class="stat-chip">
                  <span>Nodes</span>
                  <strong>${escapeHtml(nodeMetric)}</strong>
                </div>
                <div class="stat-chip">
                  <span>Connections</span>
                  <strong>${escapeHtml(edgeMetric)}</strong>
                </div>
              </div>
            </div>
            ${renderGraphToolbar()}
            <div class="graph-hint">
              Drag cards to rearrange the layout. Drag near a canvas edge to auto-pan, drag empty space to pan, and use your mouse wheel to zoom.
            </div>
            <div id="graph-container" class="graph-container"></div>
          </section>
        </main>
      </div>

      ${state.showAdmin ? renderAdminModal() : ''}
      ${state.showPasswordModal ? renderPasswordModal() : ''}
      ${state.showXmlPasteModal ? renderXmlPasteModal() : ''}
      ${renderBusyOverlay()}
    </div>
  `;
}

function renderXmlPasteModal() {
  return `
    <div class="modal-backdrop">
      <div class="modal modal--large">
        <div class="modal-header">
          <div>
            <h2>Paste XML content</h2>
            <p>Paste your XML content below (maximum 1MB). The content will be saved as a new file in your selected work folder.</p>
          </div>
          <button type="button" class="button button--ghost" data-action="close-xml-paste-modal">Close</button>
        </div>
        <form class="form-stack" data-form="xml-paste">
          <label class="field">
            <span>File name</span>
            <input name="fileName" type="text" placeholder="Enter file name (e.g., project.xml)" required title="Please enter a valid XML file name ending with .xml" />
          </label>
          <label class="field">
            <span>XML content</span>
            <textarea name="xmlContent" rows="20" placeholder="Paste your XML content here..." required maxlength="1048576"></textarea>
            <small>Maximum size: 1MB (1,048,576 characters)</small>
          </label>
          <div class="form-actions">
            <button type="button" class="button button--ghost" data-action="close-xml-paste-modal">Cancel</button>
            <button type="submit" class="button button--primary">Save XML file</button>
          </div>
        </form>
      </div>
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

function mountCurrentGraph() {
  destroyGraphController();

  const graphContainer = document.getElementById('graph-container');

  if (!graphContainer) {
    return;
  }

  graphController = mountGraph(graphContainer, {
    graph: state.graph,
    theme: state.theme,
    searchTerm: state.graphSearchTerm,
    filterOnly: state.graphFilterOnly,
    viewport: state.graphViewport,
    onNodePositionChange(nodeId, position) {
      updateGraphNodePosition(nodeId, position);
    },
    onViewportChange(viewport) {
      updateGraphViewport(viewport);
    },
  });
}

function renderApp() {
  setTheme(state.theme);

  if (!state.initialized) {
    appRoot.innerHTML = renderLoadingView();
    destroyGraphController();
    return;
  }

  appRoot.innerHTML = isAuthenticated() ? renderDashboardView() : renderAuthView();

  if (isAuthenticated()) {
    mountCurrentGraph();
  } else {
    destroyGraphController();
  }
}

function handleApiError(error) {
  if (error && error.status === 401) {
    setSession(null);
    state.authMode = 'login';
    state.initialized = true;
    setFlash('error', 'Your session is no longer valid. Please sign in again.');
    renderApp();
    return;
  }

  if (error && error.status === 403 && error.payload && error.payload.code === 'PASSWORD_CHANGE_REQUIRED') {
    if (currentUser()) {
      state.session.user.mustChangePassword = true;
    }
    state.showPasswordModal = true;
    setFlash('error', error.message || 'You must change your password before continuing.');
    renderApp();
    return;
  }

  setFlash('error', error && error.message ? error.message : 'An unexpected error occurred.');
  renderApp();
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
    destroyGraphController();
    state.graph = null;
    state.graphSearchTerm = '';
    state.graphFilterOnly = false;
    state.graphViewport = null;
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
    destroyGraphController();
    state.files = [];
    state.selectedStartProjectFileName = '';
    state.graph = null;
    state.graphViewport = null;
    state.graphSearchTerm = '';
    state.graphFilterOnly = false;
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
  state.graph = applyStoredGraphState(payload.graph);

  if (showSuccessMessage) {
    setFlash('success', `Processed ${state.selectedStartProjectFileName} successfully.`);
  }
}

async function exportGraph(actionName, baseName) {
  if (!graphController) {
    return;
  }

  try {
    if (actionName === 'graph-export-svg') {
      graphController.exportSvg(`${baseName}.svg`);
      return;
    }

    if (actionName === 'graph-export-png') {
      await graphController.exportPng(`${baseName}.png`);
      return;
    }

    if (actionName === 'graph-export-pdf') {
      await graphController.exportPdf(`${baseName}.pdf`);
    }
  } catch (error) {
    setFlash('error', error.message || 'Unable to export the graph.');
    renderApp();
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

  if (action === 'toggle-sidebar') {
    toggleSidebarCollapsed();
    renderApp();
    return;
  }

  if (action === 'show-xml-paste-modal') {
    state.showXmlPasteModal = true;
    renderApp();
    return;
  }

  if (action === 'close-xml-paste-modal') {
    state.showXmlPasteModal = false;
    renderApp();
    return;
  }

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
    return;
  }

  if (action === 'delete-folder') {
    const selectedFolder = getSelectedWorkFolder();

    if (!selectedFolder || !window.confirm(`Delete work folder ${selectedFolder.name} and all of its uploaded XML files?`)) {
      return;
    }

    runAction('Deleting work folder…', async () => {
      clearGraphLayout(getGraphContext());
      const payload = await api.deleteWorkFolder(selectedFolder.id, state.csrfToken);
      state.workFolders = Array.isArray(payload.workFolders) ? payload.workFolders : [];
      state.selectedWorkFolderId = payload.defaultWorkFolderId || null;
      state.files = [];
      state.selectedStartProjectFileName = '';
      state.graph = null;
      state.graphSearchTerm = '';
      state.graphFilterOnly = false;
      state.graphViewport = null;

      if (state.selectedWorkFolderId) {
        await refreshFiles(state.selectedWorkFolderId, { autoProcess: true });
      }

      setFlash('success', `Deleted work folder ${selectedFolder.name}.`);
    });
    return;
  }

  if (action === 'delete-file') {
    const fileId = Number(actionButton.getAttribute('data-file-id'));
    const fileName = actionButton.getAttribute('data-file-name') || 'this file';

    if (!state.selectedWorkFolderId || !window.confirm(`Delete ${fileName}?`)) {
      return;
    }

    runAction('Deleting file…', async () => {
      const wasSelectedStartProject = fileName === state.selectedStartProjectFileName;
      const payload = await api.deleteFile(state.selectedWorkFolderId, fileId, state.csrfToken);
      applyFilesPayload(payload, true);

      if (!wasSelectedStartProject && state.selectedStartProjectFileName) {
        await processCurrentProject(false);
      }

      setFlash('success', `Deleted ${payload.deletedFileName || fileName}.`);
    });
    return;
  }

  if (action === 'graph-zoom-in') {
    graphController?.zoomIn();
    return;
  }

  if (action === 'graph-zoom-out') {
    graphController?.zoomOut();
    return;
  }

  if (action === 'graph-fit-view') {
    graphController?.fitToView();
    return;
  }

  if (action === 'graph-reset-layout') {
    if (!state.graph || !window.confirm('Reset the saved card arrangement for this start project?')) {
      return;
    }

    runAction('Resetting graph layout…', async () => {
      clearGraphLayout(getGraphContext());
      state.graphViewport = null;
      await processCurrentProject(false);
      setFlash('success', 'Graph layout reset.');
    });
    return;
  }

  if (action === 'graph-export-svg' || action === 'graph-export-png' || action === 'graph-export-pdf') {
    const fileNameBase = actionButton.getAttribute('data-export-name') || toSlug(state.selectedStartProjectFileName);
    exportGraph(action, fileNameBase);
  }

  if (action === 'toggle-all-files') {
    if (event.target.checked) {
      selectAllFiles();
    } else {
      deselectAllFiles();
    }
    renderApp();
    return;
  }

  if (action === 'toggle-file-selection') {
    const fileId = Number(actionButton.getAttribute('data-file-id'));
    toggleFileSelection(fileId);
    renderApp();
    return;
  }

  if (action === 'delete-selected-files') {
    const selectedFiles = getSelectedFilesForDelete();
    if (!selectedFiles.length) {
      return;
    }
    
    const fileNames = selectedFiles.map((file) => file.originalName).join(', ');
    if (!confirm(`Are you sure you want to delete these ${selectedFiles.length} file(s)?\n\n${fileNames}`)) {
      return;
    }

    runAction('Deleting files…', async () => {
      for (const file of selectedFiles) {
        await api.deleteFile(state.selectedWorkFolderId, file.id, state.csrfToken);
      }
      await refreshFiles(state.selectedWorkFolderId, { autoProcess: false });
      deselectAllFiles();
      setFlash('success', `Deleted ${selectedFiles.length} file(s).`);
      renderApp();
    });
    return;
  }
});

appRoot.addEventListener('pointerdown', (event) => {
  const resizeHandle = event.target.closest('[data-resize="workspace-sidebar"]');

  if (!resizeHandle) {
    return;
  }

  startSidebarResize(event);
});

appRoot.addEventListener('keydown', (event) => {
  const resizeHandle = event.target.closest('[data-resize="workspace-sidebar"]');

  if (!resizeHandle) {
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    nudgeSidebarWidth(-1);
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    nudgeSidebarWidth(1);
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
        state.graphViewport = null;
        state.graphSearchTerm = '';
        state.graphFilterOnly = false;
        return;
      }

      await refreshFiles(state.selectedWorkFolderId, { autoProcess: false });
    });
    return;
  }

  if (target.id === 'start-project-select') {
    state.selectedStartProjectFileName = target.value || '';
    state.graph = null;
    state.graphViewport = null;
    state.graphSearchTerm = '';
    state.graphFilterOnly = false;
    renderApp();
    return;
  }

  if (target.id === 'graph-filter-only') {
    state.graphFilterOnly = Boolean(target.checked);
    renderApp();
  }
});

appRoot.addEventListener('input', (event) => {
  const target = event.target;

  if (target.id === 'graph-search-input') {
    state.graphSearchTerm = target.value || '';
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

  if (formType === 'xml-paste') {
    const fileName = formData.get('fileName').trim();
    const xmlContent = formData.get('xmlContent').trim();

    if (!fileName || !xmlContent) {
      setFlash('error', 'Please provide both a file name and XML content.');
      renderApp();
      return;
    }

    // Client-side size validation
    const encoder = new TextEncoder();
    const byteLength = encoder.encode(xmlContent).length;
    if (byteLength > 1048576) {
      setFlash('error', 'XML content exceeds maximum size of 1MB.');
      renderApp();
      return;
    }

    runAction('Saving XML file…', async () => {
      const payload = await api.pasteXml(state.selectedWorkFolderId, fileName, xmlContent, state.csrfToken);
      applyFilesPayload(payload, true);
      state.showXmlPasteModal = false;
      form.reset();
      setFlash('success', `Saved ${fileName} successfully.`);
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
