// Web Marker Extension - Background Service Worker (Chrome MV3)
// Handles extension lifecycle and communication between content scripts

// Track which tabs have fabric.js loaded to avoid duplicate loading
var fabricLoadedTabs = {};

// Handle action click (extension icon click) - MV3 uses chrome.action instead of chrome.browserAction
chrome.action.onClicked.addListener(function(tab) {
  // Check if fabric.js is already loaded for this tab
  if (fabricLoadedTabs[tab.id] == null || !fabricLoadedTabs[tab.id]) {
    // Mark fabric as loaded for this tab
    fabricLoadedTabs[tab.id] = true;
    
    // Inject fabric.js library first using MV3 scripting API
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["fabric.min.js"]
    }).then(() => {
      // After fabric.js loads, initialize the marker
      initializeMarkerOnTab(tab);
    }).catch((error) => {
      console.log("Error loading fabric.js:", error);
    });
  } else {
    // Fabric already loaded, just initialize marker
    initializeMarkerOnTab(tab);
  }
});

// Reset fabric loaded status when tab is updated (navigated)
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.status === 'loading') {
    fabricLoadedTabs[tabId] = false;
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
  delete fabricLoadedTabs[tabId];
});

// Initialize the marker interface on the specified tab
function initializeMarkerOnTab(tab) {
  // Inject the marker content script using MV3 scripting API
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["marker.js"]
  }).then(() => {
    // Inject the CSS styles using MV3 scripting API
    chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["main.css"]
    }).catch((error) => {
      // If CSS injection fails (protected page), show popup with explanation
      console.log("Error loading CSS:", error);
      showProtectedPagePopup();
    });
  }).catch((error) => {
    console.log("Error loading marker.js:", error);
  });
}

// Show popup when extension can't run on protected pages
function showProtectedPagePopup() {
  var popupWidth = 440;
  var popupHeight = 160;
  
  chrome.windows.create({
    focused: true,
    width: popupWidth,
    height: popupHeight,
    type: 'popup',
    url: 'popup.html',
    top: 0,
    left: 0
  });
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // Handle screenshot requests from the marker interface
  if (request.from === 'content_script') {
    // Capture the visible area of the current tab using MV3 API
    chrome.tabs.captureVisibleTab(null, {}, function (screenshotDataUrl) {
      if (chrome.runtime.lastError) {
        console.log("Error capturing screenshot:", chrome.runtime.lastError);
        sendResponse({error: chrome.runtime.lastError.message});
      } else {
        sendResponse({screenshot: screenshotDataUrl});
      }
    });
  }
  
  // Return true to indicate we will send a response asynchronously
  return true;
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") {
    // Open welcome page on first install
    chrome.tabs.create({
      url: "https://firefox-marker-website.vercel.app/installed.html"
    }, function (tab) {
      console.log("Extension installed successfully!");
    });
  }
});

// Set uninstall URL for feedback
chrome.runtime.setUninstallURL("https://firefox-marker-website.vercel.app/uninstalled.html");