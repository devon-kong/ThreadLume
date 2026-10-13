import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
const out=new URL('../dist-extension-native-dual/',import.meta.url);
await mkdir(out,{recursive:true});
for(const name of ['background','content','popup']){
 const result=await build({entryPoints:[`native-dual-extension/src/${name}.js`],bundle:true,write:false,format:name==='background'?'esm':'iife',target:'chrome120'});
 const code=result.outputFiles[0].text;
 if(/\bfetch\s*\(|XMLHttpRequest|webpack|__reactFiber|document\.cookie|\/i\/api\/|chrome\.(cookies|webRequest|declarativeNetRequest|scripting)/i.test(code))throw Error(`Forbidden capability in ${name}`);
 await writeFile(new URL(`${name}.js`,out),code);
}
for(const file of ['manifest.json','popup.html'])await copyFile(`native-dual-extension/${file}`,new URL(file,out));
const manifest=JSON.parse(await readFile(new URL('manifest.json',out),'utf8'));
if(JSON.stringify(manifest.permissions)!=='["storage"]')throw Error('Unexpected permissions');
console.log('Built dist-extension-native-dual/ (separate experimental MV3)');
