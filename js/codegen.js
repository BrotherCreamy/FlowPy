'use strict';
/* =====================================================================
   FlowPy — MicroPython code generator
   ===================================================================== */
const GEN={full:'',patch:'',blocks:{},mainBlock:null,pathInfo:{},instPaths:{},nw:0,err:null};

const pid = s => String(s).replace(/\W/g,'_');
const cname = t => (t.impl==='graph'?'G_':(t.kind==='FB'?'FB_':'F_'))+pid(t.id);
const outVar = (n,i)=> 'v'+pid(n.id)+'_'+i;
function pyLit(v,type){
  if(type==='str') return JSON.stringify(String(v??''));
  if(type==='bool') return (v===true||v==='true'||v===1)?'True':'False';
  if(type==='int'){ const x=parseInt(v); return String(isNaN(x)?0:x); }
  const x=Number(v); return String(isNaN(x)?0:x);
}
function ind(s,n){ const p=' '.repeat(n); const b=String(s??'').replace(/\t/g,'    ');
  if(!b.trim()) return p+'pass';
  return b.split('\n').map(l=>l.trim()===''?'':p+l).join('\n'); }

function syncIOFor(t){
  const g=t.graph||(t.graph={nodes:[],wires:[]}); const keep=[];
  (t.ins||[]).forEach((p,i)=>{ let n=g.nodes.find(n=>n.k==='gin'&&n.pi===i);
    if(!n){ n={id:uid('n'),k:'gin',pi:i,owner:t.id,x:-180,y:40+i*80}; g.nodes.push(n);} n.owner=t.id; keep.push(n.id); });
  (t.outs||[]).forEach((p,i)=>{ let n=g.nodes.find(n=>n.k==='gout'&&n.pi===i);
    if(!n){ n={id:uid('n'),k:'gout',pi:i,owner:t.id,x:480,y:40+i*80}; g.nodes.push(n);} n.owner=t.id; keep.push(n.id); });
  const dead=g.nodes.filter(n=>(n.k==='gin'||n.k==='gout')&&!keep.includes(n.id)).map(n=>n.id);
  if(dead.length){ g.nodes=g.nodes.filter(n=>!dead.includes(n.id));
    g.wires=g.wires.filter(w=>!dead.includes(w.f[0])&&!dead.includes(w.t[0])); }
}

/* ---- slot layout ------------------------------------------------- */
function graphBlock(graph,seen){
  let off=0; const local={}, child={};
  for(const n of graph.nodes) portsOf(n).outs.forEach((p,i)=>{ local[n.id+':'+i]=off++; });
  for(const n of graph.nodes){ if(n.k!=='blk') continue; const t=typeOf(n.type);
    if(t&&!t.builtin&&t.impl==='graph'){ const b=blockOf(t.id,seen); child[n.id]=off; off+=b.size; } }
  return {size:off,local,child};
}
function blockOf(typeId,seen){
  seen=seen||new Set();
  if(GEN.blocks[typeId]) return GEN.blocks[typeId];
  if(seen.has(typeId)) throw new Error('recursive block type: '+(P_.types[typeId]||{}).name);
  seen.add(typeId);
  const t=P_.types[typeId]; if(!t) throw new Error('missing type '+typeId);
  const b=graphBlock(t.graph||{nodes:[],wires:[]},seen);
  seen.delete(typeId); GEN.blocks[typeId]=b; return b;
}

/* ---- graph body emitter ------------------------------------------ */
let BACKW=new Set();                       // wire ids evaluated from last scan
const zVar = (nid,i)=> 'z'+pid(nid)+'_'+i;
const zAttr= (nid,i)=> '_z'+pid(nid)+'_'+i;
function inExpr(graph,n,i){
  const w=graph.wires.find(w=>w.t[0]===n.id&&w.t[1]===i);
  if(w){ const s=graph.nodes.find(x=>x.id===w.f[0]);
    if(s) return BACKW.has(w.id)? zVar(s.id,w.f[1]) : outVar(s,w.f[1]); }
  const p=portsOf(n).ins[i];
  return (p&&p.type==='bool')?'False':'0';
}
/* every output port that feeds at least one right-to-left wire */
function zPorts(graph){
  const m=new Map();
  for(const w of graph.wires){
    if(!isBack(graph,w)) continue;
    const s=graph.nodes.find(x=>x.id===w.f[0]); if(!s) continue;
    const p=portsOf(s).outs[w.f[1]];
    m.set(w.f[0]+':'+w.f[1], {nid:w.f[0], i:w.f[1], type:p?p.type:'any'});
  }
  return [...m.values()];
}
function isBreaker(n){ if(n.k!=='blk') return false; const t=typeOf(n.type); return !!(t&&t.breaker); }

