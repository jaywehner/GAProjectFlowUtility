const GRAPH_LAYOUT_STORAGE_KEY = 'ga-graph-layouts';
const GRAPH_LAYOUT_STORAGE_VERSION = 2;

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

  if (!key) {
    return {
      positions: {},
      viewport: null,
    };
  }

  const entry = readStore()[key];

  return {
    positions: entry && entry.positions ? entry.positions : {},
    viewport: entry && entry.viewport ? entry.viewport : null,
  };
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
  const nextEntry = store[key] || { positions: {}, viewport: null };
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
  const nextEntry = store[key] || { positions: {}, viewport: null };
  nextEntry.viewport = {
    x: Number(viewport.x || 0),
    y: Number(viewport.y || 0),
    zoom: Number(viewport.zoom || 1),
  };
  store[key] = nextEntry;
  writeStore(store);
}

export function clearGraphLayout(context) {
  const key = buildGraphLayoutKey(context);

  if (!key) {
    return;
  }

  const store = readStore();
  delete store[key];
  writeStore(store);
}
