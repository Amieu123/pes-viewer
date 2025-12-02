// Google Drive API Module - API Key Version

class DriveAPI {
  constructor() {
    this.apiKey = '';
    this.folderIds = [];
    this.baseUrl = 'https://www.googleapis.com/drive/v3';
    this.allFiles = [];
  }

  setApiKey(key) { this.apiKey = key; }

  setFolderIds(ids) {
    this.folderIds = ids.filter(id => id?.trim());
    this.allFiles = [];
  }

  isConfigured() {
    return this.apiKey && this.folderIds.length > 0;
  }

  clearCache() { this.allFiles = []; }

  // ==================== Search ====================

  async searchFiles(query = '') {
    if (!this.apiKey) throw new Error('API Key chưa được cấu hình');
    if (!this.folderIds.length) throw new Error('Chưa có Folder ID nào');

    // Empty query = load all files
    if (!query.trim()) {
      if (!this.allFiles.length) await this.loadAllFiles();
      return this.pairFiles(this.allFiles);
    }

    // Search via API
    const results = await Promise.allSettled(
      this.folderIds.map(id => this.searchInFolder(id, query))
    );

    const files = new Map();
    results.forEach(r => {
      if (r.status === 'fulfilled') {
        r.value.forEach(f => files.set(f.id, f));
      }
    });

    return this.pairFiles(Array.from(files.values()));
  }

  async searchInFolder(folderId, query) {
    const terms = query.trim().split(/\s+/);
    const nameConditions = terms.map(t => `name contains '${t.replace(/'/g, "\\'")}'`).join(' and ');

    const params = new URLSearchParams({
      q: `'${folderId}' in parents and (fileExtension='pes' or fileExtension='emb') and trashed=false and ${nameConditions}`,
      key: this.apiKey,
      fields: 'files(id,name,size,webViewLink,modifiedTime)',
      pageSize: '1000',
      orderBy: 'name'
    });

    const response = await fetch(`${this.baseUrl}/files?${params}`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API Error: ${response.status}`);
    }

    return (await response.json()).files || [];
  }

  // ==================== Load All Files ====================

  async loadAllFiles() {
    const results = await Promise.allSettled(
      this.folderIds.map(id => this.loadFilesFromFolder(id))
    );

    const files = new Map();
    results.forEach(r => {
      if (r.status === 'fulfilled') {
        r.value.forEach(f => files.set(f.id, f));
      }
    });

    this.allFiles = Array.from(files.values()).sort((a, b) => a.name.localeCompare(b.name));
    return this.allFiles;
  }

  async loadFilesFromFolder(folderId) {
    const q = `'${folderId}' in parents and (fileExtension='pes' or fileExtension='emb') and trashed=false`;
    const allFiles = [];
    let pageToken = null;

    do {
      const params = new URLSearchParams({
        q, key: this.apiKey,
        fields: 'nextPageToken,files(id,name,size,webViewLink,modifiedTime)',
        pageSize: '1000', orderBy: 'name'
      });
      if (pageToken) params.append('pageToken', pageToken);

      const response = await fetch(`${this.baseUrl}/files?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API Error: ${response.status}`);
      }

      const data = await response.json();
      allFiles.push(...(data.files || []));
      pageToken = data.nextPageToken;
    } while (pageToken);

    return allFiles;
  }

  // ==================== File Pairing ====================

  pairFiles(files) {
    const map = new Map();

    files.forEach(file => {
      const lastDot = file.name.lastIndexOf('.');
      const baseName = lastDot > 0 ? file.name.substring(0, lastDot) : file.name;
      const ext = lastDot > 0 ? file.name.substring(lastDot + 1).toLowerCase() : '';

      if (!map.has(baseName)) {
        map.set(baseName, { name: baseName, pes: null, emb: null });
      }

      const pair = map.get(baseName);
      const info = {
        id: file.id,
        name: file.name,
        size: file.size,
        modifiedTime: file.modifiedTime,
        link: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
      };

      if (ext === 'pes') pair.pes = info;
      else if (ext === 'emb') pair.emb = info;
    });

    return Array.from(map.values()).filter(p => p.pes || p.emb);
  }

  // ==================== Download ====================

  async downloadFile(fileId) {
    if (!this.apiKey) throw new Error('API Key chưa được cấu hình');

    const response = await chrome.runtime.sendMessage({
      action: 'downloadFile',
      fileId,
      apiKey: this.apiKey
    });

    if (!response.success) throw new Error(response.error || 'Download failed');
    return new Uint8Array(response.data);
  }

  // ==================== Utils ====================

  static formatSize(bytes) {
    if (!bytes) return 'N/A';
    bytes = parseInt(bytes);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  static extractFolderId(input) {
    if (/^[a-zA-Z0-9_-]+$/.test(input) && input.length > 20) return input;
    const match = input.match(/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : input;
  }
}

window.DriveAPI = DriveAPI;