function emitGraph(graph,block,ctx){
  const L=[]; const post=[];
  const nodes=graph.nodes;
  BACKW=new Set(graph.wires.filter(w=>isBack(graph,w)).map(w=>w.id));
  const zs=zPorts(graph);
  for(const z of zs) L.push(`${zVar(z.nid,z.i)} = self.${zAttr(z.nid,z.i)}`);
  /* topological order, ignoring edges into breaker nodes */
  const deg={}, adj={};
  nodes.forEach(n=>{deg[n.id]=0;adj[n.id]=[];});
  for(const w of graph.wires){
    const d=nodes.find(n=>n.id===w.t[0]), s=nodes.find(n=>n.id===w.f[0]);
    if(!d||!s||isBreaker(d)||BACKW.has(w.id)) continue;   // back wires are not dependencies
    adj[s.id].push(d.id); deg[d.id]++;
  }
  const q=nodes.filter(n=>deg[n.id]===0).map(n=>n.id); const order=[];
  while(q.length){ const id=q.shift(); order.push(id);
    for(const m of adj[id]) if(--deg[m]===0) q.push(m); }
  if(order.length!==nodes.length){
    const bad=nodes.filter(n=>!order.includes(n.id)).map(n=>nodeTitle(n)).join(', ');
    throw new Error('unresolvable loop (blocks overlap?): '+bad);
  }
  const slot=(n,i)=>block.local[n.id+':'+i];
  const wr=(n,i,expr)=>{ const o=slot(n,i); if(o===undefined) return null;
    const p=portsOf(n).outs[i]; const num=(p&&p.type!=='bool');
    return `W[_b+${o}] = `+(num?`_r(${expr})`:expr); };

  /* breaker pre-reads first */
  for(const n of nodes){ if(!isBreaker(n)) continue;
    const t=typeOf(n.type); const vs=(t.outs||[]).map((p,i)=>outVar(n,i));
    L.push(`${vs.join(', ')} = self.${pid(n.id)}.pre()`);
    (t.outs||[]).forEach((p,i)=>{const s=wr(n,i,outVar(n,i)); if(s)L.push(s);});
    const ins=(t.ins||[]).map((p,i)=>inExpr(graph,n,i));
    post.push(`self.${pid(n.id)}.post(${ins.join(', ')})`);
  }
  const outsExpr=[];
  for(const id of order){
    const n=nodes.find(x=>x.id===id); if(isBreaker(n)) continue;
    if(n.k==='const'){ L.push(`${outVar(n,0)} = ${String(n.value).trim()||'0'}`); const s=wr(n,0,outVar(n,0)); if(s)L.push(s); continue; }
    if(n.k==='gin'){ L.push(`${outVar(n,0)} = ${ctx.args[n.pi]}`); const s=wr(n,0,outVar(n,0)); if(s)L.push(s); continue; }
    if(n.k==='gout'){ outsExpr[n.pi]=inExpr(graph,n,0); continue; }
    if(n.k==='vget'){ L.push(`${outVar(n,0)} = V.${pid(n.varName)}`); const s=wr(n,0,outVar(n,0)); if(s)L.push(s); continue; }
    if(n.k==='vset'){ L.push(`V.${pid(n.varName)} = ${inExpr(graph,n,0)}`); continue; }
    if(n.k!=='blk') continue;
    const t=typeOf(n.type); if(!t) throw new Error('node '+n.id+' has unknown type');
    const ins=(t.ins||[]).map((p,i)=>inExpr(graph,n,i));
    const outs=t.outs||[];
    let call;
    if(t.impl==='graph') call=`self.${pid(n.id)}.step(_b+${block.child[n.id]}${ins.length?', '+ins.join(', '):''})`;
    else if(t.kind==='FB') call=`self.${pid(n.id)}.step(${ins.join(', ')})`;
    else { const ps=(t.params||[]).map(p=>pyLit(n.params?n.params[p.name]:p.def,p.type));
           call=`F_${pid(t.id)}(${ps.concat(ins).join(', ')})`; }
    if(outs.length===0) L.push(call);
    else L.push(`${outs.map((p,i)=>outVar(n,i)).join(', ')} = ${call}`);
    outs.forEach((p,i)=>{const s=wr(n,i,outVar(n,i)); if(s)L.push(s);});
  }
  L.push(...post);
  for(const z of zs) L.push(`self.${zAttr(z.nid,z.i)} = ${outVar({id:z.nid},z.i)}`);
  if(ctx.returns){ const vals=(ctx.returns).map((p,i)=>outsExpr[i]!==undefined?outsExpr[i]:(p.type==='bool'?'False':'0'));
    if(vals.length) L.push('return '+vals.join(', ')); }
  return L.length?L:['pass'];
}

