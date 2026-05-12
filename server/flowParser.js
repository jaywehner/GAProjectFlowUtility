const { DOMParser } = require('@xmldom/xmldom');
const { extractProjectFileName, normalizeFileNameKey, safeTrim } = require('./utils');

const LAYOUT_PADDING_X = 60;
const LAYOUT_PADDING_Y = 60;
const LAYOUT_COLUMN_GAP = 480;
const LAYOUT_ROW_GAP = 240;

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function getDirectElementChildren(parentNode) {
  return Array.from(parentNode.childNodes || []).filter((node) => node.nodeType === 1);
}

function walkElementTree(parentNode, visit) {
  for (const child of getDirectElementChildren(parentNode)) {
    visit(child);
    walkElementTree(child, visit);
  }
}

function parseProjectXml(fileName, content) {
  const document = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: () => {},
      fatalError: () => {},
    },
  }).parseFromString(content, 'text/xml');

  const projectElement = document.getElementsByTagName('project')[0];

  if (!projectElement) {
    throw new Error('Missing project root element.');
  }

  const projectName = safeTrim(projectElement.getAttribute('name')) || fileName.replace(/\.xml$/i, '');
  const mainModuleName = safeTrim(projectElement.getAttribute('mainModule'));
  const modules = new Map();

  for (const child of getDirectElementChildren(projectElement)) {
    if (child.tagName !== 'module') {
      continue;
    }

    const moduleName = safeTrim(child.getAttribute('name'));

    if (!moduleName) {
      continue;
    }

    const calls = [];

    walkElementTree(child, (moduleChild) => {
      if (moduleChild.tagName === 'callProject') {
        calls.push({
          type: 'project',
          label: safeTrim(moduleChild.getAttribute('label')),
          projectPath: safeTrim(moduleChild.getAttribute('project')),
          projectFileName: extractProjectFileName(moduleChild.getAttribute('project')),
        });
      }

      if (moduleChild.tagName === 'callModule') {
        calls.push({
          type: 'module',
          label: safeTrim(moduleChild.getAttribute('label')),
          moduleName: safeTrim(moduleChild.getAttribute('module')),
        });
      }
    });

    modules.set(normalizeFileNameKey(moduleName), {
      name: moduleName,
      description: safeTrim(child.getAttribute('description')),
      calls,
    });
  }

  return {
    fileName,
    projectName,
    mainModuleName,
    modules,
  };
}

function buildProjectNodeId(fileName) {
  return `project:${normalizeFileNameKey(fileName)}`;
}

function buildModuleNodeId(fileName, moduleName) {
  return `module:${normalizeFileNameKey(fileName)}:${normalizeFileNameKey(moduleName)}`;
}

