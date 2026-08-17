'use strict';
/* =====================================================================
   FlowPy — orthogonal wire router
   Wires are straight segments on the grid. An A* search over free grid
   points (nodes are obstacles, already-used cells cost extra) picks the
   route; turns are penalised so paths come out as long straight runs.
   ===================================================================== */
const ROUTES={};            // wireId -> svg path string
const TURN=4, USEDCOST=3, PAD=12*GRID, MAXCELLS=60000, LEFTBIAS=0.15;

function obstaclesOf(graph){
  return graph.nodes.map(n=>{ const s=nodeSize(n);
    return {x0:n.x, y0:n.y, x1:n.x+s.w, y1:n.y+s.h}; });
}
function blocked(obs,x,y){
  for(let k=0;k<obs.length;k++){ const o=obs[k];
    if(x>=o.x0&&x<=o.x1&&y>=o.y0&&y<=o.y1) return true; }
  return false;
}
/* --- min-heap ------------------------------------------------------- */
function Heap(){ this.a=[]; }
Heap.prototype.push=function(v){ const a=this.a; a.push(v); let i=a.length-1;
  while(i>0){ const p=(i-1)>>1; if(a[p].f<=a[i].f) break; [a[p],a[i]]=[a[i],a[p]]; i=p; } };
Heap.prototype.pop=function(){ const a=this.a, top=a[0], last=a.pop();
  if(a.length){ a[0]=last; let i=0; for(;;){ const l=2*i+1,r=l+1; let m=i;
    if(l<a.length&&a[l].f<a[m].f)m=l; if(r<a.length&&a[r].f<a[m].f)m=r; if(m===i)break; [a[m],a[i]]=[a[i],a[m]]; i=m; } }
  return top; };
Heap.prototype.size=function(){ return this.a.length; };

const DX=[GRID,0,-GRID,0], DY=[0,GRID,0,-GRID];   // 0:→ 1:↓ 2:← 3:↑

function aStar(s,t,obs,used){
  const minX=Math.min(s.x,t.x)-PAD, maxX=Math.max(s.x,t.x)+PAD;
  const minY=Math.min(s.y,t.y)-PAD, maxY=Math.max(s.y,t.y)+PAD;
  const nx=(maxX-minX)/GRID+1, ny=(maxY-minY)/GRID+1;
  if(nx*ny>MAXCELLS) return null;
  const h=(x,y)=>(Math.abs(x-t.x)+Math.abs(y-t.y))/GRID;
  const seen={}, open=new Heap();
  open.push({x:s.x,y:s.y,d:0,g:0,f:h(s.x,s.y),p:null});
  seen[s.x+','+s.y+','+0]=0;
  let best=null, guard=0;
  while(open.size()&&guard++<MAXCELLS*2){
    const c=open.pop();
    if(c.x===t.x&&c.y===t.y){ best=c; break; }
    for(let d=0;d<4;d++){
      const nx2=c.x+DX[d], ny2=c.y+DY[d];
      if(nx2<minX||nx2>maxX||ny2<minY||ny2>maxY) continue;
      if(blocked(obs,nx2,ny2)) continue;
      const vert=(d===1||d===3);
      const g=c.g+1+(d===c.d?0:TURN)+(used[nx2+','+ny2]||0)*USEDCOST
              +(vert? LEFTBIAS*(nx2-minX)/(maxX-minX+GRID) : 0);   // keep vertical runs to the left
      const k=nx2+','+ny2+','+d;
      if(seen[k]!==undefined&&seen[k]<=g) continue;
      seen[k]=g;
      open.push({x:nx2,y:ny2,d,g,f:g+h(nx2,ny2),p:c});
    }
  }
  if(!best) return null;
  const pts=[]; for(let c=best;c;c=c.p) pts.push({x:c.x,y:c.y});
  return pts.reverse();
}
function simplify(pts){
  const o=[pts[0]];
  for(let i=1;i<pts.length-1;i++){
    const a=o[o.length-1], b=pts[i], c=pts[i+1];
    if((a.x===b.x&&b.x===c.x)||(a.y===b.y&&b.y===c.y)) continue;   // collinear
    o.push(b);
  }
  o.push(pts[pts.length-1]);
  return o;
}
/* every corner becomes a 45 degree cut, half a unit by half a unit:
   stub -> chamfer -> shaft -> chamfer -> stub */
const CHAMF=GRID/2;
function polyPath(pts){
  if(pts.length<3) return 'M'+pts.map(p=>p.x+','+p.y).join(' L');
  let d='M'+pts[0].x+','+pts[0].y;
  for(let i=1;i<pts.length-1;i++){
    const a=pts[i-1], b=pts[i], c=pts[i+1];
    const l1=Math.hypot(b.x-a.x,b.y-a.y), l2=Math.hypot(c.x-b.x,c.y-b.y);
    const k1=Math.min(CHAMF,l1/2)/(l1||1), k2=Math.min(CHAMF,l2/2)/(l2||1);
    d+=' L'+(b.x+(a.x-b.x)*k1)+','+(b.y+(a.y-b.y)*k1);
    d+=' L'+(b.x+(c.x-b.x)*k2)+','+(b.y+(c.y-b.y)*k2);
  }
  const e=pts[pts.length-1];
  return d+' L'+e.x+','+e.y;
}
/* the canonical forward route: vertical shaft pushed as far left as it goes,
   one unit clear of the output port */
