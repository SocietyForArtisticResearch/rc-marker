// Web Marker - Content Script
// This script creates a drawing interface overlay on web pages

// Check if canvas already exists, if so exit, otherwise initialize
if (document.getElementById("webMarker_canvas")) {
  exitMarker();
} else {
  // Get user preferences from storage
  chrome.storage.sync.get(
    {
      penColor: "#FF0000",
      penThickness: 5,
      highlightThickness: 22,
      eraseThickness: 30,
      textSize: 20,
    },
    function (preferences) {
      initializeMarker(preferences);
    }
  );
}

// Function to remove the marker interface
function exitMarker() {
  // Save canvas state before exiting
  const canvas = document.getElementById("webMarker_canvas");
  if (canvas && window.webMarkerFabricCanvas) {
    saveCanvasToStorage();
  }

  const draggable = document.getElementById("webMarker_draggable");
  if (canvas) canvas.remove();
  if (draggable) draggable.remove();
}

// Save canvas state to Chrome storage
function saveCanvasToStorage() {
  if (window.webMarkerFabricCanvas) {
    const canvasData = JSON.stringify(window.webMarkerFabricCanvas);
    const storageKey = `webMarker_canvas_${window.location.href}`;

    chrome.storage.local.set(
      {
        [storageKey]: canvasData,
      },
      function () {
        console.log("Canvas state saved for:", window.location.href);
      }
    );
  }
}

// Load canvas state from Chrome storage
function loadCanvasFromStorage(fabricCanvas) {
  const storageKey = `webMarker_canvas_${window.location.href}`;

  chrome.storage.local.get([storageKey], function (result) {
    if (result[storageKey]) {
      try {
        fabricCanvas.loadFromJSON(result[storageKey], function () {
          fabricCanvas.renderAll();
          updateUploadIndicators(); // Show visual indicators for previously uploaded objects
          console.log("Canvas state loaded for:", window.location.href);
        });
      } catch (error) {
        console.log("Error loading canvas state:", error);
      }
    }
  });
}