function stripXmlExtension(value) {
  return safeTrim(value).replace(/\.xml$/i, '');
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractQuotedProjectSegments(projectPath) {
  return Array.from(decodeXmlEntities(projectPath).matchAll(/["']([^"']+)["']/g))
    .map((match) => safeTrim(match[1]))
    .filter(Boolean)
    .reverse();
}

function collectProjectFileNameCandidates(projectPath, projectFileName) {
  const rawValue = safeTrim(projectPath);
  const decodedValue = decodeXmlEntities(rawValue);
  const candidates = [];
  const seen = new Set();

  function addCandidate(value) {
    const candidate = extractProjectFileName(value);
    const candidateKey = normalizeFileNameKey(candidate);
    const candidateBaseName = normalizeFileNameKey(stripXmlExtension(candidate));

    if (!candidateKey || !candidateBaseName || seen.has(candidateKey)) {
      return;
    }

    seen.add(candidateKey);
    candidates.push(candidate);
  }

  for (const segment of extractQuotedProjectSegments(rawValue)) {
    addCandidate(segment);
  }

  addCandidate(decodedValue);
  addCandidate(projectFileName);
  addCandidate(rawValue);

  return candidates;
}

function createGraphBuilder(fileMap, options = {}) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();
  const edgeSet = new Set();
  const parsedProjectCache = new Map();
  const uploadedFiles = Array.from(fileMap.values());
  const fileReplacements = options.fileReplacements instanceof Map ? options.fileReplacements : new Map();

  function loadProject(fileName) {
    const requestedFileKey = normalizeFileNameKey(fileName);
    const replacementFileName = fileReplacements.get(requestedFileKey);
    const resolvedFileName = fileMap.has(requestedFileKey)
      ? fileName
      : (replacementFileName || fileName);
    const resolvedFileKey = normalizeFileNameKey(resolvedFileName);

    if (parsedProjectCache.has(resolvedFileKey)) {
      return parsedProjectCache.get(resolvedFileKey);
    }

    const fileEntry = fileMap.get(resolvedFileKey);

    if (!fileEntry) {
      const missingResult = {
        fileName,
        missing: true,
        error: 'Project file not found',
      };
      parsedProjectCache.set(resolvedFileKey, missingResult);
      return missingResult;
    }

    try {
      const parsed = parseProjectXml(fileEntry.originalName, fileEntry.content);
      const success = {
        missing: false,
        parsed,
      };
      parsedProjectCache.set(resolvedFileKey, success);
      return success;
    } catch (error) {
      const failed = {
        fileName: fileEntry.originalName,
        missing: true,
        error: `Invalid XML: ${error.message}`,
      };
      parsedProjectCache.set(resolvedFileKey, failed);
      return failed;
    }
  }

  function upsertNode(node) {
    const existing = nodeMap.get(node.id);

    if (existing) {
      return existing;
    }

    const created = {
      ...node,
      order: nodes.length,
    };
    nodes.push(created);
    nodeMap.set(created.id, created);
    return created;
  }

  function addEdge(source, target, label) {
    const edgeId = `${source}->${target}->${safeTrim(label)}`;

    if (edgeSet.has(edgeId)) {
      return;
    }

    edgeSet.add(edgeId);
    edges.push({ id: edgeId, source, target, label: safeTrim(label), order: edges.length });
  }

  function ensureProjectNode(fileName) {
    const projectId = buildProjectNodeId(fileName);
    const projectState = loadProject(fileName);

    if (projectState.missing) {
      return upsertNode({
        id: projectId,
        type: 'project',
        title: fileName,
        subtitle: 'Project',
        body: projectState.error,
        status: 'missing',
      });
    }

    return upsertNode({
      id: projectId,
      type: 'project',
      title: projectState.parsed.projectName,
      subtitle: projectState.parsed.fileName,
      body: projectState.parsed.mainModuleName ? `Main module: ${projectState.parsed.mainModuleName}` : 'Main module not defined',
      status: 'ready',
    });
  }

  function ensureModuleNode(fileName, moduleName) {
    const moduleId = buildModuleNodeId(fileName, moduleName || 'missing-module');
    const projectState = loadProject(fileName);

    if (projectState.missing) {
      return upsertNode({
        id: moduleId,
        type: 'module',
        title: moduleName || 'Unknown Module',
        subtitle: fileName,
        body: 'Project file not found',
        status: 'missing',
      });
    }

    const module = projectState.parsed.modules.get(normalizeFileNameKey(moduleName));

    if (!module) {
      return upsertNode({
        id: moduleId,
        type: 'module',
        title: moduleName || 'Unknown Module',
        subtitle: projectState.parsed.fileName,
        body: 'Module not found',
        status: 'missing',
      });
    }

    return upsertNode({
      id: moduleId,
      type: 'module',
      title: module.name,
      subtitle: projectState.parsed.fileName,
      body: module.description || `Calls: ${module.calls.length}`,
      status: 'ready',
    });
  }

  function resolveProjectFileName(projectPath, projectFileName) {
    const candidates = collectProjectFileNameCandidates(projectPath, projectFileName);

    for (const candidate of candidates) {
      const fileEntry = fileMap.get(normalizeFileNameKey(candidate));

      if (fileEntry) {
        return fileEntry.originalName;
      }
    }

    for (const candidate of candidates) {
      const candidateBaseName = normalizeFileNameKey(stripXmlExtension(candidate));
      const exactBaseMatch = uploadedFiles.find((fileEntry) => normalizeFileNameKey(stripXmlExtension(fileEntry.originalName)) === candidateBaseName);

      if (exactBaseMatch) {
        return exactBaseMatch.originalName;
      }
    }

    for (const candidate of candidates) {
      const candidateBaseName = normalizeFileNameKey(stripXmlExtension(candidate));

      if (candidateBaseName.length < 3) {
        continue;
      }

      const fuzzyMatches = uploadedFiles.filter((fileEntry) => {
        const uploadedBaseName = normalizeFileNameKey(stripXmlExtension(fileEntry.originalName));
        return uploadedBaseName.includes(candidateBaseName) || candidateBaseName.includes(uploadedBaseName);
      });

      if (fuzzyMatches.length === 1) {
        return fuzzyMatches[0].originalName;
      }
    }

    return candidates[0] || projectFileName;
  }

  const visitedModules = new Set();
  const visitedProjects = new Set();

  function processProject(fileName, sourceNodeId, sourceLabel, options = {}) {
    const projectState = loadProject(fileName);
    const replacementFileName = !fileMap.has(normalizeFileNameKey(fileName))
      ? fileReplacements.get(normalizeFileNameKey(fileName))
      : '';
    const mainModuleName = projectState.missing ? 'Main' : (projectState.parsed.mainModuleName || 'Main');

    if (!options.isRoot && !projectState.missing && !replacementFileName) {
      const moduleNode = ensureModuleNode(fileName, mainModuleName);

      if (sourceNodeId) {
        addEdge(sourceNodeId, moduleNode.id, sourceLabel || 'callProject');
      }

      processModule(fileName, mainModuleName, moduleNode.id);
      return moduleNode;
    }

    const projectNode = ensureProjectNode(fileName);

    if (sourceNodeId) {
      addEdge(sourceNodeId, projectNode.id, sourceLabel || 'callProject');
    }

    if (visitedProjects.has(projectNode.id)) {
      return projectNode;
    }

    visitedProjects.add(projectNode.id);

    if (projectState.missing) {
      return projectNode;
    }

    const moduleNode = ensureModuleNode(fileName, mainModuleName);
    addEdge(projectNode.id, moduleNode.id, 'mainModule');
    processModule(fileName, mainModuleName, moduleNode.id);
    return projectNode;
  }

  function processModule(fileName, moduleName, existingNodeId) {
    const moduleNode = existingNodeId ? nodeMap.get(existingNodeId) || ensureModuleNode(fileName, moduleName) : ensureModuleNode(fileName, moduleName);

    if (visitedModules.has(moduleNode.id)) {
      return moduleNode;
    }

    visitedModules.add(moduleNode.id);
    const projectState = loadProject(fileName);

    if (projectState.missing) {
      return moduleNode;
    }

    const module = projectState.parsed.modules.get(normalizeFileNameKey(moduleName));

    if (!module) {
      return moduleNode;
    }

    for (const call of module.calls) {
      if (call.type === 'module') {
        const childModule = ensureModuleNode(fileName, call.moduleName);
        addEdge(moduleNode.id, childModule.id, call.label || 'callModule');
        processModule(fileName, call.moduleName, childModule.id);
      }

      if (call.type === 'project') {
        const resolvedProjectFileName = resolveProjectFileName(call.projectPath, call.projectFileName);
        processProject(resolvedProjectFileName, moduleNode.id, call.label || 'callProject');
      }
    }

    return moduleNode;
  }

  function computeLayout(rootId) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const nodesInOrder = [...nodes].sort((left, right) => left.order - right.order);
    const outgoingEdgesByNodeId = new Map();
    const incomingEdgesByNodeId = new Map();
    const primaryChildrenByNodeId = new Map();

    for (const node of nodesInOrder) {
      outgoingEdgesByNodeId.set(node.id, []);
      incomingEdgesByNodeId.set(node.id, []);
      primaryChildrenByNodeId.set(node.id, []);
    }

    for (const edge of [...edges].sort((left, right) => (left.order || 0) - (right.order || 0))) {
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
        continue;
      }

      outgoingEdgesByNodeId.get(edge.source).push(edge);
      incomingEdgesByNodeId.get(edge.target).push(edge);
    }

    const depths = new Map();
    const firstDiscoveryOrder = new Map();
    const primaryParentByNodeId = new Map();
    const queue = [rootId];
    let discoveryCounter = 1;
    depths.set(rootId, 0);
    firstDiscoveryOrder.set(rootId, 0);

    while (queue.length > 0) {
      const current = queue.shift();
      const currentDepth = depths.get(current) || 0;

      for (const edge of outgoingEdgesByNodeId.get(current) || []) {
        const targetId = edge.target;
        const nextDepth = currentDepth + 1;
        const knownDepth = depths.get(targetId);

        if (knownDepth === undefined) {
          depths.set(targetId, nextDepth);
          firstDiscoveryOrder.set(targetId, discoveryCounter);
          discoveryCounter += 1;
          primaryParentByNodeId.set(targetId, current);
          primaryChildrenByNodeId.get(current).push(targetId);
          queue.push(targetId);
          continue;
        }

        if (nextDepth < knownDepth) {
          depths.set(targetId, nextDepth);
          queue.push(targetId);
        }
      }
    }

    let maxDepth = 0;

    for (const node of nodesInOrder) {
      if (depths.has(node.id)) {
        maxDepth = Math.max(maxDepth, depths.get(node.id) || 0);
      } else {
        maxDepth += 1;
        depths.set(node.id, maxDepth);
      }

      if (!firstDiscoveryOrder.has(node.id)) {
        firstDiscoveryOrder.set(node.id, discoveryCounter);
        discoveryCounter += 1;
      }
    }

    const subtreeSpanByNodeId = new Map();
    const slotByNodeId = new Map();
    let nextLeafSlot = 0;

    function getStableNodeOrder(nodeId) {
      const node = nodeById.get(nodeId);
      return firstDiscoveryOrder.get(nodeId) ?? node?.order ?? 0;
    }

    function assignSubtreeSpan(nodeId) {
      if (subtreeSpanByNodeId.has(nodeId)) {
        return subtreeSpanByNodeId.get(nodeId);
      }

      const childIds = [...(primaryChildrenByNodeId.get(nodeId) || [])]
        .sort((leftId, rightId) => getStableNodeOrder(leftId) - getStableNodeOrder(rightId));

      if (childIds.length === 0) {
        const leafSpan = {
          start: nextLeafSlot,
          end: nextLeafSlot,
        };
        subtreeSpanByNodeId.set(nodeId, leafSpan);
        slotByNodeId.set(nodeId, nextLeafSlot);
        nextLeafSlot += 1;
        return leafSpan;
      }

      let start = Number.POSITIVE_INFINITY;
      let end = Number.NEGATIVE_INFINITY;

      for (const childId of childIds) {
        const childSpan = assignSubtreeSpan(childId);
        start = Math.min(start, childSpan.start);
        end = Math.max(end, childSpan.end);
      }

      const span = { start, end };
      subtreeSpanByNodeId.set(nodeId, span);
      slotByNodeId.set(nodeId, (start + end) / 2);
      return span;
    }

    const forestRoots = nodesInOrder
      .filter((node) => !primaryParentByNodeId.has(node.id))
      .sort((left, right) => getStableNodeOrder(left.id) - getStableNodeOrder(right.id));

    for (const rootNode of forestRoots) {
      assignSubtreeSpan(rootNode.id);
    }

    for (const node of nodesInOrder) {
      if (!slotByNodeId.has(node.id)) {
        subtreeSpanByNodeId.set(node.id, {
          start: nextLeafSlot,
          end: nextLeafSlot,
        });
        slotByNodeId.set(node.id, nextLeafSlot);
        nextLeafSlot += 1;
      }
    }

    const levels = new Map();

    for (const node of nodesInOrder) {
      const depth = depths.get(node.id) || 0;

      if (!levels.has(depth)) {
        levels.set(depth, []);
      }

      levels.get(depth).push(node);
    }

    const orderedDepths = Array.from(levels.keys()).sort((left, right) => left - right);

    for (const depth of orderedDepths) {
      levels.set(depth, [...(levels.get(depth) || [])].sort((left, right) => {
        const leftSlot = slotByNodeId.get(left.id) ?? left.order;
        const rightSlot = slotByNodeId.get(right.id) ?? right.order;

        if (leftSlot !== rightSlot) {
          return leftSlot - rightSlot;
        }

        const leftOrder = getStableNodeOrder(left.id);
        const rightOrder = getStableNodeOrder(right.id);

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return left.order - right.order;
      }));
    }

    const yByNodeId = new Map();

    for (const depth of orderedDepths) {
      const placedLevel = (levels.get(depth) || []).map((node) => {
        const treeY = (slotByNodeId.get(node.id) || 0) * LAYOUT_ROW_GAP;
        const parentYValues = (incomingEdgesByNodeId.get(node.id) || [])
          .map((edge) => yByNodeId.get(edge.source))
          .filter((position) => Number.isFinite(position));
        const parentY = parentYValues.length ? average(parentYValues) : treeY;

        return {
          node,
          treeY,
          desiredY: average([treeY, parentY]),
        };
      });

      let currentY = Number.NEGATIVE_INFINITY;

      for (const item of placedLevel) {
        item.y = Number.isFinite(currentY)
          ? Math.max(item.desiredY, currentY + LAYOUT_ROW_GAP)
          : item.desiredY;
        currentY = item.y;
      }

      const treeCenter = average(placedLevel.map((item) => item.treeY));
      const placedCenter = average(placedLevel.map((item) => item.y));
      const shift = Number.isFinite(treeCenter) && Number.isFinite(placedCenter)
        ? treeCenter - placedCenter
        : 0;

      for (const item of placedLevel) {
        yByNodeId.set(item.node.id, item.y + shift);
      }

      levels.set(depth, [...placedLevel]
        .sort((left, right) => (yByNodeId.get(left.node.id) || 0) - (yByNodeId.get(right.node.id) || 0))
        .map((item) => item.node));
    }

    const minY = Math.min(...nodesInOrder.map((node) => yByNodeId.get(node.id) || 0));
    const offsetY = LAYOUT_PADDING_Y - minY;

    for (const node of nodesInOrder) {
      const depth = depths.get(node.id) || 0;
      node.position = {
        x: LAYOUT_PADDING_X + (depth * LAYOUT_COLUMN_GAP),
        y: (yByNodeId.get(node.id) || 0) + offsetY,
      };
    }
  }

  return {
    processProject,
    finalize(rootId) {
      computeLayout(rootId);
      return {
        nodes: nodes.map((node) => ({
          id: node.id,
          type: node.type,
          title: node.title,
          subtitle: node.subtitle,
          body: node.body,
          status: node.status,
          position: node.position,
        })),
        edges,
      };
    },
  };
}

function buildFlowGraph(startProjectFileName, fileMap, options = {}) {
  const builder = createGraphBuilder(fileMap, options);
  const rootProject = builder.processProject(startProjectFileName, null, null, { isRoot: true });
  return builder.finalize(rootProject.id);
}

module.exports = {
  parseProjectXml,
  buildFlowGraph,
};
