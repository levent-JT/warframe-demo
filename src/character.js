import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CharacterAnimator, JOINTS } from './animation.js';
import { createMeleeVisual } from './melee-visual.js';
import { createFirearmVisual } from './firearm-visual.js';
import { Spring } from './motion-math.js';

// Original armor built around a consistent articulated rig. No official mesh or
// animation assets: tapered shells, layered plates, and a forward helmet crest.
function shellGeometry(rings, segments = 12) {
  const positions = [], indices = [];
  for (const [y, width, depth, z = 0] of rings) for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2; positions.push(Math.cos(a) * width, y, Math.sin(a) * depth + z);
  }
  for (let r = 0; r < rings.length - 1; r++) for (let j = 0; j < segments; j++) {
    const a = r * segments + j, b = a + segments, next = r * segments + (j + 1) % segments;
    indices.push(a, b, next, next, b, next + segments);
  }
  for (const [ring, top] of [[0, false], [rings.length - 1, true]]) {
    const center = positions.length / 3; positions.push(0, rings[ring][0], rings[ring][3] || 0);
    for (let j = 0; j < segments; j++) {
      const a = ring * segments + j, b = ring * segments + (j + 1) % segments;
      indices.push(center, top ? b : a, top ? a : b);
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

export function createCharacter(scene) {
  const root = new THREE.Group(), rig = new THREE.Group(); root.add(rig); scene.add(root);
  root.name = 'AUREL / original armored runner';
  const armor = new THREE.MeshStandardMaterial({ color: 0xd2dadb, metalness: .48, roughness: .39 });
  const secondary = new THREE.MeshStandardMaterial({ color: 0x4c7180, metalness: .57, roughness: .45 });
  const suit = new THREE.MeshStandardMaterial({ color: 0x14232e, metalness: .24, roughness: .7 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xbda16e, metalness: .72, roughness: .33 });
  const energy = new THREE.MeshBasicMaterial({ color: 0x6ee8de });
  const black = new THREE.MeshStandardMaterial({ color: 0x09151d, metalness: .45, roughness: .3 });
  const sphere = new THREE.SphereGeometry(1, 16, 10), cube = new THREE.BoxGeometry(1, 1, 1), joints = {};
  function shape(parent, geometry, material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function shell(parent, material, rings, x = 0, y = 0, z = 0) { return shape(parent, shellGeometry(rings), material, x, y, z); }
  function plate(parent, material, points, depth, x = 0, y = 0, z = 0) {
    const outline = new THREE.Shape(); outline.moveTo(...points[0]); for (const point of points.slice(1)) outline.lineTo(...point); outline.closePath();
    const geometry = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .006, bevelThickness: .006, curveSegments: 1 });
    return shape(parent, geometry, material, x, y, z);
  }
  const torso = new THREE.Group(); torso.position.y = 1.1; rig.add(torso); joints.torso = torso;
  shell(torso, suit, [[-.22,.17,.105],[-.12,.18,.115],[.05,.17,.105],[.22,.23,.135],[.36,.25,.105]]);
  for (const sign of [-1, 1]) {
    plate(torso, armor, [[.035,.34],[.21,.34],[.245,.24],[.19,.04],[.095,-.03],[.035,.06]].map(([x,y])=>[sign*x,y]), .045, 0, 0, -.15);
    plate(torso, secondary, [[.09,.02],[.19,-.01],[.2,-.15],[.12,-.19],[.075,-.08]].map(([x,y])=>[sign*x,y]), .035, 0, 0, -.135);
    for (let i = 0; i < 3; i++) {
      const rib = shape(torso, cube, secondary, sign * .173, .11 - i * .065, .015, .032, .019, .21); rib.rotation.z = sign * .16;
      shape(torso, cube, suit, sign * .093, .17 + i * .047, .137, .082, .021, .014);
    }
    const spine = shape(torso, cube, armor, sign * .066, .05, .14, .042, .38, .055); spine.rotation.z = sign * -.12;
    shape(torso, cube, energy, sign * .068, .15, .173, .009, .17, .014);
    // Scapular shells and a segmented lumbar plate make the back read as armor
    // in the normal third-person view, with a narrow articulated waist.
    plate(torso,armor,[[sign*.07,.34],[sign*.205,.32],[sign*.23,.21],[sign*.14,.075],[sign*.055,.13]],.034,0,0,.14);
    plate(torso,secondary,[[sign*.06,.12],[sign*.14,.07],[sign*.15,-.12],[sign*.07,-.18]],.032,0,0,.13);
    const vent=shape(torso,cube,trim,sign*.15,.22,.19,.035,.11,.018);vent.rotation.z=sign*.3;
    for(let i=0;i<3;i++)shape(torso,cube,energy,sign*.09,.04-i*.052,.173,.011,.024,.014);
  }
  plate(torso, trim, [[-.019,.32],[.019,.32],[.026,.02],[0,-.10],[-.026,.02]], .022, 0, 0, -.181);
  shape(torso, sphere, energy, 0, .26, -.199, .028, .045, .010);
  shell(torso, black, [[.34,.10,.08],[.46,.075,.075]]);
  const head = new THREE.Group(); head.position.set(0, .50, -.015); torso.add(head); joints.head = head;
  shell(head, black, [[-.17,.052,.07],[-.1,.088,.10],[.06,.115,.105],[.17,.082,.07],[.20,.034,.03]]);
  shell(head, armor, [[-.13,.064,.074,-.047],[-.05,.105,.105,-.02],[.08,.137,.119],[.17,.105,.081],[.21,.04,.028]]);
  for (const sign of [-1,1]) {
    const brow = shape(head, cube, black, sign*.068,.034,-.128,.11,.023,.025); brow.rotation.z=sign*.18;
    const optic = shape(head, cube, energy, sign*.073,.031,-.143,.054,.008,.009); optic.rotation.z=sign*.18;
    plate(head, secondary, [[sign*.078,.01],[sign*.12,-.01],[sign*.078,-.12],[sign*.036,-.15]], .026, 0, 0, -.11);
    plate(head,secondary,[[sign*.025,.17],[sign*.082,.13],[sign*.095,-.045],[sign*.03,-.10]],.022,0,0,.107);
    shape(head,cube,energy,sign*.038,.05,.135,.009,.085,.01);
  }
  const crest=plate(head, armor, [[-.045,-.035],[.036,.018],[.25,.19],[.11,.20],[-.035,.10],[-.08,.035]], .035, -.017, .09, -.016); crest.rotation.y=Math.PI/2;
  const crestInset=plate(head, trim, [[.025,.02],[.19,.16],[.09,.16]], .006, -.021, .09, -.016); crestInset.rotation.y=Math.PI/2;
  for(const sign of [-1,1]){
    plate(rig,secondary,[[sign*.035,1.0],[sign*.14,1.025],[sign*.205,.92],[sign*.16,.82],[sign*.06,.85]],.052,0,0,-.10);
    plate(rig,armor,[[sign*.14,1.04],[sign*.225,1.015],[sign*.245,.88],[sign*.19,.79],[sign*.153,.89]],.06,0,0,.015);
  }

  for (const [side, sign] of [['left', -1], ['right', 1]]) {
    const arm = new THREE.Group(); arm.position.set(sign*.285,.33,0); torso.add(arm); joints[side+'Arm']=arm;
    shape(arm,sphere,suit,0,-.045,0,.09,.11,.085);
    const pauldron=shell(arm,armor,[[-.15,.073,.089],[-.10,.11,.113],[.025,.099,.088],[.065,.051,.04]],sign*.018);pauldron.rotation.z=sign*-.10;
    plate(arm,secondary,[[sign*.055,.02],[sign*.12,-.015],[sign*.104,-.13],[sign*.065,-.15]],.022,0,0,.075);
    shape(arm,cube,energy,sign*.109,-.043,-.014,.009,.09,.023);
    shell(arm,suit,[[-.32,.058,.059],[-.23,.069,.067],[-.13,.075,.073]]);
    shell(arm,secondary,[[-.27,.063,.066],[-.22,.073,.07],[-.16,.064,.065]],0,0,-.006);
    const elbow=new THREE.Group();elbow.position.y=-.32;arm.add(elbow);joints[side+'Elbow']=elbow;
    shape(elbow,sphere,black,0,0,0,.064,.067,.06);
    shell(elbow,suit,[[-.31,.045,.047],[-.21,.063,.065],[-.05,.057,.06]]);
    plate(elbow,armor,[[-.07,-.045],[.076,-.045],[.064,-.15],[.045,-.29],[-.04,-.27],[-.071,-.12]],.048,0,0,-.073);
    shape(elbow,cube,trim,0,-.165,-.083,.021,.16,.013);
    shape(elbow,cube,energy,sign*.044,-.14,-.078,.008,.095,.009);
    const hand=new THREE.Group();hand.position.y=-.31;elbow.add(hand);joints[side+'Hand']=hand;
    shape(hand,cube,black,0,-.035,0,.075,.082,.055);shape(hand,cube,secondary,0,-.027,-.031,.065,.063,.018);
    for(let finger=0;finger<4;finger++) {
      const x=(finger-1.5)*.018;
      const first=shape(hand,cube,suit,x,-.080,-.012,.014,.035,.022);first.rotation.x=.30;
      const tip=shape(hand,cube,secondary,x,-.101,.006,.014,.028,.021);tip.rotation.x=1.05;
    }
    const thumb=shape(hand,cube,suit,sign*.043,-.05,-.02,.025,.054,.035);thumb.rotation.z=sign*-.3;

    const leg=new THREE.Group();leg.position.set(sign*.135,1.04,0);rig.add(leg);joints[side+'Leg']=leg;
    shell(leg,suit,[[-.46,.063,.064],[-.28,.083,.087],[-.10,.105,.096],[.005,.092,.09]]);
    const thigh=shell(leg,armor,[[-.38,.065,.067],[-.24,.097,.086],[-.075,.109,.10],[-.025,.075,.075]],sign*.013,0,-.022);thigh.rotation.z=sign*.018;
    plate(leg,secondary,[[sign*.06,-.075],[sign*.119,-.12],[sign*.093,-.30],[sign*.046,-.34]],.028,0,0,-.04);
    shape(leg,cube,energy,sign*.071,-.2,-.097,.01,.11,.01);
    const knee=new THREE.Group();knee.position.y=-.46;leg.add(knee);joints[side+'Knee']=knee;
    shape(knee,sphere,black,0,0,0,.066,.07,.062);
    plate(knee,armor,[[-.067,.055],[.067,.055],[.079,-.023],[0,-.10],[-.079,-.023]],.035,0,0,-.076);
    shape(knee,cube,trim,0,-.003,-.117,.032,.046,.01);
    shell(knee,suit,[[-.44,.046,.05],[-.29,.059,.068],[-.12,.066,.07],[-.06,.063,.065]]);
    plate(knee,armor,[[-.064,-.10],[.064,-.10],[.075,-.2],[.047,-.40],[-.045,-.40],[-.074,-.22]],.047,0,0,-.074);
    shape(knee,cube,energy,0,-.23,-.128,.01,.12,.013);
    shell(knee,secondary,[[-.29,.068,.07],[-.20,.078,.085],[-.12,.065,.07]],0,0,.014);
    const foot=new THREE.Group();foot.position.y=-.44;knee.add(foot);joints[side+'Foot']=foot;
    shape(foot,sphere,black,0,-.025,-.06,.077,.052,.15);
    shape(foot,cube,suit,0,-.058,-.065,.143,.014,.275);
    plate(foot,armor,[[-.055,-.02],[.055,-.02],[.06,-.053],[-.06,-.053]],.155,0,0,-.17);
    shape(foot,cube,trim,0,-.051,-.193,.097,.012,.02);
  }

  const firearm=createFirearmVisual(root,{armor,secondary,suit,trim,energy}),weapon=firearm.weapon;
  const meleeVisual=createMeleeVisual(scene,root,{armor,secondary,suit,trim,energy});

  // Merge static decorations separately for each articulated part and material.
  const groups=[];root.traverse(object=>{if(object.isGroup)groups.push(object);});
  for(const group of groups){
    const materials=new Map();
    for(const child of [...group.children]) if(child.isMesh){const list=materials.get(child.material)||[];list.push(child);materials.set(child.material,list);}
    for(const [material,meshes]of materials){
      if(meshes.length<2)continue;
      const geometries=meshes.map(mesh=>{mesh.updateMatrix();const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();g.applyMatrix4(mesh.matrix);g.deleteAttribute('uv');return g;});
      const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
      if(merged){meshes.forEach(mesh=>group.remove(mesh));shape(group,merged,material);}
    }
  }
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(.48,32),new THREE.MeshBasicMaterial({color:0x071321,transparent:true,opacity:.20,depthWrite:false}));shadow.rotation.x=-Math.PI/2;scene.add(shadow);
  const animator=new CharacterAnimator(),pivot=new THREE.Vector3(0,1,0),rotatedPivot=new THREE.Vector3();
  const drawWeight=new Spring(1);
  const downAxis=new THREE.Vector3(0,-1,0),a=new THREE.Vector3(),b=new THREE.Vector3(),direction=new THREE.Vector3(),bend=new THREE.Vector3();
  const elbowTarget=new THREE.Vector3(),rightGrip=new THREE.Vector3(),leftGrip=new THREE.Vector3();
  const parentQ=new THREE.Quaternion(),aimQ=new THREE.Quaternion(),holsterQ=new THREE.Quaternion(),weaponQ=new THREE.Quaternion(),targetQ=new THREE.Quaternion();
  const chestPosition=new THREE.Vector3(),aimPosition=new THREE.Vector3(),holsterPosition=new THREE.Vector3(),weaponPosition=new THREE.Vector3();
  const gunEuler=new THREE.Euler(0,0,0,'YXZ'),holsterRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(1.3,0,.55));
  function pointBone(bone, point, weight){
    bone.getWorldPosition(a);direction.copy(point).sub(a).normalize();
    targetQ.setFromUnitVectors(downAxis,direction);bone.parent.getWorldQuaternion(parentQ);targetQ.premultiply(parentQ.invert());
    bone.quaternion.slerp(targetQ,weight);bone.updateWorldMatrix(false,true);
  }
  function aimArm(side,handTarget,weight,yaw){
    const arm=joints[side+'Arm'],elbow=joints[side+'Elbow'];arm.getWorldPosition(b);
    direction.copy(handTarget).sub(b);const distance=THREE.MathUtils.clamp(direction.length(),.05,.629);direction.normalize();
    const along=(.32*.32+distance*distance-.31*.31)/(2*distance);
    bend.set(side==='left'?-.6:.6,-1,.3).applyAxisAngle(THREE.Object3D.DEFAULT_UP,yaw);
    bend.addScaledVector(direction,-bend.dot(direction)).normalize();
    elbowTarget.copy(b).addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,.32*.32-along*along)));
    pointBone(arm,elbowTarget,weight);pointBone(elbow,handTarget,weight);
    elbow.getWorldQuaternion(parentQ);targetQ.copy(parentQ).invert().multiply(weaponQ);
    joints[side+'Hand'].quaternion.slerp(targetQ,weight);
  }
  function update(p,dt,time,renderPosition=p.position){
    const pose=animator.update(p,dt,renderPosition);root.position.copy(renderPosition);root.rotation.y=animator.facing.value;
    rig.rotation.set(pose.rigX,pose.rigY,pose.rigZ);rotatedPivot.copy(pivot).applyQuaternion(rig.quaternion);rig.position.copy(pivot).sub(rotatedPivot);
    rig.position.x+=pose.bodyX;rig.position.y+=pose.bodyY;rig.position.z+=pose.bodyZ;
    for(const name of JOINTS)joints[name].rotation.set(pose[name+'X'],pose[name+'Y'],pose[name+'Z']);
    root.updateWorldMatrix(true,true);
    torso.getWorldPosition(chestPosition);torso.getWorldQuaternion(holsterQ);
    holsterPosition.set(.075,-.18,.21).applyQuaternion(holsterQ).add(chestPosition);holsterQ.multiply(holsterRotation);
    const combat=p.combat,reload= combat?.reloadLeft>0 ? Math.sin(Math.PI*combat.reloadProgress) : 0;
    const carrying=combat?.sprinting,gunYaw=carrying?animator.facing.value:p.yaw;
    aimQ.setFromEuler(gunEuler.set(carrying?-.55:(p.pitch||0)+(combat?.recoil||0)*.65-reload*.45,gunYaw,reload*-.28,'YXZ'));
    aimPosition.set(.16,carrying?.04:.25,-.19+(combat?.recoil||0)*.20).applyAxisAngle(THREE.Object3D.DEFAULT_UP,gunYaw).add(chestPosition);
    aimPosition.y-=reload*.11;
    const meleeWeight=animator.meleeWeight.value;
    const drawing=drawWeight.step(combat?.swapLeft>.11?0:1,65,dt);
    const weight=animator.gunWeight.value*(1-meleeWeight)*drawing;
    weaponPosition.copy(holsterPosition).lerp(aimPosition,weight);weaponQ.copy(holsterQ).slerp(aimQ,weight);
    weapon.position.copy(weaponPosition);root.worldToLocal(weapon.position);root.getWorldQuaternion(parentQ);weapon.quaternion.copy(parentQ).invert().multiply(weaponQ);
    const gun=firearm.update(p,time);
    if(weight>.001){
      rightGrip.copy(gun.rightGrip).applyQuaternion(weaponQ).add(weaponPosition);
      leftGrip.copy(gun.leftGrip).applyQuaternion(weaponQ).add(weaponPosition);
      aimArm('right',rightGrip,weight,gunYaw);aimArm('left',leftGrip,weight,gunYaw);
    }
    const melee=meleeVisual.update(p,dt,torso,rig,meleeWeight);
    if(meleeWeight>.001){
      weaponQ.copy(melee.quaternion);
      aimArm('right',melee.rightGrip,meleeWeight,animator.facing.value+pose.rigY);
      if(melee.kind==='staff')aimArm('left',melee.leftGrip,meleeWeight,animator.facing.value+pose.rigY);
    }
    shadow.visible=p.grounded;shadow.position.set(renderPosition.x,renderPosition.y+.018,renderPosition.z);
  }
  return {root,rig,joints,weapon,firearm,meleeVisual,animator,update};
}
