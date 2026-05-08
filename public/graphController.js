import { downloadBlob, svgToPdfBlob, svgToPngBlob } from './exportUtils.js';

const CARD_WIDTH = 272;
const CARD_HEIGHT = 156;
const GRAPH_PADDING = 120;
const FIT_PADDING = 56;
const INITIAL_FIT_MIN_ZOOM = 0.6;
const INITIAL_FIT_MAX_ZOOM = 1.15;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.6;
const INPUT_PORT_RADIUS = 10;
const OUTPUT_PORT_RADIUS = 9;
const PORT_SPACING = 24;
const DRAG_AUTOPAN_THRESHOLD = 96;
const DRAG_AUTOPAN_MAX_STEP = 26;
const OUTPUT_COLORS = [
  '#ef4444',
  '#22c55e',
  '#3b82f6',
  '#eab308',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#14b8a6',
  '#84cc16',
  '#0ea5e9',
  '#6366f1',
  '#10b981',
  '#64748b',
  '#111827',
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSearchTerm(value) {
  return String(value || '').trim().toLowerCase();
}

function nodeMatchesSearch(node, searchTerm) {
  if (!searchTerm) {
    return true;
  }

  const haystack = [node.title, node.subtitle, node.body, node.type, node.status]
    .join(' ')
    .toLowerCase();

  return haystack.includes(searchTerm);
}

function resolveGraphVisibility(graph, searchTerm, filterOnly) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return {
      visibleNodes: [],
      visibleEdges: [],
      matchedNodeIds: new Set(),
      visibleNodeIds: new Set(),
    };
  }

  const normalizedTerm = normalizeSearchTerm(searchTerm);
  const matchedNodeIds = new Set(
    normalizedTerm
      ? graph.nodes.filter((node) => nodeMatchesSearch(node, normalizedTerm)).map((node) => node.id)
      : graph.nodes.map((node) => node.id)
  );

  const visibleNodes = graph.nodes.filter((node) => !normalizedTerm || !filterOnly || matchedNodeIds.has(node.id));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = Array.isArray(graph.edges)
    ? graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    : [];

  return {
    visibleNodes,
    visibleEdges,
    matchedNodeIds,
    visibleNodeIds,
  };
}

function getNodeBounds(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: CARD_WIDTH,
      maxY: CARD_HEIGHT,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    };
  }

  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + CARD_WIDTH));
  const maxY = Math.max(...nodes.map((node) => node.position.y + CARD_HEIGHT));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getOrderedNodeEdges(graph, nodeId, direction) {
  if (!Array.isArray(graph?.edges)) {
    return [];
  }

  return graph.edges
    .map((edge, index) => ({ edge, index }))
    .filter((item) => item.edge[direction] === nodeId)
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.edge.order) ? left.edge.order : left.index;
      const rightOrder = Number.isFinite(right.edge.order) ? right.edge.order : right.index;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.index - right.index;
    })
    .map((item) => item.edge);
}

function getOutputPortIndex(edge, graph) {
  const sourceEdges = getOrderedNodeEdges(graph, edge.source, 'source');
  return Math.max(0, sourceEdges.findIndex((item) => item.id === edge.id));
}

function getInputPortPoint(node) {
  return {
    x: node.position.x,
    y: node.position.y + (CARD_HEIGHT / 2),
  };
}

function getOutputPortPoint(node, portIndex, totalPorts) {
  const portCount = Math.max(1, totalPorts || 1);
  const centerOffset = ((portCount - 1) * PORT_SPACING) / 2;

  return {
    x: node.position.x + CARD_WIDTH,
    y: node.position.y + (CARD_HEIGHT / 2) - centerOffset + (portIndex * PORT_SPACING),
  };
}

