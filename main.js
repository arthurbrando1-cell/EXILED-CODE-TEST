/* ---------------- 1. IMPORTS (OBRIGATÓRIO NO TOPO) ---------------- */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, onChildRemoved, update } from "firebase/database";

/* ---------------- 2. FIREBASE CONFIG ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyAIKPooiHzcB5d8_mRiDMyiam4AYel4lZs",
  authDomain: "cs-low-poly.firebaseapp.com",
  databaseURL: "https://cs-low-poly-default-rtdb.firebaseio.com",
  projectId: "cs-low-poly",
  storageBucket: "cs-low-poly.firebasestorage.app",
  messagingSenderId: "291417778108",
  appId: "1:291417778108:web:881869dd93735c6167edb9"
};

/* ---------------- 3. INICIALIZA FIREBASE ---------------- */
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* ---------------- 4. CONFIGURAÇÃO DA CENA ---------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.001, 1000);
camera.position.set(0, 1.6, 2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Luzes
scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(5, 10, 5);
scene.add(sun);
/* ---------------- 5. VARIÁVEIS DO JOGO ---------------- */
let ammo = 30;
let isReloading = false;
let isShooting = false;
let isADS = false;
let isGrounded = true;
let velocityY = 0;

// Variáveis de Câmera e Controle (O erro 'isLocked' some aqui)
let isLocked = false; 
let yaw = 0;
let pitch = 0;

// Variáveis de Mapa e Chão (O erro 'mapFloorY' some aqui)
let mapFloorY = 0; 

// Alturas e Movimento
const PLAYER_HEIGHT = 1.1; 
const PLAYER_HEIGHT_CROUCH = 0.65;
let currentHeight = PLAYER_HEIGHT;
let isCrouching = false;

// Recoil e Tiro
let shotsFired = 0;
let recoilPitch = 0;
let recoilYaw = 0;
let recoilRecovering = false;

// Variáveis de Teclas (W, A, S, D)
let moveF = false, moveB = false, moveL = false, moveR = false;

// FOV (Adicione se usar zoom na mira)
const HIP_FOV = 75;
const ADS_FOV = 45;

// Posições da Arma
const HIP_POS = new THREE.Vector3(0.10, -0.12, -0.20);
const ADS_POS = new THREE.Vector3(0.0, -0.09, -0.16);

// Alvos e Raycast
const raycaster = new THREE.Raycaster();
const targets = [];

/* ---------------- 6. MULTIPLAYER ---------------- */
let playerId = crypto.randomUUID();
let playerNick = "Player";
let players = {};
let playerMeshes = {};
let myHP = 100;
let multiplayerReady = false;

// ===============================================
// ================= ESP NICK =================

function createNickLabel(text) {

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#00ff00";
    ctx.font = "28px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, canvas.width / 2, 42);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2, 0.5, 1);

    return sprite;
}

// ================= MULTIPLAYER INIT =================

function initMultiplayer() {
    multiplayerReady = true;

    // Cria você no banco usando a nova sintaxe ref e set
    const myRef = ref(db, "players/" + playerId);
    set(myRef, {
        nick: playerNick,
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        hp: 100
    });

    // Remove ao sair
    window.addEventListener("beforeunload", () => {
        set(myRef, null); // Forma mais limpa de remover no v9
    });

    // Escuta todos players usando onValue
    const allPlayersRef = ref(db, "players");
    onValue(allPlayersRef, (snapshot) => {
        players = snapshot.val() || {};
        syncPlayers();
    });
}

// ================= SYNC PLAYERS =================
function syncPlayers() {
    for (let id in players) {
        if (id === playerId) continue;

        if (!playerMeshes[id]) {
            const geo = new THREE.BoxGeometry(0.6, 1.6, 0.6);
            const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
            const mesh = new THREE.Mesh(geo, mat);

            const nickLabel = createNickLabel(players[id].nick || "Player");
            nickLabel.position.set(0, 1.2, 0); 
            mesh.add(nickLabel);

            scene.add(mesh);
            playerMeshes[id] = mesh;
            targets.push(mesh); // IMPORTANTE: Adicionado para você conseguir dar dano neles
        }

        playerMeshes[id].position.set(
            players[id].x,
            players[id].y,
            players[id].z
        );
        // Sincroniza a rotação do inimigo também
        if(players[id].ry !== undefined) playerMeshes[id].rotation.y = players[id].ry;
    }

    for (let id in playerMeshes) {
        if (!players[id]) {
            scene.remove(playerMeshes[id]);
            delete playerMeshes[id];
        }
    }
}

// ================= CONFIGURAÇÕES TÉCNICAS =================
// Note que REMOVI o "const" e "let" das que já foram declaradas no topo

const RELOAD_TIME_MS = 2500;
const GRAVITY        = -0.015;
const JUMP_FORCE     = 0.22;

// Aqui apenas atualizamos os valores, sem usar "const" de novo
// PLAYER_HEIGHT = 1.1; // Se quiser mudar o valor do topo, use assim sem o const
// PLAYER_HEIGHT_CROUCH = 0.65; 

const MOVE_SPEED        = 0.075;
const MOVE_SPEED_CROUCH = 0.034;
const SENSITIVITY       = 0.0018;
const PITCH_LIMIT       = Math.PI / 2 - 0.02;

// --- SISTEMA DE SOM ---
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

function playSound(name, volume = 1.0, loop = false) {
    if (!sounds[name]) return null;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const source    = audioCtx.createBufferSource();
    const gainNode = audioCtx.createGain();
    source.buffer      = sounds[name];
    source.loop        = loop;
    gainNode.gain.value = volume;
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.start(0);
    return source;
}

loadSound('ak1',     'sounds/ak1.mp3');
loadSound('reload',  'sounds/reload.mp3');
loadSound('walking', 'sounds/walking.mp3');

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

// --- MAPA DUST2 ---
// mapLoader e mapFloorY já foram declarados no topo? Se sim, use sem "const/let"
const mapLoaderInstance = new GLTFLoader(); 

const loadingDiv = document.createElement('div');
loadingDiv.id = 'loading';
loadingDiv.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:#111; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:9999; font-family:monospace; font-size:20px;`;
loadingDiv.innerHTML = `<div style="margin-bottom:16px">🗺️ Carregando de_dust2...</div><div id="loadbar-wrap" style="width:300px;height:8px;background:#333;border-radius:4px;overflow:hidden"><div id="loadbar" style="width:0%;height:100%;background:#f90;transition:width 0.2s"></div></div><div id="loadpct" style="margin-top:10px;font-size:14px;color:#aaa">0%</div>`;
document.body.appendChild(loadingDiv);

mapLoaderInstance.load(
    'maps/de_dust2.glb',
    (gltf) => {
        const map = gltf.scene;
        scene.add(map);

        map.traverse((child) => {
            if (child.isMesh) {
                targets.push(child);
            }
        });

        const box = new THREE.Box3().setFromObject(map);
        const size   = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const spawnY = box.min.y + size.y * 0.05 + PLAYER_HEIGHT;
        camera.position.set(center.x, spawnY, center.z);
        
        mapFloorY = box.min.y + size.y * 0.05;

        initMultiplayer(); 
        loadingDiv.remove();
        animate(); // Só começa o loop após o mapa estar pronto
    },
    (progress) => {
        if (progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            const bar = document.getElementById('loadbar');
            if (bar) bar.style.width = pct + '%';
        }
    }
);

// Fallback Floor
const fallbackFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: 0x444444 })
);
fallbackFloor.rotation.x = -Math.PI / 2;
scene.add(fallbackFloor);
targets.push(fallbackFloor);

