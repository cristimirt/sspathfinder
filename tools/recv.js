// Receives JSON posted by a browser crawl: POST /<name> -> data/raw/<name>.json
const http=require('http'),fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..','data','raw');
http.createServer((req,res)=>{
  const h={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Private-Network':'true','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(req.method==='OPTIONS'){res.writeHead(204,h);return res.end();}
  const name=path.basename(req.url.split('?')[0])||'x';
  const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
    const b=Buffer.concat(chunks);fs.writeFileSync(path.join(dir,name+'.json'),b);
    console.log('saved',name,b.length);res.writeHead(200,h);res.end('ok');});
}).listen(48791,'127.0.0.1',()=>console.log('recv on 48791'));
