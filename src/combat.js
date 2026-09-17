import { Vector3 } from 'three';
import { MovementController } from './movement.js';
import { solids, ramps, ziplines } from './world.js';

// Original training weapons. Damage, cadence and AI are demo tuning values.
export const GUNS = [
  { id:'carbine', name:'曙光 · 自动步枪', short:'自动步枪', type:'AUTO', magazine:30, reload:1.45, rate:9, damage:18, pellets:1, range:120, spread:.019, adsSpread:.0025, recoil:.065, color:0x8dfff0 },
  { id:'pistol', name:'隼 · 半自动手枪', short:'半自动手枪', type:'SEMI', magazine:12, reload:1.10, rate:4.5, damage:42, pellets:1, range:100, spread:.014, adsSpread:.0015, recoil:.11, color:0xffd392 },
  { id:'shotgun', name:'碎星 · 霰弹枪', short:'霰弹枪', type:'SEMI', magazine:6, reload:1.90, rate:1.4, damage:13, pellets:8, range:45, spread:.095, adsSpread:.055, recoil:.19, color:0xf3aa78 },
];
export const BOT_SPAWNS = [ [-5,0,12], [6,0,6], [-3,0,-8], [-25,0,23] ];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function rayBox(origin, direction, box, maximum=Infinity) {
  let near=0, far=maximum;
  for(const [axis,low,high] of [['x','minX','maxX'],['y','minY','maxY'],['z','minZ','maxZ']]) {
    if(Math.abs(direction[axis])<1e-9) { if(origin[axis]<box[low]||origin[axis]>box[high]) return null; }
    else {
      let a=(box[low]-origin[axis])/direction[axis],b=(box[high]-origin[axis])/direction[axis];
      if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return null;
    }
  }
  return far>=0 && near<=maximum ? near : null;
}
export function worldHit(origin,direction,world,maximum=Infinity) {
  let distance=maximum,hit=false;
  for(const box of world.solids) {const d=rayBox(origin,direction,box,distance);if(d!==null){distance=d;hit=true;}}
  return hit?distance:null;
}
const bodyBox=(p,r=.34,height=1.82)=>({minX:p.x-r,maxX:p.x+r,minY:p.y+.12,maxY:p.y+height,minZ:p.z-r,maxZ:p.z+r});
function botHit(origin,direction,bot,maximum) {
  const p=bot.actor.position, head={minX:p.x-.19,maxX:p.x+.19,minY:p.y+1.43,maxY:p.y+1.84,minZ:p.z-.19,maxZ:p.z+.19};
  const h=rayBox(origin,direction,head,maximum),b=rayBox(origin,direction,bodyBox(p,.35,1.43),maximum);
  if(h===null && b===null)return null;
  return h!==null && (b===null||h<=b) ? {distance:h,head:true}:{distance:b,head:false};
}

// A small navigation grid on the main deck, built from the actual collision
// boxes. Robots go around the low tunnel and walls rather than through them.
export class ArenaNavigation {
  constructor(world) {
    this.world=world;this.step=2;this.nodes=[];this.byCell=new Map();
    for(let z=-14;z<=36;z+=2)for(let x=-30;x<=30;x+=2) {
      if(!this.walkable(x,z))continue;
      const node={x,z,id:this.nodes.length};this.nodes.push(node);this.byCell.set(`${x},${z}`,node);
    }
    for(const n of this.nodes)n.neighbors=[[2,0],[-2,0],[0,2],[0,-2]].map(([dx,dz])=>this.byCell.get(`${n.x+dx},${n.z+dz}`)).filter(next=>next&&this.clearEdge(n,next));
  }
  walkable(x,z) {
    if(x< -30||x>30||z< -14||z>37)return false;
    const supported=this.world.solids.some(b=>Math.abs(b.maxY)<.01 && x>b.minX+.42 && x<b.maxX-.42 && z>b.minZ+.42 && z<b.maxZ-.42);
    return supported && !this.world.solids.some(b=>b.maxY>.15 && b.minY<1.85 && x+.44>b.minX && x-.44<b.maxX && z+.44>b.minZ && z-.44<b.maxZ);
  }
  nearest(p) {let result=null,best=Infinity;for(const n of this.nodes){const d=(n.x-p.x)**2+(n.z-p.z)**2;if(d<best){best=d;result=n;}}return result;}
  clearEdge(from,to) {
    const origin=new Vector3(from.x,1,from.z),direction=new Vector3(to.x-from.x,0,to.z-from.z),length=direction.length();direction.normalize();
    return !this.world.solids.some(b=>b.maxY>.15&&b.minY<1.85&&rayBox(origin,direction,{...b,minX:b.minX-.44,maxX:b.maxX+.44,minZ:b.minZ-.44,maxZ:b.maxZ+.44,minY:0,maxY:2},length)!==null);
  }
  path(from,to) {
    const start=this.nearest(from),goal=this.nearest(to);if(!start||!goal)return [];
    const queue=[goal],next=new Map([[goal.id,null]]);
    for(let i=0;i<queue.length;i++) {
      const n=queue[i];if(n===start)break;
      for(const neighbor of n.neighbors) {
        if(!next.has(neighbor.id)){next.set(neighbor.id,n);queue.push(neighbor);}
      }
    }
    if(!next.has(start.id))return [];
    const route=[];let current=next.get(start.id);
    while(current&&route.length<100){route.push(current);current=next.get(current.id);}return route;
  }
}