// --- POSIÇÕES DA ARMA ---
// Removidos const/let pois já estão no topo
HIP_FOV = 75;
ADS_FOV = 55;
HIP_POS.set(0.10, -0.12, -0.20);
ADS_POS.set(0.0, -0.09, -0.16);
// --- MUZZLE FLASH ---
// Removido 'const' para evitar erro de redeclaração
muzzleLight = new THREE.PointLight(0xff6600, 0, 1.5);
muzzleLight.position.set(0, 0.01, -0.55);

var flashTexture = new THREE.TextureLoader().load('effects/akfire.png');
var flashMat = new THREE.MeshBasicMaterial({
    map: flashTexture,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
var flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
flashMesh.position.set(0, 0.01, -0.62);

// --- MODELO DA ARMA ---
// Removi o 'const' para não dar erro se ele já existir em outro lugar do arquivo
if (typeof weaponLoader === 'undefined') {
    var weaponLoader = new GLTFLoader(); 
}

// animReloadDuration já deve estar como let global, então só atualizamos
animReloadDuration = (typeof RELOAD_TIME_MS !== 'undefined') ? RELOAD_TIME_MS : 2500;

weaponLoader.load('models/animated_aks-74u.glb', (gltf) => {
    weapon = gltf.scene; // Já é let global
    weapon.scale.set(1.0, 1.0, 1.0);
    weapon.position.copy(HIP_POS);

    // Adiciona os efeitos que criamos antes à arma
    if (typeof muzzleLight !== 'undefined') weapon.add(muzzleLight);
    if (typeof flashMesh !== 'undefined') weapon.add(flashMesh);

    camera.add(weapon);
    scene.add(camera);

    if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(weapon); // Já é let global
        reloadAction = mixer.clipAction(gltf.animations[0]); // Já é let global
        reloadAction.setLoop(THREE.LoopOnce);

        const animDuration = gltf.animations[0].duration;
        console.log(`🔫 Animação de reload detectada: ${animDuration.toFixed(2)}s`);

        if (animDuration >= 1.5 && animDuration <= 4.0) {
            animReloadDuration = animDuration * 1000;
        }

        mixer.addEventListener('finished', () => {
            isReloading = false;
            ammo = 30;
            updateHUD();
        });
    }
});

// --- HUD ---
function updateHUD() {
    const el = document.getElementById('ammo');
    if (el) el.innerText = `${ammo} | 90`;
}

// --- MUZZLE FLASH LOGIC ---
// Removido 'let' global se já existir
if (typeof flashTimeout === 'undefined') var flashTimeout = null;

function triggerMuzzleFlash() {
    if (flashTimeout) clearTimeout(flashTimeout);
    muzzleLight.intensity = 5;
    flashMat.opacity = 1.0;
    flashMesh.rotation.z = Math.random() * Math.PI * 2;
    const s = 0.85 + Math.random() * 0.4;
    flashMesh.scale.set(s, s, 1);
    flashTimeout = setTimeout(() => {
        muzzleLight.intensity = 0;
        flashMat.opacity = 0;
        flashTimeout = null;
    }, 50);
}

// --- TRACER (Rastro do tiro) ---
function spawnTracer() {
    const geoTracer = new THREE.CylinderGeometry(0.003, 0.003, 0.35, 4);
    const matTracer = new THREE.MeshBasicMaterial({
        color: 0xffee88, transparent: true, opacity: 0.75, depthWrite: false
    });
    const tracer = new THREE.Mesh(geoTracer, matTracer);

    const origin = new THREE.Vector3();
    flashMesh.getWorldPosition(origin);
    tracer.position.copy(origin);

    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(camera.quaternion).normalize();
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    scene.add(tracer);

    let dist = 0;
    const speed = 3.0, max = 60;
    function move() {
        if (dist >= max) { 
            scene.remove(tracer); 
            geoTracer.dispose(); 
            matTracer.dispose(); 
            return; 
        }
        tracer.position.addScaledVector(dir, speed);
        dist += speed;
        matTracer.opacity = Math.max(0, 0.75 * (1 - dist / max));
        requestAnimationFrame(move);
    }
    move();
}

// --- TIRO ---
function shoot() {
    if (ammo <= 0 || isReloading) {
        if (ammo <= 0) reload();
        return;
    }

    ammo--;
    updateHUD();
    recoilRecovering = false;

    const isMoving = (typeof moveF !== 'undefined' && (moveF || moveB || moveL || moveR));
    
    let spreadBase;
    if (isCrouching)      spreadBase = 0.004;
    else if (isMoving)    spreadBase = 0.028;
    else                  spreadBase = 0.012;

    const sprayFactor = Math.min(shotsFired * 0.0015, isCrouching ? 0.006 : 0.018);
    const spread = spreadBase + sprayFactor;

    const spreadX = (Math.random() - 0.5) * 2 * spread;
    const spreadY = (Math.random() - 0.5) * 2 * spread;

    const recoilMult = isADS ? 0.45 : 1.0;
    const vertRecoil = (0.018 + Math.min(shotsFired * 0.0008, 0.012)) * recoilMult;
    const horizRecoil = (Math.random() - 0.5) * 0.007 * recoilMult;

    recoilPitch -= vertRecoil;
    recoilYaw   += horizRecoil;
    pitch += recoilPitch * 0.3; 
    yaw   += recoilYaw   * 0.3;

    if (weapon) weapon.position.z += 0.025;

    shotsFired++;

    triggerMuzzleFlash();
    spawnTracer();
    playSound('ak1', 1.0);

    raycaster.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);
    const hits = raycaster.intersectObjects(targets, true);
    
    if (hits.length > 0) {
        createDecal(hits[0]);
    }
}

