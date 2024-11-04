/**
 * Query for WebXR support. If there's no support for the `immersive-ar` mode,
 * show an error.
 */
(async function() {
  const isArSessionSupported = navigator.xr && navigator.xr.isSessionSupported && await navigator.xr.isSessionSupported("immersive-ar");
  if (isArSessionSupported) {
    document.getElementById("enter-ar").addEventListener("click", window.app.activateXR)
  } else {
    onNoXRDevice();
  }
})();

/**
 * Container class to manage connecting to the WebXR Device API
 * and handle rendering on every frame.
 */
class App {
  /**
   * Run when the Start AR button is pressed.
   */
  activateXR = async () => {
    try {
      // Initialize a WebXR session using "immersive-ar".
      this.xrSession = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: document.body }
      });

      // Create the canvas that will contain our camera's background and our virtual scene.
      this.createXRCanvas();

      // With everything set up, start the app.
      await this.onSessionStarted();
    } catch(e) {
      console.log(e);
      onNoXRDevice();
    }
  }

  /**
   * Add a canvas element and initialize a WebGL context that is compatible with WebXR.
   */
  createXRCanvas() {
    this.canvas = document.createElement("canvas");
    document.body.appendChild(this.canvas);
    this.gl = this.canvas.getContext("webgl", {xrCompatible: true});

    this.xrSession.updateRenderState({
      baseLayer: new XRWebGLLayer(this.xrSession, this.gl)
    });
  }

  /**
   * Called when the XRSession has begun. Here we set up our three.js
   * renderer, scene, and camera and attach our XRWebGLLayer to the
   * XRSession and kick off the render loop.
   */
  onSessionStarted = async () => {
    // Add the `ar` class to our body, which will hide our 2D components
    document.body.classList.add('ar');

    // Start spawning obstacles every 2 seconds
    setInterval(this.spawnObstacle, 2000);

    // To help with working with 3D on the web, we'll use three.js.
    this.setupThreeJs();

    this.asteroids = [];
    this.score = 0; // Initialize score
    // Initialize the ship's X position
    this.shipXPosition = 0;

    // Setup an XRReferenceSpace using the "local" coordinate system.
    this.localReferenceSpace = await this.xrSession.requestReferenceSpace('local');

    // Create another XRReferenceSpace that has the viewer as the origin.
    this.viewerSpace = await this.xrSession.requestReferenceSpace('viewer');
    // Perform hit testing using the viewer as origin.
    this.hitTestSource = await this.xrSession.requestHitTestSource({ space: this.viewerSpace });

    // Start a rendering loop using this.onXRFrame.
    this.xrSession.requestAnimationFrame(this.onXRFrame);


    // Attach event listener for device orientation
    this.xrSession.addEventListener("deviceorientation", this.handleOrientation, true);
  }

  /**
   * Called on the XRSession's requestAnimationFrame.
   * Called with the time and XRPresentationFrame.
   */
  onXRFrame = (time, frame) => {
    // Queue up the next draw request.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    // Bind the graphics framebuffer to the baseLayer's framebuffer.
    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer)
    this.renderer.setFramebuffer(framebuffer);

    // Retrieve the pose of the device.
    // XRFrame.getViewerPose can return null while the session attempts to establish tracking.
    const pose = frame.getViewerPose(this.localReferenceSpace);
    if (pose) {
      // In mobile AR, we only have one view.
      const view = pose.views[0];

      const viewport = this.xrSession.renderState.baseLayer.getViewport(view);
      this.renderer.setSize(viewport.width, viewport.height)

      // Use the view's transform matrix and projection matrix to configure the THREE.camera.
      this.camera.matrix.fromArray(view.transform.matrix)
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.updateMatrixWorld(true);

      // Conduct hit test.
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);

      // If we have results, consider the environment stabilized.
      if (!this.stabilized && hitTestResults.length > 0) {
        this.stabilized = true;
        document.body.classList.add('stabilized');
      }
      if (hitTestResults.length > 0) {
        const hitPose = hitTestResults[0].getPose(this.localReferenceSpace);

        // Update the reticle position
        this.reticle.visible = true;
        this.reticle.position.set(hitPose.transform.position.x, hitPose.transform.position.y, hitPose.transform.position.z)
        this.reticle.updateMatrixWorld(true);
      }

      // Render the scene with THREE.WebGLRenderer.
      this.renderer.render(this.scene, this.camera);

      // Update obstacles and check for collisions
      this.asteroids.forEach((asteroid, index) => {
        // Move the obstacle downwards
        asteroid.position.add(asteroid.userData.velocity);

        // Check for collision with a small "ship zone" near the camera position
        if (asteroid.position.distanceTo(app.reticle.position) > -0.1) { // Adjust for distance as needed
          console.log("Collision!"); // Indicate a collision with the player's ship
          this.score -= 1;
          this.scene.remove(asteroid);
          this.asteroids.splice(index, 1);
        } else if (asteroid.position.distanceTo(app.reticle.position) > 1) {
          // Remove asteroids that move past the player
          this.scene.remove(asteroid);
          this.asteroids.splice(index, 1);
          this.score += 1;
        }
      });
    }

    // Update score display
    document.getElementById("score-value").textContent = app.score;
  }

  /**
   * Initialize three.js specific rendering code, including a WebGLRenderer,
   * a demo scene, and a camera for viewing the 3D content.
   */
  setupThreeJs() {
    // To help with working with 3D on the web, we'll use three.js.
    // Set up the WebGLRenderer, which handles rendering to our session's base layer.
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      preserveDrawingBuffer: true,
      canvas: this.canvas,
      context: this.gl
    });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Initialize our demo scene.
    this.scene = Scenes.createLitScene();
    this.reticle = new Reticle();
    this.scene.add(this.reticle);

    // We'll update the camera matrices directly from API, so
    // disable matrix auto updates so three.js doesn't attempt
    // to handle the matrices independently.
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;

    const spaceTexture = new THREE.TextureLoader().load('assets/space_texture.png');
    const spaceGeometry = new THREE.SphereGeometry(100, 64, 64);
    const spaceMaterial = new THREE.MeshBasicMaterial({ map: spaceTexture, side: THREE.BackSide });
    const spaceBackground = new THREE.Mesh(spaceGeometry, spaceMaterial);

    app.scene.add(spaceBackground);
  }

  spawnObstacle() {
    const asteroid = asteroidModel.clone();

    // Position the asteroid at a random location in front of the player
    asteroid.position.set(
        (Math.random() - 0.5) * 1.5,  // X position - a bit spread out horizontally
        (Math.random() - 0.5) * 0.5,  // Y position - spread slightly vertically
        -3                             // Z position - set farther away to simulate coming forward
    );

    // Set velocity to make it move toward the player
    asteroid.userData.velocity = new THREE.Vector3(0, 0, 0.02);
    this.scene.add(this.asteroid);
    this.asteroids.push(this.asteroid);
  }

  handleOrientation(event) {
    const gamma = event.gamma; // Left/right tilt (in degrees)

    // Map gamma (-45 to 45) to our desired movement range (-1 to 1)
    const tiltAmount = Math.max(-1, Math.min(1, gamma / 45));
    this.shipXPosition = tiltAmount * 1.5; // Adjust multiplier for range

    // Update the reticle (or spaceship) position to reflect movement
    if (this.reticle) {
      this.reticle.position.x = shipXPosition;
    }
  }

}

window.app = new App();
