import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONFIGURAÇÃO DA CENA ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.001, 1000);
camera.position.set(0, 1.6, 2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(5, 10, 5);
scene.add(sun);

// --- VARIÁVEIS DO JOGO ---
let ammo = 30;
let isReloading = false;
let isShooting = false;
let isADS = false;
let isGrounded = true;
let velocityY = 0;

const RELOAD_TIME_MS = 2500;
const GRAVITY              = -0.015;
const JUMP_FORCE           = 0.22;
const PLAYER_HEIGHT        = 1.1;
const PLAYER_HEIGHT_CROUCH = 0.65;
const MOVE_SPEED           = 0.075;
const MOVE_SPEED_CROUCH    = 0.034;
const SENSITIVITY          = 0.0018;
const PITCH_LIMIT          = Math.PI / 2 - 0.02;

let isCrouching   = false;
let currentHeight = PLAYER_HEIGHT;
let shotsFired    = 0;
let recoilPitch   = 0;
let recoilYaw     = 0;
let recoilRecovering = false;

const targets   = [];
const raycaster = new THREE.Raycaster();
let mapFloorY   = 0;

// =============================================
// --- SISTEMA DE SOM (AJUSTADO PARA RAIZ) ---
// =============================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {};

async function loadSound(name, url) {
    try {
        const res    = await fetch(url);
        const buf    = await res.arrayBuffer();
        sounds[name] = await audioCtx.decodeAudioData(buf);
        console.log(`✅ Som carregado: ${name}`);
    } catch (e) {
        console.warn(`❌ Som não carregado: ${name}`, e);
    }
}

// Removido o 'sounds/' dos caminhos
loadSound('ak1',     'ak1.mp3');
loadSound('reload',  'reload.mp3');
loadSound('walking', 'walking.mp3');

function playSound(name, volume = 1.0, loop = false) {
    if (!sounds[name]) return null;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const source   = audioCtx.createBufferSource();
    const gainNode = audioCtx.createGain();
    source.buffer      = sounds[name];
    source.loop        = loop;
    gainNode.gain.value = volume;
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.start(0);
    return source;
}

let walkingSource = null;
let isWalking     = false;

function startWalking() {
    if (isWalking || !sounds['walking']) return;
    isWalking     = true;
    walkingSource = playSound('walking', 0.6, true);
}

function stopWalking() {
    if (!isWalking) return;
    isWalking = false;
    if (walkingSource) { try { walkingSource.stop(); } catch(e) {} walkingSource = null; }
}

// =============================================
// --- MAPA DUST2 (AJUSTADO PARA RAIZ) ---
// =============================================
const mapLoader = new GLTFLoader();

const loadingDiv = document.createElement('div');
loadingDiv.id = 'loading';
loadingDiv.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:#111; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:9999; font-family:monospace; font-size:20px;`;
loadingDiv.innerHTML = `<div style="margin-bottom:16px">🗺️ Carregando de_dust2...</div><div id="loadbar-wrap" style="width:300px;height:8px;background:#333;border-radius:4px;overflow:hidden"><div id="loadbar" style="width:0%;height:100%;background:#f90;transition:width 0.2s"></div></div><div id="loadpct" style="margin-top:10px;font-size:14px;color:#aaa">0%</div>`;
document.body.appendChild(loadingDiv);

// Removido o 'maps/' do caminho
mapLoader.load(
    'de_dust2.glb', 
    (gltf) => {
        const map = gltf.scene;
        scene.add(map);
        map.traverse((child) => { if (child.isMesh) targets.push(child); });

        const box = new THREE.Box3().setFromObject(map);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const spawnY = box.min.y + size.y * 0.05 + PLAYER_HEIGHT;
        camera.position.set(center.x, spawnY, center.z);
        yaw = Math.PI;
        mapFloorY = box.min.y + size.y * 0.05;

        loadingDiv.remove();
        animate();
    },
    (progress) => {
        if (progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            document.getElementById('loadbar').style.width = pct + '%';
            document.getElementById('loadpct').innerText = pct + '%';
        }
    },
    (error) => {
        console.error('❌ Erro no mapa:', error);
        loadingDiv.innerHTML = `<div style="color:#f44">❌ Erro ao carregar de_dust2.glb na raiz</div>`;
    }
);

// --- POSIÇÕES DA ARMA ---
const HIP_POS = new THREE.Vector3(0.10, -0.12, -0.20);
const ADS_POS = new THREE.Vector3(0.0,  -0.09, -0.16);
const HIP_FOV = 75;
const ADS_FOV = 55;

const muzzleLight = new THREE.PointLight(0xff6600, 0, 1.5);
muzzleLight.position.set(0, 0.01, -0.55);

// Removido o 'effects/' do caminho
const flashTexture = new THREE.TextureLoader().load('akfire.png');
const flashMat = new THREE.MeshBasicMaterial({ map: flashTexture, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
flashMesh.position.set(0, 0.01, -0.62);

// --- MODELO DA ARMA (AJUSTADO PARA RAIZ) ---
let weapon, mixer, reloadAction;
// Removido o 'models/' do caminho
mapLoader.load('animated_aks-74u.glb', (gltf) => {
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

// --- FUNÇÕES DE JOGO (MANTIDAS) ---
function updateHUD() {
    const el = document.getElementById('ammo');
    if (el) el.innerText = `${ammo} | 90`;
}

function triggerMuzzleFlash() {
    muzzleLight.intensity = 5;
    flashMat.opacity = 1.0;
    flashMesh.rotation.z = Math.random() * Math.PI * 2;
    setTimeout(() => { muzzleLight.intensity = 0; flashMat.opacity = 0; }, 50);
}

function spawnTracer() {
    const geo = new THREE.CylinderGeometry(0.003, 0.003, 0.35, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.75, depthWrite: false });
    const tracer = new THREE.Mesh(geo, mat);
    const origin = new THREE.Vector3();
    flashMesh.getWorldPosition(origin);
    tracer.position.copy(origin);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(tracer);
    let dist = 0;
    function move() {
        if (dist >= 60) { scene.remove(tracer); return; }
        tracer.position.addScaledVector(dir, 3.0);
        dist += 3.0;
        requestAnimationFrame(move);
    }
    move();
}

function shoot() {
    if (ammo <= 0 || isReloading) { if (ammo <= 0) reload(); return; }
    ammo--;
    updateHUD();
    recoilRecovering = false;
    const recoilMult = isADS ? 0.45 : 1.0;
    recoilPitch -= (0.018 + Math.min(shotsFired * 0.0008, 0.012)) * recoilMult;
    pitch += recoilPitch * 0.3;
    if (weapon) weapon.position.z += 0.025;
    shotsFired++;
    triggerMuzzleFlash();
    spawnTracer();
    playSound('ak1', 1.0);
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(targets, true);
    if (hits.length > 0) createDecal(hits[0]);
}

function createDecal(hit) {
    const mark = new THREE.Mesh(new THREE.CircleGeometry(0.05, 8), new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    mark.position.copy(hit.point);
    const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    mark.lookAt(hit.point.clone().add(normal));
    mark.position.addScaledVector(normal, 0.008);
    scene.add(mark);
    setTimeout(() => scene.remove(mark), 8000);
}

function reload() {
    if (isReloading || ammo === 30) return;
    isReloading = true;
    playSound('reload', 1.0);
    if (reloadAction) { reloadAction.stop(); reloadAction.play(); }
    else { setTimeout(() => { isReloading = false; ammo = 30; updateHUD(); }, RELOAD_TIME_MS); }
}

// --- INPUTS ---
let isLocked = false;
let yaw = 0, pitch = 0;
document.addEventListener('click', () => { if (!isLocked) { audioCtx.resume(); document.body.requestPointerLock(); } });
document.addEventListener('pointerlockchange', () => { isLocked = document.pointerLockElement === document.body; if (!isLocked) stopWalking(); });
document.addEventListener('mousemove', (e) => { if (!isLocked) return; yaw -= e.movementX * SENSITIVITY; pitch -= e.movementY * SENSITIVITY; pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)); });

let moveF = false, moveB = false, moveL = false, moveR = false;
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') moveF = true; if (e.code === 'KeyS') moveB = true; if (e.code === 'KeyA') moveL = true; if (e.code === 'KeyD') moveR = true;
    if (e.code === 'KeyR') reload(); if (e.code === 'ControlLeft') isCrouching = true;
    if (e.code === 'Space' && isGrounded) { velocityY = JUMP_FORCE; isGrounded = false; }
});
document.addEventListener('keyup', (e) => { if (e.code === 'KeyW') moveF = false; if (e.code === 'KeyS') moveB = false; if (e.code === 'KeyA') moveL = false; if (e.code === 'KeyD') moveR = false; if (e.code === 'ControlLeft') isCrouching = false; });

document.addEventListener('mousedown', (e) => { if (!isLocked) return; if (e.button === 0) { isShooting = true; shoot(); window.shootInterval = setInterval(() => { if (isShooting) shoot(); }, 100); } if (e.button === 2) isADS = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 0) { isShooting = false; clearInterval(window.shootInterval); recoilRecovering = true; } if (e.button === 2) isADS = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

// --- LOOP ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    camera.rotation.order = 'YXZ'; camera.rotation.y = yaw; camera.rotation.x = pitch;

    const moving = isLocked && (moveF || moveB || moveL || moveR) && isGrounded;
    const targetHeight = isCrouching ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT;
    currentHeight += (targetHeight - currentHeight) * 0.18;

    if (isLocked) {
        const speed = isCrouching ? MOVE_SPEED_CROUCH : MOVE_SPEED;
        const forward = new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(0, yaw, 0));
        const right = new THREE.Vector3(1,0,0).applyEuler(new THREE.Euler(0, yaw, 0));
        if (moveF) camera.position.addScaledVector(forward, speed);
        if (moveB) camera.position.addScaledVector(forward, -speed);
        if (moveL) camera.position.addScaledVector(right, -speed);
        if (moveR) camera.position.addScaledVector(right, speed);
    }

    if (moving) startWalking(); else stopWalking();

    velocityY += GRAVITY; camera.position.y += velocityY;
    if (camera.position.y < mapFloorY + currentHeight) { camera.position.y = mapFloorY + currentHeight; velocityY = 0; isGrounded = true; }

    if (weapon) {
        weapon.position.lerp(isADS ? ADS_POS : HIP_POS, 0.18);
        camera.fov += ((isADS ? ADS_FOV : HIP_FOV) - camera.fov) * 0.15;
        camera.updateProjectionMatrix();
    }

    if (!isShooting && recoilRecovering) {
        recoilPitch *= 0.82; recoilYaw *= 0.82;
        pitch += recoilPitch * 0.25; yaw += recoilYaw * 0.25;
        if (Math.abs(recoilPitch) < 0.001) { recoilPitch = 0; recoilRecovering = false; shotsFired = 0; }
    }

    if (mixer) mixer.update(delta);
    renderer.render(scene, camera);
}
