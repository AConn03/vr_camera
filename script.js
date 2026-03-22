// Advanced Edge Detection Effect with Band Pass Pre-filter
const EdgeDetectionEffect = {
    apply: function(video, canvas, threshold = 50, neighborhoodSize = 1, bandMedian = 127, bandRange = 255) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const w = video.videoWidth;
        const h = video.videoHeight;
        
        // If video isn't ready, skip
        if (w === 0 || h === 0) return;

        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        
        // Draw video frame
        ctx.drawImage(video, 0, 0, w, h);
        
        // Get image data
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        
        // Convert to grayscale and Apply Band Pass Filter
        const grayscaleData = new Array(w * h);
        
        // bandRange is the full width, so half-width for checking distance from center
        const halfWidth = bandRange / 2;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            let gray = 0.299 * r + 0.587 * g + 0.114 * b;
            
            // Band Pass Filter Logic
            if (Math.abs(gray - bandMedian) > halfWidth) {
                gray = 0; 
            }
            
            grayscaleData[i / 4] = gray;
        }
        
        // Apply edge detection on the filtered grayscale data
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x);
                const dataIndex = i * 4;

                const G_current = grayscaleData[i];

                let diffX = 0;
                let diffY = 0;

                // Difference in X direction
                if (x < w - 1) {
                    const G_right = grayscaleData[i + 1];
                    diffX = Math.abs(G_current - G_right);
                }

                // Difference in Y direction
                if (y < h - 1) {
                    const G_bottom = grayscaleData[i + w];
                    diffY = Math.abs(G_current - G_bottom);
                }

                // Simple gradient magnitude
                const magnitude = diffX + diffY;
                
                // Threshold the edge
                let outputColor = magnitude > threshold ? 255 : 0;
                
                // Draw green edges on transparent background (or black)
                data[dataIndex] = 0;     // R
                data[dataIndex + 1] = outputColor; // G
                data[dataIndex + 2] = 0;     // B
                
                // Alpha: If edge, opaque. If no edge, transparent.
                data[dataIndex + 3] = 255; 
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
    }
};

// Effects Module
const Effects = {
    none: {
        apply: function(video, canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    },
    
    edges: {
        apply: function(video, canvas, params) {
            EdgeDetectionEffect.apply(
                video, 
                canvas, 
                params.threshold, 
                params.neighborhoodSize, 
                params.bandMedian,
                params.bandRange
            );
        }
    },
    
    longExposure: {
        contexts: {}, 
        
        apply: function(video, canvas, params) {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w === 0 || h === 0) return;

            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;

            const maxFrames = params.blendFrames;
            const mode = params.blendMode || 'average';
            const numPixels = w * h * 4;

            if (!this.contexts[canvas.id] || 
                this.contexts[canvas.id].w !== w || 
                this.contexts[canvas.id].maxFrames !== maxFrames) {
                
                this.contexts[canvas.id] = {
                    w: w, 
                    h: h, 
                    maxFrames: maxFrames,
                    buffer: Array(maxFrames).fill(null).map(() => new Uint8Array(numPixels)),
                    sumBuffer: new Uint32Array(numPixels),
                    index: 0,
                    currentFrames: 0
                };
            }

            const state = this.contexts[canvas.id];
            
            ctx.drawImage(video, 0, 0, w, h);
            const currentImageData = ctx.getImageData(0, 0, w, h);
            const currentData = currentImageData.data;
            const targetBuffer = state.buffer[state.index];

            // Always maintain the running sum (in case user switches to Average mid-stream)
            if (state.currentFrames === maxFrames) {
                for (let i = 0; i < numPixels; i++) {
                    state.sumBuffer[i] -= targetBuffer[i];
                }
            } else {
                state.currentFrames++;
            }

            for (let i = 0; i < numPixels; i++) {
                const val = currentData[i];
                state.sumBuffer[i] += val;
                targetBuffer[i] = val;
            }

            // --- OUTPUT CALCULATION BASED ON MODE ---
            if (mode === 'average') {
                for (let i = 0; i < numPixels; i += 4) {
                    currentData[i]     = state.sumBuffer[i] / state.currentFrames;     
                    currentData[i + 1] = state.sumBuffer[i + 1] / state.currentFrames; 
                    currentData[i + 2] = state.sumBuffer[i + 2] / state.currentFrames; 
                    currentData[i + 3] = 255;                                          
                }
            } else {
                const isLighten = mode === 'lighten';
                
                for (let i = 0; i < numPixels; i += 4) {
                    let r = isLighten ? 0 : 255;
                    let g = isLighten ? 0 : 255;
                    let b = isLighten ? 0 : 255;

                    // Scan the history buffer to find the min or max for this pixel
                    for (let f = 0; f < state.currentFrames; f++) {
                        const frame = state.buffer[f];
                        if (isLighten) {
                            if (frame[i] > r) r = frame[i];
                            if (frame[i+1] > g) g = frame[i+1];
                            if (frame[i+2] > b) b = frame[i+2];
                        } else {
                            if (frame[i] < r) r = frame[i];
                            if (frame[i+1] < g) g = frame[i+1];
                            if (frame[i+2] < b) b = frame[i+2];
                        }
                    }
                    
                    currentData[i]     = r;
                    currentData[i + 1] = g;
                    currentData[i + 2] = b;
                    currentData[i + 3] = 255;
                }
            }

            state.index = (state.index + 1) % maxFrames;
            ctx.putImageData(currentImageData, 0, 0);
        },
        
        reset: function() {
            this.contexts = {}; 
        }
    },
    
    invert: {
        apply: function(video, canvas) {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (video.videoWidth === 0) return;

            if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
            if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
            
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                data[i] = 255 - data[i];
                data[i + 1] = 255 - data[i + 1];
                data[i + 2] = 255 - data[i + 2];
            }
            
            ctx.putImageData(imageData, 0, 0);
        }
    }
};

