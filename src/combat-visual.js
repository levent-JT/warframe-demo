import * as THREE from 'three';
import { GUNS } from './combat.js';

export function createCombatVisual(scene,combat) {
  const armor=new THREE.MeshStandardMaterial({color:0x8997a2,metalness:.68,roughness:.43});
  const dark=new THREE.MeshStandardMaterial({color:0x25313c,metalness:.5,roughness:.65});
  const orange=new THREE.MeshStandardMaterial({color:0xce714a,metalness:.45,roughness:.5});
  const cube=new THREE.BoxGeometry(1,1,1),cylinder=new THREE.CylinderGeometry(1,1,1,10),sphere=new THREE.SphereGeometry(1,12,8);
  function part(parent,geometry,material,position,scale){const m=new THREE.Mesh(geometry,material);m.position.set(...position);m.scale.set(...scale);m.castShadow=true;parent.add(m);return m;}
  const robots=combat.bots.map(bot=>{
    const root=new THREE.Group(),body=new THREE.Group();root.add(body);scene.add(root);
    const glow=new THREE.MeshBasicMaterial({color:0xff9160}),head=new THREE.Group();head.position.y=1.62;body.add(head);
    part(head,cube,armor,[0,0,0],[.29,.28,.27]);part(head,cube,dark,[0,-.015,-.15],[.28,.12,.04]);
    part(head,sphere,glow,[0,.005,-.181],[.075,.045,.013]);part(head,cube,orange,[0,.16,.015],[.14,.025,.19]);
    part(body,cube,dark,[0,1.22,0],[.40,.49,.24]);
    const chest=part(body,cube,armor,[0,1.3,-.04],[.49,.25,.25]);chest.rotation.z=.02;
    part(body,cube,orange,[0,1.25,-.173],[.22,.12,.05]);part(body,cube,glow,[0,1.25,-.204],[.11,.017,.009]);
    part(body,cube,armor,[0,.98,.015],[.36,.11,.27]);part(body,cube,dark,[0,.87,0],[.28,.12,.19]);
    const legs=[],arms=[];
    for(const sign of [-1,1]){
      const leg=new THREE.Group();leg.position.set(sign*.15,.9,0);body.add(leg);legs.push(leg);
      part(leg,cylinder,dark,[0,-.19,0],[.065,.37,.065]);part(leg,cube,armor,[0,-.19,-.015],[.13,.28,.15]);
      part(leg,sphere,orange,[0,-.39,0],[.078,.07,.072]);
      const shin=new THREE.Group();shin.position.y=-.39;leg.add(shin);leg.userData.shin=shin;
      part(shin,cube,armor,[0,-.18,-.018],[.125,.31,.14]);part(shin,cube,dark,[0,-.425,-.068],[.17,.075,.30]);
      const arm=new THREE.Group();arm.position.set(sign*.31,1.39,0);body.add(arm);arms.push(arm);
      part(arm,cube,orange,[0,-.04,0],[.17,.17,.22]);part(arm,cylinder,dark,[0,-.21,0],[.053,.3,.053]);
      const forearm=new THREE.Group();forearm.position.y=-.30;arm.add(forearm);arm.userData.forearm=forearm;
      part(forearm,cube,armor,[0,-.13,0],[.12,.24,.14]);
    }
    const gun=new THREE.Group();gun.position.set(.18,1.22,-.22);body.add(gun);
    part(gun,cube,dark,[0,0,-.18],[.095,.10,.4]);part(gun,cube,orange,[0,.05,-.11],[.08,.027,.29]);
    const barrel=part(gun,cylinder,armor,[0,.015,-.44],[.025,.19,.025]);barrel.rotation.x=Math.PI/2;
    const bar=new THREE.Group();bar.position.y=2.13;root.add(bar);
    const barBack=part(bar,cube,dark,[0,0,0],[.74,.04,.01]);barBack.castShadow=false;
    const health=part(bar,cube,glow,[0,0,.012],[.72,.025,.014]);health.castShadow=false;
    const ring=new THREE.Mesh(new THREE.RingGeometry(.4,.44,28),new THREE.MeshBasicMaterial({color:0xe38c5b,transparent:true,opacity:.38,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.03;root.add(ring);
    return {root,body,head,legs,arms,gun,bar,health,glow,ring};
  });
  const lineGeometry=new THREE.BufferGeometry(),linePositions=new Float32Array(192*6),lineColors=new Float32Array(192*6);
  lineGeometry.setAttribute('position',new THREE.BufferAttribute(linePositions,3));lineGeometry.setAttribute('color',new THREE.BufferAttribute(lineColors,3));
  const lines=new THREE.LineSegments(lineGeometry,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.85,depthWrite:false,blending:THREE.AdditiveBlending}));lines.frustumCulled=false;scene.add(lines);
  const trails=[],bursts=[],color=new THREE.Color();
  for(let i=0;i<24;i++){
    const m=new THREE.Mesh(new THREE.IcosahedronGeometry(.08,0),new THREE.MeshBasicMaterial({color:0xa2fff1,transparent:true,depthWrite:false}));m.visible=false;scene.add(m);bursts.push({mesh:m,life:0});
  }
  let cursor=0;
  function event(e){
    if(e.type==='tracer')trails.push({...e,life:.075});
    if(e.type==='hit'||e.type==='kill'){
      const burst=bursts[cursor++%bursts.length];burst.life=e.type==='kill'?.55:.18;burst.total=burst.life;burst.large=e.type==='kill';
      burst.mesh.position.copy(e.position).add(new THREE.Vector3(0,e.type==='kill'?.8:0,0));burst.mesh.material.color.setHex(e.head?0xffd485:0x9bfff1);burst.mesh.visible=true;
    }
  }
  function update(dt,camera){
    combat.bots.forEach((bot,i)=>{
      const r=robots[i],p=bot.actor.position;r.root.visible=combat.mode!=='off';r.root.position.copy(p);r.body.rotation.y=bot.yaw;
      const dead=!bot.alive;r.body.rotation.x=dead?-Math.PI/2:Math.sin(bot.hitFlash*30)*.08;r.body.position.y=dead?.20:0;
      r.body.visible=!dead||bot.respawn>4.7;r.bar.visible=!dead;r.ring.visible=!dead;
      const speed=bot.actor.speed,phase=bot.actor.clock*8.5,walk=Math.min(1,speed/3.2);
      r.legs.forEach((leg,j)=>{leg.rotation.x=Math.sin(phase+j*Math.PI)*.42*walk;leg.userData.shin.rotation.x=-.18-Math.max(0,-Math.sin(phase+j*Math.PI))*.55*walk;});
      r.arms[0].rotation.set(.82,0,-.18);r.arms[1].rotation.set(1.0,0,.12);
      r.arms.forEach(arm=>arm.userData.forearm.rotation.x=1.15);
      r.head.rotation.x=Math.sin(combat.clock*.7+bot.id)*.035;
      r.glow.color.setHex(bot.hitFlash>0?0xffffff:bot.charge>0?0xff492d:combat.mode==='targets'?0x8dfff0:0xffad75);
      r.health.scale.x=.72*bot.hp/100;r.health.position.x=-.36*(1-bot.hp/100);r.bar.quaternion.copy(camera.quaternion);
    });
    for(const trail of trails)trail.life-=dt;while(trails.length&&trails[0].life<=0)trails.shift();
    let offset=0;
    const segment=(from,to,hex,fade=1)=>{if(offset+6>linePositions.length)return;color.setHex(hex).multiplyScalar(fade);linePositions.set(from.toArray(),offset);linePositions.set(to.toArray(),offset+3);lineColors.set(color.toArray(),offset);lineColors.set(color.toArray(),offset+3);offset+=6;};
    for(const t of trails)segment(t.from,t.to,t.color,Math.max(0,t.life/.075));
    for(const shot of combat.projectiles)segment(shot.position,shot.position.clone().addScaledVector(shot.velocity,-.035),0xff633d);
    lineGeometry.setDrawRange(0,offset/3);lineGeometry.attributes.position.needsUpdate=true;lineGeometry.attributes.color.needsUpdate=true;lines.visible=offset>0;
    for(const burst of bursts)if(burst.life>0){burst.life=Math.max(0,burst.life-dt);const t=1-burst.life/burst.total;burst.mesh.visible=burst.life>0;burst.mesh.scale.setScalar((burst.large?5:1)*(1+t*3));burst.mesh.material.opacity=1-t;burst.mesh.rotation.y+=dt*5;}
  }
  return {robots,event,update};
}
