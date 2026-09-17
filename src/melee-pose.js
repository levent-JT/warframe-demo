import { clamp, smoothstep, solveLeg } from './motion-math.js';

// Weapon-centred key poses: x/y/z from chest, Euler x/y/z, chest yaw/pitch.
// Hands are solved onto the grip points after the locomotion pose is blended.
const staffReady = [0,.18,-.30, 0,.08,-.18, 0,-.06];
const swordReady = [.30,-.08,-.25, -.4,.1,-.5, -.12,-.06];
const curves = {
  staff: {
    sweep: [[.02,.25,-.25, 0,-1.02,-.24, -.5,-.12], [0,.17,-.32, 0,1.1,.22, .55,-.17]],
    reverse: [[0,.26,-.25, 0,1.1,.22, .5,-.10], [.01,.19,-.31, 0,-1.05,-.26, -.5,-.16]],
    overhead: [[0,.55,-.09, .1,-.25,.6, -.35,.10], [0,-.05,-.36, -.5,.35,-.35, .36,-.30]],
    thrust: [[.02,.18,-.08, 0,1.5,.08, -.25,-.05], [.02,.22,-.29, 0,1.57,0, .18,-.20]],
    lift: [[.01,-.11,-.29, 0,.45,-.3, -.35,-.18], [0,.54,-.20, 0,-.65,.28, .3,.06]],
    spin: [[0,.08,-.24, 0,-.55,.12, -.3,-.15], [0,.10,-.28, 0,1.15,-.08, .3,-.16]],
    heavy: [[.02,.47,-.12, .15,-.7,.6, -.5,.10], [0,.17,-.26, 0,Math.PI*2+.15,-.10, .7,-.24]],
  },
  sword: {
    sweep: [[.31,.37,.015, .15,.65,-1.12, -.55,.04], [.02,.06,-.43, -1.35,-.65,1.16, .56,-.24]],
    reverse: [[.015,.24,-.32, -.5,-.7,1.3, .5,-.06], [.32,.05,-.30, -1.2,.7,-1.2, -.55,-.18]],
    overhead: [[.23,.57,.01, .18,.10,-.15, -.2,.1], [.21,-.045,-.46, -1.95,.08,-.10, .2,-.30]],
    thrust: [[.26,.20,-.02, -1.57,0,-.05, -.35,-.05], [.17,.20,-.52, -1.57,0,0, .18,-.20]],
    lift: [[.3,-.20,-.27, -2.45,.1,-.4, -.3,-.18], [.22,.52,-.21, -.5,.1,.35, .3,.10]],
    spin: [[.35,.04,-.10, -1.25,-.2,-1.2, -.4,-.16], [.34,.06,-.29, -1.4,.2,-1.3, .45,-.20]],
    heavy: [[.015,.19,-.12, -.5,-1.2,1.7, .6,.03], [.32,.04,-.30, -1.6,.9,-1.55, -.7,-.24]],
  },
};
export function sampleMeleePose(melee, guarding = false) {
  const weapon = melee?.weapon || 'staff';
  const ready = weapon === 'staff' ? staffReady : swordReady;
  const a = melee?.active;
  if (!a) return { values: guarding ? (weapon === 'staff' ? [0,.35,-.29,0,.12,.85,0,-.10] : [.24,.34,-.29,-.2,.15,-.4,0,-.08]) : [...ready], spin: 0 };
  const t = melee.progress;
  if (a.branch === 'slam') {
    const wind = weapon === 'staff' ? [0,.50,-.13,.1,0,.2,0,-.20] : [.22,.48,-.06,.2,0,-.15,0,-.20];
    const impact = weapon === 'staff' ? [0,-.16,-.33,0,.2,-.2,.12,-.55] : [.23,-.25,-.39,-2.45,0,-.1,.12,-.50];
    const mix = a.stage === 'fall' ? .23 : 1 - smoothstep(t);
    return { values: wind.map((v,i)=>v+(impact[i]-v)*mix), spin: 0 };
  }
  const [wind, strike] = curves[weapon][a.move.motion];
  const heavy = a.branch === 'heavy';
  const recovery = [...ready];
  if(heavy && weapon==='staff') recovery[4]+=Math.PI*2;
  const keyframes = [[0,ready],[heavy?.51:.23,wind],[heavy?.80:.59,strike],[1,recovery]];
  let left=keyframes[0],right=keyframes[1];
  for(let i=1;i<keyframes.length;i++) if(t<=keyframes[i][0]){left=keyframes[i-1];right=keyframes[i];break;}
  const blend=smoothstep(clamp((t-left[0])/(right[0]-left[0]),0,1));
  const values=left[1].map((value,i)=>value+(right[1][i]-value)*blend);
  // A slide attack turns around the vertical axis while retaining the slide's
  // low body and leg posture. It does not rotate the physical velocity vector.
  const spin=a.branch==='slide'?Math.PI*2*smoothstep(clamp((t-.09)/.8,0,1)):0;
  return { values, spin };
}

export function applyMeleePose(pose, melee, weight, guarding, player) {
  if (weight < .001) return;
  const { values:v, spin } = sampleMeleePose(melee, guarding);
  const active=!!melee.active;
  pose.torsoY += (v[6]-pose.torsoY)*weight;
  // Preserve the crouch/slide spine rather than standing the torso upright.
  const chestPitch = Math.min(pose.torsoX, v[7]);
  pose.torsoX += (chestPitch-pose.torsoX)*weight;
  pose.headY += (-v[6]*.42-pose.headY)*weight;
  if(active) pose.rigY += spin*weight;
  pose.leftArmX += (.55-pose.leftArmX)*weight;
  pose.rightArmX += (.55-pose.rightArmX)*weight;
  pose.leftElbowX += (1.35-pose.leftElbowX)*weight;
  pose.rightElbowX += (1.1-pose.rightElbowX)*weight;
  pose.leftArmZ += (-.24-pose.leftArmZ)*weight;
  pose.rightArmZ += (.15-pose.rightArmZ)*weight;
  if(player?.grounded && player.speed<.65 && player.height>1 && !['roll','hardLand'].includes(player.state)){
    // A planted staggered stance lets the chest turn against the hips. Shift
    // weight through bent knees, solving back to the same two foot contacts.
    pose.bodyY-=.06*weight;pose.bodyX+=v[6]*.055*weight;
    pose.bodyZ-=Math.max(0,-v[7])*.09*weight;
    for(const [side,sign] of [['left',-1],['right',1]]){
      const footZ=sign*.14*weight-pose.bodyZ;
      const lateral=sign*.055*weight-pose.bodyX;
      const down=1.04+pose.bodyY-.065;
      const leg=solveLeg(Math.hypot(down,lateral),footZ);
      pose[side+'LegX']=leg.hip;pose[side+'KneeX']=leg.knee;pose[side+'FootX']=leg.ankle;
      pose[side+'LegZ']=Math.atan2(lateral,down);pose[side+'FootZ']=-pose[side+'LegZ'];pose[side+'FootY']=sign*.14*weight;
    }
  }
}
