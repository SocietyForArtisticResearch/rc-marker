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

  // Check for container-weave to get actual scrollable width
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

  // Save drawing function
  function saveDrawing() {
    const toolbar = document.getElementById("webMarker_draggable");

    return new Promise(function (resolve, reject) {
      toolbar.style.display = "none";
      setTimeout(function () {
        if (toolbar.style.display === "none") {
          resolve();
        } else {
          reject();
        }
      }, 500);
    })
      .then(function () {
        chrome.runtime.sendMessage(
          { from: "content_script" },
          function (response) {
            const screenshot = response.screenshot;
            const currentDate = new Date();
            const dateString =
              currentDate.getFullYear() +
              "-" +
              ("0" + (currentDate.getMonth() + 1)).slice(-2) +
              "-" +
              ("0" + currentDate.getDate()).slice(-2);

            // Download screenshot
            const downloadLink = document.createElement("a");
            downloadLink.download =
              "Screenshot_" + dateString + "_WebMarker.png";
            downloadLink.href = screenshot;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);

            // Open in new window
            const htmlContent = `
          <h1 style="font-family:Helvetica;">Web Marker Screenshot</h1>
          <img width="100%" src="${screenshot}">
        `;
            const blob = new Blob([htmlContent], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            window.open(url);

            toolbar.style.display = "block";
          }
        );
      })
      .catch(function () {
        console.error("An error occurred while saving.");
      });
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
