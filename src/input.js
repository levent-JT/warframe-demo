// The game consumes actions, not physical keys. Edges survive short taps between
// physics ticks, and both keyboard and mouse bindings use the same path.
export const ACTIONS = [
  ['forward', '向前移动', '移动', 'KeyW'], ['back', '向后移动', '移动', 'KeyS'],
  ['left', '向左移动', '移动', 'KeyA'], ['right', '向右移动', '移动', 'KeyD'],
  ['jump', '跳跃 / 蹬墙', '跑酷', 'Space'], ['crouch', '蹲伏 / 滑铲', '跑酷', 'KeyC', 'ControlLeft'],
  ['sprint', '轻点翻滚 / 长按切换奔跑', '跑酷', 'ShiftLeft'], ['roll', '直接翻滚', '跑酷', 'KeyQ'],
  ['aim', '瞄准 / 滑翔 / 攀附', '瞄准', 'Mouse2'], ['interact', '绳索交互', '跑酷', 'KeyX'],
  ['slam', '直接俯冲 / 下砸', '跑酷', 'KeyG'], ['shoulder', '切换镜头肩侧', '瞄准', 'KeyV'],
  ['melee', '近战攻击', '近战', 'KeyE'], ['heavy', '近战重击', '近战', 'Mouse1'],
  ['switchWeapon', '切换棍杖 / 单手剑', '近战', 'KeyZ'],
  ['fire', '射击', '枪械', 'Mouse0'], ['reload', '换弹', '枪械', 'KeyR'],
  ['quickSwap', '切回上一把枪', '枪械', 'KeyF'], ['nextGun', '下一把枪', '枪械', 'BracketRight'], ['prevGun', '上一把枪', '枪械', 'BracketLeft'],
  ['gun1', '自动步枪', '枪械', 'Digit1'], ['gun2', '半自动手枪', '枪械', 'Digit2'], ['gun3', '霰弹枪', '枪械', 'Digit3'],
  ['reset', '返回检查点', '界面', 'Backspace'], ['help', '操作指南', '界面', 'KeyH'], ['route', '开始计时', '界面', 'KeyT'],
  ['lookLeft', '视角左转', '辅助视角', 'ArrowLeft'], ['lookRight', '视角右转', '辅助视角', 'ArrowRight'],
  ['lookUp', '视角上抬', '辅助视角', 'ArrowUp'], ['lookDown', '视角下压', '辅助视角', 'ArrowDown'],
  ...Array.from({ length: 6 }, (_, i) => ['zone' + (i + 1), '训练区 ' + (i + 1), '界面', 'Numpad' + (i + 1)]),
].map(([id, label, group, primary, secondary = null]) => ({ id, label, group, defaults: [primary, secondary] }));
export const normalizeCode = code => ({ ShiftRight: 'ShiftLeft', ControlRight: 'ControlLeft', AltRight: 'AltLeft' }[code] || code);
export function isBindable(code) {
  return /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Mouse[0-4]|Arrow(Left|Right|Up|Down)|Space|ShiftLeft|ControlLeft|AltLeft|Tab|CapsLock|Enter|Backspace|Insert|Delete|Home|End|PageUp|PageDown|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Minus|Equal|Backquote|F[1-4]|F[6-9]|F10)$/.test(code);
}
export function keyLabel(code) {
  if (!code) return '未设置';
  const labels = { Space: '空格', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', Mouse0: '鼠标左键', Mouse1: '鼠标中键', Mouse2: '鼠标右键', Mouse3: '侧键 1', Mouse4: '侧键 2', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
  return labels[code] || code.replace(/^Key|^Digit/, '').replace('Numpad', '数字区 ');
}
export class ActionInput {
  constructor(serialized) {
    this.bindings = Object.fromEntries(ACTIONS.map(a => [a.id, [...a.defaults]]));
    this.held = new Set(); this.edges = new Set(); this.jumpPosture = null;
    this.sprintPressedAt = null; this.sprintGestureConsumed = false; this.sprintToggled = false; this.tapSprintRoll = true;
    if (serialized) this.load(serialized);
  }
  load(serialized) {
    try {
      const data = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
      const bindings = {}; const used = new Set();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      for (const action of ACTIONS) {
        if (!Object.hasOwn(data, action.id)) continue;
        const slots = data[action.id];
        if (!Array.isArray(slots) || slots.length !== 2 || !slots[0]) return false;
        bindings[action.id] = slots.map(code => code ? normalizeCode(code) : null);
        for (const code of bindings[action.id]) {
          if (!code) continue;
          if (!isBindable(code) || used.has(code)) return false;
          used.add(code);
        }
      }
      // Add newly introduced actions without discarding a player's older map.
      // Existing actions keep their exact keys, including the old E slam key.
      for (const action of ACTIONS) if (!bindings[action.id]) {
        const candidates = [...action.defaults.filter(Boolean), 'KeyJ', 'KeyK', 'KeyL', 'KeyB', 'KeyN', 'KeyM', 'KeyU', 'KeyO', 'KeyP', 'Digit7', 'Digit8', 'Digit9', 'F6', 'F7', 'F8'];
        const primary = candidates.find(code => !used.has(code));
        if (!primary) return false;
        used.add(primary);
        const alternate = action.defaults[1] && !used.has(action.defaults[1]) ? action.defaults[1] : null;
        if (alternate) used.add(alternate);
        bindings[action.id] = [primary, alternate];
      }
      this.bindings = bindings; this.clear(); return true;
    } catch { return false; }
  }
  serialize() { return JSON.stringify(this.bindings); }
  upgradeCombatControls() {
    // Applied once by the app, with a backup of the previous map. Conflict
    // exchanges keep every action reachable while adding the shooter layout.
    for (const [action, code] of [
      ['fire','Mouse0'], ['reset','Backspace'], ['reload','KeyR'], ['switchWeapon','KeyZ'],
      ['quickSwap','KeyF'], ['melee','KeyE'], ['slam','KeyG'], ['sprint','ShiftLeft'],
      ...Array.from({length:6},(_,i)=>['zone'+(i+1),'Numpad'+(i+1)]),
      ['gun1','Digit1'], ['gun2','Digit2'], ['gun3','Digit3'],
    ]) this.bind(action, 0, code);
    this.tapSprintRoll = true;
  }
  resetBindings() { this.bindings = Object.fromEntries(ACTIONS.map(a => [a.id, [...a.defaults]])); this.clear(); }
  bind(actionId, slot, rawCode) {
    if (!this.bindings[actionId] || ![0, 1].includes(slot)) return { ok: false, message: '无效动作。' };
    const code = rawCode ? normalizeCode(rawCode) : null;
    if ((!code && slot === 0) || (code && !isBindable(code))) return { ok: false, message: '这个键由浏览器或暂停功能保留，请选择其他键。' };
    const previous = this.bindings[actionId][slot];
    if (code === previous) return { ok: true };
    let conflict;
    if (code) for (const action of ACTIONS) for (let s = 0; s < 2; s++) {
      if (this.bindings[action.id][s] === code) conflict = { action, slot: s };
    }
    if (conflict && !previous && conflict.slot === 0) return { ok: false, message: `该键是“${conflict.action.label}”的主键，请通过主键按钮交换。` };
    if (conflict) this.bindings[conflict.action.id][conflict.slot] = previous;
    this.bindings[actionId][slot] = code; this.clear();
    return { ok: true, message: conflict ? `已与“${conflict.action.label}”交换按键。` : '按键已保存。' };
  }
  actionsFor(rawCode) {
    const code = normalizeCode(rawCode);
    return ACTIONS.filter(a => this.bindings[a.id].includes(code)).map(a => a.id);
  }
  down(action) { return this.bindings[action]?.some(code => code && this.held.has(code)) || false; }
  pressed(action) { return this.edges.has(action); }
  press(rawCode, now = 0) {
    const code = normalizeCode(rawCode);
    if (this.held.has(code)) return [];
    this.held.add(code); const actions = this.actionsFor(code);
    for (const action of actions) this.edges.add(action);
    if (actions.includes('jump')) this.jumpPosture = this.down('crouch');
    if (actions.includes('sprint')) { this.sprintPressedAt = now; this.sprintGestureConsumed = false; }
    return actions;
  }
  release(rawCode, now = 0) {
    this.updateSprint(now);
    const code = normalizeCode(rawCode), wasHeld = this.held.delete(code);
    if (wasHeld && this.actionsFor(code).includes('sprint')) {
      if (this.tapSprintRoll && this.sprintPressedAt !== null && !this.sprintGestureConsumed) this.edges.add('roll');
      this.sprintPressedAt = null;
    }
  }
  consumeEdges() { this.edges.clear(); this.jumpPosture = null; }
  updateSprint(now) {
    if (this.sprintPressedAt !== null && !this.sprintGestureConsumed && now - this.sprintPressedAt >= 250) {
      this.sprintToggled = !this.sprintToggled; this.sprintGestureConsumed = true;
    }
  }
  clear() { this.held.clear(); this.consumeEdges(); this.sprintPressedAt = null; this.sprintGestureConsumed = false; this.sprintToggled = false; }
  read(yaw, pitch, now = 0) {
    this.updateSprint(now);
    return { x: Number(this.down('right')) - Number(this.down('left')), z: Number(this.down('forward')) - Number(this.down('back')),
      jumpHeld: this.down('jump'), jumpPressed: this.pressed('jump'), jumpCrouch: this.jumpPosture,
      crouch: this.down('crouch'), crouchPressed: this.pressed('crouch'), sprint: this.sprintToggled, rollPressed: this.pressed('roll'),
      aim: this.down('aim'), aimPressed: this.pressed('aim'), interactPressed: this.pressed('interact'), slamPressed: this.pressed('slam'),
      meleePressed: this.pressed('melee'), meleeHeld: this.down('melee'), heavyPressed: this.pressed('heavy'), switchWeaponPressed: this.pressed('switchWeapon'),
      firePressed: this.pressed('fire'), fireHeld: this.down('fire'), reloadPressed: this.pressed('reload'), quickSwapPressed: this.pressed('quickSwap'),
      gunSlot: this.pressed('gun1') ? 0 : this.pressed('gun2') ? 1 : this.pressed('gun3') ? 2 : null,
      cycleGun: this.pressed('nextGun') ? 1 : this.pressed('prevGun') ? -1 : 0, yaw, pitch };
  }
}

export function mouseLook(yaw, pitch, dx, dy, sensitivity, multiplier = 1, invertY = false) {
  if (![dx, dy].every(Number.isFinite)) return { yaw, pitch };
  return { yaw: yaw - dx * sensitivity * multiplier,
    pitch: Math.max(-1.5, Math.min(1.5, pitch + dy * sensitivity * multiplier * (invertY ? 1 : -1))) };
}
