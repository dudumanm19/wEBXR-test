// Load the laser and explosion sounds
const laserSound = new Audio('sounds/laser.mp3');
const explosionSound = new Audio('sounds/explosion.mp3');
const spaceSound = new Audio('sounds/space_ambiance.mp3');

spaceSound.loop = true;  // Enable looping
spaceSound.volume = 1; // Adjust volume to make it subtle

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
  asteroid.scale.set(0.5, 0.5, 0.5); // Adjust the values as needed

  // Position the asteroid at a random location in front of the player
  asteroid.position.set(
      (Math.random() - 0.5) * 1.5,  // X position - a bit spread out horizontally
      (Math.random() - 0.5) * 0.5,  // Y position - spread slightly vertically
      -5                             // Z position - set farther away to simulate coming forward
  );

  // Set velocity to make it move toward the player
  asteroid.userData.velocity = new THREE.Vector3(0, 0, 0.5);
  app.scene.add(asteroid);
  app.asteroids.push(asteroid);
}

function handleOrientation(event) {
  const gamma = event.gamma; // Left/right tilt in degrees

  // Map gamma (-45 to 45) to the movement range (-1 to 1)
  const tiltAmount = Math.max(-1, Math.min(1, gamma / 45));
  app.shipXPosition = tiltAmount * 1.5; // Adjust the multiplier as needed

  // Update the reticle position to reflect the movement
  if (app.reticle) {
    app.reticle.position.x = app.shipXPosition; // Set the reticle's X position
    app.reticle.updateMatrixWorld(true); // Apply the change
  }
}

function createLaser() {
  const laserGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8);
  const laserMaterial = new THREE.MeshBasicMaterial({color: 0xff0000});
  const laser = new THREE.Mesh(laserGeometry, laserMaterial);

  // Position the laser in front of the ship
  laser.position.set(app.reticle.position.x, app.reticle.position.y, app.reticle.position.z - 0.5);
  laser.rotation.x = Math.PI / 2; // Rotate so it faces forward

  // Set the velocity to make it move forward
  laser.userData.velocity = new THREE.Vector3(0, 0, -0.1); // Adjust this value to control speed
  app.scene.add(laser);
  app.lasers.push(laser);

  // Play laser sound
  laserSound.currentTime = 0; // Reset to start for overlapping shots
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

    // Attach event listener for device orientation
    window.addEventListener("deviceorientation", handleOrientation, true);
  }

  onXRFrame = (time, frame) => {
    // Queue up the next draw request.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    // Bind the graphics framebuffer to the baseLayer's framebuffer.
    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer)
    this.renderer.setFramebuffer(framebuffer);

    // Retrieve the pose of the device.
    const pose = frame.getViewerPose(this.localReferenceSpace);
    if (pose) {
      // In mobile AR, we only have one view.
      const view = pose.views[0];

      const viewport = this.xrSession.renderState.baseLayer.getViewport(view);
      this.renderer.setSize(viewport.width, viewport.height);

      // Use the view's transform matrix and projection matrix to configure the THREE.camera.
      this.camera.matrix.fromArray(view.transform.matrix);
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.updateMatrixWorld(true);

      // Perform hit test and update reticle position
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);
      console.log("Hit Test Results:", hitTestResults);
      if (hitTestResults.length > 0) {
        if (!this.stabilized) {
          this.stabilized = true;
          document.body.classList.add('stabilized');
        }

        const hitPose = hitTestResults[0].getPose(this.localReferenceSpace);
        app.reticle.position.lerp(
            new THREE.Vector3(
                hitPose.transform.position.x,
                hitPose.transform.position.y,
                hitPose.transform.position.z
            ), 0.2 // Adjust the value between 0 and 1 for smoothness
        );
        app.reticle.visible = true;
        app.reticle.updateMatrixWorld(true);
      } else {
        this.reticle.visible = false; // Hide the reticle if no hit is found
      }

      if (this.stabilized) {
        if (!this.game_started) {
          this.game_started = true;
          document.body.classList.add('game-started');
          // Start spawning asteroids every 2 seconds
          setInterval(spawnAsteroid, 2000);
          setInterval(createLaser, 200); // Fire lasers every 200 ms
        }

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
            // Move the asteroid toward the player by updating its position based on its velocity
            asteroid.position.add(asteroid.userData.velocity);

            // Remove asteroid if it moves too far beyond the player
            if (asteroid.position.z > 1) { // Adjust condition as needed for removal
              app.scene.remove(asteroid);
              app.asteroids.splice(asteroidIndex, 1);
            }

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
  };

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
      color: 0xffffff,
      size: 0.7, // Size of each star point
      sizeAttenuation: true,
    });

    const starField = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(starField);
    this.scene.add(this.reticle);
  }
}

window.app = new App();