function directPts(p1,p2){
  if(p1.y===p2.y) return [p1,p2];
  const sx=p1.x+GRID;
  if(sx>p2.x-GRID) return null;                       // not enough room
  return [p1,{x:sx,y:p1.y},{x:sx,y:p2.y},p2];
}
function pathClear(pts,obs){
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    const sx=Math.sign(b.x-a.x)*GRID, sy=Math.sign(b.y-a.y)*GRID;
    let x=a.x, y=a.y, guard=0;
    while((x!==b.x||y!==b.y)&&guard++<3000){
      x+=sx; y+=sy;
      if(x===b.x&&y===b.y&&i===pts.length-2) break;   // last point sits on the target's edge
      if(blocked(obs,x,y)) return false;
    }
  }
  return true;
}
/* the direct shortcut is purely geometric — two wires that share a source
   port (a fan-out) compute the exact same shaft regardless of what else is
   already routed there, so without this check they'd draw on top of each
   other every time, not just in some unlucky edge case. Reject the shortcut
   once anything is already using a cell along it; the caller then falls
   through to the A* search below, which already treats used cells as
   expensive rather than forbidden and spaces the two runs apart. */
function pathClearOfWires(pts,used){
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    const sx=Math.sign(b.x-a.x)*GRID, sy=Math.sign(b.y-a.y)*GRID;
    let x=a.x, y=a.y, guard=0;
    while((x!==b.x||y!==b.y)&&guard++<3000){
      x+=sx; y+=sy;
      if(used[x+','+y]) return false;
    }
  }
  return true;
}
function quickPath(p1,p2,back){
  if(!back){
    const d=directPts(p1,p2);
    if(d) return polyPath(d);
    const mx=snap((p1.x+p2.x)/2);
    return polyPath(simplify([p1,{x:mx,y:p1.y},{x:mx,y:p2.y},p2]));
  }
  const y=Math.min(p1.y,p2.y)-GRID*2;
  return polyPath(simplify([p1,{x:p1.x+GRID,y:p1.y},{x:p1.x+GRID,y},{x:p2.x-GRID,y},{x:p2.x-GRID,y:p2.y},p2]));
}
function markUsed(used,pts){
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1], b=pts[i];
    const sx=Math.sign(b.x-a.x)*GRID, sy=Math.sign(b.y-a.y)*GRID;
    let x=a.x, y=a.y, guard=0;
    while((x!==b.x||y!==b.y)&&guard++<4000){ used[x+','+y]=(used[x+','+y]||0)+1; x+=sx; y+=sy; }
    used[b.x+','+b.y]=(used[b.x+','+b.y]||0)+1;
  }
}
function routeWire(graph,w,obs,used){
  const a=graph.nodes.find(n=>n.id===w.f[0]), b=graph.nodes.find(n=>n.id===w.t[0]);
  if(!a||!b) return '';
  const p1=portPos(a,'out',w.f[1]), p2=portPos(b,'in',w.t[1]);
  const back=isBack(graph,w);
  if(!back){
    const dp=directPts(p1,p2);
    if(dp&&pathClear(dp,obs)&&pathClearOfWires(dp,used)){ markUsed(used,dp); return polyPath(dp); }
    if(p2.x-p1.x<=2*GRID) return quickPath(p1,p2,false);
  }
  const s={x:p1.x+GRID,y:p1.y}, t={x:p2.x-GRID,y:p2.y};
  let pts=null;
  if(!blocked(obs,s.x,s.y)&&!blocked(obs,t.x,t.y)) pts=aStar(s,t,obs,used);
  if(!pts) return quickPath(p1,p2,back);
  const full=simplify([p1,...pts,p2]);
  markUsed(used,full);
  return polyPath(full);
}
function rerouteAll(){
  const g=G(), obs=obstaclesOf(g), used={};
  const order=g.wires.slice().sort((x,y)=>wLen(g,x)-wLen(g,y));
  for(const w of order) ROUTES[w.id]=routeWire(g,w,obs,used);
  updateWires();
}
function wLen(g,w){
  const a=g.nodes.find(n=>n.id===w.f[0]), b=g.nodes.find(n=>n.id===w.t[0]);
  if(!a||!b) return 0;
  const p1=portPos(a,'out',w.f[1]), p2=portPos(b,'in',w.t[1]);
  return Math.abs(p1.x-p2.x)+Math.abs(p1.y-p2.y);
}
