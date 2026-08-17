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
   soft pass would have.

   `free` is the exception to both: cells an earlier-routed wire from this
   wire's OWN source port already used. Without it, every fan-out sibling
   actively avoids the shared trunk exactly where it should be extending
   it — congestion cost exists to keep unrelated wires apart, but treating
   your own branch's trunk as congestion sends later siblings on unrelated
   detours in search of "clear" ground that was never really contested,
   which reads as a tangle even though each individual route is a locally
   sane, deterministic result of the search. Free cells cost the same as
   never having been touched at all, so a sibling naturally keeps following
   the existing trunk for as long as it's actually going its way, and only
   peels off once its own target pulls it elsewhere. */
function aStar(s,t,obs,used,hard,free){
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
      const key=nx2+','+ny2;
      const u=(free&&free.has(key))?0:(used[key]||0);
      if(hard&&u) continue;
      const vert=(d===1||d===3);
      const g=c.g+1+(d===c.d?0:TURN)+(hard?0:u*USEDCOST)
              +(vert? LEFTBIAS*(nx2-minX)/(maxX-minX+GRID) : 0);   // keep vertical runs to the left
      const k=key+','+d;
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
/* sharp right-angle corners — no 45-degree chamfer. A wire can branch to
   feed several inputs now (see the fan-out trimming below), so a corner is
   just a corner, not a visual cue about connection shape. */
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
function pathClearOfWires(pts,used,free){
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    const sx=Math.sign(b.x-a.x)*GRID, sy=Math.sign(b.y-a.y)*GRID;
    let x=a.x, y=a.y, guard=0;
    while((x!==b.x||y!==b.y)&&guard++<3000){
      x+=sx; y+=sy;
      const key=x+','+y;
      if(used[key]&&!(free&&free.has(key))) return false;
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
function routeWire(graph,w,obs,used,free){
  const a=graph.nodes.find(n=>n.id===w.f[0]), b=graph.nodes.find(n=>n.id===w.t[0]);
  if(!a||!b) return '';
  const p1=portPos(a,'out',w.f[1]), p2=portPos(b,'in',w.t[1]);
  const back=isBack(graph,w);
  if(!back){
    const dp=directPts(p1,p2);
    if(dp&&pathClear(dp,obs)&&pathClearOfWires(dp,used,free)){ markUsed(used,dp); return polyPath(dp); }
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
    pts=aStar(s,t,obs,used,true,free);
    if(!pts) pts=aStar(s,t,obs,used,false,free);
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
function cellWalk(pts){
  if(!pts.length) return [];
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
/* ---- lane offsets: whenever two different wires' routes run collinear for
   a stretch — because they share a source port (the port's own pixel sits
   inside the node's obstacle box, so every route nudges one grid unit clear
   of it before anything else is decided, and two wires doing that from the
   same point land on the same line) or just because the solver happened to
   pick the same corridor independently — the whole straight shaft that's in
   conflict moves a full grid unit to one side, not just the pixels where it
   happens to coincide: a partial, mid-shaft nudge would read as a rendering
   glitch, a whole-shaft jog at a grid unit reads as a deliberate lane.
   Offsets are chosen nearest-to-original first and skip any position that
   would run the shaft through — or flush against — a block, so a wire that
   happens to run alongside one always keeps the same one-grid clearance the
   router already gives it elsewhere, and never gets crowded up against it
   just because a lane needed to move. The segment right at a real port is
   never moved, so every wire still visibly lands exactly on the port it's
   drawn from. This replaced an earlier junction-dot marker for the shared-
   port case — the user wanted wires kept visually apart even when they *do*
   connect, not explained away with a symbol — and a still-earlier sub-pixel
   version of this same idea, which only offset the exact contested cells
   and moved by a few px instead of a full grid step. */
const LANESTEP=GRID, LANECAP=2;   // look at most 2 grid units either side before giving up on finding a clear lane
function segsOf(wireId){
  const d=ROUTES[wireId]; if(!d) return [];
  const pts=parsePts(d), segs=[];
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    if(a.x===b.x&&a.y===b.y) continue;
    segs.push({segIdx:i,a,b,horiz:a.y===b.y});
  }
  return segs;
}
function segLine(s){ return s.horiz? 'h'+s.a.y : 'v'+s.a.x; }
function segRange(s){ return s.horiz? [Math.min(s.a.x,s.b.x),Math.max(s.a.x,s.b.x)] : [Math.min(s.a.y,s.b.y),Math.max(s.a.y,s.b.y)]; }
function laneClear(horiz,coord,range,obs){
  const [r0,r1]=range;
  for(let p=r0;p<=r1;p+=GRID){
    if(blocked(obs, horiz?p:coord, horiz?coord:p)) return false;
  }
  return true;
}
const VISPTS={};              // wireId -> lane-offset-adjusted, simplified point list
function computeVisualPaths(g){
  for(const k in VISPTS) delete VISPTS[k];
  const obs=obstaclesOf(g);
  const sourceOf={};
  for(const w of g.wires) sourceOf[w.id]=w.f[0]+':'+w.f[1];
  const segsByWire={};
  for(const w of g.wires) segsByWire[w.id]=segsOf(w.id);
  /* only interior segments (not the one touching either real endpoint) are
     ever eligible to move, so a wire always still visibly lands on its
     actual ports. */
  const byLine={};
  for(const id in segsByWire){
    const segs=segsByWire[id];
    segs.forEach((s,i)=>{
      if(i===0||i===segs.length-1) return;
      (byLine[segLine(s)]=byLine[segLine(s)]||[]).push({wireId:id,seg:s});
    });
  }
  const offsetOf={};   // wireId -> segIdx -> px offset
  for(const line in byLine){
    const entries=byLine[line];
    if(entries.length<2) continue;
    /* union-find: any two DIFFERENT wires whose ranges on this line overlap
       land in the same group, transitively — three wires that overlap in a
       staggered chain (A-B, B-C, no direct A-C) still need to be told apart
       from each other, not just from their immediate neighbour. Wires from
       the very same source port are excluded here on purpose — that's a
       fan-out, one wire visually branching, not two wires that happen to
       collide; computeFanOutTrim() below draws their shared run exactly
       once instead of shifting them apart into separate lanes. */
    const parent=entries.map((_,i)=>i);
    const find=x=>{ while(parent[x]!==x){ parent[x]=parent[parent[x]]; x=parent[x]; } return x; };
    for(let i=0;i<entries.length;i++) for(let j=i+1;j<entries.length;j++){
      if(entries[i].wireId===entries[j].wireId) continue;
      if(sourceOf[entries[i].wireId]===sourceOf[entries[j].wireId]) continue;
      const [a0,a1]=segRange(entries[i].seg), [b0,b1]=segRange(entries[j].seg);
      if(Math.max(a0,b0)<Math.min(a1,b1)){ const ri=find(i), rj=find(j); if(ri!==rj) parent[ri]=rj; }
    }
    const groups={};
    entries.forEach((e,i)=>{ const r=find(i); (groups[r]=groups[r]||[]).push(e); });
    const horiz=line[0]==='h', baseCoord=parseFloat(line.slice(1));
    for(const gk in groups){
      const group=groups[gk];
      const wireIds=[...new Set(group.map(e=>e.wireId))].sort();
      if(wireIds.length<2) continue;      // everything here belongs to one wire — no conflict, nothing to move
      const taken=new Set();
      for(const wid of wireIds){
        const wSegs=group.filter(e=>e.wireId===wid).map(e=>e.seg);
        let chosen=null;
        /* a couple of lanes out is a deliberate, readable jog; searching
           indefinitely for *any* clear lane can walk a wire clean around a
           whole cluster of blocks looking for one, which reads as far more
           broken than the small overlap it was trying to avoid — better to
           leave a short, local overlap between two wires than send one on a
           detour through unrelated geometry to eliminate it. */
        outer: for(let k=0;k<=LANECAP;k++){
          for(const cand of (k===0?[0]:[k*LANESTEP,-k*LANESTEP])){
            if(taken.has(cand)) continue;
            const clear=wSegs.every(s=>laneClear(horiz,baseCoord+cand,segRange(s),obs));
            if(clear){ chosen=cand; break outer; }
          }
        }
        if(chosen===null) chosen=0;   // no clear lane nearby — leave it where the router put it rather than detour around unrelated blocks to find one
        taken.add(chosen);
        for(const s of wSegs) (offsetOf[wid]=offsetOf[wid]||{})[s.segIdx]=chosen;
      }
    }
  }
  for(const id in segsByWire){
    const segs=segsByWire[id];
    if(!segs.length){ VISPTS[id]=ROUTES[id]?parsePts(ROUTES[id]):[]; continue; }
    const wOff=offsetOf[id]||{}, out=[];
    for(const s of segs){
      const off=wOff[s.segIdx]||0;
      out.push(s.horiz?{x:s.a.x,y:s.a.y+off}:{x:s.a.x+off,y:s.a.y});
      out.push(s.horiz?{x:s.b.x,y:s.b.y+off}:{x:s.b.x+off,y:s.b.y});
    }
    VISPTS[id]=simplify(out);
  }
}
/* ---- fan-out: a wire node is not a node at all — a wire read by more than
   one input is one wire that visually branches, exactly like a real wire
   splitting at a junction, with a hidden variable behind it rather than a
   hidden block. That variable already exists: codegen assigns every
   block's output to its own named slot (outVar() in codegen.js) regardless
   of how many wires read it, so N wires sharing a source port were always
   reading the same computed value — nothing needed to change there. What
   needed to change is the drawing: N independently-routed wires from the
   same port naturally retrace much of the same ground (they start at the
   same point and the router tends to find similar cheap paths), and drawing
   all of it N times is what read as overlap. The wire with the longest
   route claims cells first, so it owns the full extent of the shared
   trunk; every shorter sibling then only draws the cells nothing else has
   claimed yet, which is exactly its own short branch peeling off that
   trunk. Claiming shortest-first instead (e.g. by wire id, arbitrary
   relative to distance) can leave a short wire's stub as the "trunk" and
   force a longer sibling to find its own way for the remaining distance,
   which reads as an early, unmotivated split right after the source
   instead of one long trunk with branches peeling off along its length. */
const TRIMPTS={};             // wireId -> point list with {brk:true} run breaks; what's actually drawn
function simplifyRuns(pts){
  const runs=[]; let cur=[];
  for(const p of pts){ if(p.brk){ if(cur.length) runs.push(cur); cur=[]; } else cur.push(p); }
  if(cur.length) runs.push(cur);
  const out=[];
  for(const run of runs){
    if(out.length) out.push({brk:true});
    out.push(...(run.length>=2?simplify(run):run));
  }
  return out;
}
function computeFanOutTrim(g){
  for(const k in TRIMPTS) delete TRIMPTS[k];
  const bySource={};
  for(const w of g.wires){ const key=w.f[0]+':'+w.f[1]; (bySource[key]=bySource[key]||[]).push(w.id); }
  for(const key in bySource){
    const ids=bySource[key];
    if(ids.length<2){ TRIMPTS[ids[0]]=(VISPTS[ids[0]]||[]).slice(); continue; }
    const withLen=ids.map(id=>({id,len:cellWalk(VISPTS[id]||[]).length}));
    withLen.sort((a,b)=>b.len-a.len || (a.id<b.id?-1:1));   // longest route first; id just breaks exact ties
    const sorted=withLen.map(x=>x.id);
    const claimed=new Set();
    for(const id of sorted){
      const pts=VISPTS[id];
      if(!pts||pts.length<2){ TRIMPTS[id]=pts||[]; continue; }
      const cells=cellWalk(pts);
      const out=[]; let runOpen=false;
      for(let i=0;i<cells.length-1;i++){
        const a=cells[i], b=cells[i+1];
        const ek=edgeKey(a,b);
        if(claimed.has(ek)){ runOpen=false; continue; }
        claimed.add(ek);
        if(!runOpen){ if(out.length) out.push({brk:true}); out.push(a); runOpen=true; }
        out.push(b);
      }
      TRIMPTS[id]=simplifyRuns(out);
    }
  }
}
/* ---- crossings: the wire "going under" gets a small gap right where it
   passes beneath the other, like a real wire dipping under one it doesn't
   connect to. Crossing (not overlap/lane-sharing/fan-out — those are handled
   above) is two perpendicular segments from different wires meeting at a
   single interior point. Which one gets the gap doesn't need to mean
   anything, just be the same every time the same pair crosses, so the
   picture doesn't flicker between renders — comparing wire ids is a cheap,
   stable way to get that. Operates on TRIMPTS (post lane-offset, post fan-
   out trim) so a gap lands on the geometry actually being drawn — a run
   break from trimming just means no segment spans it, same as a corner. */
const GAPS={};                // wireId -> [{point:{x,y}, segIdx}] (segIdx into TRIMPTS)
/* small enough that both stubs stay visible even when a crossing sits close
   to one end of a short segment — e.g. right where the "under" wire is
   about to turn into the port of a block it's running alongside. A wider
   gap could eat the whole short side and look like the wire just stopped
   instead of visibly passing under and re-emerging. */
const HOPGAP=3;                // px pulled back on each side of a crossing
function computeCrossingGaps(g){
  for(const k in GAPS) delete GAPS[k];
  const segsByWire={};
  for(const w of g.wires){
    const pts=TRIMPTS[w.id]; if(!pts) continue;
    const segs=[];
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      if(a.brk||b.brk) continue;              // no segment spans a run break
      if(a.x===b.x&&a.y===b.y) continue;
      segs.push({segIdx:i,a,b,horiz:a.y===b.y});
    }
    segsByWire[w.id]=segs;
  }
  const ids=Object.keys(segsByWire);
  for(let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++){
    const wa=ids[i], wb=ids[j];
    for(const sa of segsByWire[wa]) for(const sb of segsByWire[wb]){
      if(sa.horiz===sb.horiz) continue;              // parallel segments running together are lane-offset/trimmed above, not gapped
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
/* the display path for a wire: TRIMPTS (its own share of a fan-out net,
   lane-offset where it runs alongside an unrelated wire), with a short gap
   cut in at each point it passes under another wire and a fresh M at every
   run break. Kept separate from ROUTES (the real, continuous on-grid
   geometry) so hit-testing, length/midpoint math and value-hover keep
   working off an unbroken, exact path — only the visible stroke is split
   into branches, offset, and gapped. */
function gappedD(wireId){
  const pts=TRIMPTS[wireId]; if(!pts||!pts.length) return ROUTES[wireId];
  const gapList=GAPS[wireId];
  const bySeg={};
  if(gapList) for(const gp of gapList) (bySeg[gp.segIdx]=bySeg[gp.segIdx]||[]).push(gp.point);
  let out='', started=false, prev=null;
  for(let i=0;i<pts.length;i++){
    const cur=pts[i];
    if(cur.brk){ started=false; prev=null; continue; }
    if(!started){ out+=(out?' M':'M')+cur.x+','+cur.y; started=true; prev=cur; continue; }
    const a=prev, b=cur;
    const here=bySeg[i-1];
    if(!here||!here.length){ out+=' L'+b.x+','+b.y; prev=cur; continue; }
    const segLen=Math.hypot(b.x-a.x,b.y-a.y);
    const hg=Math.min(HOPGAP,segLen/3);
    const ux=(b.x-a.x)/segLen, uy=(b.y-a.y)/segLen;
    const along=q=>(q.x-a.x)*ux+(q.y-a.y)*uy;
    here.sort((q,r)=>along(q)-along(r));
    for(const gp of here){
      out+=' L'+(gp.x-ux*hg)+','+(gp.y-uy*hg);
      out+=' M'+(gp.x+ux*hg)+','+(gp.y+uy*hg);
    }
    out+=' L'+b.x+','+b.y;
    prev=cur;
  }
  return out;
}
function rerouteAll(){
  const g=G(), obs=obstaclesOf(g), used={};
  /* per-source-port cell sets, so a fan-out sibling routed later sees its
     own trunk as free (see aStar's `free` param) without affecting how it
     treats anyone else's wires. */
  const bySource={};
  const order=g.wires.slice().sort((x,y)=>wLen(g,x)-wLen(g,y));
  for(const w of order){
    const srcKey=w.f[0]+':'+w.f[1];
    const d=routeWire(g,w,obs,used,bySource[srcKey]);
    ROUTES[w.id]=d;
    const set=bySource[srcKey]=bySource[srcKey]||new Set();
    for(const c of cellWalk(parsePts(d))) set.add(c.x+','+c.y);
  }
  computeVisualPaths(g);
  computeFanOutTrim(g);
  computeCrossingGaps(g);
  updateWires();
}
function wLen(g,w){
  const a=g.nodes.find(n=>n.id===w.f[0]), b=g.nodes.find(n=>n.id===w.t[0]);
  if(!a||!b) return 0;
  const p1=portPos(a,'out',w.f[1]), p2=portPos(b,'in',w.t[1]);
  return Math.abs(p1.x-p2.x)+Math.abs(p1.y-p2.y);
}
