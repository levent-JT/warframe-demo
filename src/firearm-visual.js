import * as THREE from 'three';
import { GUNS } from './combat.js';

export function createFirearmVisual(root, materials) {
  const {armor,secondary,suit,trim,energy}=materials;
  const weapon=new THREE.Group();weapon.name='AUREL training firearm';root.add(weapon);
  const cube=new THREE.BoxGeometry(1,1,1),models=[],magazines=[],muzzles=[];
  function box(parent,mat,x,y,z,w,h,d){const m=new THREE.Mesh(cube,mat);m.position.set(x,y,z);m.scale.set(w,h,d);m.castShadow=true;parent.add(m);return m;}
  function tube(parent,mat,x,y,z,r,length){const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,length,12),mat);m.rotation.x=Math.PI/2;m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;}
  for(let i=0;i<3;i++){
    const model=new THREE.Group();model.name=GUNS[i].id;weapon.add(model);models.push(model);
    const glow=new THREE.MeshBasicMaterial({color:GUNS[i].color});
    const magazine=new THREE.Group();model.add(magazine);magazines.push(magazine);
    box(model,suit,0,-.083,.048,.06,.15,.057).rotation.x=-.15;
    box(model,trim,0,-.135,.038,.064,.022,.075);
    if(i===1){
      box(model,secondary,0,.018,-.10,.09,.095,.31);box(model,armor,0,.058,-.095,.096,.042,.34);
      tube(model,suit,0,.017,-.278,.024,.09);box(model,suit,0,.09,.008,.018,.017,.029);box(model,glow,0,.09,-.217,.019,.014,.016);
      box(magazine,suit,0,-.112,.04,.045,.135,.04);box(magazine,trim,0,-.18,.043,.06,.016,.055);
      for(const x of [-.049,.049])box(model,glow,x,.02,-.11,.005,.012,.12);
      muzzles.push(new THREE.Vector3(0,.017,-.33));
    }else if(i===2){
      box(model,secondary,0,.005,-.18,.125,.13,.43);box(model,armor,0,.078,-.22,.11,.035,.47);
      tube(model,suit,0,.016,-.55,.036,.38);tube(model,secondary,0,-.046,-.49,.029,.30);
      box(model,suit,0,.012,.19,.093,.098,.25);box(model,armor,0,.01,.32,.12,.17,.045);
      box(model,suit,0,-.025,-.28,.134,.10,.18);
      for(let n=0;n<5;n++)box(model,trim,0,.029,-.36+n*.036,.14,.012,.015);
      box(magazine,secondary,0,-.12,-.12,.09,.17,.12);
      for(const x of [-.069,.069])for(let n=0;n<4;n++)tube(model,trim,x,-.002,-.22+n*.055,.013,.042);
      box(model,glow,.067,.022,-.18,.01,.022,.16);muzzles.push(new THREE.Vector3(0,.016,-.76));
    }else{
      box(model,suit,0,0,-.15,.095,.105,.40);box(model,secondary,0,-.015,-.18,.12,.065,.32);
      box(model,armor,0,.057,-.16,.083,.02,.33);box(model,suit,0,.008,.15,.079,.095,.22);box(model,armor,0,.004,.26,.095,.13,.035);
      tube(model,suit,0,.009,-.46,.024,.29);tube(model,trim,0,.009,-.603,.03,.044);
      box(magazine,secondary,0,-.105,-.13,.073,.16,.075).rotation.x=.12;
      box(model,glow,.054,.009,-.19,.007,.012,.19);
      for(let n=0;n<5;n++)box(model,suit,0,.075,-.26+n*.052,.081,.009,.028);
      box(model,suit,0,.085,-.08,.04,.038,.055);muzzles.push(new THREE.Vector3(0,.009,-.65));
    }
  }
  const flash=new THREE.Group();weapon.add(flash);
  const flashMat=new THREE.MeshBasicMaterial({color:0xdffff4,transparent:true,opacity:.8,depthWrite:false,blending:THREE.AdditiveBlending});
  for(const angle of [0,Math.PI/2]){const blade=new THREE.Mesh(new THREE.PlaneGeometry(.16,.23),flashMat);blade.rotation.set(Math.PI/2,0,angle);flash.add(blade);}
  const muzzle=new THREE.Vector3(),rightGrip=new THREE.Vector3(),leftGrip=new THREE.Vector3();
  let selected=0;
  function update(p,time){
    selected=p.combat?.swapLeft>.11?p.combat.previousGun:p.combat?.selected??0;
    models.forEach((model,index)=>{model.visible=index===selected;});
    const c=p.combat,progress=c?.reloadProgress||0,reach=Math.sin(Math.PI*Math.min(1,progress/.82));
    for(let i=0;i<3;i++){magazines[i].position.y=i===selected?-.22*reach:0;magazines[i].rotation.z=i===selected?.22*reach:0;}
    rightGrip.set(0,-.085,.048);
    if(selected===1)leftGrip.set(-.025,-.064,.015);else leftGrip.set(0,-.04,selected===2?-.28:-.27);
    if(c?.reloadLeft>0){
      const magPoint=selected===1?new THREE.Vector3(0,-.10,.04):new THREE.Vector3(0,-.10,-.13);
      magPoint.y-=.22*reach;
      leftGrip.lerp(magPoint,Math.sin(Math.PI*progress)**.55);
    }
    flash.position.copy(muzzles[selected]);flash.visible=!!c?.shotFlash&&!p.melee.drawn;
    const scale=c?.selected===2?1.7:1;flash.scale.setScalar(scale*(1+Math.sin(time*81)*.15));flash.rotation.z=time*51;
    weapon.updateWorldMatrix(true,true);muzzle.copy(muzzles[selected]).applyMatrix4(weapon.matrixWorld);
    return {rightGrip,leftGrip,muzzle};
  }
  return {weapon,models,muzzles,magazines,muzzle,update};
}
