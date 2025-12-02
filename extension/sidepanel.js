// Side Panel Main Logic - API Key Version

class PESViewer {
  constructor() {
    this.driveAPI = new DriveAPI();
    this.files = [];
    this.pesDataCache = new Map();
    this.isConfigured = false;
    this.observer = null;
    this.loadedRows = new Set();
    this.INITIAL_LOAD = 5;

    // Zoom/pan state
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.startPan = { x: 0, y: 0 };

    // Pagination
    this.currentPage = 1;
    this.itemsPerPage = 10;

    // Request cancellation
    this.abortController = null;
    this.pendingRequests = new Set();

    // Suggestions cache
    this.allFileNames = [];
    this.selectedSuggestionIndex = -1;
    this.hasSearched = false;
    this.CACHE_KEY = 'pes_file_names_cache';

    this.init();
  }

  async init() {
    this.bindElements();
    this.bindEvents();
    await this.loadSettings();

    // Load cached suggestions instantly
    if (this.isConfigured) {
      this.loadCachedFileNames();
    }
  }

  // ==================== Cache Methods ====================

  loadCachedFileNames() {
    try {
      const cached = localStorage.getItem(this.CACHE_KEY);
      if (cached) {
        const { names, folderIds } = JSON.parse(cached);
        const currentFolders = this.driveAPI.folderIds.sort().join(',');
        const cachedFolders = (folderIds || []).sort().join(',');

        if (cachedFolders === currentFolders && names?.length > 0) {
          this.allFileNames = names;
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  saveCacheFileNames() {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify({
        names: this.allFileNames,
        folderIds: this.driveAPI.folderIds
      }));
    } catch (e) {}
  }

  clearCache() {
    localStorage.removeItem(this.CACHE_KEY);
    this.allFileNames = [];
    this.driveAPI.clearCache();
  }

  // ==================== UI Binding ====================

  bindElements() {
    this.settingsBtn = document.getElementById('settingsBtn');
    this.settingsPanel = document.getElementById('settingsPanel');
    this.apiKeyInput = document.getElementById('apiKeyInput');
    this.foldersInput = document.getElementById('foldersInput');
    this.saveSettingsBtn = document.getElementById('saveSettingsBtn');
    this.searchInput = document.getElementById('searchInput');
    this.searchBtn = document.getElementById('searchBtn');
    this.fileGrid = document.getElementById('fileGrid');
    this.fileCount = document.getElementById('fileCount');
    this.loadingIndicator = document.getElementById('loadingIndicator');
    this.emptyState = document.getElementById('emptyState');
    this.configRequired = document.getElementById('configRequired');
    this.toast = document.getElementById('toast');
    this.toastMessage = document.getElementById('toastMessage');
    this.previewModal = document.getElementById('previewModal');
    this.previewContainer = document.getElementById('previewContainer');
    this.previewInfo = document.getElementById('previewInfo');
    this.closePreview = document.getElementById('closePreview');
    this.searchSuggestions = document.getElementById('searchSuggestions');
    this.refreshBtn = document.getElementById('refreshBtn');
  }

  bindEvents() {
    this.settingsBtn.addEventListener('click', () => this.toggleSettings());
    this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
    this.refreshBtn.addEventListener('click', () => this.handleRefresh());
    this.searchBtn.addEventListener('click', () => this.handleSearch());

    this.searchInput.addEventListener('input', () => {
      this.hasSearched = false;
      this.handleSearchInput();
    });
    this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrapper')) this.hideSuggestions();
    });

    this.fileGrid.addEventListener('contextmenu', (e) => {
      const cell = e.target.closest('.file-cell');
      if (cell) {
        e.preventDefault();
        this.handleRightClick(cell);
      }
    });

    this.closePreview.addEventListener('click', () => this.hidePreviewModal());
    this.previewModal.addEventListener('click', (e) => {
      if (e.target === this.previewModal) this.hidePreviewModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.previewModal.style.display !== 'none') {
        this.hidePreviewModal();
      }
    });
  }

  // ==================== Settings ====================

  toggleSettings() {
    this.settingsPanel.style.display = this.settingsPanel.style.display !== 'none' ? 'none' : 'block';
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['apiKey', 'folderIds']);
      if (result.apiKey) {
        this.apiKeyInput.value = result.apiKey;
        this.driveAPI.setApiKey(result.apiKey);
      }
      if (result.folderIds?.length > 0) {
        this.foldersInput.value = result.folderIds.join('\n');
        this.driveAPI.setFolderIds(result.folderIds);
      }
      this.updateConfigUI();
    } catch (e) {}
  }

  async saveSettings() {
    const apiKey = this.apiKeyInput.value.trim();
    const folderIds = this.foldersInput.value.trim()
      .split('\n')
      .map(line => DriveAPI.extractFolderId(line.trim()))
      .filter(id => id);

    if (!apiKey) return this.showToast('Vui lòng nhập API Key');
    if (!folderIds.length) return this.showToast('Vui lòng nhập ít nhất 1 Folder ID');

    try {
      await chrome.storage.local.set({ apiKey, folderIds });
      this.driveAPI.setApiKey(apiKey);
      this.driveAPI.setFolderIds(folderIds);
      this.clearCache();
      this.updateConfigUI();
      this.toggleSettings();
      this.showToast(`Đã lưu ${folderIds.length} folder!`);
      this.handleSearch();
    } catch (e) {
      this.showToast('Lỗi lưu cài đặt');
    }
  }

  updateConfigUI() {
    this.isConfigured = this.driveAPI.isConfigured();
    this.configRequired.style.display = this.isConfigured ? 'none' : 'flex';
    this.emptyState.style.display = this.isConfigured ? 'flex' : 'none';
    if (!this.isConfigured) {
      this.fileGrid.innerHTML = '';
      this.fileCount.textContent = 'Found: 0 files';
    }
  }

  // ==================== Search ====================

  async handleSearch() {
    if (!this.isConfigured) {
      this.showToast('Vui lòng cấu hình API Key và Folder ID trước');
      return this.toggleSettings();
    }

    const query = this.searchInput.value.trim();
    this.hasSearched = true;
    this.hideSuggestions();
    this.showLoading(true);
    this.fileGrid.innerHTML = '';
    this.loadedRows.clear();
    this.pesDataCache.clear();

    try {
      this.files = await this.driveAPI.searchFiles(query);
      this.currentPage = 1;
      this.fileCount.textContent = `Found: ${this.files.length} files`;

      if (this.files.length === 0) {
        this.emptyState.style.display = 'flex';
        this.emptyState.querySelector('p').textContent = 'Không tìm thấy file PES/EMB nào';
      } else {
        this.emptyState.style.display = 'none';
        this.renderPage();
      }

      // Update suggestions cache from search results
      if (this.files.length > 0) {
        const newNames = this.files.map(f => f.name);
        const combined = new Set([...this.allFileNames, ...newNames]);
        if (combined.size > this.allFileNames.length) {
          this.allFileNames = [...combined].sort();
          this.saveCacheFileNames();
        }
      }
    } catch (error) {
      this.showToast('Lỗi: ' + error.message);
    } finally {
      this.showLoading(false);
    }
  }

  async handleRefresh() {
    this.clearCache();
    this.showToast('Đang tải lại...');
    await this.handleSearch();
  }

  // ==================== Pagination ====================

  get totalPages() {
    return Math.ceil(this.files.length / this.itemsPerPage);
  }

  get currentPageFiles() {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.files.slice(start, start + this.itemsPerPage);
  }

  goToPage(page) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.renderPage();
  }

  renderPage() {
    this.cancelPendingRequests();
    if (this.observer) this.observer.disconnect();

    this.fileGrid.innerHTML = '';
    this.loadedRows.clear();

    this.fileGrid.appendChild(this.createPagination('top'));

    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    this.currentPageFiles.forEach((filePair, i) => {
      this.fileGrid.appendChild(this.createFileRow(filePair, startIndex + i));
    });

    this.fileGrid.appendChild(this.createPagination('bottom'));
    this.setupLazyLoading();
    this.loadInitialThumbnails();
    this.fileGrid.scrollTop = 0;
  }

  createPagination(position) {
    const container = document.createElement('div');
    container.className = `pagination pagination-${position}`;

    const totalPages = this.totalPages;
    if (totalPages <= 1) {
      container.style.display = 'none';
      return container;
    }

    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.textContent = '‹';
    prevBtn.disabled = this.currentPage === 1;
    prevBtn.addEventListener('click', () => this.goToPage(this.currentPage - 1));
    container.appendChild(prevBtn);

    this.getPageNumbers().forEach(pageNum => {
      if (pageNum === '...') {
        const dots = document.createElement('span');
        dots.className = 'page-dots';
        dots.textContent = '...';
        container.appendChild(dots);
      } else {
        const btn = document.createElement('button');
        btn.className = `page-btn ${pageNum === this.currentPage ? 'active' : ''}`;
        btn.textContent = pageNum;
        btn.addEventListener('click', () => this.goToPage(pageNum));
        container.appendChild(btn);
      }
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.textContent = '›';
    nextBtn.disabled = this.currentPage === totalPages;
    nextBtn.addEventListener('click', () => this.goToPage(this.currentPage + 1));
    container.appendChild(nextBtn);

    const info = document.createElement('span');
    info.className = 'page-info';
    const start = (this.currentPage - 1) * this.itemsPerPage + 1;
    const end = Math.min(this.currentPage * this.itemsPerPage, this.files.length);
    info.textContent = `${start}-${end} / ${this.files.length}`;
    container.appendChild(info);

    return container;
  }

  getPageNumbers() {
    const total = this.totalPages;
    const current = this.currentPage;
    const pages = [];

    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (current > 3) pages.push('...');
      for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
        pages.push(i);
      }
      if (current < total - 2) pages.push('...');
      pages.push(total);
    }
    return pages;
  }

  // ==================== File Grid ====================

  createFileRow(filePair, index) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.dataset.index = index;

    const baseName = filePair.name;

    row.appendChild(this.createFileCell(filePair, 'pes', baseName, index));
    row.appendChild(this.createFileCell(filePair, 'emb', baseName, index));

    return row;
  }

  createFileCell(filePair, type, baseName, index) {
    const cell = document.createElement('div');
    cell.className = `file-cell ${type}-cell`;
    cell.dataset.type = type;

    const fileData = filePair[type];
    cell.dataset.link = fileData?.link || '';

    if (fileData) {
      const isPes = type === 'pes';
      cell.innerHTML = `
        ${isPes ? `<button class="btn-zoom" title="Xem lớn">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="M21 21l-4.35-4.35"></path>
            <path d="M11 8v6M8 11h6"></path>
          </svg>
        </button>` : ''}
        <div class="thumbnail-container">
          <div class="thumbnail-placeholder ${isPes ? 'skeleton' : ''}" style="width:100%;height:100%">${isPes ? '' : '📄'}</div>
        </div>
        <div class="file-info">
          <span class="file-badge ${type}">${type.toUpperCase()}</span>
          <span class="file-name" data-fullname="${this.escapeHtml(baseName)}" title="${this.escapeHtml(baseName)}">${this.escapeHtml(baseName)}</span>
          <span class="file-size">${DriveAPI.formatSize(fileData.size)}</span>
        </div>
      `;

      const thumbnail = cell.querySelector('.thumbnail-container');
      thumbnail.addEventListener('click', (e) => {
        if (!e.target.closest('.btn-zoom')) {
          e.stopPropagation();
          this.handleLeftClick(cell);
        }
      });
      thumbnail.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleRightClick(cell);
      });

      if (isPes) {
        cell.querySelector('.btn-zoom').addEventListener('click', (e) => {
          e.stopPropagation();
          this.showPreview(index);
        });
      }

      cell.querySelector('.file-name').addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.copyFileName(baseName);
      });
    } else {
      cell.innerHTML = `
        <div class="thumbnail-container">
          <div class="thumbnail-placeholder">—</div>
        </div>
        <div class="file-info">
          <span class="file-badge ${type}" style="opacity:0.3">${type.toUpperCase()}</span>
          <span class="file-name" style="opacity:0.5">Không có file ${type.toUpperCase()}</span>
          <span class="file-size">—</span>
        </div>
      `;
      cell.style.opacity = '0.5';
      cell.style.cursor = 'default';
    }

    return cell;
  }

  // ==================== Lazy Loading ====================

  setupLazyLoading() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(entry.target.dataset.index);
            if (!this.loadedRows.has(index)) {
              this.loadThumbnail(entry.target, index);
            }
          }
        });
      },
      { root: this.fileGrid, rootMargin: '100px', threshold: 0.1 }
    );

    document.querySelectorAll('.file-row').forEach(row => this.observer.observe(row));
  }

  async loadInitialThumbnails() {
    const rows = Array.from(document.querySelectorAll('.file-row')).slice(0, this.INITIAL_LOAD);
    for (const row of rows) {
      const index = parseInt(row.dataset.index);
      if (!this.loadedRows.has(index)) {
        await this.loadThumbnail(row, index);
      }
    }
  }

  cancelPendingRequests() {
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();
    this.pendingRequests.clear();
  }

  async loadThumbnail(row, index) {
    if (this.loadedRows.has(index)) return;
    this.loadedRows.add(index);

    const filePair = this.files[index];
    if (!filePair?.pes) return;

    const container = row.querySelector('.pes-cell .thumbnail-container');
    if (!container) return;

    const requestId = `${index}-${Date.now()}`;
    this.pendingRequests.add(requestId);

    try {
      if (this.abortController?.signal.aborted) return;

      const fileData = await this.driveAPI.downloadFile(filePair.pes.id);
      if (this.abortController?.signal.aborted) return;

      const pesData = await PESParser.parse(fileData, this.abortController?.signal);
      if (this.abortController?.signal.aborted || !document.body.contains(row)) return;

      pesData.modifiedTime = filePair.pes.modifiedTime;
      this.pesDataCache.set(index, pesData);

      const img = document.createElement('img');
      img.src = pesData.thumbnail;
      img.alt = filePair.name;
      container.innerHTML = '';
      container.appendChild(img);
    } catch (error) {
      if (error.name !== 'AbortError' && document.body.contains(row)) {
        container.innerHTML = '<div class="thumbnail-placeholder">⚠️</div>';
      }
    } finally {
      this.pendingRequests.delete(requestId);
    }
  }

  // ==================== Preview Modal ====================

  showPreview(index) {
    const filePair = this.files[index];
    if (!filePair?.pes) return;

    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;

    this.previewModal.style.display = 'flex';
    this.previewContainer.innerHTML = `
      <div class="preview-loading">
        <div class="spinner"></div>
        <span>Đang tải...</span>
      </div>
    `;
    this.previewInfo.innerHTML = '';

    const pesData = this.pesDataCache.get(index);
    if (pesData?.preview) {
      this.renderPreview(pesData, filePair);
    } else {
      this.loadAndRenderPreview(index, filePair);
    }
  }

  async loadAndRenderPreview(index, filePair) {
    try {
      const fileData = await this.driveAPI.downloadFile(filePair.pes.id);
      const pesData = await PESParser.parse(fileData);
      pesData.modifiedTime = filePair.pes.modifiedTime;
      this.pesDataCache.set(index, pesData);
      this.renderPreview(pesData, filePair);
    } catch (error) {
      this.previewContainer.innerHTML = '<div class="preview-loading"><span>⚠️ Lỗi tải file</span></div>';
    }
  }

  renderPreview(pesData, filePair) {
    this.previewContainer.innerHTML = `
      <div class="zoom-container" id="zoomContainer">
        <img src="${pesData.preview}" alt="${filePair.name}" id="previewImage" draggable="false">
      </div>
      <div class="zoom-controls">
        <button class="zoom-btn" id="zoomOut" title="Thu nhỏ">−</button>
        <span class="zoom-level" id="zoomLevelDisplay">100%</span>
        <button class="zoom-btn" id="zoomIn" title="Phóng to">+</button>
        <button class="zoom-btn" id="zoomReset" title="Reset">⟲</button>
      </div>
    `;

    const zoomContainer = document.getElementById('zoomContainer');
    const previewImage = document.getElementById('previewImage');
    const zoomLevelDisplay = document.getElementById('zoomLevelDisplay');

    const updateTransform = () => {
      const scale = this.baseScale * this.zoomLevel;
      previewImage.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
      zoomLevelDisplay.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    };

    previewImage.onload = () => {
      const rect = zoomContainer.getBoundingClientRect();
      this.baseScale = Math.min(rect.width / previewImage.naturalWidth, rect.height / previewImage.naturalHeight) * 0.95;
      this.zoomLevel = 1;
      this.panX = 0;
      this.panY = 0;
      updateTransform();
    };

    document.getElementById('zoomIn').addEventListener('click', () => {
      this.zoomLevel = Math.min(10, this.zoomLevel + 0.25);
      updateTransform();
    });

    document.getElementById('zoomOut').addEventListener('click', () => {
      this.zoomLevel = Math.max(0.25, this.zoomLevel - 0.25);
      updateTransform();
    });

    document.getElementById('zoomReset').addEventListener('click', () => {
      this.zoomLevel = 1;
      this.panX = 0;
      this.panY = 0;
      updateTransform();
    });

    zoomContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomLevel = Math.max(0.25, Math.min(10, this.zoomLevel + (e.deltaY > 0 ? -0.1 : 0.1)));
      updateTransform();
    });

    zoomContainer.addEventListener('mousedown', (e) => {
      this.isPanning = true;
      this.startPan = { x: e.clientX - this.panX, y: e.clientY - this.panY };
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.startPan.x;
        this.panY = e.clientY - this.startPan.y;
        updateTransform();
      }
    });

    document.addEventListener('mouseup', () => this.isPanning = false);

    // File info
    const threadsHtml = pesData.threads?.length > 0
      ? pesData.threads.map((t, i) => `
          <div class="thread-item">
            <span class="thread-color" style="background:${t.color}"></span>
            <span class="thread-code">${t.code || `#${i + 1}`}</span>
          </div>
        `).join('')
      : '';

    this.previewInfo.innerHTML = `
      <div class="file-name">${filePair.name}</div>
      <div class="file-details">
        ${pesData.stitchCount} stitches • ${pesData.colorCount} colors • ${DriveAPI.formatSize(filePair.pes?.size)}
      </div>
      ${threadsHtml ? `<div class="thread-list">${threadsHtml}</div>` : ''}
    `;
  }

  hidePreviewModal() {
    this.previewModal.style.display = 'none';
    this.isPanning = false;
  }

  // ==================== Actions ====================

  handleLeftClick(cell) {
    if (cell.dataset.link) window.open(cell.dataset.link, '_blank');
  }

  handleRightClick(cell) {
    if (cell.dataset.link) {
      navigator.clipboard.writeText(cell.dataset.link)
        .then(() => this.showToast('Link đã được copy!'))
        .catch(() => this.showToast('Không thể copy link'));
    }
  }

  copyFileName(name) {
    if (name) {
      navigator.clipboard.writeText(name)
        .then(() => this.showToast('Tên file đã được copy!'))
        .catch(() => this.showToast('Không thể copy'));
    }
  }

  showLoading(show) {
    this.loadingIndicator.style.display = show ? 'flex' : 'none';
  }

  showToast(message) {
    this.toastMessage.textContent = message;
    this.toast.classList.add('show');
    setTimeout(() => this.toast.classList.remove('show'), 2000);
  }

  // ==================== Suggestions ====================

  handleSearchInput() {
    if (this.hasSearched) return;

    const query = this.searchInput.value.trim();
    if (query.length < 1) return this.hideSuggestions();

    if (this.allFileNames.length > 0) {
      this.showSuggestions(query);
    }
  }

  showSuggestions(query) {
    if (!this.allFileNames.length) return;

    const queryLower = query.toLowerCase();
    const matches = this.allFileNames
      .filter(name => name.toLowerCase().includes(queryLower))
      .slice(0, 10);

    if (!matches.length) return this.hideSuggestions();

    this.searchSuggestions.innerHTML = matches.map((name, i) => {
      const idx = name.toLowerCase().indexOf(queryLower);
      const highlighted = this.escapeHtml(name.slice(0, idx)) +
        `<span class="match">${this.escapeHtml(name.slice(idx, idx + query.length))}</span>` +
        this.escapeHtml(name.slice(idx + query.length));

      return `<div class="suggestion-item${i === this.selectedSuggestionIndex ? ' selected' : ''}"
                   data-name="${this.escapeHtml(name)}">${highlighted}</div>`;
    }).join('');

    this.searchSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        this.searchInput.value = item.dataset.name;
        this.hideSuggestions();
        this.handleSearch();
      });
    });

    this.searchSuggestions.classList.add('show');
    this.selectedSuggestionIndex = -1;
  }

  handleSearchKeydown(e) {
    const items = this.searchSuggestions.querySelectorAll('.suggestion-item');
    const hasSuggestions = items.length > 0 && this.searchSuggestions.classList.contains('show');

    if (e.key === 'Enter') {
      e.preventDefault();
      if (hasSuggestions && this.selectedSuggestionIndex >= 0 && items[this.selectedSuggestionIndex]) {
        this.searchInput.value = items[this.selectedSuggestionIndex].dataset.name;
      }
      this.hideSuggestions();
      this.handleSearch();
      return;
    }

    if (!hasSuggestions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedSuggestionIndex = Math.min(this.selectedSuggestionIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
    } else if (e.key === 'Tab' && this.selectedSuggestionIndex >= 0) {
      e.preventDefault();
      this.searchInput.value = items[this.selectedSuggestionIndex].dataset.name;
      this.hideSuggestions();
      return;
    } else if (e.key === 'Escape') {
      return this.hideSuggestions();
    }

    items.forEach((item, i) => item.classList.toggle('selected', i === this.selectedSuggestionIndex));
    if (this.selectedSuggestionIndex >= 0) {
      items[this.selectedSuggestionIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  hideSuggestions() {
    this.searchSuggestions.classList.remove('show');
    this.selectedSuggestionIndex = -1;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.pesViewer = new PESViewer();
});
