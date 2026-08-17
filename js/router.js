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

/* two ways to weigh a cell another wire already used this pass: `hard`
   forbids it outright (what actually keeps two routes from drawing on top
   of each other), `soft` just taxes it (USEDCOST) so a route still gets
   found even when every option is congested. routeWire() tries hard first
   and only falls back to soft if that leaves no path at all — a hard-only
   search that fails would otherwise drop straight to the naive quickPath,
   which isn't congestion-aware at all and produces worse overlap than the
   soft pass would have. */
function aStar(s,t,obs,used,hard){
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
      const u=used[nx2+','+ny2]||0;
      if(hard&&u) continue;
      const vert=(d===1||d===3);
      const g=c.g+1+(d===c.d?0:TURN)+(hard?0:u*USEDCOST)
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
/* sharp right-angle corners — no 45-degree chamfer. Wires are node-like now
   (see the wiretap junction in editor.js), so a corner is just a corner, not
   a visual cue about connection shape. */
function polyPath(pts){
  return 'M'+pts.map(p=>p.x+','+p.y).join(' L');
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
    /* used to bail out to quickPath here whenever the two ports were close
       together (p2.x-p1.x<=2*GRID) — but quickPath recomputes the exact same
       direct geometry the congestion check above just rejected, so a busy
       source port never actually got rerouted, just redrawn on top of
       whatever was already there. Let it fall through to the real A* search
       below instead; that still degrades to quickPath at the very end if
       even A* can't find room, but only then. */
  }
  const s={x:p1.x+GRID,y:p1.y}, t={x:p2.x-GRID,y:p2.y};
  let pts=null;
  if(!blocked(obs,s.x,s.y)&&!blocked(obs,t.x,t.y)){
    pts=aStar(s,t,obs,used,true);
    if(!pts) pts=aStar(s,t,obs,used,false);
  }
  if(!pts) return quickPath(p1,p2,back);
  const full=simplify([p1,...pts,p2]);
  markUsed(used,full);
  return polyPath(full);
}
function parsePts(d){
  const nums=d.match(/-?\d+(\.\d+)?/g).map(Number);
  const pts=[]; for(let i=0;i<nums.length;i+=2) pts.push({x:nums[i],y:nums[i+1]});
  return pts;
}
/* ---- lane offsets: whenever two different wires' routes coincide for a
   stretch — because they share a source port (the port's own pixel sits
   inside the node's obstacle box, so every route nudges one grid unit clear
   of it before anything else is decided, and two wires doing that from the
   same point land on the same cells) or just because the solver happened to
   pick the same corridor independently — nudge each of the coinciding wires
   a few px to either side so the picture reads as separate parallel wires,
   never one drawn on top of another. Only the actually-contested cells
   move; anywhere a wire runs alone it stays exactly on-grid. This replaces
   an earlier junction-dot marker for the shared-port case — the user wanted
   wires kept visually apart even when they *do* connect, not explained away
   with a symbol. */
const LANEPX=3;
function cellWalk(pts){
  const cells=[pts[0]];
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    const sx=Math.sign(b.x-a.x)*GRID, sy=Math.sign(b.y-a.y)*GRID;
    let x=a.x,y=a.y,guard=0;
    while((x!==b.x||y!==b.y)&&guard++<3000){ x+=sx; y+=sy; cells.push({x,y}); }
  }
  return cells;
}
function edgeKey(a,b){
  return (a.x<b.x||(a.x===b.x&&a.y<b.y)) ? a.x+','+a.y+'|'+b.x+','+b.y : b.x+','+b.y+'|'+a.x+','+a.y;
}
const VISPTS={};              // wireId -> lane-offset-adjusted, simplified point list
function computeVisualPaths(g){
  for(const k in VISPTS) delete VISPTS[k];
  const cellsByWire={};
  for(const w of g.wires){
    const d=ROUTES[w.id]; if(!d) continue;
    cellsByWire[w.id]=cellWalk(parsePts(d));
  }
  const edgeWires={};
  for(const id in cellsByWire){
    const cells=cellsByWire[id];
    for(let i=0;i<cells.length-1;i++){
      const k=edgeKey(cells[i],cells[i+1]);
      (edgeWires[k]=edgeWires[k]||new Set()).add(id);
    }
  }
  for(const id in cellsByWire){
    const cells=cellsByWire[id];
    if(cells.length<2){ VISPTS[id]=cells; continue; }
    const out=[];
    for(let i=0;i<cells.length-1;i++){
      const a=cells[i], b=cells[i+1];
      const ids=edgeWires[edgeKey(a,b)];
      let off=0;
      if(ids.size>1){
        const arr=[...ids].sort();
        off=(arr.indexOf(id)-(arr.length-1)/2)*LANEPX;
      }
      const horiz=a.y===b.y;
      out.push(horiz?{x:a.x,y:a.y+off}:{x:a.x+off,y:a.y});
      out.push(horiz?{x:b.x,y:b.y+off}:{x:b.x+off,y:b.y});
    }
    VISPTS[id]=simplify(out);
  }
}
/* ---- crossings: the wire "going under" gets a small gap right where it
   passes beneath the other, like a real wire dipping under one it doesn't
   connect to. Crossing (not overlap/lane-sharing — that's handled above) is
   two perpendicular segments from different wires meeting at a single
   interior point. Which one gets the gap doesn't need to mean anything,
   just be the same every time the same pair crosses, so the picture doesn't
   flicker between renders — comparing wire ids is a cheap, stable way to
   get that. Operates on the lane-offset VISPTS, not the raw grid ROUTES, so
   a gap lands on the geometry actually being drawn. */
