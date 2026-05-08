const fs = require('fs');
const crypto = require('crypto');
const { DATA_DIR, STORAGE_KEY_PATH } = require('./config');

const FILE_MAGIC = Buffer.from('GAFX1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey;

function normalizeKey(input) {
  if (!input) {
    return null;
  }

  if (Buffer.isBuffer(input)) {
    if (input.length === 32) {
      return input;
    }

    return crypto.createHash('sha256').update(input).digest();
  }

  const value = String(input).trim();

  if (!value) {
    return null;
  }

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  try {
    const decoded = Buffer.from(value, 'base64');

    if (decoded.length === 32) {
      return decoded;
    }
  } catch (error) {
    error;
  }

  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function getEncryptionKey() {
  if (cachedKey) {
    return cachedKey;
  }

  const envKey = normalizeKey(process.env.FILE_ENCRYPTION_KEY);

  if (envKey) {
    cachedKey = envKey;
    return cachedKey;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(STORAGE_KEY_PATH)) {
    const persistedKey = normalizeKey(fs.readFileSync(STORAGE_KEY_PATH, 'utf8'));

    if (!persistedKey) {
      throw new Error('The persisted file encryption key is invalid.');
    }

    cachedKey = persistedKey;
    return cachedKey;
  }

  cachedKey = crypto.randomBytes(32);
  fs.writeFileSync(STORAGE_KEY_PATH, cachedKey.toString('hex'), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return cachedKey;
}

function isEncryptedPayload(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length > FILE_MAGIC.length + IV_LENGTH + TAG_LENGTH
    && buffer.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);
}

function encryptBuffer(buffer) {
  const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([FILE_MAGIC, iv, tag, ciphertext]);
}

function decryptBuffer(buffer) {
  const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  if (!isEncryptedPayload(payload)) {
    return {
      buffer: payload,
      encrypted: false,
    };
  }

  const ivStart = FILE_MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const dataStart = tagStart + TAG_LENGTH;
  const iv = payload.subarray(ivStart, tagStart);
  const tag = payload.subarray(tagStart, dataStart);
  const ciphertext = payload.subarray(dataStart);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);

  return {
    buffer: Buffer.concat([decipher.update(ciphertext), decipher.final()]),
    encrypted: true,
  };
}

module.exports = {
  encryptBuffer,
  decryptBuffer,
  isEncryptedPayload,
};
