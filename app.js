// Load the laser and explosion sounds
const laserSound = new Audio('assets/laser.mp3');
const explosionSound = new Audio('assets/explosion.mp3');
const spaceSound = new Audio('assets/space_ambiance.mp3');

spaceSound.loop = true;  // Enable looping
spaceSound.volume = 0.7; // Adjust volume to make it subtle

laserSound.volume = 0.4; // Set volume to 40%
explosionSound.volume = 0.6; // Set volume to 60%

let asteroidModel;

window.gltfLoader = new THREE.GLTFLoader();
gltfLoader.load("assets/asteroid.gltf", (gltf) => {
  asteroidModel = gltf.scene;
});

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

      document.body.classList.add('game-started');
      this.game_started = false;
      this.stabilized = false;
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

    // To help with working with 3D on the web, we'll use three.js.
    this.setupThreeJs();

    this.asteroids = [];
    this.score = 0; // Initialize score
    // Initialize the ship's X position
    this.shipXPosition = 0;

    this.lasers = []; // Array to keep track of lasers
    // Start background space sound
    await spaceSound.play();

    // Setup an XRReferenceSpace using the "local" coordinate system.
    this.localReferenceSpace = await this.xrSession.requestReferenceSpace('local');

    // Create another XRReferenceSpace that has the viewer as the origin.
    this.viewerSpace = await this.xrSession.requestReferenceSpace('viewer');
    // Perform hit testing using the viewer as origin.
    this.hitTestSource = await this.xrSession.requestHitTestSource({ space: this.viewerSpace });

    // Start a rendering loop using this.onXRFrame.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    // Attach event listener for device orientation
    this.xrSession.addEventListener("deviceorientation", handleOrientation, true);
  }

  /**
   * Called on the XRSession's requestAnimationFrame.
   * Called with the time and XRPresentationFrame.
   */
  onXRFrame = (time, frame) => {
    // Queue up the next draw request.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    // Bind the graphics framebuffer to the baseLayer's framebuffer.
    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
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

      // If we have results, consider the environment stabilized.
      if (!this.stabilized) {
        document.body.classList.add('stabilized');
        this.stabilized = true;
        if (!this.game_started) {
          this.game_started = true;
          // Fire lasers every 200 milliseconds
          setInterval(createLaser, 200);
          // Start spawning obstacles every 2 seconds
          setInterval(spawnAsteroid, 2000);
        }
      }

      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction); // Get the camera's forward direction
      // Update the reticle position
      this.reticle.visible = true;
      this.reticle.position.copy(this.camera.position).add(direction.multiplyScalar(0.5)); // 0.5 units in front of the camera
      this.reticle.lookAt(camera.position); // Optional: Make the reticle face the camera
      this.reticle.updateMatrixWorld(true);

      if (this.stabilized) {
        // Update lasers and check for collisions with asteroids
        app.lasers.forEach((laser, laserIndex) => {
          // Move laser forward
          laser.position.add(laser.userData.velocity);

          // Check if the laser is far enough to be removed
          if (laser.position.z < -5) {
            // Remove laser if it’s too far forward
            app.scene.remove(laser);
            app.lasers.splice(laserIndex, 1);
            return;
          }

          // Check for collision with asteroids
          app.asteroids.forEach((asteroid, asteroidIndex) => {
            if (laser.position.distanceTo(asteroid.position) < 0.15) { // Adjust distance for collision accuracy
              // Collision detected, remove both laser and asteroid
              console.log("Hit!");
              app.score += 1;

              app.scene.remove(laser);
              app.scene.remove(asteroid);

              app.lasers.splice(laserIndex, 1);
              app.asteroids.splice(asteroidIndex, 1);

              // Play explosion sound
              explosionSound.currentTime = 0; // Reset to start for overlapping explosions
              explosionSound.play();
            }
          });
        });
      }

      // Render the scene with THREE.WebGLRenderer.
      this.renderer.render(this.scene, this.camera);
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
    this.scene = new THREE.Scene();
    this.reticle = new Reticle();

    // We'll update the camera matrices directly from API, so
    // disable matrix auto updates so three.js doesn't attempt
    // to handle the matrices independently.
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;

    const spaceTexture = new THREE.TextureLoader().load('assets/space_texture.png');
    const spaceGeometry = new THREE.SphereGeometry(100, 64, 64);
    const spaceMaterial = new THREE.MeshBasicMaterial({ map: spaceTexture, side: THREE.BackSide });
    const spaceBackground = new THREE.Mesh(spaceGeometry, spaceMaterial);

    this.scene.add(spaceBackground);
    this.scene.add(this.reticle);
  }
}

window.app = new App();

function onNoXRDevice() {
  document.body.classList.add('unsupported');
}


function spawnAsteroid() {
  //const asteroid = asteroidModel.clone();
  const geometry = new THREE.SphereGeometry(0.1, 32, 32); // Adjust size as needed
  const material = new THREE.MeshBasicMaterial({ color: 0x666666 });
  const asteroid = new THREE.Mesh(geometry, material);

  // Position the asteroid at a random location in front of the player
  asteroid.position.set(
      (Math.random() - 0.5) * 1.5,  // X position - a bit spread out horizontally
      (Math.random() - 0.5) * 0.5,  // Y position - spread slightly vertically
      -5                             // Z position - set farther away to simulate coming forward
  );

  // Set velocity to make it move toward the player
  asteroid.userData.velocity = new THREE.Vector3(0, 0, 0.1);
  app.scene.add(asteroid);
  app.asteroids.push(asteroid);
}

function handleOrientation(event) {
  const gamma = event.gamma; // Left/right tilt (in degrees)

  // Map gamma (-45 to 45) to our desired movement range (-1 to 1)
  const tiltAmount = Math.max(-1, Math.min(1, gamma / 45));
  app.shipXPosition = tiltAmount * 1.5; // Adjust multiplier for range

  // Update the reticle (or spaceship) position to reflect movement
  if (this.reticle) {
    app.reticle.position.x = app.shipXPosition;
  }
}

function createLaser() {
  const laserGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8);
  const laserMaterial = new THREE.MeshBasicMaterial({color: 0xff0000});
  const laser = new THREE.Mesh(laserGeometry, laserMaterial);

  // Position the laser in front of the ship
  laser.position.set(app.reticle.position.x, app.reticle.position.y, app.reticle.position.z - 0.5);
  laser.rotation.x = Math.PI / 2; // Rotate so it faces forward

  laser.userData.velocity = new THREE.Vector3(0, 0, -0.1); // Laser speed moving forward
  app.scene.add(laser);
  app.lasers.push(laser);

  // Play laser sound
  laserSound.currentTime = 0; // Reset to start for overlapping shots
  laserSound.play();
}
