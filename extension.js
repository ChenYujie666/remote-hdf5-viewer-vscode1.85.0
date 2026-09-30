const vscode = require('vscode');
const cp = require('child_process');

function run(program, args, cwd) {
  return new Promise((resolve, reject) => {
    cp.execFile(program, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); return; }
      resolve(stdout);
    });
  });
}

function pyScript() {
  return String.raw`import sys,json,math,re
try:
 import h5py,numpy as np
except Exception as e:
 print(json.dumps({'error':'Python h5py is not installed: '+str(e)})); sys.exit(0)
path=sys.argv[1]; action=sys.argv[2]
def value(x):
 if isinstance(x,np.void) and x.dtype.names: return {n:value(x[n]) for n in x.dtype.names}
 if isinstance(x,np.ndarray): return [value(v) for v in x]
 if isinstance(x,np.generic): return value(x.item())
 if isinstance(x,bytes): return x.decode('utf-8','replace')
 if isinstance(x,float) and not math.isfinite(x): return str(x)
 if isinstance(x,complex): return str(x)
 return x
try:
 with h5py.File(path,'r') as f:
  if action=='tree':
   out=[]
   def visit(n,o):
    if isinstance(o,h5py.Dataset): out.append({'path':'/'+n,'kind':'dataset','shape':list(o.shape),'dtype':str(o.dtype),'size':int(o.size)})
    else: out.append({'path':'/'+n,'kind':'group'})
   f.visititems(visit); print(json.dumps({'tree':out},default=str))
  elif action=='wide':
   candidates=[]
   for name,obj in f.items():
    match=re.fullmatch(r'col_(\d+)',name)
    if match and isinstance(obj,h5py.Dataset) and len(obj.shape)==1:
     candidates.append((int(match.group(1)),name,obj))
   if not candidates: raise ValueError('No root-level col_N datasets found')
   longest=max(obj.shape[0] for _,_,obj in candidates)
   chosen=sorted((item for item in candidates if item[2].shape[0]==longest),key=lambda item:item[0])
   columns=[name for _,name,_ in chosen]
   samples=[obj[:50] for _,_,obj in chosen]
   rows=[[value(sample[i]) for sample in samples] for i in range(min(50,longest))]
   print(json.dumps({'path':'Longest col datasets','shape':[longest,len(columns)],'dtype':'mixed','columns':columns,'rows':rows,'totalRows':longest,'columnLimit':len(columns),'extraDimensionsLimited':False},default=str))
  elif action=='data':
   name=sys.argv[3]; d=f[name]
   if not isinstance(d,h5py.Dataset): raise ValueError(name+' is not a dataset')
   shape=list(d.shape); limit=50; col_limit=50
   if not shape:
    columns=['value']; rows=[[value(d[()])]]
   elif len(shape)==1 and d.dtype.names:
    columns=list(d.dtype.names); rows=[[value(rec[n]) for n in columns] for rec in d[:limit]]
   elif len(shape)==1:
    columns=['value']; rows=[[value(x)] for x in d[:limit]]
   else:
    count=min(col_limit,shape[1]); columns=['col '+str(i) for i in range(count)]
    selection=(slice(0,limit),slice(0,count))+tuple(slice(0,min(4,s)) for s in shape[2:])
    sample=d[selection]; rows=[[value(v) for v in row] for row in sample]
   print(json.dumps({'path':name,'shape':shape,'dtype':str(d.dtype),'columns':columns,'rows':rows,'totalRows':shape[0] if shape else 1,'columnLimit':col_limit,'extraDimensionsLimited':len(shape)>2},default=str))
except Exception as e: print(json.dumps({'error':str(e)}))`;
}

async function inspectFile(file, action, dataset) {
  const script = pyScript();
  const args = ['-c', script, file, action];
  if (dataset) args.push(dataset);
  let pythonError;
  try {
    const pythonPath = vscode.workspace.getConfiguration('hdf5Viewer').get('pythonPath', 'python3');
    const result = JSON.parse(await run(pythonPath, args));
    if (!result.error || action !== 'tree') return result;
    pythonError = result.error;
  } catch (e) { pythonError = e.stderr || e.message; }
  if (action === 'tree') {
    try {
      const out = await run('h5ls', ['-r', file]);
      const tree = out.split(/\r?\n/).filter(Boolean).map(line => {
        const m = line.match(/^\s*(\S+)\s+(Group|Dataset)(?:\s+\{([^}]*)\})?/);
        return m ? { path: m[1], kind: m[2].toLowerCase(), detail: m[3] || '' } : null;
      }).filter(Boolean);
      return { tree };
    } catch (_) {}
  }
  return { error: '远程服务器需要 python3 和 h5py 才能预览数据。' + (pythonError ? ' ' + pythonError : '') };
}

