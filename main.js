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
const PLAYER_HEIGHT        = 1.1;    // em pé (CS-like)
const PLAYER_HEIGHT_CROUCH = 0.65;   // agachado
const MOVE_SPEED           = 0.075;  // ~250u/s como CS
const MOVE_SPEED_CROUCH    = 0.034;  // ~85u/s agachado
const SENSITIVITY          = 0.0018;
const PITCH_LIMIT          = Math.PI / 2 - 0.02; // ~89 graus pra cima/baixo

let isCrouching   = false;
let currentHeight = PLAYER_HEIGHT;

// --- RECOIL / SPREAD ---
let shotsFired    = 0;       // contador de tiros consecutivos (acumula recoil)
let recoilPitch   = 0;       // recuo vertical acumulado (câmera sobe)
let recoilYaw     = 0;       // recuo horizontal acumulado
let recoilRecovering = false;

const targets   = [];
const raycaster = new THREE.Raycaster();
let mapFloorY   = 0; // atualizado após carregar o mapa

// =============================================
// --- SISTEMA DE SOM ---
// =============================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {};

async function loadSound(name, url) {
    try {
        const res    = await fetch(url);
        const buf    = await res.arrayBuffer();
        sounds[name] = await audioCtx.decodeAudioData(buf);
        console.log(`✅ Som carregado: ${name} (${sounds[name].duration.toFixed(2)}s)`);
    } catch (e) {
        console.warn(`❌ Som não carregado: ${name}`, e);
    }
}

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

// =============================================

// --- MAPA DUST2 ---
const mapLoader = new GLTFLoader();

// Loading screen
const loadingDiv = document.createElement('div');
loadingDiv.id = 'loading';
loadingDiv.style.cssText = `
    position:fixed; top:0; left:0; width:100%; height:100%;
    background:#111; color:#fff; display:flex; flex-direction:column;
    align-items:center; justify-content:center; z-index:9999;
    font-family:monospace; font-size:20px;
`;
loadingDiv.innerHTML = `
    <div style="margin-bottom:16px">🗺️ Carregando de_dust2...</div>
    <div id="loadbar-wrap" style="width:300px;height:8px;background:#333;border-radius:4px;overflow:hidden">
        <div id="loadbar" style="width:0%;height:100%;background:#f90;transition:width 0.2s"></div>
    </div>
    <div id="loadpct" style="margin-top:10px;font-size:14px;color:#aaa">0%</div>
`;
document.body.appendChild(loadingDiv);

mapLoader.load(
    'maps/de_dust2.glb',
    (gltf) => {
        const map = gltf.scene;
        scene.add(map);

        // Coleta todas as meshes do mapa como alvos de raycast/colisão
        map.traverse((child) => {
            if (child.isMesh) {
                targets.push(child);
            }
        });

        console.log(`✅ Mapa carregado! Meshes: ${targets.length}`);

        // --- AUTO-DETECT: calcula bounding box do mapa inteiro ---
        const box = new THREE.Box3().setFromObject(map);
        const size   = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        console.log(`📐 Mapa size: x=${size.x.toFixed(1)} y=${size.y.toFixed(1)} z=${size.z.toFixed(1)}`);
        console.log(`📍 Mapa center: x=${center.x.toFixed(1)} y=${center.y.toFixed(1)} z=${center.z.toFixed(1)}`);
        console.log(`📍 Mapa min: x=${box.min.x.toFixed(1)} y=${box.min.y.toFixed(1)} z=${box.min.z.toFixed(1)}`);
        console.log(`📍 Mapa max: x=${box.max.x.toFixed(1)} y=${box.max.y.toFixed(1)} z=${box.max.z.toFixed(1)}`);

        // Spawna no centro do mapa, um pouco acima do chão
        const spawnY = box.min.y + size.y * 0.05 + PLAYER_HEIGHT;
        camera.position.set(center.x, spawnY, center.z);
        yaw = Math.PI;

        console.log(`🎮 Spawn: x=${camera.position.x.toFixed(1)} y=${camera.position.y.toFixed(1)} z=${camera.position.z.toFixed(1)}`);

        // Ajusta altura mínima do player baseada no chão do mapa
        mapFloorY = box.min.y + size.y * 0.05;

        // Remove loading screen
        loadingDiv.remove();

        // Inicia o loop
        animate();
    },
    (progress) => {
        if (progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            const bar = document.getElementById('loadbar');
            const txt = document.getElementById('loadpct');
            if (bar) bar.style.width = pct + '%';
            if (txt) txt.innerText = pct + '%';
        }
    },
    (error) => {
        console.error('❌ Erro ao carregar mapa:', error);
        loadingDiv.innerHTML = `<div style="color:#f44">❌ Erro ao carregar de_dust2.glb<br><small>${error.message}</small></div>`;
    }
);

