// Opt-in dev acceptance runner. Uses the actual DOM keyboard/mouse handlers and
// requestAnimationFrame loop; it is excluded from production builds by Vite.
export function install(api) {
  const panel = document.createElement('aside');
  panel.style.cssText = 'position:fixed;z-index:100;right:15px;bottom:20px;width:340px;max-height:28vh;overflow:auto;background:#071726ed;padding:16px;border:1px solid #bda57d;font:12px/1.8 monospace;color:#cfe3ef';
  panel.innerHTML = '<button id="run-verification" style="padding:8px;background:#c8ae82;color:#172736">运行浏览器验收</button><pre id="verification-result" style="white-space:pre-wrap;margin:10px 0 0">等待运行</pre>';
  document.body.append(panel);
  const result = document.getElementById('verification-result');
  const down = code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = code => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  const mouse = (type, button) => (type === 'mousedown' ? document.getElementById('game') : window).dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
  const wait = async seconds => {
    const end = api.player.clock + seconds, timeout = performance.now() + 60000;
    // Clock sums can differ by a few ulps. Do not wait a whole extra render
    // frame after the intended physics time (up to 50 ms in a throttled tab).
    while (api.player.clock + 1e-7 < end) {
      if (performance.now() > timeout) throw Error('simulation paused or timed out');
      await new Promise(requestAnimationFrame);
    }
  };
  let count = 0;
  const check = (condition, label) => { if (!condition) throw Error(label); count++; result.textContent += `\n✓ ${label}`; };
  document.getElementById('run-verification').onclick = async () => {
    result.textContent = '运行中：真实 WebGL + 输入事件 + 固定步长'; count = 0;
    panel.style.pointerEvents = 'none';
    const savedBindings = api.keys.serialize(), savedTapRoll = api.keys.tapSprintRoll;
    const savedStorage = localStorage.getItem('kinetic.bindings'), savedShoulder = localStorage.getItem('kinetic.shoulder');
    const savedWeapon = api.player.melee.weapon, savedWeaponStorage = localStorage.getItem('kinetic.meleeWeapon'),savedMode=api.combat.mode;
    api.combat.setMode('off');
    api.keys.resetBindings(); api.keys.tapSprintRoll = true; api.updateBindingHints();
    try {
      document.getElementById('start').click(); await wait(.08);
      check(api.snapshot().active && api.snapshot().calls > 20, '3D 渲染与进入训练');
      const beforeLook = api.snapshot();
      document.getElementById('game').dispatchEvent(new MouseEvent('mousemove', { movementX: 80, movementY: -30, bubbles: true }));
      await wait(.04);
      check(api.snapshot().yaw < beforeLook.yaw && api.snapshot().pitch > beforeLook.pitch && !api.keys.held.has('Mouse0'), '不按鼠标左键也能直接转动水平和垂直视角');
      api.look(0, -.14);
      down('KeyV'); up('KeyV'); await wait(.04);
      check(api.snapshot().shoulderSide === -beforeLook.shoulderSide, 'V 切换镜头肩侧');
      down('KeyV'); up('KeyV');
      down('KeyW'); down('ShiftLeft'); await wait(.65);
      check(api.player.speed > 12, 'W + Shift 冲刺');
      const runningPose = api.snapshot().animation;
      check(runningPose.state === 'sprint' && runningPose.phase > .1 && runningPose.pose.leftKneeX < 0 && runningPose.pose.rightKneeX < 0, '真实骨架步频与膝关节方向');
      down('KeyC'); await wait(.08); check(api.player.state === 'slide', 'C 滑铲');
      down('Space'); await wait(.08); up('Space'); up('KeyC');
      check(api.player.bulletUsed && api.player.position.y > .5, 'C + 空格子弹跳');
      mouse('mousedown', 2); await wait(.05);
      check(api.player.state === 'glide' && api.player.lastCancel === 'bullet' && api.player.bulletTimer === 0, '右键点按立即终止子弹跳旋转');
      mouse('mouseup', 2); await wait(.04);
      check(api.player.state !== 'bullet' && api.player.bulletUsed && !api.player.doubleUsed, '松开瞄准不会恢复旧旋转或刷新跳跃次数');
      down('Space'); await wait(.08); up('Space');
      check(api.player.doubleUsed && api.player.velocity.y > 6, '子弹跳接二段跳');
      mouse('mousedown', 2); await wait(.04);
      check(api.player.lastCancel === 'double' && api.player.doubleTimer === 0, '右键取消二段跳翻身');
      down('KeyQ'); await wait(.08); up('KeyQ'); check(api.player.airRollUsed, '二段跳接空中翻滚');
      check(api.player.state === 'airRoll', '保持瞄准时新的翻滚指令优先');
      await wait(.4);
      check(api.player.state === 'glide', '翻滚结束自动接回保持中的瞄准滑翔'); mouse('mouseup', 2); up('KeyW'); up('ShiftLeft');
      check(Object.values(api.snapshot().animation.pose).every(Number.isFinite), '连续空中切换后动画有效');
      api.teleport(1); down('KeyW'); down('ShiftLeft'); await wait(.42); down('KeyC'); await wait(.30);
      check(api.player.position.z < 12 && api.player.position.z > 5.8 && api.player.height < 1, '进入地图低矮通道');
      up('KeyC'); await wait(.08); check(api.player.height < 1, '通道内不会穿顶站起');
      down('KeyC'); await wait(.70); up('KeyC'); await wait(.08);
      check(api.player.position.z < 5.18 && api.player.height > 1, '滑铲穿出通道后恢复站立'); up('KeyW'); up('ShiftLeft');
      api.teleport(2); down('KeyW'); down('Space'); await wait(.85);
      check(api.player.state === 'wallClimb' && api.player.position.y > 3, '真实墙面连续纵向蹬墙');
      up('Space'); mouse('mousedown', 2); await wait(.18);
      check(api.player.state === 'latch', '壁面攀附');
      down('Space'); await wait(.07); up('Space'); mouse('mouseup', 2); up('KeyW');
      check(api.player.velocity.x < -5, '攀附后蹬墙跳离');
      api.teleport(4); down('KeyX'); await wait(.08); up('KeyX'); check(!!api.player.rope, 'X 上绳');
      down('KeyW'); await wait(.4); up('KeyW'); check(api.player.position.x > -16, '绳索上沿线移动');
      down('KeyW'); down('Space'); await wait(.16); up('Space'); up('KeyW');
      check(!api.player.rope && api.player.velocity.y > 5, '空格跳离绳索');
      down('KeyG'); await wait(.08); up('KeyG'); check(api.player.velocity.y < -30, 'G 直接俯冲落地');
      down('KeyQ'); await wait(.08); up('KeyQ'); check(!api.player.slam, '翻滚取消俯冲');
      down('Backspace'); await wait(.08); up('Backspace'); check(Math.abs(api.player.position.x + 18) < .1, 'Backspace 复位当前检查点');
      api.teleport(0); api.startRoute(); await wait(.1); down('KeyW'); down('ShiftLeft'); await wait(.8); up('KeyW'); up('ShiftLeft');
      check(api.snapshot().route.index >= 1, '计时路线真实穿环计数');
      down('KeyH'); up('KeyH'); await new Promise(requestAnimationFrame);
      check(!document.getElementById('modal').classList.contains('hidden') && !api.snapshot().active, 'H 操作指南暂停游戏');
      check(document.querySelectorAll('.checklist .done').length >= 10, '已体验动作清单同步');
      const pausedPose = JSON.stringify(api.snapshot().animation.pose);
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      check(JSON.stringify(api.snapshot().animation.pose) === pausedPose, '暂停后关节姿态保持不动');

      document.getElementById('close-modal').click(); api.teleport(0);
      document.getElementById('melee-button').click();
      check(document.querySelectorAll('[data-weapon]').length === 2 && document.querySelectorAll('#modal-content .control-row').length === 8, '武器选择面板列出两类武器与八类基础动作');
      document.querySelector('[data-weapon="staff"]').click(); document.getElementById('practice-melee').click(); await wait(.10);
      down('KeyE'); await wait(.06);
      check(api.player.melee.active?.branch === 'neutral' && api.player.melee.weapon === 'staff', 'E 挥动双手棍杖');
      await wait(.44); check(api.player.melee.active?.index === 1, '保持攻击自动接入第二段');
      await wait(.46); check(api.player.melee.active?.index === 2, '三段连击使用独立的末段动作'); up('KeyE');
      down('KeyQ'); await wait(.06); up('KeyQ');
      check(!api.player.melee.active && api.player.state === 'roll', '翻滚立即中断近战'); await wait(.55);
      api.teleport(0); down('KeyZ'); await wait(.06); up('KeyZ');
      check(api.player.melee.weapon === 'sword' && document.getElementById('melee-weapon').textContent === '单手剑', 'Z 切换单手剑且 HUD 同步');
      down('KeyE'); await wait(.06); up('KeyE');
      check(api.player.melee.active?.move.name === '斜斩', '单手剑使用自身的斜斩动作');
      mouse('mousedown', 2); await wait(.06);
      check(!api.player.melee.active && !api.player.melee.drawn && api.player.aiming, '重新瞄准可退出近战并回到持枪'); mouse('mouseup', 2);
      mouse('mousedown', 2); down('KeyW'); down('KeyE'); await wait(.28);
      check(api.player.melee.active?.branch === 'forwardTactical' && api.player.position.z < 26, '前进 + 瞄准 + 攻击选择突进连段并产生位移');
      up('KeyE'); up('KeyW'); mouse('mouseup', 2); down('KeyQ'); await wait(.55); up('KeyQ');
      api.teleport(0); down('KeyW'); down('ShiftLeft'); await wait(.55); down('KeyC'); await wait(.07); down('KeyE'); await wait(.06);
      check(api.player.melee.active?.branch === 'slide' && api.player.speed > 10, '滑铲接旋斩保留移动惯性'); up('KeyE'); up('KeyC'); up('KeyW'); up('ShiftLeft');
      api.teleport(0); await wait(.10); down('Space'); await wait(.18); up('Space'); down('KeyE'); await wait(.08); up('KeyE');
      check(api.player.melee.active?.branch === 'aerial' && !api.player.grounded, '跳跃接空中挥剑');
      mouse('mousedown', 2); await wait(.06);
      check(!api.player.melee.active && api.player.state === 'glide' && !api.player.doubleUsed, '空中近战转滑翔不消耗或恢复第二跳'); mouse('mouseup', 2);
      const previousImpacts = api.player.melee.impactSerial;
      mouse('mousedown', 1); await wait(.03); mouse('mouseup', 1);
      check(api.player.melee.active?.branch === 'slam' && api.player.melee.active.heavy, '空中重击转换为武器重型下砸'); await wait(.65);
      check(api.player.melee.impactSerial === previousImpacts + 1 && api.player.grounded, '重型下砸只在真实地面碰撞后产生着地反馈');
      api.teleport(0); await wait(.1); mouse('mousedown', 1); await wait(.08); mouse('mouseup', 1);
      check(api.player.melee.active?.branch === 'heavy', '地面鼠标中键发动蓄力重击'); await wait(1.1);
      check(!api.player.melee.active, '一次重击完成后正常收招');
      document.getElementById('menu-button').click();
      document.getElementById('bindings-button').click();
      document.getElementById('bind-jump-0').click(); down('KeyF'); up('KeyF');
      check(document.getElementById('bind-jump-0').textContent === 'F' && api.keys.bindings.jump[0] === 'KeyF', '改键界面录入新的跳跃键');
      check(JSON.parse(localStorage.getItem('kinetic.bindings')).jump[0] === 'KeyF' && document.querySelector('[data-keys="jump"]').textContent === 'F', '改键保存到浏览器且 HUD 提示同步');
      document.getElementById('bind-aim-0').click(); mouse('mousedown', 1); mouse('mouseup', 1);
      check(api.keys.bindings.aim[0] === 'Mouse1' && document.getElementById('bind-aim-0').textContent === '鼠标中键', '改键支持鼠标按钮');
      document.getElementById('bind-melee-0').click(); down('KeyJ'); up('KeyJ');
      check(api.keys.bindings.melee[0] === 'KeyJ', '近战动作也使用统一改键面板');
      document.getElementById('close-modal').click();
      document.getElementById('start').click(); await wait(.10);
      down('Space'); await wait(.08); up('Space');
      check(api.player.grounded && api.player.position.y < .03, '改键后旧空格不再触发跳跃');
      down('KeyE'); await wait(.08); up('KeyE'); check(!api.player.melee.active, '改键后旧 E 不再触发近战');
      down('KeyJ'); await wait(.08); up('KeyJ'); check(!!api.player.melee.active, '自定义 J 通过实际输入触发近战');
      down('KeyQ'); await wait(.60); up('KeyQ');
      down('KeyF'); await wait(.12); up('KeyF');
      check(!api.player.grounded && api.player.velocity.y > 5, '新 F 按键通过实际输入驱动跳跃');
      mouse('mousedown', 1); await wait(.06);
      check(api.player.state === 'glide', '新鼠标中键通过实际输入驱动滑翔'); mouse('mouseup', 1);
      document.getElementById('menu-button').click(); document.getElementById('bindings-button').click();
      document.getElementById('bind-jump-0').click(); down('KeyQ'); up('KeyQ');
      check(api.keys.bindings.jump[0] === 'KeyQ' && api.keys.bindings.roll[0] === 'KeyF', '主键冲突互换，保留所有动作入口');
      result.textContent += `\n\nPASS ${count} / ${count}`;
      document.getElementById('close-modal').click(); api.teleport(0);
    } catch (error) {
      result.textContent += `\n\nFAIL: ${error.stack}\n${JSON.stringify({ ...api.snapshot(), height: api.player.height, held: [...api.keys.held] }, null, 2)}`;
      document.getElementById('menu-button').click();
    }
    finally {
      api.keys.load(savedBindings); api.keys.tapSprintRoll = savedTapRoll; api.updateBindingHints();
      if (savedStorage === null) localStorage.removeItem('kinetic.bindings'); else localStorage.setItem('kinetic.bindings', savedStorage);
      if (savedShoulder === null) localStorage.removeItem('kinetic.shoulder'); else localStorage.setItem('kinetic.shoulder', savedShoulder);
      api.player.melee.selectWeapon(savedWeapon); api.player.melee.reset();
      api.combat.setMode(savedMode);
      if (savedWeaponStorage === null) localStorage.removeItem('kinetic.meleeWeapon'); else localStorage.setItem('kinetic.meleeWeapon', savedWeaponStorage);
      panel.style.pointerEvents = 'auto';
    }
  };
}
