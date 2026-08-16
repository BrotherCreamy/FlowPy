'use strict';
/* =====================================================================
   FlowPy — device (Web Serial), simulator (Pyodide), project I/O
   ===================================================================== */
let VARLIVE={}, WBUF=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---- telemetry ----------------------------------------------------- */
let lastTele=0, teleN=0;
function applyTelemetry(arr){
  WBUF=arr; teleN++;
  const now=performance.now(); if(now-lastTele>1000){ $('#rate').textContent=` ${teleN} frames/s · ${arr.length} signals`; teleN=0; lastTele=now; }
  P_.vars.forEach((v,i)=>{ const idx=(GEN.varBase||0)+i; if(idx<arr.length) VARLIVE[v.name]=arr[idx]; });
  const t=curType(), path=curPath(), info=GEN.pathInfo[path];
  let block=null, base=0;
  if(t){ if(info&&info.typeId===t.id){ block=GEN.blocks[t.id]; base=info.base; } }
  else { block=GEN.mainBlock; base=0; }
  LIVE={};
  if(block) for(const k in block.local){ const idx=base+block.local[k]; if(idx<arr.length) LIVE[k]=arr[idx]; }
  updateWires();
  if(TAB==='insp') renderInspector(); else if(TAB==='vars') renderVars();
}
function handleLine(s){
  s=s.replace(/\r/g,'');
  if(!s) return;
  if(s[0]==='!'){
    const k=s[1], rest=s.slice(2);
    if(k==='T'){ try{ applyTelemetry(JSON.parse(rest)); }catch(e){} return; }
    if(k==='L'){ log(rest); return; }
    if(k==='E'){ log('error: '+rest,'e'); return; }
    if(k==='K'){ log('· '+rest,'g'); return; }
  }
  if(/^(OK|>|>>>|raw REPL|MPY:|\x04)/.test(s)) { log(s,'i'); return; }
  log(s,'i');
}

/* ---- Web Serial ---------------------------------------------------- */
let port=null, writer=null, readerAbort=null, rxbuf='', connected=false;
async function connectSerial(){
  if(!('serial' in navigator)){ alert('This browser has no Web Serial API.\nUse Chrome/Edge/Opera (desktop) over https:// or file://.\nYou can still use Simulate ▶.'); return; }
  try{
    port=await navigator.serial.requestPort();
    await port.open({baudRate:115200});
    writer=port.writable.getWriter();
    connected=true; setBase('connected','on');
    $('#bDeploy').disabled=false; $('#bPatch').disabled=false; $('#bStop').disabled=false;
    $('#bConnect').textContent='Disconnect';
    log('· serial connected @115200','g');
    readLoop();
    await wr('\r\x03\x03');
  }catch(e){ log('connect failed: '+e.message,'e'); }
}
async function disconnectSerial(){
  try{ connected=false; if(writer){ await wr('\r\x03\x03\x02'); writer.releaseLock(); writer=null; }
    if(readerAbort) await readerAbort();
    if(port) await port.close(); }catch(e){}
  port=null; setBase('idle','');
  $('#bDeploy').disabled=true; $('#bPatch').disabled=true; $('#bStop').disabled=true;
  $('#bConnect').textContent='Connect device'; log('· disconnected','i');
}
async function readLoop(){
  const dec=new TextDecoder();
  while(port&&port.readable&&connected){
    const reader=port.readable.getReader();
    readerAbort=async()=>{ try{ await reader.cancel(); }catch(e){} };
    try{
      while(true){ const {value,done}=await reader.read(); if(done) break;
        rxbuf+=dec.decode(value,{stream:true});
        let i; while((i=rxbuf.indexOf('\n'))>=0){ const line=rxbuf.slice(0,i); rxbuf=rxbuf.slice(i+1); handleLine(line); }
        if(rxbuf.length>20000) rxbuf=''; }
    }catch(e){ if(connected) log('read: '+e.message,'e'); }
    finally{ try{reader.releaseLock();}catch(e){} }
    if(!connected) break;
  }
}
async function wr(s){ if(!writer) return; await writer.write(new TextEncoder().encode(s)); }
async function wrChunks(s,size,delay,prog){
  size=size||128; delay=delay===undefined?22:delay;   // stay under 115200 baud
  for(let i=0;i<s.length;i+=size){ await wr(s.slice(i,i+size)); if(delay) await sleep(delay);
    if(prog&&i%2048===0) setStatus(prog+' '+Math.round(100*i/s.length)+'%','busy'); }
}
async function deploy(){
  let g; try{ g=generate(); }catch(e){ log('codegen: '+e.message,'e'); return; }
  RANGE={}; LIVE={};
  setStatus('deploying…','busy'); log('· deploying '+g.full.split('\n').length+' lines','g');
  await wr('\r\x03\x03'); await sleep(150);
  await wr('\x01'); await sleep(150);          // raw REPL
  await wrChunks(g.full,128,22,'uploading');
  await wr('\x04');                             // execute
  setBase('running','on');
}
async function patch(){
  let g; try{ g=generate(); }catch(e){ log('codegen: '+e.message,'e'); return; }
  await wrChunks('P'+JSON.stringify(g.patch)+'\n',128,22,'patching');
  log('· live patch sent ('+g.patch.length+' bytes) — state preserved','g');
}
async function stopDev(){ await wr('\x03'); setBase('stopped',''); log('· ctrl-C sent','i'); }
async function forceVar(name,val){
  if(SIM.on&&SIM.mode==='js'){ JSVARS[name]=pyLitVal(val); log('· '+name+' = '+val,'g'); return; }
  if(SIM.on&&PY){ try{ PY.runPython(`V.${name} = ${val}`); log('· '+name+' = '+val,'g'); }catch(e){ log(String(e),'e'); } return; }
  if(!connected) { log('not connected','w'); return; }
  await wr('V'+name+'='+val+'\n');
}