function emitEnsure(graph,fname){
  const L=[];
  for(const z of zPorts(graph))
    L.push(`if not hasattr(self, '${zAttr(z.nid,z.i)}'): self.${zAttr(z.nid,z.i)} = ${z.type==='bool'?'False':'0'}`);
  for(const n of graph.nodes){ if(n.k!=='blk') continue; const t=typeOf(n.type); if(!t||t.kind==='F'&&t.impl!=='graph') continue;
    const cn=cname(t);
    if(t.impl==='graph'){ L.push(`if not hasattr(self, '${pid(n.id)}'): self.${pid(n.id)} = ${cn}()`);
      L.push(`self.${pid(n.id)}.ensure()`); }
    else { const ps=(t.params||[]).map(p=>pyLit(n.params?n.params[p.name]:p.def,p.type));
      L.push(`if not hasattr(self, '${pid(n.id)}'): self.${pid(n.id)} = ${cn}(${ps.join(', ')})`); }
  }
  return L.length?L:['pass'];
}

/* ---- collect reachable types -------------------------------------- */
function collectTypes(graph,set){
  for(const n of graph.nodes){ if(n.k!=='blk') continue; const t=typeOf(n.type); if(!t||set.has(t.id)) continue;
    set.add(t.id); if(t.impl==='graph') collectTypes(t.graph||{nodes:[],wires:[]},set); }
  return set;
}

/* ---- full generation ---------------------------------------------- */
function generate(){
  GEN.blocks={}; GEN.pathInfo={}; GEN.instPaths={}; GEN.err=null;
  Object.values(P_.types).forEach(syncIOFor); tagProject(P_);
  const used=collectTypes(P_.main,new Set());
  GEN.mainBlock=graphBlock(P_.main,new Set());
  GEN.varBase=GEN.mainBlock.size;
  (function walk(graph,base,path,typeId){
    GEN.pathInfo[path]={typeId,base};
    if(typeId)(GEN.instPaths[typeId]=GEN.instPaths[typeId]||[]).push(path);
    const block=typeId?GEN.blocks[typeId]:GEN.mainBlock;
    for(const n of graph.nodes){ if(n.k!=='blk')continue; const t=typeOf(n.type);
      if(t&&!t.builtin&&t.impl==='graph') walk(t.graph,base+block.child[n.id],(path?path+'/':'')+n.id,t.id); }
  })(P_.main,0,'',null);
  GEN.nw=GEN.varBase+P_.vars.length;

  const defs=[];
  for(const id of used){
    const t=typeOf(id);
    if(t.impl==='graph'){
      const cn=cname(t), b=blockOf(t.id);
      defs.push(`try:\n    ${cn}\nexcept NameError:\n    class ${cn}:\n        def __init__(self):\n            self.ensure()`);
      defs.push(`def _${cn}_ensure(self):\n${ind(emitEnsure(t.graph).join('\n'),4)}\n${cn}.ensure = _${cn}_ensure`);
      const args=(t.ins||[]).map((p,i)=>'i'+i);
      const body=emitGraph(t.graph,b,{args,returns:t.outs||[]});
      defs.push(`def _${cn}_step(self, _b${args.length?', '+args.join(', '):''}):\n${ind(body.join('\n'),4)}\n${cn}.step = _${cn}_step`);
    } else if(t.kind==='FB'){
      const cn=cname(t);
      const ps=(t.params||[]).map(p=>`${p.name}=${pyLit(p.def,p.type)}`);
      defs.push(`try:\n    ${cn}\nexcept NameError:\n    class ${cn}:\n        def __init__(self${ps.length?', '+ps.join(', '):''}):\n${ind(t.init||'pass',12)}\n${ind((t.params||[]).map(p=>`self._${p.name} = ${p.name}`).join('\n')||'pass',12)}`);
      const pu=(t.params||[]).map(p=>`${p.name} = self._${p.name}`).join('\n');
      if(t.breaker){
        defs.push(`def _${cn}_pre(self):\n${pu?ind(pu,4)+'\n':''}${ind(t.pre||'return self.q',4)}\n${cn}.pre = _${cn}_pre`);
        defs.push(`def _${cn}_post(self${(t.ins||[]).length?', '+(t.ins||[]).map(p=>p.name).join(', '):''}):\n${pu?ind(pu,4)+'\n':''}${ind(t.post||'self.q = x',4)}\n${cn}.post = _${cn}_post`);
      } else {
        defs.push(`def _${cn}_step(self${(t.ins||[]).length?', '+(t.ins||[]).map(p=>p.name).join(', '):''}):\n${pu?ind(pu,4)+'\n':''}${ind(t.step||'pass',4)}\n${cn}.step = _${cn}_step`);
      }
    } else {
      const args=(t.params||[]).map(p=>p.name).concat((t.ins||[]).map(p=>p.name));
      defs.push(`def F_${pid(t.id)}(${args.join(', ')}):\n${ind(t.step||'pass',4)}`);
    }
  }
  const mainBody=emitGraph(P_.main,GEN.mainBlock,{args:[],returns:null});
  P_.vars.forEach((v,i)=>mainBody.push(`W[${GEN.varBase+i}] = _r(V.${pid(v.name)})`));
  const vinit=P_.vars.map(v=>`if not hasattr(V, '${pid(v.name)}'): V.${pid(v.name)} = ${String(v.init).trim()||'0'}`);

  const head = PRELUDE.replace('__NW__',String(Math.max(1,GEN.nw)));
  const varsrc = `class _V:\n    pass\ntry:\n    V\nexcept NameError:\n    V = _V()\ndef _vinit():\n${ind(vinit.join('\n')||'pass',4)}\n_vinit()`;
  const mainsrc = [
    `try:\n    Main\nexcept NameError:\n    class Main:\n        def __init__(self):\n            self.ensure()`,
    `def _Main_ensure(self):\n${ind(emitEnsure(P_.main).join('\n'),4)}\nMain.ensure = _Main_ensure`,
    `def _Main_step(self):\n    _b = 0\n${ind(mainBody.join('\n'),4)}\nMain.step = _Main_step`
  ].join('\n\n');

  const body=[head,varsrc,'# ---- block types ----',defs.join('\n\n'),'# ---- main diagram ----',mainsrc].join('\n\n');
  GEN.full = body+'\n\n'+RUNTIME+`\n\nM = Main()\nrun(${P_.scan_ms|0}, ${P_.tele_ms|0})\n`;
  GEN.sim  = body+'\n\n'+RUNTIME+'\n\nM = Main()\n';
  GEN.patch = body+'\n\nM.ensure()\n';
  return GEN;
}

