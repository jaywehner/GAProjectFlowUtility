async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text ? { error: text } : {};
}

async function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    formData,
    csrfToken,
  } = options;

  const headers = new Headers();
  let requestBody;

  if (formData) {
    requestBody = formData;
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: requestBody,
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    const message = payload && payload.error ? payload.error : `Request failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export const api = {
  getSession() {
    return request('/api/auth/session');
  },
  login(username, password) {
    return request('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
  },
  register(username, password) {
    return request('/api/auth/register', {
      method: 'POST',
      body: { username, password },
    });
  },
  changePassword(currentPassword, newPassword, csrfToken) {
    return request('/api/auth/change-password', {
      method: 'POST',
      csrfToken,
      body: { currentPassword, newPassword },
    });
  },
  logout() {
    return request('/api/auth/logout', {
      method: 'POST',
    });
  },
  listWorkFolders() {
    return request('/api/work-folders');
  },
  createWorkFolder(name, csrfToken) {
    return request('/api/work-folders', {
      method: 'POST',
      csrfToken,
      body: { name },
    });
  },
  deleteWorkFolder(workFolderId, csrfToken) {
    return request(`/api/work-folders/${workFolderId}`, {
      method: 'DELETE',
      csrfToken,
    });
  },
  listFiles(workFolderId) {
    return request(`/api/work-folders/${workFolderId}/files`);
  },
  uploadFiles(workFolderId, files, csrfToken) {
    const formData = new FormData();

    for (const file of files) {
      formData.append('files', file, file.name);
    }

    return request(`/api/work-folders/${workFolderId}/upload`, {
      method: 'POST',
      csrfToken,
      formData,
    });
  },
  processProjects(workFolderId, startProjectFileName, csrfToken) {
    return request(`/api/work-folders/${workFolderId}/process`, {
      method: 'POST',
      csrfToken,
      body: { startProjectFileName },
    });
  },
  deleteFile(workFolderId, fileId, csrfToken) {
    return request(`/api/work-folders/${workFolderId}/files/${fileId}`, {
      method: 'DELETE',
      csrfToken,
    });
  },
  pasteXml(workFolderId, fileName, xmlContent, csrfToken) {
    const formData = new FormData();
    formData.append('fileName', fileName);
    formData.append('xmlContent', xmlContent);

    return request(`/api/work-folders/${workFolderId}/paste-xml`, {
      method: 'POST',
      csrfToken,
      formData,
    });
  },
  listUsers() {
    return request('/api/admin/users');
  },
  createUser(input, csrfToken) {
    return request('/api/admin/users', {
      method: 'POST',
      csrfToken,
      body: input,
    });
  },
  updateUser(userId, input, csrfToken) {
    return request(`/api/admin/users/${userId}`, {
      method: 'PUT',
      csrfToken,
      body: input,
    });
  },
  deleteUser(userId, csrfToken) {
    return request(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      csrfToken,
    });
  },
};
