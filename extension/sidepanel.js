// Side Panel Main Logic - API Key Version (No OAuth)

class PESViewer {
  constructor() {
    this.driveAPI = new DriveAPI();
    this.files = [];
    this.pesDataCache = new Map(); // Cache parsed PES data for zoom
    this.isConfigured = false;
    this.observer = null;
    this.loadedRows = new Set();
    this.INITIAL_LOAD = 5;
    this.LOAD_BATCH = 3;

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

    // Fuzzy search
    this.allFileNames = []; // Cache all file names for suggestions
    this.selectedSuggestionIndex = -1;
    this.hasSearched = false; // Track if user has searched

    this.init();
  }

  async init() {
    this.bindElements();
    this.bindEvents();
    await this.loadSettings();

    // Preload file list in background for faster fuzzy search
    if (this.isConfigured) {
      this.preloadFiles();
    }
  }

  // Preload files in background (non-blocking)
  async preloadFiles() {
    try {
      await this.driveAPI.loadAllFiles();
      // Remove .pes/.emb extension from file names for suggestions
      this.allFileNames = [...new Set(this.driveAPI.allFiles.map(f =>
        f.name.replace(/\.(pes|emb)$/i, '')
      ))].sort();
    } catch (error) {
      console.error('Preload error:', error);
    }
  }

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

    // Preview modal elements
    this.previewModal = document.getElementById('previewModal');
    this.previewContainer = document.getElementById('previewContainer');
    this.previewInfo = document.getElementById('previewInfo');
    this.closePreview = document.getElementById('closePreview');

    // Search suggestions
    this.searchSuggestions = document.getElementById('searchSuggestions');

