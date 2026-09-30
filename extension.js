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
  return String.raw`import sys,json
try:
 import h5py
except Exception as e:
 print(json.dumps({'error':'Python h5py is not installed: '+str(e)})); sys.exit(0)
path=sys.argv[1]; action=sys.argv[2]
try:
 with h5py.File(path,'r') as f:
  if action=='tree':
   out=[]
   def visit(n,o):
    if isinstance(o,h5py.Dataset): out.append({'path':n,'kind':'dataset','shape':list(o.shape),'dtype':str(o.dtype),'size':int(o.size)})
    else: out.append({'path':n,'kind':'group'})
   f.visititems(visit); print(json.dumps({'tree':out},default=str))
  elif action=='data':
   name=sys.argv[3]; limit=int(sys.argv[4])
   d=f[name]; x=d[tuple(slice(0,min(limit,s)) for s in d.shape)] if d.shape else d[()]
   print(json.dumps({'path':name,'shape':list(d.shape),'dtype':str(d.dtype),'data':x.tolist() if hasattr(x,'tolist') else x},default=str))
except Exception as e: print(json.dumps({'error':str(e)}))`;
}

async function inspectFile(file, action, dataset) {
  try {
    const out = await run('h5ls', action === 'tree' ? ['-r', file] : [file]);
    if (action === 'tree') {
      const tree = out.split(/\r?\n/).filter(Boolean).map(line => {
        const m = line.match(/^\s*(.*?)(?:\s+\{(.*)\})?\s*$/);
        return m ? { path: m[1], kind: m[2] ? 'dataset' : 'group', detail: m[2] || '' } : null;
      }).filter(Boolean);
      return { tree };
    }
  } catch (_) {}
  const script = pyScript();
  const args = ['-c', script, file, action];
  if (dataset) args.push(dataset, '100');
  try { return JSON.parse(await run('python3', args)); }
  catch (e) { return { error: '需要远程主机安装 hdf5-tools 或 Python h5py。' + (e.stderr || e.message) }; }
}

function html(webview, file, tree, error) {
  const nonce = Math.random().toString(36).slice(2);
  const safe = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows = (tree || []).map((x, i) => `<button class="node ${x.kind}" data-index="${i}" title="${safe(x.path)}">${x.kind === 'dataset' ? '▦' : '▾'} ${safe(x.path)} ${x.shape ? '<span>'+safe(x.shape.join(' × '))+'</span>' : ''}</button>`).join('');
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
body{font:13px var(--vscode-font-family);color:var(--vscode-foreground);padding:0 14px}.bar{display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--vscode-panel-border);padding:8px 0}.path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.layout{display:grid;grid-template-columns:minmax(260px,35%) 1fr;gap:16px;margin-top:12px}.tree{overflow:auto;max-height:calc(100vh - 100px)}button.node{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:5px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button.node:hover{background:var(--vscode-list-hoverBackground)}button.node span{color:var(--vscode-descriptionForeground);margin-left:6px}.panel{white-space:pre-wrap;overflow:auto;max-height:calc(100vh - 120px)}.muted{color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}</style></head><body>
<div class="bar"><strong>HDF5 Viewer</strong><div class="path" title="${safe(file)}">${safe(file)}</div><button id="refresh">Refresh</button></div><div class="layout"><div class="tree">${rows || '<div class="muted">No objects found.</div>'}</div><pre id="panel" class="panel">${safe(error || 'Select a dataset to preview its first 100 values.')}</pre></div>
<script nonce="${nonce}">const vscode=acquireVsCodeApi();const nodes=[...document.querySelectorAll('.node')];const panel=document.getElementById('panel');nodes.forEach((n,i)=>n.onclick=()=>{panel.textContent='Loading…';vscode.postMessage({type:'data',index:i});});document.getElementById('refresh').onclick=()=>vscode.postMessage({type:'refresh'});window.addEventListener('message',e=>{const m=e.data;if(m.type==='data')panel.textContent=m.error||JSON.stringify(m.data,null,2);if(m.type==='tree')location.reload();});</script></body></html>`;
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
    const render=()=>{panel.webview.html=html(panel.webview,file,tree,result.error);}; render();
    panel.webview.onDidReceiveMessage(async m=>{
      if(m.type==='refresh'){result=await inspectFile(file,'tree');tree=result.tree||[];render();}
      if(m.type==='data'){
        const item=tree[m.index]; if(!item || item.kind!=='dataset') return;
        const data=await inspectFile(file,'data',item.path); panel.webview.postMessage({type:'data',data,error:data.error});
      }
    });
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