function html(webview, file, tree, error) {
  const nonce = Math.random().toString(36).slice(2);
  const safe = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows = (tree || []).map((x, i) => `<button class="node ${x.kind}" data-index="${i}" title="${safe(x.path)}">${x.kind === 'dataset' ? '▦' : '▾'} ${safe(x.path)} ${x.shape ? '<span>'+safe(x.shape.join(' × '))+'</span>' : ''}</button>`).join('');
  const hasWide = (tree || []).some(x => x.kind === 'dataset' && /^\/col_\d+$/.test(x.path) && (!x.shape || x.shape.length === 1));
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
body{font:13px var(--vscode-font-family);color:var(--vscode-foreground);padding:0 14px}.bar{display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--vscode-panel-border);padding:8px 0}.path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:12px;margin-top:12px}.focus .layout{grid-template-columns:minmax(0,1fr)}.focus .tree{display:none}.tree{overflow:auto;max-height:calc(100vh - 100px)}button.node{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:5px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button.node:hover{background:var(--vscode-list-hoverBackground)}button.node span{color:var(--vscode-descriptionForeground);margin-left:6px}.panel{min-width:0;overflow:hidden;max-height:calc(100vh - 120px)}.table-wrap{overflow:auto;max-height:calc(100vh - 150px)}table{border-collapse:collapse;min-width:100%;width:max-content;white-space:nowrap;font-variant-numeric:tabular-nums}th,td{border:1px solid var(--vscode-panel-border);padding:4px 8px;text-align:left}th{position:sticky;top:0;background:var(--vscode-editor-background);font-weight:600}th:first-child,td:first-child{position:sticky;left:0;background:var(--vscode-editor-background);z-index:1}th:first-child{z-index:2}.muted{color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}</style></head><body>
<div class="bar"><strong>HDF5 Viewer</strong><div class="path" title="${safe(file)}">${safe(file)}</div>${hasWide ? '<button id="allCols">All longest col</button>' : ''}<button id="toggleTree">Hide tree</button><button id="refresh">Refresh</button></div><div class="layout"><div class="tree">${rows || '<div class="muted">No objects found.</div>'}</div><div id="panel" class="panel"><div class="${error ? 'error' : 'muted'}">${safe(error || 'Select a dataset to preview its first 50 rows.')}</div></div></div>
<script nonce="${nonce}">const vscode=acquireVsCodeApi();const nodes=[...document.querySelectorAll('.node')];const panel=document.getElementById('panel');
function cell(value){const e=document.createElement('td');e.textContent=typeof value==='object'?JSON.stringify(value):String(value);return e;}
function render(result){panel.replaceChildren();if(!result||result.error){panel.textContent=result&&result.error||'Unable to preview dataset.';return;}const info=document.createElement('div');info.className='muted';info.textContent=result.path+' · '+result.dtype+' · shape '+JSON.stringify(result.shape)+' · showing '+result.rows.length+' of '+result.totalRows+' rows'+(result.shape.length>1&&result.shape[1]>result.columnLimit?' · first '+result.columnLimit+' columns':'')+(result.extraDimensionsLimited?' · higher dimensions sampled':'');panel.appendChild(info);const wrap=document.createElement('div');wrap.className='table-wrap';const table=document.createElement('table');const head=document.createElement('tr');['#',...result.columns].forEach(v=>{const e=document.createElement('th');e.textContent=v;head.appendChild(e);});table.appendChild(head);result.rows.forEach((row,i)=>{const tr=document.createElement('tr');tr.appendChild(cell(i));row.forEach(v=>tr.appendChild(cell(v)));table.appendChild(tr);});wrap.appendChild(table);panel.appendChild(wrap);}
let activeRequest=0;function request(type,index){panel.textContent='Loading…';vscode.postMessage({type,index,requestId:++activeRequest});}nodes.forEach((n,i)=>{if(n.classList.contains('dataset'))n.onclick=()=>request('data',i);});const toggle=document.getElementById('toggleTree');toggle.onclick=()=>{document.body.classList.toggle('focus');toggle.textContent=document.body.classList.contains('focus')?'Show tree':'Hide tree';};const allCols=document.getElementById('allCols');if(allCols)allCols.onclick=()=>{document.body.classList.add('focus');toggle.textContent='Show tree';request('wide');};document.getElementById('refresh').onclick=()=>vscode.postMessage({type:'refresh'});window.addEventListener('message',e=>{const m=e.data;if(m.type==='data'&&m.requestId===activeRequest)render(m.error?{error:m.error}:m.data);});if(allCols)allCols.click();</script></body></html>`;
}

class HdfDocument { constructor(uri){this.uri=uri;this.key=uri.toString();} dispose(){} }

class Provider {
  constructor(context) { this.context=context; this.docs=new Map(); }
  openCustomDocument(uri) { const d=new HdfDocument(uri); this.docs.set(d.key,d); return d; }
  async resolveCustomEditor(document, panel) {
    panel.webview.options={enableScripts:true};
    const file=document.uri.fsPath;
    let result=await inspectFile(file,'tree');
    let tree=result.tree || [];
    const render=()=>{panel.webview.html=html(panel.webview,file,tree,result.error);};
    panel.webview.onDidReceiveMessage(async m=>{
      if(m.type==='refresh'){result=await inspectFile(file,'tree');tree=result.tree||[];render();}
      if(m.type==='wide'){
        const data=await inspectFile(file,'wide'); panel.webview.postMessage({type:'data',data,error:data.error,requestId:m.requestId});
      }
      if(m.type==='data'){
        const item=tree[m.index]; if(!item || item.kind!=='dataset') return;
        const data=await inspectFile(file,'data',item.path); panel.webview.postMessage({type:'data',data,error:data.error,requestId:m.requestId});
      }
    });
    render();
  }
}

function activate(context) {
  const provider=new Provider(context);
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('hdf5.viewer',provider,{supportsMultipleEditorsPerDocument:false}));
  context.subscriptions.push(vscode.commands.registerCommand('hdf5Viewer.open', uri=>{
    const target=uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
    if(target) vscode.commands.executeCommand('vscode.openWith',target,'hdf5.viewer');
    else vscode.window.showInformationMessage('请选择一个 .h5、.hdf5 或 .he5 文件。');
  }));
}
exports.activate=activate;
exports.deactivate=()=>{};