    // Refresh button
    this.refreshBtn = document.getElementById('refreshBtn');
  }

  bindEvents() {
    // Settings toggle
    this.settingsBtn.addEventListener('click', () => this.toggleSettings());
    this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());

    // Refresh - clear cache and reload
    this.refreshBtn.addEventListener('click', () => this.handleRefresh());

    // Search
    this.searchBtn.addEventListener('click', () => this.handleSearch());

    // Fuzzy search suggestions
    this.searchInput.addEventListener('input', () => {
      this.hasSearched = false; // Reset when user types
      this.handleSearchInput();
    });
    this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrapper')) {
        this.hideSuggestions();
      }
    });

    // Context menu prevention (for right-click copy)
    this.fileGrid.addEventListener('contextmenu', (e) => {
      const cell = e.target.closest('.file-cell');
      if (cell) {
        e.preventDefault();
        this.handleRightClick(cell);
      }
    });

    // Preview modal events
    this.closePreview.addEventListener('click', () => this.hidePreviewModal());
    this.previewModal.addEventListener('click', (e) => {
      if (e.target === this.previewModal) {
        this.hidePreviewModal();
      }
    });

    // ESC to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.previewModal.style.display !== 'none') {
        this.hidePreviewModal();
      }
    });
  }

  toggleSettings() {
    const isVisible = this.settingsPanel.style.display !== 'none';
    this.settingsPanel.style.display = isVisible ? 'none' : 'block';
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['apiKey', 'folderIds']);

      if (result.apiKey) {
        this.apiKeyInput.value = result.apiKey;
        this.driveAPI.setApiKey(result.apiKey);
      }

      if (result.folderIds && result.folderIds.length > 0) {
        this.foldersInput.value = result.folderIds.join('\n');
        this.driveAPI.setFolderIds(result.folderIds);
      }

      this.updateConfigUI();
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async saveSettings() {
    const apiKey = this.apiKeyInput.value.trim();
    const foldersText = this.foldersInput.value.trim();

    // Parse multiple folders (one per line)
    const folderIds = foldersText
      .split('\n')
      .map(line => DriveAPI.extractFolderId(line.trim()))
      .filter(id => id);

    if (!apiKey) {
      this.showToast('Vui lòng nhập API Key');
      return;
    }

    if (folderIds.length === 0) {
      this.showToast('Vui lòng nhập ít nhất 1 Folder ID hoặc URL');
      return;
    }

    try {
      await chrome.storage.local.set({ apiKey, folderIds });

      this.driveAPI.setApiKey(apiKey);
      this.driveAPI.setFolderIds(folderIds);

      this.updateConfigUI();
      this.toggleSettings();
      this.showToast(`Đã lưu ${folderIds.length} folder!`);

      // Auto search after config
      this.handleSearch();
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showToast('Lỗi lưu cài đặt');
    }
  }

  updateConfigUI() {
    this.isConfigured = this.driveAPI.isConfigured();

    if (this.isConfigured) {
      this.configRequired.style.display = 'none';
      this.emptyState.style.display = 'flex';
    } else {
      this.configRequired.style.display = 'flex';
      this.emptyState.style.display = 'none';
      this.fileGrid.innerHTML = '';
      this.fileCount.textContent = 'Found: 0 files';
    }
  }

  async handleSearch() {
    if (!this.isConfigured) {
      this.showToast('Vui lòng cấu hình API Key và Folder ID trước');
      this.toggleSettings();
      return;
    }

    const query = this.searchInput.value.trim();

    // Mark as searched - hide suggestions
    this.hasSearched = true;
    this.hideSuggestions();

    this.showLoading(true);
    this.fileGrid.innerHTML = '';
    this.loadedRows.clear();
    this.pesDataCache.clear();

    try {
      this.files = await this.driveAPI.searchFiles(query);
      this.currentPage = 1; // Reset to first page on new search
      this.fileCount.textContent = `Found: ${this.files.length} files`;

      if (this.files.length === 0) {
        this.emptyState.style.display = 'flex';
        this.emptyState.querySelector('p').textContent = 'Không tìm thấy file PES/EMB nào';
      } else {
        this.emptyState.style.display = 'none';
        this.renderPage();
      }
    } catch (error) {
      console.error('Search error:', error);
      this.showToast('Lỗi: ' + error.message);
    } finally {
      this.showLoading(false);
    }
  }

  // Refresh - clear cache and reload from Drive
  async handleRefresh() {
    this.driveAPI.clearCache();
    this.allFileNames = []; // Clear fuzzy search cache
    this.showToast('Đang tải lại...');
    await this.handleSearch();
  }

  get totalPages() {
    return Math.ceil(this.files.length / this.itemsPerPage);
  }

  get currentPageFiles() {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    return this.files.slice(start, end);
  }

  renderPage() {
    // Cancel all pending requests from previous page
    this.cancelPendingRequests();

    // Clear previous observer
    if (this.observer) {
      this.observer.disconnect();
    }

    this.fileGrid.innerHTML = '';
    this.loadedRows.clear();

    // Render pagination at top
    this.fileGrid.appendChild(this.createPagination('top'));

    // Create rows for current page files
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    this.currentPageFiles.forEach((filePair, i) => {
      const row = this.createFileRow(filePair, startIndex + i);
      this.fileGrid.appendChild(row);
    });

    // Render pagination at bottom
    this.fileGrid.appendChild(this.createPagination('bottom'));

    // Setup Intersection Observer for lazy loading
    this.setupLazyLoading();

    // Load thumbnails for current page
    this.loadInitialThumbnails();

    // Scroll to top
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

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.textContent = '‹';
    prevBtn.disabled = this.currentPage === 1;
    prevBtn.addEventListener('click', () => this.goToPage(this.currentPage - 1));
    container.appendChild(prevBtn);

    // Page numbers
    const pageNumbers = this.getPageNumbers();
    pageNumbers.forEach(pageNum => {
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

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.textContent = '›';
    nextBtn.disabled = this.currentPage === totalPages;
    nextBtn.addEventListener('click', () => this.goToPage(this.currentPage + 1));
    container.appendChild(nextBtn);

    // Page info
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

      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);

      for (let i = start; i <= end; i++) pages.push(i);

      if (current < total - 2) pages.push('...');
      pages.push(total);
    }

    return pages;
  }

  goToPage(page) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.renderPage();
  }

  createFileRow(filePair, index) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.dataset.index = index;

    const hasPes = filePair.pes !== null;
    const hasEmb = filePair.emb !== null;

    // PES Cell (left)
    const pesCell = document.createElement('div');
    pesCell.className = 'file-cell pes-cell';
    pesCell.dataset.type = 'pes';
    pesCell.dataset.link = filePair.pes?.link || '';
    pesCell.dataset.fileId = filePair.pes?.id || '';
    pesCell.dataset.index = index;

    // Get base name without extension for copy
    const baseName = filePair.name.replace(/\.(pes|emb)$/i, '');

    if (hasPes) {
      pesCell.innerHTML = `
        <button class="btn-zoom" title="Xem lớn">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="M21 21l-4.35-4.35"></path>
            <path d="M11 8v6M8 11h6"></path>
          </svg>
        </button>
        <div class="thumbnail-container">
          <div class="thumbnail-placeholder skeleton" style="width:100%;height:100%"></div>
        </div>
        <div class="file-info">
          <span class="file-badge pes">PES</span>
          <span class="file-name" data-fullname="${this.escapeHtml(baseName)}" title="${this.escapeHtml(baseName)}">${this.escapeHtml(baseName)}</span>
          <span class="file-size">${DriveAPI.formatSize(filePair.pes?.size)}</span>
        </div>
      `;

      // Thumbnail only: Left click opens link, right click copies link
      const pesThumbnail = pesCell.querySelector('.thumbnail-container');
      pesThumbnail.addEventListener('click', (e) => {
        if (!e.target.closest('.btn-zoom')) {
          e.stopPropagation();
          this.handleLeftClick(pesCell);
        }
      });
      pesThumbnail.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleRightClick(pesCell);
      });

      // Zoom button click
      const zoomBtn = pesCell.querySelector('.btn-zoom');
      zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showPreview(index);
      });

      // File name right-click to copy name without extension
      const pesFileName = pesCell.querySelector('.file-name');
      pesFileName.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.copyFileName(pesFileName.dataset.fullname);
      });
    } else {
      pesCell.innerHTML = `
        <div class="thumbnail-container">
          <div class="thumbnail-placeholder">—</div>
        </div>
        <div class="file-info">
          <span class="file-badge pes" style="opacity:0.3">PES</span>
          <span class="file-name" style="opacity:0.5">Không có file PES</span>
          <span class="file-size">—</span>
        </div>
      `;
      pesCell.style.opacity = '0.5';
      pesCell.style.cursor = 'default';
    }

    // EMB Cell (right)
    const embCell = document.createElement('div');
    embCell.className = 'file-cell emb-cell';
    embCell.dataset.type = 'emb';
    embCell.dataset.link = filePair.emb?.link || '';

    if (hasEmb) {
      embCell.innerHTML = `
        <div class="thumbnail-container">
          <div class="thumbnail-placeholder">📄</div>
        </div>
        <div class="file-info">
          <span class="file-badge emb">EMB</span>
          <span class="file-name" data-fullname="${this.escapeHtml(baseName)}" title="${this.escapeHtml(baseName)}">${this.escapeHtml(baseName)}</span>
          <span class="file-size">${DriveAPI.formatSize(filePair.emb?.size)}</span>
        </div>
      `;
      // Thumbnail only: Left click opens link, right click copies link
      const embThumbnail = embCell.querySelector('.thumbnail-container');
      embThumbnail.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleLeftClick(embCell);
      });
      embThumbnail.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleRightClick(embCell);
      });

      // File name right-click to copy name without extension
      const embFileName = embCell.querySelector('.file-name');
      embFileName.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.copyFileName(embFileName.dataset.fullname);
      });
    } else {
      embCell.innerHTML = `
        <div class="thumbnail-container">
          <div class="thumbnail-placeholder">—</div>
        </div>
        <div class="file-info">
          <span class="file-badge emb" style="opacity:0.3">EMB</span>
          <span class="file-name" style="opacity:0.5">Không có file EMB</span>
          <span class="file-size">—</span>
        </div>
      `;
      embCell.style.opacity = '0.5';
      embCell.style.cursor = 'default';
    }

    row.appendChild(pesCell);
    row.appendChild(embCell);

    return row;
  }

  setupLazyLoading() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const row = entry.target;
            const index = parseInt(row.dataset.index);

            if (!this.loadedRows.has(index)) {
              this.loadThumbnail(row, index);
            }
          }
        });
      },
      {
        root: this.fileGrid,
        rootMargin: '100px',
        threshold: 0.1
      }
    );

    // Observe all rows
    document.querySelectorAll('.file-row').forEach((row) => {
      this.observer.observe(row);
    });
  }

  async loadInitialThumbnails() {
    const rows = document.querySelectorAll('.file-row');
    const initialRows = Array.from(rows).slice(0, this.INITIAL_LOAD);

    for (const row of initialRows) {
      const index = parseInt(row.dataset.index);
      if (!this.loadedRows.has(index)) {
        await this.loadThumbnail(row, index);
      }
    }
  }

  // Cancel all pending thumbnail requests
  cancelPendingRequests() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    this.pendingRequests.clear();
  }

  async loadThumbnail(row, index) {
    if (this.loadedRows.has(index)) return;
    this.loadedRows.add(index);

    const filePair = this.files[index];
    if (!filePair) return;

    // Only load thumbnail if PES exists
    if (!filePair.pes) {
      return;
    }

    const pesCell = row.querySelector('.pes-cell');
    if (!pesCell) return; // Row might be removed if page changed

    const thumbnailContainer = pesCell.querySelector('.thumbnail-container');
    if (!thumbnailContainer) return;

    // Track this request
    const requestId = `${index}-${Date.now()}`;
    this.pendingRequests.add(requestId);

    try {
      // Check if aborted before starting
      if (this.abortController?.signal.aborted) {
        this.pendingRequests.delete(requestId);
        return;
      }

      // Download PES file
      const fileData = await this.driveAPI.downloadFile(filePair.pes.id);

      // Check if aborted after download
      if (this.abortController?.signal.aborted) {
        this.pendingRequests.delete(requestId);
        return;
      }

      // Parse PES - now returns PNG directly
      const pesData = await PESParser.parse(fileData, this.abortController?.signal);

      // Check if aborted after parse
      if (this.abortController?.signal.aborted) {
        this.pendingRequests.delete(requestId);
        return;
      }

      // Check if row still exists (page might have changed)
      if (!document.body.contains(row)) {
        this.pendingRequests.delete(requestId);
        return;
      }

      // Cache for zoom preview (include modifiedTime for cache invalidation)
      pesData.modifiedTime = filePair.pes.modifiedTime;
      this.pesDataCache.set(index, pesData);

      // Use thumbnail (30% quality) for grid
      const img = document.createElement('img');
      img.src = pesData.thumbnail;
      img.alt = filePair.name;

      thumbnailContainer.innerHTML = '';
      thumbnailContainer.appendChild(img);

    } catch (error) {
      // Ignore abort errors
      if (error.name === 'AbortError') {
        this.pendingRequests.delete(requestId);
        return;
      }
      console.error(`Error loading thumbnail for ${filePair.name}:`, error);
      if (document.body.contains(row)) {
        thumbnailContainer.innerHTML = '<div class="thumbnail-placeholder">⚠️</div>';
      }
    } finally {
      this.pendingRequests.delete(requestId);
    }
  }

  // Show preview modal with zoom/pan
  showPreview(index) {
    const filePair = this.files[index];
    if (!filePair || !filePair.pes) return;

    // Reset zoom/pan
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;

    // Show modal with loading state
    this.previewModal.style.display = 'flex';
    this.previewContainer.innerHTML = `
      <div class="preview-loading">
        <div class="spinner"></div>
        <span>Đang tải...</span>
      </div>
    `;
    this.previewInfo.innerHTML = '';

    // Check if we have cached data
    const pesData = this.pesDataCache.get(index);

    if (pesData && pesData.preview) {
      // Use cached data (fast)
      this.renderPreview(pesData, filePair);
    } else {
      // Need to download and parse
      this.loadAndRenderPreview(index, filePair);
    }
  }

  async loadAndRenderPreview(index, filePair) {
    try {
      const fileData = await this.driveAPI.downloadFile(filePair.pes.id);
      const pesData = await PESParser.parse(fileData);
      // Store modifiedTime for cache invalidation
      pesData.modifiedTime = filePair.pes.modifiedTime;
      this.pesDataCache.set(index, pesData);
      this.renderPreview(pesData, filePair);
    } catch (error) {
      console.error('Preview load error:', error);
      this.previewContainer.innerHTML = `
        <div class="preview-loading">
          <span>⚠️ Lỗi tải file</span>
        </div>
      `;
    }
  }

  renderPreview(pesData, filePair) {
    // Create zoomable image container - use preview (70% quality)
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
    const zoomIn = document.getElementById('zoomIn');
    const zoomOut = document.getElementById('zoomOut');
    const zoomReset = document.getElementById('zoomReset');
    const zoomLevelDisplay = document.getElementById('zoomLevelDisplay');

    // Wait for image to load to get dimensions
    previewImage.onload = () => {
      // Calculate base scale to fit image in container
      const containerRect = zoomContainer.getBoundingClientRect();
      const imgWidth = previewImage.naturalWidth;
      const imgHeight = previewImage.naturalHeight;

      const scaleX = containerRect.width / imgWidth;
      const scaleY = containerRect.height / imgHeight;
      this.baseScale = Math.min(scaleX, scaleY) * 0.95; // 95% to have some margin

      this.zoomLevel = 1; // 100% = fit to container
      this.panX = 0;
      this.panY = 0;
      updateTransform();
    };

    // Update transform - use baseScale * zoomLevel
    const updateTransform = () => {
      const scale = this.baseScale * this.zoomLevel;
      previewImage.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
      zoomLevelDisplay.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    };

    // Zoom buttons
    zoomIn.addEventListener('click', () => {
      this.zoomLevel = Math.min(10, this.zoomLevel + 0.25);
      updateTransform();
    });

    zoomOut.addEventListener('click', () => {
      this.zoomLevel = Math.max(0.25, this.zoomLevel - 0.25);
      updateTransform();
    });

    zoomReset.addEventListener('click', () => {
      this.zoomLevel = 1;
      this.panX = 0;
      this.panY = 0;
      updateTransform();
    });

    // Mouse wheel zoom
    zoomContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      this.zoomLevel = Math.max(0.25, Math.min(10, this.zoomLevel + delta));
      updateTransform();
    });

    // Pan with mouse drag (hand tool - always active)
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

    document.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    // Show file info with thread colors (if available)
    const hasThreads = pesData.threads && pesData.threads.length > 0;
    const threadsHtml = hasThreads
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
      ${hasThreads ? `<div class="thread-list">${threadsHtml}</div>` : ''}
    `;
  }

  hidePreviewModal() {
    this.previewModal.style.display = 'none';
    this.isPanning = false;
  }

  handleLeftClick(cell) {
    const link = cell.dataset.link;
    if (link) {
      window.open(link, '_blank');
    }
  }

  handleRightClick(cell) {
    const link = cell.dataset.link;
    if (link) {
      navigator.clipboard.writeText(link).then(() => {
        this.showToast('Link đã được copy!');
      }).catch((err) => {
        console.error('Copy failed:', err);
        this.showToast('Không thể copy link');
      });
    }
  }

  copyFileName(name) {
    if (name) {
      navigator.clipboard.writeText(name).then(() => {
        this.showToast('Tên file đã được copy!');
      }).catch((err) => {
        console.error('Copy failed:', err);
        this.showToast('Không thể copy tên file');
      });
    }
  }

  showLoading(show) {
    this.loadingIndicator.style.display = show ? 'flex' : 'none';
  }

  showToast(message) {
    this.toastMessage.textContent = message;
    this.toast.classList.add('show');

    setTimeout(() => {
      this.toast.classList.remove('show');
    }, 2000);
  }

  // ========== Fuzzy Search Methods ==========

  // Load all file names for suggestions (called after first search)
  async loadAllFileNames() {
    if (this.allFileNames.length > 0) return;

    try {
      const allFiles = await this.driveAPI.searchFiles('');
      // Remove .pes/.emb extension from file names
      this.allFileNames = [...new Set(allFiles.map(f =>
        f.name.replace(/\.(pes|emb)$/i, '')
      ))].sort();
    } catch (error) {
      console.error('Error loading file names:', error);
    }
  }

  // Fuzzy match algorithm
  fuzzyMatch(query, text) {
    query = query.toLowerCase();
    text = text.toLowerCase();

    // Exact match gets highest score
    if (text.includes(query)) {
      const index = text.indexOf(query);
      return {
        matches: true,
        score: 100 - index, // Earlier match = higher score
        matchRanges: [[index, index + query.length]]
      };
    }

    // Fuzzy match: all characters must appear in order
    let queryIndex = 0;
    let matchRanges = [];
    let currentRange = null;
    let score = 0;
    let consecutiveBonus = 0;

    for (let i = 0; i < text.length && queryIndex < query.length; i++) {
      if (text[i] === query[queryIndex]) {
        if (currentRange && currentRange[1] === i) {
          currentRange[1] = i + 1;
          consecutiveBonus += 5;
        } else {
          if (currentRange) matchRanges.push(currentRange);
          currentRange = [i, i + 1];
        }
        queryIndex++;
        score += 10 + consecutiveBonus;

        // Bonus for matching at word start
        if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '_' || text[i - 1] === '-') {
          score += 15;
        }
      } else {
        consecutiveBonus = 0;
      }
    }

    if (currentRange) matchRanges.push(currentRange);

    return {
      matches: queryIndex === query.length,
      score: queryIndex === query.length ? score : 0,
      matchRanges
    };
  }

  // Handle search input for suggestions
  async handleSearchInput() {
    // Don't show suggestions if already searched (user pressed Enter)
    if (this.hasSearched) return;

    const query = this.searchInput.value.trim();

    if (query.length < 1) {
      this.hideSuggestions();
      return;
    }

    // Load file names if not loaded yet
    if (this.allFileNames.length === 0 && this.isConfigured) {
      await this.preloadFiles();
    }

    // Show suggestions if file names are loaded
    if (this.allFileNames.length > 0) {
      this.showSuggestions(query);
    }
  }

  // Show matching suggestions
  showSuggestions(query) {
    if (this.allFileNames.length === 0) return;

    // Find matches with fuzzy algorithm
    const matches = this.allFileNames
      .map(name => ({
        name,
        ...this.fuzzyMatch(query, name)
      }))
      .filter(m => m.matches)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (matches.length === 0) {
      this.hideSuggestions();
      return;
    }

    // Count files for each suggestion
    const fileCounts = {};
    this.files.forEach(f => {
      fileCounts[f.name] = (fileCounts[f.name] || 0) + 1;
    });

    // Render suggestions
    this.searchSuggestions.innerHTML = matches.map((match, index) => {
      // Highlight matched characters
      let highlighted = '';
      let lastIndex = 0;

      match.matchRanges.forEach(([start, end]) => {
        highlighted += this.escapeHtml(match.name.slice(lastIndex, start));
        highlighted += `<span class="match">${this.escapeHtml(match.name.slice(start, end))}</span>`;
        lastIndex = end;
      });
      highlighted += this.escapeHtml(match.name.slice(lastIndex));

      const count = fileCounts[match.name] || '';
      const countHtml = count ? `<span class="suggestion-count">${count}</span>` : '';

      return `
        <div class="suggestion-item${index === this.selectedSuggestionIndex ? ' selected' : ''}"
             data-name="${this.escapeHtml(match.name)}" data-index="${index}">
          ${highlighted}${countHtml}
        </div>
      `;
    }).join('');

    // Bind click events
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

  // Handle all keyboard events in search input
  handleSearchKeydown(e) {
    const items = this.searchSuggestions.querySelectorAll('.suggestion-item');
    const hasSuggestions = items.length > 0 && this.searchSuggestions.classList.contains('show');

    if (e.key === 'Enter') {
      e.preventDefault();
      // If suggestion is selected, use it
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
      this.updateSelectedSuggestion(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
      this.updateSelectedSuggestion(items);
    } else if (e.key === 'Tab' && this.selectedSuggestionIndex >= 0) {
      e.preventDefault();
      const selected = items[this.selectedSuggestionIndex];
      if (selected) {
        this.searchInput.value = selected.dataset.name;
        this.hideSuggestions();
      }
    } else if (e.key === 'Escape') {
      this.hideSuggestions();
    }
  }

  // Update visual selection
  updateSelectedSuggestion(items) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedSuggestionIndex);
    });

    // Scroll selected item into view
    if (this.selectedSuggestionIndex >= 0) {
      items[this.selectedSuggestionIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  // Hide suggestions dropdown
  hideSuggestions() {
    this.searchSuggestions.classList.remove('show');
    this.selectedSuggestionIndex = -1;
  }

  // Escape HTML to prevent XSS
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.pesViewer = new PESViewer();
});
