import * as THREE from 'three';
import { createCamera } from './camera.js';
import { createCharacterObject } from './objects/characterObject.js';
import { PlayerController } from './playerController.js';
import { createRenderer } from './renderer.js';
import { createScene } from './scene.js';
import { resizeRendererToContainer } from './resize.js';
import { BiologySystem } from './systems/biologySystem.js';
import { CombatController } from './systems/CombatController.js';
import { CraftingCodexSystem } from './systems/craftingCodexSystem.js';
import { EcologySystem } from './systems/ecologySystem.js';
import { EcosystemHoverSystem } from './systems/ecosystemHoverSystem.js';
import { EventBus } from './systems/eventBus.js';
import { ExplosionEffectSystem } from './systems/explosionEffectSystem.js';
import { InteractionSystem } from './systems/interactionSystem.js';
import { AiBuildingSystem } from './systems/aiBuildingSystem.js';
import { InventorySystem } from './systems/inventorySystem.js';
import { LightSystem } from './systems/lightSystem.js';
import { MoonSystem } from './systems/moonSystem.js';
import { NpcSystem } from './systems/npcSystem.js';
import { PlantGrowthSystem } from './systems/plantGrowthSystem.js';
import { ProfileSystem } from './systems/profileSystem.js';
import { RoseGrowthSystem } from './systems/roseGrowthSystem.js';
import { SaveSystem } from './systems/saveSystem.js';
import { SkySystem } from './systems/skySystem.js';
import { SoundSystem } from './systems/soundSystem.js';
import { SnowLotusGrowthSystem } from './systems/snowLotusGrowthSystem.js';
import { SunSystem } from './systems/sunSystem.js';
import { TimeSystem } from './systems/timeSystem.js';
import { TradeSystem } from './systems/tradeSystem.js';
import { TulipGrowthSystem } from './systems/tulipGrowthSystem.js';
import { VillageSystem } from './systems/villageSystem.js';
import { WeatherSystem } from './systems/weatherSystem.js';
import { WorldStatusHud } from './systems/worldStatusHud.js';
import { WorldItemSystem } from './systems/worldItemSystem.js';
import { WorldManager } from './worldManager.js';

const PLAYER_SPAWN_POSITION = new THREE.Vector3(4.9, 5, -4.8);
const PLAYER_GROUND_CLEARANCE = 0.56;
const PLAYER_KICK_FORCE = 360;
const PLAYER_KICK_LIFT = 80;
const PLAYER_KICK_KNOCKDOWN_FORCE = 260;

