// Load the laser and explosion sounds
const laserSound = new Audio('sounds/laser.mp3');
const explosionSound = new Audio('sounds/explosion.mp3');
const spaceSound = new Audio('sounds/space_ambiance.mp3');

spaceSound.loop = true;  // Enable looping
spaceSound.volume = 0.9; // Adjust volume to make it subtle

laserSound.volume = 0.4; // Set volume to 40%
explosionSound.volume = 0.6; // Set volume to 60%

let asteroidModel;

window.gltfLoader = new THREE.GLTFLoader();
window.gltfLoader.load("models/asteroid/scene.gltf", (gltf) => {
  asteroidModel = gltf.scene;
  console.log("Asteroid model loaded successfully");
}, undefined, (error) => {
  console.error("Error loading the GLTF model:", error);
});

class Reticle extends THREE.Object3D {
  constructor() {
    super();

    this.loader = new THREE.GLTFLoader();
    this.loader.load("https://immersive-web.github.io/webxr-samples/media/gltf/reticle/reticle.gltf", (gltf) => {
      // Rotate the reticle model 90 degrees upwards
      this.rotation.x = Math.PI / 2;

      this.add(gltf.scene);
      console.log("Reticle loaded successfully");
      this.visible = false; // Make sure it's initially hidden until a hit result is detected
    }, undefined, (error) => {
      console.error("Error loading reticle:", error);
    });

    this.visible = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (navigator.xr && navigator.xr.isSessionSupported) {
    try {
      const isArSessionSupported = await navigator.xr.isSessionSupported("immersive-ar");
      if (isArSessionSupported) {
        document.getElementById("enter-ar").addEventListener("click", window.app.activateXR);
      } else {
        onNoXRDevice();
      }
    } catch (error) {
      console.error("Error checking AR session support:", error);
      onNoXRDevice();
    }
  } else {
    onNoXRDevice();
  }
});

function onNoXRDevice() {
  document.body.classList.add('unsupported');
}

function spawnAsteroid() {
  if (!asteroidModel) {
    console.warn("Asteroid model not loaded yet.");
    return; // Ensure the model is loaded before spawning asteroids
  }

  // Clone the loaded asteroid model to create a new instance
  const asteroid = asteroidModel.clone();
  asteroid.scale.set(0.25, 0.25, 0.25); // Adjust size as needed

  // Get the current camera position and direction
  const cameraWorldPosition = new THREE.Vector3();
  app.camera.getWorldPosition(cameraWorldPosition);

  const cameraWorldDirection = new THREE.Vector3();
  app.camera.getWorldDirection(cameraWorldDirection);

  // Calculate a random offset to position the asteroid around the current view
  const spawnDistance = 10; // Distance from the camera to spawn the asteroid
  const randomOffset = new THREE.Vector3(
      (Math.random() - 0.5) * 4, // Random X offset for spread
      (Math.random() - 0.5) * 4, // Random Y offset for spread
      (Math.random() - 0.5) * 2  // Random Z offset for slight depth variation
  );

  // Calculate asteroid spawn position
  const asteroidPosition = cameraWorldPosition.clone()
      .add(cameraWorldDirection.multiplyScalar(spawnDistance)) // Place asteroid in front of the camera
      .add(randomOffset); // Apply some randomness around that direction

  // Set asteroid's position
  asteroid.position.copy(asteroidPosition);

  // Set velocity to make it move towards the player
  const velocityDirection = new THREE.Vector3().subVectors(cameraWorldPosition, asteroid.position).normalize();
  asteroid.userData.velocity = velocityDirection.multiplyScalar(0.05); // Adjust speed of asteroids

  // Add the asteroid to the scene
  app.scene.add(asteroid);
  app.asteroids.push(asteroid);
}

function handleOrientation(event) {
  const alpha = event.alpha; // Rotation around the Y-axis (0 to 360 degrees)

  if (app.reticle) {
    // Map the alpha value to a rotation angle for your reticle
    const rotationRadians = THREE.MathUtils.degToRad(alpha); // Convert degrees to radians
    app.reticle.rotation.y = rotationRadians; // Apply Y-axis rotation to the reticle

    // Ensure the transformation is properly updated
    app.reticle.updateMatrixWorld(true);
  }
}

function createLaser() {
  // Create laser geometry and material
  const laserGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8);
  const laserMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const laser = new THREE.Mesh(laserGeometry, laserMaterial);

  // Position the laser in front of the camera
  const cameraWorldPosition = new THREE.Vector3();
  app.camera.getWorldPosition(cameraWorldPosition);
  laser.position.copy(cameraWorldPosition);

  // Rotate the laser to face the direction of the camera
  laser.quaternion.copy(app.camera.quaternion);

  // Set the laser's velocity to move in the direction the camera is facing
  const cameraDirection = new THREE.Vector3();
  app.camera.getWorldDirection(cameraDirection);
  laser.userData.velocity = cameraDirection.multiplyScalar(0.5); // Set speed of the laser

  // Add laser to the scene and to the lasers array for tracking
  app.scene.add(laser);
  app.lasers.push(laser);

  // Play the laser firing sound
  laserSound.currentTime = 0; // Reset sound to start for overlapping shots
  laserSound.play();
}