// --- DECAL ---
function createDecal(hit) {
    const mark = new THREE.Mesh(
        new THREE.CircleGeometry(0.05, 8),
        new THREE.MeshBasicMaterial({ 
            color: 0x111111, 
            side: THREE.DoubleSide, 
            depthWrite: false, 
            polygonOffset: true, 
            polygonOffsetFactor: -1 
        })
    );
    mark.position.copy(hit.point);
    if (hit.face) {
        const normal = hit.face.normal.clone();
        if (hit.object && hit.object.matrixWorld) {
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
            normal.applyMatrix3(normalMatrix).normalize();
        }
        mark.lookAt(hit.point.clone().add(normal));
        mark.position.addScaledVector(normal, 0.008);
    }
    scene.add(mark);
    setTimeout(() => {
        scene.remove(mark);
        mark.geometry.dispose();
        mark.material.dispose();
    }, 8000);
}
// --- POSIÇÕES DA ARMA ---
// Apenas atualizando valores (sem const/let)
HIP_FOV = 75;
ADS_FOV = 55;
HIP_POS.set(0.10, -0.12, -0.20);
ADS_POS.set(0.0, -0.09, -0.16);

// ========================================================
// 1. CONFIGURAÇÃO DE OBJETOS E MATERIAIS (EFEITOS VISUAIS)
// ========================================================