export function createMiniWorld(container, { initialSave = null, session = null } = {}) {
  const eventBus = new EventBus();
  const scene = createScene();
  const camera = createCamera(container);
  const renderer = createRenderer();
  const clock = new THREE.Clock();
  const character = createCharacterObject();
  const currentUser = session?.user ?? null;

  container.append(renderer.domElement);

  const worldManager = new WorldManager({
    scene,
    viewDistance: 1,
    maxLoadsPerFrame: 2,
    currentUserId: currentUser?.userId ?? null,
    currentPlayerId: import.meta.env.VITE_PLAYER_ID ?? 'local-player',
  });
  const controller = new PlayerController({
    camera,
    canvas: renderer.domElement,
    character,
    eventBus,
  });
  const timeSystem = new TimeSystem({
    eventBus,
    latitude: 35,
    startDayOfYear: 172,
    startSeconds: 52,
  });
  const skySystem = new SkySystem({ scene, eventBus });
  const lightSystem = new LightSystem({ scene, eventBus, player: controller });
  const sunSystem = new SunSystem({ scene, eventBus, camera });
  const moonSystem = new MoonSystem({ scene, eventBus, camera });
  const biologySystem = new BiologySystem({ eventBus, latitude: 35 });
  const weatherSystem = new WeatherSystem({ scene, eventBus, player: controller });
  const plantGrowthSystem = new PlantGrowthSystem({ scene, eventBus, worldManager });
  const roseGrowthSystem = new RoseGrowthSystem({ scene, eventBus, worldManager });
  const tulipGrowthSystem = new TulipGrowthSystem({ scene, eventBus, worldManager });
  const snowLotusGrowthSystem = new SnowLotusGrowthSystem({ scene, eventBus, worldManager, player: controller });
  const ecologySystem = new EcologySystem({ scene, eventBus, worldManager, player: controller });
  const ecosystemHoverSystem = new EcosystemHoverSystem({
    scene,
    camera,
    canvas: renderer.domElement,
    eventBus,
    worldManager,
  });
  const soundSystem = new SoundSystem({ eventBus, ambientVolume: 0.2 });
  const profileSystem = new ProfileSystem({ container, eventBus, session });
  const combatController = new CombatController({
    horizontalForce: PLAYER_KICK_FORCE,
    verticalLift: PLAYER_KICK_LIFT,
    knockdownForceThreshold: PLAYER_KICK_KNOCKDOWN_FORCE,
    cooldownSeconds: 0.45,
  });
  scene.add(character);
  timeSystem.update(0);
  controller.position.copy(PLAYER_SPAWN_POSITION);
  worldManager.loadAround(controller.position);
  controller.position.y =
    (worldManager.getSurfaceHeightAt(controller.position.x, controller.position.z) ?? PLAYER_SPAWN_POSITION.y) +
    PLAYER_GROUND_CLEARANCE;
  controller.body.velocity.y = 0;
  controller.body.grounded = true;
  controller.update(0, worldManager);

  const villageSystem = new VillageSystem({
    scene,
    camera,
    container,
    worldManager,
    player: controller,
  });
  controller.position.y =
    (worldManager.getSurfaceHeightAt(controller.position.x, controller.position.z) ?? controller.position.y) +
    PLAYER_GROUND_CLEARANCE;
  controller.body.velocity.y = 0;
  controller.body.grounded = true;
  controller.update(0, worldManager);

  const npcSystem = new NpcSystem({
    scene,
    camera,
    container,
    eventBus,
    worldManager,
    player: controller,
    villageSystem,
  });
  const worldStatusHud = new WorldStatusHud({
    container,
    eventBus,
    playerName: character.userData.playerName,
  });
  const worldItemSystem = new WorldItemSystem({
    scene,
    worldManager,
    player: controller,
  });
  const inventorySystem = new InventorySystem({
    container,
    eventBus,
    player: controller,
    worldItemSystem,
  });
  const interactionSystem = new InteractionSystem({
    container,
    scene,
    camera,
    eventBus,
    worldManager,
    player: controller,
    inventorySystem,
    worldItemSystem,
  });
  const aiBuildingSystem = new AiBuildingSystem({
    container,
    worldManager,
    player: controller,
    eventBus,
    apiBase: import.meta.env.VITE_AI_API_BASE ?? '',
    session,
  });
  const craftingCodexSystem = new CraftingCodexSystem({
    container,
    eventBus,
    worldItemSystem,
    interactionSystem,
  });

  if (initialSave?.player) {
    controller.restore(initialSave.player);
    worldManager.loadAround(controller.position);
    controller.update(0, worldManager, npcSystem);
  }

  if (initialSave?.inventory) {
    inventorySystem.restore(initialSave.inventory);
  }

  if (initialSave?.codex) {
    craftingCodexSystem.restore(initialSave.codex);
  }

  const saveSystem = new SaveSystem({
    container,
    player: controller,
    inventorySystem,
    craftingCodexSystem,
    profileSystem,
  });
  const tradeSystem = new TradeSystem({
    container,
    eventBus,
    inventorySystem,
    profileSystem,
    npcSystem,
  });
  const explosionEffectSystem = new ExplosionEffectSystem({
    scene,
    container,
    eventBus,
    worldManager,
    player: controller,
    npcSystem,
  });
  const unsubscribeKick = eventBus.on('player:kick', ({ attacker }) => {
    combatController.kick(attacker, npcSystem.getCombatEntities());
  });
  const unsubscribeBiology = eventBus.on('biology:update', (biologyState) => {
    worldManager.setBiologyState(biologyState);
  });
  const systems = [
    weatherSystem,
    biologySystem,
    moonSystem,
    sunSystem,
    lightSystem,
    skySystem,
    worldStatusHud,
    villageSystem,
    npcSystem,
    plantGrowthSystem,
    roseGrowthSystem,
    tulipGrowthSystem,
    snowLotusGrowthSystem,
    ecologySystem,
    ecosystemHoverSystem,
    soundSystem,
    profileSystem,
    tradeSystem,
    explosionEffectSystem,
    worldItemSystem,
    inventorySystem,
    interactionSystem,
    aiBuildingSystem,
    craftingCodexSystem,
    saveSystem,
    timeSystem,
  ];

  if (import.meta.env.DEV) {
    window.__threeMiniWorldDebug = {
      scene,
      camera,
      renderer,
      worldManager,
      controller,
      aiBuildingSystem,
    };
  }

  let animationFrameId = 0;

  function render() {
    const deltaTime = Math.min(clock.getDelta(), 0.05);

    resizeRendererToContainer(renderer, camera, container);
    timeSystem.update(deltaTime);
    weatherSystem.update(deltaTime);
    combatController.update(deltaTime);
    controller.update(deltaTime, worldManager, npcSystem);
    worldManager.update(controller.position);
    worldManager.updateWater(deltaTime);
    plantGrowthSystem.update(deltaTime);
    roseGrowthSystem.update(deltaTime);
    tulipGrowthSystem.update(deltaTime);
    snowLotusGrowthSystem.update(deltaTime);
    ecologySystem.update(deltaTime);
    villageSystem.update(deltaTime);
    npcSystem.update(deltaTime);
    worldItemSystem.update(deltaTime);
    interactionSystem.update(deltaTime);
    explosionEffectSystem.update(deltaTime);
    tradeSystem.update(deltaTime);
    soundSystem.update(deltaTime, controller, worldManager, villageSystem);
    container.classList.toggle('is-in-lava', worldManager.isBodyInLava(controller.body));
    renderer.render(scene, camera);

    animationFrameId = requestAnimationFrame(render);
  }

  render();

  return () => {
    if (window.__threeMiniWorldDebug?.worldManager === worldManager) {
      delete window.__threeMiniWorldDebug;
    }
    cancelAnimationFrame(animationFrameId);
    unsubscribeKick();
    unsubscribeBiology();
    systems.forEach((system) => system.dispose());
    eventBus.clear();
    controller.dispose();
    character.userData.disposeAnimation?.();
    character.userData.disposeGlider?.();
    worldManager.dispose();
    container.classList.remove('is-in-lava');
    renderer.dispose();
    renderer.domElement.remove();
  };
}
