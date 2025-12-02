// Google Drive API Module - Using API Key (No OAuth required)

class DriveAPI {
  constructor() {
    this.apiKey = '';
    this.folderIds = []; // Support multiple folders
    this.baseUrl = 'https://www.googleapis.com/drive/v3';
    this.allFiles = []; // Cache all files for local filtering
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  setFolderIds(ids) {
    this.folderIds = ids.filter(id => id && id.trim());
    this.allFiles = []; // Clear cache when folders change
  }

  // Legacy support for single folder
  setFolderId(id) {
    this.setFolderIds([id]);
  }

  isConfigured() {
    return this.apiKey && this.folderIds.length > 0;
  }

  // Load all PES and EMB files from all folders (parallel)
  async loadAllFiles() {
    if (!this.apiKey) throw new Error('API Key chưa được cấu hình');
    if (this.folderIds.length === 0) throw new Error('Chưa có Folder ID nào');

    // Fetch all folders in parallel
    const results = await Promise.allSettled(
      this.folderIds.map(folderId => this.loadFilesFromFolder(folderId))
    );

    // Collect all files from successful requests
    const allFilesFromFolders = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        allFilesFromFolders.push(...result.value);
      } else {
        console.error(`Error loading folder ${this.folderIds[i]}:`, result.reason);
      }
    });

    // Remove duplicates by file ID
    const uniqueFiles = new Map();
    for (const file of allFilesFromFolders) {
      if (!uniqueFiles.has(file.id)) {
        uniqueFiles.set(file.id, file);
      }
    }

    this.allFiles = Array.from(uniqueFiles.values());
    // Sort by name
    this.allFiles.sort((a, b) => a.name.localeCompare(b.name));

    return this.allFiles;
  }

  // Load files from a single folder (with pagination for >1000 files)
  async loadFilesFromFolder(folderId) {
    const q = `'${folderId}' in parents and (fileExtension='pes' or fileExtension='emb') and trashed=false`;
    const allFiles = [];
    let pageToken = null;

    do {
      const params = new URLSearchParams({
        q: q,
        key: this.apiKey,
        fields: 'nextPageToken,files(id,name,size,webViewLink,modifiedTime)',
        pageSize: '1000',
        orderBy: 'name'
      });

      if (pageToken) {
        params.append('pageToken', pageToken);
      }

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

  // Quick check if folder has changes (lightweight request)
  // Returns: { changed: boolean, fileCount: number, latestModified: string }
  async checkForChanges(cachedCount, cachedLatestModified) {
    if (!this.apiKey || this.folderIds.length === 0) return { changed: false };

    try {
      // Fetch minimal data: only id, name, modifiedTime
      const results = await Promise.allSettled(
        this.folderIds.map(folderId => this.getFilesSummary(folderId))
      );

      let totalCount = 0;
      let latestModified = '';

      results.forEach(result => {
        if (result.status === 'fulfilled') {
          totalCount += result.value.count;
          if (result.value.latestModified > latestModified) {
            latestModified = result.value.latestModified;
          }
        }
      });

      // Changed if count different or newer file exists
      const changed = totalCount !== cachedCount || latestModified > cachedLatestModified;

      return { changed, fileCount: totalCount, latestModified };
    } catch (error) {
      console.error('Check changes error:', error);
      return { changed: false };
    }
  }

  // Get summary of files in folder (minimal fields for fast response)
  async getFilesSummary(folderId) {
    const q = `'${folderId}' in parents and (fileExtension='pes' or fileExtension='emb') and trashed=false`;

    const params = new URLSearchParams({
      q: q,
      key: this.apiKey,
      fields: 'files(id,modifiedTime)',
      pageSize: '1000',
      orderBy: 'modifiedTime desc' // Get newest first
    });

    const response = await fetch(`${this.baseUrl}/files?${params}`);

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    const files = data.files || [];

    return {
      count: files.length,
      latestModified: files.length > 0 ? files[0].modifiedTime : ''
    };
  }

  // Search directly via API (fast, like Google Drive)
  async searchFiles(query = '') {
    if (!this.apiKey) throw new Error('API Key chưa được cấu hình');
    if (this.folderIds.length === 0) throw new Error('Chưa có Folder ID nào');

    // If no query, load all files
    if (!query.trim()) {
      if (this.allFiles.length === 0) {
        await this.loadAllFiles();
      }
      return this.pairFiles(this.allFiles);
    }

    // Search directly via API - much faster!
    const results = await Promise.allSettled(
      this.folderIds.map(folderId => this.searchInFolder(folderId, query))
    );

    const allFoundFiles = [];
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        allFoundFiles.push(...result.value);
      }
    });

    // Remove duplicates
    const uniqueFiles = new Map();
    for (const file of allFoundFiles) {
      if (!uniqueFiles.has(file.id)) {
        uniqueFiles.set(file.id, file);
      }
    }

    return this.pairFiles(Array.from(uniqueFiles.values()));
  }

  // Search in a single folder via API
  async searchInFolder(folderId, query) {
    // Build query: name contains each term (AND logic)
    const terms = query.trim().split(/\s+/);
    const nameConditions = terms.map(term => `name contains '${term.replace(/'/g, "\\'")}'`).join(' and ');

    const q = `'${folderId}' in parents and (fileExtension='pes' or fileExtension='emb') and trashed=false and ${nameConditions}`;

    const params = new URLSearchParams({
      q: q,
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

    const data = await response.json();
    return data.files || [];
  }

  // Pair PES and EMB files - show ALL files (even without pair)
  pairFiles(files) {
    const fileMap = new Map();

    files.forEach(file => {
      const lastDot = file.name.lastIndexOf('.');
      const baseName = lastDot > 0 ? file.name.substring(0, lastDot) : file.name;
      const ext = lastDot > 0 ? file.name.substring(lastDot + 1).toLowerCase() : '';

      if (!fileMap.has(baseName)) {
        fileMap.set(baseName, { name: baseName, pes: null, emb: null });
      }

      const pair = fileMap.get(baseName);
      const fileInfo = {
        id: file.id,
        name: file.name,
        size: file.size,
        modifiedTime: file.modifiedTime,
        link: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
      };

      if (ext === 'pes') {
        pair.pes = fileInfo;
      } else if (ext === 'emb') {
        pair.emb = fileInfo;
      }
    });

    // Return ALL files - both paired and unpaired (PES only or EMB only)
    return Array.from(fileMap.values()).filter(pair => pair.pes !== null || pair.emb !== null);
  }

  // Download file content (for PES parsing) - uses background script to avoid CORS
  async downloadFile(fileId) {
    if (!this.apiKey) throw new Error('API Key chưa được cấu hình');

    // Send message to background script to download (avoids CORS)
    const response = await chrome.runtime.sendMessage({
      action: 'downloadFile',
      fileId: fileId,
      apiKey: this.apiKey
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to download file');
    }

    return new Uint8Array(response.data);
  }

  // Clear cache (force reload)
  clearCache() {
    this.allFiles = [];
  }

  static formatSize(bytes) {
    if (!bytes) return 'N/A';
    bytes = parseInt(bytes);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  static extractFolderId(input) {
    if (/^[a-zA-Z0-9_-]+$/.test(input) && input.length > 20) {
      return input;
    }

    const folderMatch = input.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) {
      return folderMatch[1];
    }

    return input;
  }
}

window.DriveAPI = DriveAPI;