/* ---- simulator (Pyodide) ------------------------------------------- */
const SIM={on:false,mode:'js',timer:null,tele:null};
let PY=null;
function loadScript(u){ return new Promise((res,rej)=>{ const s=document.createElement('script');
  s.src=u; s.onload=res; s.onerror=()=>rej(new Error('load '+u)); document.head.append(s); }); }
async function ensurePy(){
  if(PY) return PY;
  setStatus('loading python runtime…','busy');
  const urls=['https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js',
              'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js',
              'https://cdnjs.cloudflare.com/ajax/libs/pyodide/0.26.4/pyodide.js'];
  let ok=false;
  for(const u of urls){ try{ await loadScript(u); ok=true; var base=u.replace(/pyodide\.js$/,''); break; }catch(e){} }
  if(!ok) throw new Error('could not load Pyodide (no network?). Deploy to a real board instead.');
  PY=await loadPyodide({indexURL:base});
  PY.setStdout({batched:s=>String(s).split('\n').forEach(handleLine)});
  PY.setStderr({batched:s=>log(s,'e')});
  return PY;
}
async function startSim(){
  if(SIM.on){ stopSim(); return; }
  let g; try{ g=generate(); }catch(e){ log('codegen: '+e.message,'e'); return; }
  RANGE={}; LIVE={};
  const want=$('#engine').value;
  let mode='js';
  if(want!=='js'){
    try{ await ensurePy(); mode='py'; }
    catch(e){ if(want==='py'){ log(e.message,'e'); setBase('idle',''); return; }
      log('Pyodide unavailable ('+e.message+') — using the offline engine.','w'); }
  }
  if(mode==='py'){
    try{ PY.runPython(g.sim); }catch(e){ log(String(e.message||e),'e'); setBase('sim error','err'); return; }
    SIM.timer=setInterval(()=>{ try{ PY.runPython('M.step()'); }catch(e){ log(String(e.message||e),'e'); stopSim(); } }, Math.max(5,P_.scan_ms));
    SIM.tele=setInterval(()=>{ try{ applyTelemetry(JSON.parse(PY.runPython('json.dumps(W)'))); }catch(e){} }, Math.max(40,P_.tele_ms));
    log('· simulator running the generated MicroPython under Pyodide (virtual pins, synthetic ADC)','g');
  } else {
    jsSimInit();
    SIM.timer=setInterval(()=>{ try{ jsSimStep(); }catch(e){ log(String(e.message||e),'e'); stopSim(); } }, Math.max(5,P_.scan_ms));
    SIM.tele=setInterval(()=>{ try{ applyTelemetry(JSW.slice()); }catch(e){} }, Math.max(40,P_.tele_ms));
    log('· offline engine running (virtual pins, synthetic ADC) — edits apply instantly, no deploy needed','g');
    setTimeout(()=>{ const u=[...new Set(JSUNSUP)]; if(u.length)
      log('note: offline engine cannot run multi-line Python blocks ('+u.join(', ')+') — they output 0. Use the Pyodide engine or a real board for those.','w'); },400);
  }
  SIM.on=true; SIM.mode=mode;
  $('#bSim').textContent='Stop sim \u25a0'; $('#bSim').classList.add('ok');
  setBase('simulating ('+(mode==='py'?'python':'fast')+')','on');
}
function stopSim(){ clearInterval(SIM.timer); clearInterval(SIM.tele); SIM.on=false;
  $('#bSim').textContent='Simulate \u25b6'; $('#bSim').classList.remove('ok'); setBase('idle',''); }