function resolveOutputColor(index) {
  if (index < OUTPUT_COLORS.length) {
    return OUTPUT_COLORS[index];
  }

  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 72% 48%)`;
}

function getEdgeColor(edge, graph) {
  return resolveOutputColor(getOutputPortIndex(edge, graph));
}

function getAutoPanVelocity(localPosition, axisSize) {
  if (localPosition < DRAG_AUTOPAN_THRESHOLD) {
    return ((DRAG_AUTOPAN_THRESHOLD - localPosition) / DRAG_AUTOPAN_THRESHOLD) * DRAG_AUTOPAN_MAX_STEP;
  }

  const distanceToFarEdge = axisSize - localPosition;

  if (distanceToFarEdge < DRAG_AUTOPAN_THRESHOLD) {
    return -((DRAG_AUTOPAN_THRESHOLD - distanceToFarEdge) / DRAG_AUTOPAN_THRESHOLD) * DRAG_AUTOPAN_MAX_STEP;
  }

  return 0;
}

function truncateText(value, maxLength) {
  const text = String(value || '');

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function wrapText(value, maxLineLength, maxLines) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines = [];

  for (const word of words) {
    const currentLine = lines[lines.length - 1] || '';
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (!currentLine) {
      lines.push(candidate);
    } else if (candidate.length <= maxLineLength) {
      lines[lines.length - 1] = candidate;
    } else {
      lines.push(word);
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (words.join(' ').length > lines.join(' ').length && lines.length > 0) {
    lines[lines.length - 1] = truncateText(lines[lines.length - 1], Math.max(1, maxLineLength));
  }

  return lines.length ? lines : [''];
}

function buildInputPortPath(node) {
  const point = getInputPortPoint(node);
  return `M ${point.x} ${point.y - INPUT_PORT_RADIUS} A ${INPUT_PORT_RADIUS} ${INPUT_PORT_RADIUS} 0 0 0 ${point.x} ${point.y + INPUT_PORT_RADIUS} Z`;
}

function buildOutputPortPath(point) {
  return `M ${point.x} ${point.y - OUTPUT_PORT_RADIUS} A ${OUTPUT_PORT_RADIUS} ${OUTPUT_PORT_RADIUS} 0 0 1 ${point.x} ${point.y + OUTPUT_PORT_RADIUS} Z`;
}

function getPathPointBeforeEnd(start, end) {
  const middleX = start.x + ((end.x - start.x) / 2);
  const radius = Math.max(0, Math.min(18, Math.abs(end.y - start.y) / 2, Math.abs(middleX - start.x) / 2));

  if (radius === 0) {
    return start;
  }

  return {
    x: middleX + ((end.x > start.x ? 1 : -1) * radius),
    y: end.y,
  };
}

function buildArrowPath(end, beforeEnd) {
  const size = 7;
  const angle = Math.atan2(end.y - beforeEnd.y, end.x - beforeEnd.x);
  const baseX = end.x - (Math.cos(angle) * size);
  const baseY = end.y - (Math.sin(angle) * size);
  const perpendicularX = Math.cos(angle + (Math.PI / 2)) * (size * 0.55);
  const perpendicularY = Math.sin(angle + (Math.PI / 2)) * (size * 0.55);

  return [
    `M ${end.x} ${end.y}`,
    `L ${baseX + perpendicularX} ${baseY + perpendicularY}`,
    `L ${baseX - perpendicularX} ${baseY - perpendicularY}`,
    'Z',
  ].join(' ');
}

function buildRoundedStepPath(start, end) {
  const middleX = start.x + ((end.x - start.x) / 2);
  const directionY = Math.sign(end.y - start.y) || 1;
  const radius = Math.max(0, Math.min(18, Math.abs(end.y - start.y) / 2, Math.abs(middleX - start.x) / 2));

  if (radius === 0) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  return [
    `M ${start.x} ${start.y}`,
    `L ${middleX - radius} ${start.y}`,
    `Q ${middleX} ${start.y} ${middleX} ${start.y + (directionY * radius)}`,
    `L ${middleX} ${end.y - (directionY * radius)}`,
    `Q ${middleX} ${end.y} ${middleX + ((end.x > start.x ? 1 : -1) * radius)} ${end.y}`,
    `L ${end.x} ${end.y}`,
  ].join(' ');
}

function buildEdgeGeometry(edge, sourceNode, targetNode, graph) {
  const sourceEdges = getOrderedNodeEdges(graph, edge.source, 'source');
  const outputIndex = getOutputPortIndex(edge, graph);
  const sourcePort = getOutputPortPoint(sourceNode, outputIndex, sourceEdges.length);
  const targetPort = getInputPortPoint(targetNode);
  const start = {
    x: sourcePort.x + OUTPUT_PORT_RADIUS,
    y: sourcePort.y,
  };
  const end = {
    x: targetPort.x - INPUT_PORT_RADIUS,
    y: targetPort.y,
  };
  const color = getEdgeColor(edge, graph);
  const beforeEnd = getPathPointBeforeEnd(start, end);

  return {
    start,
    end,
    color,
    outputIndex,
    arrowPath: buildArrowPath(end, beforeEnd),
    label: {
      x: (start.x + end.x) / 2,
      y: ((start.y + end.y) / 2) - 10,
    },
    path: buildRoundedStepPath(start, end),
  };
}

function getScreenPointFromClient(svgElement, viewport, clientX, clientY) {
  const rect = svgElement.getBoundingClientRect();
  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - viewport.y) / viewport.zoom,
  };
}

function getExportPalette(theme) {
  if (theme === 'dark') {
    return {
      background: '#0f172a',
      surface: '#111c33',
      surfaceSoft: '#1d2a44',
      text: '#e2e8f0',
      textSoft: '#94a3b8',
      primary: '#8b9bff',
      projectBorder: '#3b82f6',
      moduleBorder: '#a855f7',
      missingBorder: '#fb7185',
      edge: '#8b9bff',
      edgeText: '#cbd5e1',
      muted: '#41506b',
      match: '#1d4ed8',
      inputPort: '#64748b',
    };
  }

  return {
    background: '#f8fafc',
    surface: '#ffffff',
    surfaceSoft: '#eef2ff',
    text: '#0f172a',
    textSoft: '#475569',
    primary: '#4f46e5',
    projectBorder: '#2563eb',
    moduleBorder: '#9333ea',
    missingBorder: '#e11d48',
    edge: '#4f46e5',
    edgeText: '#334155',
    muted: '#cbd5e1',
    match: '#bfdbfe',
    inputPort: '#64748b',
  };
}

function buildNodeCardMarkup(node, options = {}) {
  const classes = [
    'graph-node-card',
    escapeHtml(node.type),
    escapeHtml(node.status),
  ];

  if (options.dimmed) {
    classes.push('graph-node-card--dimmed');
  }

  if (options.matched) {
    classes.push('graph-node-card--matched');
  }

  return `
    <div xmlns="http://www.w3.org/1999/xhtml" class="${classes.join(' ')}" data-node-id="${escapeHtml(node.id)}">
      <div class="graph-node-card__header">
        <span class="graph-node-card__type">${escapeHtml(node.type)}</span>
        <span class="graph-node-card__status">${escapeHtml(node.status)}</span>
      </div>
      <h3>${escapeHtml(node.title)}</h3>
      <p class="graph-node-card__subtitle">${escapeHtml(node.subtitle)}</p>
      <p class="graph-node-card__body">${escapeHtml(node.body)}</p>
    </div>
  `;
}

function buildExportStyles(theme) {
  const palette = getExportPalette(theme);
  return `
    .graph-export-root { font-family: Inter, Segoe UI, Arial, sans-serif; }
    .graph-export-edge { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .graph-export-edge--dimmed { opacity: 0.18; }
    .graph-export-label { fill: ${palette.edgeText}; font-size: 12px; font-weight: 700; text-anchor: middle; paint-order: stroke; stroke: ${palette.background}; stroke-width: 6px; stroke-linejoin: round; }
    .graph-export-card { fill: ${palette.surface}; stroke: ${palette.muted}; stroke-width: 1.3; }
    .graph-export-card.project { stroke: ${palette.projectBorder}; }
    .graph-export-card.module { stroke: ${palette.moduleBorder}; }
    .graph-export-card.missing { fill: ${palette.surfaceSoft}; stroke: ${palette.missingBorder}; }
    .graph-export-card--matched { stroke-width: 3; }
    .graph-export-card--dimmed, .graph-export-port--dimmed { opacity: 0.34; }
    .graph-export-type { fill: ${palette.primary}; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .graph-export-status { fill: ${palette.textSoft}; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; text-anchor: end; }
    .graph-export-title { fill: ${palette.text}; font-size: 18px; font-weight: 800; }
    .graph-export-muted { fill: ${palette.textSoft}; font-size: 13px; }
    .graph-export-input-port { fill: ${palette.inputPort}; stroke: ${palette.background}; stroke-width: 2; }
    .graph-export-output-port { stroke: ${palette.background}; stroke-width: 2; }
  `;
}

function buildExportNodeMarkup(node, graph, options = {}) {
  const palette = getExportPalette(options.theme || 'light');
  const incomingEdges = getOrderedNodeEdges(graph, node.id, 'target');
  const outgoingEdges = getOrderedNodeEdges(graph, node.id, 'source');
  const cardClasses = [
    'graph-export-card',
    escapeHtml(node.type),
    escapeHtml(node.status),
  ];

  if (options.matched) {
    cardClasses.push('graph-export-card--matched');
  }

  if (options.dimmed) {
    cardClasses.push('graph-export-card--dimmed');
  }

  const titleLines = wrapText(node.title, 23, 2);
  const subtitle = truncateText(node.subtitle, 32);
  const bodyLines = wrapText(node.body, 34, 2);
  const inputPortMarkup = incomingEdges.length
    ? `<path class="graph-export-input-port ${options.dimmed ? 'graph-export-port--dimmed' : ''}" d="${buildInputPortPath(node)}"></path>`
    : '';
  const outputPortMarkup = outgoingEdges.map((edge, index) => {
    const point = getOutputPortPoint(node, index, outgoingEdges.length);
    const color = getEdgeColor(edge, graph);
    return `<path class="graph-export-output-port ${options.dimmed ? 'graph-export-port--dimmed' : ''}" d="${buildOutputPortPath(point)}" fill="${color}"></path>`;
  }).join('');

  return `
    <g data-node-id="${escapeHtml(node.id)}">
      <rect class="${cardClasses.join(' ')}" x="${node.position.x}" y="${node.position.y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="18" ry="18"></rect>
      ${options.matched ? `<rect x="${node.position.x + 3}" y="${node.position.y + 3}" width="${CARD_WIDTH - 6}" height="${CARD_HEIGHT - 6}" rx="15" ry="15" fill="none" stroke="${palette.match}" stroke-width="2"></rect>` : ''}
      ${inputPortMarkup}
      ${outputPortMarkup}
      <text class="graph-export-type" x="${node.position.x + 16}" y="${node.position.y + 28}">${escapeHtml(node.type)}</text>
      <text class="graph-export-status" x="${node.position.x + CARD_WIDTH - 16}" y="${node.position.y + 28}">${escapeHtml(node.status)}</text>
      ${titleLines.map((line, index) => `<text class="graph-export-title" x="${node.position.x + 16}" y="${node.position.y + 60 + (index * 21)}">${escapeHtml(line)}</text>`).join('')}
      <text class="graph-export-muted" x="${node.position.x + 16}" y="${node.position.y + 108}">${escapeHtml(subtitle)}</text>
      ${bodyLines.map((line, index) => `<text class="graph-export-muted" x="${node.position.x + 16}" y="${node.position.y + 130 + (index * 16)}">${escapeHtml(line)}</text>`).join('')}
    </g>
  `;
}

function getExportSize(graph, searchTerm, filterOnly) {
  const visibility = resolveGraphVisibility(graph, searchTerm, filterOnly);
  const bounds = getNodeBounds(visibility.visibleNodes.length ? visibility.visibleNodes : (graph?.nodes || []));

  return {
    width: Math.ceil(bounds.width + (GRAPH_PADDING * 2)),
    height: Math.ceil(bounds.height + (GRAPH_PADDING * 2)),
    originX: bounds.minX - GRAPH_PADDING,
    originY: bounds.minY - GRAPH_PADDING,
  };
}

function buildExportSvgMarkup(graph, searchTerm, filterOnly, theme) {
  const visibility = resolveGraphVisibility(graph, searchTerm, filterOnly);
  const nodesToRender = visibility.visibleNodes;
  const exportSize = getExportSize(graph, searchTerm, filterOnly);
  const palette = getExportPalette(theme);
  const edgeMarkup = visibility.visibleEdges.map((edge) => {
    const sourceNode = graph.nodes.find((node) => node.id === edge.source);
    const targetNode = graph.nodes.find((node) => node.id === edge.target);

    if (!sourceNode || !targetNode) {
      return '';
    }

    const geometry = buildEdgeGeometry(edge, sourceNode, targetNode, graph);
    const edgeDimmed = searchTerm && !filterOnly && !(visibility.matchedNodeIds.has(edge.source) || visibility.matchedNodeIds.has(edge.target));

    return `
      <g>
        <path class="graph-export-edge ${edgeDimmed ? 'graph-export-edge--dimmed' : ''}" d="${geometry.path}" stroke="${geometry.color}"></path>
        <path class="graph-export-arrow ${edgeDimmed ? 'graph-export-edge--dimmed' : ''}" d="${geometry.arrowPath}" fill="${geometry.color}"></path>
        <text class="graph-export-label" x="${geometry.label.x}" y="${geometry.label.y}">${escapeHtml(edge.label || '')}</text>
      </g>
    `;
  }).join('');

  const nodeMarkup = nodesToRender.map((node) => {
    const matched = searchTerm ? visibility.matchedNodeIds.has(node.id) : false;
    const dimmed = searchTerm && !filterOnly && !matched;

    return buildExportNodeMarkup(node, graph, { matched, dimmed, theme });
  }).join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${exportSize.width}" height="${exportSize.height}" viewBox="${exportSize.originX} ${exportSize.originY} ${exportSize.width} ${exportSize.height}">
      <defs>
        <style><![CDATA[${buildExportStyles(theme)}]]></style>
      </defs>
      <rect x="${exportSize.originX}" y="${exportSize.originY}" width="${exportSize.width}" height="${exportSize.height}" fill="${palette.background}"></rect>
      <g class="graph-export-root">
        ${edgeMarkup}
        ${nodeMarkup}
      </g>
    </svg>
  `.trim();
}

class GraphController {
  constructor(container, options = {}) {
    this.container = container;
    this.graph = options.graph || null;
    this.theme = options.theme || 'light';
    this.searchTerm = options.searchTerm || '';
    this.filterOnly = Boolean(options.filterOnly);
    this.viewport = options.viewport || null;
    this.onNodePositionChange = options.onNodePositionChange || (() => {});
    this.onViewportChange = options.onViewportChange || (() => {});
    this.hasFitted = false;
    this.dragState = null;
    this.pointerMoveHandler = this.handlePointerMove.bind(this);
    this.pointerUpHandler = this.handlePointerUp.bind(this);
    this.wheelHandler = this.handleWheel.bind(this);
    this.pointerDownHandler = this.handlePointerDown.bind(this);
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.hasFitted && !this.viewport) {
        this.fitToView({ minZoom: INITIAL_FIT_MIN_ZOOM, maxZoom: INITIAL_FIT_MAX_ZOOM, align: 'leading' });
        return;
      }

      this.render();
    });

    if (this.container) {
      this.resizeObserver.observe(this.container);
    }

    this.render();
  }

  destroy() {
    window.removeEventListener('pointermove', this.pointerMoveHandler);
    window.removeEventListener('pointerup', this.pointerUpHandler);

    if (this.svgElement) {
      this.svgElement.removeEventListener('wheel', this.wheelHandler);
      this.svgElement.removeEventListener('pointerdown', this.pointerDownHandler);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  setGraph(graph) {
    this.graph = graph || null;
    this.hasFitted = false;
    this.render();
  }

  setSearchTerm(searchTerm) {
    this.searchTerm = searchTerm || '';
    this.render();
  }

  setFilterOnly(filterOnly) {
    this.filterOnly = Boolean(filterOnly);
    this.render();
  }

  setTheme(theme) {
    this.theme = theme || 'light';
    this.render();
  }

  getMetrics() {
    const visibility = resolveGraphVisibility(this.graph, this.searchTerm, this.filterOnly);
    return {
      totalNodes: Array.isArray(this.graph?.nodes) ? this.graph.nodes.length : 0,
      totalEdges: Array.isArray(this.graph?.edges) ? this.graph.edges.length : 0,
      visibleNodes: visibility.visibleNodes.length,
      visibleEdges: visibility.visibleEdges.length,
      matchedNodes: visibility.matchedNodeIds.size,
    };
  }

  zoomIn() {
    this.zoomBy(1.15);
  }

  zoomOut() {
    this.zoomBy(0.87);
  }

  zoomBy(factor) {
    if (!this.svgElement) {
      return;
    }

    const rect = this.svgElement.getBoundingClientRect();
    this.zoomAt(factor, rect.left + (rect.width / 2), rect.top + (rect.height / 2));
  }

  zoomAt(factor, clientX, clientY) {
    if (!this.svgElement) {
      return;
    }

    this.ensureViewport();
    const nextZoom = clamp(this.viewport.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const graphPoint = getScreenPointFromClient(this.svgElement, this.viewport, clientX, clientY);
    const rect = this.svgElement.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    this.viewport = {
      x: localX - (graphPoint.x * nextZoom),
      y: localY - (graphPoint.y * nextZoom),
      zoom: nextZoom,
    };

    this.onViewportChange(this.viewport);
    this.render();
  }

  fitToView(options = {}) {
    if (!this.graph || !Array.isArray(this.graph.nodes) || this.graph.nodes.length === 0) {
      return;
    }

    const visibility = resolveGraphVisibility(this.graph, this.searchTerm, this.filterOnly);
    const bounds = getNodeBounds(visibility.visibleNodes.length ? visibility.visibleNodes : this.graph.nodes);
    const width = Math.max(this.container.clientWidth, 320);
    const height = Math.max(this.container.clientHeight, 320);
    const minZoom = Number.isFinite(options.minZoom) ? options.minZoom : ZOOM_MIN;
    const maxZoom = Number.isFinite(options.maxZoom) ? options.maxZoom : 1.4;
    const zoom = clamp(
      Math.min(
        (width - (FIT_PADDING * 2)) / Math.max(bounds.width, CARD_WIDTH),
        (height - (FIT_PADDING * 2)) / Math.max(bounds.height, CARD_HEIGHT),
        1.2
      ),
      minZoom,
      maxZoom
    );

    const centeredX = ((width - (bounds.width * zoom)) / 2) - (bounds.minX * zoom);
    const centeredY = ((height - (bounds.height * zoom)) / 2) - (bounds.minY * zoom);
    const shouldAlignLeading = options.align === 'leading';
    const overflowX = (bounds.width * zoom) > (width - (FIT_PADDING * 2));
    const overflowY = (bounds.height * zoom) > (height - (FIT_PADDING * 2));

    this.viewport = {
      x: shouldAlignLeading && overflowX ? FIT_PADDING - (bounds.minX * zoom) : centeredX,
      y: shouldAlignLeading && overflowY ? FIT_PADDING - (bounds.minY * zoom) : centeredY,
      zoom,
    };
    this.hasFitted = true;
    this.onViewportChange(this.viewport);
    this.render();
  }

  ensureViewport() {
    if (this.viewport) {
      return;
    }

    this.viewport = {
      x: 48,
      y: 48,
      zoom: 1,
    };
  }

  maybeAutoPanWhileDragging(event) {
    if (!this.svgElement || !this.viewport) {
      return false;
    }

    const rect = this.svgElement.getBoundingClientRect();
    const deltaX = getAutoPanVelocity(event.clientX - rect.left, rect.width);
    const deltaY = getAutoPanVelocity(event.clientY - rect.top, rect.height);

    if (!deltaX && !deltaY) {
      return false;
    }

    this.viewport = {
      ...this.viewport,
      x: this.viewport.x + deltaX,
      y: this.viewport.y + deltaY,
    };
    return true;
  }

  handleWheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    this.zoomAt(factor, event.clientX, event.clientY);
  }

  handlePointerDown(event) {
    if (!this.svgElement) {
      return;
    }

    const nodeTarget = event.target.closest('[data-node-id]');

    if (nodeTarget) {
      const nodeId = nodeTarget.getAttribute('data-node-id');
      const node = this.graph?.nodes?.find((item) => item.id === nodeId);

      if (!node) {
        return;
      }

      this.ensureViewport();
      const pointer = getScreenPointFromClient(this.svgElement, this.viewport, event.clientX, event.clientY);
      this.dragState = {
        type: 'node',
        nodeId,
        startPointer: pointer,
        startPosition: {
          x: node.position.x,
          y: node.position.y,
        },
        viewportChanged: false,
      };
    } else {
      this.ensureViewport();
      this.dragState = {
        type: 'pan',
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: {
          ...this.viewport,
        },
      };
    }

    event.preventDefault();
    window.addEventListener('pointermove', this.pointerMoveHandler);
    window.addEventListener('pointerup', this.pointerUpHandler);
  }

  handlePointerMove(event) {
    if (!this.dragState || !this.graph) {
      return;
    }

    if (this.dragState.type === 'pan') {
      this.viewport = {
        ...this.dragState.startViewport,
        x: this.dragState.startViewport.x + (event.clientX - this.dragState.startClientX),
        y: this.dragState.startViewport.y + (event.clientY - this.dragState.startClientY),
      };
      this.render();
      return;
    }

    const node = this.graph.nodes.find((item) => item.id === this.dragState.nodeId);

    if (!node) {
      return;
    }

    if (this.maybeAutoPanWhileDragging(event)) {
      this.dragState.viewportChanged = true;
    }

    const pointer = getScreenPointFromClient(this.svgElement, this.viewport, event.clientX, event.clientY);
    node.position = {
      x: this.dragState.startPosition.x + (pointer.x - this.dragState.startPointer.x),
      y: this.dragState.startPosition.y + (pointer.y - this.dragState.startPointer.y),
    };

    this.render();
  }

  handlePointerUp() {
    if (this.dragState?.type === 'node' && this.graph) {
      const node = this.graph.nodes.find((item) => item.id === this.dragState.nodeId);

      if (node) {
        this.onNodePositionChange(node.id, node.position, this.graph);
      }

      if (this.dragState.viewportChanged && this.viewport) {
        this.onViewportChange(this.viewport);
      }
    }

    if (this.dragState?.type === 'pan' && this.viewport) {
      this.onViewportChange(this.viewport);
    }

    window.removeEventListener('pointermove', this.pointerMoveHandler);
    window.removeEventListener('pointerup', this.pointerUpHandler);
    this.dragState = null;
  }

  exportSvg(fileName) {
    const svgMarkup = buildExportSvgMarkup(this.graph, this.searchTerm, this.filterOnly, this.theme);
    downloadBlob(new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }), fileName);
  }

  async exportPng(fileName) {
    const svgMarkup = buildExportSvgMarkup(this.graph, this.searchTerm, this.filterOnly, this.theme);
    const exportSize = getExportSize(this.graph, this.searchTerm, this.filterOnly);
    const blob = await svgToPngBlob(svgMarkup, exportSize.width, exportSize.height, {
      background: getExportPalette(this.theme).background,
    });
    downloadBlob(blob, fileName);
  }

  async exportPdf(fileName) {
    const svgMarkup = buildExportSvgMarkup(this.graph, this.searchTerm, this.filterOnly, this.theme);
    const exportSize = getExportSize(this.graph, this.searchTerm, this.filterOnly);
    const blob = await svgToPdfBlob(svgMarkup, exportSize.width, exportSize.height, {
      background: getExportPalette(this.theme).background,
    });
    downloadBlob(blob, fileName);
  }

  render() {
    if (!this.container) {
      return;
    }

    if (!this.graph || !Array.isArray(this.graph.nodes) || this.graph.nodes.length === 0) {
      this.container.innerHTML = `
        <div class="graph-empty">
          <h3>No flow processed yet</h3>
          <p>Create a work folder, upload your GoAnywhere XML files, choose a starting project, and process the project flow.</p>
        </div>
      `;
      return;
    }

    if (!this.hasFitted && !this.viewport) {
      this.fitToView({ minZoom: INITIAL_FIT_MIN_ZOOM, maxZoom: INITIAL_FIT_MAX_ZOOM, align: 'leading' });
      return;
    }

    this.ensureViewport();

    const visibility = resolveGraphVisibility(this.graph, this.searchTerm, this.filterOnly);

    if (visibility.visibleNodes.length === 0) {
      this.container.innerHTML = `
        <div class="graph-empty">
          <h3>No matching nodes</h3>
          <p>Adjust the graph search or clear the filter to show the full flow again.</p>
        </div>
      `;
      return;
    }

    const width = Math.max(this.container.clientWidth, 480);
    const height = Math.max(this.container.clientHeight, 560);
    const edgeMarkup = visibility.visibleEdges.map((edge) => {
      const sourceNode = this.graph.nodes.find((node) => node.id === edge.source);
      const targetNode = this.graph.nodes.find((node) => node.id === edge.target);

      if (!sourceNode || !targetNode) {
        return '';
      }

      const geometry = buildEdgeGeometry(edge, sourceNode, targetNode, this.graph);
      const dimmed = normalizeSearchTerm(this.searchTerm) && !this.filterOnly && !(visibility.matchedNodeIds.has(edge.source) || visibility.matchedNodeIds.has(edge.target));

      return `
        <g class="graph-edge ${dimmed ? 'is-dimmed' : ''}">
          <path d="${geometry.path}" stroke="${geometry.color}"></path>
          <path class="graph-edge__arrow" d="${geometry.arrowPath}" fill="${geometry.color}"></path>
          <text x="${geometry.label.x}" y="${geometry.label.y}">${escapeHtml(edge.label || '')}</text>
        </g>
      `;
    }).join('');

    const nodeMarkup = visibility.visibleNodes.map((node) => {
      const matched = normalizeSearchTerm(this.searchTerm) ? visibility.matchedNodeIds.has(node.id) : false;
      const dimmed = normalizeSearchTerm(this.searchTerm) && !this.filterOnly && !matched;
      const incomingEdges = getOrderedNodeEdges(this.graph, node.id, 'target');
      const outgoingEdges = getOrderedNodeEdges(this.graph, node.id, 'source');
      const inputPortMarkup = incomingEdges.length
        ? `<path class="graph-input-port" d="${buildInputPortPath(node)}"></path>`
        : '';
      const outputPortMarkup = outgoingEdges.map((edge, index) => {
        const point = getOutputPortPoint(node, index, outgoingEdges.length);
        return `<path class="graph-output-port" d="${buildOutputPortPath(point)}" fill="${getEdgeColor(edge, this.graph)}"></path>`;
      }).join('');

      return `
        <g class="graph-node ${matched ? 'is-matched' : ''} ${dimmed ? 'is-dimmed' : ''}" data-node-id="${escapeHtml(node.id)}">
          <foreignObject x="${node.position.x}" y="${node.position.y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" data-node-id="${escapeHtml(node.id)}">
            ${buildNodeCardMarkup(node, { matched, dimmed })}
          </foreignObject>
          ${inputPortMarkup}
          ${outputPortMarkup}
        </g>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="graph-stage">
        <svg class="graph-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet" aria-label="Project flow graph">
          <g class="graph-panzoom" transform="translate(${this.viewport.x} ${this.viewport.y}) scale(${this.viewport.zoom})">
            ${edgeMarkup}
            ${nodeMarkup}
          </g>
        </svg>
      </div>
    `;

    this.svgElement = this.container.querySelector('.graph-svg');
    this.svgElement.addEventListener('wheel', this.wheelHandler, { passive: false });
    this.svgElement.addEventListener('pointerdown', this.pointerDownHandler);
  }
}

export function mountGraph(container, options) {
  return new GraphController(container, options);
}

export function getGraphMetrics(graph, searchTerm, filterOnly) {
  const visibility = resolveGraphVisibility(graph, searchTerm, filterOnly);
  return {
    totalNodes: Array.isArray(graph?.nodes) ? graph.nodes.length : 0,
    totalEdges: Array.isArray(graph?.edges) ? graph.edges.length : 0,
    visibleNodes: visibility.visibleNodes.length,
    visibleEdges: visibility.visibleEdges.length,
  };
}