export class CombatController {
  constructor(world={solids,ramps,ziplines}) {
    this.world=world;this.navigation=new ArenaNavigation(world);this.mode='battle';this.clock=0;
    this.selected=0;this.previousGun=1;this.events=[];this.seed=7231;this.kills=0;this.deaths=0;this.shots=0;this.hits=0;
    this.playerReset=-1;this.lastMelee=-1;this.lastImpact=-1;this.projectiles=[];
    this.bots=BOT_SPAWNS.map((spawn,index)=>{
      const actor=new MovementController(world,{runSpeed:3.2,acceleration:16});
      actor.reset({x:spawn[0],y:spawn[1],z:spawn[2]});actor.grounded=true;
      return {id:index,spawn,actor,hp:100,alive:true,respawn:0,state:'patrol',phase:index*1.7,cooldown:1.4+index*.3,charge:0,stun:0,hitFlash:0,path:[],repath:0,yaw:0};
    });
    this.resetPlayer();
  }
  get gun(){return GUNS[this.selected];}
  get magazine(){return this.ammo[this.selected];}
  get reloadProgress(){return this.reloadLeft>0 ? 1-this.reloadLeft/this.gun.reload : 0;}
  get alive(){return this.health>0;}
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  emit(type,extra={}){this.events.push({type,...extra});if(this.events.length>128)this.events.shift();}
  resetPlayer() {
    this.health=100;this.shield=80;this.ammo=GUNS.map(g=>g.magazine);this.reloadLeft=0;this.swapLeft=0;this.cooldown=0;
    this.recoil=0;this.shotFlash=0;this.recentShot=0;this.hitMarker=0;this.headMarker=false;this.damageFlash=0;this.lastDamage=-10;
    this.respawnLeft=0;this.spawnProtection=3;this.fireBlocked=false;this.sprinting=false;
  }
  setMode(mode){if(['battle','targets','off'].includes(mode)){this.mode=mode;this.projectiles.length=0;for(const bot of this.bots)bot.charge=0;}}
  resetBots(){for(const bot of this.bots)this.respawnBot(bot);this.projectiles.length=0;this.kills=0;}
  respawnBot(bot){bot.actor.reset({x:bot.spawn[0],y:0,z:bot.spawn[2]});bot.actor.grounded=true;Object.assign(bot,{hp:100,alive:true,respawn:0,state:'patrol',charge:0,cooldown:1.5,stun:0,hitFlash:0,path:[],repath:0});}
  selectGun(index,p) {
    if(index<0||index>=GUNS.length)return;
    if(index!==this.selected){this.previousGun=this.selected;this.selected=index;this.reloadLeft=0;this.swapLeft=.22;this.cooldown=.08;this.emit('swap',{gun:index});}
    p.melee.cancel('gun');p.melee.drawn=false;
  }
  reload() {if(this.alive&&!this.reloadLeft&&!this.swapLeft&&this.magazine<this.gun.magazine){this.reloadLeft=this.gun.reload;this.emit('reload');}}
  prepareInput(input,p) {
    if(!this.alive)return {yaw:input.yaw,pitch:input.pitch};
    if(!input.fireHeld)this.fireBlocked=false;
    if(input.meleePressed||input.heavyPressed||input.switchWeaponPressed){this.reloadLeft=0;this.fireBlocked=!!input.fireHeld;}
    if(!this.fireBlocked && (input.firePressed||input.fireHeld&&!p.melee.active) && !input.meleePressed&&!input.heavyPressed&&!p.slam) {
      p.melee.cancel('fire');p.melee.drawn=false;p.bulletTimer=0;p.doubleTimer=0;
    }
    this.sprinting=!!input.sprint&&!input.aim&&!input.fireHeld&&!this.reloadLeft&&p.speed>8;
    return {...input,sprint:input.sprint&&!input.fireHeld&&!this.reloadLeft};
  }
  step(dt,input,p,aim={}) {
    if(!(dt>0))return;
    this.clock+=dt;
    if(this.playerReset!==p.resetSerial){this.playerReset=p.resetSerial;this.resetPlayer();this.lastMelee=p.melee.serial;this.lastImpact=p.melee.impactSerial;}
    for(const key of ['cooldown','swapLeft','recentShot','shotFlash','hitMarker','damageFlash','spawnProtection'])this[key]=Math.max(0,this[key]-dt);
    this.recoil*=Math.exp(-18*dt);
    if(!this.alive){
      this.respawnLeft-=dt;
      if(this.respawnLeft<=0){p.checkpoint=0;p.reset();this.resetPlayer();this.playerReset=p.resetSerial;this.emit('respawn');}
      return;
    }
    if(this.clock-this.lastDamage>4)this.shield=Math.min(80,this.shield+24*dt);
    if(this.reloadLeft>0){this.reloadLeft=Math.max(0,this.reloadLeft-dt);if(this.reloadLeft===0){this.ammo[this.selected]=this.gun.magazine;this.emit('reloadDone');}}
    if(input.gunSlot!==null&&input.gunSlot!==undefined)this.selectGun(input.gunSlot,p);
    else if(input.quickSwapPressed)this.selectGun(this.previousGun,p);
    else if(input.cycleGun)this.selectGun((this.selected+input.cycleGun+3)%3,p);
    if(input.reloadPressed){p.melee.cancel('gun');p.melee.drawn=false;this.reload();}
    const busy=p.rollTimer>0||p.bulletTimer>0||p.doubleTimer>0||p.slam||p.mantle||p.rope;
    const trigger=this.gun.type==='AUTO'?input.fireHeld||input.firePressed:input.firePressed;
    if(trigger&&!this.fireBlocked&&!p.melee.drawn&&!p.melee.active&&!busy&&!this.swapLeft&&!this.reloadLeft&&!this.cooldown) {
      if(this.magazine>0)this.fire(p,input,aim);else this.reload();
    }
    this.resolveMelee(p);
    if(this.mode!=='off')for(const bot of this.bots)this.updateBot(bot,dt,p);
    this.updateProjectiles(dt,p);
  }
  trace(origin,direction,maximum) {
    let distance=worldHit(origin,direction,this.world,maximum)??maximum,bot=null,head=false;
    if(this.mode!=='off')for(const candidate of this.bots)if(candidate.alive){
      const h=botHit(origin,direction,candidate,distance);
      if(h&&h.distance<distance){distance=h.distance;bot=candidate;head=h.head;}
    }
    return {point:origin.clone().addScaledVector(direction,distance),distance,bot,head};
  }
  fire(p,input,aim) {
    const gun=this.gun;this.ammo[this.selected]--;this.shots++;this.cooldown=1/gun.rate;this.recoil=Math.min(.45,this.recoil+gun.recoil);
    this.shotFlash=.05;this.recentShot=.22;
    const yaw=input.yaw??p.yaw,pitch=input.pitch??p.pitch;
    const forward=new Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    const direction=(aim.direction||forward).clone().normalize();
    const cameraOrigin=(aim.origin||p.position.clone().add(new Vector3(0,p.height*.78,0))).clone();
    const muzzle=(aim.muzzle||p.position.clone().add(new Vector3(Math.cos(yaw)*.20,p.height*.77,-Math.sin(yaw)*.20)).addScaledVector(forward,.52)).clone();
    const right=new Vector3().crossVectors(direction,new Vector3(0,1,0)).normalize();
    if(right.lengthSq()<.1)right.set(1,0,0);
    const up=new Vector3().crossVectors(right,direction).normalize(),spread=input.aim?gun.adsSpread:gun.spread;
    this.emit('shot',{gun:this.selected});
    for(let pellet=0;pellet<gun.pellets;pellet++){
      const radius=Math.sqrt(this.random())*spread,angle=this.random()*Math.PI*2;
      const ray=direction.clone().addScaledVector(right,Math.cos(angle)*radius).addScaledVector(up,Math.sin(angle)*radius).normalize();
      const target=this.trace(cameraOrigin,ray,gun.range);
      const muzzleRay=target.point.clone().sub(muzzle),distance=muzzleRay.length();muzzleRay.normalize();
      // The camera may see around a corner that the muzzle cannot clear.
      const impact=this.trace(muzzle,muzzleRay,distance+.015);
      if(impact.bot){this.damageBot(impact.bot,gun.damage*(impact.head?2:1),impact.head);this.hits++;}
      this.emit('tracer',{from:muzzle.clone(),to:impact.point,color:gun.color,hit:!!impact.bot});
    }
  }
  damageBot(bot,damage,head=false) {
    if(!bot.alive||this.mode==='off')return;
    bot.hp=Math.max(0,bot.hp-damage);bot.hitFlash=.16;bot.stun=.12;
    this.hitMarker=.14;this.headMarker=head;this.emit('hit',{head,damage,position:bot.actor.position.clone().add(new Vector3(0,head?1.65:1.1,0))});
    if(bot.hp===0){bot.alive=false;bot.respawn=6;bot.state='down';bot.charge=0;bot.actor.velocity.set(0,0,0);this.kills++;this.emit('kill',{position:bot.actor.position.clone()});}
  }
  resolveMelee(p) {
    if(this.mode==='off')return;
    const a=p.melee.active;
    if(a&&p.melee.striking&&p.melee.serial!==this.lastMelee){
      this.lastMelee=p.melee.serial;
      const reach=p.melee.weapon==='staff'?2.85:2.25,forward=new Vector3(-Math.sin(a.yaw),0,-Math.cos(a.yaw));
      for(const bot of this.bots)if(bot.alive){
        const delta=bot.actor.position.clone().sub(p.position),distance=delta.length();
        if(distance>reach||Math.abs(delta.y)>1.8||a.branch!=='slide'&&delta.normalize().dot(forward)<.25)continue;
        const from=p.position.clone().add(new Vector3(0,.9,0)),to=bot.actor.position.clone().add(new Vector3(0,.9,0)).sub(from),range=to.length();
        if(worldHit(from,to.normalize(),this.world,range)===null)this.damageBot(bot,a.branch==='heavy'?80:p.melee.weapon==='staff'?32:38);
      }
    }
    if(p.melee.impactSerial!==this.lastImpact){
      this.lastImpact=p.melee.impactSerial;const impact=p.melee.impact;if(!impact)return;
      for(const bot of this.bots)if(bot.alive){
        const from=new Vector3(impact.x,impact.y+.4,impact.z),delta=bot.actor.position.clone().add(new Vector3(0,.4,0)).sub(from),d=delta.length();
        if(d<4.5&&worldHit(from,delta.normalize(),this.world,d)===null)this.damageBot(bot,impact.heavy?120:75);
      }
    }
  }
  damagePlayer(amount) {
    if(!this.alive||this.spawnProtection>0||this.mode!=='battle')return;
    const absorbed=Math.min(this.shield,amount);this.shield-=absorbed;this.health=Math.max(0,this.health-(amount-absorbed));
    this.lastDamage=this.clock;this.damageFlash=.22;this.emit('hurt');
    if(this.health===0){this.deaths++;this.respawnLeft=2.5;this.reloadLeft=0;this.emit('down');}
  }
  updateBot(bot,dt,p) {
    bot.hitFlash=Math.max(0,bot.hitFlash-dt);bot.stun=Math.max(0,bot.stun-dt);
    if(!bot.alive){bot.respawn-=dt;if(bot.respawn<=0)this.respawnBot(bot);return;}
    if(this.mode==='targets'){bot.state='target';bot.actor.velocity.set(0,0,0);return;}
    bot.phase+=dt;bot.cooldown=Math.max(0,bot.cooldown-dt);bot.repath-=dt;
    const position=bot.actor.position,delta=p.position.clone().sub(position),distance=delta.length();
    bot.yaw=Math.atan2(-delta.x,-delta.z);
    const eye=position.clone().add(new Vector3(0,1.35,0)),target=p.position.clone().add(new Vector3(0,p.height*.7,0));
    const sight=target.clone().sub(eye),range=sight.length();
    const canSee=distance<30&&worldHit(eye,sight.clone().normalize(),this.world,range)===null;
    let move=new Vector3();
    if(bot.stun>0){bot.state='stagger';bot.charge=0;}
    else if(canSee&&distance<20) {
      bot.state=bot.charge>0?'aim':'strafe';
      if(distance>13)move.copy(delta).setY(0).normalize();
      else if(distance<6)move.copy(delta).setY(0).normalize().negate();
      else move.set(Math.cos(bot.yaw),0,-Math.sin(bot.yaw)).multiplyScalar(Math.sin(bot.phase*.75+bot.id)>0?1:-1);
      if(!this.navigation.walkable(position.x+move.x*.9,position.z+move.z*.9))move.set(0,0,0);
      if(bot.cooldown===0&&bot.charge===0){bot.charge=.48;bot.state='aim';}
    } else {
      bot.charge=0;bot.state=distance<32?'chase':'patrol';
      const destination=distance<32?p.position:new Vector3(bot.spawn[0]+Math.sin(bot.phase*.15+bot.id)*4,0,bot.spawn[2]+Math.cos(bot.phase*.15)*3);
      if(bot.repath<=0){bot.path=this.navigation.path(position,destination);bot.repath=.8+bot.id*.1;}
      if(bot.path.length){const next=bot.path[0];move.set(next.x-position.x,0,next.z-position.z);if(move.length()<.55)bot.path.shift();else move.normalize();}
    }
    if(bot.charge>0&&bot.stun===0) {
      bot.charge=Math.max(0,bot.charge-dt);move.multiplyScalar(.22);
      if(bot.charge===0&&canSee){
        const predicted=target.clone().addScaledVector(p.velocity,.12);
        predicted.x+=(this.random()-.5)*1.5;predicted.y+=(this.random()-.5)*.6;predicted.z+=(this.random()-.5)*1.5;
        const direction=predicted.sub(eye).normalize();
        this.projectiles.push({position:eye.clone(),velocity:direction.multiplyScalar(23),life:3,id:bot.id});
        bot.cooldown=1.15+this.random()*.65;this.emit('botShot',{position:eye.clone()});
      }
    }
    // A small separating force prevents agents from standing on one another.
    for(const other of this.bots)if(other!==bot&&other.alive){const away=position.clone().sub(other.actor.position).setY(0);const d=away.length();if(d>.01&&d<1.2)move.addScaledVector(away,(1.2-d)/d);}
    if(move.lengthSq()>1)move.normalize();
    bot.actor.step(dt,{yaw:0,x:move.x,z:-move.z});bot.actor.events.length=0;
  }
  updateProjectiles(dt,p) {
    const playerBox=bodyBox(p.position,.34,p.height);
    this.projectiles=this.projectiles.filter(shot=>{
      const direction=shot.velocity.clone().normalize(),distance=shot.velocity.length()*dt;
      const wall=worldHit(shot.position,direction,this.world,distance),hit=rayBox(shot.position,direction,playerBox,distance);
      if(hit!==null&&(wall===null||hit<wall)){this.damagePlayer(10);return false;}
      if(wall!==null)return false;
      shot.position.addScaledVector(shot.velocity,dt);shot.life-=dt;return shot.life>0;
    });
  }
}
