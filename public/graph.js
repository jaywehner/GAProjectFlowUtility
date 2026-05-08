const CARD_WIDTH = 260;
const CARD_HEIGHT = 132;
const GRAPH_PADDING = 80;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCardCenter(node, side) {
  const x = side === 'left' ? node.position.x : node.position.x + CARD_WIDTH;
  return {
    x,
    y: node.position.y + CARD_HEIGHT / 2,
  };
}

function buildPath(sourceNode, targetNode) {
  const start = getCardCenter(sourceNode, 'right');
  const end = getCardCenter(targetNode, 'left');
  const curveDistance = Math.max(80, (end.x - start.x) / 2);
  return `M ${start.x} ${start.y} C ${start.x + curveDistance} ${start.y}, ${end.x - curveDistance} ${end.y}, ${end.x} ${end.y}`;
}

function buildEdgeLabel(sourceNode, targetNode) {
  const start = getCardCenter(sourceNode, 'right');
  const end = getCardCenter(targetNode, 'left');
  return {
    x: (start.x + end.x) / 2,
    y: ((start.y + end.y) / 2) - 8,
  };
}

function renderEmptyState(container) {
  container.innerHTML = `
    <div class="graph-empty">
      <h3>No flow processed yet</h3>
      <p>Create a work folder, upload your GoAnywhere XML files, choose a starting project, and process the project flow.</p>
    </div>
  `;
}

export function renderGraph(container, graph) {
  if (!container) {
    return;
  }

  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    renderEmptyState(container);
    return;
  }

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const maxX = Math.max(...graph.nodes.map((node) => node.position.x + CARD_WIDTH)) + GRAPH_PADDING;
  const maxY = Math.max(...graph.nodes.map((node) => node.position.y + CARD_HEIGHT)) + GRAPH_PADDING;

  const edgeMarkup = graph.edges.map((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (!sourceNode || !targetNode) {
      return '';
    }

    const labelPosition = buildEdgeLabel(sourceNode, targetNode);

    return `
      <g class="graph-edge">
        <path d="${buildPath(sourceNode, targetNode)}" marker-end="url(#arrowhead)"></path>
        <text x="${labelPosition.x}" y="${labelPosition.y}">${escapeHtml(edge.label || '')}</text>
      </g>
    `;
  }).join('');

  const nodeMarkup = graph.nodes.map((node) => `
    <article
      class="flow-card ${escapeHtml(node.type)} ${escapeHtml(node.status)}"
      style="left:${node.position.x}px; top:${node.position.y}px; width:${CARD_WIDTH}px; min-height:${CARD_HEIGHT}px;"
    >
      <div class="flow-card__header">
        <span class="flow-card__type">${escapeHtml(node.type)}</span>
        <span class="flow-card__status">${escapeHtml(node.status)}</span>
      </div>
      <h3>${escapeHtml(node.title)}</h3>
      <p class="flow-card__subtitle">${escapeHtml(node.subtitle)}</p>
      <p class="flow-card__body">${escapeHtml(node.body)}</p>
    </article>
  `).join('');

  container.innerHTML = `
    <div class="graph-board">
      <div class="graph-surface" style="width:${maxX}px; height:${maxY}px;">
        <svg class="graph-svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}" aria-hidden="true">
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
              <path d="M0,0 L10,4 L0,8 z"></path>
            </marker>
          </defs>
          ${edgeMarkup}
        </svg>
        ${nodeMarkup}
      </div>
    </div>
  `;
}
