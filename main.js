import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// =============================================
// --- 1. CONFIGURAÇÃO BASE DA CENA ---
// =============================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(5, 10, 5);
scene.add(sun);

// =============================================
// --- 2. VARIÁVEIS DE ESTADO ---
// =============================================
let ammo = 30;
let isReloading = false;
let isShooting = false;
let isADS = false;
let isGrounded = true;
let velocityY = 0;
let shotsFired = 0;
let recoilPitch = 0;
let recoilYaw = 0;
let yaw = Math.PI;
let pitch = 0;
let isLocked = false;

const GRAVITY = -0.012;
const JUMP_FORCE = 0.2;
const PLAYER_HEIGHT = 1.1;
const PLAYER_HEIGHT_CROUCH = 0.65;
let currentHeight = PLAYER_HEIGHT;
let isCrouching = false;

const HIP_POS = new THREE.Vector3(0.12, -0.14, -0.22);
const ADS_POS = new THREE.Vector3(0.0, -0.10, -0.18);
const HIP_FOV = 75;
const ADS_FOV = 50;

const targets = [];
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();

// =============================================
// --- 3. SISTEMA DE ÁUDIO (ARQUIVOS NA RAIZ) ---
// =============================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {};

async function loadSound(name, url) {
    try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        sounds[name] = await audioCtx.decodeAudioData(buf);
    } catch (e) { console.warn(`Erro som: ${name}`); }
}

// Removido o prefixo 'sounds/' conforme sua lista de arquivos
loadSound('ak1', 'ak1.mp3');
loadSound('reload', 'reload.mp3');
loadSound('walking', 'walking.mp3');

function playSound(name, volume = 1.0) {
    if (!sounds[name]) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const source = audioCtx.createBufferSource();
    const gainNode = audioCtx.createGain();
    source.buffer = sounds[name];
    gainNode.gain.value = volume;
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.start(0);
}

// =============================================
// --- 4. EFEITOS (ARQUIVOS NA RAIZ) ---
// =============================================
const muzzleLight = new THREE.PointLight(0xff6600, 0, 2);
// Removido 'effects/' - usando akfire.png direto
const flashTexture = new THREE.TextureLoader().load('akfire.png');
const flashMat = new THREE.MeshBasicMaterial({ map: flashTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), flashMat);
flashMesh.position.set(0, 0, -0.6);

function triggerMuzzleFlash() {
    muzzleLight.intensity = 6;
    flashMat.opacity = 1;
    flashMesh.rotation.z = Math.random() * Math.PI;
    setTimeout(() => { muzzleLight.intensity = 0; flashMat.opacity = 0; }, 50);
}

function spawnTracer() {
    const geo = new THREE.CylinderGeometry(0.003, 0.003, 0.5, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.8 });
    const tracer = new THREE.Mesh(geo, mat);
    const origin = new THREE.Vector3();
    flashMesh.getWorldPosition(origin);
    tracer.position.copy(origin);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(tracer);
    let dist = 0;
    function move() {
        if (dist > 50) { scene.remove(tracer); return; }
        tracer.position.addScaledVector(dir, 2.5);
        dist += 2.5;
        requestAnimationFrame(move);
    }
    move();
}

// =============================================
// --- 5. LÓGICA DE TIRO ---
// =============================================
function updateHUD() {
    const el = document.getElementById('ammo');
    if (el) el.innerText = `${ammo} | 90`;
}

function shoot() {
    if (ammo <= 0 || isReloading) return;
    ammo--;
    updateHUD();

    const recoilMult = isADS ? 0.5 : 1.0;
    recoilPitch -= (0.02 + Math.min(shotsFired * 0.002, 0.015)) * recoilMult;
    recoilYaw += (Math.random() - 0.5) * 0.01 * recoilMult;
    
    shotsFired++;
    triggerMuzzleFlash();
    spawnTracer();
    playSound('ak1', 0.8);

    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(targets, true);
    if (hits.length > 0) createDecal(hits[0]);
}

