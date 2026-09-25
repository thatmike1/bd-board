// ==UserScript==
// @name         bd-board task tab titles
// @namespace    https://github.com/thatmike1/bd-board
// @version      1.0.0
// @description  Show the selected task ID and title in the browser tab.
// @match        http://127.0.0.1/*
// @match        http://localhost/*
// @run-at       document-idle
// ==/UserScript==

(() => {
  if (document.title !== 'bd board') return

  const root = document.getElementById('root')
  if (!root) return

  const updateTitle = () => {
    const id = root.querySelector('.read .rhead .copyid')?.textContent?.trim()
    const title = root.querySelector('.read .rbody h1')?.textContent?.trim()
    const next = id && title ? `${id} · ${title}` : 'bd board'
    if (document.title !== next) document.title = next
  }

  new MutationObserver(updateTitle).observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
  })
  updateTitle()
})()