// Main Application
document.addEventListener('DOMContentLoaded', function() {
    const videoLeft = document.getElementById('video-left');
    const videoRight = document.getElementById('video-right');
    const singleVideo = document.getElementById('single-video');
    const canvasLeft = document.getElementById('canvas-left');
    const canvasRight = document.getElementById('canvas-right');
    const canvasSingle = document.getElementById('canvas-single');
    const wrapperLeft = document.getElementById('wrapper-left');
    const wrapperRight = document.getElementById('wrapper-right');
    
    const startButton = document.getElementById('start-camera');
    const stopButton = document.getElementById('stop-camera');
    const toggleVRButton = document.getElementById('toggle-vr');
    const switchCameraButton = document.getElementById('switch-camera');
    const offsetInButton = document.getElementById('offset-in');
    const offsetOutButton = document.getElementById('offset-out');
    const offsetResetButton = document.getElementById('offset-reset');
    const effectSelect = document.getElementById('effect-select');
    
    // Edge detection controls
    const edgeControls = document.getElementById('edge-controls');
    const edgeThreshold = document.getElementById('edge-threshold');
    const edgeThresholdValue = document.getElementById('edge-threshold-value');
    const neighborhoodSize = document.getElementById('neighborhood-size');
    const neighborhoodSizeValue = document.getElementById('neighborhood-size-value');
    
    // Band Pass Controls
    const bandMedian = document.getElementById('band-median');
    const bandMedianValue = document.getElementById('band-median-value');
    const bandRange = document.getElementById('band-range');
    const bandRangeValue = document.getElementById('band-range-value');

    // Long Exposure Controls
    const longExposureControls = document.getElementById('long-exposure-controls');
    const blendFrames = document.getElementById('blend-frames');
    const blendFramesValue = document.getElementById('blend-frames-value');
    const blendMode = document.getElementById('blend-mode');
    
    const statusDiv = document.getElementById('status');
    const offsetDisplay = document.getElementById('offset-display');
    const cameraDisplay = document.getElementById('camera-display');
    const effectDisplay = document.getElementById('effect-display');
    const controlsPanel = document.getElementById('controls-panel');
    
    const videoContainer = document.getElementById('video-container');
    
    let stream = null;
    let vrMode = false;
    let hideControlsTimeout = null;
    let currentOffset = 0;
    let usingBackCamera = true;
    let currentEffect = 'none';
    let animationFrameId = null;
    const maxOffset = 200;
    const HIDE_DELAY = 3000; 
    
    // Start camera function
    async function startCamera() {
        try {
            statusDiv.textContent = 'Requesting camera access...';
            
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    facingMode: usingBackCamera ? { exact: 'environment' } : 'user'
                },
                audio: false
            });
            
            setupVideoStream();
            startEffectRendering();
            
        } catch (error) {
            console.error('Error accessing back camera:', error);
            tryFallbackCamera();
        }
    }
    
    function setupVideoStream() {
        videoLeft.srcObject = stream;
        videoRight.srcObject = stream;
        singleVideo.srcObject = stream;
        
        statusDiv.textContent = 'Camera active';
        startButton.disabled = true;
        stopButton.disabled = false;
        updateCameraDisplay();
        resetHideControlsTimer();
    }
    
    async function tryFallbackCamera() {
        try {
            statusDiv.textContent = 'Back camera not available, trying any camera...';
            stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });
            
            setupVideoStream();
            usingBackCamera = false;
            updateCameraDisplay();
        } catch (fallbackError) {
            console.error('Error accessing any camera:', fallbackError);
            statusDiv.textContent = `Error: ${fallbackError.message}`;
        }
    }
    
    // Effect rendering loop
    function startEffectRendering() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        
        function renderEffects() {
            if (stream && currentEffect !== 'none') {
                const effect = Effects[currentEffect];
                
                // Pack params
                const params = {
                    threshold: parseInt(edgeThreshold.value),
                    neighborhoodSize: parseInt(neighborhoodSize.value),
                    bandMedian: parseInt(bandMedian.value) * 2.55, 
                    bandRange: parseInt(bandRange.value) * 2.55,
                    blendFrames: parseInt(blendFrames.value),
                    blendMode: blendMode.value
                };

                if (effect) {
                    if (vrMode) {
                        effect.apply(videoLeft, canvasLeft, params);
                        effect.apply(videoRight, canvasRight, params);
                        canvasLeft.style.display = 'block';
                        canvasRight.style.display = 'block';
                    } else {
                        effect.apply(singleVideo, canvasSingle, params);
                        canvasSingle.style.display = 'block';
                    }
                }
            } else {
                // Hide canvas when no effect
                canvasLeft.style.display = 'none';
                canvasRight.style.display = 'none';
                canvasSingle.style.display = 'none';
            }
            animationFrameId = requestAnimationFrame(renderEffects);
        }
        renderEffects();
    }
    
    // Switch camera function
    async function switchCamera() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            usingBackCamera = !usingBackCamera;
            
            try {
                statusDiv.textContent = 'Switching camera...';
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                        facingMode: usingBackCamera ? { exact: 'environment' } : 'user'
                    },
                    audio: false
                });
                
                setupVideoStream();
            } catch (error) {
                console.error('Error switching camera:', error);
                statusDiv.textContent = `Error switching camera: ${error.message}`;
                usingBackCamera = !usingBackCamera;
                updateCameraDisplay();
            }
        }
    }
    
    function updateCameraDisplay() {
        cameraDisplay.textContent = `Camera: ${usingBackCamera ? 'Back' : 'Front'}`;
        switchCameraButton.textContent = `Switch to ${usingBackCamera ? 'Front' : 'Back'} Camera`;
    }
    
    // Effect handling
    function changeEffect() {
        // Free RAM buffer if we switch away from long exposure
        if (currentEffect === 'longExposure' && effectSelect.value !== 'longExposure') {
            Effects.longExposure.reset();
        }

        currentEffect = effectSelect.value;
        effectDisplay.textContent = `Effect: ${currentEffect.charAt(0).toUpperCase() + currentEffect.slice(1)}`;
        
        // Hide all control panels first
        edgeControls.classList.add('ui-hidden-element');
        longExposureControls.classList.add('ui-hidden-element');
        
        // Show specific controls based on selected effect
        if (currentEffect === 'edges') {
            edgeControls.classList.remove('ui-hidden-element');
        } else if (currentEffect === 'longExposure') {
            longExposureControls.classList.remove('ui-hidden-element');
        }
        
        startEffectRendering();
        resetHideControlsTimer();
    }
    
    // Parameter updates
    function updateEffectParams() {
        edgeThresholdValue.textContent = edgeThreshold.value;
        neighborhoodSizeValue.textContent = neighborhoodSize.value;
        bandMedianValue.textContent = bandMedian.value;
        bandRangeValue.textContent = bandRange.value;
        blendFramesValue.textContent = blendFrames.value;
        resetHideControlsTimer();
    }
    
    // Stop camera function
    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
            
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            
            videoLeft.srcObject = null;
            videoRight.srcObject = null;
            singleVideo.srcObject = null;
            
            statusDiv.textContent = 'Camera stopped';
            startButton.disabled = false;
            stopButton.disabled = true;
            
            vrMode = false;
            currentOffset = 0;
            updateVRMode();
            updateOffset();
        }
    }
    
    // VR mode and offset functions
    function toggleVRMode() {
        vrMode = !vrMode;
        updateVRMode();
        resetHideControlsTimer();
    }
    
    function updateVRMode() {
        if (vrMode) {
            videoContainer.style.display = 'flex';
            singleVideo.style.display = 'none';
            canvasSingle.style.display = 'none';
            toggleVRButton.textContent = 'Disable VR View';
            statusDiv.textContent = 'VR View Enabled - Side by Side';
        } else {
            videoContainer.style.display = 'none';
            singleVideo.style.display = 'block';
            canvasLeft.style.display = 'none';
            canvasRight.style.display = 'none';
            toggleVRButton.textContent = 'Enable VR View';
            statusDiv.textContent = 'Camera active - Single View';
        }
        updateOffset();
        startEffectRendering();
    }
    
    function updateOffset() {
        if (vrMode) {
            wrapperLeft.style.transform = `translateX(-${currentOffset}px)`;
            wrapperRight.style.transform = `translateX(${currentOffset}px)`;
            offsetDisplay.textContent = `Offset: ${currentOffset}px`;
        } else {
            wrapperLeft.style.transform = 'translateX(0)';
            wrapperRight.style.transform = 'translateX(0)';
        }
    }
    
    function increaseOffset() {
        if (currentOffset < maxOffset) {
            currentOffset += 10;
            updateOffset();
        }
        resetHideControlsTimer();
    }
    
    function decreaseOffset() {
        if (currentOffset > 0) {
            currentOffset -= 10;
            updateOffset();
        }
        resetHideControlsTimer();
    }
    
    function resetOffset() {
        currentOffset = 0;
        updateOffset();
        resetHideControlsTimer();
    }
    
    // Auto-hide controls logic
    function hideControls() {
        controlsPanel.classList.add('hidden');
    }
    
    function showControls() {
        controlsPanel.classList.remove('hidden');
        resetHideControlsTimer();
    }
    
    function toggleControls(e) {
        if (e.target.closest('#controls-panel')) {
            resetHideControlsTimer();
            return;
        }
        
        if (controlsPanel.classList.contains('hidden')) {
            showControls();
        } else {
            hideControls();
            if (hideControlsTimeout) {
                clearTimeout(hideControlsTimeout);
            }
        }
    }
    
    function resetHideControlsTimer() {
        if (hideControlsTimeout) {
            clearTimeout(hideControlsTimeout);
        }
        hideControlsTimeout = setTimeout(hideControls, HIDE_DELAY);
    }
    
    // Event listeners
    startButton.addEventListener('click', startCamera);
    stopButton.addEventListener('click', stopCamera);
    toggleVRButton.addEventListener('click', toggleVRMode);
    switchCameraButton.addEventListener('click', switchCamera);
    offsetInButton.addEventListener('click', increaseOffset);
    offsetOutButton.addEventListener('click', decreaseOffset);
    offsetResetButton.addEventListener('click', resetOffset);
    effectSelect.addEventListener('change', changeEffect);
    
    // Parameter listeners
    edgeThreshold.addEventListener('input', updateEffectParams);
    neighborhoodSize.addEventListener('input', updateEffectParams);
    bandMedian.addEventListener('input', updateEffectParams);
    bandRange.addEventListener('input', updateEffectParams);
    blendFrames.addEventListener('input', updateEffectParams);
    blendMode.addEventListener('change', updateEffectParams);
    // Toggle controls on click/tap
    document.body.addEventListener('click', toggleControls);
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusDiv.textContent = 'Your browser does not support camera access';
        startButton.disabled = true;
        toggleVRButton.disabled = true;
        switchCameraButton.disabled = true;
    }
    
    // Initialize UI
    updateEffectParams();
    updateVRMode();
});