function createDecal(hit) {
    const mark = new THREE.Mesh(new THREE.CircleGeometry(0.04, 8), new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
    mark.position.copy(hit.point).addScaledVector(hit.face.normal, 0.01);
    mark.lookAt(hit.point.clone().add(hit.face.normal));
    scene.add(mark);
    setTimeout(() => scene.remove(mark), 5000);
}

// =============================================
// --- 6. CARREGAMENTO (ARQUIVOS NA RAIZ) ---
// =============================================
const loader = new GLTFLoader();

// Carrega de_dust2.glb da raiz
loader.load('de_dust2.glb', (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.traverse(c => { if (c.isMesh) targets.push(c); });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    camera.position.set(0, box.min.y + 2, 0);
    animate();
});

// Carrega animated_aks-74u.glb da raiz
let weapon, mixer, reloadAction;
loader.load('animated_aks-74u.glb', (gltf) => {
    weapon = gltf.scene;
    weapon.position.copy(HIP_POS);
    weapon.add(muzzleLight);
    weapon.add(flashMesh);
    camera.add(weapon);
    scene.add(camera);
    if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(weapon);
        reloadAction = mixer.clipAction(gltf.animations[0]);
        reloadAction.setLoop(THREE.LoopOnce);
        mixer.addEventListener('finished', () => { isReloading = false; ammo = 30; updateHUD(); });
    }
});

// =============================================
// --- 7. INPUTS ---
// =============================================
document.addEventListener('mousedown', (e) => {
    if (!isLocked) { document.body.requestPointerLock(); return; }
    if (e.button === 0) { isShooting = true; shoot(); var itv = setInterval(() => { if (isShooting) shoot(); else clearInterval(itv); }, 100); }
    if (e.button === 2) isADS = true;
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) { isShooting = false; shotsFired = 0; } if (e.button === 2) isADS = false; });
document.addEventListener('pointerlockchange', () => { isLocked = document.pointerLockElement === document.body; });
document.addEventListener('mousemove', (e) => {
    if (!isLocked) return;
    yaw -= e.movementX * 0.002;
    pitch -= e.movementY * 0.002;
    pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
});

const keys = {};
document.addEventListener('keydown', (e) => { 
    keys[e.code] = true; 
    if (e.code === 'KeyR' && !isReloading && ammo < 30) {
        isReloading = true; playSound('reload'); if (reloadAction) reloadAction.play();
    }
    if (e.code === 'Space' && isGrounded) { velocityY = JUMP_FORCE; isGrounded = false; }
    if (e.code === 'ControlLeft') isCrouching = true;
});
document.addEventListener('keyup', (e) => { 
    keys[e.code] = false; 
    if (e.code === 'ControlLeft') isCrouching = false;
});

// =============================================
// --- 8. LOOP ---
// =============================================
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    camera.rotation.set(pitch + recoilPitch, yaw + recoilYaw, 0, 'YXZ');

    if (isLocked) {
        const speed = isCrouching ? 0.03 : 0.07;
        const dir = new THREE.Vector3();
        if (keys['KeyW']) dir.z -= 1;
        if (keys['KeyS']) dir.z += 1;
        if (keys['KeyA']) dir.x -= 1;
        if (keys['KeyD']) dir.x += 1;
        dir.applyEuler(new THREE.Euler(0, yaw, 0)).normalize().multiplyScalar(speed);
        camera.position.add(dir);
    }

    const targetH = isCrouching ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT;
    currentHeight += (targetH - currentHeight) * 0.15;
    
    velocityY += GRAVITY;
    camera.position.y += velocityY;

    if (camera.position.y < currentHeight) {
        camera.position.y = currentHeight;
        velocityY = 0;
        isGrounded = true;
    }

    if (weapon) {
        weapon.position.lerp(isADS ? ADS_POS : HIP_POS, 0.2);
        camera.fov += ((isADS ? ADS_FOV : HIP_FOV) - camera.fov) * 0.15;
        camera.updateProjectionMatrix();
    }

    if (!isShooting) {
        recoilPitch *= 0.9;
        recoilYaw *= 0.9;
    }

    if (mixer) mixer.update(delta);
    renderer.render(scene, camera);
}