// Fallback: chão básico pra não ficar no vazio se mapa demorar
const fallbackFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: 0x444444 })
);
fallbackFloor.rotation.x = -Math.PI / 2;
fallbackFloor.name = 'fallbackFloor';
scene.add(fallbackFloor);
targets.push(fallbackFloor);

// --- POSIÇÕES DA ARMA ---
const HIP_POS = new THREE.Vector3(0.10, -0.12, -0.20);
const ADS_POS = new THREE.Vector3(0.0,  -0.09, -0.16);
const HIP_FOV = 75;
const ADS_FOV = 55;

// --- MUZZLE FLASH ---
const muzzleLight = new THREE.PointLight(0xff6600, 0, 1.5);
muzzleLight.position.set(0, 0.01, -0.55);

const flashTexture = new THREE.TextureLoader().load('effects/akfire.png');
const flashMat = new THREE.MeshBasicMaterial({
    map: flashTexture,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
flashMesh.position.set(0, 0.01, -0.62);

// --- MODELO DA ARMA ---
const loader = new GLTFLoader();
let weapon, mixer, reloadAction;
let animReloadDuration = RELOAD_TIME_MS;

loader.load('models/animated_aks-74u.glb', (gltf) => {
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
        console.log(`🔫 Animação de reload: ${animDuration.toFixed(2)}s`);

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

// --- MUZZLE FLASH ---
let flashTimeout = null;
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

// --- TRACER ---
function spawnTracer() {
    const geo = new THREE.CylinderGeometry(0.003, 0.003, 0.35, 4);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xffee88, transparent: true, opacity: 0.75, depthWrite: false
    });
    const tracer = new THREE.Mesh(geo, mat);

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
        if (dist >= max) { scene.remove(tracer); geo.dispose(); mat.dispose(); return; }
        tracer.position.addScaledVector(dir, speed);
        dist += speed;
        mat.opacity = Math.max(0, 0.75 * (1 - dist / max));
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

    // --- SPREAD (precisão) ---
    // Agachado: muito preciso. Em pé: espalha mais.
    // Movendo: espalha bastante.
    const isMoving = moveF || moveB || moveL || moveR;
    let spreadBase;
    if (isCrouching)      spreadBase = 0.004;  // quase zero agachado
    else if (isMoving)    spreadBase = 0.028;  // correndo = ruim
    else                  spreadBase = 0.012;  // em pé parado = médio

    // Spray aumenta spread com tiros consecutivos (diminui cap agachado)
    const sprayFactor = Math.min(shotsFired * 0.0015, isCrouching ? 0.006 : 0.018);
    const spread = spreadBase + sprayFactor;

    // Offset aleatório de spread aplicado no raycaster
    const spreadX = (Math.random() - 0.5) * 2 * spread;
    const spreadY = (Math.random() - 0.5) * 2 * spread;

    // --- RECOIL DA CÂMERA (vai pra cima, não pra baixo) ---
    const recoilMult = isADS ? 0.45 : 1.0;
    // Recoil vertical: sobe a câmera (pitch negativo = olhar pra cima)
    const vertRecoil = (0.018 + Math.min(shotsFired * 0.0008, 0.012)) * recoilMult;
    // Recoil horizontal: alterna levemente esquerda/direita como AK real
    const horizRecoil = (Math.random() - 0.5) * 0.007 * recoilMult;

    recoilPitch -= vertRecoil;
    recoilYaw   += horizRecoil;
    pitch += recoilPitch * 0.3; // aplica parcialmente por frame
    yaw   += recoilYaw   * 0.3;

    // Recuo visual da arma
    if (weapon) weapon.position.z += 0.025;

    shotsFired++;

    triggerMuzzleFlash();
    spawnTracer();
    playSound('ak1', 1.0);

    // Raycast com spread aplicado
    raycaster.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);
    const hits = raycaster.intersectObjects(targets, true);
    if (hits.length > 0) createDecal(hits[0]);
}

// --- DECAL ---
function createDecal(hit) {
    const mark = new THREE.Mesh(
        new THREE.CircleGeometry(0.05, 8),
        new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
    );
    mark.position.copy(hit.point);
    if (hit.face) {
        // Orienta o decal na normal da superfície atingida
        const normal = hit.face.normal.clone();
        if (hit.object && hit.object.matrixWorld) {
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
            normal.applyMatrix3(normalMatrix).normalize();
        }
        mark.lookAt(hit.point.clone().add(normal));
        mark.position.addScaledVector(normal, 0.008);
    }
    scene.add(mark);
    setTimeout(() => scene.remove(mark), 8000);
}

// --- RELOAD ---
function reload() {
    if (isReloading || ammo === 30) return;
    isReloading = true;
    playSound('reload', 1.0);

    if (reloadAction) {
        reloadAction.stop();
        const soundDuration = sounds['reload'] ? sounds['reload'].duration * 1000 : RELOAD_TIME_MS;
        reloadAction.timeScale = (reloadAction.getClip().duration * 1000) / soundDuration;
        reloadAction.play();
    } else {
        const duration = sounds['reload'] ? sounds['reload'].duration * 1000 : RELOAD_TIME_MS;
        setTimeout(() => { isReloading = false; ammo = 30; updateHUD(); }, duration);
    }
}

// --- CÂMERA MANUAL ---
let isLocked = false;
let yaw   = 0;
let pitch = 0;

document.addEventListener('click', () => {
    if (!isLocked) { audioCtx.resume(); document.body.requestPointerLock(); }
});

document.addEventListener('pointerlockchange', () => {
    isLocked = document.pointerLockElement === document.body;
    if (!isLocked) stopWalking();
});

document.addEventListener('mousemove', (e) => {
    if (!isLocked) return;
    yaw   -= e.movementX * SENSITIVITY;
    pitch -= e.movementY * SENSITIVITY;
    pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
});

// --- MOUSE BUTTONS ---
let shootInterval;

document.addEventListener('mousedown', (e) => {
    if (!isLocked) return;
    if (e.button === 0) {
        isShooting = true;
        shoot();
        clearInterval(shootInterval);
        shootInterval = setInterval(() => { if (isShooting) shoot(); }, 100);
    }
    if (e.button === 2) isADS = true;
});

document.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
        isShooting = false;
        clearInterval(shootInterval);
        // Inicia recuperação de recoil
        recoilRecovering = true;
    }
    if (e.button === 2) isADS = false;
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