const GAPS={};                // wireId -> [{point:{x,y}, segIdx}] (segIdx into VISPTS)
const HOPGAP=6;                // px pulled back on each side of a crossing
function computeCrossingGaps(g){
  for(const k in GAPS) delete GAPS[k];
  const segsByWire={};
  for(const w of g.wires){
    const pts=VISPTS[w.id]; if(!pts) continue;
    const segs=[];
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      if(a.x===b.x&&a.y===b.y) continue;
      segs.push({segIdx:i,a,b,horiz:a.y===b.y});
    }
    segsByWire[w.id]=segs;
  }
  const ids=Object.keys(segsByWire);
  for(let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++){
    const wa=ids[i], wb=ids[j];
    for(const sa of segsByWire[wa]) for(const sb of segsByWire[wb]){
      if(sa.horiz===sb.horiz) continue;              // parallel segments running together are lane-offset above, not gapped
      const h=sa.horiz?sa:sb, v=sa.horiz?sb:sa;
      const hWire=sa.horiz?wa:wb, vWire=sa.horiz?wb:wa;
      const hy=h.a.y, hx0=Math.min(h.a.x,h.b.x), hx1=Math.max(h.a.x,h.b.x);
      const vx=v.a.x, vy0=Math.min(v.a.y,v.b.y), vy1=Math.max(v.a.y,v.b.y);
      if(vx>hx0&&vx<hx1&&hy>vy0&&hy<vy1){             // strictly interior — a shared endpoint is a corner/port, not a crossing
        const under=hWire<vWire?hWire:vWire;
        const underSeg=under===hWire?h:v;
        (GAPS[under]=GAPS[under]||[]).push({point:{x:vx,y:hy},segIdx:underSeg.segIdx});
      }
    }
  }
}
/* the display path for a wire: the lane-offset route, with a short gap cut
   into it at each point it passes under another wire. Kept separate from
   ROUTES (the real, continuous on-grid geometry) so hit-testing, length/
   midpoint math and value-hover keep working off an unbroken, exact path —
   only the visible stroke gets lane offsets and gaps. */
function gappedD(wireId){
  const pts=VISPTS[wireId]; if(!pts) return ROUTES[wireId];
  const gapList=GAPS[wireId];
  if(!gapList||!gapList.length) return 'M'+pts.map(p=>p.x+','+p.y).join(' L');
  const bySeg={};
  for(const gp of gapList) (bySeg[gp.segIdx]=bySeg[gp.segIdx]||[]).push(gp.point);
  let out='M'+pts[0].x+','+pts[0].y;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    const here=bySeg[i];
    if(!here||!here.length){ out+=' L'+b.x+','+b.y; continue; }
    const segLen=Math.hypot(b.x-a.x,b.y-a.y);
    const hg=Math.min(HOPGAP,segLen/3);
    const ux=(b.x-a.x)/segLen, uy=(b.y-a.y)/segLen;
    const along=p=>(p.x-a.x)*ux+(p.y-a.y)*uy;
    here.sort((p,q)=>along(p)-along(q));
    for(const p of here){
      out+=' L'+(p.x-ux*hg)+','+(p.y-uy*hg);
      out+=' M'+(p.x+ux*hg)+','+(p.y+uy*hg);
    }
    out+=' L'+b.x+','+b.y;
  }
  return out;
}
function rerouteAll(){
  const g=G(), obs=obstaclesOf(g), used={};
  const order=g.wires.slice().sort((x,y)=>wLen(g,x)-wLen(g,y));
  for(const w of order) ROUTES[w.id]=routeWire(g,w,obs,used);
  computeVisualPaths(g);
  computeCrossingGaps(g);
  updateWires();
}
function wLen(g,w){
  const a=g.nodes.find(n=>n.id===w.f[0]), b=g.nodes.find(n=>n.id===w.t[0]);
  if(!a||!b) return 0;
  const p1=portPos(a,'out',w.f[1]), p2=portPos(b,'in',w.t[1]);
  return Math.abs(p1.x-p2.x)+Math.abs(p1.y-p2.y);
}
