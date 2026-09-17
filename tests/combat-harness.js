// Opt-in browser acceptance. All actions pass through the game's real DOM
// handlers; deterministic fixtures only arrange targets and fatal damage.
export function install(api){
 const panel=document.createElement('aside');panel.style.cssText='position:fixed;z-index:100;right:15px;bottom:20px;width:340px;max-height:28vh;overflow:auto;background:#071726ed;padding:16px;border:1px solid #bda57d;font:12px/1.8 monospace;color:#cfe3ef';
 panel.innerHTML='<button id="run-combat-verification" style="padding:8px;background:#c8ae82;color:#172736">运行战斗验收</button><pre id="combat-verification-result" style="white-space:pre-wrap">等待运行</pre>';document.body.append(panel);
 const result=document.getElementById('combat-verification-result'),canvas=document.getElementById('game');
 const down=code=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));
 const up=code=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));
 const tap=code=>{down(code);up(code);};
 const mouse=(type,button)=>(type==='mousedown'?canvas:window).dispatchEvent(new MouseEvent(type,{button,bubbles:true}));
 const wait=async seconds=>{const end=api.player.clock+seconds,deadline=performance.now()+60000;while(api.player.clock+1e-7<end){if(performance.now()>deadline)throw Error('simulation timeout');await new Promise(requestAnimationFrame);}};
 let count=0;const check=(ok,label)=>{if(!ok)throw Error(label);result.textContent+=`\n✓ ${++count}. ${label}`;};
 document.getElementById('run-combat-verification').onclick=async()=>{
  count=0;result.textContent='运行中：枪械、Shift、机器人与改键';panel.style.pointerEvents='none';
  const {combat:c,player:p,keys}=api,savedBindings=keys.serialize(),savedTap=keys.tapSprintRoll,savedMode=c.mode,savedGun=c.selected;
  const savedStorage=Object.fromEntries(['bindings','gun','combatMode'].map(k=>[k,localStorage.getItem('kinetic.'+k)]));
  keys.resetBindings();keys.tapSprintRoll=true;api.updateBindingHints();api.teleport(0);c.resetPlayer();c.resetBots();
  try{
   document.getElementById('combat-button').click();
   check(document.querySelectorAll('[data-gun]').length===3&&document.querySelectorAll('[data-combat-mode]').length===3,'三把枪与三种机器人模式可选择');
   document.querySelector('[data-gun="0"]').click();document.querySelector('[data-combat-mode="targets"]').click();document.getElementById('practice-combat').click();await wait(.12);
   check(c.mode==='targets'&&document.getElementById('gun-name').textContent==='自动步枪','进入静态靶场，枪械 HUD 同步');
   down('KeyW');down('ShiftLeft');await new Promise(r=>setTimeout(r,300));await wait(.4);up('ShiftLeft');await wait(.2);
   check(keys.sprintToggled&&p.speed>12&&p.rollTimer===0,'长按 Shift 松开后仍保持奔跑，不误触翻滚');
   down('ShiftLeft');await new Promise(r=>setTimeout(r,300));await wait(.3);up('ShiftLeft');await wait(.3);
   check(!keys.sprintToggled&&p.speed<8,'再次长按 Shift 关闭奔跑');up('KeyW');tap('ShiftLeft');await wait(.05);
   check(p.rollTimer>0&&!keys.sprintToggled,'轻点 Shift 翻滚，不切换奔跑开关');
   api.teleport(0);await wait(.15);c.bots.forEach((b,i)=>{b.actor.reset({x:i?20+i*2:0,y:0,z:i?-10:18});b.alive=true;b.hp=100;});
   mouse('mousedown',2);await wait(.3);
   for(let i=0;i<4;i++){api.aimAt(c.bots[0].actor.position.clone().add({x:0,y:1.15,z:0}));await wait(.08);}
   mouse('mousedown',0);await wait(.10);mouse('mouseup',0);await wait(.08);
   check(c.magazine<30&&c.bots[0].hp<100&&c.hits>0,'实际瞄准与枪口射线命中机器人');
   check(Number(document.getElementById('ammo-current').textContent)===c.magazine,'射击弹药同步到 HUD');
   tap('KeyR');await wait(.2);check(c.reloadLeft>0&&document.getElementById('gun-status').textContent.includes('换弹'),'R 换弹启动并显示进度');
   await wait(1.4);check(c.magazine===30&&c.reloadLeft===0,'完整换弹补满弹匣');
   mouse('mousedown',0);await wait(.08);mouse('mouseup',0);const rifleAmmo=c.magazine;
   tap('Digit2');await wait(.3);check(c.selected===1&&api.character.firearm.models[1].visible,'数字 2 同时切换手枪逻辑与模型');
   const pistolShots=c.shots;mouse('mousedown',0);await wait(.5);mouse('mouseup',0);
   check(c.shots===pistolShots+1&&c.magazine===11,'手枪按住只发射一发');
   tap('KeyF');await wait(.3);check(c.selected===0&&c.magazine===rifleAmmo,'F 返回上一把枪并保留独立弹匣');
   tap('KeyR');await wait(.1);tap('Digit3');await wait(.3);
   check(c.selected===2&&c.reloadLeft===0&&c.ammo[0]===rifleAmmo,'切枪取消未完成换弹，不凭空补弹');
   mouse('mousedown',0);await wait(.08);mouse('mouseup',0);check(c.magazine===5,'霰弹枪射击消耗一枚弹药');
   canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}));await wait(.3);
   check(c.selected===0&&api.character.firearm.models[0].visible,'滚轮从霰弹枪循环切回步枪');mouse('mouseup',2);
   down('KeyE');await wait(.08);up('KeyE');check(!!p.melee.active,'枪械状态可直接衔接近战');
   mouse('mousedown',2);await wait(.08);check(!p.melee.drawn&&p.aiming,'重新瞄准收起近战并恢复持枪');mouse('mouseup',2);
   api.teleport(0);await wait(.1);down('KeyC');tap('Space');await wait(.08);up('KeyC');
   check(p.bulletUsed&&p.bulletTimer>0,'射击链先进入真实子弹跳');
   mouse('mousedown',0);await wait(.08);mouse('mouseup',0);
   check(p.bulletTimer===0&&p.bulletUsed&&!p.doubleUsed&&c.magazine<30,'射击可收起旋转且不刷新跳跃资源');
   api.teleport(0);await wait(.1);document.getElementById('menu-button').click();document.getElementById('bindings-button').click();
   document.getElementById('bind-fire-0').click();tap('KeyJ');
   check(keys.bindings.fire[0]==='KeyJ'&&JSON.parse(localStorage.getItem('kinetic.bindings')).fire[0]==='KeyJ','射击键可以改绑并保存');
   document.getElementById('close-modal').click();document.getElementById('start').click();await wait(.1);const before=c.shots;
   mouse('mousedown',0);await wait(.08);mouse('mouseup',0);check(c.shots===before,'改绑后旧鼠标左键不再射击');
   tap('KeyJ');await wait(.08);check(c.shots===before+1,'改绑后的 J 通过真实输入射击');
   c.setMode('battle');c.resetBots();await wait(2.2);check(c.bots.some(b=>b.state!=='patrol')&&c.bots.some(b=>b.actor.speed>0),'机器人在实际渲染循环中索敌与移动');
   c.spawnProtection=0;c.damagePlayer(1000);await wait(.12);
   check(!c.alive&&!document.getElementById('down-screen').classList.contains('hidden'),'生命耗尽后显示重新部署倒计时');
   await wait(2.5);check(c.alive&&c.health===100&&c.shield===80,'倒计时后回到起点并恢复');
   document.getElementById('menu-button').click();check(!keys.sprintToggled&&keys.held.size===0,'暂停清除持续输入与奔跑开关');
   result.textContent+=`\n\nPASS ${count} / ${count}`;
  }catch(error){result.textContent+=`\n\nFAIL ${error.stack}\n${JSON.stringify(api.snapshot(),null,2)}`;document.getElementById('menu-button').click();}
  finally{
   keys.load(savedBindings);keys.tapSprintRoll=savedTap;api.updateBindingHints();c.setMode(savedMode);c.selected=savedGun;c.resetBots();c.resetPlayer();api.teleport(0);
   for(const [k,v] of Object.entries(savedStorage))if(v===null)localStorage.removeItem('kinetic.'+k);else localStorage.setItem('kinetic.'+k,v);
   panel.style.pointerEvents='auto';
  }
 };
}
