const GRAPH_LAYOUT_STORAGE_KEY = 'ga-graph-layouts';
const GRAPH_LAYOUT_STORAGE_VERSION = 2;

function createEmptyEntry() {
  return {
    positions: {},
    viewport: null,
    fileReplacements: {},
  };
}

function sanitizeFileReplacements(fileReplacements) {
  if (!fileReplacements || typeof fileReplacements !== 'object' || Array.isArray(fileReplacements)) {
    return {};
  }

  return Object.fromEntries(Object.entries(fileReplacements)
    .map(([missingFileName, replacementFileName]) => [String(missingFileName || '').trim(), String(replacementFileName || '').trim()])
    .filter(([missingFileName, replacementFileName]) => missingFileName && replacementFileName));
}

function readEntry(key) {
  if (!key) {
    return createEmptyEntry();
  }

  const entry = readStore()[key];
  const viewport = entry && entry.viewport && Number.isFinite(entry.viewport.x) && Number.isFinite(entry.viewport.y) && Number.isFinite(entry.viewport.zoom)
    ? {
      x: Number(entry.viewport.x),
      y: Number(entry.viewport.y),
      zoom: Number(entry.viewport.zoom),
    }
    : null;

  return {
    positions: entry && entry.positions && typeof entry.positions === 'object' ? entry.positions : {},
    viewport,
    fileReplacements: sanitizeFileReplacements(entry && entry.fileReplacements),
  };
}

function canUseStorage() {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  } catch (error) {
    return false;
  }
}

function readStore() {
  if (!canUseStorage()) {
    return {};
  }

  try {
    return JSON.parse(window.localStorage.getItem(GRAPH_LAYOUT_STORAGE_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function writeStore(store) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(GRAPH_LAYOUT_STORAGE_KEY, JSON.stringify(store));
}

export function cloneGraph(graph) {
  return graph ? JSON.parse(JSON.stringify(graph)) : null;
}

export function buildGraphLayoutKey(context = {}) {
  const userId = Number(context.userId || 0);
  const workFolderId = Number(context.workFolderId || 0);
  const startProjectFileName = String(context.startProjectFileName || '').trim().toLowerCase();

  if (!userId || !workFolderId || !startProjectFileName) {
    return '';
  }

  return `${GRAPH_LAYOUT_STORAGE_VERSION}:${userId}:${workFolderId}:${startProjectFileName}`;
}

export function getSavedGraphLayout(context) {
  const key = buildGraphLayoutKey(context);
  const entry = readEntry(key);

  return {
    positions: entry.positions,
    viewport: entry.viewport,
  };
}

export function getSavedFileReplacements(context) {
  const key = buildGraphLayoutKey(context);
  return readEntry(key).fileReplacements;
}

export function applySavedGraphLayout(graph, context) {
  if (!graph || !Array.isArray(graph.nodes)) {
    return graph;
  }

  const nextGraph = cloneGraph(graph);
  const savedLayout = getSavedGraphLayout(context);

  for (const node of nextGraph.nodes) {
    const savedPosition = savedLayout.positions[node.id];

    if (savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y)) {
      node.position = {
        x: savedPosition.x,
        y: savedPosition.y,
      };
    }
  }

  return nextGraph;
}

export function saveGraphNodePosition(context, nodeId, position) {
  const key = buildGraphLayoutKey(context);

  if (!key || !nodeId || !position) {
    return;
  }

  const store = readStore();
  const nextEntry = readEntry(key);
  nextEntry.positions[nodeId] = {
    x: Number(position.x || 0),
    y: Number(position.y || 0),
  };
  store[key] = nextEntry;
  writeStore(store);
}

export function saveGraphViewport(context, viewport) {
  const key = buildGraphLayoutKey(context);

  if (!key || !viewport) {
    return;
  }

  const store = readStore();
  const nextEntry = readEntry(key);
  nextEntry.viewport = {
    x: Number(viewport.x || 0),
    y: Number(viewport.y || 0),
    zoom: Number(viewport.zoom || 1),
  };
  store[key] = nextEntry;
  writeStore(store);
}

export function saveFileReplacements(context, fileReplacements) {
  const key = buildGraphLayoutKey(context);

  if (!key) {
    return;
  }

  const store = readStore();
  const nextEntry = readEntry(key);
  nextEntry.fileReplacements = sanitizeFileReplacements(fileReplacements);

  if (!Object.keys(nextEntry.positions).length && !nextEntry.viewport && !Object.keys(nextEntry.fileReplacements).length) {
    delete store[key];
  } else {
    store[key] = nextEntry;
  }

  writeStore(store);
}

export function clearGraphLayout(context) {
  const key = buildGraphLayoutKey(context);

  if (!key) {
    return;
  }

  const store = readStore();
  const entry = readEntry(key);

  if (!Object.keys(entry.fileReplacements).length) {
    delete store[key];
    writeStore(store);
    return;
  }

  store[key] = {
    ...createEmptyEntry(),
    fileReplacements: entry.fileReplacements,
  };
  writeStore(store);
}

export function clearSavedGraphState(context) {
  const key = buildGraphLayoutKey(context);

  if (!key) {
    return;
  }

  const store = readStore();
  delete store[key];
  writeStore(store);
}
