// The renderer gets two things from the shell: that it is running as the
// desktop app (for the window chrome inset), Nightscout calls and GitHub calls
// that the main process answers (electron/nightscout.cjs, electron/github.cjs). No Node APIs cross the bridge,
// and the access token never comes back to the page.
const { contextBridge, ipcRenderer } = require('electron');

const food = (f) => ({ name: String(f?.name ?? ''), foodType: String(f?.foodType ?? ''), grams: Number(f?.grams), absorptionMin: Number(f?.absorptionMin) });

contextBridge.exposeInMainWorld('loopstack', Object.freeze({
  desktop: true,
  platform: process.platform,
  nightscout: Object.freeze({
    config: () => ipcRenderer.invoke('ns:config'),
    connect: (input) => ipcRenderer.invoke('ns:connect', { url: String(input?.url ?? ''), token: String(input?.token ?? ''), name: String(input?.name ?? '') }),
    fetch: () => ipcRenderer.invoke('ns:fetch'),
    disconnect: () => ipcRenderer.invoke('ns:disconnect'),
  }),
  github: Object.freeze({
    config: () => ipcRenderer.invoke('gh:config'),
    connect: (input) => ipcRenderer.invoke('gh:connect', { token: String(input?.token ?? ''), repo: String(input?.repo ?? ''), branch: String(input?.branch ?? '') }),
    status: () => ipcRenderer.invoke('gh:status'),
    build: () => ipcRenderer.invoke('gh:build'),
    commits: () => ipcRenderer.invoke('gh:commits'),
    disconnect: () => ipcRenderer.invoke('gh:disconnect'),
  }),
  library: Object.freeze({
    list: () => ipcRenderer.invoke('lib:list'),
    check: (input) => ipcRenderer.invoke('lib:check', { id: String(input?.id ?? ''), sourceSha: String(input?.sourceSha ?? '') }),
    add: (input) => ipcRenderer.invoke('lib:add', { id: String(input?.id ?? ''), sourceSha: String(input?.sourceSha ?? ''), variant: String(input?.variant ?? ''), reviewed: input?.reviewed === true, confirmDosing: input?.confirmDosing === true }),
    remove: (input) => ipcRenderer.invoke('lib:remove', { id: String(input?.id ?? '') }),
  }),
  mine: Object.freeze({
    list: () => ipcRenderer.invoke('mine:list'),
    check: (input) => ipcRenderer.invoke('mine:check', { file: String(input?.file ?? '') }),
    toggle: (input) => ipcRenderer.invoke('mine:toggle', { file: String(input?.file ?? ''), to: input?.to === 'on' ? 'on' : 'off', together: input?.together === true, reviewed: input?.reviewed === true, confirmDosing: input?.confirmDosing === true }),
  }),
  ai: Object.freeze({
    config: () => ipcRenderer.invoke('ai:config'),
    connect: (input) => ipcRenderer.invoke('ai:connect', { apiKey: String(input?.apiKey ?? '') }),
    disconnect: () => ipcRenderer.invoke('ai:disconnect'),
    ask: (input) => ipcRenderer.invoke('ai:ask', { question: String(input?.question ?? ''), summary: input?.summary ?? {} }),
    chat: (input) => ipcRenderer.invoke('ai:chat', { messages: Array.isArray(input?.messages) ? input.messages.map((m) => ({ role: String(m?.role ?? ''), text: String(m?.text ?? '') })) : [], context: input?.context ?? {} }),
    draft: (input) => ipcRenderer.invoke('ai:draft', { description: String(input?.description ?? '') }),
    commit: (input) => ipcRenderer.invoke('ai:commit', { id: String(input?.id ?? ''), reviewed: input?.reviewed === true, confirmDosing: input?.confirmDosing === true }),
  }),
  review: Object.freeze({
    pdf: (input) => ipcRenderer.invoke('review:pdf', { action: input?.action === 'email' ? 'email' : 'save' }),
  }),
  nextBuild: Object.freeze({
    exportBrief: (input) => ipcRenderer.invoke('next:export', { markdown: String(input?.markdown ?? '') }),
    preview: (input) => ipcRenderer.invoke('next:preview', { items: Array.isArray(input?.items) ? input.items : [] }),
    commit: (input) => ipcRenderer.invoke('next:commit', { items: Array.isArray(input?.items) ? input.items : [], reviewed: input?.reviewed === true, confirmDosing: input?.confirmDosing === true }),
  }),
  favorites: Object.freeze({
    list: () => ipcRenderer.invoke('fav:list'),
    preview: (input) => ipcRenderer.invoke('fav:preview', { food: food(input?.food) }),
    add: (input) => ipcRenderer.invoke('fav:add', { food: food(input?.food), reviewed: input?.reviewed === true, confirmDosing: input?.confirmDosing === true }),
  }),
}));
