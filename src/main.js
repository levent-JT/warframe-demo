import * as THREE from 'three';
import { MovementController, DEFAULTS, LABELS } from './movement.js';
import { createScene, createCharacter, createTrails } from './scene.js';
import { solids, spawns, gates } from './world.js';
import { Spring, RenderInterpolator } from './motion-math.js';
import { ActionInput, ACTIONS, keyLabel, mouseLook } from './input.js';
import { WEAPONS, MELEE_SETS, BRANCHES } from './melee.js';
import { CombatController, GUNS } from './combat.js';
import { createCombatVisual } from './combat-visual.js';

const $ = id => document.getElementById(id);
const safeStore = {
  get(key) { try { return localStorage.getItem(`kinetic.${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`kinetic.${key}`, value); } catch { /* private browsing */ } },
};
const canvas = $('game');
let world;
try { world = createScene(canvas); }
catch (error) {
  $('error').classList.remove('hidden');
  $('error').textContent = `无法启动 WebGL 3D 场景。请使用开启硬件加速的 Chrome 或 Edge。详细信息：${error.message}`;
  throw error;
}
const { scene, camera, renderer, collisionMeshes, gateMeshes } = world;
const character = createCharacter(scene), trail = createTrails(scene);
const player = new MovementController();
const combat = new CombatController(); player.combat = combat;
const combatVisual = createCombatVisual(scene,combat);
const savedGun=Number(safeStore.get('gun'));if(Number.isInteger(savedGun)&&GUNS[savedGun])combat.selected=savedGun;
if(['battle','targets','off'].includes(safeStore.get('combatMode')))combat.setMode(safeStore.get('combatMode'));
if (WEAPONS[safeStore.get('meleeWeapon')]) player.melee.weapon = safeStore.get('meleeWeapon');
for (let i = 0; i < 8; i++) player.step(1 / 120);
player.events.length = 0;
scene.updateMatrixWorld(true);

let active = false, yaw = 0, pitch = -.14, snapCamera = true, accumulator = 0;
let sensitivity = Number(safeStore.get('sensitivity')) || .0022;
let baseFov = Number(safeStore.get('fov')) || 69;
let toastTimer = 0, totalTime = 0;
let aimSensitivity = Number(safeStore.get('aimSensitivity')) || .75, invertY = safeStore.get('invertY') === 'true';
let shoulderSide = safeStore.get('shoulder') === '-1' ? -1 : 1;
let hadPointerLock = false, hoverLook = false, lastPointer = null, bindingCapture = null;
let route = { active: false, finished: false, index: 0, time: 0, best: Number(safeStore.get('best')) || 0 };
let audioContext, soundEnabled = safeStore.get('sound') !== 'false';
const keys = new ActionInput(safeStore.get('bindings')), visited = new Set(), history = [];
keys.tapSprintRoll = safeStore.get('tapSprintRoll') !== 'false';
if(safeStore.get('combatControls14')!=='done'){
  safeStore.set('bindings13Backup',safeStore.get('bindings')||keys.serialize());
  keys.upgradeCombatControls();safeStore.set('bindings',keys.serialize());safeStore.set('tapSprintRoll',true);safeStore.set('combatControls14','done');
}
const fixed = 1 / 120, raycaster = new THREE.Raycaster();
const renderPose = new RenderInterpolator(player.position);
const speedBars = [];
for (let i = 0; i < 18; i++) { const el = document.createElement('i'); $('speed-bars').append(el); speedBars.push(el); }

function toast(message, duration = 3200) {
  $('toast').textContent = message; $('toast').classList.add('show'); toastTimer = duration / 1000;
}
function beep(event) {
  if (!soundEnabled || !audioContext) return;
  const tones = { bullet: [180, 720, .17], double: [300, 550, .10], jump: [210, 350, .09],
    airRoll: [360, 160, .12], land: [100, 55, .08], hardLand: [70, 32, .16], wallClimb: [180, 220, .035], wallRun: [190, 240, .035], latch: [430, 180, .12],
    meleeAttack: [310, 125, .09], heavyAttack: [150, 80, .19], meleeImpact: [100, 35, .16],
    shot:[140,45,.07],hit:[850,420,.045],reload:[160,260,.09],reloadDone:[350,620,.08],kill:[540,940,.11],hurt:[85,45,.07],swap:[280,380,.05] };
  const tone = tones[event]; if (!tone) return;
  const osc = audioContext.createOscillator(), gain = audioContext.createGain();
  const t = audioContext.currentTime; osc.type = 'sine'; osc.frequency.setValueAtTime(tone[0], t);
  osc.frequency.exponentialRampToValueAtTime(tone[1], t + tone[2]);
  gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(.025, t + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, t + tone[2]); osc.connect(gain); gain.connect(audioContext.destination);
  osc.start(t); osc.stop(t + tone[2] + .02);
}
function pause() {
  active = false; keys.clear(); accumulator = 0; lastPointer = null;
  canvas.classList.remove('playing');
  renderPose.reset(player.position);
  if (document.pointerLockElement) document.exitPointerLock();
  $('menu').classList.remove('hidden'); $('session-card').classList.remove('hidden');
  $('hud').classList.add('hidden'); $('footer').classList.remove('hidden');
  $('start').innerHTML = '继续训练 <span>↗</span>';
}
async function start() {
  $('modal').classList.add('hidden'); $('menu').classList.add('hidden'); $('session-card').classList.add('hidden');
  $('hud').classList.remove('hidden'); $('footer').classList.add('hidden');
  active = true; keys.clear(); lastPointer = null; canvas.classList.add('playing'); canvas.focus();
  try { await canvas.requestPointerLock(); }
  catch { enableHoverLook(); }
  try { audioContext ||= new AudioContext(); await audioContext.resume(); } catch { /* audio is optional */ }
}
$('start').addEventListener('click', start);
$('menu-button').addEventListener('click', pause);
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && hadPointerLock && active) pause();
  hadPointerLock = locked; hoverLook = !locked; lastPointer = null;
});
function enableHoverLook() {
  if (!hoverLook) toast('已启用鼠标跟随，无需按住左键。此浏览器不支持锁定光标；完整无限转向请用 Chrome / Edge 打开。', 6000);
  hoverLook = true;
}
document.addEventListener('pointerlockerror', enableHoverLook);
window.addEventListener('mousemove', e => {
  if (!active || (document.pointerLockElement !== canvas && (!hoverLook || e.target !== canvas))) return;
  let dx = e.movementX, dy = e.movementY;
  if (!document.pointerLockElement) {
    if (!dx && !dy && lastPointer) { dx = e.clientX - lastPointer.x; dy = e.clientY - lastPointer.y; }
    lastPointer = { x: e.clientX, y: e.clientY };
  }
  ({ yaw, pitch } = mouseLook(yaw, pitch, dx, dy, sensitivity, keys.down('aim') ? aimSensitivity : 1, invertY));
});
canvas.addEventListener('mouseleave', () => { lastPointer = null; });
window.addEventListener('contextmenu', e => { if (active || !$('modal').classList.contains('hidden')) e.preventDefault(); });
canvas.addEventListener('auxclick', e => e.preventDefault());
window.addEventListener('blur', () => { if (active) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && active) pause(); });
function dispatchActions(actions) {
  if (actions.includes('reset')) resetCheckpoint();
  if (actions.includes('help')) showHelp();
  if (actions.includes('route')) startRoute();
  if (actions.includes('shoulder')) { shoulderSide *= -1; safeStore.set('shoulder', shoulderSide); }
  const zone = actions.find(a => /^zone[1-6]$/.test(a));
  if (zone) teleport(Number(zone.slice(-1)) - 1);
}
function captureBinding(code, e) {
  if (!bindingCapture) return false;
  e.preventDefault(); e.stopImmediatePropagation();
  if (code === 'Escape') { bindingCapture = null; showBindings('已取消改键。'); return true; }
  const result = keys.bind(bindingCapture.id, bindingCapture.slot, code);
  if (result.ok) { bindingCapture = null; safeStore.set('bindings', keys.serialize()); updateBindingHints(); showBindings(result.message); }
  else $('binding-status').textContent = result.message;
  return true;
}
window.addEventListener('keydown', e => {
  if (bindingCapture && e.repeat) { e.preventDefault(); return; }
  if (captureBinding(e.code, e)) return;
  if (e.code === 'Escape') {
    if (!$('modal').classList.contains('hidden')) closeModal(); else if (active) pause(); return;
  }
  if (!active) return;
  if (keys.actionsFor(e.code).length) e.preventDefault();
  if (e.repeat) return;
  dispatchActions(keys.press(e.code, performance.now()));
}, true);
window.addEventListener('keyup', e => {
  if (active && keys.actionsFor(e.code).length) e.preventDefault();
  keys.release(e.code, performance.now());
});
window.addEventListener('mousedown', e => {
  if (captureBinding('Mouse' + e.button, e)) return;
  if (!active || e.target !== canvas) return;
  e.preventDefault(); dispatchActions(keys.press('Mouse' + e.button, performance.now()));
}, true);
window.addEventListener('mouseup', e => keys.release('Mouse' + e.button, performance.now()));
canvas.addEventListener('wheel',e=>{if(active){e.preventDefault();keys.edges.add(e.deltaY>0?'nextGun':'prevGun');}},{passive:false});
function readInput() { return keys.read(yaw, pitch, performance.now()); }
function resetCheckpoint() {
  player.reset(); yaw = player.yaw; pitch = -.14; snapCamera = true; history.length = 0;
  renderPose.reset(player.position); keys.clear();
  if (route.active) { route.active = false; toast(`已回到检查点。计时已取消，按 ${key('route')} 重新开始。`); }
  else toast('已回到 ' + spawns[player.checkpoint].name);
}
function teleport(index) {
  player.checkpoint = index; player.reset(); yaw = player.yaw; pitch = -.12; snapCamera = true;
  renderPose.reset(player.position); keys.clear(); history.length = 0;
  if (route.active) { route.active = false; toast(`切换训练区后计时已取消，按 ${key('route')} 重新开始。`); }
  else toast(`${index + 1} / ${spawns[index].name} · ${zoneDescriptions[index]}`);
}
const zoneDescriptions = ['自由尝试全部动作', '冲刺后滑铲穿过通道', '向墙跳，按住跳跃键连续蹬墙', '子弹跳 → 瞄准取消 → 二段跳', '靠近发光绳索使用交互键', '坡面滑铲与台阶测试'];
function startRoute() {
  combat.setMode('off');
  player.checkpoint = 0; player.reset(); yaw = 0; pitch = -.14; snapCamera = true;
  renderPose.reset(player.position);
  route = { ...route, active: true, finished: false, index: 0, time: 0 };
  toast('计时开始：依次穿过 8 个金色圆环。自由选择移动方式。', 4000);
}
function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}
function checkRoute(dt) {
  if (!route.active) return;
  route.time += dt;
  const g = gates[route.index];
  if (player.position.clone().add(new THREE.Vector3(0, .9, 0)).distanceTo(new THREE.Vector3(g.x, g.y, g.z)) < g.r + .25) {
    route.index++;
    if (route.index === gates.length) {
      route.active = false; route.finished = true;
      if (!route.best || route.time < route.best) { route.best = route.time; safeStore.set('best', String(route.time)); }
      toast(`路线完成 · ${formatTime(route.time)} · 按 ${key('route')} 再来一次`, 6000);
    } else toast(`检查环 ${route.index} / 8 · 继续前往金色圆环`, 1500);
  }
}
function openModal(title, markup) {
  pause(); $('modal-title').textContent = title; $('modal-content').innerHTML = markup;
  $('modal').classList.remove('hidden'); $('close-modal').focus();
}
function closeModal() { bindingCapture = null; $('modal').classList.add('hidden'); $('start').focus(); }
$('close-modal').addEventListener('click', closeModal);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.code !== 'Tab' || $('modal').classList.contains('hidden')) return;
  const items = [...$('modal').querySelectorAll('button, input, a[href]')];
  const first = items[0], last = items.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
const key = action => keyLabel(keys.bindings[action][0]);
function updateBindingHints() {
  document.querySelectorAll('[data-keys]').forEach(el => {
    const actions = el.dataset.keys.split(','); el.textContent = actions.map(key).join(actions.length > 2 ? ' ' : ' + ');
  });
}
function showBindings(message = '点击主键或备用键，然后按下键盘或鼠标按钮。冲突的主键会互换。') {
  openModal('自定义按键', `<p id="binding-status" class="binding-status" role="status">${message}</p>
    <div class="binding-grid">${ACTIONS.map(a => `<div class="binding-row"><span>${a.label}<small>${a.group}</small></span>${keys.bindings[a.id].map((code, slot) => `<button id="bind-${a.id}-${slot}" data-action="${a.id}" data-slot="${slot}" class="key-bind" aria-label="${a.label} ${slot ? '备用键' : '主键'}">${keyLabel(code)}</button>`).join('')}${keys.bindings[a.id][1] ? `<button class="clear-bind" data-clear="${a.id}" aria-label="清除${a.label}备用键">×</button>` : '<span></span>'}</div>`).join('')}</div>
    <div class="tuning-footer"><label><input id="tap-roll" type="checkbox" ${keys.tapSprintRoll ? 'checked' : ''}> 轻点奔跑键触发翻滚</label><button class="secondary" id="reset-bindings">恢复默认按键</button></div>
    <div class="manual-note">长按奔跑键 0.25 秒切换奔跑开关，松开后保持；再次长按关闭。轻点只翻滚，不改变奔跑开关。暂停会清除奔跑状态。<br>射击布局：左键射击、E 近战、R 换弹、F 切回上一把枪、1 / 2 / 3 选枪、滚轮依次切枪、Z 切换棍剑、Backspace 复位。旧移动改键保留，Shift 已按本轮要求更新；每项均可重新绑定。<br>按键保存在本机浏览器。Esc 固定用于取消改键或暂停。</div>`);
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    bindingCapture = { id: button.dataset.action, slot: Number(button.dataset.slot) };
    document.querySelectorAll('.key-bind').forEach(b => b.classList.remove('listening'));
    button.classList.add('listening'); button.textContent = '按下新键…';
    $('binding-status').textContent = '正在录入：' + ACTIONS.find(a => a.id === bindingCapture.id).label + '。Esc 取消。';
  }));
  document.querySelectorAll('[data-clear]').forEach(button => button.addEventListener('click', () => {
    keys.bind(button.dataset.clear, 1, null); safeStore.set('bindings', keys.serialize()); showBindings('备用键已清除。');
  }));
  $('reset-bindings').addEventListener('click', () => { bindingCapture = null; keys.resetBindings(); safeStore.set('bindings', keys.serialize()); updateBindingHints(); showBindings('默认按键已恢复。'); });
  $('tap-roll').addEventListener('change', e => { keys.tapSprintRoll = e.target.checked; safeStore.set('tapSprintRoll', e.target.checked); });
}
$('bindings-button').addEventListener('click', () => { bindingCapture = null; showBindings(); });
function showCombat(){
  openModal('枪械与机器人训练', `<div class="gun-choices">${GUNS.map((g,i)=>`<button class="gun-card ${combat.selected===i?'selected':''}" data-gun="${i}" aria-pressed="${combat.selected===i}"><small>0${i+1} / ${g.type}</small><strong>${g.short}</strong><span>${g.name.split(' · ')[0]}</span><b>${g.magazine} 发 · ${g.reload.toFixed(2)} 秒换弹</b></button>`).join('')}</div>
    <div class="mode-choices">${[['battle','机器人对战','巡逻、追击、预瞄与可躲避弹道'],['targets','静态靶场','机器人站定，适合练习枪械与近战'],['off','自由跑酷','关闭对手，练习移动与动作']].map(([mode,name,description])=>`<button data-combat-mode="${mode}" class="mode-card ${combat.mode===mode?'selected':''}" aria-pressed="${combat.mode===mode}"><strong>${name}</strong><span>${description}</span></button>`).join('')}</div>
    <div class="manual-note">${key('aim')} 瞄准，${key('fire')} 射击；自动步枪可按住连射，手枪与霰弹枪每次按下发射一发。<br>${key('reload')} 换弹；${key('quickSwap')} 切回上一把枪，${key('gun1')} / ${key('gun2')} / ${key('gun3')} 直选，滚轮切枪。每把枪保留自己的弹匣；切枪会中断换弹。备用弹药无限，空弹匣仍须换弹。<br>命中头部伤害更高，机器人会提前亮红灯瞄准。护盾脱战 4 秒后恢复，被击倒后自动回到起点。${key('melee')} / ${key('heavy')} 的棍剑攻击也能伤害对手。</div>
    <div class="tuning-footer"><button id="reset-bots" class="secondary">重置机器人</button><button id="practice-combat" class="primary">进入训练 <span>↗</span></button></div>`);
  document.querySelectorAll('[data-gun]').forEach(button=>button.onclick=()=>{combat.selectGun(Number(button.dataset.gun),player);safeStore.set('gun',combat.selected);showCombat();});
  document.querySelectorAll('[data-combat-mode]').forEach(button=>button.onclick=()=>{combat.setMode(button.dataset.combatMode);safeStore.set('combatMode',combat.mode);showCombat();});
  $('reset-bots').onclick=()=>{combat.resetBots();combat.resetPlayer();showCombat();};
  $('practice-combat').onclick=()=>{player.melee.cancel('gun');player.melee.drawn=false;start();};
}
$('combat-button').addEventListener('click',showCombat);
function showMelee() {
  const selected = player.melee.weapon;
  const attackKeys = keys.bindings.melee.filter(Boolean).map(keyLabel).join(' / ');
  const rows = [
    ['neutral', attackKeys], ['forward', `${key('forward')} + ${key('melee')}`],
    ['tactical', `${key('aim')} + ${key('melee')}`], ['forwardTactical', `${key('forward')} + ${key('aim')} + ${key('melee')}`],
    ['slide', `滑铲中 ${key('melee')}`], ['aerial', `空中 ${key('melee')}`],
    ['heavy', key('heavy')], ['slam', `空中向下看 + ${key('melee')} / ${key('heavy')}`],
  ];
  openModal('近战武器与动作', `<div class="weapon-choices">${Object.entries(WEAPONS).map(([id,w])=>`<button class="weapon-card ${id===selected?'selected':''}" data-weapon="${id}" aria-pressed="${id===selected}"><small>${id==='staff'?'01 / STAFF':'02 / SWORD'}</small><strong>${w.label}</strong><span>${w.detail}</span><b>${id===selected?'已装备':'点击装备'}</b></button>`).join('')}</div>
    <div class="control-grid">${rows.map(([branch,input])=>`<div class="control-row"><div><span>${BRANCHES[branch]}</span><small>${MELEE_SETS[selected][branch].map(m=>m.name).join(' → ')}</small></div><span>${input}</span></div>`).join('')}</div>
    <div class="manual-note">点按接段，或按住攻击键连续挥击；前进和瞄准输入决定下一段动作。<br>${key('roll')} 翻滚或 ${key('jump')} 跳跃可中断挥击；松开攻击后，重新按 ${key('aim')} 可回到瞄准 / 滑翔。下砸中须用仍有次数的翻滚或跳跃取消。<br>${key('switchWeapon')} 切换两类武器。空中 ${key('heavy')} 为重型下砸；向下瞄准可决定下砸角度，${key('slam')} 保留直接俯冲入口。<br>棍杖和单手剑均可伤害机器人；本轮为基础动作，不含完整姿态 Mod 连招。</div>
    <button id="practice-melee" class="primary" style="margin-top:18px">进入近战练习 <span>↗</span></button>`);
  document.querySelectorAll('[data-weapon]').forEach(button=>button.addEventListener('click',()=>{
    player.melee.selectWeapon(button.dataset.weapon); safeStore.set('meleeWeapon',player.melee.weapon); showMelee();
  }));
  $('practice-melee').addEventListener('click',()=>{ player.melee.drawn=true; start(); });
}
$('melee-button').addEventListener('click',showMelee);
const checklist = ['sprint', 'crouch', 'slide', 'bullet', 'double', 'roll', 'airRoll', 'glide', 'wallClimb', 'wallRun', 'latch', 'mantle', 'zipline', 'slam'];
function showHelp() {
  const controls = [
    ['移动 / 奔跑开关', `鼠标直接转向；长按 ${key('sprint')} 0.25 秒切换奔跑，松开后保持`, `${key('forward')}${key('left')}${key('back')}${key('right')} / ${key('sprint')}`],
    ['蹲行 / 滑铲', '移动时蹲下会保留动量', key('crouch')],
    ['子弹跳', '朝当前准星方向发射', `${key('crouch')} + ${key('jump')}`],
    ['跳跃 / 二段跳', '空中再次按；蹬墙刷新空中次数', key('jump')],
    ['翻滚 / 空中翻滚', `也可轻点 ${key('sprint')}；方向相对当前镜头`, key('roll')],
    ['瞄准 / 滑翔', '点按可取消子弹跳或二段跳动画，保持则缓降', key('aim')],
    ['纵向 / 横向蹬墙', '面向墙或沿墙方向移动', `方向 + 按住 ${key('jump')}`],
    ['壁面攀附 / 跳离', '空中贴墙瞄准，再跳离墙面', `${key('aim')} / ${key('jump')}`],
    ['攀越边缘', '面向边缘自动翻越；新按蹲伏可中断', `${key('forward')} + ${key('jump')}`],
    ['空中滑踢', '从滑翔衔接滑踢，落地可接滑铲', key('crouch')],
    ['绳索平衡', '靠近交互；再次交互或跳跃下绳', key('interact')],
    ['俯冲 / 取消俯冲', '直接快速落地；近战下砸可伤害附近机器人', `${key('slam')} / ${key('roll')}`],
    ['镜头肩侧', '左右肩切换，瞄准仍对准屏幕中心', key('shoulder')],
    ['近战 / 重击', '点按接段或按住连续攻击；前进与瞄准改变连段', `${key('melee')} / ${key('heavy')}`],
    ['棍杖 / 单手剑', '切换两类武器，菜单中可查看全部基础动作', key('switchWeapon')],
    ['射击 / 换弹', '步枪按住连射，手枪和霰弹枪点按；换弹期间可以切枪或近战', `${key('fire')} / ${key('reload')}`],
    ['切换枪械', '切回上一把枪；也可滚轮循环或使用选枪键', `${key('quickSwap')} / ${key('gun1')} · ${key('gun2')} · ${key('gun3')}`],
    ['复位 / 指南', 'Esc 暂停并释放鼠标', `${key('reset')} / ${key('help')}`],
  ];
  openModal('把动作连起来', `<div class="control-grid">${controls.map(([name, sub, key]) => `<div class="control-row"><div><span>${name}</span><small>${sub}</small></div><span>${key}</span></div>`).join('')}</div>
    <div class="manual-note"><strong>瞄准取消连招</strong><br>① ${key('crouch')} + ${key('jump')} 子弹跳 → 松开蹲伏 → 点按 ${key('aim')} 收起旋转 → 转动鼠标 → ${key('jump')} + ${key('roll')} 二段跳衔接翻滚 → 保持 ${key('aim')} 滑翔 → ${key('crouch')} 滑铲着陆。<br>② 普通跳跃 → ${key('aim')} 滑翔转向 → ${key('crouch')} + ${key('jump')}，消耗剩余的空中子弹跳。<br>③ 贴墙 ${key('aim')} 攀附 → 转动视角 → ${key('jump')} 跳离，再衔接空中动作。<br>取消动画不会额外恢复跳跃、翻滚次数或滑翔时间。新跳跃、翻滚、滑踢优先于保持中的瞄准；翻滚完成后可继续滑翔。三把枪均可瞄准射击；${key('melee')} 近战、${key('reload')} 换弹，详细设置见枪械与机器人面板。</div>
    <div class="eyebrow" style="margin-top:22px">已体验 ${checklist.filter(s => visited.has(s)).length} / 14</div><div class="checklist">${checklist.map(s => `<span class="${visited.has(s) ? 'done' : ''}">${visited.has(s) ? '✓ ' : ''}${LABELS[s]}</span>`).join('')}</div>`);
}
$('help-button').addEventListener('click', showHelp);
$('zones-button').addEventListener('click', () => {
  openModal('选择你的练习', `<div class="zone-grid">${spawns.map((s, i) => `<button class="zone-card" data-zone="${i}"><b>0${i + 1}</b><span>${s.name}<small>${zoneDescriptions[i]} · ${key('zone' + (i + 1))}</small></span></button>`).join('')}</div><div class="manual-note">训练中可按各区域旁的按键切换。${key('reset')} 回到所选区域的起点。</div>`);
  document.querySelectorAll('[data-zone]').forEach(el => el.addEventListener('click', () => { teleport(Number(el.dataset.zone)); start(); }));
});
$('route-button').addEventListener('click', () => { startRoute(); start(); });
const settings = [
  ['sprintSpeed', '冲刺速度', 8, 18, .5], ['bulletSpeed', '子弹跳速度', 18, 34, .5],
  ['jumpSpeed', '跳跃力度', 7, 15, .1], ['gravity', '重力', 16, 36, .5],
  ['airAcceleration', '空中转向', 5, 32, 1], ['slideFriction', '滑铲摩擦', 1, 10, .2],
  ['glideDuration', '滑翔时长', 1, 6, .1], ['fov', '镜头视野', 55, 95, 1], ['sensitivity', '鼠标灵敏度', 1, 5, .1],
  ['aimSensitivity', '瞄准灵敏度倍率', .2, 1.5, .05],
];
function showTuning() {
  openModal('找到你的手感', `${settings.map(([key, label, min, max, step]) => {
    const value = key === 'fov' ? baseFov : key === 'sensitivity' ? sensitivity * 1000 : key === 'aimSensitivity' ? aimSensitivity : player.config[key];
    return `<label class="tuning-row"><span>${label}</span><input data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/><output>${Number(value.toFixed(key === 'aimSensitivity' ? 2 : 1))}</output></label>`;
  }).join('')}<div class="tuning-footer"><label><input id="sound-setting" type="checkbox" ${soundEnabled ? 'checked' : ''}/> 动作音效</label><label><input id="invert-setting" type="checkbox" ${invertY ? 'checked' : ''}/> 反转鼠标 Y 轴</label><button id="reset-settings" class="secondary">恢复默认参数</button></div><div class="manual-note">移动数值是本 demo 的可调近似参数。按键、鼠标、视野与音效偏好保存在本机；移动参数本次会话有效。<br>进入训练后鼠标直接转向；不支持光标锁定的浏览器使用鼠标跟随，Esc 随时暂停。<br>动作参考 <a href="https://www.warframe.com/en/game/quickstart#parkour" target="_blank" rel="noopener" style="color:var(--gold)">Warframe 官方指南 ↗</a>。角色为原创装甲人形。</div>`);
  document.querySelectorAll('[data-setting]').forEach(el => el.addEventListener('input', () => {
    const key = el.dataset.setting, value = Number(el.value); el.nextElementSibling.textContent = value;
    if (key === 'fov') { baseFov = value; safeStore.set('fov', value); }
    else if (key === 'sensitivity') { sensitivity = value / 1000; safeStore.set('sensitivity', sensitivity); }
    else if (key === 'aimSensitivity') { aimSensitivity = value; safeStore.set('aimSensitivity', value); }
    else { player.config[key] = value; player.glideLeft = Math.min(player.glideLeft, player.config.glideDuration); }
  }));
  $('sound-setting').addEventListener('change', e => { soundEnabled = e.target.checked; safeStore.set('sound', soundEnabled); });
  $('invert-setting').addEventListener('change', e => { invertY = e.target.checked; safeStore.set('invertY', invertY); });
  $('reset-settings').addEventListener('click', () => {
    Object.assign(player.config, DEFAULTS); baseFov = 69; sensitivity = .0022; soundEnabled = true;
    aimSensitivity = .75; invertY = false; safeStore.set('aimSensitivity', aimSensitivity); safeStore.set('invertY', invertY);
    safeStore.set('fov', baseFov); safeStore.set('sensitivity', sensitivity); safeStore.set('sound', true); showTuning();
  });
}
$('tuning-button').addEventListener('click', showTuning);

const cameraHeight = new Spring(1.4), cameraDistance = new Spring(5.8), cameraFov = new Spring(baseFov);
const cameraClearance = new Spring(6);
const cameraShoulder = new Spring(.65 * shoulderSide);
const cameraLook = new THREE.Vector3(), cameraRight = new THREE.Vector3(), cameraTarget = new THREE.Vector3();
const cameraVector = new THREE.Vector3(), cameraAim = new THREE.Vector3();
function updateCamera(dt, position) {
  const viewPitch=THREE.MathUtils.clamp(pitch+combat.recoil*.22,-1.5,1.5);
  cameraLook.set(-Math.sin(yaw) * Math.cos(viewPitch), Math.sin(viewPitch), -Math.cos(yaw) * Math.cos(viewPitch));
  cameraRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
  const aiming = keys.down('aim'), height = player.height < 1 ? .80 : 1.4;
  const distance = aiming ? 3.4 : 5.8 + Math.min(player.speed * .024, .6);
  const fov = baseFov + (aiming ? -8 : Math.min(9, player.speed * .28));
  if (snapCamera) { cameraHeight.reset(height); cameraDistance.reset(distance); cameraFov.reset(fov); }
  // Follow the same interpolated root as the character. Only offsets are damped,
  // so speed changes no longer leave the camera dragging behind the player.
  cameraTarget.copy(position); cameraTarget.y += cameraHeight.step(height, 26, dt);
  cameraVector.copy(cameraLook).multiplyScalar(-cameraDistance.step(distance, 18, dt)).addScaledVector(cameraRight, cameraShoulder.step(.65 * shoulderSide, 20, dt));
  const length = cameraVector.length(); cameraVector.normalize();
  raycaster.set(cameraTarget, cameraVector); raycaster.far = length;
  const hit = raycaster.intersectObjects(collisionMeshes, false)[0];
  const safeLength = hit ? Math.max(.20, hit.distance - .25) : length;
  // Pull in immediately at obstacles, ease back out after clearing them.
  if (snapCamera || safeLength < cameraClearance.value) cameraClearance.reset(safeLength);
  const boom = Math.min(safeLength, cameraClearance.step(safeLength, 18, dt));
  camera.position.copy(cameraTarget).addScaledVector(cameraVector, boom);
  character.root.visible = boom > .65;
  camera.lookAt(cameraAim.copy(camera.position).addScaledVector(cameraLook, 20));
  camera.fov = cameraFov.step(fov, 12, dt); camera.updateProjectionMatrix(); snapCamera = false;
}
const mapCtx = $('minimap').getContext('2d');
function drawMap() {
  const ctx = mapCtx, scale = 1.82;
  ctx.clearRect(0, 0, 180, 230); ctx.save(); ctx.translate(90, 144);
  for (const b of solids) {
    ctx.fillStyle = b.kind === 'floor' ? '#54718144' : '#aac6d25c';
    ctx.fillRect(b.minX * scale, b.minZ * scale, b.w * scale, b.d * scale);
  }
  if (route.active) {
    const g = gates[route.index]; ctx.strokeStyle = '#ebc484'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(g.x * scale, g.z * scale, 5, 0, Math.PI * 2); ctx.stroke();
  }
  if(combat.mode!=='off')for(const bot of combat.bots)if(bot.alive){ctx.fillStyle=bot.charge>0?'#ff5939':'#da9168';ctx.beginPath();ctx.arc(bot.actor.position.x*scale,bot.actor.position.z*scale,2.4,0,Math.PI*2);ctx.fill();}
  ctx.translate(player.position.x * scale, player.position.z * scale); ctx.rotate(-yaw);
  ctx.fillStyle = '#8dfff0'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(0, 2); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill(); ctx.restore();
}
function updateHUD() {
  $('crosshair').classList.toggle('aiming', keys.down('aim'));
  $('crosshair').classList.toggle('hit',combat.hitMarker>0);$('crosshair').classList.toggle('headshot',combat.hitMarker>0&&combat.headMarker);
  $('gun-name').textContent=combat.gun.short;$('gun-mode').textContent=combat.gun.type;
  $('ammo-current').textContent=combat.magazine;$('ammo-capacity').textContent=`/ ${combat.gun.magazine}`;
  $('gun-status').textContent=combat.reloadLeft>0?`换弹 ${combat.reloadLeft.toFixed(1)}s`:combat.swapLeft>0?'切换武器':player.melee.drawn?'近战模式 · 射击回枪':'备用弹药 ∞';
  $('reload-progress').style.width=`${combat.reloadLeft>0?combat.reloadProgress*100:0}%`;
  document.querySelectorAll('[data-gun-slot]').forEach(el=>el.classList.toggle('selected',Number(el.dataset.gunSlot)===combat.selected));
  $('shield-value').textContent=Math.ceil(combat.shield);$('health-value').textContent=Math.ceil(combat.health);
  $('shield-bar').style.width=`${combat.shield/80*100}%`;$('health-bar').style.width=`${combat.health}%`;
  $('sprint-state').textContent=keys.sprintToggled?'奔跑已开启':'常速移动';$('kill-count').textContent=combat.kills;
  $('damage-vignette').style.opacity=String(combat.damageFlash/.22*.5);
  $('down-screen').classList.toggle('hidden',combat.alive);$('respawn-time').textContent=Math.max(0,combat.respawnLeft).toFixed(1);
  const target=combat.trace(camera.position,cameraLook,120).bot;
  $('target-label').textContent=target?`守卫 ${String(target.id+1).padStart(2,'0')} · ${Math.ceil(target.hp)}`:'';
  $('aim-state').textContent = keys.down('aim') ? (player.melee.drawn ? '近战格挡 · ' : '瞄准 · ') + (shoulderSide > 0 ? '右肩' : '左肩') : '自由视角';
  const attack = player.melee.active;
  $('melee-weapon').textContent = WEAPONS[player.melee.weapon].label;
  $('melee-action').textContent = attack ? `${attack.move.name} · ${attack.index + 1}/${MELEE_SETS[player.melee.weapon][attack.branch].length}` : player.melee.drawn ? '持械待机' : '随时接入近战';
  $('melee-phase').textContent = attack ? attack.stage === 'fall' ? '下砸' : attack.stage === 'recover' ? '落地收招' : player.melee.striking ? '挥击' : player.melee.progress < attack.move.strike[0] ? '蓄势' : '收招' : '基础动作';
  $('melee-progress').style.width = `${attack ? player.melee.progress * 100 : 0}%`;
  $('look-status').textContent = document.pointerLockElement === canvas ? '鼠标已锁定 · Esc 暂停' : '鼠标跟随 · Esc 暂停';
  $('speed').textContent = player.speed.toFixed(1); $('height').textContent = Math.max(0, player.position.y).toFixed(1);
  $('state').textContent = attack ? attack.move.name : LABELS[player.state] || player.state;
  speedBars.forEach((el, i) => el.classList.toggle('on', i < player.speed / 2));
  $('bullet-ready').classList.toggle('spent', player.bulletUsed || player.doubleUsed);
  $('jump-ready').classList.toggle('spent', player.doubleUsed);
  $('roll-ready').classList.toggle('spent', player.airRollUsed);
  $('glide-meter').style.width = `${100 * player.glideLeft / player.config.glideDuration}%`;
  $('latch-meter').style.width = `${100 * player.latchLeft / player.config.latchDuration}%`;
  const nearestZone = spawns.reduce((a, b) => Math.hypot(player.position.x - a.x, player.position.z - a.z) < Math.hypot(player.position.x - b.x, player.position.z - b.z) ? a : b);
  $('zone-label').textContent = nearestZone.name;
  const rope = player.nearestRope();
  $('context').textContent = player.rope ? `${key('jump')} 跳离 · ${key('interact')} / ${key('crouch')} 下绳` : rope ? `${key('interact')} 站上绳索` : player.state === 'latch' ? `${key('jump')} 跳离 · 松开 ${key('aim')} 下落` : player.wall && !player.grounded ? `按住 ${key('jump')} 蹬墙 · ${key('aim')} 攀附` : '';
  $('route-hud').classList.toggle('hidden', !route.active && !route.finished);
  $('mode-label').textContent = route.active ? '计时路线' : combat.mode==='battle'?'机器人对战':combat.mode==='targets'?'静态靶场':'自由跑酷';
  $('route-progress').textContent = `${String(Math.min(route.index + 1, 8)).padStart(2, '0')} / 08`;
  $('route-time').textContent = formatTime(route.time);
  $('route-best').textContent = route.best ? `最佳 ${formatTime(route.best)}` : '穿过金色圆环';
  if (history.length) $('combo').textContent = history.slice(-4).map(e => LABELS[e]).join(' → ');
  drawMap();
}
function consumeEvents() {
  for (const event of player.events.splice(0)) {
    if (event.name === 'weaponSwap') safeStore.set('meleeWeapon',player.melee.weapon);
    visited.add(event.name); beep(event.name);
    if (!['land', 'reset', 'hardLand'].includes(event.name) && history.at(-1) !== event.name) history.push(event.name);
    if (history.length > 8) history.shift();
    if (event.name === 'reset') {
      yaw = player.yaw; snapCamera = true;
      renderPose.reset(player.position);
      if (route.active && route.time > .1) { route.active = false; toast(`离开训练场，已回到起点。按 ${key('route')} 重新计时。`); }
    }
  }
}
let previous = performance.now(), hudElapsed = 0;
function frame(now) {
  const dt = Math.min((now - previous) / 1000, .05); previous = now; totalTime += dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
  if (active) {
    yaw += (Number(keys.down('lookLeft')) - Number(keys.down('lookRight'))) * dt * 1.8;
    pitch = THREE.MathUtils.clamp(pitch + (Number(keys.down('lookUp')) - Number(keys.down('lookDown'))) * dt * 1.3, -1.5, 1.5);
    accumulator += dt;
    while (accumulator >= fixed) {
      renderPose.capture(player.position);
      const input=readInput();player.step(fixed, combat.prepareInput(input,player));
      combat.step(fixed,input,player,{origin:camera.position,direction:cameraLook,muzzle:character.animator.gunWeight.value>.9?character.firearm.muzzle:undefined});
      for(const event of combat.events.splice(0)){
        combatVisual.event(event);beep(event.type);
        if(event.type==='swap')safeStore.set('gun',combat.selected);
        if(event.type==='respawn'){keys.clear();pitch=-.14;toast('已恢复护盾与弹药，继续训练。');}
      }
      keys.consumeEdges(); accumulator -= fixed;
      visited.add(player.state); checkRoute(fixed); consumeEvents();
    }
  }
  const position = renderPose.sample(player.position, active ? accumulator / fixed : 1);
  character.update(player, active ? dt : 0, totalTime, position);
  if (active) trail(player, dt);
  updateCamera(dt, position);
  combatVisual.update(active?dt:0,camera);
  gateMeshes.forEach((mesh, i) => {
    mesh.visible = route.active || (i === 0 && !active);
    mesh.material.opacity = i === route.index ? .9 : .12;
    mesh.material.color.setHex(i === route.index ? 0xe0bc7e : 0x8dfff0);
    mesh.children[0].rotation.z = totalTime * .3;
  });
  renderer.render(scene, camera);
  hudElapsed += dt; if (hudElapsed > .07) { updateHUD(); hudElapsed = 0; }
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault(); pause(); $('error').textContent = '图形上下文中断，请刷新页面重新进入训练场。'; $('error').classList.remove('hidden');
});
updateBindingHints(); updateHUD(); requestAnimationFrame(frame);
// Development-only hooks for deterministic physics and browser acceptance tests.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('test')) {
  window.__KINETIC__ = {
    player, combat, character, teleport, startRoute, keys, updateBindingHints,
    snapshot: () => ({ position: player.position.toArray(), velocity: player.velocity.toArray(), state: player.state,
      active, yaw, pitch, shoulderSide, lastCancel: player.lastCancel, bulletTimer: player.bulletTimer, doubleTimer: player.doubleTimer,
      bulletUsed: player.bulletUsed, doubleUsed: player.doubleUsed, airRollUsed: player.airRollUsed,
      glideLeft: player.glideLeft, route: { ...route }, visited: [...visited], calls: renderer.info.render.calls,
      combat:{gun:combat.selected,ammo:combat.magazine,reload:combat.reloadLeft,shots:combat.shots,hits:combat.hits,kills:combat.kills,health:combat.health,shield:combat.shield,sprintToggled:keys.sprintToggled,mode:combat.mode,bots:combat.bots.map(b=>({hp:b.hp,state:b.state,position:b.actor.position.toArray()}))},
      melee: { weapon: player.melee.weapon, branch: player.melee.active?.branch, index: player.melee.active?.index, progress: player.melee.progress,
        serial: player.melee.serial, drawn: player.melee.drawn, cancelReason: player.melee.cancelReason, impacts: player.melee.impactSerial },
      animation: { state: character.animator.state, phase: character.animator.phase,
        pose: { ...character.animator.blender.pose }, root: character.root.position.toArray() } }),
    look: (y, p) => { yaw = y; pitch = p; },
    aimAt: point => { const delta=point.clone().sub(camera.position).normalize();yaw=Math.atan2(-delta.x,-delta.z);pitch=Math.asin(delta.y); },
  };
  if(new URLSearchParams(location.search).get('test')==='combat')import('../tests/combat-harness.js').then(({install})=>install(window.__KINETIC__));
  else import('../tests/browser-harness.js').then(({ install }) => install(window.__KINETIC__));
}
