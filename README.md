# RedNote Downloader Website

A responsive, mobile-first website starter converted from the supplied Android project. It runs as a single Node.js web service and does not require `XHS_AUTHORIZED_API_URL`, `XHS_AUTHORIZED_API_KEY`, or a Gemini API key.

## Run locally

Requirements: Node.js 20+

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Deploy

Deploy this repository as a Node web service on Render or Railway. Build command: `npm install`. Start command: `npm start`. Set `PORT` only if your host does not provide it automatically. No API credentials are required for startup.

## Important integration limitations

- The resolver only checks publicly exposed Open Graph video/image metadata. RedNote may block unauthenticated requests, require a verification challenge, or not expose the original media URL. In those cases the website reports the limitation; it does not bypass login, CAPTCHA, private-profile restrictions, or signed-session controls.
- Public profile enumeration and bulk profile scanning are not implemented because the supplied Android source explicitly documents that unauthenticated profile feeds are restricted. A compliant authorized provider would be needed to add those capabilities.
- Browser downloads are subject to browser behavior and source headers. The app uses IndexedDB for local duplicate records; records are per-browser/device and are not synced.
- Original quality is source-dependent; the site does not upscale or claim quality that the source did not provide.

## Security

The backend validates page hosts and media hosts and restricts redirect handling for page resolution. Review and harden further before public production use, including request rate limiting, download size limits, and deployment-specific security headers.
