import * as THREE from 'three';
import { PoseBlender } from './motion-math.js';
import { sampleMeleePose } from './melee-pose.js';
import { WEAPONS } from './melee.js';

const keys=['x','y','z','rx','ry','rz'];
export function createMeleeVisual(scene, root, materials) {
  const { armor, secondary, suit, trim, energy }=materials;
  const models={staff:new THREE.Group(),sword:new THREE.Group()};
  for(const [kind,model]of Object.entries(models)){model.name='original practice '+kind;root.add(model);}
  function mesh(group,geometry,material,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;}
  function rod(group,length,radius,material,x){const m=mesh(group,new THREE.CylinderGeometry(radius,radius,length,12),material,x);m.rotation.z=Math.PI/2;return m;}
  rod(models.staff,2.28,.026,secondary,0);rod(models.staff,.56,.035,suit,0);
  for(const sign of [-1,1]){
    rod(models.staff,.28,.047,armor,sign*.95);rod(models.staff,.05,.055,trim,sign*1.08);
    rod(models.staff,.09,.035,energy,sign*.76);rod(models.staff,.045,.05,trim,sign*.32);
    for(let i=0;i<5;i++)rod(models.staff,.018,.039,trim,sign*(.06+i*.047));
    const cap=mesh(models.staff,new THREE.SphereGeometry(.042,12,8),armor,sign*1.15);cap.scale.set(1.5,1,1);
  }
  const blade=new THREE.Shape();
  [[-.035,.11],[-.067,.34],[-.052,.84],[.018,1.14],[.077,.89],[.058,.37],[.035,.11]].forEach(([x,y],i)=>i?blade.lineTo(x,y):blade.moveTo(x,y));blade.closePath();
  mesh(models.sword,new THREE.ExtrudeGeometry(blade,{depth:.022,bevelEnabled:true,bevelThickness:.007,bevelSize:.005,bevelSegments:1,steps:1}),armor,0,0,-.011);
  mesh(models.sword,new THREE.BoxGeometry(.014,.72,.03),energy,.012,.53,-.008);
  mesh(models.sword,new THREE.BoxGeometry(.28,.042,.065),trim,0,.075);
  mesh(models.sword,new THREE.CylinderGeometry(.033,.03,.19,10),suit,0,-.045);
  mesh(models.sword,new THREE.SphereGeometry(.04,10,8),trim,0,-.155);
  for(let i=0;i<4;i++)mesh(models.sword,new THREE.TorusGeometry(.033,.004,5,10),secondary,0,-.1+i*.036).rotation.x=Math.PI/2;

  const ribbonGeometry=new THREE.BufferGeometry();
  const vertices=new Float32Array(48*18),colors=new Float32Array(vertices.length);
  ribbonGeometry.setAttribute('position',new THREE.BufferAttribute(vertices,3).setUsage(THREE.DynamicDrawUsage));
  ribbonGeometry.setAttribute('color',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));
  const ribbon=new THREE.Mesh(ribbonGeometry,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.3,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
  ribbon.frustumCulled=false;ribbon.visible=false;scene.add(ribbon);
  const impactRing=new THREE.Mesh(new THREE.RingGeometry(.78,1,48),new THREE.MeshBasicMaterial({color:WEAPONS.staff.color,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));
  impactRing.rotation.x=-Math.PI/2;impactRing.visible=false;scene.add(impactRing);
  const samples=[],color=new THREE.Color();let elapsed=0,impactAge=2,lastImpact=-1,lastSerial=-1,resetSerial=-1;
  const poseBlender=new PoseBlender(keys,['rx','ry','rz']);
  const chest=new THREE.Vector3(),holster=new THREE.Vector3(),target=new THREE.Vector3();
  const chestQ=new THREE.Quaternion(),rigQ=new THREE.Quaternion(),holsterQ=new THREE.Quaternion(),targetQ=new THREE.Quaternion(),parentQ=new THREE.Quaternion();
  const euler=new THREE.Euler(0,0,0,'YXZ'),position=new THREE.Vector3(),quaternion=new THREE.Quaternion();
  const rightGrip=new THREE.Vector3(),leftGrip=new THREE.Vector3(),inner=new THREE.Vector3(),outer=new THREE.Vector3();
  function update(p,dt,torso,rig,weight){
    const melee=p.melee,kind=melee?.weapon||'staff',model=models[kind];
    if(resetSerial!==p.resetSerial){resetSerial=p.resetSerial;samples.length=0;poseBlender.initialized=false;lastSerial=-1;lastImpact=melee?.impactSerial??0;impactAge=2;}
    if(lastSerial!==melee?.serial){if(poseBlender.initialized)poseBlender.transition(.065);samples.length=0;lastSerial=melee?.serial;}
    const values=sampleMeleePose(melee,p.aiming).values;
    const pose=poseBlender.update(Object.fromEntries(keys.map((key,i)=>[key,values[i]])),dt);
    torso.getWorldPosition(chest);torso.getWorldQuaternion(chestQ);rig.getWorldQuaternion(rigQ);
    holster.set(kind==='staff'?-.07:.14,kind==='staff'?.06:-.21,.23).applyQuaternion(chestQ).add(chest);
    holsterQ.copy(chestQ).multiply(targetQ.setFromEuler(euler.set(0,0,kind==='staff'?1.08:-.43)));
    target.set(pose.x,pose.y,pose.z).applyQuaternion(rigQ).add(chest);
    targetQ.setFromEuler(euler.set(pose.rx,pose.ry,pose.rz)).premultiply(rigQ);
    position.copy(holster).lerp(target,weight);quaternion.copy(holsterQ).slerp(targetQ,weight);
    model.position.copy(position);root.worldToLocal(model.position);root.getWorldQuaternion(parentQ);model.quaternion.copy(parentQ).invert().multiply(quaternion);
    models.staff.visible=kind==='staff';models.sword.visible=kind==='sword';model.updateWorldMatrix(false,true);
    rightGrip.set(kind==='staff'?.22:0,kind==='staff'?0:-.025,0).applyQuaternion(quaternion).add(position);
    leftGrip.set(-.22,0,0).applyQuaternion(quaternion).add(position);
    if(dt>0){
      elapsed+=dt;
      if(melee?.striking && weight>.6){
        inner.set(kind==='staff'?-.96:0,kind==='staff'?0:.14,0).applyMatrix4(model.matrixWorld);
        outer.set(kind==='staff'?1.14:0,kind==='staff'?0:1.13,0).applyMatrix4(model.matrixWorld);
        samples.push({time:elapsed,a:inner.clone(),b:outer.clone()});
      }
      while(samples.length && (elapsed-samples[0].time>.16 || samples.length>48))samples.shift();
      let count=0;color.setHex(WEAPONS[kind].color);
      for(let i=1;i<samples.length;i++){
        const previous=samples[i-1],next=samples[i];
        for(const [point,time]of [[previous.a,previous.time],[previous.b,previous.time],[next.a,next.time],[next.a,next.time],[previous.b,previous.time],[next.b,next.time]]){
          vertices.set(point.toArray(),count);const fade=Math.max(0,1-(elapsed-time)/.16);colors.set([color.r*fade,color.g*fade,color.b*fade],count);count+=3;
        }
      }
      ribbonGeometry.setDrawRange(0,count/3);ribbonGeometry.attributes.position.needsUpdate=true;ribbonGeometry.attributes.color.needsUpdate=true;ribbon.visible=count>0;
      if(melee?.impactSerial!==lastImpact && melee?.impact){
        lastImpact=melee.impactSerial;impactAge=0;impactRing.position.set(melee.impact.x,melee.impact.y+.035,melee.impact.z);impactRing.material.color.setHex(WEAPONS[kind].color);
      }
      impactAge+=dt;impactRing.visible=impactAge<.5;
      if(impactRing.visible){const size=.2+impactAge*(melee?.impact?.heavy?8:5);impactRing.scale.setScalar(size);impactRing.material.opacity=.65*(1-impactAge/.5);}
    }
    return {rightGrip,leftGrip,quaternion,kind};
  }
  return {models,update,ribbon,impactRing,poseBlender};
}
