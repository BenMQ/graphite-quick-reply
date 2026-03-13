const DEFAULTS = { labels: ["Done", "Acknowledged", "Duplicate comment"], autoResolve: false };

const listEl = document.getElementById("label-list");
const inputEl = document.getElementById("new-label");
const addBtn = document.getElementById("add-btn");
const autoResolveEl = document.getElementById("auto-resolve");

let currentLabels = [];
let dragSrcIndex = null;

function render(labels) {
  currentLabels = labels;
  listEl.innerHTML = "";
  labels.forEach((label, i) => {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.index = i;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "\u2630";

    const span = document.createElement("span");
    span.className = "label-text";
    span.textContent = label;

    const del = document.createElement("button");
    del.textContent = "\u00d7";
    del.title = "Remove";
    del.addEventListener("click", () => {
      labels.splice(i, 1);
      chrome.storage.sync.set({ labels });
      render(labels);
      updateAddButton(labels);
    });

    li.addEventListener("dragstart", (e) => {
      dragSrcIndex = i;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      dragSrcIndex = null;
      listEl.querySelectorAll("li").forEach((el) => el.style.borderTop = "");
    });

    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      listEl.querySelectorAll("li").forEach((el) => el.style.borderTop = "");
      if (i !== dragSrcIndex) {
        li.style.borderTop = "2px solid #6a6aff";
      }
    });

    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragSrcIndex === null || dragSrcIndex === i) return;
      const moved = labels.splice(dragSrcIndex, 1)[0];
      labels.splice(i, 0, moved);
      chrome.storage.sync.set({ labels });
      render(labels);
    });

    li.appendChild(handle);
    li.appendChild(span);
    li.appendChild(del);
    listEl.appendChild(li);
  });
}

chrome.storage.sync.get(DEFAULTS, (result) => {
  render(result.labels);
  updateAddButton(result.labels);
  autoResolveEl.checked = result.autoResolve;
});

const MAX_LABELS = 20;
const MAX_LABEL_LENGTH = 50;

function updateAddButton(labels) {
  const atLimit = labels.length >= MAX_LABELS;
  addBtn.disabled = atLimit;
  addBtn.title = atLimit ? `Maximum ${MAX_LABELS} labels` : "";
}

addBtn.addEventListener("click", () => {
  const text = inputEl.value.trim().substring(0, MAX_LABEL_LENGTH);
  if (!text) return;
  chrome.storage.sync.get(DEFAULTS, (result) => {
    if (result.labels.length >= MAX_LABELS) return;
    result.labels.push(text);
    chrome.storage.sync.set({ labels: result.labels });
    render(result.labels);
    updateAddButton(result.labels);
    inputEl.value = "";
  });
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBtn.click();
});

autoResolveEl.addEventListener("change", () => {
  chrome.storage.sync.set({ autoResolve: autoResolveEl.checked });
});