// Convert hex color to rgba with opacity
function convertHexToRgba(hexColor, opacity = 0.3) {
  let hex = hexColor.replace("#", "");

  // Convert 3-digit hex to 6-digit
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const red = parseInt(hex.substring(0, 2), 16);
  const green = parseInt(hex.substring(2, 4), 16);
  const blue = parseInt(hex.substring(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

// Main initialization function
function initializeMarker(preferences) {
  // Tool state variables
  let isHighlighterMode = false;
  let isEraserMode = false;
  let isPointerMode = false;
  let isTextMode = false;
  let isLineMode = false;
  let isMoveMode = false;
  let isEditingText = false;
  let isDrawingLine = false;
  let currentLine = null;

  // Undo/Redo system
  let canvasState = null;
  let undoStack = [];
  let redoStack = [];

  // Get page dimensions
  const body = document.body;
  const documentElement = document.documentElement;
  const scrollTop = body.scrollTop || documentElement.scrollTop;

  let canvasHeight = Math.max(
    body.scrollHeight,
    body.offsetHeight,
    documentElement.clientHeight,
    documentElement.scrollHeight,
    documentElement.offsetHeight
  );

  // Detect the scrolling container-weave and get the actual scrollable width
  const containerWeave = document.querySelector('#container-weave, .container-weave');
  let canvasWidth = document.body.clientWidth; // default fallback
  
  // DEBUG: Analyze page structure to understand why scrolling might be broken
  console.log("=== PAGE STRUCTURE DEBUG ===");
  console.log("document.scrollingElement:", document.scrollingElement);
  console.log("document.documentElement === document.scrollingElement:", document.documentElement === document.scrollingElement);
  console.log("body overflow:", window.getComputedStyle(body).overflow);
  console.log("documentElement overflow:", window.getComputedStyle(documentElement).overflow);
  console.log("body position:", window.getComputedStyle(body).position);
  console.log("documentElement position:", window.getComputedStyle(documentElement).position);
  
  if (containerWeave) {
    console.log("container-weave position:", window.getComputedStyle(containerWeave).position);
    console.log("container-weave overflow:", window.getComputedStyle(containerWeave).overflow);
    console.log("container-weave parent:", containerWeave.parentElement.tagName, containerWeave.parentElement.className);
    console.log("Is container-weave the scrolling element?", containerWeave.scrollHeight > containerWeave.clientHeight);
    canvasWidth = containerWeave.scrollWidth;
    console.log("Using container-weave width:", canvasWidth, "instead of viewport width:", window.innerWidth);
  } else {
    console.log("Using default body width:", canvasWidth);
  }
  console.log("============================");

  let maxHeight = 7500;
  if (scrollTop + screen.height > maxHeight) {
    maxHeight += Math.floor((scrollTop + screen.height) / 7500) * 7500;
  }

  if (maxHeight > canvasHeight) {
    canvasHeight = maxHeight;
  }

  // Check if page is too tall
  if (canvasHeight > 25000) {
    alert(
      "Web Marker does not support pages with this height. Please try again on a different website."
    );
    exitMarker();
    return;
  }

  // Create fabric canvas
  const fabricCanvas = new fabric.Canvas("c", { isDrawingMode: true });
  fabric.Object.prototype.transparentCorners = true;
  fabricCanvas.setDimensions({
    width: canvasWidth,
    height: canvasHeight,
  });
  console.log("Canvas created with width:", canvasWidth, "height:", canvasHeight);
  fabricCanvas.wrapperEl.id = "webMarker_canvas";
  
  // Try to append canvas to the correct container
  const containerWeaveForCanvas = document.querySelector('#container-weave, .container-weave');
  if (containerWeaveForCanvas) {
    console.log("Appending canvas to container-weave");
    // Position relative so it scrolls with the container
    fabricCanvas.wrapperEl.style.position = "absolute";
    fabricCanvas.wrapperEl.style.top = "0px";
    fabricCanvas.wrapperEl.style.left = "0px";
    fabricCanvas.wrapperEl.style.zIndex = "2147483646";
    containerWeaveForCanvas.appendChild(fabricCanvas.wrapperEl);
  } else {
    console.log("Appending canvas to body (fallback)");
    document.body.appendChild(fabricCanvas.wrapperEl);
  }

  // Make canvas globally accessible for persistence
  window.webMarkerFabricCanvas = fabricCanvas;

  // Create toolbar
  const toolbar = document.createElement("div");
  toolbar.id = "webMarker_draggable";
  document.body.appendChild(toolbar);

  // Toolbar HTML content
  toolbar.innerHTML = `
    <div id="webMarker_color">
      <div class="webMarker_title">Color</div>
      <input id="webMarker_colorSelect" type="color" value="#FF0000">
    </div>
    <div id="webMarker_tools">
      <div class="webMarker_title webMarker_toolsTitle">Tools</div>
      <div class="webMarker_toolDiv">
        <a id="webMarker_pen" class="webMarker_tool">
          <img id="webMarker_penImg" class="webMarker_icon" alt="Marker" title="Marker">
        </a>
        <a id="webMarker_highlighter" class="webMarker_tool">
          <img id="webMarker_highlighterImg" class="webMarker_icon" alt="Highlighter" title="Highlighter">
        </a>
        <a id="webMarker_eraser" class="webMarker_tool">
          <img id="webMarker_eraserImg" class="webMarker_icon" alt="Eraser" title="Eraser">
        </a>
        <a id="webMarker_pointer" class="webMarker_tool">
          <img id="webMarker_pointerImg" class="webMarker_icon" alt="Pointer" title="Pointer">
        </a>
        <a id="webMarker_text" class="webMarker_tool">
          <img id="webMarker_textImg" class="webMarker_icon" alt="Text" title="Text">
        </a>
        <a id="webMarker_move" class="webMarker_tool">
          <img id="webMarker_moveImg" class="webMarker_icon" alt="Move" title="Move">
        </a>
        <a id="webMarker_line" class="webMarker_tool">
          <img id="webMarker_lineImg" class="webMarker_icon" alt="Line" title="Line">
        </a>
        <a id="webMarker_save" class="webMarker_tool">
          <img id="webMarker_saveImg" class="webMarker_icon" alt="Save" title="Save Drawing">
        </a>
        <a id="webMarker_undo" class="webMarker_tool">
          <img id="webMarker_undoImg" class="webMarker_icon" alt="Undo" title="Undo">
        </a>
        <a id="webMarker_redo" class="webMarker_tool">
          <img id="webMarker_redoImg" class="webMarker_icon" alt="Redo" title="Redo">
        </a>
        <a id="webMarker_clear" class="webMarker_tool">
          <img id="webMarker_clearImg" class="webMarker_icon" alt="Clear" title="Clear">
        </a>
        <a id="webMarker_exit" class="webMarker_tool">
          <img id="webMarker_exitImg" class="webMarker_icon" alt="Exit" title="Exit">
        </a>
      </div>
    </div>
    <div id="webMarker_size">
      <div class="webMarker_title">Size</div>
      <input type="range" id="webMarker_thicknessSlider" value="5" max="60" min="1">
    </div>
    
  `;

  // Position toolbar
  toolbar.style.top = scrollTop + "px";

  // Add whiteboard link
  const donateContainer = document.createElement("div");
  donateContainer.id = "webMarker_donateContainer";
  donateContainer.innerHTML = `
      <a title="Whiteboard" id="webMarker_donate" class="webMarker_kofi-button" 
         href="${chrome.runtime.getURL('whiteboard.html')}" target="_blank" style="padding:2px">
         <div style="padding:2px">
         WhiteBoard
         </div>
      </a>
    `;
  toolbar.appendChild(donateContainer);

  // Make toolbar draggable
  toolbar.addEventListener("mousedown", function (event) {
    const offsetX =
      event.clientX - parseInt(window.getComputedStyle(this).left);
    const offsetY = event.clientY - parseInt(window.getComputedStyle(this).top);

    function moveToolbar(moveEvent) {
      toolbar.style.top = moveEvent.clientY - offsetY + "px";
      toolbar.style.left = moveEvent.clientX - offsetX + "px";
    }

    function stopDragging() {
      window.removeEventListener("mousemove", moveToolbar);
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("contextmenu", stopDragging);
    }

    window.addEventListener("mousemove", moveToolbar);
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("contextmenu", stopDragging);
  });

  // Get DOM elements
  const colorPicker = document.getElementById("webMarker_colorSelect");
  const thicknessSlider = document.getElementById("webMarker_thicknessSlider");
  const undoButton = document.getElementById("webMarker_undo");
  const redoButton = document.getElementById("webMarker_redo");

  // Tool buttons
  const penButton = document.getElementById("webMarker_pen");
  const highlighterButton = document.getElementById("webMarker_highlighter");
  const eraserButton = document.getElementById("webMarker_eraser");
  const pointerButton = document.getElementById("webMarker_pointer");
  const textButton = document.getElementById("webMarker_text");
  const moveButton = document.getElementById("webMarker_move");
  const lineButton = document.getElementById("webMarker_line");

  // Set up tool icons
  const toolButtons = document.querySelectorAll(".webMarker_tool");
  const toolFunctions = [
    selectPenTool,
    selectHighlighterTool,
    selectEraserTool,
    selectPointerTool,
    selectTextTool,
    selectMoveTool,
    selectLineTool,
    saveDrawing,
    undoAction,
    redoAction,
    clearCanvas,
    exitMarker,
  ];

  toolButtons.forEach(function (button, index) {
    const img = button.querySelector("img");
    img.src = chrome.runtime.getURL(img.alt.toLowerCase() + ".png");
    button.onclick = toolFunctions[index];
  });

  // Initialize settings - make these variables mutable
  let penThickness = preferences.penThickness;
  let highlightThickness = preferences.highlightThickness;
  let eraseThickness = preferences.eraseThickness;
  let textSize = preferences.textSize;

  penButton.style.background = "rgba(0,0,0,0.2)";
  thicknessSlider.value = penThickness;
  colorPicker.value = preferences.penColor;

  // Set up brushes
  const eraserBrush = new fabric.EraserBrush(fabricCanvas);
  const drawingBrush = fabricCanvas.freeDrawingBrush;
  drawingBrush.color = colorPicker.value;
  drawingBrush.width = parseInt(thicknessSlider.value) || 5;

  // Tool selection functions
  function clearToolSelection() {
    toolButtons.forEach((button) => {
      button.style.background = "";
    });
  }

  function selectTool(button) {
    fabricCanvas.discardActiveObject().renderAll();
    fabricCanvas.wrapperEl.style.cursor = "crosshair";
    fabricCanvas.wrapperEl.style.pointerEvents = "auto";
    fabricCanvas.selection = true;
    fabricCanvas.isDrawingMode = true;

    // Reset all modes
    isMoveMode =
      isLineMode =
      isHighlighterMode =
      isEraserMode =
      isPointerMode =
      isTextMode =
      isEditingText =
        false;

    clearToolSelection();
    button.style.background = "rgba(0,0,0,0.2)";
  }

  function selectPenTool() {
    selectTool(penButton);
    fabricCanvas.freeDrawingBrush = drawingBrush;
    fabricCanvas.freeDrawingBrush.color = colorPicker.value;
    thicknessSlider.value = penThickness;
    fabricCanvas.freeDrawingBrush.width = parseInt(thicknessSlider.value) || 5;
  }

  function selectHighlighterTool() {
    selectTool(highlighterButton);
    isHighlighterMode = true;
    fabricCanvas.freeDrawingBrush = drawingBrush;
    fabricCanvas.freeDrawingBrush.color = convertHexToRgba(colorPicker.value);
    thicknessSlider.value = highlightThickness;
    fabricCanvas.freeDrawingBrush.width = parseInt(thicknessSlider.value) || 5;
  }

  function selectEraserTool() {
    selectTool(eraserButton);
    isEraserMode = true;
    fabricCanvas.freeDrawingBrush = eraserBrush;
    thicknessSlider.value = eraseThickness;
    fabricCanvas.freeDrawingBrush.width = parseInt(thicknessSlider.value) || 5;
  }

  function selectPointerTool() {
    selectTool(pointerButton);
    isPointerMode = true;
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.wrapperEl.style.pointerEvents = "none";
  }

  function selectMoveTool() {
    selectTool(moveButton);
    isMoveMode = true;
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.getObjects().forEach(function (obj) {
      obj.selectable = true;
      obj.hoverCursor = "move";
    });
  }

  function selectTextTool() {
    selectTool(textButton);
    isTextMode = true;
    fabricCanvas.isDrawingMode = false;
    thicknessSlider.value = textSize;
  }

  function selectLineTool() {
    selectTool(lineButton);
    isLineMode = true;
    thicknessSlider.value = penThickness;
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = false;
    makeObjectsNonSelectable();
  }

  function makeObjectsNonSelectable() {
    fabricCanvas.getObjects().forEach(function (obj) {
      obj.selectable = false;
      obj.hoverCursor = "normal";
    });
  }

  // Test function to check if fetch is working
  async function testFetch() {
    console.log("Testing basic fetch...");
    try {
      const response = await fetch('https://www.researchcatalogue.net/', {
        method: 'GET',
        credentials: 'include'
      });
      console.log("Test fetch successful:", response.status, response.statusText);
      return true;
    } catch (error) {
      console.error("Test fetch failed:", error);
      return false;
    }
  }

  // Research Catalogue Integration Functions
  async function rcMediaAdd(mediaName, copyrightholder, description = '', expositionId = null) {
    console.log("rcMediaAdd called with:", { mediaName, copyrightholder, description, expositionId });
    
    const formData = new FormData();
    
    // Try to get exposition ID from URL if not provided
    if (!expositionId) {
      const urlMatch = window.location.href.match(/\/view\/(\d+)/);
      if (urlMatch) {
        expositionId = urlMatch[1];
        console.log("Extracted exposition ID from URL:", expositionId);
      }
    }
    
    if (!expositionId) {
      console.error("Could not determine exposition ID from URL:", window.location.href);
      throw new Error('Could not determine exposition ID');
    }
    
    formData.append('research', expositionId);
    formData.append('image[mediatype]', 'image');
    formData.append('image[name]', mediaName);
    formData.append('image[copyrightholder]', copyrightholder);
    formData.append('image[license]', 'cc-by-nc-nd');
    formData.append('image[description]', description);
    formData.append('image[submitbutton]', 'image[submitbutton]');
    formData.append('iframe-submit', 'true');
    
    // Empty media file (will be uploaded separately)
    formData.append('media', new Blob([''], { type: 'application/octet-stream' }), '');
    
    console.log("Making request to /simple-media/add");
    console.log("FormData contents:");
    for (let [key, value] of formData) {
      console.log(`  ${key}:`, value);
    }
    
    try {
      console.log("About to make fetch request...");
      const response = await fetch('https://www.researchcatalogue.net/simple-media/add', {
        method: 'POST',
        body: formData,
        credentials: 'include' // Include browser cookies
      });
      
      console.log("Fetch completed. Response:", response);
      console.log("Response status:", response.status, response.statusText);
      console.log("Response headers:", [...response.headers.entries()]);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const responseText = await response.text();
      console.log("Response text length:", responseText.length);
      console.log("Response text:", responseText.substring(0, 500) + "...");
      
      // Extract media ID from response
      const match = responseText.match(/parent\.window\.formAction\s*=\s*['"]\/?simple-media\/edit\?file=(\d+)['"];/);
      if (match) {
        console.log("Extracted media ID:", match[1]);
        return match[1];
      } else {
        console.error("Failed to extract media ID from response. Full response:", responseText);
        throw new Error('Failed to extract media ID from response');
      }
    } catch (error) {
      console.error("Fetch error details:", error);
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
      throw new Error(`RC media_add failed: ${error.message}`);
    }
  }

  async function rcMediaUpload(mediaId, svgData, filename) {
    console.log("rcMediaUpload called with:", { mediaId, filename, svgDataLength: svgData.length });
    
    const formData = new FormData();
    
    formData.append('file', mediaId);
    formData.append('submit-async-file', 'false');
    formData.append('image[submitbutton]', 'imageimage[submitbutton]');
    formData.append('iframe-submit', 'true');
    
    // Create SVG blob and append as file
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml' });
    formData.append('media', svgBlob, filename);
    
    console.log("Upload FormData contents:");
    for (let [key, value] of formData) {
      if (key === 'media') {
        console.log(`  ${key}:`, value, 'size:', value.size, 'type:', value.type);
      } else {
        console.log(`  ${key}:`, value);
      }
    }
    
    try {
      console.log("Making upload request to /file/edit");
      const response = await fetch('https://www.researchcatalogue.net/file/edit', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      
      console.log("Upload response:", response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Upload error response:", errorText);
        throw new Error(`Upload failed with status: ${response.status}`);
      }
      
      const responseText = await response.text();
      console.log("Upload response text:", responseText.substring(0, 200) + "...");
      
      return true;
    } catch (error) {
      console.error("Upload error:", error);
      throw new Error(`RC media_upload failed: ${error.message}`);
    }
  }

  async function rcItemAdd(pageId, mediaId, x, y, w, h, expositionId = null) {
    console.log("rcItemAdd called with:", { pageId, mediaId, x, y, w, h, expositionId });
    console.log("Current URL:", window.location.href);
    
    // Try to get exposition ID from URL if not provided
    if (!expositionId) {
      const urlMatch = window.location.href.match(/\/view\/(\d+)/);
      if (urlMatch) {
        expositionId = urlMatch[1];
        console.log("Extracted exposition ID from URL:", expositionId);
      }
    }
    
    if (!expositionId) {
      console.error("Could not determine exposition ID from URL:", window.location.href);
      throw new Error('Could not determine exposition ID');
    }
    
    console.log("Using exposition ID:", expositionId, "pageId:", pageId);
    
    const formData = new FormData();
    formData.append('research', expositionId);
    formData.append('weave', pageId);
    formData.append('toolType', 'picture');
    formData.append('tool', 'picture');
    formData.append('file', mediaId);
    formData.append('left', x.toString());
    formData.append('top', y.toString());
    formData.append('width', w.toString());
    formData.append('height', h.toString());
    
    console.log("Item add FormData:");
    for (let [key, value] of formData) {
      console.log(`  ${key}: ${value}`);
    }
    
    try {
      console.log("Making item add request...");
      const response = await fetch('https://www.researchcatalogue.net/item/add', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      
      console.log("Item add response status:", response.status, response.statusText);
      
      const responseText = await response.text();
      console.log("Item add response text length:", responseText.length);
      console.log("Item add response text (first 500 chars):", responseText.substring(0, 500));
      
      // Check for common error indicators
      if (responseText.includes('error') || responseText.includes('Error') || responseText.includes('failed')) {
        console.error("Error detected in response:", responseText);
      }
      
      // Check for validation errors
      if (responseText.includes('formIsValid = 0')) {
        console.error("Form validation failed");
        throw new Error('Item add form validation failed');
      }
      
      // Extract item ID from response
      const match = responseText.match(/data-id="(\d+)"/);
      if (match) {
        console.log("Successfully extracted item ID:", match[1]);
        return match[1];
      } else {
        console.error("Failed to extract item ID - trying alternative patterns");
        // Try other common patterns
        const altMatch1 = responseText.match(/item["\s]*:.*?(\d+)/);
        const altMatch2 = responseText.match(/id["\s]*:.*?(\d+)/);
        const altMatch3 = responseText.match(/"id":\s*"?(\d+)"?/);
        
        if (altMatch1) {
          console.log("Found item ID with pattern 1:", altMatch1[1]);
          return altMatch1[1];
        } else if (altMatch2) {
          console.log("Found item ID with pattern 2:", altMatch2[1]);
          return altMatch2[1];
        } else if (altMatch3) {
          console.log("Found item ID with pattern 3:", altMatch3[1]);
          return altMatch3[1];
        } else {
          console.error("All ID extraction patterns failed");
          throw new Error('Failed to extract item ID from response');
        }
      }
    } catch (error) {
      console.error("rcItemAdd error:", error);
      throw new Error(`RC item_add failed: ${error.message}`);
    }
  }

  // Function to add visual indicators for uploaded objects
  function updateUploadIndicators() {
    const canvasObjects = fabricCanvas.getObjects();
    
    canvasObjects.forEach((obj, index) => {
      if (obj.rcUploaded && obj.rcMediaId) {
        // Add a subtle green border to indicate uploaded status
        if (!obj.originalStroke) {
          obj.originalStroke = obj.stroke || '#000000';
        }
        
        // Add a small visual indicator (green tint or border)
        if (obj.type === 'path') {
          // For paths, add a subtle green tint
          obj.set({
            shadow: {
              color: '#4CAF50',
              blur: 2,
              offsetX: 0,
              offsetY: 0
            }
          });
        } else {
          // For other objects, add a green border
          obj.set({
            strokeWidth: (obj.originalStrokeWidth || obj.strokeWidth || 1) + 1,
            stroke: '#4CAF50'
          });
        }
        
        console.log(`Added upload indicator to object ${index + 1} (MediaID: ${obj.rcMediaId})`);
      }
    });
    
    fabricCanvas.renderAll();
  }

  // Function to remove upload indicators
  function removeUploadIndicators() {
    const canvasObjects = fabricCanvas.getObjects();
    
    canvasObjects.forEach((obj, index) => {
      if (obj.rcUploaded) {
        // Remove visual indicators
        obj.set({
          shadow: null,
          stroke: obj.originalStroke || obj.stroke,
          strokeWidth: obj.originalStrokeWidth || obj.strokeWidth
        });
      }
    });
    
    fabricCanvas.renderAll();
  }

  async function uploadIndividualPathsToRC(pageId, copyrightholder, uploadStatus) {
    try {
      console.log('Starting individual paths upload...');
      
      // Get all objects from canvas
      const canvasObjects = fabricCanvas.getObjects();
      console.log(`Found ${canvasObjects.length} objects on canvas`);
      
      if (canvasObjects.length === 0) {
        throw new Error('No drawing objects found on canvas');
      }
      
      const results = [];
      
      // Process each object sequentially to avoid timing issues
      for (let i = 0; i < canvasObjects.length; i++) {
        const obj = canvasObjects[i];
        
        console.log(`Processing object ${i + 1}/${canvasObjects.length}`);
        
        // Check if this object has already been uploaded
        if (obj.rcUploaded && obj.rcMediaId && obj.rcItemId) {
          console.log(`✅ Object ${i + 1} already uploaded - skipping (MediaID: ${obj.rcMediaId}, ItemID: ${obj.rcItemId})`);
          results.push({
            objectIndex: i,
            mediaId: obj.rcMediaId,
            itemId: obj.rcItemId,
            bounds: obj.getBoundingRect(),
            skipped: true,
            reason: 'Already uploaded'
          });
          continue;
        }
        
        console.log(`Starting upload for object ${i + 1}/${canvasObjects.length}`);
        
        // Update progress
        uploadStatus.textContent = `Uploading path ${i + 1}/${canvasObjects.length}...`;
        
        try {
          // Get object bounds
          const boundingRect = obj.getBoundingRect();
          console.log(`Object ${i + 1} bounds:`, boundingRect);
          
          // Ensure minimum dimensions
          const width = Math.max(boundingRect.width, 10);
          const height = Math.max(boundingRect.height, 10);
          
          // Create individual SVG for this object
          const tempCanvas = new fabric.Canvas();
          tempCanvas.setWidth(width + 20); // Add padding
          tempCanvas.setHeight(height + 20);
          
          // Clone object and center it in temp canvas
          console.log(`Cloning object ${i + 1}...`);
          const clonedObj = await new Promise((resolve, reject) => {
            try {
              obj.clone((cloned) => {
                cloned.set({
                  left: 10, // Padding offset
                  top: 10,
                  originX: 'left',
                  originY: 'top'
                });
                resolve(cloned);
              });
            } catch (error) {
              reject(error);
            }
          });
          
          tempCanvas.add(clonedObj);
          tempCanvas.renderAll(); // Ensure rendering is complete
          const pathSVG = tempCanvas.toSVG();
          
          console.log(`Generated SVG for object ${i + 1}, length: ${pathSVG.length}`);
          
          // Generate filename for this path
          const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '');
          const pathFilename = `WebMarker_Path_${i + 1}_${timestamp}.svg`;
          
          // Upload this individual path
          const mediaName = `Web Marker Path ${i + 1} - ${new Date().toLocaleString()}`;
          const description = `Individual drawing path ${i + 1} created with Web Marker extension on ${window.location.href}`;
          
          console.log(`Starting upload for path ${i + 1}:`, mediaName);
          
          const result = await uploadToResearchCatalogue(pathSVG, pathFilename, {
            mediaName: mediaName,
            copyrightholder: copyrightholder,
            description: description,
            pageId: pageId,
            position: { 
              x: Math.round(boundingRect.left), 
              y: Math.round(boundingRect.top), 
              w: Math.round(width), 
              h: Math.round(height) 
            }
          });
          
          // Mark the object as uploaded to prevent duplicate uploads
          obj.set({
            rcUploaded: true,
            rcMediaId: result.mediaId,
            rcItemId: result.itemId,
            rcUploadedAt: new Date().toISOString()
          });
          
          results.push({
            objectIndex: i,
            mediaId: result.mediaId,
            itemId: result.itemId,
            bounds: boundingRect,
            filename: pathFilename
          });
          
          console.log(`✅ Successfully uploaded path ${i + 1}/${canvasObjects.length}:`, result);
          console.log(`Marked object ${i + 1} as uploaded with MediaID: ${result.mediaId}, ItemID: ${result.itemId}`);
          
          // Small delay between uploads to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`❌ Failed to upload path ${i + 1}:`, error);
          // Continue with other paths even if one fails
          results.push({
            objectIndex: i,
            error: error.message,
            bounds: obj.getBoundingRect()
          });
        }
      }
      
      const successfulUploads = results.filter(r => !r.error).length;
      const skippedUploads = results.filter(r => r.skipped).length;
      console.log(`🎉 Upload complete: ${successfulUploads}/${canvasObjects.length} paths uploaded successfully, ${skippedUploads} skipped (already uploaded)`);
      console.log('All results:', results);
      
      // Save canvas state to persist upload tracking information
      if (successfulUploads > 0) {
        fabricCanvas.renderAll(); // Ensure canvas is rendered
        saveCanvasState();
        updateUploadIndicators(); // Add visual indicators for uploaded objects
        console.log('Canvas state saved with upload tracking information');
      }
      
      if (successfulUploads === 0 && skippedUploads === 0) {
        throw new Error('All path uploads failed');
      }
      
      return results;
      
    } catch (error) {
      console.error('Individual paths upload failed:', error);
      throw error;
    }
  }

  async function uploadToResearchCatalogue(svgData, filename, options = {}) {
    const {
      mediaName = `Web Marker Drawing - ${new Date().toLocaleString()}`,
      copyrightholder = 'Web Marker User',
      description = `Drawing created with Web Marker on ${window.location.href}`,
      pageId = null,
      position = { x: 100, y: 100, w: 400, h: 300 }
    } = options;
    
    try {
      console.log('Starting RC upload...');
      
      // Test basic connectivity first
      console.log('Testing basic fetch connectivity...');
      const fetchTest = await testFetch();
      if (!fetchTest) {
        throw new Error('Basic fetch test failed - network connectivity issue');
      }
      
      // Step 1: Add media entry
      console.log('Adding media entry...');
      const mediaId = await rcMediaAdd(mediaName, copyrightholder, description);
      console.log('Media ID:', mediaId);
      
      // Step 2: Upload SVG file
      console.log('Uploading SVG file...');
      await rcMediaUpload(mediaId, svgData, filename);
      console.log('SVG uploaded successfully');
      
      // Step 3: Add to page if pageId provided
      if (pageId) {
        console.log('Adding item to page...');
        const itemId = await rcItemAdd(pageId, mediaId, position.x, position.y, position.w, position.h);
        console.log('Item ID:', itemId);
        return { mediaId, itemId };
      }
      
      return { mediaId };
      
    } catch (error) {
      console.error('RC upload failed:', error);
      throw error;
    }
  }

  // Save drawing function - export canvas as SVG
  function saveDrawing() {
    try {
      // Export the canvas as SVG
      const svgData = fabricCanvas.toSVG();
      
      // Create date string for filename
      const currentDate = new Date();
      const dateString =
        currentDate.getFullYear() +
        "-" +
        ("0" + (currentDate.getMonth() + 1)).slice(-2) +
        "-" +
        ("0" + currentDate.getDate()).slice(-2) +
        "_" +
        ("0" + currentDate.getHours()).slice(-2) +
        ("0" + currentDate.getMinutes()).slice(-2);

      const filename = "WebMarker_Drawing_" + dateString + ".svg";

      // Show options dialog for save method
      console.log("Showing save options dialog...");
      
      // Create a more sophisticated dialog for three options
      const saveOption = prompt(
        "Choose save option:\n\n" +
        "1 = Download locally only\n" +
        "2 = Upload single SVG to Research Catalogue\n" +
        "3 = Upload individual paths to Research Catalogue\n\n" +
        "Enter your choice (1, 2, or 3):", 
        "1"
      );
      
      console.log("Save options result:", saveOption);

      // Download locally only for option 1
      if (saveOption === "1") {
        const svgBlob = new Blob([svgData], { type: "image/svg+xml" });
        const downloadLink = document.createElement("a");
        downloadLink.download = filename;
        downloadLink.href = URL.createObjectURL(svgBlob);
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        console.log("File downloaded locally");
        
        // Show preview window for local download
        const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>Web Marker Drawing</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                margin: 20px; 
                background-color: #f5f5f5; 
              }
              .container { 
                background: white; 
                padding: 20px; 
                border-radius: 8px; 
                box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
              }
              svg { 
                border: 1px solid #ddd; 
                border-radius: 4px; 
                max-width: 100%; 
                height: auto; 
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Web Marker Drawing Preview</h1>
              <p>Created: ${new Date().toLocaleString()}</p>
              <p>Original URL: <a href="${window.location.href}" target="_blank">${window.location.href}</a></p>
              ${svgData}
            </div>
          </body>
          </html>
        `;
        
        const htmlBlob = new Blob([htmlContent], { type: "text/html" });
        const previewUrl = URL.createObjectURL(htmlBlob);
        window.open(previewUrl);
      }

      // Handle the different save options
      if (saveOption === "2" || saveOption === "3") {
        console.log("User chose to upload to RC - option:", saveOption);
        
        // Check if we're on a Research Catalogue page
        const isRCPage = window.location.hostname.includes('researchcatalogue.net');
        console.log("Is RC page:", isRCPage, "hostname:", window.location.hostname);
        
        if (isRCPage) {
          console.log("Starting RC upload process...");
          
          // Show upload progress
          const uploadStatus = document.createElement('div');
          uploadStatus.style.cssText = `
            position: fixed; 
            top: 20px; 
            right: 20px; 
            background: #4CAF50; 
            color: white; 
            padding: 10px 20px; 
            border-radius: 5px; 
            z-index: 9999999; 
            font-family: Arial; 
            font-size: 14px;
          `;
          uploadStatus.textContent = saveOption === "2" ? 'Uploading single SVG to Research Catalogue...' : 'Uploading individual paths to Research Catalogue...';
          document.body.appendChild(uploadStatus);
          
          // Extract page ID if we're viewing a specific page
          console.log("Extracting page ID from URL:", window.location.href);
          
          // Try multiple patterns for RC URLs
          let pageMatch = window.location.href.match(/\/view\/\d+\/(\d+)/); // /view/expositionId/pageId
          let pageId = pageMatch ? pageMatch[1] : null;
          
          if (!pageId) {
            // Try alternative patterns
            pageMatch = window.location.href.match(/\/weave\/(\d+)/); // /weave/pageId
            pageId = pageMatch ? pageMatch[1] : null;
          }
          
          if (!pageId) {
            // Try yet another pattern
            pageMatch = window.location.href.match(/[?&]weave=(\d+)/); // ?weave=pageId or &weave=pageId
            pageId = pageMatch ? pageMatch[1] : null;
          }
          
          console.log("Detected page ID:", pageId, "from URL:", window.location.href);
          
          // Get actual canvas dimensions for proper positioning
          const canvasWidth = fabricCanvas.getWidth();
          const canvasHeight = fabricCanvas.getHeight();
          console.log("Using canvas dimensions:", canvasWidth, "x", canvasHeight);
          
          if (saveOption === "2") {
            // Upload single SVG (existing functionality)
            uploadToResearchCatalogue(svgData, filename, {
              mediaName: `Web Marker Drawing - ${new Date().toLocaleString()}`,
              copyrightholder: prompt('Copyright holder:', 'Web Marker User') || 'Web Marker User',
              description: `Drawing created with Web Marker extension on ${window.location.href}`,
              pageId: pageId,
              position: { x: 0, y: 0, w: canvasWidth, h: canvasHeight }
            }).then((result) => {
              uploadStatus.style.background = '#4CAF50';
              uploadStatus.textContent = `✓ Successfully uploaded single SVG to RC! Media ID: ${result.mediaId}`;
              setTimeout(() => {
                document.body.removeChild(uploadStatus);
              }, 5000);
              console.log('RC upload result:', result);
            }).catch((error) => {
              uploadStatus.style.background = '#f44336';
              uploadStatus.textContent = `✗ Single SVG upload failed: ${error.message}`;
              setTimeout(() => {
                document.body.removeChild(uploadStatus);
              }, 10000);
              console.error('RC upload error:', error);
            });
          } else if (saveOption === "3") {
            // Upload individual paths (new functionality)
            const copyrightholder = prompt('Copyright holder:', 'Web Marker User') || 'Web Marker User';
            uploadIndividualPathsToRC(pageId, copyrightholder, uploadStatus)
              .then((results) => {
                const successfulUploads = results.filter(r => !r.error && !r.skipped).length;
                const skippedUploads = results.filter(r => r.skipped).length;
                uploadStatus.style.background = '#4CAF50';
                
                if (skippedUploads > 0) {
                  uploadStatus.textContent = `✓ Uploaded ${successfulUploads} new paths, ${skippedUploads} already existed in RC!`;
                } else {
                  uploadStatus.textContent = `✓ Successfully uploaded ${successfulUploads} paths to RC!`;
                }
                
                setTimeout(() => {
                  document.body.removeChild(uploadStatus);
                }, 5000);
                console.log('RC multi-path upload results:', results);
              })
              .catch((error) => {
                uploadStatus.style.background = '#f44336';
                uploadStatus.textContent = `✗ Multi-path upload failed: ${error.message}`;
                setTimeout(() => {
                  document.body.removeChild(uploadStatus);
                }, 10000);
                console.error('RC multi-path upload error:', error);
              });
          }
        } else {
          console.log("Not on RC page, showing alert");
          alert('Research Catalogue upload is only available when using the extension on researchcatalogue.net pages.');
        }
      } else {
        console.log("User chose local download only");
      }

      // Open preview window
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Web Marker Drawing</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 20px; 
              background-color: #f5f5f5; 
            }
            .container { 
              background: white; 
              padding: 20px; 
              border-radius: 8px; 
              box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
            }
            svg { 
              border: 1px solid #ddd; 
              border-radius: 4px; 
              background: white; 
              max-width: 100%; 
              height: auto; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Web Marker Drawing</h1>
            <p>Created: ${new Date().toLocaleString()}</p>
            <p>Original URL: <a href="${window.location.href}" target="_blank">${window.location.href}</a></p>
            ${svgData}
          </div>
        </body>
        </html>
      `;
      
      const htmlBlob = new Blob([htmlContent], { type: "text/html" });
      const previewUrl = URL.createObjectURL(htmlBlob);
      window.open(previewUrl);

      console.log("Canvas exported as SVG successfully");
      
    } catch (error) {
      console.error("Error exporting canvas as SVG:", error);
      alert("Error saving drawing. Please try again.");
    }
  }

  // Clear canvas function
  function clearCanvas() {
    fabricCanvas.clear();
    saveCanvasState();
  }

  // Undo/Redo system
  function toggleButtonState(button, enabled) {
    if (enabled) {
      button.style.opacity = 1;
      button.style.cursor = "pointer";
    } else {
      button.style.opacity = 0.3;
      button.style.cursor = "not-allowed";
    }
  }

  function saveCanvasState() {
    redoStack = [];
    toggleButtonState(redoButton, false);

    if (canvasState !== null) {
      undoStack.push(canvasState);
      toggleButtonState(undoButton, true);
    }

    canvasState = JSON.stringify(fabricCanvas);

    // Also save to persistent storage
    saveCanvasToStorage();
  }

  function performUndoRedo(
    sourceStack,
    targetStack,
    enableButton,
    disableButton
  ) {
    if (sourceStack.length !== 0) {
      targetStack.push(canvasState);
      canvasState = sourceStack.pop();
      fabricCanvas.clear();
      fabricCanvas.loadFromJSON(canvasState);
      fabricCanvas.renderAll();

      toggleButtonState(enableButton, true);
      toggleButtonState(disableButton, sourceStack.length > 0);
    }
  }

  function undoAction() {
    performUndoRedo(undoStack, redoStack, redoButton, undoButton);
  }

  function redoAction() {
    performUndoRedo(redoStack, undoStack, undoButton, redoButton);
    if (isLineMode) {
      makeObjectsNonSelectable();
    }
  }

  // Initialize undo/redo buttons
  toggleButtonState(undoButton, false);
  toggleButtonState(redoButton, false);

  // Load saved canvas state for this page
  loadCanvasFromStorage(fabricCanvas);

  // Auto-save canvas state periodically (every 30 seconds)
  setInterval(function () {
    if (window.webMarkerFabricCanvas) {
      saveCanvasToStorage();
    }
  }, 30000);

  // Event listeners
  thicknessSlider.addEventListener(
    "input",
    function () {
      const newThickness = parseInt(thicknessSlider.value) || 5;

      // Update the appropriate thickness variable based on current mode
      if (isEraserMode) {
        eraseThickness = newThickness;
      } else if (isHighlighterMode) {
        highlightThickness = newThickness;
      } else if (isTextMode) {
        textSize = newThickness;
      } else {
        penThickness = newThickness;
      }

      // Update the current brush width
      if (fabricCanvas.freeDrawingBrush) {
        fabricCanvas.freeDrawingBrush.width = newThickness;
      }
    },
    false
  );

  colorPicker.addEventListener(
    "input",
    function () {
      let color = this.value;
      if (isHighlighterMode) {
        color = convertHexToRgba(color);
      }
      fabricCanvas.freeDrawingBrush.color = color;

      const donateButton = document.getElementById("webMarker_donate");
      if (donateButton) {
        donateButton.style.backgroundColor = this.value;
      }
    },
    false
  );

  // Canvas event listeners
  fabricCanvas.on("text:editing:entered", function () {
    isEditingText = true;
  });

  fabricCanvas.on("text:editing:exited", function () {
    isEditingText = false;
    isTextMode = false;
    selectMoveTool();
  });

  let isMouseDown = false;

  fabricCanvas.on("mouse:down", function (event) {
    isMouseDown = true;

    if (isTextMode && !isEditingText) {
      const pointer = event.e;
      const fontSize = 2 * parseInt(thicknessSlider.value);

      let x, y;
      if (pointer.type === "touchstart") {
        const rect = pointer.target.getBoundingClientRect();
        x = pointer.targetTouches[0].pageX - rect.left;
        y = pointer.targetTouches[0].pageY - rect.top;
      } else {
        x = pointer.offsetX;
        y = pointer.offsetY;
      }

      const textObject = new fabric.IText("", {
        fontFamily: "arial",
        fontSize: fontSize,
        fill: colorPicker.value,
        left: x,
        top: y - fontSize / 2,
      });

      fabricCanvas.add(textObject).setActiveObject(textObject);
      textObject.enterEditing();
    } else if (isLineMode) {
      isDrawingLine = true;
      const pointer = fabricCanvas.getPointer(event.e);
      currentLine = new fabric.Line(
        [pointer.x, pointer.y, pointer.x, pointer.y],
        {
          strokeWidth: parseInt(thicknessSlider.value),
          fill: colorPicker.value,
          stroke: colorPicker.value,
          originX: "center",
          originY: "center",
          selectable: false,
          hoverCursor: "normal",
          targetFindTolerance: true,
        }
      );
      fabricCanvas.add(currentLine);
    }
  });

  fabricCanvas.on("mouse:move", function (event) {
    if (isLineMode && isDrawingLine) {
      const pointer = fabricCanvas.getPointer(event.e);
      currentLine.set({ x2: pointer.x, y2: pointer.y });
      fabricCanvas.renderAll();
    }
  });

  fabricCanvas.on("object:modified", function () {
    saveCanvasState();
  });

  fabricCanvas.on("mouse:up", function () {
    isMouseDown = false;
    if (!isMoveMode && !isTextMode) {
      saveCanvasState();
      if (isLineMode) {
        isDrawingLine = false;
        currentLine.setCoords();
      }
    }
  });

  // Scroll handling - simplified since canvas should scroll with container
  function updateCanvasPosition() {
    const newScrollTop = document.body.scrollTop || document.documentElement.scrollTop;
    
    // Update toolbar position based on window scroll
    toolbar.style.top = newScrollTop + "px";
    
    // Check and update canvas dimensions if needed
    const containerWeaveScroll = document.querySelector('#container-weave, .container-weave');
    if (containerWeaveScroll && containerWeaveScroll.scrollWidth !== fabricCanvas.getWidth()) {
      console.log("Updating canvas width from", fabricCanvas.getWidth(), "to", containerWeaveScroll.scrollWidth);
      fabricCanvas.setWidth(containerWeaveScroll.scrollWidth);
    }

    if (newScrollTop + screen.height > fabricCanvas.getHeight()) {
      const maxHeight = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        documentElement.clientHeight,
        documentElement.scrollHeight,
        documentElement.offsetHeight
      );

      const newHeight =
        fabricCanvas.getHeight() + 7500 < maxHeight
          ? fabricCanvas.getHeight() + 7500
          : maxHeight;

      if (newHeight !== fabricCanvas.getHeight()) {
        fabricCanvas.setHeight(newHeight);
      }
    }

    if (fabricCanvas.getHeight() > 25000) {
      alert(
        "Web Marker does not support pages with this height. Please try again on a different website."
      );
      exitMarker();
    }
  }

  // Listen to window scroll events
  window.onscroll = updateCanvasPosition;

  // Keyboard shortcuts
  const pressedKeys = {};

  document.addEventListener("keydown", function (event) {
    pressedKeys[event.code] = true;

    // Delete selected objects with Backspace
    if (event.code === "Backspace" && !isTextMode && !isEditingText) {
      const activeObjects = fabricCanvas.getActiveObjects();
      for (let i = 0; i < activeObjects.length; i++) {
        fabricCanvas.remove(activeObjects[i]);
      }
      fabricCanvas.discardActiveObject().renderAll();
      saveCanvasState();
    }

    // Exit with Escape
    if (event.code === "Escape") {
      exitMarker();
    }

    // Keyboard shortcuts with Shift
    const shortcuts = {
      KeyZ: undoAction,
      KeyR: redoAction,
      KeyD: selectPenTool,
      KeyH: selectHighlighterTool,
      KeyM: selectMoveTool,
      KeyT: selectTextTool,
      KeyP: selectPointerTool,
      KeyL: selectLineTool,
      KeyE: selectEraserTool,
      KeyX: clearCanvas,
    };

    if (
      !isEditingText &&
      !isTextMode &&
      !isMouseDown &&
      pressedKeys.ShiftLeft &&
      shortcuts[event.code] &&
      ((event.code === "KeyX" && !isPointerMode) || event.code !== "KeyX")
    ) {
      shortcuts[event.code]();
    }
  });

  document.addEventListener("keyup", function (event) {
    pressedKeys[event.code] = false;
  });
}