class App {
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
    document.body.classList.add('stabilized');

    // Attach event listener for device orientation
    window.addEventListener("deviceorientation", handleOrientation, true);
  }

  onXRFrame = (time, frame) => {
    // Queue up the next draw request.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    // Bind the graphics framebuffer to the baseLayer's framebuffer.
    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.renderer.setFramebuffer(framebuffer);

    // Retrieve the pose of the device in relation to the AR session's local reference space.
    const pose = frame.getViewerPose(this.localReferenceSpace);
    if (pose) {
      // In mobile AR, we only have one view.
      const view = pose.views[0];

      const viewport = this.xrSession.renderState.baseLayer.getViewport(view);
      this.renderer.setSize(viewport.width, viewport.height);

      // Update the camera matrices
      this.camera.matrix.fromArray(view.transform.matrix);
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.updateMatrixWorld(true);

      // Position the reticle in front of the camera, always at a fixed distance
      const distanceInFront = 1; // Distance in meters in front of the camera
      const cameraWorldPosition = new THREE.Vector3();
      this.camera.getWorldPosition(cameraWorldPosition);

      // Get the direction the camera is facing
      const cameraWorldDirection = new THREE.Vector3();
      this.camera.getWorldDirection(cameraWorldDirection);

      // Set reticle position to always be in front of the camera at a fixed distance
      const reticlePosition = cameraWorldPosition.add(cameraWorldDirection.multiplyScalar(distanceInFront));
      this.reticle.position.copy(reticlePosition);
      this.reticle.visible = true; // Ensure the reticle is visible
      this.reticle.updateMatrixWorld(true);

      // Start the game logic (only runs once)
      if (!this.game_started) {
        this.game_started = true;
        document.body.classList.add('game-started');
        // Start spawning asteroids every 2 seconds
        setInterval(spawnAsteroid, 2000);
        setInterval(createLaser, 200); // Fire lasers every 200 ms
      }

      app.asteroids.forEach((asteroid, asteroidIndex) => {
        // Move asteroid towards the player using the velocity
        asteroid.position.add(asteroid.userData.velocity);

        // Remove the asteroid if it moves too far past the player
        if (asteroid.position.distanceTo(app.camera.position) < 0.5) {
          console.log("Asteroid reached the player!");
          app.scene.remove(asteroid);
          app.asteroids.splice(asteroidIndex, 1);
        }
      });

      app.lasers.forEach((laser, laserIndex) => {
        // Move the laser in the direction of its velocity
        laser.position.add(laser.userData.velocity);

        // Remove the laser if it moves too far from the camera
        const distanceFromCamera = laser.position.distanceTo(app.camera.position);
        if (distanceFromCamera > 20) { // Adjust distance threshold as needed
          app.scene.remove(laser);
          app.lasers.splice(laserIndex, 1);
          return;
        }

        // Check for collisions with asteroids
        app.asteroids.forEach((asteroid, asteroidIndex) => {
          if (laser.position.distanceTo(asteroid.position) < 0.15) {
            console.log("Hit!");
            app.score += 1;

            app.scene.remove(laser);
            app.scene.remove(asteroid);

            app.lasers.splice(laserIndex, 1);
            app.asteroids.splice(asteroidIndex, 1);

            explosionSound.currentTime = 0; // Reset explosion sound for overlapping explosions
            explosionSound.play();
          }
        });
      });

      // Render the scene using the composer to add bloom effects
      this.composer.render();
    }

    // Update score display
    document.getElementById("score-value").textContent = app.score;
  };

  setupThreeJs() {
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
    this.reticle.scale.set(0.25, 0.25, 0.25);

    // We'll update the camera matrices directly from API, so
    // disable matrix auto updates so three.js doesn't attempt
    // to handle the matrices independently.
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;


    // Create a star field using particles
    const starCount = 1000; // Number of stars
    const positions = [];
    for (let i = 0; i < starCount; i++) {
      const x = (Math.random() - 0.5) * 200; // Spread out over a large area
      const y = (Math.random() - 0.5) * 200;
      const z = (Math.random() - 0.5) * 200;
      positions.push(x, y, z);
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff, // Base color of the star
      emissive: 0xffffff, // Glow color
      emissiveIntensity: 1.5, // Intensity of the glow
      roughness: 0.5,
      metalness: 0
    });

    const starField = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(starField);
    this.scene.add(this.reticle);


    // Post-processing setup
    this.composer = new THREE.EffectComposer(this.renderer);
    const renderPass = new THREE.RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    const bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5,  // strength of bloom
        0.4,  // radius of bloom
        0.85  // threshold of bloom
    );
    this.composer.addPass(bloomPass);
  }
}

window.app = new App();