async function simPatch(){
  if(SIM.mode==='js'){ log('\u00b7 offline engine interprets the live model \u2014 your edits are already running','g'); return; }
  let g; try{ g=generate(); }catch(e){ log('codegen: '+e.message,'e'); return; }
  try{ PY.runPython(g.patch); log('\u00b7 sim patched \u2014 state preserved','g'); }catch(e){ log(String(e.message||e),'e'); } }
function simPin(n,v){ if(SIM.mode==='js'){ JSPINS[n]=v?1:0; return; } if(PY) PY.runPython(`Pin._st[${n}] = ${v?1:0}`); }
function simPinGet(n){ try{ if(SIM.mode==='js') return JSPINS[n]||0; return PY? PY.runPython(`Pin._st.get(${n},0)`) : 0; }catch(e){ return 0; } }

/* inspector extension: virtual pins while simulating */
function inspectorExtra(b,n){
  if(!SIM.on||n.k!=='blk') return;
  const t=typeOf(n.type); if(!t) return;
  if(t.id==='pin_in'){
    const pin=n.params.pin|0;
    b.append(el('div',{cls:'sub'},'Virtual pin '+pin));
    b.append(el('div',{cls:'row'},
      el('button',{onclick:()=>{simPin(pin,1);}},'drive HIGH'),
      el('button',{onclick:()=>{simPin(pin,0);}},'drive LOW'),
      el('span',{cls:'mono'},'now '+simPinGet(pin))));
  }
  if(t.id==='pin_out'||t.id==='pwm'){
    const pin=n.params.pin|0;
    b.append(el('div',{cls:'sub'},'Virtual pin '+pin));
    b.append(el('div',{cls:'row'},el('span',{cls:'mono'},'value '+simPinGet(pin))));
  }
}


