// RC Marker Extension - Background Script
// Handles extension lifecycle and communication between content scripts

// Track which tabs have fabric.js loaded to avoid duplicate loading
var fabricLoadedTabs = {};

// Track extension activation state per tab
var extensionActiveState = {};

// Icon state management
function setIconActive(tabId) {
  chrome.browserAction.setIcon({
    path: "rc.png",
    tabId: tabId
  });
  extensionActiveState[tabId] = true;
}

function setIconInactive(tabId) {
  // Generate grayed out icon programmatically
  generateGrayedIcon().then(function(grayIconDataUrl) {
    chrome.browserAction.setIcon({
      imageData: grayIconDataUrl,
      tabId: tabId
    });
    extensionActiveState[tabId] = false;
  });
}

function generateGrayedIcon() {
  return new Promise(function(resolve) {
    // Create a canvas to generate grayed out icon
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var img = new Image();
    
    img.onload = function() {
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Draw the original image
      ctx.drawImage(img, 0, 0);
      
      // Apply grayscale filter
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var data = imageData.data;
      
      for (var i = 0; i < data.length; i += 4) {
        // Calculate grayscale value
        var gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        // Reduce opacity to make it more subdued
        data[i] = gray;     // red
        data[i + 1] = gray; // green
        data[i + 2] = gray; // blue
        data[i + 3] = data[i + 3] * 0.5; // alpha (50% transparency)
      }
      
      ctx.putImageData(imageData, 0, 0);
      
      // Convert to ImageData object for browser action
      var grayImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve(grayImageData);
    };
    
    // Load the rc.png icon
    img.src = chrome.runtime.getURL('rc.png');
  });
}

// Handle browser action click (extension icon click)
chrome.browserAction.onClicked.addListener(function(tab) {
  // Check if fabric.js is already loaded for this tab
  if (fabricLoadedTabs[tab.id] == null || !fabricLoadedTabs[tab.id]) {
    // Mark fabric as loaded for this tab
    fabricLoadedTabs[tab.id] = true;
    
    // Inject fabric.js library first
    chrome.tabs.executeScript(tab.id, {
        file: "fabric.min.js"
    }, function() {
      if (chrome.runtime.lastError) {
        console.log("Error loading fabric.js:", chrome.runtime.lastError);
      }
      // After fabric.js loads, initialize the marker
      initializeMarkerOnTab(tab);
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
    // Reset icon to inactive when page loads
    setIconInactive(tabId);
    delete extensionActiveState[tabId];
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
  delete fabricLoadedTabs[tabId];
  delete extensionActiveState[tabId];
});

// Initialize the marker interface on the specified tab
function initializeMarkerOnTab(tab) {
  // Inject the marker content script
  chrome.tabs.executeScript(tab.id, {
    file: "marker.js"
  }, function() {
    if (chrome.runtime.lastError) {
      console.log("Error loading marker.js:", chrome.runtime.lastError);
    }
    
    // Inject the CSS styles
    chrome.tabs.insertCSS(tab.id, {
      file: "main.css"
    }, function() {
      if (chrome.runtime.lastError) {
        // If CSS injection fails (protected page), show popup with explanation
        console.log("Error loading CSS:", chrome.runtime.lastError);
        showProtectedPagePopup();
      }
    });
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
    // Capture the visible area of the current tab
    chrome.tabs.captureVisibleTab(null, {}, function (screenshotDataUrl) {
      if (chrome.runtime.lastError) {
        console.log("Error capturing screenshot:", chrome.runtime.lastError);
        sendResponse({error: chrome.runtime.lastError.message});
      } else {
        sendResponse({screenshot: screenshotDataUrl});
      }
    });
  }
  
  // Handle activation state changes
  if (request.action === 'setIconActive') {
    setIconActive(sender.tab.id);
    sendResponse({success: true});
  }
  
  if (request.action === 'setIconInactive') {
    setIconInactive(sender.tab.id);
    sendResponse({success: true});
  }
  
  // Return true to indicate we will send a response asynchronously
  return true;
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") {
    console.log("Extension installed successfully!");
  }
});