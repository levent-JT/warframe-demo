// Opt-in integration checks: real DOM input, real animation loop and current
// shot sampling. Fixtures arrange touchdown/cooldown and side-facing targets.
export function install(api) {
  const panel=document.createElement('aside');
  panel.style.cssText='position:fixed;z-index:100;right:15px;bottom:20px;width:340px;max-height:30vh;overflow:auto;background:#071726ed;padding:16px;border:1px solid #bda57d;font:12px/1.8 monospace;color:#cfe3ef';
  panel.innerHTML='<button id="run-response-verification">运行响应验收</button><pre id="response-result" style="white-space:pre-wrap">等待运行</pre>';document.body.append(panel);
  const result=document.getElementById('response-result'),canvas=document.getElementById('game');
  const down=code=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));
  const up=code=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));
  const tap=code=>{down(code);up(code);};
  const mouse=(type,button)=>(type==='mousedown'?canvas:window).dispatchEvent(new MouseEvent(type,{button,bubbles:true}));
  const wait=async seconds=>{const end=api.player.clock+seconds,deadline=performance.now()+60000;while(api.player.clock+1e-7<end){if(performance.now()>deadline)throw Error('simulation timeout');await new Promise(requestAnimationFrame);}};
  document.getElementById('run-response-verification').onclick=async()=>{
    const {player:p,combat:c,keys}=api,saved=keys.serialize(),mode=c.mode,gun=c.selected,tapRoll=keys.tapSprintRoll;
    let count=0;const check=(ok,label)=>{if(!ok)throw Error(label);result.textContent+=`\n✓ ${++count}. ${label}`;};
    keys.resetBindings();keys.tapSprintRoll=true;c.setMode('off');api.teleport(0);api.updateBindingHints();
    panel.style.pointerEvents='none';result.textContent='运行中：起停、输入缓冲、瞬时转向射击';
    try{
      document.getElementById('start').click();await wait(.1);
      keys.sprintToggled=true;down('KeyW');await wait(.16);
      check(p.speed>12.4,'真实输入 160 ms 内达到奔跑速度');
      up('KeyW');const stoppedAt=p.position.clone();await wait(.13);
      check(p.speed<.01&&p.position.distanceTo(stoppedAt)<.75,'松键及时刹停，滑行距离小于 0.75 m');
      down('KeyW');await wait(.20);up('KeyW');down('KeyS');await wait(.20);
      check(p.velocity.z>9,'反向输入 200 ms 内建立反向速度');up('KeyS');
      api.teleport(0);await wait(.1);p.rollCooldown=.08;down('KeyD');tap('KeyQ');up('KeyD');await wait(.11);
      check(p.rollTimer>0&&p.velocity.x>17,'冷却结束自动执行提前点按的右翻滚');
      api.teleport(0);await wait(.1);p.position.y=.35;p.velocity.y=-8;p.grounded=false;p.coyote=0;p.airRollUsed=true;
      tap('KeyQ');await wait(.09);check(p.rollTimer>0&&p.hardLandTimer===0,'耗尽空中翻滚后，可提前输入衔接着地翻滚');
      api.teleport(0);c.setMode('targets');c.selected=0;await wait(.2);mouse('mousedown',2);await wait(.5);
      for(const yaw of [Math.PI/2,-Math.PI/2]){
        c.cooldown=0;c.recoil=0;c.bots.forEach((b,i)=>{b.hp=100;b.alive=true;b.actor.reset({x:i?20+i*2: yaw>0?-8:8,y:0,z:i?-10:p.position.z-Math.sin(yaw)*.65*api.snapshot().shoulderSide});});
        api.look(yaw,0);mouse('mousedown',0);await wait(.035);mouse('mouseup',0);
        check(c.bots[0].hp<100,`${yaw>0?'90':'180'} 度转视角同帧开火命中新方向目标`);
      }
      mouse('mouseup',2);api.teleport(0);await wait(.1);p.rollCooldown=.08;tap('KeyQ');await wait(.025);
      document.getElementById('menu-button').click();check(p.rollBuffer===0&&p.jumpBuffer===0,'暂停清空未执行动作，恢复时不误翻滚');
      document.getElementById('tuning-button').click();
      check(['acceleration','braking','turnAcceleration'].every(name=>document.querySelector(`[data-setting="${name}"]`)),'起步、制动与转向响应可独立调节');
      document.getElementById('close-modal').click();
      result.textContent+=`\n\nPASS ${count} / ${count}`;
    }catch(error){result.textContent+=`\n\nFAIL ${error.stack}\n${JSON.stringify(api.snapshot(),null,2)}`;if(api.snapshot().active)document.getElementById('menu-button').click();}
    finally{keys.load(saved);keys.tapSprintRoll=tapRoll;c.setMode(mode);c.selected=gun;c.resetBots();c.resetPlayer();api.teleport(0);api.updateBindingHints();panel.style.pointerEvents='auto';}
  };
}