// Muzzle Flash (Brilho do cano)
muzzleLight = new THREE.PointLight(0xff6600, 0, 1.5);
muzzleLight.position.set(0, 0.01, -0.55);

flashTexture = new THREE.TextureLoader().load('effects/akfire.png');
flashMat = new THREE.MeshBasicMaterial({
    map: flashTexture,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
flashMesh.position.set(0, 0.01, -0.62);

// ========================================================
// 2. FUNÇÕES DE INTERFACE E EFEITOS (LÓGICA)
// ========================================================

// Atualização do HUD (Substituindo todas as versões anteriores)
window.updateHUD = function() {
    const el = document.getElementById('ammo');
    if (el) el.innerText = `${(typeof ammo !== 'undefined' ? ammo : 30)} | 90`;
};

// Lógica do Muzzle Flash
if (typeof flashTimeout === 'undefined') var flashTimeout = null;

window.triggerMuzzleFlash = function() {
    if (flashTimeout) clearTimeout(flashTimeout);
    muzzleLight.intensity = 5;
    flashMat.opacity = 1.0;
    flashMesh.rotation.z = Math.random() * Math.PI * 2;
    const s = 0.85 + Math.random() * 0.4;
    flashMesh.scale.set(s, s, 1);
    flashTimeout = setTimeout(() => {
        muzzleLight.intensity = 0;
        flashMat.opacity = 0;
        flashTimeout = null;
    }, 50);
};

// Rastro do tiro (Tracer)
window.spawnTracer = function() {
    const geoTracer = new THREE.CylinderGeometry(0.003, 0.003, 0.35, 4);
    const matTracer = new THREE.MeshBasicMaterial({
        color: 0xffee88, transparent: true, opacity: 0.75, depthWrite: false
    });
    const tracer = new THREE.Mesh(geoTracer, matTracer);
    const origin = new THREE.Vector3();
    flashMesh.getWorldPosition(origin);
    tracer.position.copy(origin);
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(camera.quaternion).normalize();
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(tracer);

    let dist = 0;
    const speed = 3.0, max = 60;
    function move() {
        if (dist >= max) { 
            scene.remove(tracer); geoTracer.dispose(); matTracer.dispose(); return; 
        }
        tracer.position.addScaledVector(dir, speed);
        dist += speed;
        matTracer.opacity = Math.max(0, 0.75 * (1 - dist / max));
        requestAnimationFrame(move);
    }
    move();
};

// Marca de impacto (Decal)
window.createDecal = function(hit) {
    const mark = new THREE.Mesh(
        new THREE.CircleGeometry(0.05, 8),
        new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
    );
    mark.position.copy(hit.point);
    if (hit.face) {
        const normal = hit.face.normal.clone();
        if (hit.object && hit.object.matrixWorld) {
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
            normal.applyMatrix3(normalMatrix).normalize();
        }
        mark.lookAt(hit.point.clone().add(normal));
        mark.position.addScaledVector(normal, 0.008);
    }
    scene.add(mark);
    setTimeout(() => { scene.remove(mark); mark.geometry.dispose(); mark.material.dispose(); }, 8000);
};

// ========================================================
// 3. CARREGAMENTO DO MODELO DA ARMA
// ========================================================

if (typeof weaponLoader === 'undefined') var weaponLoader = new GLTFLoader();
animReloadDuration = (typeof RELOAD_TIME_MS !== 'undefined') ? RELOAD_TIME_MS : 2500;

weaponLoader.load('models/animated_aks-74u.glb', (gltf) => {
    weapon = gltf.scene;
    weapon.scale.set(1.0, 1.0, 1.0);
    weapon.position.copy(HIP_POS);
    weapon.add(muzzleLight);
    weapon.add(flashMesh);
    camera.add(weapon);
    scene.add(camera);

    if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(weapon);
        reloadAction = mixer.clipAction(gltf.animations[0]);
        reloadAction.setLoop(THREE.LoopOnce);
        const animDuration = gltf.animations[0].duration;
        if (animDuration >= 1.5 && animDuration <= 4.0) animReloadDuration = animDuration * 1000;
        
        mixer.addEventListener('finished', () => {
            isReloading = false;
            ammo = 30;
            updateHUD();
        });
    }
});

// ========================================================
// 4. MECÂNICA DE TIRO E LOOP
// ========================================================

window.shoot = function() {
    if (ammo <= 0 || isReloading) { if (ammo <= 0) reload(); return; }
    ammo--;
    updateHUD();
    recoilRecovering = false;

    const isMoving = (typeof moveF !== 'undefined' && (moveF || moveB || moveL || moveR));
    let spreadBase = isCrouching ? 0.004 : (isMoving ? 0.028 : 0.012);
    const spread = spreadBase + Math.min(shotsFired * 0.0015, isCrouching ? 0.006 : 0.018);
    
    const spreadX = (Math.random() - 0.5) * 2 * spread;
    const spreadY = (Math.random() - 0.5) * 2 * spread;

    const recoilMult = (typeof isADS !== 'undefined' && isADS) ? 0.45 : 1.0;
    recoilPitch -= (0.018 + Math.min(shotsFired * 0.0008, 0.012)) * recoilMult;
    recoilYaw += (Math.random() - 0.5) * 0.007 * recoilMult;
    
    pitch += recoilPitch * 0.3; 
    yaw += recoilYaw * 0.3;

    if (weapon) weapon.position.z += 0.025;
    shotsFired++;

    triggerMuzzleFlash();
    spawnTracer();
    playSound('ak1', 1.0);

    raycaster.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);
    const hits = raycaster.intersectObjects(targets, true);
    if (hits.length > 0) createDecal(hits[0]);
};