/* ---- help ------------------------------------------------------------- */
const HELP = `<h3>FlowPy quick start</h3>
<div style="font-size:12px;line-height:1.65;max-height:60vh;overflow:auto">
<b>Build</b><br>
Drag blocks from the left onto the canvas. Everything snaps to the 20&nbsp;px grid — block positions, block sizes and
every port — so wires always run along grid lines. Drag from an <i>output</i> port to an <i>input</i> port to wire them
(drag off an input to detach). Square ports are booleans, round ports are numbers. Double&#8209;click a block to edit
its type. <b>Del</b> removes the selection, wheel zooms, drag the background to pan.
<br><br>
<b>Moving blocks</b><br>
Drag a block and everything it feeds moves with it, keeping the same &#916;x/&#916;y — so spacing and the shape of a
signal chain survive edits. Upstream sources stay put. Hold <b>Alt</b> to move one block on its own.<br>
Blocks can never overlap — dropping one on top of another pushes the blocks in the way aside (minimum
<b>one grid cell</b> clear on at least one axis). A block fed by a forward wire always sits at <b>exactly</b> the
minimum distance from its source (two grid cells) — there is no such thing as an arbitrarily long forward wire; drag
one further away and it snaps straight back the moment you let go. Vertical movement is otherwise free.
<br><br>
<b>Wires and direction</b><br>
Wires are straight orthogonal runs. The vertical shaft sits as far left as it can &mdash; one unit clear of the output
port &mdash; and every corner is a 45&deg; cut half a unit wide by half a unit tall. So an offset connection reads as:
half-unit stub, corner, shaft, corner, half-unit stub. When a block is in the way the router searches the grid for
the shortest path around it, still keeping vertical runs to the left; everything re-routes when you move something.<br>
A wire that travels <b>left&nbsp;→&nbsp;right</b> is evaluated in the <b>same scan</b>. Connecting a block normally
never creates anything else: if you drop the connection onto a block that sits behind the source, that block (and
everything it feeds) is snapped forward until the wire reads left-to-right.<br>
Hold <b>Shift</b> while dropping the connection to wire it backwards on purpose: a wire that travels
<b>right&nbsp;→&nbsp;left</b> is drawn dashed with a <span style="color:#c9a4ff">&#8634;&nbsp;z&#8315;&#185;</span> tag
and carries the <b>previous scan's</b> value instead — that's how feedback loops close. Because an un-shifted connection
is always forced to run forward, the same-scan graph can never contain a loop, so layout <i>is</i> execution order.
<br><br>
<b>Make your own blocks</b><br>
<b>+F</b> = stateless function, <b>+FB</b> = function block with state. In the <i>Type</i> tab choose
<i>Python source</i> and write any MicroPython you like (F = one function body, FB = <code>__init__</code> + <code>step</code>),
or choose <i>Flow diagram</i> and wire the implementation up from other blocks. Parameters become constructor arguments
you can set per instance.
<br><br>
<b>DELAY z&#8315;&#185; block</b><br>
Still available when you want an explicit one-scan delay on a wire that runs forwards.
<br><br>
<b>Run it</b><br>
<b>Simulate</b> executes the design in the browser — the <i>Python</i> engine runs the exact generated MicroPython under
Pyodide, the <i>fast</i> engine is an offline interpreter (builtin blocks exact; user Python must be a single
<code>return &lt;expr&gt;</code>). <b>Connect device</b> + <b>Deploy</b> pushes the generated program to a MicroPython
board over USB (Chrome/Edge, Web&nbsp;Serial). <b>Live patch</b> re-sends the code into the running program without
resetting block state — edit a Python body or add blocks and patch while it runs.
<br><br>
<b>Debugging</b><br>
The board streams every signal back each telemetry period. Booleans light up green, numbers get an auto-scaled
colour ramp plus a value label. Open a composite block while running to watch inside it; use the instance selector
in the breadcrumb if it is used more than once. The <i>Vars</i> tab shows live values and can force a value onto the
running device.
<br><br>
<b>Board setup</b><br>
Any board running MicroPython (ESP32, RP2040, STM32…). Nothing needs to be installed on it — FlowPy talks to the
REPL. The generated code is plain MicroPython; the <i>Code</i> tab lets you copy or download it.
</div>`;
function showHelp(){ $('#mbox').innerHTML=HELP+`<div class="mrow"><button class="pri" id="mok">Got it</button></div>`;
  $('#modal').classList.add('on'); $('#mok').onclick=()=>$('#modal').classList.remove('on'); }
$('#bHelp').onclick=showHelp;
$('#modal').onclick=e=>{ if(e.target.id==='modal') $('#modal').classList.remove('on'); };

/* ---- project I/O ---------------------------------------------------- */
function saveProject(){ dl((P_.name||'flowpy')+'.json', JSON.stringify(P_,null,1), 'application/json'); log('· saved','g'); }
function loadProject(obj){
  P_=Object.assign(emptyProject(),obj);
  let mx=0; const scan=g=>g&&g.nodes&&g.nodes.forEach(n=>{const m=+String(n.id).slice(1); if(m>mx)mx=m;});
  scan(P_.main); Object.values(P_.types).forEach(t=>{scan(t.graph); const m=+String(t.id).slice(1); if(m>mx)mx=m;});
  _uid=mx+1; view={stack:[]}; sel={nodes:new Set(),wires:new Set()}; LIVE={}; RANGE={};
  snapProject(P_); tagProject(P_); renderPalette(); renderGraph(); markDirty();
}
$('#bSave').onclick=saveProject;
$('#bLoad').onclick=()=>$('#fileIn').click();
$('#fileIn').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader();
  r.onload=()=>{ try{ loadProject(JSON.parse(r.result)); log('· loaded '+f.name,'g'); }catch(err){ log('bad project file: '+err.message,'e'); } };
  r.readAsText(f); e.target.value=''; };
$('#bNew').onclick=()=>{ if(!confirm('Discard current project?')) return; loadProject(emptyProject()); };
$('#bConnect').onclick=()=> connected? disconnectSerial() : connectSerial();
$('#bDeploy').onclick=deploy;
$('#bPatch').onclick=()=> SIM.on? simPatch() : patch();
$('#bStop').onclick=stopDev;
$('#bSim').onclick=startSim;

