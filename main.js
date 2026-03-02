import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONFIGURAÇÃO DA CENA ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
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
let yaw = Math.PI;
let pitch = 0;
let isLocked = false;

const GRAVITY = -0.015;
const JUMP_FORCE = 0.22;
const PLAYER_HEIGHT = 1.1;
const PLAYER_HEIGHT_CROUCH = 0.65;
let currentHeight = PLAYER_HEIGHT;
let isCrouching = false;

const HIP_POS = new THREE.Vector3(0.10, -0.12, -0.20);
const ADS_POS = new THREE.Vector3(0.0, -0.09, -0.16);
const HIP_FOV = 75;
const ADS_FOV = 55;

const targets = [];
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();
let mapFloorY = 0;

// =============================================
// --- SISTEMA DE ÁUDIO (RAIZ) ---
// =============================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {};

async function loadSound(name, url) {
    try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        sounds[name] = await audioCtx.decodeAudioData(buf);
        console.log(`✅ Áudio: ${name}`);
    } catch (e) { console.warn(`❌ Erro áudio: ${name}`); }
}

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
// --- CARREGAMENTO DO MAPA (RAIZ) ---
// =============================================
const loader = new GLTFLoader();

const loadingDiv = document.createElement('div');
loadingDiv.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:#111; color:#fff; display:flex; align-items:center; justify-content:center; z-index:9999; font-family:sans-serif;`;
loadingDiv.innerHTML = `<h1>CARREGANDO MAPA...</h1>`;
document.body.appendChild(loadingDiv);

loader.load('de_dust2.glb', (gltf) => {
    console.log("✅ Mapa de_dust2.glb carregado!");
    const map = gltf.scene;
    scene.add(map);
    
    map.traverse(c => { 
        if (c.isMesh) {
            targets.push(c);
            c.material.side = THREE.DoubleSide; 
        }
    });

    const box = new THREE.Box3().setFromObject(map);
    mapFloorY = box.min.y;
    camera.position.set(0, mapFloorY + PLAYER_HEIGHT + 2, 0); // Spawn seguro
    
    loadingDiv.remove();
    animate();
}, 
(xhr) => console.log((xhr.loaded / xhr.total * 100) + '% carregado'),
(err) => {
    console.error("❌ Erro ao achar de_dust2.glb na raiz!", err);
    loadingDiv.innerHTML = `<h1 style="color:red">ERRO: de_dust2.glb não encontrado</h1>`;
});

// =============================================
// --- ARMA E EFEITOS (RAIZ) ---
// =============================================
let weapon, mixer, reloadAction;
const flashTexture = new THREE.TextureLoader().load('akfire.png');
const flashMat = new THREE.MeshBasicMaterial({ map: flashTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
flashMesh.position.set(0, 0, -0.6);

loader.load('animated_aks-74u.glb', (gltf) => {
    weapon = gltf.scene;
    weapon.position.copy(HIP_POS);
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

function updateHUD() {
    const el = document.getElementById('ammo');
    if (el) el.innerText = `${ammo} | 90`;
}

function shoot() {
    if (ammo <= 0 || isReloading) return;
    ammo--;
    updateHUD();
    flashMat.opacity = 1;
    setTimeout(() => { flashMat.opacity = 0; }, 50);
    playSound('ak1', 0.8);
    
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(targets, true);
    if (hits.length > 0) {
        const mark = new THREE.Mesh(new THREE.CircleGeometry(0.05, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }));
        mark.position.copy(hits[0].point).addScaledVector(hits[0].face.normal, 0.01);
        mark.lookAt(hits[0].point.clone().add(hits[0].face.normal));
        scene.add(mark);
    }
}

// =============================================
// --- CONTROLES E INPUTS ---
// =============================================
document.addEventListener('mousedown', (e) => {
    if (!isLocked) {
        document.body.requestPointerLock().catch(() => {}); 
        return;
    }
    if (e.button === 0) { isShooting = true; shoot(); window.shootItv = setInterval(() => { if (isShooting) shoot(); }, 100); }
    if (e.button === 2) isADS = true;
});

document.addEventListener('mouseup', (e) => {
    if (e.button === 0) { isShooting = false; clearInterval(window.shootItv); }
    if (e.button === 2) isADS = false;
});

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
    if (e.code === 'KeyR' && !isReloading && ammo < 30) { isReloading = true; playSound('reload'); if (reloadAction) reloadAction.play(); }
    if (e.code === 'Space' && isGrounded) { velocityY = JUMP_FORCE; isGrounded = false; }
    if (e.code === 'ControlLeft') isCrouching = true;
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'ControlLeft') isCrouching = false; });

// =============================================
// --- LOOP DE ANIMAÇÃO ---
// =============================================
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    camera.rotation.set(pitch, yaw, 0, 'YXZ');

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

    if (camera.position.y < mapFloorY + currentHeight) {
        camera.position.y = mapFloorY + currentHeight;
        velocityY = 0;
        isGrounded = true;
    }

    if (weapon) {
        weapon.position.lerp(isADS ? ADS_POS : HIP_POS, 0.2);
        camera.fov += ((isADS ? ADS_FOV : HIP_FOV) - camera.fov) * 0.15;
        camera.updateProjectionMatrix();
    }

    if (mixer) mixer.update(delta);
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
