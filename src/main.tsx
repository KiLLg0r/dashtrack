import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const style = document.createElement('style')
style.textContent = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#09090c;--s1:#0f1116;--s2:#141820;--s3:#1c2232;
  --b1:rgba(255,255,255,0.05);--b2:rgba(255,255,255,0.10);--b3:rgba(255,255,255,0.18);
  --acc:#f5c542;--acc2:#c99b10;--acc-dim:rgba(245,197,66,0.1);
  --grn:#00e5a0;--grn2:#00b87e;--red:#ff4d6d;
  --txt:#dde2ec;--txt2:#aab1bb;--txt3:#8994a9;
  --r:8px;--mono:'JetBrains Mono',monospace;--ui:'Syne',sans-serif;
}
html,body,#root{height:100%;overflow:hidden;background:var(--bg);color:var(--txt)}
body{font-family:var(--ui)}
::-webkit-scrollbar{width:3px}
::-webkit-scrollbar-thumb{background:var(--b2);border-radius:2px}
button{font-family:inherit}
`
document.head.appendChild(style)

// Google Fonts
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Syne:wght@500;600&display=swap'
document.head.appendChild(link)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