/* ---- demo project ---------------------------------------------------- */
function demoProject(){
  const p=emptyProject(); p.name='demo';
  p.vars=[{name:'presses',type:'num',init:'0'},{name:'level',type:'num',init:'0'}];
  const N=(g,k,o)=>{ const n=Object.assign({id:uid('n'),k},o); g.nodes.push(n); return n; };
  const blk=(g,type,x,y,params)=>N(g,'blk',{type,x,y,params:Object.assign({},
    ((typeOf(type).params)||[]).reduce((a,q)=>(a[q.name]=q.def,a),{}),params||{})});
  const W_=(g,a,ai,b,bi)=>g.wires.push({id:uid('w'),f:[a.id,ai],t:[b.id,bi]});

  /* user F written in python */
  const pct={id:uid('t'),name:'PERCENT',kind:'F',impl:'py',group:'User',
    ins:[IO('x','num')],outs:[IO('y','num')],params:[],
    step:'# any python you like\nreturn round(x * 100.0, 1)', graph:{nodes:[],wires:[]}};
  p.types[pct.id]=pct;

  /* user FB implemented as a flow diagram: counts rising edges of a bool */
  const ec={id:uid('t'),name:'EDGE COUNT',kind:'FB',impl:'graph',group:'User',
    ins:[IO('x','bool')],outs:[IO('n','num')],params:[],graph:{nodes:[],wires:[]}};
  p.types[ec.id]=ec;
  const P0=P_; P_=p;                          // typeOf() needs the new project
  syncIOFor(ec);
  const gi=ec.graph.nodes.find(n=>n.k==='gin'), go=ec.graph.nodes.find(n=>n.k==='gout');
  gi.x=-30; gi.y=60; go.x=560; go.y=60;
  const e1=blk(ec.graph,'edge',160,40), c1=blk(ec.graph,'counter',370,40);
  W_(ec.graph,gi,0,e1,0); W_(ec.graph,e1,0,c1,0); W_(ec.graph,c1,0,go,0);

  /* main diagram */
  const g=p.main;
  const bl=blk(g,'blink',40,40,{period_ms:600});
  const po=blk(g,'pin_out',430,40,{pin:2});
  W_(g,bl,0,po,0);

  const btn=blk(g,'pin_in',40,150,{pin:0,pull_up:true,invert:true});
  const eco=blk(g,ec.id,250,150);
  const vs =N(g,'var',{x:470,y:150,varName:'presses'});
  W_(g,btn,0,eco,0); W_(g,eco,0,vs,0);

  const ad=blk(g,'adc',40,260,{pin:34});
  const fl=blk(g,'ema',210,260,{alpha:0.15});
  const pc=blk(g,pct.id,400,260);
  const vl=N(g,'var',{x:560,y:260,varName:'level'});
  W_(g,ad,0,fl,0); W_(g,fl,0,pc,0); W_(g,pc,0,vl,0);

  const sc=blk(g,'hyst',400,360,{lo:0.35,hi:0.65});
  const pr=blk(g,'print',640,360,{label:'threshold',on_change:true});
  W_(g,fl,0,sc,0); W_(g,sc,0,pr,0);

  /* feedback demo: the compare wires BACK into the counter's reset (right-to-left = next scan) */
  const bk=blk(g,'blink',40,560,{period_ms:200});
  const ct=blk(g,'counter',240,560);
  const k4=N(g,'const',{x:240,y:680,value:4,vtype:'num'});
  const cmp=blk(g,'gt',460,560);
  const pr2=blk(g,'print',680,560,{label:'ramp',on_change:true});
  W_(g,bk,0,ct,0); W_(g,ct,0,cmp,0); W_(g,k4,0,cmp,1); W_(g,ct,0,pr2,0);
  W_(g,cmp,0,ct,1);                       // <- back wire

  snapProject(p); tagProject(p);
  P_=P0;
  return p;
}

/* ---- boot -------------------------------------------------------------- */
function boot(){
  P_=demoProject();
  applyCam(); renderPalette(); showTab('insp'); renderGraph(); markDirty();
  log('FlowPy ready.','g');
  log('· Simulate ▶ runs the exact generated MicroPython in your browser (Pyodide, virtual pins).','i');
  log('· Connect device → Deploy ▶ pushes it to a MicroPython board over USB (Chrome/Edge).','i');
  log('· Live patch ⚡ re-sends code without resetting block state.','i');
  if(!('serial' in navigator)) log('· Web Serial not available in this browser — simulation only.','w');
}
boot();
