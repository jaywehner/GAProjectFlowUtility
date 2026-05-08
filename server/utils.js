function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFileNameKey(value) {
  return safeTrim(value).toLowerCase();
}

function extractProjectFileName(projectPath) {
  const rawValue = safeTrim(projectPath);

  if (!rawValue) {
    return '';
  }

  const segments = rawValue.split(/[\\/]/).filter(Boolean);
  const candidate = segments.length ? segments[segments.length - 1] : rawValue;
  return /\.xml$/i.test(candidate) ? candidate : `${candidate}.xml`;
}

function validateUsername(username) {
  const value = safeTrim(username);

  if (!value) {
    return 'Username is required.';
  }

  if (value.length < 3 || value.length > 40) {
    return 'Username must be between 3 and 40 characters long.';
  }

  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    return 'Username can only include letters, numbers, periods, underscores, and hyphens.';
  }

  return null;
}

function validateFolderName(folderName) {
  const value = safeTrim(folderName);

  if (!value) {
    return 'Folder name is required.';
  }

  if (value.length < 2 || value.length > 60) {
    return 'Folder name must be between 2 and 60 characters long.';
  }

  if (/[\u0000-\u001f]/.test(value)) {
    return 'Folder name contains invalid control characters.';
  }

  return null;
}

function isXmlFileName(fileName) {
  return /\.xml$/i.test(safeTrim(fileName));
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

module.exports = {
  safeTrim,
  normalizeFileNameKey,
  extractProjectFileName,
  validateUsername,
  validateFolderName,
  isXmlFileName,
  toBoolean,
};