/* ---- static prelude ------------------------------------------------ */
const PRELUDE = `# generated by FlowPy — node/flow IDE for MicroPython
import sys
try:
    import ujson as json
except ImportError:
    import json
try:
    from time import ticks_ms, ticks_diff, sleep_ms
except ImportError:
    import time as _t
    def ticks_ms(): return int(_t.time() * 1000)
    def ticks_diff(a, b): return a - b
    def sleep_ms(m): _t.sleep(m / 1000.0)
try:
    from machine import Pin, ADC, PWM
    HW = True
except ImportError:
    HW = False
    import math as _m
    class Pin:
        IN = 0
        OUT = 1
        PULL_UP = 2
        _st = {}
        def __init__(self, n, mode=0, pull=None):
            self.n = n
            self.mode = mode
            if n not in Pin._st: Pin._st[n] = 0
        def value(self, v=None):
            if v is None: return Pin._st.get(self.n, 0)
            Pin._st[self.n] = 1 if v else 0
    class ADC:
        ATTN_11DB = 3
        def __init__(self, p): self.p = p
        def atten(self, a): pass
        def read_u16(self):
            return int(32768 + 30000 * _m.sin(ticks_ms() / 700.0))
    class PWM:
        _duty = {}
        def __init__(self, p): self.p = p
        def freq(self, f): pass
        def duty_u16(self, d): PWM._duty[getattr(self.p, 'n', 0)] = d
def _log(s):
    sys.stdout.write('!L' + str(s) + '\\n')
def _r(v):
    return round(v, 4) if type(v) is float else v
NW = __NW__
try:
    W
    if len(W) < NW: W = W + [0] * (NW - len(W))
except NameError:
    W = [0] * NW`;

const RUNTIME = `def _readline():
    b = ''
    while True:
        c = sys.stdin.read(1)
        if c == '' or c == '\\n': return b
        if c != '\\r': b += c
def _cmd(line):
    if not line: return
    op = line[0]
    try:
        if op == 'P':
            exec(json.loads(line[1:]), globals())
            sys.stdout.write('!Kpatched\\n')
        elif op == 'V':
            k, v = line[1:].split('=', 1)
            setattr(V, k, eval(v))
            sys.stdout.write('!K' + k + '\\n')
        elif op == 'Q':
            raise SystemExit
    except Exception as e:
        sys.stdout.write('!E' + str(e) + '\\n')
def run(scan_ms=20, tele_ms=100):
    try:
        import select
        poll = select.poll()
        poll.register(sys.stdin, select.POLLIN)
    except Exception:
        poll = None
    last = ticks_ms()
    sys.stdout.write('!Krunning\\n')
    while True:
        t0 = ticks_ms()
        try:
            M.step()
        except Exception as e:
            sys.stdout.write('!E' + str(e) + '\\n')
            sleep_ms(250)
        if ticks_diff(t0, last) >= tele_ms:
            last = t0
            sys.stdout.write('!T' + json.dumps(W) + '\\n')
        if poll is not None:
            while poll.poll(0):
                _cmd(_readline())
        d = scan_ms - ticks_diff(ticks_ms(), t0)
        if d > 0: sleep_ms(d)`;
