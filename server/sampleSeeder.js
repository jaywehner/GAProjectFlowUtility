const fs = require('fs');
const path = require('path');
const { SAMPLE_DATA_DIR } = require('./config');
const { createUser, getUserByUsername, createWorkFolder, findWorkFolderByName, saveFileContent } = require('./store');
const { hashPassword } = require('./security');

function ensureAdminUser() {
  const existingAdmin = getUserByUsername('admin');

  if (existingAdmin) {
    return existingAdmin;
  }

  return createUser({
    username: 'admin',
    passwordHash: hashPassword('admin'),
    isAdmin: true,
    mustChangePassword: true,
  });
}

function ensureSampleFolder(userId) {
  const existingFolder = findWorkFolderByName(userId, 'Sample Data');

  if (existingFolder) {
    return existingFolder;
  }

  return createWorkFolder(userId, 'Sample Data');
}

function seedSampleFiles(workFolderId) {
  if (!fs.existsSync(SAMPLE_DATA_DIR)) {
    return;
  }

  const entries = fs.readdirSync(SAMPLE_DATA_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !/\.xml$/i.test(entry.name)) {
      continue;
    }

    const fullPath = path.join(SAMPLE_DATA_DIR, entry.name);
    const content = fs.readFileSync(fullPath);
    saveFileContent(workFolderId, entry.name, content, { skipIfExists: true });
  }
}

function seedDefaults() {
  const adminUser = ensureAdminUser();
  const sampleFolder = ensureSampleFolder(adminUser.id);
  seedSampleFiles(sampleFolder.id);
}

module.exports = {
  seedDefaults,
};
