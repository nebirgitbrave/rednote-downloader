import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const ALLOWED_PAGE_HOSTS = new Set(['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com', 'www.xhslink.com']);
const ALLOWED_MEDIA_SUFFIXES = ['xhscdn.com', 'xiaohongshu.com'];
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function json(res, status, data) { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(data)); }
function allowedHost(host, list) { return list.some(d => host === d || host.endsWith('.' + d)); }
function extractUrl(input) {
  const match = String(input || '').match(/https?:\/\/[^\s]+/i);
  if (!match) throw new Error('Paste a valid RedNote share link.');
  const u = new URL(match[0].replace(/[)\]}>,，。]+$/, ''));
  if (!allowedHost(u.hostname.toLowerCase(), [...ALLOWED_PAGE_HOSTS])) throw new Error('Only public RedNote / Xiaohongshu links are supported.');
  return u;
}
async function safeFetch(startUrl, maxRedirects=5) {
  let current = new URL(startUrl);
  for (let i=0; i<=maxRedirects; i++) {
    if (current.protocol !== 'https:' || !allowedHost(current.hostname.toLowerCase(), [...ALLOWED_PAGE_HOSTS])) throw new Error('The link redirected outside the supported RedNote domains.');
    const response = await fetch(current, { redirect:'manual', signal: AbortSignal.timeout(18000), headers: { 'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', 'accept':'text/html,application/xhtml+xml' } });
    if ([301,302,303,307,308].includes(response.status)) {
      const loc = response.headers.get('location');
      if (!loc) throw new Error('RedNote returned an invalid redirect.');
      current = new URL(loc, current); continue;
    }
    return {response, finalUrl:current};
  }
  throw new Error('Too many redirects.');
}
function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'), new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')];
  for (const re of patterns) { const m=html.match(re); if(m) return m[1].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/\\u002F/g,'/').replace(/\\\//g,'/'); }
  return '';
}
function postId(url) { return url.pathname.match(/(?:explore|discovery\/item)\/([\w-]+)/)?.[1] || url.pathname.match(/\/([\w-]{12,})(?:\.html)?$/)?.[1] || ''; }

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res,200,{ok:true,service:'RedNote Downloader website',providerConfigured:false});
    if (req.method === 'POST' && url.pathname === '/api/resolve') {
      let body=''; for await (const chunk of req) { body += chunk; if(body.length > 12000) throw new Error('Request is too large.'); }
      const input = JSON.parse(body || '{}').url;
      const initial = extractUrl(input);
      if (/\/user\/profile\//i.test(initial.pathname)) return json(res,200,{ok:false,code:'PROFILE_RESTRICTED',title:'Profile scanning is not available',message:'RedNote does not expose reliable unauthenticated public profile enumeration here. This website will not bypass login, CAPTCHA, or signed-session restrictions.'});
      const {response,finalUrl} = await safeFetch(initial.toString());
      if (response.status === 401 || response.status === 403 || response.status === 429 || response.status === 412) return json(res,200,{ok:false,code:'SOURCE_BLOCKED',title:'RedNote restricted this request',message:`RedNote returned HTTP ${response.status}. This may require verification or a supported authorized provider. No access restrictions were bypassed.`});
      if (!response.ok) return json(res,200,{ok:false,code:'SOURCE_ERROR',title:'Could not retrieve this post',message:`RedNote returned HTTP ${response.status}.`});
      const html = await response.text();
      const title = meta(html,'og:title') || meta(html,'twitter:title') || 'RedNote public post';
      const description = meta(html,'og:description') || meta(html,'description');
      const video = meta(html,'og:video') || meta(html,'og:video:url') || meta(html,'og:video:secure_url');
      const image = meta(html,'og:image') || meta(html,'twitter:image');
      const id = postId(finalUrl) || postId(initial);
      const items=[];
      if (video && /^https:\/\//i.test(video)) items.push({id:`${id || 'post'}-video`,type:'VIDEO',mediaUrl:video,thumbnailUrl:image,title,quality:'Source-provided quality'});
      else if (image && /^https:\/\//i.test(image)) items.push({id:`${id || 'post'}-photo`,type:'PHOTO',mediaUrl:image,thumbnailUrl:image,title,quality:'Source-provided image resolution'});
      if (!items.length) return json(res,200,{ok:false,code:'NO_PUBLIC_MEDIA',title:'No public media stream found',message:'The page did not expose a downloadable public media URL. RedNote may require a verification step or authenticated session. This website will not bypass it.'});
      return json(res,200,{ok:true,postId:id,canonicalUrl:finalUrl.origin+finalUrl.pathname,title,description,items,notice:'Only media exposed publicly by the source is shown. Quality depends on the source.'});
    }
    if (req.method === 'GET' && url.pathname === '/api/media') {
      const target = new URL(url.searchParams.get('url') || '');
      if (target.protocol !== 'https:' || !allowedHost(target.hostname.toLowerCase(), ALLOWED_MEDIA_SUFFIXES)) return json(res,400,{error:'Unsupported media host.'});
      const upstream = await fetch(target, {redirect:'follow',signal:AbortSignal.timeout(30000),headers:{'user-agent':'Mozilla/5.0','referer':'https://www.xiaohongshu.com/'}});
      if (!upstream.ok || !upstream.body) return json(res,502,{error:`Media source returned HTTP ${upstream.status}.`});
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      res.writeHead(200, {'content-type':contentType,'content-disposition':'attachment','cache-control':'no-store','x-content-type-options':'nosniff'});
      for await (const chunk of upstream.body) res.write(chunk);
      return res.end();
    }
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(publicDir, requested);
    if (!file.startsWith(publicDir + path.sep)) return json(res,403,{error:'Forbidden'});
    const info = await stat(file);
    if (!info.isFile()) return json(res,404,{error:'Not found'});
    res.writeHead(200, {'content-type':mime[path.extname(file)] || 'application/octet-stream','cache-control':'no-cache'});
    res.end(await readFile(file));
  } catch (e) { json(res,400,{ok:false,error:e.message || 'Request failed'}); }
});
server.listen(PORT, () => console.log(`RedNote Downloader website running on port ${PORT}`));