window.updateLoopExtras = function(now, delta) {
    // Sincronização Multiplayer
    if (typeof multiplayerReady !== 'undefined' && multiplayerReady && isLocked) {
        if (now - lastSyncTime > 50) {
            update(ref(db, "players/" + playerId), {
                x: camera.position.x,
                y: camera.position.y - currentHeight,
                z: camera.position.z,
                ry: yaw,
                hp: (typeof myHP !== 'undefined' ? myHP : 100)
            });
            lastSyncTime = now;
        }
    }

    // Interpolação da Arma (ADS / Hipfire)
    if (weapon) {
        const targetPos = isADS ? ADS_POS : HIP_POS;
        weapon.position.lerp(targetPos, 0.18);
        const targetFOV = isADS ? ADS_FOV : HIP_FOV;
        camera.fov += (targetFOV - camera.fov) * 0.15;
        camera.updateProjectionMatrix();
    }

    // Recuperação de Recoil
    if (typeof isShooting !== 'undefined' && !isShooting && (typeof recoilRecovering !== 'undefined' && recoilRecovering)) {
        recoilPitch *= 0.82; 
        recoilYaw *= 0.82;
        pitch += recoilPitch * 0.25; 
        yaw += recoilYaw * 0.25;
        if (Math.abs(recoilPitch) < 0.0001) recoilRecovering = false;
    }

    if (mixer) mixer.update(delta);
};

// ========================================================
// 5. MENU DE NICK (INTERFACE)
// ========================================================

const nickMenu = document.createElement("div");
nickMenu.id = "nickMenu";
nickMenu.style.cssText = "position:fixed;inset:0;background:#000;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;font-family:monospace;z-index:99999;";
nickMenu.innerHTML = `
    <h1>CS LOW POLY</h1>
    <input id="nickInput" maxlength="15" placeholder="Digite seu nick" style="padding:10px;font-size:18px;outline:none;border:2px solid #555;background:#222;color:#fff;">
    <button id="nickBtn" style="margin-top:10px;padding:10px 20px;font-size:18px;cursor:pointer;background:#f90;border:none;font-weight:bold;">ENTRAR</button>
`;
document.body.appendChild(nickMenu);

document.getElementById("nickBtn").onclick = () => {
    const input = document.getElementById("nickInput").value.trim();
    playerNick = input.length > 0 ? input : "Recruta" + Math.floor(Math.random() * 999);
    nickMenu.remove();
    if (typeof initMultiplayer === 'function') initMultiplayer();
    if (typeof audioCtx !== 'undefined' && audioCtx.state === 'suspended') audioCtx.resume();
};