// --- TECLAS ---
let moveF = false, moveB = false, moveL = false, moveR = false;

document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') moveF = true;
    if (e.code === 'KeyS') moveB = true;
    if (e.code === 'KeyA') moveL = true;
    if (e.code === 'KeyD') moveR = true;
    if (e.code === 'KeyR') reload();
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        isCrouching = true;
    }
    if (e.code === 'Space') {
        e.preventDefault();
        if (isGrounded) { velocityY = JUMP_FORCE; isGrounded = false; }
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') moveF = false;
    if (e.code === 'KeyS') moveB = false;
    if (e.code === 'KeyA') moveL = false;
    if (e.code === 'KeyD') moveR = false;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        isCrouching = false;
    }
});

// --- RESIZE ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- LOOP ---
const clock   = new THREE.Clock();
const forward = new THREE.Vector3();
const right   = new THREE.Vector3();
const moveDir = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = 0;

    const moving = isLocked && (moveF || moveB || moveL || moveR) && isGrounded;

    // Lerp altura agachado (suave como CS)
    const targetHeight = isCrouching ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT;
    currentHeight += (targetHeight - currentHeight) * 0.18;

    if (isLocked) {
        const speed = isCrouching ? MOVE_SPEED_CROUCH : MOVE_SPEED;
        forward.set(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0)).normalize();
        right.set(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0)).normalize();
        moveDir.set(0, 0, 0);
        if (moveF) moveDir.addScaledVector(forward, speed);
        if (moveB) moveDir.addScaledVector(forward, -speed);
        if (moveL) moveDir.addScaledVector(right, -speed);
        if (moveR) moveDir.addScaledVector(right, speed);
        camera.position.add(moveDir);
    }

    if (moving) startWalking(); else stopWalking();

    // --- COLISÃO HORIZONTAL (paredes) ---
    // Faz isso ANTES da gravidade pra não empurrar pra dentro do chão
    const mapMeshes = targets.filter(t => t.name !== 'fallbackFloor');
    if (isLocked && moveDir.lengthSq() > 0 && mapMeshes.length > 0) {
        // Origem no centro do corpo do player (um pouco abaixo dos olhos)
        const wallOrigin = camera.position.clone().add(new THREE.Vector3(0, -currentHeight * 0.3, 0));
        const wallDirs = [
            new THREE.Vector3( 1, 0,  0),
            new THREE.Vector3(-1, 0,  0),
            new THREE.Vector3( 0, 0,  1),
            new THREE.Vector3( 0, 0, -1),
        ];
        for (const dir of wallDirs) {
            const wRay = new THREE.Raycaster(wallOrigin, dir, 0, 0.45);
            const wHits = wRay.intersectObjects(mapMeshes, true);
            if (wHits.length > 0) {
                const push = dir.clone().multiplyScalar(wHits[0].distance - 0.45);
                camera.position.add(push);
            }
        }
    }

    // --- GRAVIDADE + COLISÃO COM CHÃO (raycast para baixo) ---
    velocityY += GRAVITY;
    camera.position.y += velocityY;

    if (mapMeshes.length > 0) {
        // Raycast de cima pra baixo partindo dos pés do player
        const feetOrigin = camera.position.clone();
        const groundRay = new THREE.Raycaster(feetOrigin, new THREE.Vector3(0, -1, 0), 0, currentHeight + Math.abs(velocityY) + 0.1);
        const gHits = groundRay.intersectObjects(mapMeshes, true);

        if (gHits.length > 0) {
            const groundY = gHits[0].point.y + currentHeight;
            if (camera.position.y <= groundY) {
                camera.position.y = groundY;
                velocityY  = 0;
                isGrounded = true;
            }
        } else {
            isGrounded = false;
        }
    }

    // Fallback: impede cair infinitamente abaixo do mapa
    if (camera.position.y < mapFloorY - 20) {
        camera.position.set(camera.position.x, mapFloorY + currentHeight + 2, camera.position.z);
        velocityY = 0;
        isGrounded = true;
    }

    // Arma lerp hip <-> ADS
    if (weapon) {
        const targetPos = isADS ? ADS_POS : HIP_POS;
        weapon.position.lerp(targetPos, 0.18);
        const baseZ = isADS ? ADS_POS.z : HIP_POS.z;
        weapon.position.z += (baseZ - weapon.position.z) * 0.2;
        camera.fov += ((isADS ? ADS_FOV : HIP_FOV) - camera.fov) * 0.15;
        camera.updateProjectionMatrix();
    }

    // --- RECUPERAÇÃO DE RECOIL (suave, como CS) ---
    if (!isShooting) {
        // Zera contador de tiros ao soltar
        if (shotsFired > 0) { recoilRecovering = true; }
        shotsFired = 0;

        if (recoilRecovering) {
            // Recoil se dissipa gradualmente
            recoilPitch *= 0.82;
            recoilYaw   *= 0.82;
            // Empurra a câmera de volta à posição natural
            pitch += recoilPitch * 0.25;
            yaw   += recoilYaw   * 0.25;
            if (Math.abs(recoilPitch) < 0.0001 && Math.abs(recoilYaw) < 0.0001) {
                recoilPitch      = 0;
                recoilYaw        = 0;
                recoilRecovering = false;
            }
        }
    }

    if (mixer) mixer.update(delta);
    renderer.render(scene, camera);
}

// O animate() é chamado dentro do callback do mapa
// mas se o mapa demorar muito, inicia de qualquer forma após 100ms
setTimeout(() => {
    if (!document.getElementById('loading')) return; // já foi removido, mapa carregou
    // Mapa ainda carregando, mas inicia o render pra não travar
    animate();
}, 1
