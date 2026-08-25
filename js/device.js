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
(drag off an input to detach). Square ports are booleans, round ports are numbers. Click a block's type name to rename
it in place — type an existing type's name to switch to it, or a new name to spin up a fresh type. Double&#8209;click a
block to open its full type editor. <b>Del</b> removes the selection, wheel zooms, drag the background to pan.<br>
Wiring a second signal onto an input that's already fed doesn't replace the connection — a small <b>OR</b> (boolean) or
<b>ADD</b> (numeric) block is spliced in automatically so both reach it, chaining further for a third source and beyond,
and collapsing back to a plain wire the moment you disconnect down to one.
<br><br>
<b>A tree's own layout is computed, never stored — only its position is</b><br>
A tree is a self-standing network: every block reachable from every other, wires followed either direction. Within one,
there's no x/y saved anywhere — every render lays it out fresh from two things only: which block feeds which (its
column), and the order blocks appear in the underlying model (its row). A block fed by a forward wire sits at
<b>exactly</b> the minimum distance from its source — there's no such thing as an arbitrarily long forward wire. A
block with nothing feeding it forward normally aligns to the tree's own leftmost column, <i>unless</i> it feeds
something itself (a constant wired sideways into a block some other chain also feeds, say) — then it sits right next
to whatever that is instead.<br>
The <b>one</b> thing actually remembered is a tree's position: grab a root block (nothing forward-feeds it) to drag the
whole tree anywhere — trees are free to overlap, nothing pushes back. Grab any other block to reorder within its own
tree instead (hold <b>Alt</b> to move just the one block); as you drag it past another block, they visibly swap
places, live, before you let go. Connecting two separate trees keeps the older one exactly where it is while the newer
one snaps into the unified layout around it; disconnecting leaves both halves exactly where they were — nothing
teleports either way.
<br><br>
<b>Wires and direction</b><br>
Wires are straight orthogonal runs. The vertical shaft sits as far left as it can &mdash; one unit clear of the output
port &mdash; and every corner is a 45&deg; cut half a unit wide by half a unit tall. So an offset connection reads as:
half-unit stub, corner, shaft, corner, half-unit stub. When a block is in the way the router searches the grid for
the shortest path around it, still keeping vertical runs to the left; everything re-routes when you move something.<br>
A wire that travels <b>left&nbsp;→&nbsp;right</b> is evaluated in the <b>same scan</b>. A wire's direction is never a
choice — it's read off the diagram exactly like everything else: connect an output to the input of a block that's
already upstream of it, and the connection is automatically feedback — drawn dashed with a
<span style="color:#c9a4ff">&#8634;&nbsp;z&#8315;&#185;</span> tag, carrying the <b>previous scan's</b> value — because
that's the only thing it could mean. Anything else reads forward.
<br><br>
<b>Make your own blocks</b><br>
<b>+F</b> = stateless function, <b>+FB</b> = function block with state. In the <i>Type</i> tab choose
<i>Python source</i> and write any MicroPython you like (F = one function body, FB = <code>__init__</code> + <code>step</code>),
or choose <i>Flow diagram</i> and wire the implementation up from other blocks. Parameters become constructor arguments
you can set per instance. An FB type can also declare named <b>variable references</b> in the Type tab — bind one to a
variable per instance in the Inspector, and the block's own code reads or writes it via
<code>getattr</code>/<code>setattr(V, self._ref_&lt;name&gt;)</code> whenever and however it wants, instead of a value
copied in and out once every scan.
<br><br>
<b>DELAY z&#8315;&#185; block</b><br>
Still available when you want an explicit one-scan delay on a wire that runs forwards.
<br><br>
<b>Variables</b><br>
A variable is a plain box with just its name — no ports shown until you hover the block, or permanently once
something's actually wired to it, so an unused connection point never sits there implying a use that isn't happening.
Hover the left edge to wire a value in, the right edge to read it out. Manage variables and their initial values in
the <i>Vars</i> tab.
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
<b>Saving your work</b><br>
There's no separate project file — <b>Save</b> writes one plain <code>.py</code> file: the real, runnable program,
with the diagram itself embedded alongside it as a marked comment block a Python interpreter just ignores.
<b>Open</b> reads that same block back to reconstruct the exact diagram. In Chrome/Edge, the first Save (or Open) asks
you to pick a file once, then every further edit writes straight back to it automatically — no re-saving needed.
Elsewhere it's a plain download/upload each time. Nothing is ever kept only in the browser tab, and a file handle
doesn't survive a refresh — reloading the page always starts over from the built-in demo project, so open your own
file again (or Save a fresh one) after refreshing to pick up where you left off.
<br><br>
<b>Board setup</b><br>
Any board running MicroPython (ESP32, RP2040, STM32…). Nothing needs to be installed on it — FlowPy talks to the
REPL. The generated code is plain MicroPython; the <i>Code</i> tab lets you copy or download it.
</div>`;
function showHelp(){ $('#mbox').innerHTML=HELP+`<div class="mrow"><button class="pri" id="mok">Got it</button></div>`;
  $('#modal').classList.add('on'); $('#mok').onclick=()=>$('#modal').classList.remove('on'); }
$('#bHelp').onclick=showHelp;
$('#modal').onclick=e=>{ if(e.target.id==='modal') $('#modal').classList.remove('on'); };

/* ---- project I/O ------------------------------------------------------
   One .py file is the whole project — see fileContent()/parseManifest()
   in codegen.js for the format. Where the File System Access API exists
   (Chromium-based browsers), fileHandle keeps a live handle to whatever
   file the user last picked via Save or Open, and every edit re-writes
   it (writeToHandle, called from markDirty in editor.js) — no separate
   "sync" step, no separate project format. Elsewhere it degrades to a
   plain download/upload each time, same shape the old .json flow always
   had, just this format instead. */
let fileHandle=null;
/* every write chains onto the previous one rather than firing
   independently: writeToHandle runs on every single edit (markDirty is
   the one choke point after every mutation, editor.js), so two edits
   close together — two blurred fields, an undo right after a change —
   would otherwise start a SECOND createWritable() before the first one's
   own write+close finished. FileSystemWritableFileStream isn't safe
   against that (each createWritable() call truncates the file fresh),
   so overlapping writes could genuinely corrupt or truncate the synced
   file rather than just racing harmlessly. Chaining onto writeChain
   guarantees each write's own createWritable→write→close fully
   completes before the next one starts, in order, no matter how close
   together the edits that triggered them were. */
let writeChain=Promise.resolve();
function writeToHandle(){
  if(!fileHandle) return;
  writeChain=writeChain.then(async()=>{
    if(!fileHandle) return;
    try{ const w=await fileHandle.createWritable(); await w.write(fileContent()); await w.close(); }
    catch(e){ log('· lost the synced file, pick it again with Save: '+e.message,'e'); fileHandle=null; }
  });
}
function saveProject(){
  if('showSaveFilePicker' in window){
    (async()=>{
      try{
        if(!fileHandle) fileHandle=await window.showSaveFilePicker(
          {suggestedName:(P_.name||'flowpy')+'.py', types:[{description:'Python',accept:{'text/x-python':['.py']}}]});
        await writeToHandle();
        log('· saved — every further edit writes straight back to this file','g');
      }catch(e){ if(e.name!=='AbortError') log('· save failed: '+e.message,'e'); }
    })();
    return;
  }
  dl((P_.name||'flowpy')+'.py', fileContent(), 'text/x-python');
  log('· saved (this browser can\'t auto-sync — Save again whenever you want to update the file)','g');
}
function loadProject(obj){
  P_=Object.assign(emptyProject(),obj);
  let mx=0; const scan=g=>g&&g.nodes&&g.nodes.forEach(n=>{const m=+String(n.id).slice(1); if(m>mx)mx=m;});
  scan(P_.main); Object.values(P_.types).forEach(t=>{scan(t.graph); const m=+String(t.id).slice(1); if(m>mx)mx=m;});
  _uid=mx+1; view={stack:[]}; sel={nodes:new Set(),wires:new Set()}; LIVE={}; RANGE={};
  HIST=[]; HISTI=-1;    // a freshly loaded project starts its own undo history, not the old one's
  snapProject(P_); tagProject(P_); renderPalette(); renderGraph(); markDirty();
}
function loadFromPyText(text,name){
  try{ loadProject(parseManifest(text)); log('· loaded '+(name||'')+(fileHandle?' — now syncing edits back to it':''),'g'); }
  catch(err){ log('bad project file: '+err.message,'e'); }
}
$('#bSave').onclick=saveProject;
$('#bLoad').onclick=()=>{
  if('showOpenFilePicker' in window){
    (async()=>{
      try{
        const [h]=await window.showOpenFilePicker({types:[{description:'Python',accept:{'text/x-python':['.py']}}]});
        const file=await h.getFile();
        const text=await file.text();
        fileHandle=h;
        loadFromPyText(text,file.name);
      }catch(e){ if(e.name!=='AbortError') log('· open failed: '+e.message,'e'); }
    })();
    return;
  }
  $('#fileIn').click();
};
$('#fileIn').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader();
  r.onload=()=>{ loadFromPyText(r.result,f.name); };
  r.readAsText(f); e.target.value=''; };
$('#bNew').onclick=()=>{ if(!confirm('Discard current project?')) return; fileHandle=null; loadProject(emptyProject()); };
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
  /* .back is stated explicitly for every wire here, not left for tagWires to
     guess from the hand-placed x/y below — those coordinates are only a
     starting layout (compaction moves them anyway), and boundary cases in
     them (e.g. a width estimate landing a source's output edge exactly on a
     target's input x) can flip the geometric guess the wrong way. Direction
     is a decision this demo already knows; state it. */
  const W_=(g,a,ai,b,bi,back)=>g.wires.push({id:uid('w'),f:[a.id,ai],t:[b.id,bi],back:!!back});

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
  /* built through the same _wireUp() the interactive UI uses (P_ is already
     the demo project here, view.stack is still empty, so G() resolves to
     this exact g) — not the raw W_() helper — so any fan-out among these
     hand-placed wires gets the same hidden-tap treatment a user connecting
     them by hand would get, and direction is decided the same way too:
     by reachability through what's already wired, never stated by hand.
     ec.graph below stays on W_() since G() can't be pointed at a sub-type's
     graph from here, and none of its wires fan out anyway. */
  const C_=(a,ai,b,bi)=>_wireUp(g,a.id,ai,b.id,bi);
  const bl=blk(g,'blink',40,40,{period_ms:600});
  const po=blk(g,'pin_out',430,40,{pin:2});
  C_(bl,0,po,0);

  const btn=blk(g,'pin_in',40,150,{pin:0,pull_up:true,invert:true});
  const eco=blk(g,ec.id,250,150);
  const vs =N(g,'var',{x:470,y:150,varName:'presses'});
  C_(btn,0,eco,0); C_(eco,0,vs,0);

  const ad=blk(g,'adc',40,260,{pin:34});
  const fl=blk(g,'ema',210,260,{alpha:0.15});
  const pc=blk(g,pct.id,400,260);
  const vl=N(g,'var',{x:560,y:260,varName:'level'});
  C_(ad,0,fl,0); C_(fl,0,pc,0); C_(pc,0,vl,0);

  const sc=blk(g,'hyst',400,360,{lo:0.35,hi:0.65});
  const pr=blk(g,'print',640,360,{label:'threshold',on_change:true});
  C_(fl,0,sc,0); C_(sc,0,pr,0);

  /* feedback demo: the compare wires BACK into the counter's reset (right-to-left = next scan) */
  const bk=blk(g,'blink',40,560,{period_ms:200});
  const ct=blk(g,'counter',240,560);
  const k4=N(g,'const',{x:240,y:680,value:4,vtype:'num'});
  const cmp=blk(g,'gt',460,560);
  const pr2=blk(g,'print',680,560,{label:'ramp',on_change:true});
  C_(bk,0,ct,0); C_(ct,0,cmp,0); C_(k4,0,cmp,1); C_(ct,0,pr2,0);
  C_(cmp,0,ct,1);                         // the one feedback wire — closes a loop through ct->cmp, so _wireUp classifies it back on its own

  snapProject(p); tagProject(p);
  P_=P0;
  return p;
}

/* ---- boot -------------------------------------------------------------- */
function boot(){
  P_=demoProject();
  applyCam(); applySizeVars(); renderPalette(); showTab('insp'); renderGraph(); markDirty();
  log('FlowPy ready.','g');
  log('· Simulate ▶ runs the exact generated MicroPython in your browser (Pyodide, virtual pins).','i');
  log('· Connect device → Deploy ▶ pushes it to a MicroPython board over USB (Chrome/Edge).','i');
  log('· Live patch ⚡ re-sends code without resetting block state.','i');
  if(!('serial' in navigator)) log('· Web Serial not available in this browser — simulation only.','w');
}
boot();
