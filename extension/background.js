// Background Service Worker for PES/EMB Thumbnail Viewer
// Simplified version - No OAuth required

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel behavior - open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Error setting panel behavior:', error));

// Handle file download requests from sidepanel (to avoid CORS issues)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadFile') {
    downloadFile(request.fileId, request.apiKey)
      .then(data => sendResponse({ success: true, data: Array.from(data) }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

async function downloadFile(fileId, apiKey) {
  // Try API download first
  const apiUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`;
  let response = await fetch(apiUrl);

  if (!response.ok) {
    // Try direct download URL
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    response = await fetch(directUrl);
  }

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

console.log('PES/EMB Thumbnail Viewer background service worker loaded');
